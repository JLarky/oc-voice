// server.ts - Bun HTTP server serving index.html, bundled client, and API endpoints

const port = 3000;

import { createOpencodeClient } from "@opencode-ai/sdk";

// Get the remote host from command line arg or env var (e.g., 192.168.215.4)
const REMOTE_HOST_IP = process.argv[2] || process.env.REMOTE_HOST_IP || "127.0.0.1";
const OPENCODE_BASE_URL = `http://${REMOTE_HOST_IP}:2000`;

// Fetch sessions fresh each push; no in-memory cache retained
async function fetchSessions() {
  try {
    const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
    const remote = await client.session.list();
    console.log('SDK session.list raw:', remote);
    if (Array.isArray(remote)) {
      return remote.map(r => ({ id: r.id, title: r.title }));
    }
    // Handle possible wrapped shape { data: [...] } or { sessions: [...] }
    if (remote && typeof remote === 'object') {
      const arr = (remote as any).data || (remote as any).sessions;
      if (Array.isArray(arr)) {
        return arr.map((r: any) => ({ id: r.id, title: r.title }));
      }
    }
    return [] as { id: string; title?: string }[];
  } catch (e) {
    console.error("Failed to list sessions via SDK", (e as Error).message);
    return [];
  }
}

// SSE stream: queries SDK every 5s
function sessionsSSE(): Response {
  let interval: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        const list = await fetchSessions();
        const data = JSON.stringify({
          sessions: list,
          updatedAt: new Date().toISOString(),
        });
        controller.enqueue(new TextEncoder().encode(`event: sessions\n`));
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
      }
      await push();
      interval = setInterval(push, 5000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
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
        return new Response(
          `<div id=\"hello-output\">(enter a question)</div>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
      const REMOTE_HOST_PORT = 2000;
      const REMOTE_HOST = `http://${REMOTE_HOST_IP}:${REMOTE_HOST_PORT}`;
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
        const msgRes = await fetch(
          `${REMOTE_HOST}/session/${sessionId}/message`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parts: [{ type: "text", text: raw }] }),
          }
        );
        if (!msgRes.ok) throw new Error(`message ${msgRes.status}`);
        const msgData = await msgRes.json();
        const parts = Array.isArray(msgData.parts)
          ? msgData.parts.filter(
              (p) => p.type === "text" && typeof p.text === "string"
            )
          : [];
        const answerText = parts.map((p) => p.text).join("\n") || "(no answer)";
        const escaped = answerText.replace(
          /[&<>\"]/g,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)
        );
        return new Response(
          `<div id=\"hello-output\"><strong>Answer:</strong> ${escaped}</div>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      } catch (err) {
        const msg = (err as Error).message.replace(
          /[&<>\"]/g,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)
        );
        return new Response(
          `<div id=\"hello-output\">Error contacting ${REMOTE_HOST}: ${msg}</div>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
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

    // Create a new session via SDK (no local storage)
    if (url.pathname === "/create-session" && req.method === "POST") {
      try {
        const bodyText = await req.text();
        let title = "calc-session";
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title.trim();
          } catch { /* ignore */ }
        }
        const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
        const created = await client.session.create({ body: { title } });
        return Response.json({ ok: true, id: created.id, title: created.title || title });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    // Session detail and message routes
    if (url.pathname.startsWith("/session/")) {
      const parts = url.pathname.split("/").filter(Boolean); // ["session", id, maybe 'message']
      if (parts.length === 2 && req.method === "GET") {
        const sid = parts[1];
        // Validate session exists using SDK get; fallback to list
        try {
          const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
          let exists = false;
          // Try direct get (if available on SDK)
          try {
            const detail = await (client as any).session.get?.({ params: { id: sid } });
            if (detail && detail.id === sid) exists = true;
          } catch { /* ignore */ }
          // Raw endpoint fetch fallback if still not exists
          if (!exists) {
            try {
              const rawRes = await fetch(`${OPENCODE_BASE_URL}/session/${sid}`);
              if (rawRes.ok) {
                const rawJson = await rawRes.json().catch(() => null);
                if (rawJson && rawJson.id === sid) exists = true;
              }
            } catch { /* ignore */ }
          }
          // Fallback to list if still not confirmed
          if (!exists) {
            try {
              const list = await client.session.list();
              exists = Array.isArray(list) && list.some((s: any) => s.id === sid);
            } catch { /* ignore */ }
          }
          if (!exists) return Response.redirect("/", 302);
        } catch { /* ignore outer */ }
        const page = `<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\"/><title>Session ${sid}</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /><style>body{font-family:system-ui,sans-serif;margin:1.5rem;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .small{font-size:.75rem;color:#666;} a{color:#0366d6;text-decoration:none;} a:hover{text-decoration:underline;} </style></head><body><h1>Session ${sid}</h1><div><a href=\"/\">&larr; Back to sessions</a></div><form id=\"session-message-form\"><div class=\"row\"><input id=\"session-message-input\" type=\"text\" placeholder=\"Enter message\" /><button type=\"submit\">Send</button></div><div id=\"session-message-result\" class=\"small\"></div></form><script>window.__SESSION_ID__='${sid}';</script><script type=\"module\" src=\"/client.js\"></script></body></html>`;
        return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (parts.length === 3 && parts[2] === "message" && req.method === "POST") {
        const sid = parts[1];
        const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
        const list = await client.session.list();
        const exists = Array.isArray(list) && list.some(s => s.id === sid);
        if (!exists) return Response.json({ ok: false, error: "Session not found" }, { status: 404 });
        try {
          const bodyText = await req.text();
            let text = "";
            if (bodyText) {
              try {
                const parsed = JSON.parse(bodyText);
                if (typeof parsed.text === "string") text = parsed.text.trim();
              } catch { /* ignore */ }
            }
            if (!text) return Response.json({ ok: false, error: "No text" }, { status: 400 });
            console.log('Sending remote message via SDK', { sid, text });
            try {
              const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
              const reply = await client.session.prompt({
                params: { id: sid },
                body: { parts: [{ type: "text", text }] }
              });
              const textParts = Array.isArray(reply.parts)
                ? reply.parts.filter(p => p.type === "text" && typeof p.text === "string")
                : [];
              return Response.json({ ok: true, parts: textParts });
            } catch (err) {
              console.error('SDK prompt error', (err as Error).message);
              return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
            }
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
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
