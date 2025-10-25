// escape.ts - HTML escaping
const ESCAPE_RE = /[&<>"]/g;
const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export function escapeHtml(text: string): string {
  if (typeof text !== 'string' || text === '') return String(text || '');
  ESCAPE_RE.lastIndex = 0;
  if (!ESCAPE_RE.test(text)) return text;
  ESCAPE_RE.lastIndex = 0;
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ESCAPE_RE.exec(text))) {
    const i = match.index;
    out += text.slice(lastIndex, i) + ESCAPE_MAP[text[i]];
    lastIndex = i + 1;
  }
  return out + text.slice(lastIndex);
}
