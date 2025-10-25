import { describe, test, expect } from "bun:test";
import { recentMessagesHash, shouldReuseSummary } from "./hash";
import { createHash } from "crypto";

function msg(role: string, text: string) {
  return { role, text };
}

describe("recentMessagesHash", () => {
  test("identical content with whitespace variations yields same hash", () => {
    const a = recentMessagesHash([
      msg("User", " Hello   world\n"),
      msg("Assistant", "How are   you?"),
      msg("User", "Fine"),
    ]);
    const b = recentMessagesHash([
      msg("user", "Hello world"), // role case & collapsed spaces
      msg("assistant", "How are you?"),
      msg("user", "Fine"),
    ]);
    expect(a).toBe(b);
  });

  test("role or text changes alter hash", () => {
    const base = recentMessagesHash([
      msg("user", "hi"),
      msg("assistant", "there"),
    ]);
    const changedRole = recentMessagesHash([
      msg("assistant", "hi"),
      msg("assistant", "there"),
    ]);
    const changedText = recentMessagesHash([
      msg("user", "hi!"),
      msg("assistant", "there"),
    ]);
    expect(base).not.toBe(changedRole);
    expect(base).not.toBe(changedText);
  });

  test("includes summarizationPrompt seed", () => {
    const messages = [msg("user", "alpha"), msg("assistant", "beta")];
    const withPrompt = recentMessagesHash(messages);
    // Compute hash without the prompt seed to ensure mismatch
    const hash = createHash("sha256");
    for (const m of messages) {
      const role = (m.role || "message").toLowerCase();
      const text = (m.text || "").replace(/\s+/g, " ").trim();
      hash.update(role + ":" + text + "\n");
    }
    const withoutPrompt = hash.digest("hex");
    expect(withPrompt).not.toBe(withoutPrompt);
  });
});

describe("shouldReuseSummary", () => {
  test("reuse true only when hashes match", () => {
    const messages = [msg("user", "hi"), msg("assistant", "there")];
    const h = recentMessagesHash(messages);
    const { reuse } = shouldReuseSummary(h, messages);
    expect(reuse).toBe(true);
    const { reuse: reuse2 } = shouldReuseSummary("deadbeef", messages);
    expect(reuse2).toBe(false);
  });
});
