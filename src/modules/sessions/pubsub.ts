// ============================================================================
// Typed Messages
// ============================================================================

/**
 * SessionMessage is a discriminated union of all possible message types
 * Extend this to add new message types - all handlers will be type-safe
 *
 * @example
 * // Add a new message type:
 * // export type SessionMessage =
 * //   | { type: "updated-at"; time: Date }
 * //   | { type: "summary-updated"; summary: string; action: boolean }
 * //   | { type: "error"; message: string; code: number };
 *
 * // Then in effect-stream.tsx:
 * // subscribe(cacheKey, (message) => {
 * //   switch (message.type) {
 * //     case "updated-at":
 * //       console.log(`Updated at ${message.time}`);
 * //       break;
 * //     case "summary-updated":
 * //       // handle summary update (fully typed!)
 * //       console.log(message.summary, message.action);
 * //       break;
 * //     case "error":
 * //       console.error(`Error ${message.code}: ${message.message}`);
 * //       break;
 * //   }
 * // });
 */
export type SessionMessage = { type: "updated-at"; time: Date };

export type SessionMessageHandler = (message: SessionMessage) => void;

const subscriptions = new Map<string, SessionMessageHandler[]>();
let globalTimer: NodeJS.Timeout | null = null;

/**
 * Subscribe to typed session messages
 * @param cacheKey Session identifier (e.g., "http://192.168.1.1:2000::session-123")
 * @param handler Callback that receives typed messages
 * @returns Unsubscribe function to clean up listener
 *
 * Automatically manages global timer:
 * - Starts when first subscriber joins
 * - Stops when last subscriber leaves
 *
 * @example
 * const unsubscribe = subscribe(cacheKey, (msg) => {
 *   if (msg.type === "updated-at") {
 *     console.log(`Updated at ${msg.time}`);
 *   }
 * });
 */
export function subscribe(
  cacheKey: string,
  handler: SessionMessageHandler,
): () => void {
  // Ensure session has a handlers array
  if (!subscriptions.has(cacheKey)) {
    subscriptions.set(cacheKey, []);
  }
  subscriptions.get(cacheKey)!.push(handler);

  // Start global timer if this is the first subscription
  if (!globalTimer) {
    globalTimer = setInterval(() => {
      publishToSession(undefined, { type: "updated-at", time: new Date() });
    }, 2000);
  }

  // Return unsubscribe function
  return () => {
    const handlers = subscriptions.get(cacheKey);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx > -1) handlers.splice(idx, 1);

      // Clean up empty sessions
      if (handlers.length === 0) {
        subscriptions.delete(cacheKey);
      }
    }

    // Stop global timer if no more subscribers remain
    if (subscriptions.size === 0 && globalTimer) {
      clearInterval(globalTimer);
      globalTimer = null;
    }
  };
}

/**
 * Publish a message to handlers in a session
 * @param cacheKey Session identifier (or undefined to broadcast to all sessions)
 * @param message Typed message to publish
 */
export function publishToSession(
  cacheKey: string | undefined,
  message: SessionMessage,
): void {
  if (cacheKey) {
    const handlers = subscriptions.get(cacheKey);
    if (handlers) {
      for (const handler of handlers) {
        handler(message);
      }
    }
  } else {
    // Broadcast to all sessions
    for (const handlers of subscriptions.values()) {
      for (const handler of handlers) {
        handler(message);
      }
    }
  }
}
