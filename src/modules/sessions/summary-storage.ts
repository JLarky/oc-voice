import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import fsDriver from "unstorage/drivers/fs";
// Memory + filesystem tier: memory for hot reads, fs for persistence across restarts.
// Filesystem path is gitignored via `storage/` entry in .gitignore.

export interface PersistedSummary {
  summary: string;
  action: boolean;
  hash: string;
  ts: number;
}

// Memory hot tier
const memStorage = createStorage({ driver: memoryDriver() });
// Filesystem persistence tier (gitignored path)
const fsStorage = createStorage({
  driver: fsDriver({ base: "storage/summaries" }),
});
const PREFIX = "summary:";

export async function loadPersistedSummary(
  key: string,
): Promise<PersistedSummary | null> {
  try {
    // Try memory first
    const memRaw = await memStorage.getItem<string>(PREFIX + key);
    if (memRaw) {
      try {
        const parsed: PersistedSummary = JSON.parse(memRaw);
        return validate(parsed);
      } catch {
        // fall through to fs
      }
    }
    const fsRaw = await fsStorage.getItem<string>(PREFIX + key);
    if (!fsRaw) return null;
    try {
      const parsed: PersistedSummary = JSON.parse(fsRaw);
      // Warm memory tier
      await memStorage.setItem(PREFIX + key, fsRaw);
      return validate(parsed);
    } catch (e) {
      console.error("summary-storage parse error", (e as Error).message);
      return null;
    }
  } catch (e) {
    console.error("summary-storage load error", (e as Error).message);
    return null;
  }
}

function validate(val: PersistedSummary): PersistedSummary {
  if (typeof val.summary !== "string") val.summary = "";
  if (typeof val.action !== "boolean") val.action = false;
  if (typeof val.hash !== "string") val.hash = "";
  if (typeof val.ts !== "number") val.ts = Date.now();
  return val;
}

export async function persistSummary(
  key: string,
  data: PersistedSummary,
): Promise<void> {
  try {
    const validated = validate({ ...data });
    const raw = JSON.stringify(validated);
    await memStorage.setItem(PREFIX + key, raw);
    await fsStorage.setItem(PREFIX + key, raw);
  } catch (e) {
    console.error("summary-storage persist error", (e as Error).message);
  }
}

export async function pruneExpired(
  ttlSuccessMs: number,
  ttlFailMs: number,
): Promise<void> {
  try {
    // Use filesystem as source of truth for keys (persistent superset)
    const keys = await fsStorage.getKeys(PREFIX);
    const now = Date.now();
    for (const full of keys) {
      const raw = await fsStorage.getItem<string>(full);
      if (!raw) continue;
      let parsed: PersistedSummary | null = null;
      try {
        parsed = JSON.parse(raw) as PersistedSummary;
      } catch {
        // Corrupt entry: remove
        await fsStorage.removeItem(full);
        await memStorage.removeItem(full).catch(() => {});
        continue;
      }
      const ttl =
        parsed.summary === "(summary failed)" ? ttlFailMs : ttlSuccessMs;
      if (now - parsed.ts > ttl) {
        await fsStorage.removeItem(full);
        await memStorage.removeItem(full).catch(() => {});
      }
    }
    // Also prune any stray memory-only keys (if any)
    const memKeys = await memStorage.getKeys(PREFIX);
    for (const full of memKeys) {
      if (!keys.includes(full)) {
        const raw = await memStorage.getItem<string>(full);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as PersistedSummary;
          const ttl =
            parsed.summary === "(summary failed)" ? ttlFailMs : ttlSuccessMs;
          if (now - parsed.ts > ttl) await memStorage.removeItem(full);
        } catch {
          await memStorage.removeItem(full);
        }
      }
    }
  } catch (e) {
    console.error("summary-storage prune error", (e as Error).message);
  }
}

// Summary log retention config
const LOG_KEY = "summarylog:entries";
const MAX_LOG_ENTRIES = 20;
const MAX_PER_SESSION = 1; // store only one per session as per requirement
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // one week

interface SummaryLogEntry {
  session: string;
  summary: string;
  action: boolean;
  hash: string;
  ts: number;
}

function sanitizeEntry(e: any): SummaryLogEntry | null {
  if (!e || typeof e !== "object") return null;
  const session = typeof e.session === "string" ? e.session : "";
  const summary = typeof e.summary === "string" ? e.summary : "";
  const action = typeof e.action === "boolean" ? e.action : false;
  const hash = typeof e.hash === "string" ? e.hash : "";
  const ts = typeof e.ts === "number" ? e.ts : Date.now();
  if (!session || !summary) return null;
  return { session, summary, action, hash, ts };
}

async function loadLogRaw(): Promise<SummaryLogEntry[]> {
  try {
    const raw = await fsStorage.getItem<string>(LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: SummaryLogEntry[] = [];
    for (const item of arr) {
      const s = sanitizeEntry(item);
      if (s) out.push(s);
    }
    return out;
  } catch (e) {
    console.error("summary-storage log load error", (e as Error).message);
    return [];
  }
}

async function saveLog(entries: SummaryLogEntry[]): Promise<void> {
  try {
    const raw = JSON.stringify(entries);
    await fsStorage.setItem(LOG_KEY, raw);
  } catch (e) {
    console.error("summary-storage log save error", (e as Error).message);
  }
}

export async function appendSummaryLog(
  session: string,
  data: PersistedSummary,
): Promise<void> {
  // Exclude failed summaries
  if (data.summary === "(summary failed)") return;
  try {
    const entries = await loadLogRaw();
    const now = Date.now();
    // Remove aged out entries
    const fresh = entries.filter((e) => now - e.ts < MAX_AGE_MS);
    // Remove any existing entry for this session if we only keep one per session
    const filtered = fresh.filter((e) => e.session !== session);
    // Add new entry
    filtered.push({
      session,
      summary: data.summary,
      action: data.action,
      hash: data.hash,
      ts: data.ts,
    });
    // Sort newest first
    filtered.sort((a, b) => b.ts - a.ts);
    // Cap global count
    const capped = filtered.slice(0, MAX_LOG_ENTRIES);
    await saveLog(capped);
  } catch (e) {
    console.error("summary-storage append log error", (e as Error).message);
  }
}

export async function getRecentSummaryLog(): Promise<SummaryLogEntry[]> {
  const entries = await loadLogRaw();
  const now = Date.now();
  return entries
    .filter((e) => now - e.ts < MAX_AGE_MS)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_LOG_ENTRIES);
}

// Background prune every 30s similar to in-memory logic + log cleanup
setInterval(() => {
  pruneExpired(15 * 60 * 1000, 60 * 1000);
  // Light log maintenance: load, filter, re-save if changed
  loadLogRaw()
    .then((entries) => {
      const now = Date.now();
      const pruned = entries.filter((e) => now - e.ts < MAX_AGE_MS);
      pruned.sort((a, b) => b.ts - a.ts);
      const capped = pruned.slice(0, MAX_LOG_ENTRIES);
      // Avoid write if identical length and same newest ts
      if (
        capped.length !== entries.length ||
        (entries[0] && capped[0] && entries[0].ts !== capped[0].ts)
      ) {
        saveLog(capped);
      }
    })
    .catch(() => {});
}, 30000);
