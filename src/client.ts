// src/client.ts
// Simple client script: attach click handler to button and call server endpoint

async function init() {
  const form = document.getElementById("hello-form");
  const btn = document.getElementById("hello-btn");
  const output = document.getElementById("hello-output");
  if (!btn || !output || !form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("user-input") as HTMLInputElement | null;
    const value = input?.value || "";
    output.textContent = "Loading...";
    try {
      const res = await fetch(`/hello?name=${encodeURIComponent(value)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Replace the output container using simple innerHTML since response wraps a div
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const newEl = temp.firstElementChild;
      if (newEl && newEl.id === 'hello-output') {
        output.innerHTML = newEl.innerHTML;
      } else {
        output.textContent = html;
      }
    } catch (err) {
      output.textContent = `Error: ${(err as Error).message}`;
    }
  });
}

init();
