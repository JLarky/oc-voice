import { describe, it, expect } from "bun:test";
import "./index.tsx"; // ensure server started
import { server } from "../server";
import { addIp } from "./utils/store-ips";
// use server.fetch to avoid global fetch overrides

function escapeHtml(val: string): string {
  return val.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}

addIp("127.0.0.1");

describe("session-title-plugin", () => {
  it("saves and returns escaped title fragment", async () => {
    const ip = "127.0.0.1";
    const sid = "sess-test-title";
    const composite = ip + ":" + sid;
    // Persist description via title-save (acts like form submission)
    const form = new FormData();
    form.set("description", "Hello <World> & everyone");
    const saveRes = await server.fetch(
      new Request(`http://localhost:3000/sessions/${ip}/${sid}/title-save`, {
        method: "POST",
        body: form,
      }),
    );
    expect(saveRes.status).toBe(200);
    const saveHtml = await saveRes.text();
    expect(saveHtml).toContain(escapeHtml("Hello <World> & everyone"));
    // Fetch edit fragment to verify prefill signal
    const editRes = await server.fetch(
      new Request(`http://localhost:3000/sessions/${ip}/${sid}/title-edit`),
    );
    expect(editRes.status).toBe(200);
    const editHtml = await editRes.text();
    expect(editHtml).toContain("data-bind:description");
    expect(editHtml).toContain(escapeHtml("Hello <World> & everyone"));
  });

  it("sanitizes whitespace and length", async () => {
    const ip = "127.0.0.1";
    const sid = "sess-whitespace";
    const long = "A".repeat(400);
    const messy = "  Foo\n\nBar\tBaz   " + long;
    const form = new FormData();
    form.set("description", messy);
    const res = await server.fetch(
      new Request(`http://localhost:3000/sessions/${ip}/${sid}/title-save`, {
        method: "POST",
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    // Sanitized: collapse whitespace and truncate to 256
    const sanitized = ("Foo Bar Baz " + long)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 256);
    expect(html).toContain(escapeHtml(sanitized));
  });
});
