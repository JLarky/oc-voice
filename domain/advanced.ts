// domain/advanced.ts - aggregated advanced session state & summaries
import { summarizeMessages } from "../src/oc-client";
import { shouldReuseSummary } from "../src/hash";

export interface SummaryCacheEntry {
  messageHash: string;
  summary: string;
  action: boolean;
  cachedAt: number;
}
export interface AggregatedState {
  meta: { ip: string; sessionId: string; createdAt: number };
  counts: {
    totalEvents: number;
    upstreamEvents: number;
    syntheticMessageUpdates: number;
  };
  lastMessage: { role: string; text: string };
  lastMessages: any[];
  messageCount: number;
  parts: Record<string, { type?: string; text: string; updatedAt: number }>;
  lastTypes: string[];
  lastEventTs: number;
  reconnects: number;
  summary: string;
  actionFlag: boolean;
  shareUrl?: string;
}

export interface AdvancedStores {
  aggregatedStateBySession: Record<string, AggregatedState>;
  summaryCacheBySession: Record<string, SummaryCacheEntry>;
  inFlightSummary: Record<string, boolean>;
  summaryDebounceTimers: Record<string, ReturnType<typeof setTimeout>>;
}

export const SUMMARY_CACHE_TTL_MS = 15 * 60 * 1000;
export const SUMMARY_NEGATIVE_TTL_MS = 60 * 1000;
export const SUMMARY_DEBOUNCE_MS = 2000;
export const MESSAGE_COUNT_FRESH_MS = 5000;

export function createAdvancedStores(): AdvancedStores {
  return {
    aggregatedStateBySession: {},
    summaryCacheBySession: {},
    inFlightSummary: {},
    summaryDebounceTimers: {},
  };
}

export function getAggregated(stores: AdvancedStores, ip: string, sid: string) {
  const key = ip + "::" + sid;
  let state = stores.aggregatedStateBySession[key];
  if (!state) {
    state = stores.aggregatedStateBySession[key] = {
      meta: { ip, sessionId: sid, createdAt: Date.now() },
      counts: { totalEvents: 0, upstreamEvents: 0, syntheticMessageUpdates: 0 },
      lastMessage: { role: "", text: "" },
      lastMessages: [],
      messageCount: 0,
      parts: {},
      lastTypes: [],
      lastEventTs: 0,
      reconnects: 0,
      summary: "",
      actionFlag: false,
    };
  } else {
    state.reconnects = (state.reconnects || 0) + 1;
  }
  return state;
}

export function pruneSummaryCache(stores: AdvancedStores) {
  const now = Date.now();
  for (const [key, entry] of Object.entries(stores.summaryCacheBySession)) {
    const ttl =
      entry.summary === "(summary failed)"
        ? SUMMARY_NEGATIVE_TTL_MS
        : SUMMARY_CACHE_TTL_MS;
    if (now - entry.cachedAt > ttl) delete stores.summaryCacheBySession[key];
  }
}

export async function scheduleSummarization(
  stores: AdvancedStores,
  ip: string,
  sid: string,
  recentForHash: { role: string; text: string }[],
  remoteBase: string,
) {
  const cacheKey = ip + "::" + sid;
  if (stores.inFlightSummary[cacheKey]) return;
  if (stores.summaryDebounceTimers[cacheKey]) {
    clearTimeout(stores.summaryDebounceTimers[cacheKey]);
    delete stores.summaryDebounceTimers[cacheKey];
  }
  stores.summaryDebounceTimers[cacheKey] = setTimeout(async () => {
    delete stores.summaryDebounceTimers[cacheKey];
    if (stores.inFlightSummary[cacheKey]) return;
    stores.inFlightSummary[cacheKey] = true;
    try {
      const summ = await summarizeMessages(remoteBase, recentForHash, sid);
      const msgHash = recentForHash.map((m) => m.role + m.text).join("|");
      const entry: SummaryCacheEntry = {
        messageHash: msgHash,
        summary: summ.ok
          ? summ.summary || "(empty summary)"
          : "(summary failed)",
        action: summ.ok ? summ.action : false,
        cachedAt: Date.now(),
      };
      stores.summaryCacheBySession[cacheKey] = entry;
      const agg = stores.aggregatedStateBySession[cacheKey];
      if (agg) {
        agg.summary = entry.summary;
        agg.actionFlag = entry.action;
      }
    } catch {
      const msgHash = recentForHash.map((m) => m.role + m.text).join("|");
      const entry: SummaryCacheEntry = {
        messageHash: msgHash,
        summary: "(summary failed)",
        action: false,
        cachedAt: Date.now(),
      };
      stores.summaryCacheBySession[cacheKey] = entry;
      const agg = stores.aggregatedStateBySession[cacheKey];
      if (agg) {
        agg.summary = entry.summary;
        agg.actionFlag = entry.action;
      }
    } finally {
      delete stores.inFlightSummary[cacheKey];
    }
  }, SUMMARY_DEBOUNCE_MS);
}

export function reuseOrPlaceholder(
  stores: AdvancedStores,
  ip: string,
  sid: string,
  recent: { role: string; text: string }[],
) {
  const key = ip + "::" + sid;
  const cached = stores.summaryCacheBySession[key];
  const { hash, reuse } = shouldReuseSummary(cached?.messageHash, recent);
  if (recent.length === 0)
    return { text: "(no recent messages)", action: false, reuse: false, hash };
  if (reuse && cached)
    return { text: cached.summary, action: cached.action, reuse: true, hash };
  return { text: "...", action: false, reuse: false, hash };
}
