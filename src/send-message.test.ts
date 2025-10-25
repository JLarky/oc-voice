import { describe, it, expect } from "bun:test";
import { sendMessage } from "./oc-client";

function mockFetchSequence(
  responses: Array<{ ok: boolean; status?: number; json?: any }>,
) {
  let call = 0;
  // @ts-ignore
  global.fetch = async (url: string, opts?: any) => {
    const idx = call++;
    const spec = responses[idx];
    if (!spec) throw new Error("Unexpected fetch call " + idx + " " + url);
    return {
      ok: spec.ok,
      status: spec.status ?? (spec.ok ? 200 : 500),
      async json() {
        return spec.json;
      },
    } as any;
  };
}

describe("sendMessage", () => {
  it("extracts reply text parts from top-level parts", async () => {
    mockFetchSequence([
      { ok: true, json: { parts: [{ type: "text", text: "Hello there" }] } },
    ]);
    const res = await sendMessage("http://127.0.0.1:2000", "sess-1", "ping");
    expect(res.ok).toBe(true);
    expect(res.replyTexts).toEqual(["Hello there"]);
  });

  it("extracts reply text parts from nested data.parts", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: { data: { parts: [{ type: "text", text: "Nested hi" }] } },
      },
    ]);
    const res = await sendMessage("http://127.0.0.1:2000", "sess-2", "ping");
    expect(res.ok).toBe(true);
    expect(res.replyTexts).toEqual(["Nested hi"]);
  });

  it("returns error on empty input", async () => {
    const res = await sendMessage("http://127.0.0.1:2000", "sess-3", "   ");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Empty text");
  });

  it("propagates server error message", async () => {
    mockFetchSequence([{ ok: false, status: 500, json: { error: "boom" } }]);
    const res = await sendMessage("http://127.0.0.1:2000", "sess-4", "ping");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
  });
});
