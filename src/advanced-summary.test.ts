import { test, expect } from 'bun:test';
import { createAdvancedStores, reuseOrPlaceholder } from '../domain/advanced';
import { shouldReuseSummary } from "../src/hash";

test("reuseOrPlaceholder returns placeholder for new hash", () => {
  const stores = createAdvancedStores();
  const recent = [{ role: "assistant", text: "Hello world" }];
  const result = reuseOrPlaceholder(stores, "1.1.1.1", "abc", recent);
  expect(result.text).toBe("...");
  expect(result.reuse).toBe(false);
});

test("reuseOrPlaceholder reuses cached summary when hash matches", () => {
  const stores = createAdvancedStores();
  const recent = [{ role: "assistant", text: "Hello world" }];
  const hash = shouldReuseSummary(undefined, recent).hash;
  stores.summaryCacheBySession["1.1.1.1::abc"] = {
    messageHash: hash,
    summary: "cached summary",
    action: false,
    cachedAt: Date.now(),
  };
  const result = reuseOrPlaceholder(stores, "1.1.1.1", "abc", recent);
  expect(result.text).toBe("cached summary");
  expect(result.reuse).toBe(true);
});
