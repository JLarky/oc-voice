// app/elysia.ts - prototype Elysia app bootstrapping domain plugins
import { Elysia } from "elysia";
import { ipPlugin } from "./plugins/ip";
import { sessionsPlugin } from "./plugins/sessions";
import { createMessagesPlugin } from "./plugins/messages";
import { createAdvancedPlugin } from "./plugins/advanced";

// Shared mutable stores
const ipStore: string[] = [];
import { createAdvancedStores } from "../domain/advanced";
// Create shared advanced stores and expose aggregated map for messages summary hints
const advancedStores = createAdvancedStores();
const advancedAggregatedStateBySession =
  advancedStores.aggregatedStateBySession;

const app = new Elysia()
  .use(ipPlugin(ipStore))
  .use(sessionsPlugin(ipStore))
  .use(createMessagesPlugin(ipStore, advancedAggregatedStateBySession))
  .use(
    createAdvancedPlugin(
      ipStore,
      advancedAggregatedStateBySession,
      advancedStores,
    ),
  )
  // Mount SSR pages (HTML) parity plugin
  .use((await import("./plugins/pages")).pagesPlugin(ipStore))
  .get(
    "/",
    () =>
      new Response(Bun.file("index.html"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
  )
  .onError(({ error }) => {
    const message =
      error && typeof error === "object" && "message" in error
        ? (error as any).message
        : String(error);
    return {
      ok: false,
      error: message,
    };
  })
  .listen(3333);

console.log(
  "Prototype Elysia app listening on http://localhost:" + app.server?.port,
);
