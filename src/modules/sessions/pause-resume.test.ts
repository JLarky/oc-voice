import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { setPauseState, isPaused } from "./pubsub";

describe("Pause/Resume", () => {
  const testKey = "test-session-123";

  beforeEach(() => {
    // Reset pause state before each test
    setPauseState(testKey, false);
  });

  it("should start with paused state as false", () => {
    expect(isPaused(testKey)).toBe(false);
  });

  it("should set pause state to true", () => {
    setPauseState(testKey, true);
    expect(isPaused(testKey)).toBe(true);
  });

  it("should resume paused session", () => {
    setPauseState(testKey, true);
    expect(isPaused(testKey)).toBe(true);
    setPauseState(testKey, false);
    expect(isPaused(testKey)).toBe(false);
  });

  it("should track multiple sessions independently", () => {
    const key1 = "session-1";
    const key2 = "session-2";

    setPauseState(key1, true);
    setPauseState(key2, false);

    expect(isPaused(key1)).toBe(true);
    expect(isPaused(key2)).toBe(false);

    setPauseState(key1, false);
    setPauseState(key2, true);

    expect(isPaused(key1)).toBe(false);
    expect(isPaused(key2)).toBe(true);
  });
});
