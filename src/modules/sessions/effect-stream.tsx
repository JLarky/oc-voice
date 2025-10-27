import { Elysia } from "elysia";
import * as v from "valibot";
import { dataStarPatchElementsString } from "../../../rendering/datastar";
import { doesIpExist } from "../../utils/store-ips";
import {
  subscribe,
  startTimer,
  registerSessionManager,
  unregisterSessionManager,
  sessionManagers,
  getSessionCurrentState,
} from "./pubsub";
import { createSessionManager, buildFragments, Msg } from "./session-manager";

export const effectSessionsPlugin = new Elysia({
  name: "sessions-effect-stream",
}).get(
  "/sessions/:ip/:sid/effect/stream",
  async ({ params, request }) => {
    const { ip, sid } = params;
    if (!ip || !sid || !(await doesIpExist(ip)))
      return new Response("Unknown IP", { status: 404 });
    const remoteBase = `http://${ip}:2000`;
    const cacheKey = remoteBase + "::" + sid;
    startTimer();

    const encoder = new TextEncoder();
    const queue: string[] = [];
    let aborted = false;

    // Subscribe to typed session messages FIRST, before registering session manager
    let unsubscribePing: (() => void) | null = null;
    unsubscribePing = subscribe(cacheKey, (message) => {
      if (message.type === "updated-at") {
        const status = (
          <div
            id="messages-status"
            className="status"
          >{`Updated ${message.time.toLocaleTimeString()}`}</div>
        );
        queue.push(dataStarPatchElementsString(status));
      } else if (message.type === "publish-element") {
        // Shared session manager is publishing an element to this stream
        queue.push(dataStarPatchElementsString(message.element));
      }
    });

    // NOW register session manager (which will publish initial updates)
    if (!sessionManagers.has(cacheKey)) {
      const dispose = createSessionManager(cacheKey, remoteBase, sid);
      registerSessionManager(cacheKey, dispose);
    } else {
      // If session manager already exists, get current state and render fresh fragments
      const currentState = getSessionCurrentState(cacheKey);
      if (currentState) {
        const fragments = buildFragments(
          currentState.msgs as Msg[],
          currentState.summary.summary,
          currentState.summary.action,
        );
        for (const fragment of fragments) {
          queue.push(dataStarPatchElementsString(fragment));
        }
      }
    }

    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const flush = () => {
          if (aborted) {
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch (_) {}
            }
            return;
          }
          if (queue.length) {
            const out = queue.splice(0, queue.length);
            for (const frag of out) controller.enqueue(encoder.encode(frag));
          }
          setTimeout(flush, 100);
        };
        setTimeout(flush, 0);
      },
      cancel() {
        aborted = true;
        if (unsubscribePing) unsubscribePing();
        // Unregister session manager when stream closes
        unregisterSessionManager(cacheKey);
      },
    });

    request.signal.addEventListener("abort", () => {
      aborted = true;
      if (unsubscribePing) unsubscribePing();
      // Unregister session manager when stream closes
      unregisterSessionManager(cacheKey);
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
  {
    params: v.object({ ip: v.string(), sid: v.string() }),
  },
);
