// lists.ts - reusable list item renderers
import { escapeHtml } from './escape';
export function renderSessionsUl(ip: string, sessions: { id: string; title?: string }[]): string {
  const items = sessions.length ? sessions.map((s) => `<li><a href="/sessions/${escapeHtml(ip)}/${escapeHtml(s.id)}"><span class="id">${escapeHtml(s.id)}</span></a> - ${escapeHtml(s.title || '(no title)')} <button style="background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px" data-on:click="@post('/sessions/${escapeHtml(ip)}/${escapeHtml(s.id)}/delete-session')">\u2715</button></li>`).join('') : '<li class="empty">(no sessions)</li>';
  return `<ul id="sessions-ul">${items}</ul>`;
}
export function renderIpsUl(ips: string[]): string {
  const items = ips.length ? ips.map((ip) => `<li><a href="/sessions/${escapeHtml(ip)}"><span class="ip">${escapeHtml(ip)}</span></a> <button data-on:click="@post('/ips/remove/${escapeHtml(ip)}')" class="remove-btn">\u2715</button></li>`).join('') : '<li class="empty">(no addresses)</li>';
  return `<ul id="ips-ul">${items}</ul>`;
}
