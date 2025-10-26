// app/plugins/advanced.ts - advanced SSE using extracted helpers
import { Elysia } from "elysia";
import {
  createAdvancedStores,
  getAggregated,
  pruneSummaryCache,
  AdvancedStores,
} from "../../domain/advanced";
import {
  pollMessages,
  updateAggregatedSummary,
  prunePartsAndTypes,
} from "../../domain/advanced-stream";
import { listMessages } from "../../src/oc-client";

export function createAdvancedPlugin(ipStore: string[]) {
  const stores: AdvancedStores = createAdvancedStores();
  // periodic prune
  setInterval(() => pruneSummaryCache(stores), 30000);
  const resolveBase = (ip: string) => `http://${ip}:2000`;
  return (
    new Elysia({ name: "advanced" })
      .get("/sessions/:ip/:sid/advanced/events/stream", ({ params }) => {
        const MAX_EVENT_BUFFER = 100;
        const { ip, sid } = params as any;
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        const remoteBase = resolveBase(ip);
        const state = getAggregated(stores, ip, sid);
        const eventBuffer: any[] = [];
        const stream = new ReadableStream({
          async start(controller) {
            let lastCount = 0;
            async function step() {
              try {
                const polled = await pollMessages(remoteBase, sid);
                state.lastMessages = polled.recentForDisplay;
                state.messageCount = polled.messages.length;
                const upd = updateAggregatedSummary(
                  stores,
                  ip,
                  sid,
                  remoteBase,
                  polled.forHash,
                  state.messageCount,
                  lastCount,
                );
                state.summary = upd.summaryText;
                state.actionFlag = upd.actionFlag;
                if (upd.syntheticEvent) {
                  eventBuffer.push(upd.syntheticEvent);
                  lastCount = upd.messageCount;
                  state.counts.syntheticMessageUpdates++;
                }
                prunePartsAndTypes(state.parts as any, state.lastTypes);
                const payload = {
                  aggregated: state,
                  events: eventBuffer.slice(-MAX_EVENT_BUFFER),
                };
                controller.enqueue(
                  new TextEncoder().encode("event: datastar-patch-elements\n"),
                );
                controller.enqueue(
                  new TextEncoder().encode(
                    "data: " + JSON.stringify(payload) + "\n\n",
                  ),
                );
              } catch {}
            }
            await step();
            const interval = setInterval(step, 2000);
            // @ts-ignore
            controller.signal?.addEventListener("abort", () =>
              clearInterval(interval),
            );
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      })
      // (removed old polling block; replaced by helper-driven implementation above)
      .get("/sessions/:ip/:sid/advanced/sdk-json", async ({ params }) => {
        const { ip, sid } = params as any;
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        const remoteBase = resolveBase(ip);
        // attempt to fetch detailed session info via multiple shapes defensively
        const attempts: any[] = [];
        let sdkDetail: any = null;
        let rawDetail: any = null;
        let sdkList: any = null;
        try {
          // list sessions first to get cross-reference
          const listRes = await fetch(remoteBase + "/session").catch(
            () => null,
          );
          if (listRes) {
            const j = await listRes.json().catch(() => null);
            sdkList = j;
            attempts.push({
              type: "list",
              ok: listRes.ok,
              status: listRes.status,
            });
          } else attempts.push({ type: "list", ok: false });
        } catch (e) {
          attempts.push({ type: "list", ok: false, error: String(e) });
        }
        // try multiple detail endpoints
        const detailUrls = [
          `/session/${sid}`,
          `/session/${sid}/detail`,
          `/session/${sid}/info`,
        ];
        for (const u of detailUrls) {
          try {
            const res = await fetch(remoteBase + u).catch(() => null);
            if (!res) {
              attempts.push({ type: "detail", url: u, ok: false });
              continue;
            }
            const j = await res.json().catch(() => null);
            attempts.push({
              type: "detail",
              url: u,
              ok: res.ok,
              status: res.status,
            });
            if (res.ok && j && typeof j === "object") {
              sdkDetail = sdkDetail || j;
              rawDetail = rawDetail || j;
            }
          } catch (e) {
            attempts.push({
              type: "detail",
              url: u,
              ok: false,
              error: String(e),
            });
          }
        }
        const id = sid;
        const out = { id, sdkDetail, rawDetail, sdkList, attempts };
        return new Response(JSON.stringify(out), {
          headers: { "Content-Type": "application/json" },
        });
      })
      .get("/sessions/:ip/:sid/advanced/stream", ({ params }) => {
        const { ip, sid } = params as any;
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        const remoteBase = resolveBase(ip);
        let lastCount = 0;
        let lastCountTs = 0;
        const stream = new ReadableStream({
          async start(controller) {
            async function push() {
              try {
                const now = Date.now();
                if (now - lastCountTs > 5000) {
                  const msgs = await listMessages(remoteBase, sid).catch(
                    () => [],
                  );
                  lastCount = msgs.length;
                  lastCountTs = now;
                }
                const payload = { ip, sid, approxCount: lastCount };
                controller.enqueue(
                  new TextEncoder().encode("event: datastar-patch-elements\n"),
                );
                controller.enqueue(
                  new TextEncoder().encode(
                    "data: " + JSON.stringify(payload) + "\n\n",
                  ),
                );
              } catch {}
            }
            await push();
            const interval = setInterval(push, 2000);
            // @ts-ignore
            controller.signal?.addEventListener("abort", () =>
              clearInterval(interval),
            );
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      })
  );
  // (removed second duplicate approxCount stream) );
}
