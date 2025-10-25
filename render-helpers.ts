// render-helpers.ts - granular list/message rendering helpers
import { escapeHtml } from './render';

export function renderSessionsUl(ip: string, sessions: { id: string; title?: string }[]): string {
  const items = sessions.length ? sessions.map((s) => {
    return `<li><a href="/sessions/${escapeHtml(ip)}/${escapeHtml(s.id)}"><span class="id">${escapeHtml(s.id)}</span></a> - ${escapeHtml(s.title || '(no title)')} <button style="background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px" data-on:click="@post('/sessions/${escapeHtml(ip)}/${escapeHtml(s.id)}/delete-session')">✕</button></li>`;
  }).join('') : '<li class="empty">(no sessions)</li>';
  return `<ul id="sessions-ul">${items}</ul>`;
}

export function renderIpsUl(ips: string[]): string {
  const items = ips.length ? ips.map((ip) => {
    return `<li><a href="/sessions/${escapeHtml(ip)}"><span class="ip">${escapeHtml(ip)}</span></a> <button data-on:click="@post('/ips/remove/${escapeHtml(ip)}')" class="remove-btn">✕</button></li>`;
  }).join('') : '<li class="empty">(no addresses)</li>';
  return `<ul id="ips-ul">${items}</ul>`;
}

interface Msg { role?: string; parts?: { type: string; text?: string }[]; text?: string; }
export function renderMessageItems(messages: Msg[]): string {
  if (!messages.length) return '<div class="empty">(no messages)</div>';
  return messages.map((m) => {
    const role = escapeHtml(m.role || 'message');
    const text = escapeHtml(m.parts?.[0]?.text || m.text || '');
    return `<div class="message"><div class="message-role">${role}</div><div class="message-text">${text}</div></div>`;
  }).join('');
}
