// server.ts - Bun HTTP server serving index.html, bundled client, and API endpoints

const port = 3000;

import { createOpencodeClient } from "@opencode-ai/sdk";

// Get the remote host from command line arg or env var (e.g., 192.168.215.4)
const REMOTE_HOST_IP =
  process.argv[2] || process.env.REMOTE_HOST_IP || "127.0.0.1";
const OPENCODE_BASE_URL = `http://${REMOTE_HOST_IP}:2000`;

// Ephemeral in-memory cache (5s TTL) to smooth eventual consistency
interface CachedSessions {
  list: { id: string; title?: string }[];
  fetchedAt: number;
}
let cachedSessions: CachedSessions | null = null;
const SESSIONS_CACHE_TTL_MS = 5000;

// Fetch sessions fresh each push + raw fallback; merges with ephemeral cache
async function fetchSessions() {
  const now = Date.now();
  if (
    cachedSessions &&
    now - cachedSessions.fetchedAt < SESSIONS_CACHE_TTL_MS
  ) {
    return cachedSessions.list;
  }
  try {
    const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
    const remote = await client.session.list();
    console.log("SDK session.list raw:", remote);
    let list: { id: string; title?: string }[] = [];
    if (Array.isArray(remote)) {
      list = remote.map((r) => ({ id: r.id, title: r.title }));
    } else if (remote && typeof remote === "object") {
      const arr = (remote as any).data || (remote as any).sessions;
      if (Array.isArray(arr))
        list = arr.map((r: any) => ({ id: r.id, title: r.title }));
    }
    // Raw fallback if still empty
    if (!list.length) {
      try {
        const rawRes = await fetch(`${OPENCODE_BASE_URL}/session`);
        if (rawRes.ok) {
          const rawJson = await rawRes.json().catch(() => null);
          const rawArr = Array.isArray(rawJson)
            ? rawJson
            : rawJson?.sessions || rawJson?.data;
          if (Array.isArray(rawArr))
            list = rawArr.map((r: any) => ({ id: r.id, title: r.title }));
        }
      } catch {
        /* ignore raw fallback error */
      }
    }
    // Merge with ephemeral cache (avoid duplicates)
    const cacheExisting = cachedSessions?.list || [];
    const mergedMap = new Map<string, { id: string; title?: string }>();
    for (const s of [...list, ...cacheExisting]) {
      if (!mergedMap.has(s.id)) mergedMap.set(s.id, s);
    }
    const merged = Array.from(mergedMap.values());
    cachedSessions = { list: merged, fetchedAt: now };
    return merged;
  } catch (e) {
    console.error("Failed to list sessions via SDK", (e as Error).message);
    return [];
  }
}

// Fetch sessions fresh without caching (for SSE stream)
async function fetchSessionsFresh() {
  try {
    const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
    const remote = await client.session.list();
    let list: { id: string; title?: string }[] = [];
    if (Array.isArray(remote)) {
      list = remote.map((r) => ({ id: r.id, title: r.title }));
    } else if (remote && typeof remote === "object") {
      const arr = (remote as any).data || (remote as any).sessions;
      if (Array.isArray(arr))
        list = arr.map((r: any) => ({ id: r.id, title: r.title }));
    }
    // Raw fallback if still empty
    if (!list.length) {
      try {
        const rawRes = await fetch(`${OPENCODE_BASE_URL}/session`);
        if (rawRes.ok) {
          const rawJson = await rawRes.json().catch(() => null);
          const rawArr = Array.isArray(rawJson)
            ? rawJson
            : rawJson?.sessions || rawJson?.data;
          if (Array.isArray(rawArr))
            list = rawArr.map((r: any) => ({ id: r.id, title: r.title }));
        }
      } catch {
        /* ignore raw fallback error */
      }
    }
    return list;
  } catch (e) {
    console.error("Failed to list sessions", (e as Error).message);
    return [];
  }
}

