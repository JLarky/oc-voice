// lists.tsx - reusable list item renderers migrated to JSX (only renderIpsUl converted now)
import { h } from 'preact';
import { render } from 'preact-render-to-string';
import { escapeHtml } from './escape';

export function renderSessionsUl(ip: string, sessions: { id: string; title?: string }[]): string {
  // TEMP: keep original string implementation until we migrate sessions list
  const items = sessions.length ? sessions.map((s) => `<li><a href="/sessions/${escapeHtml(ip)}/${escapeHtml(s.id)}"><span class="id">${escapeHtml(s.id)}</span></a> - ${escapeHtml(s.title || '(no title)')} <button style="background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px" data-on:click="@post('/sessions/${escapeHtml(ip)}/${escapeHtml(s.id)}/delete-session')">✕</button></li>`).join('') : '<li class="empty">(no sessions)</li>';
  return `<ul id="sessions-ul">${items}</ul>`;
}

interface IpsUlProps { ips: string[] }
function IpsUl({ ips }: IpsUlProps) {
  if (!ips.length) return <ul id="ips-ul"><li class="empty">(no addresses)</li></ul>;
  return (
    <ul id="ips-ul">
      {ips.map((ip) => (
        <li>
          <a href={`/sessions/${ip}`}><span class="ip">{ip}</span></a>{' '}
          <button data-on:click={`@post('/ips/remove/${ip}')`} class="remove-btn">✕</button>
        </li>
      ))}
    </ul>
  );
}

export function renderIpsUl(ips: string[]): string {
  return render(<IpsUl ips={ips} />);
}
