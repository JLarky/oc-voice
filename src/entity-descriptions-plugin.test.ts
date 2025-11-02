import { describe, test, expect } from "bun:test";
import { Elysia } from "elysia";
import { entityDescriptionsPlugin } from "./modules/ips/entity-descriptions-plugin";
import {
  listEntityIds,
  removeEntityDescription,
} from "./utils/store-entity-descriptions";

async function json(res: Response) {
  return await res.json();
}

async function clearAll() {
  const ids = await listEntityIds();
  for (const id of ids) await removeEntityDescription(id);
}

describe("entity descriptions plugin", () => {
  test("lists empty initially", async () => {
    await clearAll();
    const app = new Elysia().use(entityDescriptionsPlugin);
    const res = await app.handle(
      new Request("http://localhost/entity-descriptions"),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(0);
  });

  test("sets and lists one description", async () => {
    await clearAll();
    const app = new Elysia().use(entityDescriptionsPlugin);
    const fd = new FormData();
    fd.set("description", "Test entity");
    const postRes = await app.handle(
      new Request("http://localhost/entity-descriptions/abc", {
        method: "POST",
        body: fd,
      }),
    );
    const postBody = await json(postRes);
    expect(postBody.ok).toBe(true);
    expect(postBody.id).toBe("abc");
    expect(postBody.description).toBe("Test entity");

    const listRes = await app.handle(
      new Request("http://localhost/entity-descriptions"),
    );
    const listBody = await json(listRes);
    expect(listBody.entries.length).toBe(1);
    expect(listBody.entries[0].id).toBe("abc");
    expect(listBody.entries[0].description).toBe("Test entity");
  });
});
