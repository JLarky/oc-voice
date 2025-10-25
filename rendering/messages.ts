// messages.ts - message item rendering
import { escapeHtml } from './escape';
interface Msg { role?: string; parts?: { type: string; text?: string }[]; text?: string; }
export function renderMessageItems(messages: Msg[]): string {
  if (!messages.length) return '<div class="empty">(no messages)</div>';
  return messages.map((m) => {
    const role = escapeHtml(m.role || 'message');
    const text = escapeHtml(m.parts?.[0]?.text || m.text || '');
    return `<div class="message"><div class="message-role">${role}</div><div class="message-text">${text}</div></div>`;
  }).join('');
}
