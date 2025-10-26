// domain/sessions.ts - session CRUD (prototype stub)
import { createOpencodeClient } from "@opencode-ai/sdk";

export interface SessionEntry {
  id: string;
  title?: string;
}
export interface CachedSessions {
  list: SessionEntry[];
  fetchedAt: number;
}

export async function listSessions(baseUrl: string): Promise<SessionEntry[]> {
  try {
    const client = createOpencodeClient({ baseUrl });
    const remote: any = await (client as any).session.list?.();
    let list: SessionEntry[] = [];
    if (Array.isArray(remote))
      list = remote.map((r) => ({ id: r.id, title: r.title }));
    else if (remote && typeof remote === "object") {
      const arr = remote.data || remote.sessions;
      if (Array.isArray(arr))
        list = arr.map((r: any) => ({ id: r.id, title: r.title }));
    }
    if (!list.length) {
      const rawRes = await fetch(baseUrl + "/session");
      if (rawRes.ok) {
        const rawJson: any = await rawRes.json().catch(() => null);
        const rawArr = Array.isArray(rawJson)
          ? rawJson
          : rawJson?.sessions || rawJson?.data;
        if (Array.isArray(rawArr))
          list = rawArr.map((r: any) => ({ id: r.id, title: r.title }));
      }
    }
    return list.filter((s) => typeof s.id === "string" && s.id);
  } catch {
    return [];
  }
}

export async function createSession(
  baseUrl: string,
  title: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const client = createOpencodeClient({ baseUrl });
    let created: any;
    try {
      created = await (client as any).session.create?.({ body: { title } });
    } catch {
      const rawRes = await fetch(baseUrl + "/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!rawRes.ok)
        return { ok: false, error: "create failed " + rawRes.status };
      created = await rawRes.json();
    }
    let id = created?.id || created?.data?.id;
    if (!id || typeof id !== "string")
      return { ok: false, error: "invalid id shape" };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
