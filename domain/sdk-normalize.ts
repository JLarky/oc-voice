// domain/sdk-normalize.ts - utilities to normalize SDK session shapes (prototype)
export function extractSessionId(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const direct = obj.id;
  if (typeof direct === "string" && direct) return direct;
  const nested = obj.data?.id;
  if (typeof nested === "string" && nested) return nested;
  return undefined;
}

export function normalizeSessionList(
  remote: any,
): { id: string; title?: string }[] {
  if (Array.isArray(remote))
    return remote.map((r) => ({ id: r.id, title: r.title }));
  if (remote && typeof remote === "object") {
    const arr = remote.data || remote.sessions;
    if (Array.isArray(arr))
      return arr.map((r: any) => ({ id: r.id, title: r.title }));
  }
  return [];
}
