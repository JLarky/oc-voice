// server.ts - Bun HTTP server serving index.html, bundled client, and API endpoints

const port = 3000;

import { rename } from "fs/promises";
import { createOpencodeClient } from "@opencode-ai/sdk";
import {
  listMessages,
  sendMessage as rawSendMessage,
  FIRST_MESSAGE_INSTRUCTION,
} from "./src/oc-client";
import { shouldReuseSummary } from "./src/hash";

// In-memory IP address key-value store (simple list of IPs)
// Accepts only IPv4 dotted quads; prevents duplicates.
const ipStore: string[] = [];
function addIp(ip: string) {
  const trimmed = ip.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return false;
  if (!ipStore.includes(trimmed)) ipStore.push(trimmed);
  return true;
}
function removeIp(ip: string) {
  const idx = ipStore.indexOf(ip.trim());
  if (idx === -1) return false;
  ipStore.splice(idx, 1);
  return true;
}
const IP_STORE_FILE = "ip-store.json";
async function loadIps() {
  try {
    const text = await Bun.file(IP_STORE_FILE).text();
    const arr = JSON.parse(text);
    if (Array.isArray(arr))
      arr.forEach((v) => typeof v === "string" && addIp(v));
  } catch {
    /* no existing file */
  }
}
async function persistIps() {
  try {
    const json = JSON.stringify(ipStore);
    console.log("Persist write start", { count: ipStore.length });
    await Bun.write(IP_STORE_FILE + ".tmp", json);
    await rename(IP_STORE_FILE + ".tmp", IP_STORE_FILE);
    console.log("Persist rename complete");
  } catch (e) {
    console.error("Persist IPs failed", (e as Error).message);
    // Fallback direct write (non-atomic) so we at least have data
    try {
      await Bun.write(IP_STORE_FILE, JSON.stringify(ipStore));
      console.log("Fallback direct write complete");
    } catch (e2) {
      console.error("Fallback persist failed", (e2 as Error).message);
    }
  }
}
await loadIps();

function resolveBaseUrl(ip: string) {
  return `http://${ip}:2000`;
}

// Per-IP ephemeral session cache (5s TTL)
interface CachedSessions {
  list: { id: string; title?: string }[];
  fetchedAt: number;
}
const cachedSessionsByIp: Record<string, CachedSessions | null> = {};
// Per-session summary cache to avoid repeated summarizer calls when no new messages
const summaryCacheBySession: Record<
  string,
  { messageHash: string; summary: string; action: boolean; cachedAt: number }
> = {};
const SUMMARY_CACHE_TTL_MS = 15 * 60 * 1000; // 15m max retention
const SUMMARY_NEGATIVE_TTL_MS = 60 * 1000; // 1m for failed summaries
let lastSummaryPrune = Date.now();
// Track in-flight asynchronous summarization per session key to avoid duplicate calls
const SUMMARY_DEBOUNCE_MS = 2000; // delay before starting summarization to batch bursts
const summaryDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const inFlightSummary: Record<string, boolean> = {};

const firstMessageSeen = new Set<string>();
const inFlightFirstMessage: Record<string, boolean> = {};

// Escape HTML
import {
  escapeHtml,
  sendDatastarPatchElements,
  renderSessionDetailPage,
  renderSessionsListPage,
} from "./rendering";
import { renderStatusDiv, renderResultDiv, renderSessionCreateResult, renderSessionDeleteResult, renderSessionsClearedResult, renderMessageReplyResult, renderMessageErrorResult, renderNoTextResult, renderMessagesList, renderAutoScrollScriptEvent } from './rendering/fragments';
import { renderSessionsUl, renderIpsUl, renderMessageItems } from "./rendering";

// Read persisted summarizer session id (if any) for highlighting; returns string or undefined
async function readSummarizerId(): Promise<string | undefined> {
  try {
    const text = await Bun.file('playpen/summarizer-config.json').text();
    const data = JSON.parse(text);
    const id = data && typeof data.summarizerSessionId === 'string' ? data.summarizerSessionId : undefined;
    return id;
  } catch {
    return undefined;
  }
}

