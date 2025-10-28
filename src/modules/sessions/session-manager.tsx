import { AdvancedRecentMessages } from "../../../rendering/fragments";
import { listMessages, summarizeMessages, TextMessage } from "../../oc-client";
import { shouldReuseSummary } from "../../hash";
import { publishElementToStreams } from "./pubsub";
import { JSX } from "preact";

export interface Msg {
  role: string;
  text: string;
  parts: { type: "text"; text: string }[];
  timestamp?: Date;
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
  // Adapt Msg[] -> TextMessage[] expected by AdvancedRecentMessages
  const adapted = trimmed.map((m) => ({
    role: m.role,
    texts: m.text.split("\n").filter(Boolean),
    timestamp: m.timestamp,
    text: m.text,
    parts: m.parts,
  }));
  const status = (
    <div
      id="messages-status"
      className="status"
    >{`Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Denver" }).format(new Date())}`}</div>
  );
  const recent = (
    <AdvancedRecentMessages
      messages={adapted as any}
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
  debug?: boolean,
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
  let lastSignature = "";
  let pollInterval: NodeJS.Timeout;
  let summaryInterval: NodeJS.Timeout;

  // Debug ring buffer (in-memory, not persisted) if debug enabled
  const debugLines: string[] = [];
  function pushDebug(line: string) {
    if (!debug) return;
    const ts = new Date().toISOString().split("T")[1]!.split("Z")[0];
    debugLines.push(ts + " " + line);
    if (debugLines.length > 40) debugLines.splice(0, debugLines.length - 40);
    // Publish debug element
    const el = (
      <div id="debug-log" class="status" data-keep>
        {[...debugLines].reverse().map((l) => (
          <div>{l}</div>
        ))}
      </div>
    );
    publishElementToStreams(cacheKey, el);
  }

  // Publish initial fragments immediately (empty msgs / cached summary) so
  // connected streams get early UI without waiting on remote fetch. Then
  // kick off async fetch to update and re-emit if messages exist.
  {
    const fragments = buildFragments(msgs, summary.summary, summary.action);
    for (const fragment of fragments)
      publishElementToStreams(cacheKey, fragment);
  }
  (async () => {
    pushDebug("initial listMessages fetch start");
    try {
      const raw = await listMessages(remoteBase, sid);
      pushDebug("initial listMessages fetched count=" + raw.length);
      msgs = raw.map((m) => ({
        role: m.role,
        text: m.texts.join("\n"),
        parts: m.texts.map((t: string) => ({ type: "text", text: t })),
        timestamp: m.timestamp,
      }));
      lastCount = msgs.length;
      const fragments = buildFragments(msgs, summary.summary, summary.action);
      for (const fragment of fragments)
        publishElementToStreams(cacheKey, fragment);
      pushDebug("initial fragments published");
    } catch (e) {
      console.error(
        "session-manager initial listMessages error",
        (e as Error).message,
      );
      pushDebug("initial listMessages error " + (e as Error).message);
    }
  })();

  // Start message polling (every 400ms)
  pollInterval = setInterval(
    async () => {
      pushDebug("poll tick");
      let raw: TextMessage[] = [];
      try {
        raw = await listMessages(remoteBase, sid);
      } catch (e) {
        console.error(
          "session-manager poll listMessages error",
          (e as Error).message,
        );
      }
      // Reassign outer msgs (avoid shadowing) so summary logic sees updates
      msgs = raw.map((m) => ({
        role: m.role,
        text: m.texts.join("\n"),
        parts: m.texts.map((t: string) => ({ type: "text", text: t })),
        timestamp: m.timestamp,
      }));
      let changed = false;
      if (msgs.length !== lastCount) {
        lastCount = msgs.length;
        changed = true;
      } else {
        // Compute lightweight signature of last message text(s)
        const tail = msgs
          .slice(-3)
          .map((m) => m.text)
          .join("\n");
        const sig = `${msgs.length}:${tail}`;
        if (sig !== lastSignature) {
          lastSignature = sig;
          changed = true;
        }
      }
      if (changed) {
        const fragments = buildFragments(msgs, summary.summary, summary.action);
        for (const fragment of fragments) {
          publishElementToStreams(cacheKey, fragment);
        }
      }
    },
    400 + (debug ? 1000 : 0),
  );

  // Start summary processing (every 200ms)
  const SUMMARY_DEBOUNCE_MS = 1500;
  const MIN_SUMMARY_INTERVAL_MS = 5000;
  let lastAssistantHashChangeTs = 0;
  let lastSummaryEmitTs = 0;

  summaryInterval = setInterval(
    async () => {
      const lastRole = msgs[msgs.length - 1]?.role;
      if (lastRole !== "assistant") return;
      const recentForHash = msgs.slice(-3).map((m) => ({
        role: m.role || "message",
        text: (m.parts?.[0]?.text || m.text || "").replace(/\s+/g, " ").trim(),
      }));
      const { hash, reuse } = shouldReuseSummary(
        summary.lastHash,
        recentForHash,
      );
      if (hash !== summary.lastHash) {
        lastAssistantHashChangeTs = Date.now();
        pushDebug(
          "assistant hash changed" + JSON.stringify([hash, summary.lastHash]),
        );
      }
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
    },
    200 + (debug ? 1000 : 0),
  );

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
