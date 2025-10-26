// domain/ip.ts - pure IP domain utilities
export function validateIp(raw: string): string | undefined {
  const ip = raw.trim();
  if (!/^(\d{1,3})(?:\.(\d{1,3})){3}$/.test(ip)) return undefined;
  return ip;
}

export function addIp(ipStore: string[], raw: string) {
  const ip = validateIp(raw);
  if (!ip) return { ok: false, error: "invalid ip" };
  if (!ipStore.includes(ip)) ipStore.push(ip);
  return { ok: true, ip };
}

export function removeIp(ipStore: string[], raw: string) {
  const ip = validateIp(raw);
  if (!ip) return { ok: false, error: "invalid ip" };
  const idx = ipStore.indexOf(ip);
  if (idx === -1) return { ok: false, error: "not found" };
  ipStore.splice(idx, 1);
  return { ok: true, ip };
}
