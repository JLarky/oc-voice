// server.ts - Bun HTTP server serving index.html, bundled client, and API endpoints

const port = 3000;

import { rename } from "fs/promises";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { listMessages, sendMessage as rawSendMessage } from "./src/oc-client";
import { shouldReuseSummary } from './src/hash';

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
const summaryCacheBySession: Record<string, { messageHash: string; summary: string; action: boolean; cachedAt: number }> = {};
const SUMMARY_CACHE_TTL_MS = 15 * 60 * 1000; // 15m max retention
const SUMMARY_NEGATIVE_TTL_MS = 60 * 1000; // 1m for failed summaries
let lastSummaryPrune = Date.now();
// Track in-flight asynchronous summarization per session key to avoid duplicate calls
const inFlightSummary: Record<string, boolean> = {};


// Escape HTML
const ESCAPE_RE = /[&<>"]/g;
const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function escapeHtml(text: string): string {
  if (typeof text !== 'string' || text === '') return String(text || '');
  ESCAPE_RE.lastIndex = 0;
  if (!ESCAPE_RE.test(text)) return text;
  ESCAPE_RE.lastIndex = 0;
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ESCAPE_RE.exec(text))) {
    const i = match.index;
    out += text.slice(lastIndex, i) + ESCAPE_MAP[text[i]];
    lastIndex = i + 1;
  }
  return out + text.slice(lastIndex);
}

// Datastar patch helper
function sendDatastarPatchElements(html: string): string {
  const lines = html.split("\n");
  let result = "event: datastar-patch-elements\n";
  lines.forEach((line) => {
    result += `data: elements ${line}\n`;
  });
  result += "\n";
  return result;
}

// Fetch sessions fresh for an IP (no cache usage, but populates cache for quick create-session reflection)
async function fetchSessionsFresh(ip: string) {
  const base = resolveBaseUrl(ip);
  try {
    const client = createOpencodeClient({ baseUrl: base });
    const remote = await client.session.list().catch(() => null);
    let list: { id: string; title?: string }[] = [];
    if (Array.isArray(remote))
      list = remote.map((r) => ({ id: r.id, title: r.title }));
    else if (remote && typeof remote === "object") {
      const arr = (remote as any).data || (remote as any).sessions;
      if (Array.isArray(arr))
        list = arr.map((r: any) => ({ id: r.id, title: r.title }));
    }
    if (!list.length) {
      try {
        const rawRes = await fetch(`${base}/session`);
        if (rawRes.ok) {
          const rawJson = await rawRes.json().catch(() => null);
          const rawArr = Array.isArray(rawJson)
            ? rawJson
            : rawJson?.sessions || rawJson?.data;
          if (Array.isArray(rawArr))
            list = rawArr.map((r: any) => ({ id: r.id, title: r.title }));
        }
      } catch {
        /* ignore */
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
    return list;
  } catch (e) {
    console.error("Failed to list sessions", ip, (e as Error).message);
    return [];
  }
}

// SSE of sessions for an IP
function sessionsSSE(ip: string): Response {
  let interval: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        try {
          const list = await fetchSessionsFresh(ip);
          const sessionItems = list.length
            ? list
                .map(
                  (s) =>
                    `<li><a href="/sessions/${escapeHtml(ip)}/${escapeHtml(
                      s.id
                    )}"><span class="id">${escapeHtml(
                      s.id
                    )}</span></a> - ${escapeHtml(
                      s.title || "(no title)"
                    )} <button style="background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px" data-on:click="@post('/sessions/${escapeHtml(
                      ip
                    )}/${escapeHtml(s.id)}/delete-session')">✕</button></li>`
                )
                .join("")
            : '<li class="empty">(no sessions)</li>';
          const html = `<ul id="sessions-ul">${sessionItems}</ul>`;
          const statusHtml = `<div id="sessions-status" class="status">Updated ${new Date().toLocaleTimeString()}</div>`;
          try {
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(statusHtml))
            );
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(html))
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
      (e as Error).message
    );
    return [];
  }
}

