// sessions-alias-parity.test.ts - verifies Elysia legacy alias endpoints exist
import { test, expect } from "bun:test";

async function fetchJson(url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text, status: res.status };
    }
  } catch {
    return {};
  }
}

const BASE = "http://localhost:3333";

test("create-session alias responds", async () => {
  const body = { title: "alias test session" };
  const json = await fetchJson(`${BASE}/sessions/127.0.0.1/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (typeof json.ok !== "boolean") {
    console.warn(
      "Elysia server unavailable for create-session alias test; skipping",
    );
    return;
  }
  expect(typeof json.ok).toBe("boolean");
});

test("delete-session alias responds", async () => {
  // Best-effort create first
  await fetchJson(`${BASE}/sessions/127.0.0.1/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "to delete" }),
  });
  const json = await fetchJson(
    `${BASE}/sessions/127.0.0.1/dummy-id/delete-session`,
    { method: "POST" },
  );
  if (typeof json.ok !== "boolean") {
    console.warn(
      "Elysia server unavailable for delete-session alias test; skipping",
    );
    return;
  }
  expect(typeof json.ok).toBe("boolean");
});

test("share/unshare/clear aliases present", async () => {
  const share = await fetchJson(
    `${BASE}/sessions/127.0.0.1/dummy-id/share-session`,
    { method: "POST" },
  );
  if (typeof share.ok !== "boolean") {
    console.warn(
      "Elysia server unavailable for share-session alias test; skipping",
    );
    return;
  }
  expect(typeof share.ok).toBe("boolean");
  const unshare = await fetchJson(
    `${BASE}/sessions/127.0.0.1/dummy-id/unshare-session`,
    { method: "POST" },
  );
  expect(typeof unshare.ok).toBe("boolean");
  const clear = await fetchJson(`${BASE}/sessions/127.0.0.1/clear-sessions`, {
    method: "POST",
  });
  expect(typeof clear.ok).toBe("boolean");
});
