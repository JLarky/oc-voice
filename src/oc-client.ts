interface MessagePart {
  type: string;
  text?: string;
}

interface MessageInfo {
  role?: string;
}

interface Message {
  info?: MessageInfo;
  parts?: MessagePart[];
  error?: string;
  data?: any;
}

interface TextMessage {
  role: string;
  texts: string[];
}

export const FIRST_MESSAGE_INSTRUCTION =
  "I'm driving right now, because i use voice-to-text don't be afraid to ask for clarification. You don't need to be very terse when you respond, I use voice-to-text feature that will summarize your response for me, and once I part I can take a look at the code or your full responses. Also try to not mention that I use voice-to-text feature. Okay, so here it goes:";

export async function listMessages(
  remoteHost: string,
  sessionId: string
): Promise<TextMessage[]> {
  const rawRes = await fetch(`${remoteHost}/session/${sessionId}/message`);
  const messages: Message[] = await rawRes.json();
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg: Message) => {
      const role = msg.info?.role || "message";
      const textParts = (msg.parts || []).filter((p) => p.type === "text");
      const texts = textParts.map((p) => p.text || "").filter(Boolean);
      return { role, texts };
    })
    .filter((msg) => msg.texts.length > 0);
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
  text: string
): Promise<SendMessageResult> {
  if (!text.trim())
    return { ok: false, status: 400, replyTexts: [], error: "Empty text" };
  try {
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
    const sourceParts = Array.isArray(reply.parts)
      ? reply.parts
      : reply.data?.parts || [];
    const textParts = Array.isArray(sourceParts)
      ? sourceParts.filter(
          (p: any) => p && p.type === "text" && typeof p.text === "string"
        )
      : [];
    const replyTexts = textParts.map((p: any) => p.text);
    return { ok: true, status, replyTexts, raw: reply };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      replyTexts: [],
      error: (e as Error).message,
    };
  }
}

// --- Session utilities ---
export interface SessionBasic {
  id: string;
  title?: string;
}

// List sessions via raw + fallback parsing
export async function listSessions(
  remoteHost: string
): Promise<SessionBasic[]> {
  const out: SessionBasic[] = [];
  try {
    const res = await fetch(`${remoteHost}/session`);
    const json = await res.json().catch(() => null);
    const arr = Array.isArray(json) ? json : json?.sessions || json?.data;
    if (Array.isArray(arr)) {
      arr.forEach((r: any) => {
        if (r && typeof r.id === "string")
          out.push({ id: r.id, title: r.title });
      });
    }
  } catch (e) {
    console.error("listSessions error", (e as Error).message);
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
  opts: EnsureSummarizerOptions = {}
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
        match.id
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
          2
        )
      );
      configUpdated = true;
      console.log(
        "ensureSummarizer reused (title) summarizer session id",
        byTitle.id
      );
    } catch (e) {
      console.error(
        "ensureSummarizer save existing failed",
        (e as Error).message
      );
    }
    return { session: byTitle, created: false, configUsed, configUpdated };
  }
  let createdSession: SessionBasic | null = null;
  try {
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
    console.error("ensureSummarizer create error", (e as Error).message);
  }
  if (createdSession) {
    try {
      await Bun.write(
        configPath,
        JSON.stringify(
          { lastBaseUrl: remoteHost, summarizerSessionId: createdSession.id },
          null,
          2
        )
      );
      configUpdated = true;
      console.log(
        "ensureSummarizer created new summarizer session id",
        createdSession.id
      );
    } catch (e) {
      console.error("ensureSummarizer save new failed", (e as Error).message);
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
  "Summarize the following conversation. You are acting on a behalf of the assistant. Whatever you are going to reply is going to be said out loud with TTS system. Please give a voice to the assistant. Respond in <=18 words. If your message doesn't fit ask user to look at the screen instead of using TTS.";

// Summarize recent messages using dedicated summarizer session.
// recentMessages: array of last messages with role + text
// Returns summary line plus parsed action flag.
export async function summarizeMessages(
  remoteHost: string,
  recentMessages: { role: string; text: string }[],
  targetSessionId?: string
): Promise<{
  summary: string;
  action: boolean;
  raw: string;
  ok: boolean;
  error?: string;
}> {
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
      combined + "\n\n" + summarizationPrompt
    );
    if (!sendCombined.ok)
      return {
        summary: "",
        action: false,
        raw: "",
        ok: false,
        error: sendCombined.error || "Summarize send failed",
      };
    const raw = sendCombined.replyTexts.join("\n").trim();
    const action = /\|\s*action\s*=\s*yes/i.test(raw);
    return { summary: raw, action, raw, ok: true };
  } catch (e) {
    return {
      summary: "",
      action: false,
      raw: "",
      ok: false,
      error: (e as Error).message,
    };
  }
}

// Create a new session with given title; returns id or null.
export async function createSession(
  remoteHost: string,
  title: string
): Promise<string | null> {
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
    console.error("createSession error", (e as Error).message);
    return null;
  }
}