// Fetch sessions fresh for an IP (no cache usage, but populates cache for quick create-session reflection)
async function fetchSessionsFresh(ip: string) {
  const base = resolveBaseUrl(ip);
  console.log("sessions fetch start", { ip, base });
  try {
    const client = createOpencodeClient({ baseUrl: base });
    const remote = await client.session.list().catch((e: any) => {
      console.warn("SDK session.list error", {
        ip,
        msg: (e && e.message) || String(e),
      });
      return null;
    });
    console.log("SDK session.list raw", {
      ip,
      type: remote && typeof remote,
      keys: remote && Object.keys(remote as any),
      value: remote,
    });
    let list: { id: string; title?: string }[] = [];
    if (Array.isArray(remote)) {
      list = remote.map((r) => ({ id: r.id, title: r.title }));
    } else if (remote && typeof remote === "object") {
      const arr = (remote as any).data || (remote as any).sessions;
      if (Array.isArray(arr))
        list = arr.map((r: any) => ({ id: r.id, title: r.title }));
    }
    if (!list.length) {
      try {
        const rawRes = await fetch(`${base}/session`);
        console.log("raw /session status", { ip, status: rawRes.status });
        if (rawRes.ok) {
          const rawJson = await rawRes.json().catch((e: any) => {
            console.warn("raw /session json parse error", {
              ip,
              msg: (e && e.message) || String(e),
            });
            return null;
          });
          console.log("raw /session json", { ip, value: rawJson });
          const rawArr = Array.isArray(rawJson)
            ? rawJson
            : rawJson?.sessions || rawJson?.data;
          if (Array.isArray(rawArr))
            list = rawArr.map((r: any) => ({ id: r.id, title: r.title }));
        }
      } catch (e) {
        console.warn("raw /session fetch error", {
          ip,
          msg: (e as Error).message,
        });
      }
    }
    const now = Date.now();
    const existing = cachedSessionsByIp[ip];
    if (existing) {
      existing.list = list;
      existing.fetchedAt = now;
    } else {
      cachedSessionsByIp[ip] = { list, fetchedAt: now };
    }
    console.log("sessions fetch complete", { ip, count: list.length });
    return list;
  } catch (e) {
    console.error("Failed to list sessions", ip, (e as Error).message);
    return [];
  }
}

