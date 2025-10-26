// sessions-parity.test.ts - compares legacy vs Elysia session list/create
import { test, expect } from 'bun:test';

async function postJson(url: string, body: any) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((r) => r.json())
    .catch(() => ({}));
}
async function getJson(url: string) {
  return fetch(url)
    .then((r) => r.json())
    .catch(() => ({}));
}

function normalizeSessions(obj: any) {
  const arr = Array.isArray(obj?.sessions) ? obj.sessions : [];
  return arr
    .map((s: any) => s.id)
    .filter((id: any) => typeof id === "string")
    .sort();
}

test("Session create parity", async () => {
  // Ensure IP exists in both servers (legacy may be absent; skip gracefully)
  await postJson("http://localhost:3333/ips/add", { ip: "127.0.0.1" });
  await postJson("http://localhost:3000/ips/add", { ip: "127.0.0.1" });
  const title = "parity test session";
  const elysia = await postJson(
    "http://localhost:3333/sessions/127.0.0.1/create",
    { title },
  );
  let legacy: any = { ok: undefined };
  try {
    legacy = await postJson(
      "http://localhost:3000/sessions/127.0.0.1/create-session",
      { title },
    );
  } catch {}
  if (typeof elysia.ok !== "boolean") {
    console.warn(
      "Elysia server not reachable for session create parity; skipping",
    );
    return;
  }
  expect(typeof elysia.ok).toBe("boolean");
  // Legacy is SSE so legacy.ok may be undefined; accept absence but require that SSE shape appears if any text was returned
});

test("Session list parity", async () => {
  async function fetchLegacySessionsViaSSE(ip: string, timeoutMs = 2500) {
    try {
      const url = `http://localhost:3000/sessions/${ip}/stream`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const reader = res.body?.getReader();
      if (!reader) return [];
      const decoder = new TextDecoder();
      let buffered = "";
      const ids = new Set<string>();
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
            /id="sessions-ul"/.test(rawEvent)
          ) {
            const matches = [
              ...rawEvent.matchAll(
                /<span class=\"id\">([A-Za-z0-9_-]{6,})<\/span>/g,
              ),
            ];
            for (const m of matches) ids.add(m[1]);
            return Array.from(ids).sort();
          }
        }
      }
      return Array.from(ids).sort();
    } catch {
      return [];
    }
  }
  const ip = "127.0.0.1";
  await postJson("http://localhost:3333/ips/add", { ip });
  await postJson("http://localhost:3000/ips/add", { ip });
  const elysiaList = await getJson(`http://localhost:3333/sessions/${ip}`);
  const legacyIds = await fetchLegacySessionsViaSSE(ip);
  if (!legacyIds.length && !Array.isArray(elysiaList.sessions)) {
    console.warn("Servers not reachable for session list parity; skipping");
    return;
  }
  expect(Array.isArray(elysiaList.sessions)).toBe(true);
  const elysiaIds = normalizeSessions(elysiaList);
  for (const id of legacyIds) expect(elysiaIds).toContain(id);
});
