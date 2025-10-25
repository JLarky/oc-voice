// src/client.ts

import { liftHtml } from "@lift-html/core";

liftHtml("messages-wrapper", {
  init(destroy) {
    console.log("hello world 12345", this);
    const root = this as HTMLElement;
    const scroll = () => {
      const list = root.querySelector("#messages-list") as HTMLElement | null;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    };
    scroll();
    const intervalId = setInterval(scroll, 2000);
    destroy(() => clearInterval(intervalId));
  },
});

// Static speech button component
liftHtml("speech-button", {
  init() {
    const root = this as HTMLElement;
    // Create button only once
    let btn = root.querySelector("button");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Say Hello";
      btn.style.marginTop = "1rem";
      btn.addEventListener("click", () => {
        if (!("speechSynthesis" in window)) {
          console.warn("speechSynthesis unsupported");
          return;
        }
        const utter = new SpeechSynthesisUtterance("Hello.");
        try { speechSynthesis.cancel(); } catch {}
        speechSynthesis.speak(utter);
      });
      root.appendChild(btn);
    }
  },
});
