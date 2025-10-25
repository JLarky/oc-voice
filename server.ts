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
        /* ignore */
      }
    }
    return list;
  } catch (e) {
    console.error("Failed to list sessions", (e as Error).message);
    return [];
  }
}

// Helper to escape HTML
function escapeHtml(text: string): string {
  if (!text || typeof text !== "string") {
    return String(text || "");
  }
  return text.replace(
    /[&<>"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[c]!)
  );
}

// Helper to build SSE response with datastar-patch-elements event
function sendDatastarPatchElements(html: string): string {
  const lines = html.split("\n");
  let result = "event: datastar-patch-elements\n";
  lines.forEach((line) => {
    result += `data: elements ${line}\n`;
  });
  result += "\n";
  return result;
}

// SSE stream: queries fresh data every 5s (no caching)
function sessionsSSE(): Response {
  let interval: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        const list = await fetchSessionsFresh();
        // Build HTML patch for sessions list
        const sessionItems = list.length
          ? list
              .map(
                (s: any) =>
                  `<li><a href="/session/${s.id}"><span class="id">${escapeHtml(
                    s.id
                  )}</span></a> - ${escapeHtml(s.title || "(no title)")}</li>`
              )
              .join("")
          : '<li class="empty">(no sessions)</li>';
        const html = `<ul id="sessions-ul">${sessionItems}</ul>`;
        const statusHtml = `<div id="sessions-status" class="status">Updated ${new Date().toLocaleTimeString()}</div>`;

        // Send both patches
        controller.enqueue(
          new TextEncoder().encode(sendDatastarPatchElements(statusHtml))
        );
        controller.enqueue(
          new TextEncoder().encode(sendDatastarPatchElements(html))
        );
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
        // Build HTML patch for messages list
        const messageItems = messages.length
          ? messages
              .map((m: any) => {
                const role = escapeHtml(m.role || "message");
                const text = escapeHtml(m.parts?.[0]?.text || m.text || "");
                return `<div class="message"><div class="message-role">${role}</div><div class="message-text">${text}</div></div>`;
              })
              .join("")
          : '<div class="empty">(no messages)</div>';
        const html = `<div id="messages-list">${messageItems}</div>`;
        const statusHtml = `<div id="messages-status" class="status">Updated ${new Date().toLocaleTimeString()}</div>`;

        controller.enqueue(
          new TextEncoder().encode(sendDatastarPatchElements(statusHtml))
        );
        controller.enqueue(
          new TextEncoder().encode(sendDatastarPatchElements(html))
        );
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

    // /hello endpoint: POST with name, returns HTML
    if (url.pathname === "/hello" && req.method === "POST") {
      try {
        const bodyText = await req.text();
        let name = "";
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            if (typeof parsed.name === "string" && parsed.name.trim())
              name = parsed.name.trim();
          } catch {
            /* ignore */
          }
        }
        if (!name) {
          return new Response(
            sendDatastarPatchElements(
              `<div id="hello-output" class="result empty">(enter a question)</div>`
            ),
            { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
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
              body: JSON.stringify({
                parts: [{ type: "text", text: name }],
              }),
            }
          );
          if (!msgRes.ok) throw new Error(`message ${msgRes.status}`);
          const msgData = await msgRes.json();
          const parts = Array.isArray(msgData.parts)
            ? msgData.parts.filter(
                (p: any) => p.type === "text" && typeof p.text === "string"
              )
            : [];
          const answerText =
            parts.map((p: any) => p.text).join("\n") || "(no answer)";
          const escaped = escapeHtml(answerText);
          const html = `<div id="hello-output" class="result"><strong>Answer:</strong> ${escaped}</div>`;
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        } catch (err) {
          const msg = escapeHtml(
            `Error contacting ${REMOTE_HOST}: ${(err as Error).message}`
          );
          const html = `<div id="hello-output" class="result">${msg}</div>`;
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        }
      } catch (err) {
        const msg = escapeHtml((err as Error).message);
        const html = `<div id="hello-output" class="result">Error: ${msg}</div>`;
        return new Response(sendDatastarPatchElements(html), {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
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
        let created: any;
        try {
          created = await client.session.create({ body: { title } });
          console.log("SDK session.create raw:", created);
        } catch (e) {
          console.warn(
            "SDK create failed, trying raw endpoint:",
            (e as Error).message
          );
          // Fallback to raw HTTP
          const rawRes = await fetch(`${OPENCODE_BASE_URL}/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          });
          if (!rawRes.ok) throw new Error(`Create ${rawRes.status}`);
          created = await rawRes.json();
        }

        // Extract session ID from response (handle nested structures)
        let sessionId = (created as any)?.id;
        if (!sessionId) {
          const data = (created as any)?.data || created;
          sessionId = data?.id;
        }
        if (!sessionId || typeof sessionId !== "string") {
          throw new Error(
            `Session creation returned invalid ID: ${JSON.stringify(created)}`
          );
        }

        // Inject into ephemeral cache immediately
        const entry = {
          id: sessionId,
          title: (created as any)?.title || title,
        };
        const now = Date.now();
        if (cachedSessions) {
          const existingIds = new Set(cachedSessions.list.map((s) => s.id));
          if (!existingIds.has(entry.id)) cachedSessions.list.unshift(entry); // prioritize newest
          cachedSessions.fetchedAt = now; // refresh timestamp
        } else {
          cachedSessions = { list: [entry], fetchedAt: now };
        }
        const html = `<div id="create-session-result" class="result">Created session: <a href="/session/${escapeHtml(
          entry.id
        )}">${escapeHtml(entry.id)}</a></div>`;
        return new Response(sendDatastarPatchElements(html), {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
      } catch (e) {
        const msg = escapeHtml((e as Error).message);
        const html = `<div id="create-session-result" class="result">Error: ${msg}</div>`;
        return new Response(sendDatastarPatchElements(html), {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
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

        const page = `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Session ${escapeHtml(
          sid
        )}</title><meta name="viewport" content="width=device-width,initial-scale=1" /><style>body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:900px;margin-left:auto;margin-right:auto;} a{color:#0366d6;} input,button{padding:.5rem;font-size:.95rem;border:1px solid #ccc;border-radius:3px;} button{background:#0366d6;color:white;cursor:pointer;border:none;} button:hover{background:#0256c7;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .status{font-size:.75rem;color:#666;margin-bottom:1rem;} .result{font-size:.75rem;color:#666;margin-top:.5rem;} #messages-list{border:1px solid #ddd;padding:1rem;border-radius:4px;margin-top:1rem;max-height:400px;overflow-y:auto;} .message{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} .message-role{font-weight:bold;color:#0366d6;} .message-text{margin-top:.25rem;white-space:pre-wrap;word-break:break-word;} </style></head><body><h1>Session ${escapeHtml(
          sid
        )}</h1><div><a href="/">&larr; Back to sessions</a></div><h2>Messages</h2><div id="messages-status" class="status">Connecting...</div><div id="messages-list"><div>(loading)</div></div><h2>Send Message</h2><form id="session-message-form" data-on:submit="@post('/session/${escapeHtml(
          sid
        )}/message', { text: $el.querySelector('#session-message-input').value })"><div class="row"><input id="session-message-input" type="text" placeholder="Enter message" /><button type="submit">Send</button></div><div id="session-message-result" class="result"></div></form><script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"><\/script><script>setInterval(() => { fetch('/session/${escapeHtml(
          sid
        )}/messages/stream').then(r => r.body.getReader().read()).catch(e => console.error(e)); }, 100);<\/script></body></html>`;
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
            return new Response(
              sendDatastarPatchElements(
                `<div id="session-message-result" class="result">No text</div>`
              ),
              {
                headers: { "Content-Type": "text/event-stream; charset=utf-8" },
              }
            );
          console.log("Message send start", { sid, text });
          const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
          let reply: any;
          try {
            reply = await (client as any).session.prompt?.({
              params: { id: sid },
              body: { parts: [{ type: "text", text }] },
            });
          } catch (sdkErr) {
            console.warn(
              "SDK prompt error, trying raw endpoint",
              (sdkErr as Error).message
            );
            const rawRes = await fetch(
              `${OPENCODE_BASE_URL}/session/${sid}/message`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parts: [{ type: "text", text }] }),
              }
            );
            if (rawRes.status === 404) {
              return new Response(
                sendDatastarPatchElements(
                  `<div id="session-message-result" class="result">Session not found</div>`
                ),
                {
                  headers: {
                    "Content-Type": "text/event-stream; charset=utf-8",
                  },
                  status: 404,
                }
              );
            }
            if (!rawRes.ok) {
              const detail = await rawRes.text().catch(() => "");
              const msg = escapeHtml(detail || `HTTP ${rawRes.status}`);
              return new Response(
                sendDatastarPatchElements(
                  `<div id="session-message-result" class="result">Error: ${msg}</div>`
                ),
                {
                  headers: {
                    "Content-Type": "text/event-stream; charset=utf-8",
                  },
                  status: rawRes.status,
                }
              );
            }
            reply = await rawRes.json().catch(() => ({}));
          }
          if (
            !reply ||
            (reply.error && /not\s+found/i.test(String(reply.error)))
          ) {
            return new Response(
              sendDatastarPatchElements(
                `<div id="session-message-result" class="result">Session not found</div>`
              ),
              {
                headers: { "Content-Type": "text/event-stream; charset=utf-8" },
                status: 404,
              }
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
          const replyText = textParts.map((p: any) => p.text).join("\n");
          const escaped = escapeHtml(replyText || "(no reply)");
          const html = `<div id="session-message-result" class="result">Reply: ${escaped}</div>`;
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        } catch (err) {
          console.error("Message route error", (err as Error).message);
          const msg = escapeHtml((err as Error).message);
          const html = `<div id="session-message-result" class="result">Error: ${msg}</div>`;
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            status: 500,
          });
        }
      }
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
