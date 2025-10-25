// server.ts - Bun HTTP server serving index.html, bundled client, and an API endpoint

const port = 3000;

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

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

    if (url.pathname === "/api/hello") {
      return Response.json({ message: "Hello from Bun server!" });
    }

    if (url.pathname === "/client.js") {
      return new Response(Bun.file("public/client.js"), {
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }

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
