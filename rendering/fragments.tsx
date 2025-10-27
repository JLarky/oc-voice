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

// (Removed legacy MessagesList; advanced recent messages fragment now handles display)// Advanced SDK JSON textarea fragment
interface AdvancedSdkJsonProps {
  jsonText: string;
}
function AdvancedSdkJson({ jsonText }: AdvancedSdkJsonProps) {
  return (
    <div id="advanced-sdk-json-container">
      <pre
        id="advanced-sdk-json"
        style="width:100%;font-family:monospace;font-size:.8rem;min-height:50px;white-space:pre-wrap;word-break:break-word;overflow:auto;"
      >
        {jsonText}
      </pre>
    </div>
  );
}
// Advanced info fragment (title + message count)
interface AdvancedInfoProps {
  title: string;
  approxCount: number;
  shareUrl?: string;
}
function AdvancedInfo({
  title,
  approxCount,
  shareUrl,
}: AdvancedInfoProps & { shareUrl?: string }) {
  const link = shareUrl ? (
    <a
      href={shareUrl}
      target="_blank"
      rel="noopener"
      style="color:#2c3e50;text-decoration:underline"
    >
      {shareUrl}
    </a>
  ) : null;
  return (
    <div id="advanced-info">
      Title: {title} | messages: ~{approxCount}
      {link ? " | shared: " : ""}
      {link}
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
// Advanced events fragment
interface AdvancedEventsProps {
  events: string[];
  attempts: any[];
  stateJson?: string;
}
function AdvancedEvents({ events, attempts, stateJson }: AdvancedEventsProps) {
  // Render attempts summary and last ~30 events as individual textareas
  const shown = events.slice(-30);
  const attemptsSummary = attempts
    .map((a) => ({
      url: a.url,
      ok: a.ok,
      error: a.error,
      closed: a.closed,
      events: a.events,
      durationMs: a.durationMs,
      notice: a.notice,
    }))
    .filter((a) => a.url || a.notice);
  return (
    <div id="advanced-events-inner">
      <div style="font-size:.75rem;opacity:.65;margin-bottom:4px">
        attempts: {JSON.stringify(attemptsSummary)}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto">
        {stateJson && (
          <pre
            class="advanced-event-state"
            style="width:100%;font-family:monospace;font-size:.65rem;background:#1a1a1a;color:#cfe;border:1px solid #555;padding:4px;min-height:50px;white-space:pre-wrap;word-break:break-word;overflow:auto;"
          >
            {stateJson}
          </pre>
        )}
        {shown.map((e, i) => {
          const rows = Math.min(8, Math.max(2, Math.ceil(e.length / 80)));
          return (
            <pre
              key={i}
              class="advanced-event-line"
              style="width:100%;font-family:monospace;font-size:.65rem;background:#111;color:#eee;border:1px solid #333;padding:4px;min-height:50px;white-space:pre-wrap;word-break:break-word;overflow:auto;"
            >
              {e}
            </pre>
          );
        })}
      </div>
    </div>
  );
}
// Advanced recent messages fragment (last <=10 messages derived from aggregated state)
interface AdvancedRecentMessagesProps {
  messages: Msg[];
  summaryText?: string;
  actionFlag?: boolean;
  totalCount?: number;
}
function AdvancedRecentMessages({
  messages,
  summaryText,
  actionFlag,
  totalCount,
}: AdvancedRecentMessagesProps) {
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
      <div style="font-size:.7rem;opacity:.6;margin-bottom:4px">
        recent messages
      </div>
      <MessageItems messages={messages} />
      {typeof totalCount === "number" && totalCount > 0 && summaryText && (
        <div class="messages-summary" style="opacity:.55;margin-top:4px">
          summary: {summaryText} {badge}
        </div>
      )}
    </div>
  );
}
export {
  AdvancedInfo,
  AdvancedSdkJson,
  AdvancedEvents,
  AdvancedRecentMessages,
};
