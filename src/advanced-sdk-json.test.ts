import { test, expect } from "bun:test";
import { createAdvancedStores, reuseOrPlaceholder } from "../domain/advanced";

// Basic test of reuseOrPlaceholder hash propagation to ensure summary scheduling placeholder
// (Route testing would require spinning up Elysia server; here we focus on domain logic parity.)

test("advanced summary placeholder triggers non-reuse path", () => {
  const stores = createAdvancedStores();
  const r1 = [
    { role: "assistant", text: "One" },
    { role: "user", text: "Two" },
  ];
  const first = reuseOrPlaceholder(stores, "10.0.0.1", "sessA", r1);
  expect(first.reuse).toBe(false);
  expect(first.text).toBe("...");
  // simulate caching summary
  stores.summaryCacheBySession["10.0.0.1::sessA"] = {
    messageHash: first.hash,
    summary: "Cached short summary",
    action: true,
    cachedAt: Date.now(),
  } as any;
  const second = reuseOrPlaceholder(stores, "10.0.0.1", "sessA", r1);
  expect(second.reuse).toBe(true);
  expect(second.text).toBe("Cached short summary");
  expect(second.action).toBe(true);
});
