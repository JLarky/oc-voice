import { AdvancedRecentMessages } from "../../../rendering/fragments";
import { listMessages, summarizeMessages, TextMessage } from "../../oc-client";
import { shouldReuseSummary } from "../../hash";
import {
  loadPersistedSummary,
  persistSummary,
  appendSummaryLog,
} from "./summary-storage";
import { publishElementToStreams, getSubscriptionCount } from "./pubsub";
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
  // Load persisted summary from unstorage if in-memory cache empty
  if (!existing) {
    try {
      // Fire and forget async load; if found update and publish fragments early
      loadPersistedSummary(cacheKey).then((persisted) => {
        if (persisted && persisted.summary) {
          summary.summary = persisted.summary;
          summary.action = persisted.action;
          summary.lastHash = persisted.hash;
          summaryCache.set(cacheKey, { ...persisted, inFlight: false });
          const fragments = buildFragments(
            msgs,
            summary.summary,
            summary.action,
          );
          for (const fragment of fragments)
            publishElementToStreams(cacheKey, fragment);
        }
      });
    } catch (e) {
      console.error(
        "session-manager persisted load error",
        (e as Error).message,
      );
    }
  }
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

  // Track inactivity for cleanup
  const INACTIVITY_TIMEOUT_MS = 30 * 1000; // 30 seconds
  let lastActiveSubscriptionTs = Date.now();

  // Latency-based throttling to prevent server overload
  let pollInFlight = false; // Prevent overlapping API calls
  let recentResponseTimes: number[] = []; // Track last few response times
  const MAX_RESPONSE_TIME_HISTORY = 5; // Keep last 5 response times
  const SLOW_RESPONSE_THRESHOLD_MS = 1000; // Consider slow if >1s
  const VERY_SLOW_RESPONSE_THRESHOLD_MS = 3000; // Consider very slow if >3s

  function getAverageResponseTime(): number {
    if (recentResponseTimes.length === 0) return 0;
    const sum = recentResponseTimes.reduce((a, b) => a + b, 0);
    return sum / recentResponseTimes.length;
  }

  function scheduleNextPoll() {
    // Don't schedule if already in-flight (prevents overlapping calls)
    if (pollInFlight) {
      if (debug) {
        pushDebug("scheduleNextPoll: skipping (poll in-flight)");
      }
      return;
    }

    const now = Date.now();
    timeSinceLastChange = now - lastChangeTs;
    const hasGenerating = msgs.some((m) => m.isGenerating === true);
    const avgResponseTime = getAverageResponseTime();

    // Determine base polling interval based on activity level
    let baseInterval: number;
    let state: string;
    if (hasGenerating || timeSinceLastChange < MEDIUM_IDLE_THRESHOLD_MS) {
      // Level 1: Active - generating or recent changes
      baseInterval = POLL_INTERVAL_FAST_MS;
      state = hasGenerating
        ? "generating"
        : `active (${Math.round(timeSinceLastChange / 1000)}s ago)`;
    } else if (timeSinceLastChange < SLOW_IDLE_THRESHOLD_MS) {
      // Level 2: Medium idle - no activity for 10s-1min
      baseInterval = POLL_INTERVAL_MEDIUM_MS;
      state = `idle (${Math.round(timeSinceLastChange / 1000)}s ago)`;
    } else {
      // Level 3: Very idle - no activity for >1min
      baseInterval = POLL_INTERVAL_SLOW_MS;
      state = `very idle (${Math.round(timeSinceLastChange / 60)}min ago)`;
    }

    // Adjust interval based on API latency
    // If responses are slow, back off to prevent overlapping calls
    let adjustedInterval = baseInterval;
    if (avgResponseTime > VERY_SLOW_RESPONSE_THRESHOLD_MS) {
      // Very slow: wait at least 2x the response time to avoid overlap
      adjustedInterval = Math.max(baseInterval, avgResponseTime * 2);
      state += ` (slow API: ${Math.round(avgResponseTime)}ms)`;
    } else if (avgResponseTime > SLOW_RESPONSE_THRESHOLD_MS) {
      // Slow: wait at least 1.5x the response time
      adjustedInterval = Math.max(baseInterval, avgResponseTime * 1.5);
      state += ` (slow API: ${Math.round(avgResponseTime)}ms)`;
    } else if (avgResponseTime > 0) {
      state += ` (API: ${Math.round(avgResponseTime)}ms)`;
    }

    // Clear existing timeout and set new one
    if (pollInterval) clearTimeout(pollInterval);

    pollInterval = setTimeout(async () => {
      await pollAndUpdate(); // Execute poll (will schedule next inside)
    }, adjustedInterval);

    if (debug) {
      pushDebug(
        `poll interval: ${adjustedInterval}ms (base: ${baseInterval}ms) [${state}]`,
      );
    }
  }

  async function pollAndUpdate() {
    // Update activity timestamp if subscriptions are active
    if (getSubscriptionCount(cacheKey) > 0) {
      lastActiveSubscriptionTs = Date.now();
    }

    // Prevent overlapping calls
    if (pollInFlight) {
      if (debug) {
        pushDebug("pollAndUpdate: skipping (already in-flight)");
      }
      scheduleNextPoll(); // Reschedule for later
      return;
    }

    pollInFlight = true;
    const pollStartTime = Date.now();
    pushDebug("poll tick");

    try {
      let raw: TextMessage[] = [];
      try {
        raw = await listMessages(remoteBase, sid);
      } catch (e) {
        console.error(
          "session-manager poll listMessages error",
          (e as Error).message,
        );
        // On error, still record response time and schedule next
        const responseTime = Date.now() - pollStartTime;
        recentResponseTimes.push(responseTime);
        if (recentResponseTimes.length > MAX_RESPONSE_TIME_HISTORY) {
          recentResponseTimes.shift();
        }
        pollInFlight = false;
        scheduleNextPoll();
        return;
      }

      // Record response time
      const responseTime = Date.now() - pollStartTime;
      recentResponseTimes.push(responseTime);
      if (recentResponseTimes.length > MAX_RESPONSE_TIME_HISTORY) {
        recentResponseTimes.shift();
      }

      if (debug && responseTime > SLOW_RESPONSE_THRESHOLD_MS) {
        pushDebug(`slow API response: ${responseTime}ms`);
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
    } finally {
      pollInFlight = false;
    }

    // Schedule next poll after processing completes
    scheduleNextPoll();
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
    // Update activity timestamp if subscriptions are active
    if (getSubscriptionCount(cacheKey) > 0) {
      lastActiveSubscriptionTs = Date.now();
    }

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

  // Cleanup timer: kill session after 2 minutes of inactivity
  const cleanupInterval = setInterval(() => {
    const subscriptionCount = getSubscriptionCount(cacheKey);
    if (subscriptionCount === 0) {
      const inactiveFor = Date.now() - lastActiveSubscriptionTs;
      if (inactiveFor >= INACTIVITY_TIMEOUT_MS) {
        console.log(
          `Disposing inactive session manager (${Math.round(inactiveFor / 1000)}s inactive)`,
          { cacheKey },
        );
        if (pollInterval) clearTimeout(pollInterval);
        clearInterval(summaryInterval);
        clearInterval(cleanupInterval);
        dispose();
      }
    } else {
      lastActiveSubscriptionTs = Date.now();
    }
  }, 30000); // Check every 30 seconds

  // Start summary processing (every 200ms)
  const SUMMARY_DEBOUNCE_MS = 1500;
  const MIN_SUMMARY_INTERVAL_MS = 5000;
  let lastAssistantHashChangeTs = 0;
  let lastSummaryEmitTs = 0;

  summaryInterval = setInterval(
    async () => {
      // Update activity timestamp if subscriptions are active
      if (getSubscriptionCount(cacheKey) > 0) {
        lastActiveSubscriptionTs = Date.now();
      }

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
        const persisted = {
          summary: summary.summary,
          action: summary.action,
          hash: summary.lastHash,
          ts: Date.now(),
          inFlight: false,
        };
        summaryCache.set(cacheKey, persisted);
        persistSummary(cacheKey, persisted).catch((e) => {
          console.error(
            "session-manager persistSummary error",
            (e as Error).message,
          );
        });
        if (persisted.summary !== "(summary failed)") {
          appendSummaryLog(cacheKey, persisted).catch((e) => {
            console.error(
              "session-manager appendSummaryLog error",
              (e as Error).message,
            );
          });
        }
        const fragments = buildFragments(msgs, summary.summary, summary.action);
        for (const fragment of fragments) {
          publishElementToStreams(cacheKey, fragment);
        }
      } catch (e) {
        console.error("session-manager summary error", (e as Error).message);
        summary.summary = "(summary failed)";
        summary.action = false;
        const persistedFail = {
          summary: summary.summary,
          action: summary.action,
          hash: summary.lastHash,
          ts: Date.now(),
          inFlight: false,
        };
        summaryCache.set(cacheKey, persistedFail);
        persistSummary(cacheKey, persistedFail).catch((e) => {
          console.error(
            "session-manager persistSummary error",
            (e as Error).message,
          );
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
    clearInterval(cleanupInterval);
  }) as any;

  dispose.__getCurrentState = () => ({
    msgs,
    summary: { ...summary },
  });

  // External hook: when a user sends a new message, immediately
  // treat it as recent activity and reschedule polling to fast cadence
  (dispose as any).__notifyUserMessageSent = () => {
    lastChangeTs = Date.now();
    scheduleNextPoll();
  };

  return dispose;
}
