import { Elysia } from "elysia";
import * as v from "valibot";
import { dataStarPatchElementsSSE } from "../../../rendering/datastar";
import { doesIpExist } from "../../utils/store-ips";
import {
  subscribe,
  startTimer,
  registerSessionManager,
  unregisterSessionManager,
  sessionManagers,
  getSessionCurrentState,
} from "./pubsub";
import { createSessionManager, buildFragments } from "./session-manager";
import { buildCacheKey, remoteBaseFromIp } from "./cache-key";
import { JSX } from "preact";
import { Chunk, Effect, Stream, StreamEmit, Option } from "effect";

export const effectSessionsPlugin = new Elysia({
  name: "sessions-effect-stream",
}).get(
  "/sessions/:ip/:sid/effect/stream",
  async function* ({ params, request }) {
    const { ip, sid } = params;
    if (!ip || !sid || !(await doesIpExist(ip)))
      return new Response("Unknown IP", { status: 404 });
    const remoteBase = remoteBaseFromIp(ip);
    const cacheKey = buildCacheKey(ip, sid);

    function onAbort(cb: () => void) {
      request.signal.addEventListener("abort", cb, { once: true });
    }

    /** Stream closes once request is aborted */
    const abortStream = Stream.async(
      (emit: StreamEmit.Emit<never, never, "abort", void>) => {
        onAbort(() => {
          emit(Effect.succeed(Chunk.of("abort")));
          emit(Effect.fail(Option.none()));
        });
      },
    );

    startTimer();

    // Subscribe to typed session messages FIRST, before registering session manager
    let unsubscribePing: (() => void) | null = null;

    const timerStream = Stream.async(
      (emit: StreamEmit.Emit<never, never, JSX.Element, void>) => {
        unsubscribePing = subscribe(cacheKey, (message) => {
          if (message.type === "updated-at") {
            const status = (
              <div
                id="messages-status"
                className="status"
              >{`Updated ${message.time.toLocaleTimeString()}`}</div>
            );
            emit(Effect.succeed(Chunk.of(status)));
          } else if (message.type === "publish-element") {
            // Shared session manager is publishing an element to this stream
            emit(Effect.succeed(Chunk.of(message.element)));
          }
        });
        onAbort(() => emit(Effect.fail(Option.none())));
      },
    );

    yield dataStarPatchElementsSSE(
      <div id="messages-status" class="status">
        Updating...
      </div>,
    );

    // NOW register session manager (which will publish initial updates)
    if (!sessionManagers.has(cacheKey)) {
      const dispose = createSessionManager(cacheKey, remoteBase, sid);
      registerSessionManager(cacheKey, dispose);
    } else {
      // If session manager already exists, get current state and render fresh fragments
      const currentState = getSessionCurrentState(cacheKey);
      if (currentState) {
        const fragments = buildFragments(
          currentState.msgs,
          currentState.summary.summary,
          currentState.summary.action,
        );
        for (const fragment of fragments) {
          yield dataStarPatchElementsSSE(fragment);
        }
      }

      request.signal.addEventListener("abort", () => {
        if (unsubscribePing) unsubscribePing();
        // Unregister session manager when stream closes
        unregisterSessionManager(cacheKey);
      });
    }

    for await (const x of Stream.toAsyncIterable(
      Stream.merge(timerStream, abortStream),
    )) {
      if (x === "abort") {
        return;
      } else {
        if (!request.signal.aborted) {
          yield dataStarPatchElementsSSE(x);
        } else {
          console.log("aborted, but", sid, x);
        }
      }
    }
  },
  {
    params: v.object({ ip: v.string(), sid: v.string() }),
  },
);
