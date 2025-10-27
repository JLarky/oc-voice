// Shared cache key helpers for session-related pubsub
// Canonical format: `${ip}::${sid}` (no protocol/port)
// Derive remote base when needed via `remoteBaseFromIp(ip)`

export function buildCacheKey(ip: string, sid: string): string {
  return `${ip}::${sid}`;
}

export function remoteBaseFromIp(ip: string): string {
  return `http://${ip}:2000`;
}

export function parseCacheKey(cacheKey: string): { ip: string; sid: string } | null {
  const parts = cacheKey.split('::');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { ip: parts[0], sid: parts[1] };
}
