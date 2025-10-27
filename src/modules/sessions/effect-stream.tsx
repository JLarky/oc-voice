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

  Effect.runFork(
    Effect.sync(() => {
      const interval = setInterval(() => {
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
        const entry = summaryCache.get(cacheKey);
        const now = Date.now();
        const ttl =
          entry && entry.summary === "(summary failed)"
            ? SUMMARY_CACHE_FAIL_MS
            : SUMMARY_CACHE_SUCCESS_MS;
        const fresh = entry && now - entry.ts < ttl;
        if ((reuse && fresh) || summary.inFlight || (entry && entry.inFlight))
          return;
        summary.inFlight = true;
        if (entry) entry.inFlight = true;
        setTimeout(async () => {
          if (aborted) {
            summary.inFlight = false;
            if (entry) entry.inFlight = false;
            return;
          }
          const recentAfterDelay = msgs.slice(-3).map((m) => ({
            role: m.role || "message",
            text: (m.parts?.[0]?.text || m.text || "")
              .replace(/\s+/g, " ")
              .trim(),
          }));
          const { hash: hashAfterDelay, reuse: reuseAfterDelay } =
            shouldReuseSummary(summary.lastHash, recentAfterDelay);
          const entry2 = summaryCache.get(cacheKey);
          const now2 = Date.now();
          const ttl2 =
            entry2 && entry2.summary === "(summary failed)"
              ? SUMMARY_CACHE_FAIL_MS
              : SUMMARY_CACHE_SUCCESS_MS;
          const stillFresh = entry2 && now2 - entry2.ts < ttl2;
          if (
            msgs[msgs.length - 1]?.role !== "assistant" ||
            (reuseAfterDelay && stillFresh)
          ) {
            summary.inFlight = false;
            if (entry2) entry2.inFlight = false;
            return;
          }
          try {
            const summ = await summarizeMessages(
              remoteBase,
              recentAfterDelay,
              sid,
            );
            if (summ.ok) {
              summary.summary = summ.summary || "(empty summary)";
              summary.action = summ.action;
            } else {
              summary.summary = "(summary failed)";
              summary.action = false;
            }
            summary.lastHash = hashAfterDelay;
            summaryCache.set(cacheKey, {
              summary: summary.summary,
              action: summary.action,
              hash: summary.lastHash,
              ts: Date.now(),
              inFlight: false,
            });
            queue.push(
              ...buildFragments(msgs, summary.summary, summary.action),
            );
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
        }, 800);
      }, 200);
    }),
  );

  const queue: string[] = [];
  const stream = new ReadableStream({
    start(controller) {
      queue.push(...buildFragments(msgs, summary.summary, summary.action));
      const flush = () => {
        if (aborted) {
          controller.close();
          return;
        }
        if (queue.length) {
          const out = queue.splice(0, queue.length);
          for (const frag of out) controller.enqueue(encoder.encode(frag));
        }
        setTimeout(flush, 100);
      };
      flush();
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
