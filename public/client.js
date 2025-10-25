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
    let list = root.querySelector("#messages-list");
    const ensureList = () => {
      if (!list)
        list = root.querySelector("#messages-list");
    };
    const scroll = () => {
      ensureList();
      if (!list)
        return;
      list.scrollTop = list.scrollHeight;
    };
    scroll();
    const mutObs = new MutationObserver(() => scroll());
    if (list)
      mutObs.observe(list, { childList: true, subtree: true });
    else
      mutObs.observe(root, { childList: true, subtree: true });
    const resizeObs = new ResizeObserver(() => scroll());
    if (list)
      resizeObs.observe(list);
    else
      resizeObs.observe(root);
    const onWinResize = () => scroll();
    window.addEventListener("resize", onWinResize);
    destroy(() => {
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
      root.appendChild(playPause);
      const testBtn = document.createElement("button");
      testBtn.type = "button";
      testBtn.textContent = "Test";
      testBtn.style.marginTop = "1rem";
      testBtn.style.marginLeft = "0.5rem";
      testBtn.addEventListener("click", () => {
        try {
          if ("speechSynthesis" in window) {
            speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance("Audio test");
            speechSynthesis.speak(u);
            return;
          }
        } catch {}
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext);
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = 660;
          osc.connect(ctx.destination);
          osc.start();
          setTimeout(() => {
            try {
              osc.stop();
              ctx.close();
            } catch {}
          }, 250);
        } catch {}
      });
      root.appendChild(testBtn);
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
