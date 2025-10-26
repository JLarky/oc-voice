// node_modules/@lift-html/core/esm/mod.js
var HTMLElement_ = typeof HTMLElement !== "undefined" ? HTMLElement : class {
};

class LiftBaseClass extends HTMLElement_ {
  static options;
  static formAssociated;
  static observedAttributes;
}
function liftHtml(tagName, opts) {

  class LiftElement extends LiftBaseClass {
    static hmr = new Set;
    acb = undefined;
    static options = opts;
    options = opts;
    static observedAttributes = opts.observedAttributes;
    static formAssociated = opts.formAssociated;
    attributeChangedCallback(attrName, _oldValue, newValue) {
      this.acb?.(attrName, newValue);
    }
    connectedCallback() {
      this.cb(true);
    }
    adoptedCallback() {
      this.cb(true);
    }
    disconnectedCallback() {
      this.cb();
      this.acb = undefined;
      LiftElement.hmr.delete(this);
    }
    cleanup = [];
    cb(connect) {
      while (this.cleanup.length) {
        this.cleanup.pop()();
      }
      if (this.isConnected && connect) {
        LiftElement.options.init?.call(this, (cb) => {
          this.cleanup.push(cb);
        });
      }
      if (!opts.noHMR) {
        LiftElement.hmr.add(this);
      }
    }
  }
  if (typeof customElements !== "undefined") {
    const existing = customElements.get(tagName);
    if (existing) {
      if (!opts.noHMR) {
        existing.options = opts;
        existing.hmr.forEach((cb) => cb.cb(true));
      }
      return existing;
    }
    customElements.define(tagName, LiftElement);
  }
  return LiftElement;
}

