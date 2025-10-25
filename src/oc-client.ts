

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

export async function listMessages(
  remoteHost: string,
  sessionId: string
): Promise<TextMessage[]> {
  const rawRes = await fetch(`${remoteHost}/session/${sessionId}/message`);
  const messages: Message[] = await rawRes.json();
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg: Message) => {
      const role = msg.info?.role || 'message';
      const textParts = (msg.parts || []).filter((p) => p.type === 'text');
      const texts = textParts.map((p) => p.text || '').filter(Boolean);
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
  if (!text.trim()) return { ok: false, status: 400, replyTexts: [], error: 'Empty text' };
  try {
    const rawRes = await fetch(`${remoteHost}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    });
    const status = rawRes.status;
    const reply = await rawRes.json().catch(() => ({}));
    if (!rawRes.ok) {
      const err = (reply && reply.error) ? String(reply.error) : `HTTP ${status}`;
      return { ok: false, status, replyTexts: [], error: err, raw: reply };
    }
    const sourceParts = Array.isArray(reply.parts) ? reply.parts : reply.data?.parts || [];
    const textParts = Array.isArray(sourceParts)
      ? sourceParts.filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
      : [];
    const replyTexts = textParts.map((p: any) => p.text);
    return { ok: true, status, replyTexts, raw: reply };
  } catch (e) {
    return { ok: false, status: 500, replyTexts: [], error: (e as Error).message };
  }
}
