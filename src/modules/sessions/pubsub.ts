import { JSX } from "preact";

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
export type SessionMessage =
  | { type: "updated-at"; time: Date }
  | { type: "publish-element"; element: JSX.Element };

export type SessionMessageHandler = (message: SessionMessage) => void;

const subscriptions = new Map<string, SessionMessageHandler[]>();
let globalTimer: NodeJS.Timeout | null = null;

// Session managers - one per unique session to share logic across multiple streams
export const sessionManagers = new Map<
  string,
  {
    dispose: () => void;
    refs: number;
  }
>();

/**
 * Register a session manager for a specific session
 * The manager is responsible for shared logic (polling, summarization, etc.)
 * Call the returned dispose function when cleaning up
 */
interface InternalSessionManagerEntry {
  dispose: () => void;
  refs: number;
}

export function registerSessionManager(
  cacheKey: string,
  dispose: () => void,
): void {
  const existing = sessionManagers.get(cacheKey) as
    | InternalSessionManagerEntry
    | undefined;
  if (existing) {
    existing.refs += 1;
  } else {
    (sessionManagers as any).set(cacheKey, { dispose, refs: 1 });
  }
}

/**
 * Unregister a session manager when all streams have disconnected
 */
export function unregisterSessionManager(cacheKey: string): void {
  const manager = sessionManagers.get(cacheKey) as
    | InternalSessionManagerEntry
    | undefined;
  if (manager) {
    manager.refs -= 1;
    if (manager.refs <= 0) {
      manager.dispose();
      sessionManagers.delete(cacheKey);
    }
  }
}

/**
 * FOR TESTING ONLY: Clear all session managers
 */
export function __resetSessionManagers(): void {
  for (const manager of sessionManagers.values()) {
    manager.dispose();
  }
  sessionManagers.clear();
}

/**
 * Get the replay buffer for a session (recent published elements)
 * Returns all buffered elements so new streams can catch up
 */
export function getSessionReplayBuffer(cacheKey: string): JSX.Element[] {
  const manager = sessionManagers.get(cacheKey);
  if (manager && (manager as any).__replayBuffer) {
    return [...(manager as any).__replayBuffer];
  }
  return [];
}

/**
 * Start the global timer that broadcasts "updated-at" messages every 2 seconds
 * Must be called explicitly to start publishing updates
 */
export function startTimer(): void {
  if (!globalTimer) {
    globalTimer = setInterval(() => {
      publishToSession(undefined, { type: "updated-at", time: new Date() });
    }, 2000);
  }
}

/**
 * Stop the global timer
 */
export function stopTimer(): void {
  if (globalTimer) {
    clearInterval(globalTimer);
    globalTimer = null;
  }
}

/**
 * Subscribe to typed session messages
 * @param cacheKey Session identifier (e.g., "192.168.1.1::session-123")
 * @param handler Callback that receives typed messages
 * @returns Unsubscribe function to clean up listener
 *
 * Note: You must call startTimer() separately to begin broadcasting messages
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

    // Stop timer if no more subscribers remain
    if (subscriptions.size === 0) {
      stopTimer();
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

/**
 * Publish an element (JSX/HTML string) to be rendered in all streams of a session
 * This is called by session managers to push updates to connected streams
 */
export function publishElementToStreams(
  cacheKey: string,
  element: JSX.Element,
): void {
  const handlers = subscriptions.get(cacheKey);
  if (handlers) {
    for (const handler of handlers) {
      // Create a custom message-like structure that handlers can recognize
      // Handlers should check if the message has the element string
      handler({ type: "publish-element", element });
    }
  }
}

/**
 * Get the current state for a session so new streams can render fresh data
 * Returns messages and summary at connection time
 */
export function getSessionCurrentState(cacheKey: string): {
  msgs: import("./session-manager").Msg[];
  summary: import("./session-manager").SummaryState;
} | null {
  const manager = sessionManagers.get(cacheKey);
  if (manager && (manager as any).__getCurrentState) {
    return (manager as any).__getCurrentState();
  }
  return null;
}
