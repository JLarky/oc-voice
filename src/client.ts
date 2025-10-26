// src/client.ts

import { liftHtml } from "@lift-html/core";

liftHtml("messages-wrapper", {
  init(destroy) {
    const root = this as HTMLElement;
    let rafId: number | null = null;
    const scroll = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      const list = root.querySelector(
        '[id^="messages-list-"]',
      ) as HTMLElement | null;
      if (!list) return;
      // Defer until after layout
      rafId = requestAnimationFrame(() => {
        rafId = null;
        list.scrollTop = list.scrollHeight;
      });
    };
    scroll();

    // Scroll when mutations occur (handles Datastar morphing and new messages)
    const mutObs = new MutationObserver((mutations) => {
      // Debounce multiple mutations in quick succession
      scroll();
    });
    // Observe the root for all mutations (catches Datastar DOM replacements)
    mutObs.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Scroll when resized (viewport or element size changes)
    const resizeObs = new ResizeObserver(() => scroll());
    // Observe the messages-list if it exists, otherwise observe root
    const list = root.querySelector('[id^="messages-list-"]');
    if (list) resizeObs.observe(list);
    else resizeObs.observe(root);

    const onWinResize = () => scroll();
    window.addEventListener("resize", onWinResize);

    destroy(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      mutObs.disconnect();
      resizeObs.disconnect();
      window.removeEventListener("resize", onWinResize);
    });
  },
});