// SSE stream: queries fresh data every 5s (no caching)
function sessionsSSE(): Response {
  let interval: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        const list = await fetchSessionsFresh();
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

// Fetch messages for a session (no caching)
async function fetchMessages(sessionId: string) {
  try {
    const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
    let messages: any[] = [];

    // Try SDK method first
    try {
      const detail = await (client as any).session.get?.({
        params: { id: sessionId },
      });
      if (detail && Array.isArray(detail.messages)) {
        messages = detail.messages;
      }
    } catch {
      /* ignore */
    }

    // Fallback to raw endpoint if SDK didn't work
    if (!messages.length) {
      try {
        const rawRes = await fetch(`${OPENCODE_BASE_URL}/session/${sessionId}`);
        if (rawRes.ok) {
          const rawJson = await rawRes.json().catch(() => null);
          if (rawJson && Array.isArray(rawJson.messages)) {
            messages = rawJson.messages;
          }
        }
      } catch {
        /* ignore */
      }
    }

    return messages;
  } catch (e) {
    console.error(
      "Failed to fetch messages for session",
      sessionId,
      (e as Error).message
    );
    return [];
  }
}

// SSE stream for messages: queries fresh data every 2s (no caching)
function messagesSSE(sessionId: string): Response {
  let interval: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        const messages = await fetchMessages(sessionId);
        const data = JSON.stringify({
          messages: messages,
          updatedAt: new Date().toISOString(),
        });
        controller.enqueue(new TextEncoder().encode(`event: messages\n`));
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
      }
      await push();
      interval = setInterval(push, 2000);
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

    // SSE stream of messages for a session
    if (
      url.pathname.startsWith("/session/") &&
      url.pathname.endsWith("/messages/stream")
    ) {
      const parts = url.pathname.split("/").filter(Boolean); // ["session", id, "messages", "stream"]
      if (
        parts.length === 4 &&
        parts[2] === "messages" &&
        parts[3] === "stream"
      ) {
        const sid = parts[1];
        return messagesSSE(sid);
      }
    }

    // Create a new session via SDK (no local storage)
    if (url.pathname === "/create-session" && req.method === "POST") {
      try {
        const bodyText = await req.text();
        let title = "calc-session";
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            if (typeof parsed.title === "string" && parsed.title.trim())
              title = parsed.title.trim();
          } catch {
            /* ignore */
          }
        }
        const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
        const created = await client.session.create({ body: { title } });
        // Inject into ephemeral cache immediately
        const entry = { id: created.id, title: created.title || title };
        const now = Date.now();
        if (cachedSessions) {
          const existingIds = new Set(cachedSessions.list.map((s) => s.id));
          if (!existingIds.has(entry.id)) cachedSessions.list.unshift(entry); // prioritize newest
          cachedSessions.fetchedAt = now; // refresh timestamp
        } else {
          cachedSessions = { list: [entry], fetchedAt: now };
        }
        return Response.json({ ok: true, id: entry.id, title: entry.title });
      } catch (e) {
        return Response.json(
          { ok: false, error: (e as Error).message },
          { status: 500 }
        );
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
          console.log("Session page check start", sid);
          // Try direct get (if available on SDK)
          try {
            const detail = await (client as any).session.get?.({
              params: { id: sid },
            });
            if (detail && detail.id === sid) exists = true;
          } catch {
            /* ignore */
          }
          // Raw endpoint fetch fallback if still not exists
          if (!exists) {
            try {
              const rawRes = await fetch(`${OPENCODE_BASE_URL}/session/${sid}`);
              if (rawRes.ok) {
                const rawJson = await rawRes.json().catch(() => null);
                if (rawJson && rawJson.id === sid) exists = true;
              }
            } catch {
              /* ignore */
            }
          }
          // Fallback to list if still not confirmed
          if (!exists) {
            try {
              const list = await client.session.list();
              exists =
                Array.isArray(list) && list.some((s: any) => s.id === sid);
            } catch {
              /* ignore */
            }
          }
          if (!exists) {
            console.log("Session not found after checks", sid);
            return Response.redirect("/", 302);
          }
          console.log("Session exists", sid);
        } catch {
          /* ignore outer */
        }

        const page = `<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\"/><title>Session ${sid}</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /><style>body{font-family:system-ui,sans-serif;margin:1.5rem;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .small{font-size:.75rem;color:#666;} a{color:#0366d6;text-decoration:none;} a:hover{text-decoration:underline;} #messages-list{border:1px solid #ddd;padding:1rem;border-radius:4px;margin-top:1rem;max-height:400px;overflow-y:auto;} .message{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} .message-role{font-weight:bold;} .message-text{margin-top:.25rem;white-space:pre-wrap;} </style></head><body><h1>Session ${sid}</h1><div><a href=\"/\">&larr; Back to sessions</a></div><h2>Messages</h2><div id=\"messages-status\" class=\"small\">Connecting...</div><div id=\"messages-list\"><div>(loading)</div></div><h2>Send Message</h2><form id=\"session-message-form\"><div class=\"row\"><input id=\"session-message-input\" type=\"text\" placeholder=\"Enter message\" /><button type=\"submit\">Send</button></div><div id=\"session-message-result\" class=\"small\"></div></form><script>window.__SESSION_ID__='${sid}';</script><script type=\"module\" src=\"/client.js\"></script></body></html>`;
        return new Response(page, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (
        parts.length === 3 &&
        parts[2] === "message" &&
        req.method === "POST"
      ) {
        const sid = parts[1];
        try {
          const bodyText = await req.text();
          let text = "";
          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText);
              if (typeof parsed.text === "string") text = parsed.text.trim();
            } catch {
              /* ignore */
            }
          }
          if (!text)
            return Response.json(
              { ok: false, error: "No text" },
              { status: 400 }
            );
          console.log("Message send start", { sid, text });
          const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
          let reply: any;
          let usedFallback = false;
          try {
            reply = await client.session.prompt({
              params: { id: sid },
              body: { parts: [{ type: "text", text }] },
            });
          } catch (sdkErr) {
            console.warn(
              "SDK prompt error, trying raw endpoint",
              (sdkErr as Error).message
            );
            usedFallback = true;
            const rawRes = await fetch(
              `${OPENCODE_BASE_URL}/session/${sid}/message`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parts: [{ type: "text", text }] }),
              }
            );
            if (rawRes.status === 404) {
              return Response.json(
                { ok: false, error: "Session not found" },
                { status: 404 }
              );
            }
            if (!rawRes.ok) {
              const detail = await rawRes.text().catch(() => "");
              return Response.json(
                { ok: false, error: `Raw ${rawRes.status}`, detail },
                { status: rawRes.status }
              );
            }
            reply = await rawRes.json().catch(() => ({}));
          }
          if (
            !reply ||
            (reply.error && /not\s+found/i.test(String(reply.error)))
          ) {
            return Response.json(
              { ok: false, error: "Session not found" },
              { status: 404 }
            );
          }
          const sourceParts = Array.isArray(reply.parts)
            ? reply.parts
            : reply.data?.parts || [];
          const textParts = Array.isArray(sourceParts)
            ? sourceParts.filter(
                (p: any) => p && p.type === "text" && typeof p.text === "string"
              )
            : [];
          return Response.json({
            ok: true,
            parts: textParts,
            fallback: usedFallback,
          });
        } catch (err) {
          console.error("Message route error", (err as Error).message);
          return Response.json(
            { ok: false, error: (err as Error).message },
            { status: 500 }
          );
        }
      }
      /* removed duplicate legacy message handler block */
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
