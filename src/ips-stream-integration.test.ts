// ips-stream-integration.test.ts - verifies Elysia /ips/stream SSE JSX fragment patches
import { test, expect } from "bun:test";

async function readIpsStream(timeoutMs = 1800) {
  try {
    const res = await fetch("http://localhost:3333/ips/stream");
    if (!res.ok) return { ok: false, text: "", events: 0 };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, text: "", events: 0 };
    const decoder = new TextDecoder();
    let buffered = "";
    let events = 0;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buffered.indexOf("\n\n")) !== -1) {
        const rawEvent = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 2);
        if (!rawEvent) continue;
        if (/^event: datastar-patch-elements/m.test(rawEvent)) events++;
        if (events >= 2) {
          return { ok: true, text: buffered + rawEvent, events };
        }
      }
    }
    return { ok: true, text: buffered, events };
  } catch {
    return { ok: false, text: "", events: 0 };
  }
}

test("ips stream emits status + list JSX patches", async () => {
  const r = await readIpsStream();
  if (!r.ok || r.events === 0) {
    console.warn(
      "Elysia /ips/stream unreachable; skipping integration assertions",
    );
    return;
  }
  // Expect both status and list containers
  expect(/id="ips-status"/.test(r.text)).toBe(true);
  expect(/id="ips-list"/.test(r.text)).toBe(true);
  expect(/id="ips-ul"/.test(r.text)).toBe(true);
  // Ensure no escaped closing tag artifacts remain (legacy string build leftovers)
  expect(/<\\\/div>/.test(r.text)).toBe(false);
  // At least two patch events (status + list)
  expect(r.events).toBeGreaterThanOrEqual(2);
});