// Static speech button component (speaks latest summary + auto mode)
liftHtml("speech-button", {
  init(destroy) {
    const root = this as HTMLElement;
    let readBtn = root.querySelector("button");
    let playPause: HTMLButtonElement | null = null;
    let testBtn: HTMLButtonElement | null = null;
    let isPlaying = true;
    const LS_KEY = "speechAutoPlay";
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored === "false") isPlaying = false;
    } catch {}
    let lastSpoken = "";
    let pending: string | null = null;
    let currentUtter: SpeechSynthesisUtterance | null = null;

    if (!readBtn) {
      // No markup supplied: create all three buttons.
      readBtn = document.createElement("button");
      readBtn.type = "button";
      readBtn.textContent = "Read Summary";
      readBtn.style.marginTop = "1rem";
      root.appendChild(readBtn);
      playPause = document.createElement("button");
      playPause.type = "button";
      playPause.textContent = isPlaying ? "Pause" : "Play";
      playPause.style.marginTop = "1rem";
      playPause.style.marginLeft = "0.5rem";
      root.appendChild(playPause);
      testBtn = document.createElement("button");
      testBtn.type = "button";
      testBtn.textContent = "Test";
      testBtn.style.marginTop = "1rem";
      testBtn.style.marginLeft = "0.5rem";
      root.appendChild(testBtn);
    } else {
      // Markup already contains buttons; wire them up.
      const buttons = Array.from(root.querySelectorAll("button"));
      // Prefer matching by text, fallback to order.
      readBtn =
        buttons.find((b) => /read summary/i.test(b.textContent || "")) ||
        readBtn;
      playPause =
        buttons.find((b) => /(play|pause)/i.test(b.textContent || "")) || null;
      testBtn = buttons.find((b) => /test/i.test(b.textContent || "")) || null;
      // Ensure playPause text reflects stored autoplay state.
      if (playPause) playPause.textContent = isPlaying ? "Pause" : "Play";
    }

    // Attach listeners (creation and existing cases).
    if (playPause) {
      playPause.addEventListener("click", () => {
        isPlaying = !isPlaying;
        playPause!.textContent = isPlaying ? "Pause" : "Play";
        try {
          localStorage.setItem(LS_KEY, String(isPlaying));
        } catch {}
        console.log("playPause toggle", { isPlaying });
        if (isPlaying) triggerAutoSpeak();
      });
    }
    if (testBtn) {
      const speakTest = async () => {
        if (!("speechSynthesis" in window)) {
          console.warn("[tts] speechSynthesis unavailable");
          return;
        }
        try {
          speechSynthesis.cancel();
        } catch {}
        let voices = speechSynthesis.getVoices();
        if (!voices.length) {
          voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
            const timer = setTimeout(
              () => resolve(speechSynthesis.getVoices()),
              1000,
            );
            const handler = () => {
              clearTimeout(timer);
              speechSynthesis.removeEventListener(
                "voiceschanged",
                handler as any,
              );
              resolve(speechSynthesis.getVoices());
            };
            speechSynthesis.addEventListener("voiceschanged", handler as any);
          });
        }
        try {
          const utter = new SpeechSynthesisUtterance("hi");
          const chosen = voices.find((v) => /en/i.test(v.lang)) || voices[0];
          if (chosen) utter.voice = chosen;
          utter.onerror = (e) => console.warn("[tts] error", e);
          speechSynthesis.speak(utter);
        } catch (err) {
          console.warn("[tts] speak failed", err);
        }
      };
      testBtn.addEventListener("click", () => {
        speakTest();
      });
    }

    function extractSummary(): string {
      const el = document.querySelector(".messages-summary");
      if (!el) return "";
      let text = (el.textContent || "").replace(/\s+/g, " ").trim();
      text = text
        .replace(/^summary:\s*/i, "")
        .replace(/\b(action|info)\s*$/i, "")
        .trim();
      return text;
    }

    function speak(summary: string) {
      if (!("speechSynthesis" in window)) return;
      if (!summary) return;
      // Only speak latest; cancel previous and wait for end before next
      try {
        speechSynthesis.cancel();
      } catch {}
      currentUtter = new SpeechSynthesisUtterance(summary);
      lastSpoken = summary;
      pending = null;
      currentUtter.onend = () => {
        currentUtter = null;
        if (isPlaying && pending && pending !== lastSpoken) {
          const p = pending;
          pending = null;
          speak(p);
        }
      };
      speechSynthesis.speak(currentUtter);
    }

    function isPlaceholder(s: string): boolean {
      return (
        !s ||
        s === "..." ||
        /^(\(no recent messages\)|\(no messages\)|\(empty summary\)|\(summary failed\))$/i.test(
          s,
        )
      );
    }
    function considerAutoSpeak(summary: string) {
      if (!isPlaying) return;
      if (!summary || isPlaceholder(summary)) return;
      if (currentUtter) {
        if (summary !== lastSpoken && !isPlaceholder(summary))
          pending = summary;
        return;
      }
      if (summary === lastSpoken) return;
      speak(summary);
    }

    function triggerAutoSpeak() {
      const s = extractSummary();
      if (!s || s === lastSpoken) return;
      if (isPlaceholder(s)) return;
      if (!currentUtter) speak(s);
      else pending = s;
    }

    readBtn!.addEventListener("click", () => {
      const s = extractSummary() || "No summary yet.";
      speak(s);
    });

    const list = document.querySelector('[id^="messages-list-"]');
    let obs: MutationObserver | null = null;
    if (list) {
      obs = new MutationObserver(() => updateUIAndAuto());
      obs.observe(list, { childList: true, subtree: true });
    }
    const intervalId = setInterval(updateUIAndAuto, 3000);
    // Capture initial summary to ignore once
    const initialSummary = extractSummary();
    let initialConsumed = false;
    function updateUIAndAuto() {
      const s = extractSummary();
      if (s) readBtn!.title = s;
      if (!initialConsumed) {
        if (s !== initialSummary) initialConsumed = true; // changed -> future summaries allowed
        return; // ignore first encountered
      }
      considerAutoSpeak(s);
    }
    updateUIAndAuto();
    destroy(() => {
      if (obs) obs.disconnect();
      clearInterval(intervalId);
      try {
        speechSynthesis.cancel();
      } catch {}
    });
  },
});

liftHtml("submit-on-enter", {
  init(destroy) {
    const abort = new AbortController();
    destroy(() => abort.abort());

    const root = this as HTMLElement;
    const textarea = root.querySelector("textarea");
    if (!textarea) return;
    textarea.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.closest("form")?.requestSubmit();
        }
      },
      abort,
    );
  },
});
