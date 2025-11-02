import { Elysia } from "elysia";
import { staticPlugin } from "./modules/static";
import { ipsPlugin } from "./modules/ips";
import { entityDescriptionsPlugin } from './modules/entity-descriptions';
import { sessionsPlugin } from "./modules/sessions";
import { sendMessagePlugin } from "./modules/sessions/send-message";
import { effectSessionsPlugin } from "./modules/sessions/effect-stream";
import "../server.tsx"; // start Bun server (port 3000) for legacy routes

const app = new Elysia()
  .use(staticPlugin)
  .use(ipsPlugin)
  .use(entityDescriptionsPlugin)
  .use(sessionsPlugin)
  .use(sendMessagePlugin)
  .use(effectSessionsPlugin)
  .onRequest(({ request }) => {
    console.log(request.method + " " + request.url);
  })
  .onError(({ error }) => {
    const message =
      error && typeof error === "object" && "message" in error
        ? error.message
        : String(error);
    return { ok: false, error: message };
  })
  .all("*", async ({ request }) => {
    const url = new URL(request.url);
    try {
      let body: BodyInit | undefined;
      if (request.method !== "GET" && request.method !== "HEAD") {
        try {
          const buf = await request.arrayBuffer();
          body = buf;
        } catch {}
      }
      const upstream = await fetch(
        `http://localhost:3001${url.pathname}${url.search}`,
        {
          method: request.method,
          headers: request.headers,
          body,
        },
      );
      const headers = new Headers();
      upstream.headers.forEach((v, k) => headers.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (e) {
      console.error("Wildcard forward failed", (e as Error).message);
      return new Response("Forward error", { status: 502 });
    }
  })
  .listen(3000);

console.log(
  "Elysia (proxy layer) started on http://localhost:" + app.server?.port,
);
