// MessageItems.tsx - straightforward Preact component relying on built-in escaping
import { h } from "preact";

interface MsgPart {
  type: string;
  text?: string;
}
export interface Msg {
  role?: string;
  parts?: MsgPart[];
  text?: string;
  timestamp?: Date;
  isGenerating?: boolean;
}
interface MessageItemsProps {
  messages: Msg[];
}

export function MessageItems({ messages }: MessageItemsProps) {
  if (!messages.length) return <div class="empty">(no messages)</div>;
  return (
    <>
      {messages.map((m, i) => {
        const role = m.role || "message";
        const text = m.parts?.[0]?.text || m.text || "";
        const ts = m.timestamp
          ? new Intl.DateTimeFormat("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
              timeZone: "America/Denver",
            }).format(m.timestamp)
          : "";
        const displayText = m.isGenerating && !text ? "Generating..." : text;
        return (
          <div class="message" key={i}>
            <div class="message-role">
              {role}
              {ts && <span class="message-ts"> {ts}</span>}
              {m.isGenerating && (
                <span style="opacity:0.6;margin-left:6px">(generating)</span>
              )}
            </div>
            <div class="message-text">{displayText}</div>
          </div>
        );
      })}
    </>
  );
}
