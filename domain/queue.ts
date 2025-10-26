// domain/queue.ts - message send queue domain (extracted)
import { sendMessage } from "../src/oc-client";

export interface QueuedMessageJob {
  ip: string;
  sid: string;
  text: string;
  createdAt: number;
  id: string;
  attempts: number;
  status: "pending" | "sending" | "failed" | "sent";
  lastError?: string;
  autoRetried?: boolean;
}

// Global stores are passed in from app layer for flexibility/testing
export interface QueueStores {
  queueJobsBySession: Record<string, QueuedMessageJob[]>;
  messageSendQueue: QueuedMessageJob[];
}

export function createQueueStores(): QueueStores {
  return { queueJobsBySession: {}, messageSendQueue: [] };
}

let active = false;
export async function processMessageQueue(
  stores: QueueStores,
  resolveBaseUrl: (ip: string) => string,
  advancedAggregatedStateBySession?: Record<string, any>,
) {
  if (active) return;
  active = true;
  try {
    while (stores.messageSendQueue.length) {
      const job = stores.messageSendQueue.shift();
      if (!job) break;
      job.attempts++;
      job.status = "sending";
      const { ip, sid, text, createdAt } = job;
      try {
        const result = await sendMessage(resolveBaseUrl(ip), sid, text);
        if (!result.ok) {
          job.status = "failed";
          job.lastError = (result.error || "status " + result.status) + "";
          if (advancedAggregatedStateBySession) {
            const aggKey = ip + "::" + sid;
            const agg = advancedAggregatedStateBySession[aggKey];
            if (agg) {
              agg.summary = "(send failed: retry)";
              agg.actionFlag = false;
            }
          }
        } else {
          job.status = "sent";
          if (advancedAggregatedStateBySession) {
            const aggKey2 = ip + "::" + sid;
            const agg2 = advancedAggregatedStateBySession[aggKey2];
            if (agg2 && agg2.summary === "(send failed: retry)")
              agg2.summary = "...";
          }
        }
      } catch (e) {
        job.status = "failed";
        job.lastError = (e as Error).message;
        if (advancedAggregatedStateBySession) {
          const aggKey3 = ip + "::" + sid;
          const agg3 = advancedAggregatedStateBySession[aggKey3];
          if (agg3) {
            agg3.summary = "(send failed: retry)";
            agg3.actionFlag = false;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    active = false;
  }
}

export function enqueueMessage(
  stores: QueueStores,
  ip: string,
  sid: string,
  text: string,
  advancedAggregatedStateBySession?: Record<string, any>,
) {
  const queueKey = ip + "::" + sid;
  const existingJobs =
    stores.queueJobsBySession[queueKey] ||
    (stores.queueJobsBySession[queueKey] = []);
  const failedForRetry = [...existingJobs]
    .reverse()
    .find((j) => j.status === "failed" && !j.autoRetried);
  if (failedForRetry) {
    const retryJob: QueuedMessageJob = {
      ip,
      sid,
      text: failedForRetry.text,
      createdAt: Date.now(),
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      attempts: 0,
      status: "pending",
      autoRetried: true,
    };
    stores.messageSendQueue.push(retryJob);
    existingJobs.push(retryJob);
    failedForRetry.autoRetried = true;
    if (advancedAggregatedStateBySession) {
      const aggKey = ip + "::" + sid;
      const agg = advancedAggregatedStateBySession[aggKey];
      if (agg && agg.summary === "(send failed: retry)") agg.summary = "...";
    }
  }
  const job: QueuedMessageJob = {
    ip,
    sid,
    text,
    createdAt: Date.now(),
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    attempts: 0,
    status: "pending",
  };
  stores.messageSendQueue.push(job);
  existingJobs.push(job);
  return { queueKey, length: stores.messageSendQueue.length };
}

export function retryLastFailed(
  stores: QueueStores,
  ip: string,
  sid: string,
  advancedAggregatedStateBySession?: Record<string, any>,
) {
  const queueKey = ip + "::" + sid;
  const jobs = stores.queueJobsBySession[queueKey] || [];
  const failed = [...jobs].reverse().find((j) => j.status === "failed");
  if (!failed) return { ok: false, error: "no failed job" };
  const newJob: QueuedMessageJob = {
    ip,
    sid,
    text: failed.text,
    createdAt: Date.now(),
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    attempts: 0,
    status: "pending",
  };
  stores.messageSendQueue.push(newJob);
  jobs.push(newJob);
  if (advancedAggregatedStateBySession) {
    const agg = advancedAggregatedStateBySession[ip + "::" + sid];
    if (agg) agg.summary = "...";
  }
  return { ok: true };
}
