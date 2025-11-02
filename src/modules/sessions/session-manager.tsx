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
  isGenerating?: boolean;
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
    isGenerating: m.isGenerating,
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
  let lastObservedAssistantHash = "";

  // Adaptive polling: 3 levels based on activity
  const POLL_INTERVAL_FAST_MS = 500; // When generating or recent changes (~120 calls/min)
  const POLL_INTERVAL_MEDIUM_MS = 3000; // When idle for 10s-1min (~20 calls/min)
  const POLL_INTERVAL_SLOW_MS = 10000; // When idle for >1min (~6 calls/min)
  const MEDIUM_IDLE_THRESHOLD_MS = 10000; // Switch to medium after 10s of no changes
  const SLOW_IDLE_THRESHOLD_MS = 60000; // Switch to slow after 1min of no changes
  let lastChangeTs = Date.now();
  let timeSinceLastChange = 0;

  function scheduleNextPoll() {
    const now = Date.now();
    timeSinceLastChange = now - lastChangeTs;
    const hasGenerating = msgs.some((m) => m.isGenerating === true);

    // Determine polling interval based on activity level
    let interval: number;
    let state: string;
    if (hasGenerating || timeSinceLastChange < MEDIUM_IDLE_THRESHOLD_MS) {
      // Level 1: Active - generating or recent changes
      interval = POLL_INTERVAL_FAST_MS;
      state = hasGenerating
        ? "generating"
        : `active (${Math.round(timeSinceLastChange / 1000)}s ago)`;
    } else if (timeSinceLastChange < SLOW_IDLE_THRESHOLD_MS) {
      // Level 2: Medium idle - no activity for 10s-1min
      interval = POLL_INTERVAL_MEDIUM_MS;
      state = `idle (${Math.round(timeSinceLastChange / 1000)}s ago)`;
    } else {
      // Level 3: Very idle - no activity for >1min
      interval = POLL_INTERVAL_SLOW_MS;
      state = `very idle (${Math.round(timeSinceLastChange / 60)}min ago)`;
    }

    // Clear existing timeout and set new one
    if (pollInterval) clearTimeout(pollInterval);

    pollInterval = setTimeout(async () => {
      scheduleNextPoll(); // Schedule next poll first (will re-evaluate interval)
      await pollAndUpdate(); // Then execute poll
    }, interval);

    if (debug) {
      pushDebug(`poll interval: ${interval}ms [${state}]`);
    }
  }

  async function pollAndUpdate() {
    pushDebug("poll tick");
    let raw: TextMessage[] = [];
    try {
      raw = await listMessages(remoteBase, sid);
    } catch (e) {
      console.error(
        "session-manager poll listMessages error",
        (e as Error).message,
      );
      scheduleNextPoll(); // Schedule next poll even on error
      return;
    }
    // Reassign outer msgs (avoid shadowing) so summary logic sees updates
    msgs = raw.map((m) => ({
      role: m.role,
      text: m.texts.join("\n"),
      parts: m.texts.map((t: string) => ({ type: "text", text: t })),
      timestamp: m.timestamp,
      isGenerating: m.isGenerating,
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
      lastChangeTs = Date.now();
      const fragments = buildFragments(msgs, summary.summary, summary.action);
      for (const fragment of fragments) {
        publishElementToStreams(cacheKey, fragment);
      }
    }
    scheduleNextPoll(); // Schedule next poll after processing
  }

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
        isGenerating: m.isGenerating,
      }));
      lastCount = msgs.length;
      lastChangeTs = Date.now();
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

  // Start adaptive message polling
  scheduleNextPoll();

  // Start summary processing (every 200ms)
  const SUMMARY_DEBOUNCE_MS = 1500;
  const MIN_SUMMARY_INTERVAL_MS = 5000;
  let lastAssistantHashChangeTs = 0;
  let lastSummaryEmitTs = 0;

  summaryInterval = setInterval(
    async () => {
      const lastRole = msgs[msgs.length - 1]?.role;
      if (lastRole !== "assistant") {
        pushDebug("summary skip not-assistant");
        return;
      }
      const recentForHash = msgs.slice(-3).map((m) => ({
        role: m.role || "message",
        text: (m.parts?.[0]?.text || m.text || "").replace(/\s+/g, " ").trim(),
      }));
      // Use last successful summary hash (or cache entry) for reuse logic so we don't mark reuse prematurely
      const entry = summaryCache.get(cacheKey);
      const reuseSourceHash = summary.lastHash || entry?.hash;
      const { hash, reuse } = shouldReuseSummary(
        reuseSourceHash,
        recentForHash,
      );
      if (hash !== lastObservedAssistantHash) {
        lastAssistantHashChangeTs = Date.now();
        pushDebug(
          "assistant hash changed" +
            JSON.stringify([hash, lastObservedAssistantHash]),
        );
        lastObservedAssistantHash = hash;
      }
      const now = Date.now();
      const ttl =
        entry && entry.summary === "(summary failed)"
          ? SUMMARY_CACHE_FAIL_MS
          : SUMMARY_CACHE_SUCCESS_MS;
      const fresh = entry && now - entry.ts < ttl;
      const stable = now - lastAssistantHashChangeTs >= SUMMARY_DEBOUNCE_MS;
      if (!stable) {
        pushDebug(
          "summary skip debounce remaining=" +
            (SUMMARY_DEBOUNCE_MS - (now - lastAssistantHashChangeTs)),
        );
        return;
      }
      if (summary.inFlight || (entry && entry.inFlight)) {
        pushDebug("summary skip in-flight");
        return;
      }
      if (reuse && fresh) {
        pushDebug(
          "summary skip reuse=true fresh=true hash=" + hash.slice(0, 8),
        );
        return;
      }
      const sinceLast = now - lastSummaryEmitTs;
      if (sinceLast < MIN_SUMMARY_INTERVAL_MS) {
        pushDebug(
          "summary skip min-interval remaining=" +
            (MIN_SUMMARY_INTERVAL_MS - sinceLast),
        );
        return;
      }
      summary.inFlight = true;
      if (entry) entry.inFlight = true;
      pushDebug("summary start hash=" + hash.slice(0, 8));
      try {
        const summ = await summarizeMessages(remoteBase, recentForHash, sid);
        if (summ.ok) {
          summary.summary = summ.summary || "(empty summary)";
          summary.action = summ.action;
          pushDebug(
            "summary ok chars=" +
              summary.summary.length +
              " action=" +
              summary.action,
          );
        } else {
          summary.summary = "(summary failed)";
          summary.action = false;
          pushDebug("summary failed status ok=false");
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
        pushDebug(
          "summary error " + (e instanceof Error ? e.message : String(e)),
        );
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
    if (pollInterval) clearTimeout(pollInterval);
    clearInterval(summaryInterval);
  }) as any;

  dispose.__getCurrentState = () => ({
    msgs,
    summary: { ...summary },
  });

  return dispose;
}
