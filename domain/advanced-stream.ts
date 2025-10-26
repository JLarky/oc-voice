// domain/advanced-stream.ts - testable helpers for advanced SSE
import {
  reuseOrPlaceholder,
  scheduleSummarization,
  AdvancedStores,
} from "./advanced";
import { listMessages } from "../src/oc-client";

export interface PollResult {
  messages: { role: string; texts: string[] }[];
  recentForDisplay: { role: string; text: string }[];
  forHash: { role: string; text: string }[];
}

export interface UpdateResult {
  summaryText: string;
  actionFlag: boolean;
  syntheticEvent?: any;
  messageCount: number;
  reuse: boolean;
}

export function computeRecent(messages: { role: string; texts: string[] }[]) {
  const recent = messages.slice(-10).map((m) => ({
    role: m.role,
    text: (m.texts.join(" ") || "").trim().slice(0, 600),
  }));
  const forHash = messages
    .slice(-3)
    .map((m) => ({ role: m.role, text: (m.texts.join(" ") || "").trim() }));
  return { recent, forHash };
}

export async function pollMessages(
  remoteBase: string,
  sid: string,
): Promise<PollResult> {
  const msgs = await listMessages(remoteBase, sid).catch(() => []);
  const { recent, forHash } = computeRecent(msgs);
  return { messages: msgs, recentForDisplay: recent, forHash };
}

export function updateAggregatedSummary(
  stores: AdvancedStores,
  ip: string,
  sid: string,
  remoteBase: string,
  forHash: { role: string; text: string }[],
  currentCount: number,
  lastCount: number,
): UpdateResult {
  const reuseInfo = reuseOrPlaceholder(stores, ip, sid, forHash);
  if (reuseInfo.text === "...")
    scheduleSummarization(stores, ip, sid, forHash, remoteBase);
  const syntheticEvent =
    currentCount !== lastCount
      ? {
          event: "session.message.update",
          data: { messageCount: currentCount },
        }
      : undefined;
  return {
    summaryText: reuseInfo.text,
    actionFlag: reuseInfo.action,
    syntheticEvent,
    messageCount: currentCount,
    reuse: reuseInfo.reuse,
  };
}

export interface PruneOptions {
  partsLimit?: number;
  typesLimit?: number;
}

export function prunePartsAndTypes(
  parts: Record<string, { updatedAt: number }>,
  types: string[],
  opts: PruneOptions = {},
) {
  const limit = opts.partsLimit ?? 200;
  const tLimit = opts.typesLimit ?? 50;
  const keys = Object.keys(parts);
  if (keys.length > limit) {
    keys.sort((a, b) => parts[a].updatedAt - parts[b].updatedAt);
    const drop = keys.slice(0, keys.length - limit);
    drop.forEach((k) => {
      delete parts[k];
    });
  }
  if (types.length > tLimit) types.splice(0, types.length - tLimit);
}