// SSE for messages
function messagesSSE(ip: string, sessionId: string): Response {
  let interval: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        try {
          const messages = await fetchMessages(ip, sessionId);
          const displayMessages = messages.length > 10 ? messages.slice(-10) : messages;
          const messageItems = displayMessages.length
            ? displayMessages
                .map((m: any) => {
                  const role = escapeHtml(m.role || "message");
                  const text = escapeHtml(m.parts?.[0]?.text || m.text || "");
                  return `<div class="message"><div class="message-role">${role}</div><div class="message-text">${text}</div></div>`;
                })
                .join("")
            : '<div class="empty">(no messages)</div>';
          // Build or reuse summarizer-based summary using dedicated summarizer session (non-blocking)
           let summaryText = '(no recent messages)';
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
               if ((entry.summary === '(summary failed)' && age > SUMMARY_NEGATIVE_TTL_MS) || age > SUMMARY_CACHE_TTL_MS) {
                 delete summaryCacheBySession[k];
                 removed++;
               }
             }
             if (removed) console.log('summary cache pruned', { removed });
             lastSummaryPrune = nowTs;
           }
            const cached = summaryCacheBySession[cacheKey];
            const recentForHash = messages.slice(-3).map((m: any) => ({ role: (m.role || 'message'), text: (m.parts?.[0]?.text || m.text || '').replace(/\s+/g,' ').trim() }));
            const { hash: recentHash, reuse } = shouldReuseSummary(cached?.messageHash, recentForHash);
            if (reuse && cached) {
              summaryText = cached.summary;
              console.log('summary reuse', { cacheKey, hash: recentHash });
             } else {
               summaryText = skipSummary ? '(no recent messages)' : '...';
               if (!skipSummary && !inFlightSummary[cacheKey]) {
                inFlightSummary[cacheKey] = true;
                console.log('summary recompute start', { cacheKey, oldHash: cached?.messageHash, newHash: recentHash });
                (async () => {
                  try {
                    const remoteBase = resolveBaseUrl(ip);
                    const { summarizeMessages } = await import('./src/oc-client');
                    const summ = await summarizeMessages(remoteBase, recentForHash, sessionId);
                    if (summ.ok) {
                      summaryCacheBySession[cacheKey] = { messageHash: recentHash, summary: summ.summary || '(empty summary)', action: summ.action, cachedAt: Date.now() };
                      console.log('summary recompute success', { cacheKey, hash: recentHash });
                    } else {
                      summaryCacheBySession[cacheKey] = { messageHash: recentHash, summary: '(summary failed)', action: false, cachedAt: Date.now() };
                      console.warn('summary recompute failed', { cacheKey, hash: recentHash });
                    }
                  } catch (e) {
                    console.error('Summarizer summary error', (e as Error).message);
                  } finally {
                    delete inFlightSummary[cacheKey];
                  }
                })();
              }
            }
          const cacheAfter = summaryCacheBySession[cacheKey];
          const actionFlag = cacheAfter ? cacheAfter.action : /\|\s*action\s*=\s*yes/i.test(summaryText);
           const badge = actionFlag ? '<span style="background:#ffd54f;color:#000;padding:2px 6px;border-radius:3px;font-size:.65rem;margin-left:6px">action</span>' : '<span style="background:#ccc;color:#000;padding:2px 6px;border-radius:3px;font-size:.65rem;margin-left:6px">info</span>';
           const html = totalCount === 0 ? `<div id=\"messages-list\">${messageItems}</div>` : `<div id=\"messages-list\">${messageItems}<div class=\"messages-summary\" style=\"opacity:.55;margin-top:4px\">summary: ${escapeHtml(summaryText)} ${badge}</div></div>`;
          const statusHtml = `<div id="messages-status" class="status">Updated ${new Date().toLocaleTimeString()}</div>`;
          try {
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(statusHtml))
            );
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(html))
            );
            controller.enqueue(
              new TextEncoder().encode(
                "event: datastar-script\n" +
                  "data: script (function(){var el=document.getElementById('messages-list');if(!el) return;if(!el.__observerAdded){var obs=new MutationObserver(function(muts){var last=el.querySelector('.message:last-child');if(last&&last.scrollIntoView){last.scrollIntoView({block:'end'});}el.scrollTop=el.scrollHeight;});obs.observe(el,{childList:true,subtree:true});el.__observerAdded=true;}var lastMsg=el.querySelector('.message:last-child');if(lastMsg&&lastMsg.scrollIntoView){lastMsg.scrollIntoView({block:'end'});}el.scrollTop=el.scrollHeight;})();\n\n"
              )
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
  let interval: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      function build() {
        try {
          const ipItems = ipStore.length
            ? ipStore
                .map(
                  (ip) =>
                    `<li><a href="/sessions/${escapeHtml(
                      ip
                    )}"><span class="ip">${escapeHtml(
                      ip
                    )}</span></a> <button data-on:click=\"@post('/ips/remove/${escapeHtml(
                      ip
                    )}')\" class=\"remove-btn\">✕</button></li>`
                )
                .join("")
            : '<li class="empty">(no addresses)</li>';
          const html = `<ul id="ips-ul">${ipItems}</ul>`;
          const statusHtml = `<div id="ips-status" class="status">Updated ${new Date().toLocaleTimeString()}</div>`;
          try {
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(statusHtml))
            );
            controller.enqueue(
              new TextEncoder().encode(sendDatastarPatchElements(html))
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
  async fetch(req) {
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
        const resultHtml = `<div id=\"add-ip-result\" class=\"result\">${
          ok ? "Added IP: " + escapeHtml(ip) : "Invalid or duplicate IP"
        }</div>`;
        const ipItems = ipStore.length
          ? ipStore
              .map(
                (v) =>
                  `<li><a href=\"/sessions/${escapeHtml(
                    v
                  )}\"><span class=\"ip\">${escapeHtml(
                    v
                  )}</span></a> <button data-on:click=\"@post('/ips/remove/${escapeHtml(
                    v
                  )}')\" class=\"remove-btn\">✕</button></li>`
              )
              .join("")
          : '<li class="empty">(no addresses)</li>';
        const listHtml = `<ul id=\"ips-ul\">${ipItems}</ul>`;
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
        const ipItems = ipStore.length
          ? ipStore
              .map(
                (v) =>
                  `<li><a href=\"/sessions/${escapeHtml(
                    v
                  )}\"><span class=\"ip\">${escapeHtml(
                    v
                  )}</span></a> <button data-on:click=\"@post('/ips/remove/${escapeHtml(
                    v
                  )}')\" class=\"remove-btn\">✕</button></li>`
              )
              .join("")
          : '<li class="empty">(no addresses)</li>';
        const listHtml = `<ul id=\"ips-ul\">${ipItems}</ul>`;
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
        const ipItems = ipStore.length
          ? ipStore
              .map(
                (v) =>
                  `<li><a href=\"/sessions/${escapeHtml(
                    v
                  )}\"><span class=\"ip\">${escapeHtml(
                    v
                  )}</span></a> <button data-on:click=\"@post('/ips/remove/${escapeHtml(
                    v
                  )}')\" class=\"remove-btn\">✕</button></li>`
              )
              .join("")
          : '<li class="empty">(no addresses)</li>';
        const listHtml = `<ul id=\"ips-ul\">${ipItems}</ul>`;
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
              (e as Error).message
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
              `Session creation returned invalid ID: ${JSON.stringify(created)}`
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
          const html = `<div id="create-session-result" class="result" data-init="location.href='/sessions/${escapeHtml(
            ip
          )}/${escapeHtml(
            entry.id
          )}'">Created session: <a href="/sessions/${escapeHtml(
            ip
          )}/${escapeHtml(entry.id)}">${escapeHtml(entry.id)}</a></div>`;
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        } catch (e) {
          const msg = escapeHtml((e as Error).message);
          const html = `<div id="create-session-result" class="result">Error: ${msg}</div>`;
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
        const sessionItems = list.length
          ? list
              .map(
                (s) =>
                  `<li><a href="/sessions/${escapeHtml(ip)}/${escapeHtml(
                    s.id
                  )}"><span class="id">${escapeHtml(
                    s.id
                  )}</span></a> - ${escapeHtml(
                    s.title || "(no title)"
                  )} <button style="background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px" data-on:click="@post('/sessions/${escapeHtml(
                    ip
                  )}/${escapeHtml(s.id)}/delete-session')">✕</button></li>`
              )
              .join("")
          : '<li class="empty">(no sessions)</li>';
        const listHtml = `<ul id="sessions-ul">${sessionItems}</ul>`;
        const resultHtml = `<div id="delete-session-result" class="result">${
          deletedOk
            ? "Deleted session: " + escapeHtml(sid)
            : "Delete failed or session not found"
        }</div>`;
        const stream =
          sendDatastarPatchElements(resultHtml) +
          sendDatastarPatchElements(listHtml);
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          status: deletedOk ? 200 : 500,
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
                '<div id="session-message-result" class="result">No text</div>'
              ),
              {
                headers: { "Content-Type": "text/event-stream; charset=utf-8" },
              }
            );
          console.log("Message send start", { ip, sid, text });
          const result = await rawSendMessage(resolveBaseUrl(ip), sid, text);
          if (!result.ok) {
            const msg = escapeHtml(result.error || `HTTP ${result.status}`);
            const html = `<div id="session-message-result" class="result">Error: ${msg}</div>`;
            return new Response(sendDatastarPatchElements(html), {
              headers: { "Content-Type": "text/event-stream; charset=utf-8" },
              status: result.status || 500,
            });
          }
          const joined = result.replyTexts.join("\n") || "(no reply)";
          const escaped = escapeHtml(
            joined.substring(0, 50) + (joined.length > 50 ? "..." : "")
          );
          const html = `<div id="session-message-result" class="result">Reply: ${escaped}</div>`;
          return new Response(sendDatastarPatchElements(html), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        } catch (e) {
          console.error("Message route error", (e as Error).message);
          const msg = escapeHtml((e as Error).message);
          const html = `<div id="session-message-result" class="result">Error: ${msg}</div>`;
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
              302
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
        const page = `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Session ${escapeHtml(
          sessionTitle || sid
        )}</title><meta name="viewport" content="width=device-width,initial-scale=1" /><style>body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:900px;margin-left:auto;margin-right:auto;} a{color:#0366d6;} input,textarea,button{padding:.5rem;font-size:.95rem;border:1px solid #ccc;border-radius:3px;} button{background:#0366d6;color:white;cursor:pointer;border:none;} button:hover{background:#0256c7;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .status{font-size:.75rem;color:#666;margin-bottom:1rem;} .result{font-size:.75rem;color:#666;margin-top:.5rem;} #messages-list{border:1px solid #ddd;padding:1rem;border-radius:4px;margin-top:1rem;max-height:400px;overflow-y:auto;} .message{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} .message-role{font-weight:bold;color:#0366d6;} .message-text{margin-top:.25rem;white-space:pre-wrap;word-break:break-word;}  .session-id{font-size:.6rem;color:#666;margin-top:.25rem;margin-bottom:1rem;} </style></head><body><h1>${escapeHtml(
          sessionTitle || sid
        )}</h1><div><a href="/sessions/${escapeHtml(
          ip
        )}">&larr; Back to sessions for ${escapeHtml(
          ip
        )}</a></div><speech-button></speech-button><h2>Messages</h2><div id="messages-status" class="status">Connecting...</div><messages-wrapper><div id="messages-list-container"><div id="messages-list" data-init="@get('/sessions/${escapeHtml(
          ip
        )}/${escapeHtml(
          sid
        )}/messages/stream')"><div>(loading)</div></div></div></messages-wrapper><h2>Send Message</h2><form id="session-message-form" data-on:submit="@post('/sessions/${escapeHtml(
          ip
        )}/${escapeHtml(
          sid
        )}/message'); $messagetext = ''"><div class="row"><textarea id="session-message-input" data-bind:messageText name="messageText" placeholder="Enter message" rows="4" style="flex:1;resize:vertical"></textarea><button type="submit">Send</button></div><div id="session-message-result" class="result"></div></form><script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"></script><script type="module" src="/client.js"></script><script>(function(){var attempts=0;function s(){var el=document.getElementById('messages-list');if(!el||!el.querySelector('.message')){if(attempts++<30) return setTimeout(s,100);return;}el.scrollTop=el.scrollHeight;}s();})();</script><script>(function(){var ta=document.getElementById('session-message-input');var form=document.getElementById('session-message-form');if(!ta||!form) return;ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});})();</script></body></html>`;
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
        const page = `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Sessions for ${escapeHtml(
          ip
        )}</title><meta name="viewport" content="width=device-width,initial-scale=1" /><style>body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:900px;margin-left:auto;margin-right:auto;} a{color:#0366d6;} input,textarea,button{padding:.5rem;font-size:.95rem;border:1px solid #ccc;border-radius:3px;} button{background:#0366d6;color:white;cursor:pointer;border:none;} button:hover{background:#0256c7;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .status{font-size:.75rem;color:#666;margin-bottom:1rem;} .result{font-size:.75rem;color:#666;margin-top:.5rem;} #sessions-ul{list-style:none;padding:0;} #sessions-ul li{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} #sessions-ul li:last-child{border-bottom:none;} #sessions-ul li span.id{font-family:monospace;color:#333;font-size:.85rem;} .delete-btn{background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px;} .delete-btn:hover{background:#c0392b;} </style></head><body><h1>Sessions for ${escapeHtml(
          ip
        )}</h1><div><a href="/">&larr; Back home</a></div><h2>Sessions</h2><div id="sessions-status" class="status">Connecting...</div><div id="sessions-list" data-init="@get('/sessions/${escapeHtml(
          ip
        )}/stream')"><ul id="sessions-ul"><li class="empty">(loading)</li></ul></div><div id="delete-session-result" class="result"></div><h2>Create Session</h2><form id="create-session-form" data-on:submit="@post('/sessions/${escapeHtml(
          ip
        )}/create-session', { title: document.querySelector('#new-session-title').value })"><div class="row"><input id="new-session-title" type="text" placeholder="Session title" value="new session" /><button type="submit">Create</button></div><div id="create-session-result" class="result"></div></form><script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"></script></body></html>`;
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

    if (url.pathname === '/client.js') { return new Response(Bun.file('public/client.js'), { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }); }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${port}`);
export { server };