// SSE of sessions for an IP
function sessionsSSE(ip: string): Response {
  let interval: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        try {
          const list = await fetchSessionsFresh(ip);
          const html = renderSessionsUl(ip, list, await readSummarizerId());
          const statusHtml = renderStatusDiv('sessions-status', `Updated ${new Date().toLocaleTimeString()}`);
          try {
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(statusHtml)),
            );
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(html)),
            );
          } catch (e) {
            if (interval) clearInterval(interval);
            controller.close();
          }
        } catch (e) {
          console.error("Sessions SSE push error", (e as Error).message);
        }
      }
      await push();
      interval = setInterval(push, 5000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Fetch messages for a session at IP
async function fetchMessages(ip: string, sessionId: string) {
  const base = resolveBaseUrl(ip);
  try {
    const textMessages = await listMessages(base, sessionId);
    return textMessages.map((msg) => ({
      role: msg.role,
      text: msg.texts.join("\n"),
      parts: msg.texts.map((text) => ({ type: "text", text })),
    }));
  } catch (e) {
    console.error(
      "Failed to fetch messages",
      ip,
      sessionId,
      (e as Error).message,
    );
    return [];
  }
}

// SSE for messages
function messagesSSE(ip: string, sessionId: string): Response {
  let interval: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        try {
          const messages = await fetchMessages(ip, sessionId);
          const displayMessages =
            messages.length > 10 ? messages.slice(-10) : messages;
          const messageItems = renderMessageItems(displayMessages as any);
          // Build or reuse summarizer-based summary using dedicated summarizer session (non-blocking)
          let summaryText = "(no recent messages)";
          const skipSummary = messages.length === 0;
          const totalCount = messages.length;
          const cacheKey = `${ip}::${sessionId}`;
          // Periodic prune
          const nowTs = Date.now();
          if (nowTs - lastSummaryPrune > 30000) {
            let removed = 0;
            for (const k in summaryCacheBySession) {
              const entry = summaryCacheBySession[k];
              const age = nowTs - entry.cachedAt;
              if (
                (entry.summary === "(summary failed)" &&
                  age > SUMMARY_NEGATIVE_TTL_MS) ||
                age > SUMMARY_CACHE_TTL_MS
              ) {
                delete summaryCacheBySession[k];
                removed++;
              }
            }
            if (removed) console.log("summary cache pruned", { removed });
            lastSummaryPrune = nowTs;
          }
          const cached = summaryCacheBySession[cacheKey];
          const recentForHash = messages.slice(-3).map((m: any) => ({
            role: m.role || "message",
            text: (m.parts?.[0]?.text || m.text || "")
              .replace(/\s+/g, " ")
              .trim(),
          }));
          const { hash: recentHash, reuse } = shouldReuseSummary(
            cached?.messageHash,
            recentForHash,
          );
          if (reuse && cached) {
            summaryText = cached.summary;
            console.log("summary reuse", { cacheKey, hash: recentHash });
          } else {
            summaryText = skipSummary ? "(no recent messages)" : "...";
            // Debounce summary recompute to batch rapid message bursts
            if (summaryDebounceTimers[cacheKey]) {
              clearTimeout(summaryDebounceTimers[cacheKey]);
              delete summaryDebounceTimers[cacheKey];
            }
            const lastRole = messages[messages.length - 1]?.role || ""; // only summarize after assistant turn
            const shouldSummarize = lastRole === "assistant";
            if (!skipSummary && shouldSummarize && !inFlightSummary[cacheKey]) {
              summaryDebounceTimers[cacheKey] = setTimeout(() => {
                delete summaryDebounceTimers[cacheKey];
                if (inFlightSummary[cacheKey]) return; // guard if already running
                inFlightSummary[cacheKey] = true;
                console.log("summary recompute start", {
                  cacheKey,
                  oldHash: cached?.messageHash,
                  newHash: recentHash,
                });
                (async () => {
                  try {
                    const remoteBase = resolveBaseUrl(ip);
                    const { summarizeMessages } = await import(
                      "./src/oc-client"
                    );
                    const summ = await summarizeMessages(
                      remoteBase,
                      recentForHash,
                      sessionId,
                    );
                    if (summ.ok) {
                      summaryCacheBySession[cacheKey] = {
                        messageHash: recentHash,
                        summary: summ.summary || "(empty summary)",
                        action: summ.action,
                        cachedAt: Date.now(),
                      };
                      console.log("summary recompute success", {
                        cacheKey,
                        hash: recentHash,
                      });
                    } else {
                      summaryCacheBySession[cacheKey] = {
                        messageHash: recentHash,
                        summary: "(summary failed)",
                        action: false,
                        cachedAt: Date.now(),
                      };
                      console.warn("summary recompute failed", {
                        cacheKey,
                        hash: recentHash,
                      });
                    }
                  } catch (e) {
                    console.error(
                      "Summarizer summary error",
                      (e as Error).message,
                    );
                  } finally {
                    delete inFlightSummary[cacheKey];
                  }
                })();
              }, SUMMARY_DEBOUNCE_MS);
            }
          }
          const cacheAfter = summaryCacheBySession[cacheKey];
          const actionFlag = cacheAfter
            ? cacheAfter.action
            : /\|\s*action\s*=\s*yes/i.test(summaryText);
          const html = renderMessagesList(messageItems.split(/(?<=<\/div>)/g).filter(Boolean), escapeHtml(summaryText), actionFlag, totalCount);
          const statusHtml = renderStatusDiv('messages-status', `Updated ${new Date().toLocaleTimeString()}`);
          try {
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(statusHtml)),
            );
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(html)),
            );
            controller.enqueue(
              new TextEncoder().encode(
                renderAutoScrollScriptEvent(),
              ),
            );
          } catch (e) {
            if (interval) clearInterval(interval);
            controller.close();
          }
        } catch (e) {
          console.error("Messages SSE push error", (e as Error).message);
        }
      }
      await push();
      interval = setInterval(push, 2000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// SSE of IP addresses
function ipsSSE(): Response {
  let interval: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      function build() {
        try {
          const html = renderIpsUl(ipStore);
          const statusHtml = renderStatusDiv('ips-status', `Updated ${new Date().toLocaleTimeString()}`);
          try {
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(statusHtml)),
            );
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(html)),
            );
          } catch (e) {
            if (interval) clearInterval(interval);
            controller.close();
          }
        } catch (e) {
          console.error("IPs SSE build error", (e as Error).message);
        }
      }
      build();
      interval = setInterval(build, 5000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const server = Bun.serve({
  port,
  async fetch(req: Request) {
    const url = new URL(req.url);

    // Add IP address
    if (url.pathname === "/ips/add" && req.method === "POST") {
      try {
        // Datastar sends FormData as JSON-like object with both lowercase & original casing
        const bodyText = await req.text();
        let ip = "";
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            if (typeof parsed.ip === "string") ip = parsed.ip.trim();
            else if (typeof parsed.IP === "string") ip = parsed.IP.trim();
          } catch {
            const params = new URLSearchParams(bodyText);
            const p = params.get("ip") || params.get("IP");
            if (p) ip = p.trim();
            else {
              const match = bodyText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
              if (match) ip = match[0];
            }
          }
        }
        ip = ip.trim();
        if (ip && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) ip = "";
        let ok = false;
        if (ip) ok = addIp(ip);
        if (ok) await persistIps();
        console.log("Add IP attempt", { raw: bodyText, parsedIp: ip, ok });
        const resultHtml = renderResultDiv('add-ip-result', ok ? `Added IP: ${escapeHtml(ip)}` : 'Invalid or duplicate IP');
        const listHtml = renderIpsUl(ipStore);
        const stream =
          sendDatastarPatchElements(resultHtml) +
          sendDatastarPatchElements(listHtml);
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
      } catch (e) {
        const msg = escapeHtml((e as Error).message);
        const html = `<div id=\"add-ip-result\" class=\"result\">Error: ${msg}</div>`;
        return new Response(sendDatastarPatchElements(html), {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          status: 500,
        });
      }
    }

    // Remove IP (legacy body-based)
    if (url.pathname === "/ips/remove" && req.method === "POST") {
      try {
        const bodyText = await req.text();
        let ip = "";
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText);
            if (typeof parsed.ip === "string") ip = parsed.ip.trim();
            else if (typeof parsed.IP === "string") ip = parsed.IP.trim();
          } catch {
            const params = new URLSearchParams(bodyText);
            const p = params.get("ip") || params.get("IP");
            if (p) ip = p.trim();
            else {
              const match = bodyText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
              if (match) ip = match[0];
            }
          }
        }
        if (!ip) {
          const qp = url.searchParams.get("ip") || url.searchParams.get("IP");
          if (qp) ip = qp.trim();
        }
        ip = ip.trim();
        if (ip && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) ip = "";
        let ok = false;
        if (ip) ok = removeIp(ip);
        if (ok) await persistIps();
        console.log("Remove IP attempt", { raw: bodyText, parsedIp: ip, ok });
        const resultHtml = `<div id=\"add-ip-result\" class=\"result\">${
          ok
            ? "Removed IP: " + escapeHtml(ip)
            : ip
              ? "IP not found"
              : "No IP provided"
        }</div>`;
        const listHtml = renderIpsUl(ipStore);
        const stream =
          sendDatastarPatchElements(resultHtml) +
          sendDatastarPatchElements(listHtml);
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
      } catch (e) {
        const msg = escapeHtml((e as Error).message);
        const html = `<div id=\"add-ip-result\" class=\"result\">Error: ${msg}</div>`;
        return new Response(sendDatastarPatchElements(html), {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          status: 500,
        });
      }
    }

    // Remove IP via path: POST /ips/remove/:ip
    if (url.pathname.startsWith("/ips/remove/") && req.method === "POST") {
      const parts = url.pathname.split("/").filter(Boolean); // ['ips','remove','ip']
      if (parts.length === 3) {
        const ip = parts[2].trim();
        let ok = false;
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) ok = removeIp(ip);
        if (ok) await persistIps();
        console.log("Remove IP path attempt", { ip, ok });
        const resultHtml = `<div id=\"add-ip-result\" class=\"result\">${
          ok ? "Removed IP: " + escapeHtml(ip) : "IP not found"
        }</div>`;
        const listHtml = renderIpsUl(ipStore);
        const stream =
          sendDatastarPatchElements(resultHtml) +
          sendDatastarPatchElements(listHtml);
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
      }
    }

    // IP list SSE
    if (url.pathname === "/ips/stream") return ipsSSE();

    // Sessions list SSE for given IP: /sessions/:ip/stream
    if (
      url.pathname.startsWith("/sessions/") &&
      url.pathname.endsWith("/stream")
    ) {
      const parts = url.pathname.split("/").filter(Boolean); // ['sessions', ip, 'stream']
      if (parts.length === 3) {
        const ip = parts[1];
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        return sessionsSSE(ip);
      }
    }

    // Create session for IP: POST /sessions/:ip/create-session
    if (
      url.pathname.startsWith("/sessions/") &&
      url.pathname.endsWith("/create-session") &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/").filter(Boolean); // ['sessions','ip','create-session']
      if (parts.length === 3) {
        const ip = parts[1];
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        try {
          const bodyText = await req.text();
          let title = "new session";
          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText);
              if (typeof parsed.title === "string" && parsed.title.trim())
                title = parsed.title.trim();
            } catch {
              /* ignore */
            }
          }
          const base = resolveBaseUrl(ip);
          const client = createOpencodeClient({ baseUrl: base });
          let created: any;
          try {
            created = await client.session.create({ body: { title } });
            console.log("SDK session.create raw:", created);
          } catch (e) {
            console.warn(
              "SDK create failed, trying raw endpoint:",
              (e as Error).message,
            );
            const rawRes = await fetch(`${base}/session`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
            if (!rawRes.ok) throw new Error(`Create ${rawRes.status}`);
            created = await rawRes.json();
          }
          let sessionId = (created as any)?.id;
          if (!sessionId) {
            const data = (created as any)?.data || created;
            sessionId = data?.id;
          }
          if (!sessionId || typeof sessionId !== "string")
            throw new Error(
              `Session creation returned invalid ID: ${JSON.stringify(created)}`,
            );
          // Inject into per-IP cache
          const entry = {
            id: sessionId,
            title: (created as any)?.title || title,
          };
          const now = Date.now();
          const existing = cachedSessionsByIp[ip];
          if (existing) {
            const ids = new Set(existing.list.map((s) => s.id));
            if (!ids.has(entry.id)) existing.list.unshift(entry);
            existing.fetchedAt = now;
          } else {
            cachedSessionsByIp[ip] = { list: [entry], fetchedAt: now };
          }

          const html = renderSessionCreateResult(ip, entry.id);
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        } catch (e) {
          const msg = escapeHtml((e as Error).message);
          const html = renderResultDiv('create-session-result', `Error: ${msg}`);
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            status: 500,
          });
        }
      }
    }

    // Delete session for IP: POST /sessions/:ip/:sid/delete-session
    if (
      url.pathname.startsWith("/sessions/") &&
      url.pathname.endsWith("/delete-session") &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/").filter(Boolean); // ['sessions', ip, sid, 'delete-session']
      if (parts.length === 4 && parts[3] === "delete-session") {
        const ip = parts[1];
        const sid = parts[2];
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        let deletedOk = false;
        const base = resolveBaseUrl(ip);
        try {
          const client = createOpencodeClient({ baseUrl: base });
          try {
            const d = await (client as any).session.delete?.({
              params: { id: sid },
            });
            if (
              d &&
              (d.id === sid ||
                (d as any).data?.id === sid ||
                (d as any).ok ||
                (d as any).status === "ok")
            ) {
              deletedOk = true;
            }
          } catch (e) {
            console.warn("SDK delete failed", (e as Error).message);
          }
          if (!deletedOk) {
            try {
              const rawRes = await fetch(`${base}/session/${sid}`, {
                method: "DELETE",
              });
              if (rawRes.ok) deletedOk = true;
            } catch {}
          }
        } catch (e) {
          console.error("Delete session route error", (e as Error).message);
        }
        if (deletedOk) {
          const cache = cachedSessionsByIp[ip];
          if (cache && Array.isArray(cache.list)) {
            cache.list = cache.list.filter((s) => s.id !== sid);
          }
        }
        // Refresh list (best effort)
        await fetchSessionsFresh(ip).catch(() => null);
        const cache = cachedSessionsByIp[ip];
        const list = cache?.list || [];
        const listHtml = renderSessionsUl(ip, list, await readSummarizerId());
        const resultHtml = renderSessionDeleteResult(sid, deletedOk);
        const stream =
          sendDatastarPatchElements(resultHtml) +
          sendDatastarPatchElements(listHtml);
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          status: deletedOk ? 200 : 500,
        });
      }
    }
    // Clear all sessions for IP: POST /sessions/:ip/clear-sessions
    if (
      url.pathname.startsWith("/sessions/") &&
      url.pathname.endsWith("/clear-sessions") &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/").filter(Boolean); // ['sessions','ip','clear-sessions']
      if (parts.length === 3 && parts[2] === "clear-sessions") {
        const ip = parts[1];
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        let deletedCount = 0;
        let total = 0;
        const base = resolveBaseUrl(ip);
        try {
          // Fetch latest list to ensure we attempt all existing sessions
          const list = await fetchSessionsFresh(ip);
          const ids = list
            .map((s) => s.id)
            .filter((id) => typeof id === "string" && id.trim());
          total = ids.length;
          for (const sid of ids) {
            let deletedOk = false;
            try {
              const client = createOpencodeClient({ baseUrl: base });
              try {
                const d = await (client as any).session.delete?.({
                  params: { id: sid },
                });
                if (
                  d &&
                  (d.id === sid ||
                    (d as any).data?.id === sid ||
                    (d as any).ok ||
                    (d as any).status === "ok")
                ) {
                  deletedOk = true;
                }
              } catch (e) {
                console.warn("SDK delete failed (bulk)", (e as Error).message);
              }
              if (!deletedOk) {
                try {
                  const rawRes = await fetch(`${base}/session/${sid}`, {
                    method: "DELETE",
                  });
                  if (rawRes.ok) deletedOk = true;
                } catch {}
              }
            } catch (e) {
              console.error(
                "Bulk delete session error",
                sid,
                (e as Error).message,
              );
            }
            if (deletedOk) deletedCount++;
          }
        } catch (e) {
          console.error("Clear sessions route error", (e as Error).message);
        }
        // Reset cache for IP (will be repopulated on next fetch)
        const cache = cachedSessionsByIp[ip];
        if (cache) cache.list = [];
        // Best-effort refresh (in case some deletions failed and we want fresh remaining list)
        await fetchSessionsFresh(ip).catch(() => null);
        const afterCache = cachedSessionsByIp[ip];
        const remainingList = afterCache?.list || [];
        const listHtml = renderSessionsUl(ip, remainingList, await readSummarizerId());
        const resultHtml = renderSessionsClearedResult(deletedCount, total);
        const stream =
          sendDatastarPatchElements(resultHtml) +
          sendDatastarPatchElements(listHtml);
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          status: 200,
        });
      }
    }
    // Messages SSE: /sessions/:ip/:sid/messages/stream
    if (
      url.pathname.startsWith("/sessions/") &&
      url.pathname.endsWith("/messages/stream")
    ) {
      const parts = url.pathname.split("/").filter(Boolean); // ['sessions', ip, sid, 'messages','stream']
      if (
        parts.length === 5 &&
        parts[3] === "messages" &&
        parts[4] === "stream"
      ) {
        const ip = parts[1];
        const sid = parts[2];
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        return messagesSSE(ip, sid);
      }
    }

    // Send message: POST /sessions/:ip/:sid/message
    if (
      url.pathname.startsWith("/sessions/") &&
      url.pathname.endsWith("/message") &&
      req.method === "POST"
    ) {
      const parts = url.pathname.split("/").filter(Boolean); // ['sessions', ip, sid, 'message']
      if (parts.length === 4 && parts[3] === "message") {
        const ip = parts[1];
        const sid = parts[2];
        if (!ipStore.includes(ip))
          return new Response("Unknown IP", { status: 404 });
        try {
          const bodyText = await req.text();
          let text = "";
          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText);
              if (
                typeof parsed.messageText === "string" &&
                parsed.messageText.trim()
              )
                text = parsed.messageText.trim();
              else if (
                typeof parsed.messagetext === "string" &&
                parsed.messagetext.trim()
              )
                text = parsed.messagetext.trim();
              else if (typeof parsed.text === "string" && parsed.text.trim())
                text = parsed.text.trim();
              else if (Array.isArray(parsed.parts)) {
                const part = parsed.parts.find((p: any) => p?.type === "text");
                if (part && typeof part.text === "string" && part.text.trim())
                  text = part.text.trim();
              }
            } catch {
              /* ignore */
            }
          }
          if (!text)
            return new Response(
              sendDatastarPatchElements(
                renderNoTextResult(),
              ),
              {
                headers: { "Content-Type": "text/event-stream; charset=utf-8" },
              },
            );
          // First message injection logic
          const sessionKey = sid;
          let injected = false;
          try {
            if (
              !firstMessageSeen.has(sessionKey) &&
              !inFlightFirstMessage[sessionKey]
            ) {
              inFlightFirstMessage[sessionKey] = true;
              // Remote check to avoid misfire if messages already exist
              let existingCount = 0;
              try {
                const existing = await listMessages(
                  resolveBaseUrl(ip),
                  sid,
                ).catch(() => []);
                existingCount = existing.length;
              } catch {}
              if (existingCount === 0) {
                // Prepend system-style instruction
                text = FIRST_MESSAGE_INSTRUCTION + "\n\n" + text;
                injected = true;
              }
              firstMessageSeen.add(sessionKey);
              delete inFlightFirstMessage[sessionKey];
            }
          } catch {
            delete inFlightFirstMessage[sessionKey];
          }
          console.log("Message send start", { ip, sid, text, injected });
          const result = await rawSendMessage(resolveBaseUrl(ip), sid, text);
          if (!result.ok) {
            const msg = escapeHtml(result.error || `HTTP ${result.status}`);
            const html = renderMessageErrorResult(msg);
            return new Response(sendDatastarPatchElements(html), {
              headers: { "Content-Type": "text/event-stream; charset=utf-8" },
              status: result.status || 500,
            });
          }
          const joined = result.replyTexts.join("\n") || "(no reply)";
          const escaped = escapeHtml(
            joined.substring(0, 50) + (joined.length > 50 ? "..." : ""),
          );
          const html = renderMessageReplyResult(escaped);
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        } catch (e) {
          console.error("Message route error", (e as Error).message);
          const msg = escapeHtml((e as Error).message);
          const html = renderMessageErrorResult(msg);
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            status: 500,
          });
        }
      }
    }

    // Session detail page: GET /sessions/:ip/:sid
    if (url.pathname.startsWith("/sessions/")) {
      const parts = url.pathname.split("/").filter(Boolean); // ['sessions', ip, sid]
      if (
        parts.length === 3 &&
        req.method === "GET" &&
        parts[0] === "sessions"
      ) {
        const ip = parts[1];
        const sid = parts[2];
        if (!ipStore.includes(ip)) return Response.redirect("/", 302);
        // Validate session exists (best effort)
        try {
          const base = resolveBaseUrl(ip);
          const client = createOpencodeClient({ baseUrl: base });
          let exists = false;
          try {
            const detail = await (client as any).session.get?.({
              params: { id: sid },
            });
            if (detail && detail.id === sid) exists = true;
          } catch {
            /* ignore */
          }
          if (!exists) {
            try {
              const rawRes = await fetch(`${base}/session/${sid}`);
              if (rawRes.ok) {
                const rawJson = await rawRes.json().catch(() => null);
                if (rawJson && rawJson.id === sid) exists = true;
              }
            } catch {
              /* ignore */
            }
          }
          if (!exists) {
            try {
              const list = await client.session.list();
              exists =
                Array.isArray(list) && list.some((s: any) => s.id === sid);
            } catch {
              /* ignore */
            }
          }
          if (!exists)
            return Response.redirect(
              `/sessions/${encodeURIComponent(ip)}`,
              302,
            );
        } catch {
          /* ignore */
        }
        let sessionTitle = "";
        try {
          const base = resolveBaseUrl(ip);
          const cache = cachedSessionsByIp[ip];
          if (cache && Array.isArray(cache.list)) {
            const found = cache.list.find((s) => s.id === sid);
            if (found && typeof found.title === "string")
              sessionTitle = found.title.trim();
          }
          if (!sessionTitle) {
            try {
              const client2 = createOpencodeClient({ baseUrl: base });
              const list2 = await client2.session.list().catch(() => []);
              if (Array.isArray(list2)) {
                const found2 = list2.find((s: any) => s && s.id === sid);
                if (found2) {
                  const t =
                    (found2 as any).title || (found2 as any).data?.title;
                  if (typeof t === "string" && t.trim())
                    sessionTitle = t.trim();
                }
              }
            } catch {}
          }
          if (!sessionTitle) {
            try {
              const rawRes2 = await fetch(`${base}/session/${sid}`);
              if (rawRes2.ok) {
                const rawJson2 = await rawRes2.json().catch(() => null);
                if (rawJson2 && rawJson2.id === sid) {
                  const t =
                    (rawJson2 as any).title || (rawJson2 as any).data?.title;
                  if (typeof t === "string" && t.trim())
                    sessionTitle = t.trim();
                }
              }
            } catch {}
          }
        } catch {}
        const page = renderSessionDetailPage({
          ip,
          sessionId: sid,
          sessionTitle,
        });
        return new Response(page, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      // Sessions list page: GET /sessions/:ip
      if (
        parts.length === 2 &&
        req.method === "GET" &&
        parts[0] === "sessions"
      ) {
        const ip = parts[1];
        if (!ipStore.includes(ip)) return Response.redirect("/", 302);
        const page = renderSessionsListPage({ ip });
        return new Response(page, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    // Home page
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("index.html"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/client.js") {
      return new Response(Bun.file("public/client.js"), {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${port}`);
export { server };