// src/client.ts
liftHtml("messages-wrapper", {
  init(destroy) {
    const root = this;
    let rafId = null;
    const scroll = () => {
      if (rafId !== null)
        cancelAnimationFrame(rafId);
      const list2 = root.querySelector("#messages-list");
      if (!list2)
        return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        list2.scrollTop = list2.scrollHeight;
      });
    };
    scroll();
    const mutObs = new MutationObserver((mutations) => {
      scroll();
    });
    mutObs.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });
    const resizeObs = new ResizeObserver(() => scroll());
    const list = root.querySelector("#messages-list");
    if (list)
      resizeObs.observe(list);
    else
      resizeObs.observe(root);
    const onWinResize = () => scroll();
    window.addEventListener("resize", onWinResize);
    destroy(() => {
      if (rafId !== null)
        cancelAnimationFrame(rafId);
      mutObs.disconnect();
      resizeObs.disconnect();
      window.removeEventListener("resize", onWinResize);
    });
  }
});
liftHtml("speech-button", {
  init(destroy) {
    const root = this;
    let readBtn = root.querySelector("button");
    let playPause = null;
    let testBtn = null;
    let isPlaying = true;
    const LS_KEY = "speechAutoPlay";
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored === "false")
        isPlaying = false;
    } catch {}
    let lastSpoken = "";
    let pending = null;
    let currentUtter = null;
    if (!readBtn) {
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
      const buttons = Array.from(root.querySelectorAll("button"));
      readBtn = buttons.find((b) => /read summary/i.test(b.textContent || "")) || readBtn;
      playPause = buttons.find((b) => /(play|pause)/i.test(b.textContent || "")) || null;
      testBtn = buttons.find((b) => /test/i.test(b.textContent || "")) || null;
      if (playPause)
        playPause.textContent = isPlaying ? "Pause" : "Play";
    }
    if (playPause) {
      playPause.addEventListener("click", () => {
        isPlaying = !isPlaying;
        playPause.textContent = isPlaying ? "Pause" : "Play";
        try {
          localStorage.setItem(LS_KEY, String(isPlaying));
        } catch {}
        console.log("playPause toggle", { isPlaying });
        if (isPlaying)
          triggerAutoSpeak();
      });
    }
    if (testBtn) {
      const waitForVoices = async () => {
        let voices = speechSynthesis.getVoices();
        if (voices.length)
          return voices;
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 2000);
          const handler = () => {
            clearTimeout(timer);
            speechSynthesis.removeEventListener("voiceschanged", handler);
            resolve(speechSynthesis.getVoices());
          };
          speechSynthesis.addEventListener("voiceschanged", handler);
        });
      };
      const speakTest = async () => {
        if (!("speechSynthesis" in window)) {
          window.alert("TTS not supported in this browser");
          return;
        }
        try {
          speechSynthesis.cancel();
        } catch {}
        const voices = await waitForVoices();
        const chosen = voices.find((v) => /en/i.test(v.lang)) || voices[0];
        if (!voices.length) {
          window.alert("No voices available");
          return;
        }
        try {
          const utter = new SpeechSynthesisUtterance("Speech synthesis test. If you hear this spoken clearly it works.");
          if (chosen)
            utter.voice = chosen;
          utter.onstart = () => {
            try {
              window.alert("Speech start voice=" + (chosen?.name || "unknown"));
            } catch {}
          };
          utter.onend = () => {
            try {
              window.alert("Speech ended");
            } catch {}
          };
          utter.onerror = (e) => {
            try {
              window.alert("Speech error: " + (e.error || "unknown"));
            } catch {}
          };
          speechSynthesis.speak(utter);
          window.alert("Invoked speak voices=" + voices.length + " chosen=" + (chosen?.name || "none"));
        } catch (err) {
          window.alert("Speak failed: " + (err instanceof Error ? err.message : String(err)));
        }
      };
      testBtn.addEventListener("click", () => {
        speakTest();
      });
      const diagBtn = document.createElement("button");
      diagBtn.type = "button";
      diagBtn.textContent = "Diag TTS";
      diagBtn.style.marginTop = "1rem";
      diagBtn.style.marginLeft = "0.5rem";
      testBtn.after(diagBtn);
      diagBtn.addEventListener("click", async () => {
        if (!("speechSynthesis" in window)) {
          window.alert("TTS unsupported");
          return;
        }
        let voicesInitial = speechSynthesis.getVoices();
        const listStrInitial = voicesInitial.map((v) => v.name + "(" + v.lang + ")").join(", ") || "(none)";
        try {
          window.alert("Initial voices: " + listStrInitial);
        } catch {}
        const voices = await waitForVoices();
        const listStr = voices.map((v) => v.name + "(" + v.lang + ")").join(", ") || "(none)";
        try {
          window.alert("Loaded voices: " + listStr);
        } catch {}
        try {
          speechSynthesis.cancel();
        } catch {}
        const chosen = voices.find((v) => /en/i.test(v.lang)) || voices[0];
        const utter = new SpeechSynthesisUtterance("Diagnostic speech synthesis phrase. You should hear this sentence clearly.");
        if (chosen)
          utter.voice = chosen;
        utter.onstart = () => {
          try {
            window.alert("Diag start voice=" + (chosen?.name || "unknown"));
          } catch {}
        };
        utter.onend = () => {
          try {
            window.alert("Diag end");
          } catch {}
        };
        utter.onerror = (e) => {
          try {
            window.alert("Diag error: " + (e.error || "unknown"));
          } catch {}
        };
        let started = false;
        utter.onstart = () => {
          started = true;
          try {
            window.alert("Diag start voice=" + (chosen?.name || "unknown"));
          } catch {}
        };
        speechSynthesis.speak(utter);
        try {
          window.alert("Diag speak invoked voices=" + voices.length + " chosen=" + (chosen?.name || "none"));
        } catch {}
        setTimeout(() => {
          if (speechSynthesis.speaking || started)
            return;
          try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const ctx = new Ctx;
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.value = 440;
            osc.connect(ctx.destination);
            osc.start();
            setTimeout(() => {
              try {
                osc.stop();
                ctx.close();
              } catch {}
            }, 350);
            window.alert("Fallback beep (speech did not start)");
          } catch (err) {
            window.alert("Fallback beep failed: " + (err instanceof Error ? err.message : String(err)));
          }
        }, 1800);
      });
    }
    function extractSummary() {
      const el = document.querySelector(".messages-summary");
      if (!el)
        return "";
      let text = (el.textContent || "").replace(/\s+/g, " ").trim();
      text = text.replace(/^summary:\s*/i, "").replace(/\b(action|info)\s*$/i, "").trim();
      return text;
    }
    function speak(summary) {
      if (!("speechSynthesis" in window))
        return;
      if (!summary)
        return;
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
    function isPlaceholder(s) {
      return !s || s === "..." || /^(\(no recent messages\)|\(no messages\)|\(empty summary\)|\(summary failed\))$/i.test(s);
    }
    function considerAutoSpeak(summary) {
      if (!isPlaying)
        return;
      if (!summary || isPlaceholder(summary))
        return;
      if (currentUtter) {
        if (summary !== lastSpoken && !isPlaceholder(summary))
          pending = summary;
        return;
      }
      if (summary === lastSpoken)
        return;
      speak(summary);
    }
    function triggerAutoSpeak() {
      const s = extractSummary();
      if (!s || s === lastSpoken)
        return;
      if (isPlaceholder(s))
        return;
      if (!currentUtter)
        speak(s);
      else
        pending = s;
    }
    readBtn.addEventListener("click", () => {
      const s = extractSummary() || "No summary yet.";
      speak(s);
    });
    const list = document.getElementById("messages-list");
    let obs = null;
    if (list) {
      obs = new MutationObserver(() => updateUIAndAuto());
      obs.observe(list, { childList: true, subtree: true });
    }
    const intervalId = setInterval(updateUIAndAuto, 3000);
    const initialSummary = extractSummary();
    let initialConsumed = false;
    function updateUIAndAuto() {
      const s = extractSummary();
      if (s)
        readBtn.title = s;
      if (!initialConsumed) {
        if (s !== initialSummary)
          initialConsumed = true;
        return;
      }
      considerAutoSpeak(s);
    }
    updateUIAndAuto();
    destroy(() => {
      if (obs)
        obs.disconnect();
      clearInterval(intervalId);
      try {
        speechSynthesis.cancel();
      } catch {}
    });
  }
});
liftHtml("submit-on-enter", {
  init(destroy) {
    const abort = new AbortController;
    destroy(() => abort.abort());
    const root = this;
    const textarea = root.querySelector("textarea");
    if (!textarea)
      return;
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.closest("form")?.requestSubmit();
      }
    }, abort);
  }
});
