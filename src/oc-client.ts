import { DEBUG_OPENCODE_API_CALLS } from "../config";

interface TextPart {
  type: "text";
  text: string;
}
interface MessagePart {
  type: "text" | string;
  text?: string;
}
function isTextPart(p: any): p is TextPart {
  return p && p.type === "text" && typeof p.text === "string";
}

interface MessageInfo {
  role?: string;
  time?: {
    created: number;
    completed: number;
  };
}

interface Message {
  info?: MessageInfo;
  parts?: MessagePart[];
  error?: string;
  data?: any;
}

export interface TextMessage {
  role: string;
  texts: string[];
  timestamp?: Date;
  isGenerating?: boolean;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const FIRST_MESSAGE_INSTRUCTION =
  "I'm driving right now, because i use voice-to-text don't be afraid to ask for clarification. You don't need to be very terse when you respond, I use voice-to-text feature that will summarize your response for me, and once I park I can take a look at the code or your full responses. To activate text-to-speech make sure that last line of your last response is a short command 'utter: <your text>'. Okay, so here it goes:";

// Track listMessages call frequency
interface CallRecord {
  timestamp: number;
}

const listMessagesCallHistory: Map<string, CallRecord[]> = new Map();
const CALL_HISTORY_WINDOW_MS = 60 * 1000; // 1 minute window

function getCallKey(remoteHost: string, sessionId: string): string {
  return `${remoteHost}::${sessionId}`;
}

function trackListMessagesCall(
  remoteHost: string,
  sessionId: string,
): { timestamp: string; callsPerMinute: number } {
  const key = getCallKey(remoteHost, sessionId);
  const now = Date.now();
  const timestamp = new Date().toISOString();

  // Get or create history for this session
  let history = listMessagesCallHistory.get(key);
  if (!history) {
    history = [];
    listMessagesCallHistory.set(key, history);
  }

  // Add current call
  history.push({ timestamp: now });

  // Remove calls older than 1 minute
  const cutoff = now - CALL_HISTORY_WINDOW_MS;
  while (history.length > 0 && history[0]!.timestamp < cutoff) {
    history.shift();
  }

  // Calculate calls per minute
  const callsPerMinute = history.length;

  // Clean up old entries (sessions with no calls in last 5 minutes)
  if (listMessagesCallHistory.size > 100) {
    const cleanupCutoff = now - 5 * CALL_HISTORY_WINDOW_MS;
    for (const [k, h] of listMessagesCallHistory.entries()) {
      if (h.length === 0 || (h[h.length - 1]?.timestamp || 0) < cleanupCutoff) {
        listMessagesCallHistory.delete(k);
      }
    }
  }

  return { timestamp, callsPerMinute };
}

export async function listMessages(
  remoteHost: string,
  sessionId: string,
): Promise<TextMessage[]> {
  const { timestamp, callsPerMinute } = trackListMessagesCall(
    remoteHost,
    sessionId,
  );
  if (DEBUG_OPENCODE_API_CALLS) {
    console.log("[opencode API] listMessages", {
      remoteHost,
      sessionId,
      timestamp,
      callsPerMinute: `${callsPerMinute}/min`,
    });
  }
  const rawRes = await fetch(`${remoteHost}/session/${sessionId}/message`);
  const messages: Message[] = await rawRes.json();
  if (!Array.isArray(messages)) return [];
  const result = messages
    .map((msg: Message) => {
      const role = msg.info?.role || "message";
      const timeObj = msg.info?.time;
      const hasCreated =
        timeObj && "created" in timeObj && timeObj.created != null;
      const hasCompleted =
        timeObj && "completed" in timeObj && timeObj.completed != null;
      const timestamp = hasCompleted
        ? timeObj.completed
        : hasCreated
          ? timeObj.created
          : undefined;
      const textParts = (msg.parts || []).filter((p) => p.type === "text");
      const texts = textParts.map((p) => p.text || "").filter(Boolean);
      // Message is generating if it has created time but no completed time
      // Only assistant messages can be in generating state (user messages don't get completed timestamp)
      const isGenerating = role === "assistant" && hasCreated && !hasCompleted;

      return {
        role,
        texts,
        timestamp: timestamp ? new Date(timestamp) : undefined,
        isGenerating,
      };
    })
    .filter((msg) => msg.texts.length > 0);

  return result;
}

export interface SendMessageResult {
  ok: boolean;
  status: number;
  replyTexts: string[];
  raw?: any;
  error?: string;
}

// Send a text message to a session using raw POST only (no SDK).
// Returns extracted reply text parts (assistant reply) if any.
export async function sendMessage(
  remoteHost: string,
  sessionId: string,
  text: string,
): Promise<SendMessageResult> {
  if (!text.trim())
    return { ok: false, status: 400, replyTexts: [], error: "Empty text" };
  try {
    if (DEBUG_OPENCODE_API_CALLS) {
      console.log("[opencode API] sendMessage", {
        remoteHost,
        sessionId,
        textLength: text.length,
      });
    }
    const rawRes = await fetch(`${remoteHost}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text }] }),
    });
    const status = rawRes.status;
    const reply = await rawRes.json().catch(() => ({}));
    if (!rawRes.ok) {
      const err = reply && reply.error ? String(reply.error) : `HTTP ${status}`;
      return { ok: false, status, replyTexts: [], error: err, raw: reply };
    }
    const sourceParts: unknown = Array.isArray(reply.parts)
      ? reply.parts
      : reply?.data?.parts || [];
    const textParts: TextPart[] = Array.isArray(sourceParts)
      ? (sourceParts as unknown[]).filter(isTextPart)
      : [];
    const replyTexts = textParts.map((p) => p.text);
    return { ok: true, status, replyTexts, raw: reply };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      replyTexts: [],
      error: errMsg(e),
    };
  }
}

// --- Session utilities ---
export interface SessionBasic {
  id: string;
  title?: string;
}

// Raw session shape is variable; defensive optional fields
interface RawSession {
  id?: string;
  session_id?: string;
  title?: string;
  data?: any;
}

// List sessions via raw + fallback parsing
export async function listSessions(
  remoteHost: string,
): Promise<SessionBasic[]> {
  if (DEBUG_OPENCODE_API_CALLS) {
    console.log("[opencode API] listSessions", { remoteHost });
  }
  const out: SessionBasic[] = [];
  try {
    const res = await fetch(`${remoteHost}/session`);
    const json = await res.json().catch(() => null);
    const arr: unknown = Array.isArray(json)
      ? json
      : (json as any)?.sessions || (json as any)?.data;
    if (Array.isArray(arr)) {
      (arr as unknown[]).forEach((r: unknown) => {
        if (!r || typeof r !== "object") return;
        const raw = r as RawSession;
        const id =
          typeof raw.id === "string"
            ? raw.id
            : typeof raw.session_id === "string"
              ? raw.session_id
              : undefined;
        if (id)
          out.push({
            id,
            title: typeof raw.title === "string" ? raw.title : undefined,
          });
      });
    }
  } catch (e) {
    console.error("listSessions error", errMsg(e));
  }
  return out;
}

export interface EnsureSummarizerOptions {
  configPath?: string; // default playpen/summarizer-config.json
  title?: string; // default summarizer
}

export interface EnsureSummarizerResult {
  session: SessionBasic | null;
  created: boolean;
  configUsed: boolean;
  configUpdated: boolean;
}

export async function ensureSummarizer(
  remoteHost: string,
  opts: EnsureSummarizerOptions = {},
): Promise<EnsureSummarizerResult> {
  const title = (opts.title || "summarizer").toLowerCase();
  const configPath = opts.configPath || "playpen/summarizer-config.json";
  let configUsed = false;
  let configUpdated = false;
  let storedId: string | undefined;
  let storedBase: string | undefined;
  try {
    const text = await Bun.file(configPath).text();
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      storedId =
        typeof data.summarizerSessionId === "string"
          ? data.summarizerSessionId
          : undefined;
      storedBase =
        typeof data.lastBaseUrl === "string" ? data.lastBaseUrl : undefined;
    }
  } catch {
    /* no existing config */
  }
  const sessions = await listSessions(remoteHost);
  if (storedBase === remoteHost && storedId) {
    const match = sessions.find((s) => s.id === storedId);
    if (match) {
      configUsed = true;
      console.log(
        "ensureSummarizer reused (config) summarizer session id",
        match.id,
      );
      return { session: match, created: false, configUsed, configUpdated };
    }
  }
  const byTitle = sessions.find((s) => (s.title || "").toLowerCase() === title);
  if (byTitle) {
    try {
      await Bun.write(
        configPath,
        JSON.stringify(
          { lastBaseUrl: remoteHost, summarizerSessionId: byTitle.id },
          null,
          2,
        ),
      );
      configUpdated = true;
      console.log(
        "ensureSummarizer reused (title) summarizer session id",
        byTitle.id,
      );
    } catch (e) {
      console.error("ensureSummarizer save existing failed", errMsg(e));
    }
    return { session: byTitle, created: false, configUsed, configUpdated };
  }
  let createdSession: SessionBasic | null = null;
  try {
    if (DEBUG_OPENCODE_API_CALLS) {
      console.log("[opencode API] createSession (via ensureSummarizer)", {
        remoteHost,
        title,
      });
    }
    const res = await fetch(`${remoteHost}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const id = json?.id || json?.session_id || json?.data?.id;
      if (typeof id === "string") createdSession = { id, title };
    } else {
      console.error("ensureSummarizer create failed status", res.status);
    }
  } catch (e) {
    console.error("ensureSummarizer create error", errMsg(e));
  }
  if (createdSession) {
    try {
      await Bun.write(
        configPath,
        JSON.stringify(
          { lastBaseUrl: remoteHost, summarizerSessionId: createdSession.id },
          null,
          2,
        ),
      );
      configUpdated = true;
      console.log(
        "ensureSummarizer created new summarizer session id",
        createdSession.id,
      );
    } catch (e) {
      console.error("ensureSummarizer save new failed", errMsg(e));
    }
  }
  return {
    session: createdSession,
    created: !!createdSession,
    configUsed,
    configUpdated,
  };
}

export const summarizationPrompt =
  "Read those messages from an assistant. Understand if assistant is asking something from user or just reporting the status. If a question is asked or action from user is needed then reply with <= 18 words summary. If 'utter' command is used, say only the text that was uttered, don't add anything to it. If no action needed from user, reply '...'. If assistant didn't ask any questions or did't ask for clarification, reply '...'.";

// Summarize recent messages using dedicated summarizer session.
// recentMessages: array of last messages with role + text
// Returns summary line plus parsed action flag.
export interface SummarizeResult {
  summary: string;
  action: boolean;
  raw: string;
  ok: boolean;
  error?: string;
}

export async function summarizeMessages(
  remoteHost: string,
  recentMessages: { role: string; text: string }[],
  targetSessionId?: string,
): Promise<SummarizeResult> {
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
    return {
      summary: "(no messages)",
      action: false,
      raw: "(no messages)",
      ok: true,
    };
  }
  const combined = recentMessages
    .map((m) => `${m.role}: ${m.text.replace(/\s+/g, " ").trim()}`)
    .join("\n");
  try {
    const summResult = await ensureSummarizer(remoteHost, {
      title: "summarizer",
    });
    const summSession = summResult.session?.id;
    if (!summSession)
      return {
        summary: "",
        action: false,
        raw: "",
        ok: false,
        error: "No summarizer session",
      };
    if (targetSessionId && targetSessionId === summSession) {
      return {
        summary: "can't summarize",
        action: false,
        raw: "can't summarize",
        ok: true,
      };
    }
    const sendCombined = await sendMessage(
      remoteHost,
      summSession,
      combined + "\n\n" + summarizationPrompt,
    );
    if (!sendCombined.ok)
      return {
        summary: "",
        action: false,
        raw: "",
        ok: false,
        error: sendCombined.error || "Summarize send failed",
      };
    const raw = sendCombined.replyTexts.join("\n").replace("utter:", "").trim();
    const action = /\|\s*action\s*=\s*yes/i.test(raw);
    return { summary: raw, action, raw, ok: true };
  } catch (e) {
    return {
      summary: "",
      action: false,
      raw: "",
      ok: false,
      error: errMsg(e),
    };
  }
}

// Create a new session with given title; returns id or null.
export async function createSession(
  remoteHost: string,
  title: string,
): Promise<string | null> {
  if (DEBUG_OPENCODE_API_CALLS) {
    console.log("[opencode API] createSession", { remoteHost, title });
  }
  try {
    const res = await fetch(`${remoteHost}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const id = json?.id || json?.session_id || json?.data?.id;
    return typeof id === "string" ? id : null;
  } catch (e) {
    console.error("createSession error", errMsg(e));
    return null;
  }
}
