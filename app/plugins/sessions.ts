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
    .post("/sessions/:ip/:sid/delete", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await deleteSession(base, sid);
      return { ...res, ip, sid };
    })
    .post("/sessions/:ip/:sid/share", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await shareSession(base, sid);
      return { ...res, ip, sid };
    })
    .post("/sessions/:ip/:sid/unshare", async ({ params }) => {
      const { ip, sid } = params as any;
      if (!ipStore.includes(ip)) return { ok: false, error: "unknown ip" };
      const base = `http://${ip}:2000`;
      const res = await unshareSession(base, sid);
      return { ...res, ip, sid };
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
    });
