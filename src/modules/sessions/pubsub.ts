type SessionEventListener = () => void;

const subscriptions = new Map<string, SessionEventListener[]>();
let globalTimer: NodeJS.Timeout | null = null;

/**
 * Subscribe to session events (ping broadcasts every 2 seconds)
 * @param cacheKey Session identifier (e.g., "http://192.168.1.1:2000::session-123")
 * @param listener Callback fired when session is pinged
 * @returns Unsubscribe function to clean up listener
 *
 * Automatically manages global timer:
 * - Starts when first subscriber joins
 * - Stops when last subscriber leaves
 */
export function subscribe(
  cacheKey: string,
  listener: SessionEventListener,
): () => void {
  // Ensure session has a listeners array
  if (!subscriptions.has(cacheKey)) {
    subscriptions.set(cacheKey, []);
  }
  subscriptions.get(cacheKey)!.push(listener);

  // Start global timer if this is the first subscription
  if (!globalTimer) {
    globalTimer = setInterval(() => {
      // Broadcast ping to all sessions with subscribers
      for (const listeners of subscriptions.values()) {
        for (const listener of listeners) {
          listener();
        }
      }
    }, 2000);
  }

  // Return unsubscribe function
  return () => {
    const listeners = subscriptions.get(cacheKey);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx > -1) listeners.splice(idx, 1);

      // Clean up empty sessions
      if (listeners.length === 0) {
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
