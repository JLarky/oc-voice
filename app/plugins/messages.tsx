// app/plugins/messages.ts - Elysia messages routes using queue domain (prototype)
import { Elysia } from "elysia";
import { FIRST_MESSAGE_INSTRUCTION, listMessages } from "../../src/oc-client";
import { dataStarPatchElementsString } from "../../rendering/datastar";
import {
  createQueueStores,
  enqueueMessage,
  processMessageQueue,
  retryLastFailed,
  QueueStores,
} from "../../domain/queue";

export interface MessagesPluginDeps {
  ipStore: string[];
  advancedAggregatedStateBySession?: Record<string, any>;
}

export function messagesPlugin(deps: MessagesPluginDeps, stores: QueueStores) {
  const resolveBaseUrl = (ip: string) => `http://${ip}:2000`;
  // periodic queue processor
  setInterval(
    () =>
      processMessageQueue(
        stores,
        resolveBaseUrl,
        deps.advancedAggregatedStateBySession,
      ),
    1000,
  );
  return new Elysia({ name: "messages" })
    .post("/sessions/:ip/:sid/message", async ({ params, body }) => {
      const { ip, sid } = params as any;
      if (!deps.ipStore.includes(ip))
        return new Response(
          dataStarPatchElementsString(
            <div id="session-message-result" class="result">
              unknown ip
            </div>,
          ),
          {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            status: 404,
          },
        );
      let text =
        (body as any)?.messageText ||
        (body as any)?.messagetext ||
        (body as any)?.text ||
        "";
      if (Array.isArray((body as any)?.parts)) {
        const part = (body as any).parts.find((p: any) => p?.type === "text");
        if (part && typeof part.text === "string" && part.text.trim())
          text = part.text.trim();
      }
      text = typeof text === "string" ? text.trim() : "";
      if (!text)
        return new Response(
          dataStarPatchElementsString(
            <div id="session-message-result" class="result">
              empty text
            </div>,
          ),
          {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            status: 400,
          },
        );
      let injected = false;
      try {
        const msgs = await listMessages(resolveBaseUrl(ip), sid).catch(
          () => [],
        );
        if (msgs.length === 0) {
          text = FIRST_MESSAGE_INSTRUCTION + "\n\n" + text;
          injected = true;
        }
      } catch {}
      const { length } = enqueueMessage(
        stores,
        ip,
        sid,
        text,
        deps.advancedAggregatedStateBySession,
      );
      processMessageQueue(
        stores,
        resolveBaseUrl,
        deps.advancedAggregatedStateBySession,
      ).catch(() => {});
      const jsx = (
        <div id="session-message-result" class="result">
          queued message for {sid} ({length} in queue)
          {injected ? " | injected first context" : ""}
        </div>
      );
      return new Response(dataStarPatchElementsString(jsx), {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    })
    .post("/sessions/:ip/:sid/message/retry", ({ params }) => {
      const { ip, sid } = params as any;
      if (!deps.ipStore.includes(ip))
        return new Response(
          dataStarPatchElementsString(
            <div id="session-message-result" class="result">
              unknown ip
            </div>,
          ),
          {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            status: 404,
          },
        );
      const res = retryLastFailed(
        stores,
        ip,
        sid,
        deps.advancedAggregatedStateBySession,
      );
      if (!res.ok)
        return new Response(
          dataStarPatchElementsString(
            <div id="session-message-result" class="result">
              {res.error}
            </div>,
          ),
          {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            status: 400,
          },
        );
      processMessageQueue(
        stores,
        resolveBaseUrl,
        deps.advancedAggregatedStateBySession,
      ).catch(() => {});
      const jsx = (
        <div id="session-message-result" class="result">
          retry queued for {sid}
        </div>
      );
      return new Response(dataStarPatchElementsString(jsx), {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    });
}

export function createMessagesPlugin(
  ipStore: string[],
  advancedAggregatedStateBySession?: Record<string, any>,
) {
  return messagesPlugin(
    { ipStore, advancedAggregatedStateBySession },
    createQueueStores(),
  );
}
