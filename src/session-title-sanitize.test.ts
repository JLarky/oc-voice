import { describe, test, expect } from "bun:test";

// Directly hit the inline save route handler logic by constructing a Request and passing through server fetch.
import { server } from "../server";
import {
  getEntityDescription,
  removeEntityDescription,
} from "./utils/store-entity-descriptions";

async function fetchRoute(path: string, init?: RequestInit) {
  return await server.fetch(new Request("http://localhost" + path, init));
}

describe("session title sanitize", () => {
  test("stores trimmed and collapsed whitespace, escapes output", async () => {
    const ip = "127.0.0.1";
    // Ensure ip exists in store (server uses getIpStore includes check); loadIps already ran on server import but we ensure manual addition if missing.
    const { addIp } = await import("./utils/store-ips");
    addIp(ip);
    const sid = "sess-xyz";
    const messy = "  Hello   <script>bad</script>  World  ";
    const fd = new FormData();
    fd.set("description", messy);
    const res = await fetchRoute(`/sessions/${ip}/${sid}/title-save`, {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Output should have escaped tags
    expect(text.includes("&lt;script&gt;bad&lt;/script&gt;")).toBe(true);
    // Stored value should be sanitized collapse
    const stored = await getEntityDescription(ip + ":" + sid);
    expect(stored).toBe("Hello <script>bad</script> World");
    // Cleanup
    await removeEntityDescription(ip + ":" + sid);
  });
});
