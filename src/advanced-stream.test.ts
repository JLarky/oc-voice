import { createAdvancedStores } from "../domain/advanced";
import {
  updateAggregatedSummary,
  prunePartsAndTypes,
} from "../domain/advanced-stream";

function makeMessages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? "user" : "assistant",
    texts: ["msg" + i],
  }));
}

test("updateAggregatedSummary returns synthetic event when count changes", () => {
  const stores = createAdvancedStores();
  const msgs = makeMessages(5);
  const forHash = msgs
    .slice(-3)
    .map((m) => ({ role: m.role, text: m.texts.join(" ") }));
  const r1 = updateAggregatedSummary(
    stores,
    "10.0.0.1",
    "s1",
    "http://x:2000",
    forHash,
    5,
    0,
  );
  expect(r1.syntheticEvent).toBeTruthy();
  const r2 = updateAggregatedSummary(
    stores,
    "10.0.0.1",
    "s1",
    "http://x:2000",
    forHash,
    5,
    5,
  );
  expect(r2.syntheticEvent).toBeUndefined();
});

test("prunePartsAndTypes caps parts and types", () => {
  const parts: Record<string, { updatedAt: number }> = {};
  for (let i = 0; i < 250; i++) parts["p" + i] = { updatedAt: Date.now() - i };
  const types: string[] = [];
  for (let i = 0; i < 80; i++) types.push("t" + i);
  prunePartsAndTypes(parts, types, { partsLimit: 200, typesLimit: 50 });
  expect(Object.keys(parts).length).toBeLessThanOrEqual(200);
  expect(types.length).toBeLessThanOrEqual(50);
});
