// src/client.ts
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('[data-on\\:load*="fetch"]').forEach((el) => {
    const attr = el.getAttribute("data-on:load");
    const match = attr.match(/fetch\('([^']+)'\)/);
    if (match) {
      const url = match[1];
      new EventSource(url);
    }
  });
});
