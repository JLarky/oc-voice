// src/client.ts

import { liftHtml } from "@lift-html/core";

liftHtml("messages-wrapper", {
  init(destroy) {
    const root = this as HTMLElement;
    let rafId: number | null = null;
    const scroll = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      const list = root.querySelector("#messages-list") as HTMLElement | null;
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
    const list = root.querySelector("#messages-list");
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
      testBtn.addEventListener('click', () => {
        // Robust TTS test: speak 'hi' with logging & fallbacks; no UI changes.
        const speakHi = () => {
          try {
            const utter = new SpeechSynthesisUtterance('hi');
            const voices = speechSynthesis.getVoices();
            const voice = voices.find(v => /en/i.test(v.lang)) || voices[0];
            if (voice) utter.voice = voice;
            utter.rate = 1; utter.pitch = 1; utter.volume = 1;
            utter.onstart = () => console.log('[tts:test] onstart');
            utter.onend = () => console.log('[tts:test] onend');
            utter.onerror = (e) => console.warn('[tts:test] onerror', e);
            speechSynthesis.speak(utter);
            console.log('[tts:test] speakHi invoked', { voices: voices.length, speaking: speechSynthesis.speaking });
          } catch (err) {
            console.warn('[tts:test] speakHi failed, fallback beep', err);
            beepFallback();
          }
        };
        const beepFallback = () => {
          try {
            const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            osc.type = 'sine'; osc.frequency.value = 660; osc.connect(ctx.destination); osc.start();
            setTimeout(() => { try { osc.stop(); ctx.close(); } catch {}; }, 240);
          } catch (e) { console.warn('[tts:test] audio fallback failed', e); }
        };
        try {
          if (!('speechSynthesis' in window)) { beepFallback(); return; }
          // If already speaking, let current finish then queue hi.
          if (speechSynthesis.speaking) {
            console.log('[tts:test] already speaking, queuing hi after cancel');
            try { speechSynthesis.cancel(); } catch {}
          }
          const voicesNow = speechSynthesis.getVoices();
          console.log('[tts:test] initial voices', voicesNow.length);
          if (voicesNow.length === 0) {
            const voicesListener = () => {
              speechSynthesis.removeEventListener('voiceschanged', voicesListener as any);
              console.log('[tts:test] voiceschanged fired');
              speakHi();
            };
            speechSynthesis.addEventListener('voiceschanged', voicesListener as any);
            // Fallback timeout if event doesn't fire.
            setTimeout(() => {
              console.log('[tts:test] voices timeout fallback');
              speakHi();
            }, 800);
            return;
          }
          speakHi();
        } catch (err) {
          console.warn('[tts:test] outer error, fallback beep', err);
          beepFallback();
        }
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

    const list = document.getElementById("messages-list");
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
