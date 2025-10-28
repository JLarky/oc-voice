import { describe, test, expect } from "bun:test";
import { Elysia } from "elysia";
import { effectSessionsPlugin } from "./modules/sessions/effect-stream";
import { addIp } from "./utils/store-ips";

// Verify effect-based session stream SSE emits datastar patches.

describe("effect sessions SSE stream", () => {
  test("returns event-stream with initial datastar patches", async () => {
    addIp("5.6.7.8");
    const app = new Elysia().use(effectSessionsPlugin);
    const controller = new AbortController();
    const url = "http://localhost/sessions/5.6.7.8/xyz/effect/stream";
    const response = await app.handle(
      new Request(url, { signal: controller.signal }),
    );
    expect(response.status).toBe(200);
    const ctype = response.headers.get("content-type") || "";
    expect(ctype).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (let i = 0; i < 8; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      if (typeof value === "string") buf += value;
      else if (value) buf += decoder.decode(value);
      if (buf.includes("messages-status") && buf.match(/id=\"messages-list\"/))
        break;
    }
    controller.abort();
    expect(buf).toContain("event: datastar-patch-elements");
    expect(buf).toMatch(/data: elements <div id=\"messages-status\"/);
    // Expect recent messages fragment (messages-list) also emitted early (may be empty list markup)
    expect(buf).toMatch(/data: elements <div id=\"messages-list\"/);
  });
});
