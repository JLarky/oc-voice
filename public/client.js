// src/client.ts
function setupHelloForm() {
  const form = document.getElementById("hello-form");
  const btn = document.getElementById("hello-btn");
  const output = document.getElementById("hello-output");
  if (!form || !btn || !output)
    return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("user-input");
    const value = input?.value || "";
    output.textContent = "Loading...";
    try {
      const res = await fetch(`/hello?name=${encodeURIComponent(value)}`);
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const temp = document.createElement("div");
      temp.innerHTML = html;
      const newEl = temp.firstElementChild;
      if (newEl && newEl.id === "hello-output") {
        output.innerHTML = newEl.innerHTML;
      } else {
        output.textContent = html;
      }
    } catch (err) {
      output.textContent = `Error: ${err.message}`;
    }
  });
}
function setupSessionsSSE() {
  const statusEl = document.getElementById("sessions-status");
  const listEl = document.getElementById("sessions-ul");
  if (!statusEl || !listEl)
    return;
  const es = new EventSource("/sessions/stream");
  es.addEventListener("open", () => {
    statusEl.textContent = "Connected";
  });
  es.addEventListener("error", () => {
    statusEl.textContent = "Error / reconnecting";
  });
  es.addEventListener("sessions", (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      const arr = Array.isArray(payload.sessions) ? payload.sessions : [];
      listEl.innerHTML = arr.length ? arr.map((s) => `<li><a href='/session/${s.id}'><span class='id'>${s.id}</span></a> - ${s.title || "(no title)"}</li>`).join("") : "<li>(none)</li>";
      statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      statusEl.textContent = `Bad data: ${e.message}`;
    }
  });
}
function setupCreateSession() {
  const form = document.getElementById("create-session-form");
  const titleInput = document.getElementById("new-session-title");
  const resultEl = document.getElementById("create-session-result");
  if (!form || !titleInput || !resultEl)
    return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim() || "calc-session";
    resultEl.textContent = "Creating...";
    try {
      const res = await fetch("/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const json = await res.json();
      if (!json.ok)
        throw new Error(json.error || `HTTP ${res.status}`);
      resultEl.textContent = `Created session: ${json.id}`;
    } catch (err) {
      resultEl.textContent = `Error: ${err.message}`;
    }
  });
}
function setupSessionMessageForm() {
  const sid = window.__SESSION_ID__;
  if (!sid)
    return;
  const form = document.getElementById("session-message-form");
  const input = document.getElementById("session-message-input");
  const result = document.getElementById("session-message-result");
  if (!form || !input || !result)
    return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      result.textContent = "Enter text";
      return;
    }
    result.textContent = "Sending...";
    try {
      const res = await fetch(`/session/${sid}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const json = await res.json();
      if (!json.ok)
        throw new Error(json.error || `HTTP ${res.status}`);
      const parts = Array.isArray(json.parts) ? json.parts.filter((p) => p.type === "text").map((p) => p.text).join(`
`) : "(no parts)";
      result.textContent = `Reply: ${parts}`;
      input.value = "";
    } catch (err) {
      result.textContent = `Error: ${err.message}`;
    }
  });
}
function setupMessagesSSE() {
  const sid = window.__SESSION_ID__;
  if (!sid)
    return;
  const statusEl = document.getElementById("messages-status");
  const listEl = document.getElementById("messages-list");
  if (!statusEl || !listEl)
    return;
  const es = new EventSource(`/session/${sid}/messages/stream`);
  es.addEventListener("open", () => {
    statusEl.textContent = "Connected";
  });
  es.addEventListener("error", () => {
    statusEl.textContent = "Error / reconnecting";
  });
  es.addEventListener("messages", (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      const arr = Array.isArray(payload.messages) ? payload.messages : [];
      listEl.innerHTML = arr.length ? arr.map((m) => `<div class="message"><div class="message-role">${m.role || "message"}</div><div class="message-text">${(m.parts?.[0]?.text || m.text || "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c)}</div></div>`).join("") : "<div>(no messages)</div>";
      statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      statusEl.textContent = `Bad data: ${e.message}`;
    }
  });
}
function init() {
  setupHelloForm();
  setupSessionsSSE();
  setupCreateSession();
  setupMessagesSSE();
  setupSessionMessageForm();
}
init();
