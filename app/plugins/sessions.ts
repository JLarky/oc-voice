// app/plugins/sessions.ts - Elysia sessions routes plugin (prototype)
import { Elysia } from "elysia";
import { listSessions, createSession } from "../../domain/sessions";
import {
  deleteSession,
  shareSession,
  unshareSession,
  clearSessions,
} from "../../domain/sessions-extra";

export const sessionsPlugin = (ipStore: string[]) =>
  new Elysia({ name: "sessions" })
    .get("/sessions/:ip", async ({ params }) => {
      const ip = params.ip;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const list = await listSessions(base);
      return { ok: true, ip, count: list.length, sessions: list };
    })
    .get("/sessions/:ip/stream", ({ params }) => {
      const ip = params.ip;
      if (!ipStore.includes(ip))
        return new Response("Unknown IP", { status: 404 });
      const stream = new ReadableStream({
        start(controller) {
          async function push() {
            try {
              const base = `http://${ip}:2000`;
              const list = await listSessions(base).catch(() => []);
              const status = `event: datastar-patch-elements\ndata: elements <div id=\"sessions-status\" class=\"status\">Updated ${new Date().toLocaleTimeString()}<\\/div>\n\n`;
              let listHtml = '<div id="sessions-list"><ul id="sessions-ul">';
              if (!list.length)
                listHtml += '<li class="empty">(no sessions)</li>';
              for (const s of list) {
                const id = (s as any)?.id;
                const title = (s as any)?.title || "(no title)";
                if (typeof id === "string" && id)
                  listHtml += `<li><a href=\"/sessions/${ip}/${id}\"><span class=\"id\">${id}</span></a> - ${title}</li>`;
              }
              listHtml += "</ul></div>";
              const sessionsEvent = `event: datastar-patch-elements\ndata: elements ${listHtml.replace(/\n/g, "")}\n\n`;
              controller.enqueue(new TextEncoder().encode(status));
              controller.enqueue(new TextEncoder().encode(sessionsEvent));
            } catch {
              controller.close();
            }
          }
          push();
          const interval = setInterval(push, 5000);
          (controller as any).interval = interval;
        },
        cancel() {
          const interval = (this as any).interval;
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
    })
    .post("/sessions/:ip/create", async ({ params, body }) => {
      const ip = params.ip;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const rawTitle = (body as any)?.title;
      const title =
        typeof rawTitle === "string" && rawTitle.trim()
          ? rawTitle.trim()
          : "new session";
      const base = `http://${ip}:2000`;
      const result = await createSession(base, title);
      return { ...result, ip, title };
    })
    // Legacy alias: /sessions/:ip/create-session
    .post("/sessions/:ip/create-session", async ({ params, body }) => {
      const ip = params.ip;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const rawTitle = (body as any)?.title;
      const title =
        typeof rawTitle === "string" && rawTitle.trim()
          ? rawTitle.trim()
          : "new session";
      const base = `http://${ip}:2000`;
      const result = await createSession(base, title);
      return { ...result, ip, title, legacy: true };
    })
    .post("/sessions/:ip/:sid/delete", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await deleteSession(base, sid);
      return { ...res, ip, sid };
    })
    // Legacy alias: /sessions/:ip/:sid/delete-session
    .post("/sessions/:ip/:sid/delete-session", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await deleteSession(base, sid);
      return { ...res, ip, sid, legacy: true };
    })
    .post("/sessions/:ip/:sid/share", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await shareSession(base, sid);
      return { ...res, ip, sid };
    })
    // Legacy alias: /sessions/:ip/:sid/share-session
    .post("/sessions/:ip/:sid/share-session", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await shareSession(base, sid);
      return { ...res, ip, sid, legacy: true };
    })
    .post("/sessions/:ip/:sid/unshare", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await unshareSession(base, sid);
      return { ...res, ip, sid };
    })
    // Legacy alias: /sessions/:ip/:sid/unshare-session
    .post("/sessions/:ip/:sid/unshare-session", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await unshareSession(base, sid);
      return { ...res, ip, sid, legacy: true };
    })
    .post("/sessions/:ip/clear", async ({ params }) => {
      const ip = (params as any).ip;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const list = await listSessions(base);
      const ids = list
        .map((s) => s.id)
        .filter((id) => typeof id === "string" && id);
      const res = await clearSessions(base, ids);
      return { ...res, ip };
    })
    // Legacy alias: /sessions/:ip/clear-sessions
    .post("/sessions/:ip/clear-sessions", async ({ params }) => {
      const ip = (params as any).ip;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const list = await listSessions(base);
      const ids = list
        .map((s) => s.id)
        .filter((id) => typeof id === "string" && id);
      const res = await clearSessions(base, ids);
      return { ...res, ip, legacy: true };
    });
