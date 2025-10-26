import { describe, it, expect } from "bun:test";
import {
  createQueueStores,
  enqueueMessage,
  retryLastFailed,
  processMessageQueue,
} from "../domain/queue";

function mockSend(okSequence: boolean[]) {
  let call = 0;
  // @ts-ignore
  global.fetch = async (url: string, opts?: any) => {
    const ok = okSequence[call++] ?? true;
    return {
      ok,
      status: ok ? 200 : 500,
      async json() {
        return ok
          ? { parts: [{ type: "text", text: "reply" }] }
          : { error: "fail" };
      },
    } as any;
  };
}

describe("queue domain", () => {
  it("processes queued message success", async () => {
    mockSend([true]);
    const stores = createQueueStores();
    enqueueMessage(stores, "127.0.0.1", "sess-1", "hello");
    await processMessageQueue(stores, (ip) => `http://${ip}:2000`);
    const jobs = stores.queueJobsBySession["127.0.0.1::sess-1"];
    expect(jobs[0].status).toBe("sent");
  });
  it("marks failed then retry succeeds", async () => {
    mockSend([false, true]);
    const stores = createQueueStores();
    enqueueMessage(stores, "127.0.0.1", "sess-2", "hello");
    await processMessageQueue(stores, (ip) => `http://${ip}:2000`);
    const jobs = stores.queueJobsBySession["127.0.0.1::sess-2"];
    expect(jobs[0].status).toBe("failed");
    retryLastFailed(stores, "127.0.0.1", "sess-2");
    await processMessageQueue(stores, (ip) => `http://${ip}:2000`);
    expect(jobs[1].status).toBe("sent");
  });
});
