interface Message {
  info?: {
    role?: string;
  };
  parts?: Array<{
    type: string;
    text?: string;
  }>;
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

  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((msg: Message) => {
      const role = msg.info?.role || "message";
      const textParts = (msg.parts || []).filter((p) => p.type === "text");
      const texts = textParts.map((p) => p.text || "").filter(Boolean);

      return { role, texts };
    })
    .filter((msg) => msg.texts.length > 0);
}
