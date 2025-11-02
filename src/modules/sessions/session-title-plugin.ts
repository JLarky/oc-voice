import { Elysia } from "elysia";
import * as v from "valibot";
import { doesIpExist } from "../../utils/store-ips";
import {
  getEntityDescription,
  setEntityDescription,
} from "../../utils/store-entity-descriptions";

// Provides Datastar-compatible fragments for inline session title/description editing.
// Mirrors legacy Bun server endpoints but served directly by Elysia on :3000.
// Routes:
//  GET  /sessions/:ip/:sid/title-edit  => edit form fragment (prefilled)
//  POST /sessions/:ip/:sid/title-save  => persist description + return display fragment
// (Legacy routes remain; these override proxy forwarding so Datastar can hit :3000 directly.)

function escapeHtml(val: string): string {
  return val.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}

function sanitizeInput(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 256);
}

export const sessionTitlePlugin = new Elysia({ name: "session-titles" })
  // Edit fragment
  .get(
    "/sessions/:ip/:sid/title-edit",
    async ({ params }) => {
      const { ip, sid } = params as { ip: string; sid: string };
      if (!(await doesIpExist(ip)))
        return new Response("Unknown IP", { status: 404 });
      let existing = "";
      try {
        const override = await getEntityDescription(ip + ":" + sid);
        if (override && override.trim()) existing = override.trim();
      } catch {}
      const valueEscaped = escapeHtml(existing);
      const jsEscaped = existing.replace(/[\\'']/g, (ch) =>
        ch === "\\" ? "\\\\" : "\\'",
      );
      const html = `<div id="session-title-block" style="display:flex;align-items:center;gap:0.5rem" data-init="$description = '${jsEscaped}'">\n<label style="flex:1">\n<input type="text" name="description" data-bind:description value="${valueEscaped}" placeholder="Enter description" style="width:100%;max-width:30rem"/>\n</label>\n<button type="button" data-on:click=\"@post('/sessions/${ip}/${sid}/title-save'); $description = ''\">Save</button>\n<button type="button" data-on:click=\"@get('/sessions/${ip}/${sid}')\">Cancel</button>\n</div>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    {
      params: v.object({ ip: v.string(), sid: v.string() }),
    },
  )
  // Save fragment
  .post(
    "/sessions/:ip/:sid/title-save",
    async ({ params, request }) => {
      const { ip, sid } = params as { ip: string; sid: string };
      if (!(await doesIpExist(ip)))
        return new Response("Unknown IP", { status: 404 });
      let descRaw = "";
      try {
        const form = await request.formData();
        descRaw = String(
          form.get("description") || form.get("Description") || "",
        ).trim();
      } catch {}
      const desc = sanitizeInput(descRaw);
      try {
        if (desc) await setEntityDescription(ip + ":" + sid, desc);
      } catch {}
      const display = desc || sid;
      const html = `<div id="session-title-block" style="display:flex;align-items:center;gap:0.5rem">\n<h1 id="session-title" style="word-break:break-word;margin:0">${escapeHtml(display)}</h1>\n<button type="button" id="edit-session-title-btn" title="Edit description" style="font-size:0.9rem" data-on:click=\"@get('/sessions/${ip}/${sid}/title-edit')\">✎</button>\n</div>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    {
      params: v.object({ ip: v.string(), sid: v.string() }),
    },
  );
