// Hash utilities for recent messages
import { createHash } from "crypto";
import { summarizationPrompt } from "./oc-client";

// SHA-256 hash over normalized role:text lines
// Normalization: role lowercased; text collapsed whitespace & trimmed
export interface RecentMessage {
  role: string;
  text: string;
}

export function recentMessagesHash(messages: RecentMessage[]): string {
  const hash = createHash("sha256");
  hash.update(summarizationPrompt);
  for (const m of messages) {
    const role = (m.role || "message").toLowerCase();
    const text = (m.text || "").replace(/\s+/g, " ").trim();
    const line = role + ":" + text + "\n";
    hash.update(line);
  }
  return hash.digest("hex");
}

export function shouldReuseSummary(
  cachedHash: string | undefined,
  messages: RecentMessage[]
): { hash: string; reuse: boolean } {
  const hash = recentMessagesHash(messages);
  return { hash, reuse: !!cachedHash && cachedHash === hash };
}
