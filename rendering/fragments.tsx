// fragments.tsx - small JSX helpers for HTML fragments previously in server.ts
import { h } from 'preact';
import { render } from 'preact-render-to-string';

interface StatusDivProps { id: string; text: string }
function StatusDiv({ id, text }: StatusDivProps) {
  return <div id={id} class="status">{text}</div>;
}
export function renderStatusDiv(id: string, text: string): string {
  return render(<StatusDiv id={id} text={text} />);
}

interface ResultDivProps { id: string; text: string }
function ResultDiv({ id, text }: ResultDivProps) {
  return <div id={id} class="result">{text}</div>;
}
export function renderResultDiv(id: string, text: string): string {
  return render(<ResultDiv id={id} text={text} />);
}

interface SessionCreateResultProps { ip: string; sessionId: string }
function SessionCreateResult({ ip, sessionId }: SessionCreateResultProps) {
  return (
    <div
      id="create-session-result"
      class="result"
      data-init={`location.href='/sessions/${ip}/${sessionId}'`}
    >
      Created session: <a href={`/sessions/${ip}/${sessionId}`}>{sessionId}</a>
    </div>
  );
}
export function renderSessionCreateResult(ip: string, sessionId: string): string {
  return render(<SessionCreateResult ip={ip} sessionId={sessionId} />);
}

export function renderSessionDeleteResult(sessionId: string, ok: boolean): string {
  return render(
    <div id="delete-session-result" class="result">
      {ok ? `Deleted session: ${sessionId}` : 'Delete failed or session not found'}
    </div>
  );
}

export function renderSessionsClearedResult(deletedCount: number, total: number): string {
  return render(
    <div id="delete-session-result" class="result">{`Cleared sessions: ${deletedCount} / ${total}`}</div>
  );
}

export function renderMessageReplyResult(replyPreview: string): string {
  return render(
    <div id="session-message-result" class="result">{`Reply: ${replyPreview}`}</div>
  );
}

export function renderMessageErrorResult(msg: string): string {
  return render(
    <div id="session-message-result" class="result">{`Error: ${msg}`}</div>
  );
}

export function renderNoTextResult(): string {
  return render(<div id="session-message-result" class="result">No text</div>);
}

interface MessagesListProps {
  items: string[]; // individual rendered message item fragments
  summaryText: string;
  actionFlag: boolean;
  totalCount: number;
}
function MessagesList({ items, summaryText, actionFlag, totalCount }: MessagesListProps) {
  const badge = actionFlag ? (
    <span style="background:#ffd54f;color:#000;padding:2px 6px;border-radius:3px;font-size:.65rem;margin-left:6px">action</span>
  ) : (
    <span style="background:#ccc;color:#000;padding:2px 6px;border-radius:3px;font-size:.65rem;margin-left:6px">info</span>
  );
  return (
    <div id="messages-list">
      {items.map((html, i) => (
        <div class="message" key={i}>{/* html already escaped */}{html}</div>
      ))}
      {totalCount > 0 && (
        <div class="messages-summary" style="opacity:.55;margin-top:4px">
          summary: {summaryText} {badge}
        </div>
      )}
    </div>
  );
}
export function renderMessagesList(items: string[], summaryText: string, actionFlag: boolean, totalCount: number): string {
  return render(<MessagesList items={items} summaryText={summaryText} actionFlag={actionFlag} totalCount={totalCount} />);
}

// Auto-scroll script SSE event payload
export function renderAutoScrollScriptEvent(): string {
  return (
    'event: datastar-script\n' +
    'data: script (function(){var el=document.getElementById(\'messages-list\');if(!el) return;if(!el.__observerAdded){var obs=new MutationObserver(function(muts){var last=el.querySelector(\'.message:last-child\');if(last&&last.scrollIntoView){last.scrollIntoView({block:\'end\'});}el.scrollTop=el.scrollHeight;});obs.observe(el,{childList:true,subtree:true});el.__observerAdded=true;}var lastMsg=el.querySelector(\'.message:last-child\');if(lastMsg&&lastMsg.scrollIntoView){lastMsg.scrollIntoView({block:\'end\'});}el.scrollTop=el.scrollHeight;})();\n\n'
  );
}
