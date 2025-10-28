import { AdvancedRecentMessages } from "../../../rendering/fragments";
import { listMessages, summarizeMessages } from "../../oc-client";
import { shouldReuseSummary } from "../../hash";
import { publishElementToStreams } from "./pubsub";
import { JSX } from "preact";

export interface Msg {
  role: string;
  text: string;
  parts: { type: "text"; text: string }[];
}

export interface SummaryState {
  summary: string;
  action: boolean;
  lastHash: string;
  inFlight: boolean;
}

interface CacheEntry {
  summary: string;
  action: boolean;
  hash: string;
  ts: number;
  inFlight: boolean;
}

const SUMMARY_CACHE_SUCCESS_MS = 15 * 60 * 1000;
const SUMMARY_CACHE_FAIL_MS = 60 * 1000;
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

export function buildFragments(msgs: Msg[], summary: string, action: boolean) {
  const trimmed = msgs.length > 50 ? msgs.slice(-50) : msgs;
  const status = (
    <div
      id="messages-status"
      className="status"
    >{`Updated ${new Date().toLocaleTimeString()}`}</div>
  );
  const recent = (
    <AdvancedRecentMessages
      messages={trimmed}
      summaryText={summary}
      actionFlag={action}
      totalCount={msgs.length}
    />
  );
  return [status, recent];
}

/**
 * Create a session manager that handles shared logic for a session
 * Runs message polling and summary processing once per session,
 * broadcasting updates to all connected streams
 */
export function createSessionManager(
  cacheKey: string,
  remoteBase: string,
  sid: string,
): (() => void) & {
  __getCurrentState?: () => { msgs: Msg[]; summary: SummaryState };
} {
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
  let lastCount = 0;
  let pollInterval: NodeJS.Timeout;
  let summaryInterval: NodeJS.Timeout;

  // Send initial fragments immediately
  {
    const fragments = buildFragments(msgs, summary.summary, summary.action);
    for (const fragment of fragments) {
      publishElementToStreams(cacheKey, fragment);
    }
  }

  // Start message polling (every 400ms)
  pollInterval = setInterval(async () => {
    let raw: { role: string; texts: string[] }[] = [];
    try {
      raw = await listMessages(remoteBase, sid);
    } catch (e) {
      console.error(
        "session-manager poll listMessages error",
        (e as Error).message,
      );
    }
    msgs = raw.map((m) => ({
      role: m.role,
      text: m.texts.join("\n"),
      parts: m.texts.map((t: string) => ({ type: "text", text: t })),
    }));
    if (msgs.length !== lastCount) {
      lastCount = msgs.length;
      const fragments = buildFragments(msgs, summary.summary, summary.action);
      for (const fragment of fragments) {
        publishElementToStreams(cacheKey, fragment);
      }
    }
  }, 400);

  // Start summary processing (every 200ms)
  const SUMMARY_DEBOUNCE_MS = 1500;
  const MIN_SUMMARY_INTERVAL_MS = 5000;
  let lastAssistantHashChangeTs = 0;
  let lastSummaryEmitTs = 0;

  summaryInterval = setInterval(async () => {
    const lastRole = msgs[msgs.length - 1]?.role;
    if (lastRole !== "assistant") return;
    const recentForHash = msgs.slice(-3).map((m) => ({
      role: m.role || "message",
      text: (m.parts?.[0]?.text || m.text || "").replace(/\s+/g, " ").trim(),
    }));
    const { hash, reuse } = shouldReuseSummary(summary.lastHash, recentForHash);
    if (hash !== summary.lastHash) lastAssistantHashChangeTs = Date.now();
    const entry = summaryCache.get(cacheKey);
    const now = Date.now();
    const ttl =
      entry && entry.summary === "(summary failed)"
        ? SUMMARY_CACHE_FAIL_MS
        : SUMMARY_CACHE_SUCCESS_MS;
    const fresh = entry && now - entry.ts < ttl;
    const stable = now - lastAssistantHashChangeTs >= SUMMARY_DEBOUNCE_MS;
    if (!stable) return;
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
      const fragments = buildFragments(msgs, summary.summary, summary.action);
      for (const fragment of fragments) {
        publishElementToStreams(cacheKey, fragment);
      }
    } catch (e) {
      console.error("session-manager summary error", (e as Error).message);
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

  const dispose: (() => void) & {
    __getCurrentState?: () => { msgs: Msg[]; summary: SummaryState };
  } = (() => {
    clearInterval(pollInterval);
    clearInterval(summaryInterval);
  }) as any;

  dispose.__getCurrentState = () => ({
    msgs,
    summary: { ...summary },
  });

  return dispose;
}
