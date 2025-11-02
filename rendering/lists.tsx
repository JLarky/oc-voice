// lists.tsx - reusable list item components (sessions + IP lists)
import { h } from "preact";

interface Session {
  id: string;
  title?: string;
}
interface SessionsUlProps {
  ip: string;
  sessions: Session[];
  summarizerId?: string;
}
export function SessionsUl({ ip, sessions, summarizerId }: SessionsUlProps) {
  if (!sessions.length)
    return (
      <ul id="sessions-ul">
        <li class="empty">(no sessions)</li>
      </ul>
    );
  return (
    <ul id="sessions-ul">
      {sessions.map((s) => {
        const isSummarizer = summarizerId ? s.id === summarizerId : false;
        return (
          <li style={isSummarizer ? "opacity:.5" : undefined}>
            <a href={`/sessions/${ip}/${s.id}`}>
              <span class="title">{s.title || "(no title)"}</span>
            </a>{" "}
            <span style="color:#666;font-size:.7rem">{s.id}</span>{" "}
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

interface IpsUlProps {
  ips: string[];
}
export function IpsUl({ ips }: IpsUlProps) {
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
