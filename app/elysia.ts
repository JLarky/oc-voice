// app/elysia.ts - prototype Elysia app bootstrapping domain plugins
import { Elysia } from "elysia";
import { ipPlugin } from "./plugins/ip";
import { sessionsPlugin } from "./plugins/sessions";
import { createMessagesPlugin } from "./plugins/messages";
import { createAdvancedPlugin } from "./plugins/advanced";

// Shared mutable stores
const ipStore: string[] = [];
// Placeholder advanced aggregated state store (legacy compatibility for messages plugin summary hints)
const advancedAggregatedStateBySession: Record<string, any> = {};

const app = new Elysia()
  .use(ipPlugin(ipStore))
  .use(sessionsPlugin(ipStore))
  .use(createMessagesPlugin(ipStore, advancedAggregatedStateBySession))
  // Mount SSR pages (HTML) parity plugin
  .use((await import("./plugins/pages")).pagesPlugin(ipStore))
  .get("/", () => ({
    ok: true,
    message: "prototype root",
    ips: ipStore.length,
  }))
  .onError(({ error }) => ({
    ok: false,
    error: error?.message || String(error),
  }))
  .listen(3333);

console.log(
  "Prototype Elysia app listening on http://localhost:" + app.server?.port,
);
