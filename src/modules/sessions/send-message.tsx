import { Elysia } from "elysia";
import { dataStarPatchElementsSSE } from "../../../rendering/datastar";
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

import { buildCacheKey, remoteBaseFromIp } from "./cache-key";

export const sendMessagePlugin = new Elysia({
  name: "sessions-send-message",
}).post(
  "/sessions/:ip/:sid/message",
  async function* ({ params, body }) {
    const { ip, sid } = params;
    if (!ip || !sid || !(await doesIpExist(ip))) {
      yield dataStarPatchElementsSSE(
        <div id="session-message-result" class="result">
          Error Invalid IP or session ID
        </div>,
      );
      return;
    }
    const cacheKey = buildCacheKey(ip, sid);
    let text = body.messagetext;
    if (!text) {
      yield dataStarPatchElementsSSE(
        <div id="session-message-result" class="result">
          No text
        </div>,
      );
      return;
    }
    yield dataStarPatchElementsSSE(
      <div id="session-message-result" class="result">
        Sending...
      </div>,
    );
    const sessionKey = sid;
    let injected = false;
    try {
      if (
        !firstMessageSeen.has(sessionKey) &&
        !inFlightFirstMessage[sessionKey]
      ) {
        inFlightFirstMessage[sessionKey] = true;
        let existingCount = 0;
        try {
          const existing = await listMessages(remoteBaseFromIp(ip), sid).catch(
            () => [],
          );
          existingCount = existing.length;
        } catch {}
        if (existingCount === 0) {
          text = FIRST_MESSAGE_INSTRUCTION + "\n\n" + text;
          injected = true;
        }
        firstMessageSeen.add(sessionKey);
        delete inFlightFirstMessage[sessionKey];
      }
    } catch {
      delete inFlightFirstMessage[sessionKey];
    }
    yield publishElementToStreams(
      cacheKey,
      <div id="session-message-result" class="result">
        Added to queue...
      </div>,
    );
    let failed = "";
    (async () => {
      const result = await rawSendMessage(remoteBaseFromIp(ip), sid, text);
      if (!result.ok) {
        failed = result.error || `HTTP ${result.status}`;
        publishElementToStreams(
          cacheKey,
          <div id="session-message-result" class="result">
            Error: {failed}
          </div>,
        );
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!failed) {
      yield publishElementToStreams(
        cacheKey,
        <div id="session-message-result" class="result"></div>,
      );
    }
  },
  {
    params: v.object({
      ip: v.string(),
      sid: v.string(),
    }),
    body: v.object({
      messagetext: v.string(),
    }),
  },
);
