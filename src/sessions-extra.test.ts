import {
  deleteSession,
  shareSession,
  unshareSession,
  clearSessions,
} from "../domain/sessions-extra";

// Simple mock fetch responses sequence helper
function mockFetch(map: Record<string, any>) {
  // @ts-ignore
  global.fetch = async (url: string, opts?: any) => {
    const key = url + "|" + (opts?.method || "GET");
    const res = map[key];
    if (!res) return { ok: false, status: 404, json: async () => ({}) } as any;
    return {
      ok: res.ok,
      status: res.status || (res.ok ? 200 : 500),
      json: async () => res.json,
    } as any;
  };
}

test("deleteSession raw fallback ok", async () => {
  mockFetch({
    "http://1.2.3.4:2000/session/abc|DELETE": { ok: true, json: {} },
  });
  const r = await deleteSession("http://1.2.3.4:2000", "abc");
  expect(r.ok).toBe(true);
});

test("shareSession extracts shareUrl", async () => {
  mockFetch({
    "http://1.2.3.4:2000/session/abc/share|POST": { ok: true, json: {} },
    "http://1.2.3.4:2000/session/abc|GET": {
      ok: true,
      json: { share: { url: "https://share/url" } },
    },
  });
  const r = await shareSession("http://1.2.3.4:2000", "abc");
  expect(r.ok).toBe(true);
  expect(r.shareUrl).toBe("https://share/url");
});

test("unshareSession raw ok", async () => {
  mockFetch({
    "http://1.2.3.4:2000/session/abc/unshare|POST": { ok: true, json: {} },
  });
  const r = await unshareSession("http://1.2.3.4:2000", "abc");
  expect(r.ok).toBe(true);
});

test("clearSessions bulk delete counts", async () => {
  mockFetch({
    "http://1.2.3.4:2000/session/a|DELETE": { ok: true, json: {} },
    "http://1.2.3.4:2000/session/b|DELETE": { ok: false, json: {} },
    "http://1.2.3.4:2000/session/c|DELETE": { ok: true, json: {} },
  });
  const r = await clearSessions("http://1.2.3.4:2000", ["a", "b", "c"]);
  expect(r.ok).toBe(true);
  expect(r.deleted).toBe(2);
  expect(r.total).toBe(3);
});
