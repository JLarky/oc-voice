// domain/sessions-extra.ts - extra session actions (delete/share/unshare/clear)
import { createOpencodeClient } from "@opencode-ai/sdk";

function safeIdMatches(val: any, sid: string) {
  return (
    val &&
    (val.id === sid || val?.data?.id === sid || val?.ok || val?.status === "ok")
  );
}

export async function deleteSession(baseUrl: string, sid: string) {
  try {
    const client = createOpencodeClient({ baseUrl });
    try {
      const d: any = await (client as any).session.delete?.({
        path: { id: sid },
      });
      if (safeIdMatches(d, sid)) return { ok: true };
    } catch {}
    try {
      const rawRes = await fetch(`${baseUrl}/session/${sid}`, {
        method: "DELETE",
      });
      if (rawRes.ok) return { ok: true };
    } catch {}
    return { ok: false, error: "delete failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function shareSession(baseUrl: string, sid: string) {
  try {
    const client = createOpencodeClient({ baseUrl });
    try {
      const d: any = await (client as any).session.share?.({
        path: { id: sid },
      });
      if (safeIdMatches(d, sid))
        return await extractShareUrl(baseUrl, sid, { ok: true });
    } catch {}
    try {
      const rawRes = await fetch(`${baseUrl}/session/${sid}/share`, {
        method: "POST",
      });
      if (rawRes.ok) return await extractShareUrl(baseUrl, sid, { ok: true });
    } catch {}
    return { ok: false, error: "share failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function extractShareUrl(baseUrl: string, sid: string, base: any) {
  try {
    const detailRes = await fetch(`${baseUrl}/session/${sid}`);
    if (detailRes.ok) {
      const json = await detailRes.json().catch(() => null);
      const shareUrl =
        json?.share?.url ||
        json?.data?.share?.url ||
        json?.share_url ||
        json?.data?.share_url;
      if (typeof shareUrl === "string" && shareUrl)
        return { ...base, shareUrl };
    }
  } catch {}
  return base;
}

export async function unshareSession(baseUrl: string, sid: string) {
  try {
    const client = createOpencodeClient({ baseUrl });
    try {
      const d: any = await (client as any).session.unshare?.({
        path: { id: sid },
      });
      if (safeIdMatches(d, sid)) return { ok: true };
    } catch {}
    try {
      const rawRes = await fetch(`${baseUrl}/session/${sid}/unshare`, {
        method: "POST",
      });
      if (rawRes.ok) return { ok: true };
    } catch {}
    return { ok: false, error: "unshare failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function clearSessions(baseUrl: string, listIds: string[]) {
  let deleted = 0;
  const total = listIds.length;
  for (const sid of listIds) {
    try {
      const client = createOpencodeClient({ baseUrl });
      let ok = false;
      try {
        const d: any = await (client as any).session.delete?.({
          path: { id: sid },
        });
        if (safeIdMatches(d, sid)) ok = true;
      } catch {}
      if (!ok) {
        try {
          const rawRes = await fetch(`${baseUrl}/session/${sid}`, {
            method: "DELETE",
          });
          if (rawRes.ok) ok = true;
        } catch {}
      }
      if (ok) deleted++;
    } catch {}
  }
  return { ok: true, deleted, total };
}
