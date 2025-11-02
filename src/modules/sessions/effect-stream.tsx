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
  isPaused,
  getQueuedMessageCount,
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
    const referrer = request.headers.get("referer") || "";
    const debug = URL.canParse(referrer)
      ? new URL(referrer).searchParams.get("debug") === "1"
      : false;

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
            let statusText = `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "America/Denver" }).format(message.time)}`;
            if (isPaused(cacheKey)) {
              const pendingCount = getQueuedMessageCount(cacheKey);
              if (pendingCount > 0) {
                statusText += ` (${pendingCount} new message${pendingCount === 1 ? "" : "s"} pending)`;
              }
            }
            const status = (
              <div id="messages-status" className="status">
                {statusText}
              </div>
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
    if (debug) {
      yield dataStarPatchElementsSSE(
        <div id="debug-log" class="status" data-keep>
          debug mode on
        </div>,
      );
    }

    // Yield initial empty fragments (messages-list) immediately for quick UI
    for (const fragment of buildFragments(
      [],
      "(no recent messages)",
      false,
      cacheKey,
    )) {
      yield dataStarPatchElementsSSE(fragment);
    }

    // NOW register session manager (which will publish initial updates)
    if (!sessionManagers.has(cacheKey)) {
      const dispose = createSessionManager(cacheKey, remoteBase, sid, debug);
      registerSessionManager(cacheKey, dispose);
      // Immediately render current (possibly empty) fragments so list appears early
      const currentState = getSessionCurrentState(cacheKey);
      if (currentState) {
        const fragments = buildFragments(
          currentState.msgs,
          currentState.summary.summary,
          currentState.summary.action,
          cacheKey,
        );
        for (const fragment of fragments) {
          yield dataStarPatchElementsSSE(fragment);
        }
      }
      request.signal.addEventListener("abort", () => {
        if (unsubscribePing) unsubscribePing?.();
        unregisterSessionManager(cacheKey);
      });
    } else {
      // If session manager already exists, bump ref count and render fresh fragments
      registerSessionManager(cacheKey, () => {}); // increments refs only
      const currentState = getSessionCurrentState(cacheKey);
      if (currentState) {
        const fragments = buildFragments(
          currentState.msgs,
          currentState.summary.summary,
          currentState.summary.action,
          cacheKey,
        );
        for (const fragment of fragments) {
          yield dataStarPatchElementsSSE(fragment);
        }
      }

      request.signal.addEventListener("abort", () => {
        if (unsubscribePing) unsubscribePing();
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
