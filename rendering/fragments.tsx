// fragments.tsx - small JSX helpers for HTML fragments previously in server.ts
import { h } from "preact";
import { MessageItems, Msg } from "./MessageItems";

interface StatusDivProps {
  id: string;
  text: string;
}
function StatusDiv({ id, text }: StatusDivProps) {
  return (
    <div id={id} class="status">
      {text}
    </div>
  );
}
export { StatusDiv };

interface MessagesListProps {
  messages: Msg[];
  summaryText: string;
  actionFlag: boolean;
  totalCount: number;
}
function MessagesList({
  messages,
  summaryText,
  actionFlag,
  totalCount,
}: MessagesListProps) {
  const badge = actionFlag ? (
    <span style="background:#ffd54f;color:#000;padding:2px 6px;border-radius:3px;font-size:.65rem;margin-left:6px">
      action
    </span>
  ) : (
    <span style="background:#ccc;color:#000;padding:2px 6px;border-radius:3px;font-size:.65rem;margin-left:6px">
      info
    </span>
  );
  return (
    <div id="messages-list">
      <MessageItems messages={messages} />
      {totalCount > 0 && (
        <div class="messages-summary" style="opacity:.55;margin-top:4px">
          summary: {summaryText} {badge}
        </div>
      )}
    </div>
  );
}

// Advanced SDK JSON textarea fragment
interface AdvancedSdkJsonProps {
  jsonText: string;
}
function AdvancedSdkJson({ jsonText }: AdvancedSdkJsonProps) {
  return (
    <div id="advanced-sdk-json-container">
      <textarea
        id="advanced-sdk-json"
        rows={16}
        style="width:100%;font-family:monospace;font-size:.8rem;"
        readOnly
      >
        {jsonText}
      </textarea>
    </div>
  );
}
// Advanced info fragment (title + message count)
interface AdvancedInfoProps {
  title: string;
  approxCount: number;
}
function AdvancedInfo({ title, approxCount }: AdvancedInfoProps) {
  return (
    <div id="advanced-info">
      Title: {title} | messages: ~{approxCount}
    </div>
  );
}

// Auto-scroll script SSE event payload
export function renderAutoScrollScriptEvent(): string {
  return (
    "event: datastar-script\n" +
    "data: script (function(){var el=document.getElementById('messages-list');if(!el) return;if(!el.__observerAdded){var obs=new MutationObserver(function(muts){var last=el.querySelector('.message:last-child');if(last&&last.scrollIntoView){last.scrollIntoView({block:'end'});}el.scrollTop=el.scrollHeight;});obs.observe(el,{childList:true,subtree:true});el.__observerAdded=true;}var lastMsg=el.querySelector('.message:last-child');if(lastMsg&&lastMsg.scrollIntoView){lastMsg.scrollIntoView({block:'end'});}el.scrollTop=el.scrollHeight;})();\n\n"
  );
}
export { MessagesList, AdvancedInfo, AdvancedSdkJson };
