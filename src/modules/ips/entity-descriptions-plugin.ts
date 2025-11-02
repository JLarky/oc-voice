import { Elysia, t } from "elysia";
import {
  listEntityIds,
  getEntityDescription,
  setEntityDescription,
} from "../../utils/store-entity-descriptions";

// Plugin providing endpoints for entity descriptions (IP or IP:sid composite keys)
// Routes:
// GET /entity-descriptions => list all ids with their descriptions
// GET /entity-descriptions/:id => fetch single description
// POST /entity-descriptions/:id => create/update description from form body field "description" (case-insensitive)
// Form body may contain description or Description; we check both.

export const entityDescriptionsPlugin = new Elysia({
  name: "entity-descriptions",
})
  // List all descriptions
  .get("/entity-descriptions", async () => {
    try {
      const ids = await listEntityIds();
      const entries: { id: string; description: string | null }[] = [];
      for (const id of ids) {
        const desc = await getEntityDescription(id);
        entries.push({ id, description: desc });
      }
      return { ok: true, entries };
    } catch (e) {
      console.error(
        "entity-descriptions list route error",
        (e as Error).message,
      );
      return { ok: false, entries: [] };
    }
  })
  // Fetch single description
  .get(
    "/entity-descriptions/:id",
    ({ params }) => {
      const id = params.id;
      return Promise.resolve(getEntityDescription(id)).then((desc) => ({
        ok: true,
        id,
        description: desc,
      }));
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )
  // Create or update description via form body
  .post(
    "/entity-descriptions/:id",
    async ({ params, body }) => {
      const id = params.id;
      let description = "";
      try {
        if (body && typeof body === "object") {
          // Elysia form body may provide both camelCase and lowercase
          // Accept description | Description | desc for flexibility
          const cand =
            (body as any).description ||
            (body as any).Description ||
            (body as any).desc;
          if (typeof cand === "string") description = cand;
        }
      } catch {}
      if (!description.trim())
        return { ok: false, error: "Missing description" };
      const ok = await setEntityDescription(id, description);
      return ok
        ? { ok: true, id, description }
        : { ok: false, error: "Persist failed" };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object({
          description: t.Optional(t.String()),
          Description: t.Optional(t.String()),
          desc: t.Optional(t.String()),
        }),
      ),
    },
  );
