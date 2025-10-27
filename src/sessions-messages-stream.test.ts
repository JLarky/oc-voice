import { describe, test, expect } from "bun:test";
import { Elysia } from "elysia";
import { sessionsPlugin } from "./modules/sessions";
import { addIp } from "./utils/store-ips";

// Focus: basic SSE headers + initial Datastar patch events for messages stream.
// We abort after first patches to avoid hanging on infinite loop.

describe("sessions messages SSE stream", () => {
  test("returns event-stream with datastar patch events", async () => {
    // Add IP so handler does not early-return Unknown IP
    addIp("1.2.3.4");
    const app = new Elysia().use(sessionsPlugin);
    const controller = new AbortController();
    const url = "http://localhost/sessions/1.2.3.4/abc/messages/stream";
    const response = await app.handle(
      new Request(url, { signal: controller.signal }),
    );
    expect(response.status).toBe(200);
    const ctype = response.headers.get("content-type") || "";
    expect(ctype).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    // Read until we see at least one datastar patch and messages-status element
    for (let i = 0; i < 3; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      if (typeof value === "string") buf += value;
      else if (value) buf += decoder.decode(value);
      if (buf.includes("messages-status")) break;
    }
    controller.abort();
    expect(buf).toContain("event: datastar-patch-elements");
    expect(buf).toMatch(/data: elements <div id="messages-status"/);
  });
});
