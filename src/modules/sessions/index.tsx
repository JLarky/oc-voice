import { Elysia } from "elysia";
import { dataStarPatchElementsSSE } from "../../../rendering/datastar";
import { AdvancedRecentMessages } from "../../../rendering/fragments";
import { doesIpExist } from "../../utils/store-ips";
import { listMessages } from "../../oc-client";
import { shouldReuseSummary } from "../../hash";

export const sessionsPlugin = new Elysia({ name: "sessions-messages" }).get(
  "/sessions/:ip/:sid/messages/stream",
  async function* ({ params, request }) {
    const { ip, sid } = params as { ip: string; sid: string };
    if (!ip || !sid || !(await doesIpExist(ip))) {
      yield dataStarPatchElementsSSE(
        <div id="messages-status" class="status">
          Unknown IP
        </div>,
      );
      return;
    }
    const cacheKey = `${ip}::${sid}`;
    let lastHash = "";
    let lastSummary = "";
    let lastAction = false;
    // Simple loop (2s cadence) until aborted
    while (!request.signal.aborted) {
      try {
        const base = `http://${ip}:2000`;
        let msgs: any[] = [];
        try {
          const textMessages = await listMessages(base, sid);
          msgs = textMessages.map((m) => ({
            role: m.role,
            text: m.texts.join("\n"),
            parts: m.texts.map((t) => ({ type: "text", text: t })),
          }));
        } catch (e) {
          console.error(
            "Elysia messages list error",
            ip,
            sid,
            (e as Error).message,
          );
        }
        const count = msgs.length;
        const trimmed = count > 50 ? msgs.slice(-50) : msgs;
        const recentForHash = msgs.slice(-3).map((m) => ({
          role: m.role || "message",
          text: (m.parts?.[0]?.text || m.text || "")
            .replace(/\s+/g, " ")
            .trim(),
        }));
        const { hash: recentHash, reuse } = shouldReuseSummary(
          lastHash,
          recentForHash,
        );
        let summaryText = "(no recent messages)";
        if (count === 0) {
          summaryText = "(no recent messages)";
        } else if (reuse) {
          summaryText = lastSummary || "(no recent messages)";
        } else {
          // Only summarize if last message role assistant
          const lastRole = msgs[msgs.length - 1]?.role || "";
          if (lastRole === "assistant") {
            summaryText = "...";
            try {
              const { summarizeMessages } = await import("../../oc-client");
              const summ = await summarizeMessages(base, recentForHash, sid);
              if (summ.ok) {
                summaryText = summ.summary || "(empty summary)";
                lastAction = !!summ.action;
              } else {
                summaryText = "(summary failed)";
                lastAction = false;
              }
            } catch {
              summaryText = "(summary failed)";
              lastAction = false;
            }
            lastHash = recentHash;
            lastSummary = summaryText;
          } else {
            summaryText = lastSummary || "(no recent messages)";
          }
        }
        // Patch status + list
        yield dataStarPatchElementsSSE(
          <div
            id="messages-status"
            class="status"
          >{`Updated ${new Date().toLocaleTimeString()}`}</div>,
        );
        yield dataStarPatchElementsSSE(
          <AdvancedRecentMessages
            messages={trimmed as any}
            summaryText={summaryText}
            actionFlag={lastAction}
            totalCount={count}
          />,
        );
      } catch (e) {
        console.error(
          "Elysia messages stream loop error",
          (e as Error).message,
        );
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log("Messages SSE ended", { ip, sid });
  },
);
