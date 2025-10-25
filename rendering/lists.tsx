// lists.tsx - reusable list item renderers migrated to JSX (sessions + IP lists)
import { h } from "preact";
import { render } from "preact-render-to-string";

interface Session {
  id: string;
  title?: string;
}
interface SessionsUlProps {
  ip: string;
  sessions: Session[];
}
function SessionsUl({ ip, sessions }: SessionsUlProps) {
  if (!sessions.length)
    return (
      <ul id="sessions-ul">
        <li class="empty">(no sessions)</li>
      </ul>
    );
  return (
    <ul id="sessions-ul">
      {sessions.map((s) => {
        const isSummarizer = (s.title || '').toLowerCase() === 'summarizer';
        return (
          <li style={isSummarizer ? 'opacity:.55' : undefined}>
            <a href={`/sessions/${ip}/${s.id}`}>
              <span class="id">{s.id}</span>
            </a> - {s.title || '(no title)'}{' '}
            <button
              style="background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px"
              data-on:click={`@post('/sessions/${ip}/${s.id}/delete-session')`}
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function renderSessionsUl(ip: string, sessions: Session[]): string {
  // Rely on Preact escaping for id/title; ip validated upstream.
  return render(<SessionsUl ip={ip} sessions={sessions} />);
}

interface IpsUlProps {
  ips: string[];
}
function IpsUl({ ips }: IpsUlProps) {
  if (!ips.length)
    return (
      <ul id="ips-ul">
        <li class="empty">(no addresses)</li>
      </ul>
    );
  return (
    <ul id="ips-ul">
      {ips.map((ip) => (
        <li>
          <a href={`/sessions/${ip}`}>
            <span class="ip">{ip}</span>
          </a>{" "}
          <button
            data-on:click={`@post('/ips/remove/${ip}')`}
            class="remove-btn"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

export function renderIpsUl(ips: string[]): string {
  return render(<IpsUl ips={ips} />);
}
