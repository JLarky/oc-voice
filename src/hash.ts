// Hash utilities for recent messages
// FNV-1a 32-bit hash over normalized role:text lines
// Normalization: role lowercased; text collapsed whitespace & trimmed
export interface RecentMessage { role: string; text: string; }

export function recentMessagesHash(messages: RecentMessage[]): string {
  let h = 0x811c9dc5;
  for (const m of messages) {
    const role = (m.role || 'message').toLowerCase();
    const text = (m.text || '').replace(/\s+/g,' ').trim();
    const line = role + ':' + text + '\n';
    for (let i=0;i<line.length;i++) {
      h ^= line.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
  }
  return h.toString(16);
}

export function shouldReuseSummary(cachedHash: string | undefined, messages: RecentMessage[]): { hash: string; reuse: boolean } {
  const hash = recentMessagesHash(messages);
  return { hash, reuse: !!cachedHash && cachedHash === hash };
}
