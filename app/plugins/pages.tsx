// app/plugins/pages.ts - SSR pages routes providing HTML parity with legacy Bun server
import { Elysia } from "elysia";
import {
  renderSessionsListPage,
  renderSessionDetailPage,
  renderSessionAdvancedPage,
} from "../../rendering";
import { listSessions } from "../../domain/sessions";

export function pagesPlugin(ipStore: string[]) {
  const resolveBase = (ip: string) => `http://${ip}:2000`;
  return (
    new Elysia({ name: "pages" })
      // Home page (index.html static)
      .get(
        "/",
        () =>
          new Response(Bun.file("index.html"), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      )
      .get(
        "/index.html",
        () =>
          new Response(Bun.file("index.html"), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      )
      // Sessions list page: GET /sessions/:ip
      .get("/sessions/:ip", ({ params }) => {
        const ip = params.ip;
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        const page = renderSessionsListPage({ ip });
        return new Response(page, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      })
      // Session detail page: GET /sessions/:ip/:sid
      .get("/sessions/:ip/:sid", async ({ params }) => {
        const { ip, sid } = params as any;
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        // Best-effort title lookup (non-blocking failures)
        let sessionTitle = "";
        try {
          const list = await listSessions(resolveBase(ip)).catch(() => []);
          const found = list.find((s) => s.id === sid);
          if (found && typeof found.title === "string" && found.title.trim())
            sessionTitle = found.title.trim();
        } catch {}
        const page = renderSessionDetailPage({
          ip,
          sessionId: sid,
          sessionTitle,
        });
        return new Response(page, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      })
      // Advanced session page: GET /sessions/:ip/:sid/advanced
      .get("/sessions/:ip/:sid/advanced", async ({ params }) => {
        const { ip, sid } = params as any;
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        let sessionTitle = "";
        try {
          const list = await listSessions(resolveBase(ip)).catch(() => []);
          const found = list.find((s) => s.id === sid);
          if (found && typeof found.title === "string" && found.title.trim())
            sessionTitle = found.title.trim();
        } catch {}
        const page = renderSessionAdvancedPage({
          ip,
          sessionId: sid,
          sessionTitle,
        });
        return new Response(page, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      })
  );
}
