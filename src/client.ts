// src/client.ts

import { liftHtml } from "@lift-html/core";

liftHtml("messages-wrapper", {
  init() {
    console.log("hello world 12345", this);
    const root = this as HTMLElement;
    const scroll = () => {
      const list = root.querySelector('#messages-list') as HTMLElement | null;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    };
    scroll();
    const intervalId = setInterval(scroll, 2000);
    // optional: store id for later cleanup if liftHtml provides a destroy hook
    (root as any).__autoScrollInterval = intervalId;
  },
});
