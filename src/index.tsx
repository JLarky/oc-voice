import { Elysia } from "elysia";
import { staticPlugin } from "./modules/static";

const app = new Elysia()
  .use(staticPlugin)
  .onRequest(({ status, request }) => {
    console.log(`${request.method} ${request.url}`);
  })
  .onError(({ error }) => {
    const message =
      error && typeof error === "object" && "message" in error
        ? error.message
        : String(error);
    return {
      ok: false,
      error: message,
    };
  })
  .listen(3000);

console.log("Elysia started on http://localhost:" + app.server?.port);
