import { Elysia, t } from "elysia";
import {
  getEntityDescription,
  setEntityDescription,
} from "../../utils/store-entity-descriptions";
import { doesIpExist } from "../../utils/store-ips";

function escapeHtml(str: string): string {
  return str.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}

// Reuse whitespace collapse + length limit logic via setEntityDescription (already sanitizes value before store)
// These routes mirror legacy Bun server fragments but exposed via Elysia.
export const sessionTitlesPlugin = new Elysia({ name: "session-titles" })
  // Fragment displaying current title/description with edit button
  .get(
    "/sessions/:ip/:sid/title-fragment",
    async ({ params }) => {
      const { ip, sid } = params;
      if (!doesIpExist(ip)) return new Response("Unknown IP", { status: 404 });
      let display = sid;
      try {
        const override = await getEntityDescription(ip + ":" + sid);
        if (override && override.trim()) display = override.trim();
      } catch {}
      const html = `<div id="session-title-block" style="display:flex;align-items:center;gap:0.5rem">\n<h1 id="session-title" style="word-break:break-word;margin:0">${escapeHtml(display)}</h1>\n<button type="button" id="edit-session-title-btn" title="Edit description" style="font-size:0.9rem" data-on:click=\"@get('/sessions/${ip}/${sid}/title-edit')\">✎</button>\n</div>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    { params: t.Object({ ip: t.String(), sid: t.String() }) },
  )
  // Edit fragment (prefill input + signal initialization)
  .get(
    "/sessions/:ip/:sid/title-edit",
    async ({ params }) => {
      const { ip, sid } = params;
      if (!doesIpExist(ip)) return new Response("Unknown IP", { status: 404 });
      let existing = "";
      try {
        const override = await getEntityDescription(ip + ":" + sid);
        if (override && override.trim()) existing = override.trim();
      } catch {}
      const valueEscaped = escapeHtml(existing);
      const jsEscaped = existing.replace(/[\\'']/g, (ch) =>
        ch === "\\" ? "\\" : "\\'",
      );
      const html = `<div id="session-title-block" style="display:flex;align-items:center;gap:0.5rem" data-init="$description = '${jsEscaped}'">\n<label style="flex:1">\n<input type="text" name="description" data-bind:description value="${valueEscaped}" placeholder="Enter description" style="width:100%;max-width:30rem"/>\n</label>\n<button type="button" data-on:click=\"@post('/sessions/${ip}/${sid}/title-save'); $description = ''\">Save</button>\n<button type="button" data-on:click=\"@get('/sessions/${ip}/${sid}/title-fragment')\">Cancel</button>\n</div>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    { params: t.Object({ ip: t.String(), sid: t.String() }) },
  )
  // Save fragment (store description then return title-fragment equivalent)
  .post(
    "/sessions/:ip/:sid/title-save",
    async ({ params, body }) => {
      const { ip, sid } = params;
      if (!doesIpExist(ip)) return new Response("Unknown IP", { status: 404 });
      let raw = "";
      try {
        if (body && typeof body === "object") {
          const cand =
            (body as any).description || (body as any).Description || "";
          if (typeof cand === "string") raw = cand;
        }
      } catch {}
      const desc = raw.replace(/\s+/g, " ").trim().slice(0, 256);
      if (desc) {
        try {
          await setEntityDescription(ip + ":" + sid, desc);
        } catch {}
      }
      const display = desc || sid;
      const html = `<div id="session-title-block" style="display:flex;align-items:center;gap:0.5rem">\n<h1 id="session-title" style="word-break:break-word;margin:0">${escapeHtml(display)}</h1>\n<button type="button" id="edit-session-title-btn" title="Edit description" style="font-size:0.9rem" data-on:click=\"@get('/sessions/${ip}/${sid}/title-edit')\">✎</button>\n</div>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    {
      params: t.Object({ ip: t.String(), sid: t.String() }),
      body: t.Optional(t.Any()),
    },
  );
