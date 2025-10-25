// server.ts - Bun HTTP server serving index.html, bundled client, and API endpoints

const port = 3000;

// In-memory cache of sessions (dummy list initially); will sync with opencode server if reachable
import { createOpencodeClient } from "@opencode-ai/sdk";

interface SessionInfo {
  id: string;
  title?: string;
  createdAt: number;
}

let sessions: SessionInfo[] = [
  { id: "dummy-1", title: "Example Session 1", createdAt: Date.now() },
  { id: "dummy-2", title: "Example Session 2", createdAt: Date.now() },
];

async function refreshSessionsFromSDK() {
  try {
    const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" });
    const remote = await client.session.list();
    if (Array.isArray(remote)) {
      sessions = remote.map(r => ({ id: r.id, title: r.title, createdAt: Date.now() }));
    }
  } catch (e) {
    // ignore errors; keep existing dummy list
  }
}

// Helper to produce JSON-friendly list
function sessionList() {
  return sessions.map(s => ({ id: s.id, title: s.title, ageSeconds: Math.round((Date.now() - s.createdAt) / 1000) }));
}

// Periodically try syncing sessions
setInterval(refreshSessionsFromSDK, 5000);

// SSE stream: pushes updated list every 5 seconds
function sessionsSSE(): Response {
  const stream = new ReadableStream({
    start(controller) {
      function push() {
        const data = JSON.stringify({ sessions: sessionList(), updatedAt: new Date().toISOString() });
        controller.enqueue(new TextEncoder().encode(`event: sessions\n`));
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
      }
      push();
      const interval = setInterval(push, 5000);
      (controller as any)._interval = interval; // store reference
    },
    cancel() {
      const interval = (this as any)._interval;
      if (interval) clearInterval(interval);
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    // Existing /hello endpoint
    if (url.pathname === "/hello") {
      const raw = url.searchParams.get("name") ?? "";
      if (!raw.trim()) {
        return new Response(`<div id=\"hello-output\">(enter a question)</div>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const REMOTE_HOST_PORT = 2000; const REMOTE_HOST_IP = process.argv[2] || process.env.REMOTE_HOST_IP || "127.0.0.1"; const REMOTE_HOST = `http://${REMOTE_HOST_IP}:${REMOTE_HOST_PORT}`;
      try {
        // Create session
        const sessionRes = await fetch(`${REMOTE_HOST}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "web-echo-session" }),
        });
        if (!sessionRes.ok) throw new Error(`session ${sessionRes.status}`);
        const { id: sessionId } = await sessionRes.json();
        // Send message
        const msgRes = await fetch(`${REMOTE_HOST}/session/${sessionId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parts: [{ type: "text", text: raw }] }),
        });
        if (!msgRes.ok) throw new Error(`message ${msgRes.status}`);
        const msgData = await msgRes.json();
        const parts = Array.isArray(msgData.parts) ? msgData.parts.filter((p) => p.type === "text" && typeof p.text === "string") : [];
        const answerText = parts.map((p) => p.text).join("\n") || "(no answer)";
        const escaped = answerText.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]!));
        return new Response(`<div id=\"hello-output\"><strong>Answer:</strong> ${escaped}</div>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch (err) {
        const msg = (err as Error).message.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]!));
        return new Response(`<div id=\"hello-output\">Error contacting ${REMOTE_HOST}: ${msg}</div>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    }

    // Simple JSON hello
    if (url.pathname === "/api/hello") {
      return Response.json({ message: "Hello from Bun server!" });
    }

    // SSE stream of sessions
    if (url.pathname === "/sessions/stream") {
      return sessionsSSE();
    }

    // Create a new real session via SDK and add to cache
    if (url.pathname === "/create-session" && req.method === "POST") {
      try {
        const bodyText = await req.text();
        let title = "calc-session";
        if (bodyText) {
          try { const parsed = JSON.parse(bodyText); if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title.trim(); } catch { /* ignore */ }
        }
        const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" });
        const created = await client.session.create({ body: { title } });
        const newId = created.id || `local-${Date.now()}`;
        sessions.push({ id: newId, title: created.title || title, createdAt: Date.now() });
        return Response.json({ ok: true, id: newId, title: created.title || title });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    // Serve built client bundle
    if (url.pathname === "/client.js") {
      return new Response(Bun.file("public/client.js"), {
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }

    // Serve index
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("index.html"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${port}`);
export { server };
