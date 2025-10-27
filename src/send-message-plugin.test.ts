import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { sendMessagePlugin } from "./modules/sessions/send-message";
import { addIp } from "./utils/store-ips";
import { FIRST_MESSAGE_INSTRUCTION } from "./oc-client";
import { subscribe, __resetSessionManagers } from "./modules/sessions/pubsub";

function mockFetchSequence(
  responses: Array<{ ok: boolean; status?: number; json?: any }>,
  bodies: string[] = [],
) {
  let call = 0;
  // @ts-ignore
  global.fetch = async (url: string, opts?: any) => {
    const idx = call++;
    const spec = responses[idx];
    if (!spec) throw new Error("Unexpected fetch call " + idx + " " + url);
    if (opts && opts.body) bodies.push(String(opts.body));
    return {
      ok: spec.ok,
      status: spec.status ?? (spec.ok ? 200 : 500),
      async json() {
        return spec.json;
      },
    } as any;
  };
  return bodies;
}

describe("sendMessagePlugin", () => {
  it("injects first message instruction and publishes to effect/stream", async () => {
    addIp("127.0.0.1");
    __resetSessionManagers();
    const bodies: string[] = [];
    mockFetchSequence(
      [
        { ok: true, json: [] }, // listMessages => empty triggers injection
        {
          ok: true,
          json: { parts: [{ type: "text", text: "Assistant reply here" }] },
        },
      ],
      bodies,
    );
    const cacheKey = "http://127.0.0.1:2000::sess-abc";

    // Set up subscription to capture published elements
    const publishedElements: string[] = [];
    const unsubscribe = subscribe(cacheKey, (message) => {
      if (message.type === "publish-element") {
        // Convert element to string for testing
        publishedElements.push(JSON.stringify(message.element));
      }
    });

    const app = new Elysia().use(sendMessagePlugin);
    const req = new Request(
      "http://localhost/sessions/127.0.0.1/sess-abc/message",
      {
        method: "POST",
        body: JSON.stringify({ messagetext: "Hello world" }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    const res = await app.handle(req);
    const txt = await res.text();

    // Message endpoint yields SSE responses
    expect(txt).toContain("event: datastar-patch-elements");
    expect(txt).toContain("Sending...");

    // Check that POST body had injection
    const postBody = bodies.find((b) => b.includes("parts"));
    expect(postBody).toBeDefined();
    const parsed = JSON.parse(postBody!);
    const sentText = parsed.parts[0].text as string;
    expect(sentText.startsWith(FIRST_MESSAGE_INSTRUCTION)).toBe(true);

    // Verify published element was captured (from publishElementToStreams)
    expect(publishedElements.length > 0).toBe(true);

    unsubscribe();
  });
});
