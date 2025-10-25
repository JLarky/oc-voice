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
        return (
          <div class="message" key={i}>
            <div class="message-role">{role}</div>
            <div class="message-text">{text}</div>
          </div>
        );
      })}
    </>
  );
}
