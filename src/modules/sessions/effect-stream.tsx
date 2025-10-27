import { Elysia } from "elysia";
import { Effect } from "effect";
import { AdvancedRecentMessages } from "../../../rendering/fragments";
import { dataStarPatchElementsString } from "../../../rendering/datastar";
import { doesIpExist } from "../../utils/store-ips";
import { listMessages, summarizeMessages } from "../../oc-client";
import { shouldReuseSummary } from "../../hash";

interface Msg {
  role: string;
  text: string;
  parts: { type: string; text: string }[];
}
interface SummaryState {
  summary: string;
  action: boolean;
  lastHash: string;
  inFlight: boolean;
}

// Global summary cache with TTL
const SUMMARY_CACHE_SUCCESS_MS = 15 * 60 * 1000;
const SUMMARY_CACHE_FAIL_MS = 60 * 1000;
interface CacheEntry {
  summary: string;
  action: boolean;
  hash: string;
  ts: number;
  inFlight: boolean;
}
const summaryCache = new Map<string, CacheEntry>();
let summaryCachePrunerStarted = false;
function startSummaryCachePruner() {
  if (summaryCachePrunerStarted) return;
  summaryCachePrunerStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of summaryCache.entries()) {
      const ttl =
        entry.summary === "(summary failed)"
          ? SUMMARY_CACHE_FAIL_MS
          : SUMMARY_CACHE_SUCCESS_MS;
      if (now - entry.ts > ttl) summaryCache.delete(key);
    }
  }, 30000);
}
startSummaryCachePruner();

function buildFragments(msgs: Msg[], summary: string, action: boolean) {
  const trimmed = msgs.length > 50 ? msgs.slice(-50) : msgs;
  const status = (
    <div
      id="messages-status"
      className="status"
    >{`Updated ${new Date().toLocaleTimeString()}`}</div>
  );
  const recent = (
    <AdvancedRecentMessages
      messages={trimmed as any}
      summaryText={summary}
      actionFlag={action}
      totalCount={msgs.length}
    />
  );
  return [
    dataStarPatchElementsString(status),
    dataStarPatchElementsString(recent),
  ];
}

export const effectSessionsPlugin = new Elysia({
  name: "sessions-effect-stream",
}).get("/sessions/:ip/:sid/effect/stream", async ({ params, request }) => {
  const { ip, sid } = params as { ip: string; sid: string };
  if (!ip || !sid || !(await doesIpExist(ip)))
    return new Response("Unknown IP", { status: 404 });
  const remoteBase = `http://${ip}:2000`;
  const cacheKey = remoteBase + "::" + sid;
  const encoder = new TextEncoder();
  let msgs: Msg[] = [];
  let summary: SummaryState = {
    summary: "(no recent messages)",
    action: false,
    lastHash: "",
    inFlight: false,
  };
  const existing = summaryCache.get(cacheKey);
  if (existing) {
    summary.summary = existing.summary;
    summary.action = existing.action;
    summary.lastHash = existing.hash;
  }
  let aborted = false;
  let lastCount = 0;

  Effect.runFork(
    Effect.sync(() => {
      const interval = setInterval(async () => {
        if (aborted) {
          clearInterval(interval);
          return;
        }
        let raw: any[] = [];
        try {
          raw = await listMessages(remoteBase, sid);
        } catch (e) {
          console.error("effect poll listMessages error", (e as Error).message);
        }
        msgs = raw.map((m) => ({
          role: m.role,
          text: m.texts.join("\n"),
          parts: m.texts.map((t: string) => ({ type: "text", text: t })),
        }));
        if (msgs.length !== lastCount) {
          lastCount = msgs.length;
          queue.push(...buildFragments(msgs, summary.summary, summary.action));
        }
      }, 400);
    }),
  );

  const SUMMARY_DEBOUNCE_MS = 1500; // silence until assistant messages settle
  const MIN_SUMMARY_INTERVAL_MS = 5000; // hard minimum gap between summaries
  let lastAssistantHashChangeTs = 0;
  let lastSummaryEmitTs = 0;
  Effect.runFork(
    Effect.sync(() => {
      const interval = setInterval(async () => {
        if (aborted) {
          clearInterval(interval);
          return;
        }
        const lastRole = msgs[msgs.length - 1]?.role;
        if (lastRole !== "assistant") return;
        const recentForHash = msgs.slice(-3).map((m) => ({
          role: m.role || "message",
          text: (m.parts?.[0]?.text || m.text || "")
            .replace(/\s+/g, " ")
            .trim(),
        }));
        const { hash, reuse } = shouldReuseSummary(
          summary.lastHash,
          recentForHash,
        );
        if (hash !== summary.lastHash) lastAssistantHashChangeTs = Date.now();
        const entry = summaryCache.get(cacheKey);
        const now = Date.now();
        const ttl =
          entry && entry.summary === "(summary failed)"
            ? SUMMARY_CACHE_FAIL_MS
            : SUMMARY_CACHE_SUCCESS_MS;
        const fresh = entry && now - entry.ts < ttl;
        const stable = now - lastAssistantHashChangeTs >= SUMMARY_DEBOUNCE_MS;
        if (!stable) return; // wait for assistant messages to settle
        if ((reuse && fresh) || summary.inFlight || (entry && entry.inFlight))
          return;
        if (Date.now() - lastSummaryEmitTs < MIN_SUMMARY_INTERVAL_MS) return;
        summary.inFlight = true;
        if (entry) entry.inFlight = true;
        try {
          const summ = await summarizeMessages(remoteBase, recentForHash, sid);
          if (summ.ok) {
            summary.summary = summ.summary || "(empty summary)";
            summary.action = summ.action;
          } else {
            summary.summary = "(summary failed)";
            summary.action = false;
          }
          summary.lastHash = hash;
          lastSummaryEmitTs = Date.now();
          summaryCache.set(cacheKey, {
            summary: summary.summary,
            action: summary.action,
            hash: summary.lastHash,
            ts: Date.now(),
            inFlight: false,
          });
          queue.push(...buildFragments(msgs, summary.summary, summary.action));
        } catch (e) {
          console.error("effect summary error", (e as Error).message);
          summary.summary = "(summary failed)";
          summary.action = false;
          summaryCache.set(cacheKey, {
            summary: summary.summary,
            action: summary.action,
            hash: summary.lastHash,
            ts: Date.now(),
            inFlight: false,
          });
        } finally {
          summary.inFlight = false;
          const fin = summaryCache.get(cacheKey);
          if (fin) fin.inFlight = false;
        }
      }, 200);
    }),
  );

  const queue: string[] = [];
  const stream = new ReadableStream({
    start(controller) {
      queue.push(...buildFragments(msgs, summary.summary, summary.action));
      let closed = false;
      let flushTimer: any;
      const flush = () => {
        if (aborted) {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch (_) {}
          }
          return;
        }
        if (queue.length) {
          const out = queue.splice(0, queue.length);
          for (const frag of out) controller.enqueue(encoder.encode(frag));
        }
        flushTimer = setTimeout(flush, 100);
      };
      flushTimer = setTimeout(flush, 0);
    },
    cancel() {
      aborted = true;
    },
  });

  request.signal.addEventListener("abort", () => {
    aborted = true;
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
