import { Elysia } from "elysia";
import * as v from "valibot";
import {
  listEntityIds,
  getEntityDescription,
  setEntityDescription,
} from "../../utils/store-entity-descriptions";

// Returns array of { id, description }
async function listAll() {
  const ids = await listEntityIds();
  const out: { id: string; description: string }[] = [];
  for (const id of ids) {
    const d = await getEntityDescription(id);
    if (d) out.push({ id, description: d });
  }
  return out;
}

export const entityDescriptionsPlugin = new Elysia({
  name: "entity-descriptions",
})
  .get("/entity-descriptions", async () => {
    try {
      const all = await listAll();
      return { ok: true, items: all };
    } catch (e) {
      console.error("entity-descriptions list error", (e as Error).message);
      return { ok: false, items: [] };
    }
  })
  .post(
    "/entity-descriptions/:id",
    async ({ params, body }) => {
      let { id } = params as { id: string };
      id = id.trim();
      if (!id) return { ok: false, error: "invalid id" };
      // Body may come from form data or JSON; accept description or Description
      const rawDesc =
        (body as any)?.description || (body as any)?.Description || "";
      const ok = await setEntityDescription(id, String(rawDesc || ""));
      if (!ok) return { ok: false, error: "store failed" };
      const desc = await getEntityDescription(id);
      return { ok: true, id, description: desc || "" };
    },
    {
      params: v.object({ id: v.string() }),
      body: v.object({ description: v.string() }),
    },
  );
