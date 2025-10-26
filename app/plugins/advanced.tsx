// app/plugins/advanced.ts - advanced SSE using extracted helpers
import { Elysia } from "elysia";
import {
  createAdvancedStores,
  getAggregated,
  pruneSummaryCache,
  pruneAggregatedState,
  AdvancedStores,
} from "../../domain/advanced";
import {
  pollMessages,
  updateAggregatedSummary,
  prunePartsAndTypes,
} from "../../domain/advanced-stream";
import { listMessages } from "../../src/oc-client";
import {
  AdvancedEvents,
  AdvancedRecentMessages,
  AdvancedInfo,
} from "../../rendering/fragments";
import { MessageItems } from "../../rendering/MessageItems";
import { dataStarPatchElementsString } from "../../rendering/datastar";
import { renderAutoScrollScriptEvent } from "../../rendering/fragments";

export function createAdvancedPlugin(
  ipStore: string[],
  externalAggregatedState?: Record<string, any>,
  injectedStores?: AdvancedStores,
) {
  const stores: AdvancedStores = injectedStores || createAdvancedStores();
  // periodic prune of summary + aggregated state
  setInterval(() => {
    pruneSummaryCache(stores);
    pruneAggregatedState(stores);
  }, 30000);
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
        if (externalAggregatedState) {
          const key = ip + "::" + sid;
          externalAggregatedState[key] = externalAggregatedState[key] || {};
          // merge shallow important fields
          externalAggregatedState[key].shareUrl =
            externalAggregatedState[key].shareUrl || state.shareUrl;
          externalAggregatedState[key].summary = state.summary;
          externalAggregatedState[key].actionFlag = state.actionFlag;
        }
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
                if (externalAggregatedState) {
                  const k = ip + "::" + sid;
                  const ext =
                    externalAggregatedState[k] ||
                    (externalAggregatedState[k] = {});
                  ext.summary = state.summary;
                  ext.actionFlag = state.actionFlag;
                  if (state.shareUrl && !ext.shareUrl)
                    ext.shareUrl = state.shareUrl;
                }
                if (upd.syntheticEvent) {
                  eventBuffer.push(upd.syntheticEvent);
                  lastCount = upd.messageCount;
                  state.counts.syntheticMessageUpdates++;
                }
                prunePartsAndTypes(state.parts as any, state.lastTypes);
                // Build HTML fragments mirroring legacy AdvancedEvents + RecentMessages + status + auto-scroll
                const recentMsgs = Array.isArray(state.lastMessages)
                  ? state.lastMessages
                  : [];
                const summaryText = state.summary || undefined;
                const actionFlag = state.actionFlag || false;
                const totalCount = state.messageCount || recentMsgs.length;
                const listId = `messages-list-${sid}`;
                // Recent messages fragment (with retry form on failure)
                let recentJsx: any = (
                  <AdvancedRecentMessages
                    messages={recentMsgs as any}
                    summaryText={summaryText}
                    actionFlag={actionFlag}
                    totalCount={totalCount}
                    listId={listId}
                  />
                );
                if (summaryText === "(send failed: retry)") {
                  recentJsx = (
                    <div id={listId}>
                      <div style="font-size:.7rem;opacity:.6;margin-bottom:4px">
                        recent messages (events-derived)
                      </div>
                      <MessageItems messages={recentMsgs as any} />
                      <div
                        class="messages-summary"
                        style="opacity:.75;margin-top:4px"
                      >
                        send failed
                        <form
                          data-on:submit={`@post('/sessions/${ip}/${sid}/message/retry'); $messageText = ''`}
                          style="display:inline;margin-left:8px"
                        >
                          <button type="submit" style="font-size:.65rem">
                            retry last
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                }
                const statusJsx = (
                  <div
                    id="messages-status"
                    class="status"
                  >{`Updated ${new Date().toLocaleTimeString()}`}</div>
                );
                const stateJson = JSON.stringify(state).slice(0, 4000);
                const eventsJsx = (
                  <AdvancedEvents
                    events={eventBuffer
                      .slice(-MAX_EVENT_BUFFER)
                      .map((e) =>
                        typeof e === "string" ? e : JSON.stringify(e),
                      )}
                    attempts={[]}
                    stateJson={stateJson}
                  />
                );
                controller.enqueue(
                  new TextEncoder().encode(
                    dataStarPatchElementsString(statusJsx),
                  ),
                );
                controller.enqueue(
                  new TextEncoder().encode(
                    dataStarPatchElementsString(recentJsx),
                  ),
                );
                controller.enqueue(
                  new TextEncoder().encode(
                    dataStarPatchElementsString(eventsJsx),
                  ),
                );
                controller.enqueue(
                  new TextEncoder().encode(renderAutoScrollScriptEvent(listId)),
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
                if (now - lastCountTs > 4000) {
                  // refresh approx count
                  const msgs = await listMessages(remoteBase, sid).catch(
                    () => [],
                  );
                  lastCount = Array.isArray(msgs) ? msgs.length : 0;
                  lastCountTs = now;
                }
                // attempt shareUrl extraction from aggregated state (if populated by share route elsewhere)
                const aggKey = ip + "::" + sid;
                const aggState = (stores.aggregatedStateBySession as any)[
                  aggKey
                ];
                const shareUrl = aggState?.shareUrl;
                const infoJsx = (
                  <AdvancedInfo
                    title={sid}
                    approxCount={lastCount}
                    shareUrl={shareUrl}
                  />
                );
                const statusJsx = (
                  <div
                    id="advanced-stream-status"
                    class="status"
                  >{`Updated ${new Date().toLocaleTimeString()}`}</div>
                );
                controller.enqueue(
                  new TextEncoder().encode(
                    dataStarPatchElementsString(infoJsx),
                  ),
                );
                controller.enqueue(
                  new TextEncoder().encode(
                    dataStarPatchElementsString(statusJsx),
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
