import { describe, test, expect } from "bun:test";
import { Elysia } from "elysia";
import { effectSessionsPlugin } from "./modules/sessions/effect-stream";
import { addIp } from "./utils/store-ips";

// Ensure abort does not trigger double close error.

describe("effect sessions SSE abort safety", () => {
  test("aborting stream does not throw", async () => {
    addIp("9.9.9.9");
    const app = new Elysia().use(effectSessionsPlugin);
    const controller = new AbortController();
    const url = "http://localhost/sessions/9.9.9.9/abc/effect/stream";
    const response = await app.handle(
      new Request(url, { signal: controller.signal }),
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    // Single read then abort early
    await reader.read();
    controller.abort();
    // Extra read after abort should not throw
    await reader.read().catch((e) => {
      throw new Error("Unexpected read error: " + e.message);
    });
    expect(true).toBe(true);
  });
});
