import { test, expect } from "bun:test";
import { pagesPlugin } from "../app/plugins/pages";
import { Elysia } from "elysia";

// Minimal ipStore with one IP to exercise page routes
const ipStore = ["1.2.3.4"];

function makeApp() {
  return new Elysia().use(pagesPlugin(ipStore));
}

async function get(path: string) {
  const app = makeApp();
  const res = await app.handle(new Request("http://localhost" + path));
  return res;
}

test("sessions list page contains required IDs", async () => {
  const res = await get("/sessions/1.2.3.4");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('id="sessions-status"');
  expect(html).toContain('id="sessions-list"');
});

test("session detail page contains message elements", async () => {
  const res = await get("/sessions/1.2.3.4/abc");
  // Unknown session id just renders page (legacy redirects require remote validation; here we just serve)
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('id="messages-status"');
  expect(html).toContain('id="session-message-form"');
});

test("advanced session page contains advanced/status/events containers", async () => {
  const res = await get("/sessions/1.2.3.4/abc/advanced");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('id="advanced-status"');
  expect(html).toContain('id="advanced-info"');
  expect(html).toContain('id="advanced-events"');
});
