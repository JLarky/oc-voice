import { Elysia } from "elysia";
import {
  dataStarPatchElementsSSE,
  dataStarPatchElementsString,
} from "../../../rendering/datastar";
import { doesIpExist } from "../../utils/store-ips";
import {
  listMessages,
  sendMessage as rawSendMessage,
  FIRST_MESSAGE_INSTRUCTION,
} from "../../oc-client";
import { publishElementToStreams } from "./pubsub";
import * as v from "valibot";

// Ephemeral tracking for first-message injection (session scoped)
const firstMessageSeen = new Set<string>();
const inFlightFirstMessage: Record<string, boolean> = {};

function resolveBaseUrl(ip: string) {
  return `http://${ip}:2000`;
}

export const sendMessagePlugin = new Elysia({
  name: "sessions-send-message",
}).post(
  "/sessions/:ip/:sid/message",
  async ({ params, request }) => {
    const sseParts: string[] = [];
    const { ip, sid } = params;
    if (!ip || !sid || !(await doesIpExist(ip))) {
      sseParts.push(
        dataStarPatchElementsString(
          <div id="session-message-result" class="result">
            Error Invalid IP or session ID
          </div>,
        ),
      );
      return new Response(sseParts.join(""), {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    }
    const cacheKey = resolveBaseUrl(ip) + "::" + sid;
    // Manual parse body (test omits Content-Type header)
    let rawText = "";
    try {
      const bodyText = await request.text();
      try {
        const parsed = JSON.parse(bodyText || "{}");
        rawText = (parsed.messagetext || parsed.text || "").trim();
      } catch {
        rawText = bodyText.trim();
      }
    } catch {}
    if (!rawText) {
      sseParts.push(
        dataStarPatchElementsString(
          <div id="session-message-result" class="result">
            No text
          </div>,
        ),
      );
      return new Response(sseParts.join(""), {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    }
    const sessionKey = sid;
    let sendText = rawText;
    try {
      if (
        !firstMessageSeen.has(sessionKey) &&
        !inFlightFirstMessage[sessionKey]
      ) {
        inFlightFirstMessage[sessionKey] = true;
        let existingCount = 0;
        try {
          const existing = await listMessages(resolveBaseUrl(ip), sid).catch(
            () => [],
          );
          existingCount = existing.length;
        } catch {}
        if (existingCount === 0)
          sendText = FIRST_MESSAGE_INSTRUCTION + "\n\n" + sendText;
        firstMessageSeen.add(sessionKey);
        delete inFlightFirstMessage[sessionKey];
      }
    } catch {
      delete inFlightFirstMessage[sessionKey];
    }
    function sanitize(s: string) {
      return s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c] || c,
      );
    }
    // Show sending state
    publishElementToStreams(
      cacheKey,
      <div id="session-message-result" class="result">
        Sending...
      </div>,
    );
    sseParts.push(
      dataStarPatchElementsString(
        <div id="session-message-result" class="result">
          Sending...
        </div>,
      ),
    );
    const result = await rawSendMessage(resolveBaseUrl(ip), sid, sendText);
    if (!result.ok) {
      const msg = result.error || `HTTP ${result.status}`;
      publishElementToStreams(
        cacheKey,
        <div id="session-message-result" class="result">
          Error: {sanitize(msg)}
        </div>,
      );
      sseParts.push(
        dataStarPatchElementsString(
          <div id="session-message-result" class="result">
            Error: {sanitize(msg)}
          </div>,
        ),
      );
      return new Response(sseParts.join(""), {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    }
    const replyCombined = result.replyTexts.join("\n").trim();
    if (replyCombined) {
      publishElementToStreams(
        cacheKey,
        <div id="session-message-result" class="result">
          Reply: {sanitize(replyCombined)}
        </div>,
      );
      sseParts.push(
        dataStarPatchElementsString(
          <div id="session-message-result" class="result">
            Reply: {sanitize(replyCombined)}
          </div>,
        ),
      );
    }
    // Clear status afterwards
    publishElementToStreams(
      cacheKey,
      <div id="session-message-result" class="result"></div>,
    );
    sseParts.push(
      dataStarPatchElementsString(
        <div id="session-message-result" class="result"></div>,
      ),
    );
    return new Response(sseParts.join(""), {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
  },
  {
    params: v.object({
      ip: v.string(),
      sid: v.string(),
    }),
  },
);
