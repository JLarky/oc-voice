import { describe, test, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { ipDescriptionPlugin } from "./modules/ips/ip-description-plugin";
import { setEntityDescription } from "./utils/store-entity-descriptions";

// The plugin exposes display, edit, and save routes that return small HTML fragments.
// We test that:
// 1. Display shows existing description escaped
// 2. Edit form renders with existing description value
// 3. Save updates description and returns display fragment
// 4. Empty description results in placeholder text
// 5. Description is trimmed and collapses whitespace

function mockRequest(method: string, url: string, body?: Record<string, any>) {
  if (method === "POST" && body) {
    const fd = new FormData();
    Object.entries(body).forEach(([k, v]) => fd.append(k, String(v)));
    return new Request(url, { method, body: fd });
  }
  return new Request(url, { method });
}

describe("ipDescriptionPlugin", () => {
  const app = new Elysia().use(ipDescriptionPlugin);
  const base = "http://localhost";
  const ip = "1.2.3.4";

  beforeEach(async () => {
    // Ensure IP present for plugin checks
    const { addIp } = await import("./utils/store-ips");
    addIp(ip);
    await setEntityDescription(ip, "");
  });

  test("display with empty description shows base title only", async () => {
    const res = await app.handle(
      mockRequest("GET", `${base}/ips/${ip}/description-display`),
    );
    const html = await res.text();
    expect(html).toContain("Sessions for 1.2.3.4");
    expect(html).not.toContain("–");
  });

  test("save sets description and display shows escaped", async () => {
    const res = await app.handle(
      mockRequest("POST", `${base}/ips/${ip}/description-save`, {
        description: "My <desc>",
      }),
    );
    const html = await res.text();
    expect(html).toContain("My &lt;desc");
    // Now load display
    const disp = await app.handle(
      mockRequest("GET", `${base}/ips/${ip}/description-display`),
    );
    const dispHtml = await disp.text();
    expect(dispHtml).toContain("My &lt;desc");
  });

  test("edit form shows current description value escaped", async () => {
    await app.handle(
      mockRequest("POST", `${base}/ips/${ip}/description-save`, {
        description: "Alpha & Beta",
      }),
    );
    const editRes = await app.handle(
      mockRequest("GET", `${base}/ips/${ip}/description-edit`),
    );
    const html = await editRes.text();
    expect(html).toContain("Alpha &amp; Beta");
    expect(html).toContain('name="ipDescription"');
  });

  test("whitespace collapsed and trimmed on save", async () => {
    const res = await app.handle(
      mockRequest("POST", `${base}/ips/${ip}/description-save`, {
        description: "  Lots   of   space   here  ",
      }),
    );
    const html = await res.text();
    expect(html).toContain("Lots of space here");
    expect(html).not.toContain("  Lots   of");
  });

  test("empty description after save shows base title only", async () => {
    await app.handle(
      mockRequest("POST", `${base}/ips/${ip}/description-save`, {
        description: "   ",
      }),
    );
    const res = await app.handle(
      mockRequest("GET", `${base}/ips/${ip}/description-display`),
    );
    const html = await res.text();
    expect(html).toContain("Sessions for 1.2.3.4");
    expect(html).not.toContain("–");
  });
});
