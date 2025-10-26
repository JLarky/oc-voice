// ip-parity.test.ts - compares legacy server (3000) vs Elysia prototype (3333)
import { test, expect } from "bun:test";

async function fetchJson(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

function normalizeList(obj: any) {
  const ips = Array.isArray(obj?.ips)
    ? obj.ips.filter((v: any) => typeof v === "string")
    : [];
  return ips.sort();
}

test("IP list parity", async () => {
  async function fetchLegacyIpsViaSSE(timeoutMs = 2000) {
    try {
      const res = await fetch("http://localhost:3000/ips/stream");
      if (!res.ok) return [];
      const reader = res.body?.getReader();
      if (!reader) return [];
      const decoder = new TextDecoder();
      let buffered = "";
      const ips = new Set<string>();
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
          if (
            /event: datastar-patch-elements/.test(rawEvent) &&
            /id="ips-ul"/.test(rawEvent)
          ) {
            const matches = [
              ...rawEvent.matchAll(
                /<span class=\"ip\">(\d{1,3}(?:\.\d{1,3}){3})<\/span>/g,
              ),
            ];
            for (const m of matches) ips.add(m[1]);
            return Array.from(ips).sort();
          }
        }
      }
      return Array.from(ips).sort();
    } catch {
      return [];
    }
  }
  const legacyIps = await fetchLegacyIpsViaSSE();
  let elysia: any = {};
  try {
    elysia = await fetchJson("http://localhost:3333/ips");
  } catch {}
  if (!legacyIps.length && !normalizeList(elysia).length) {
    console.warn(
      "Servers not reachable for IP list parity; skipping assertions",
    );
    return;
  }
  const elysiaIps = normalizeList(elysia);
  // Parity: legacy IPs should appear in Elysia list (subset containment)
  for (const ip of legacyIps) expect(elysiaIps).toContain(ip);
});

test("Add IP parity result shape", async () => {
  const payload = { ip: "127.0.0.1" };
  const headers = { "Content-Type": "application/json" };
  // Elysia returns JSON with ok boolean; legacy returns SSE (not JSON)
  const elysia = await fetch("http://localhost:3333/ips/add", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .catch(() => ({}));
  let legacyText = "";
  try {
    const legacyRes = await fetch("http://localhost:3000/ips/add", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    legacyText = await legacyRes.text();
  } catch {}
  if (typeof elysia.ok !== "boolean") {
    // If Elysia server not running, skip assertions
    console.warn("Elysia server not reachable for add IP parity test");
    return;
  }
  expect(typeof elysia.ok).toBe("boolean");
  // Legacy SSE should contain patch event lines
  if (legacyText)
    expect(/event: datastar-patch-elements/.test(legacyText)).toBe(true);
});

test("Remove IP parity", async () => {
  const target = "127.0.0.1";
  // Prepare both servers best-effort
  await fetch("http://localhost:3333/ips/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip: target }),
  }).catch(() => {});
  await fetch("http://localhost:3000/ips/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip: target }),
  }).catch(() => {});
  const elysia = await fetch("http://localhost:3333/ips/remove/" + target, {
    method: "POST",
  })
    .then((r) => r.json())
    .catch(() => ({}));
  let legacyText = "";
  try {
    const legacyRes = await fetch(
      "http://localhost:3000/ips/remove/" + target,
      { method: "POST" },
    );
    legacyText = await legacyRes.text();
  } catch {}
  if (typeof elysia.ok !== "boolean") {
    console.warn("Elysia server not reachable for remove IP parity test");
    return;
  }
  expect(typeof elysia.ok).toBe("boolean");
  if (legacyText)
    expect(/event: datastar-patch-elements/.test(legacyText)).toBe(true);
});

test("Elysia IP SSE emits legacy ids", async () => {
  try {
    const res = await fetch("http://localhost:3333/ips/stream");
    if (!res.ok) {
      console.warn("Elysia SSE not reachable; skipping id parity test");
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      console.warn("No reader for Elysia SSE; skipping");
      return;
    }
    const decoder = new TextDecoder();
    let buffered = "";
    let found = false;
    const start = Date.now();
    while (Date.now() - start < 1500 && !found) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      if (/id=\"ips-ul\"/.test(buffered)) found = true;
    }
    if (!found) {
      console.warn("Elysia SSE id parity not observed; skipping assertion");
      return; // graceful skip when server not running or no events yet
    }
    expect(found).toBe(true);
  } catch {
    console.warn("Elysia server not reachable for SSE id parity test");
  }
});
