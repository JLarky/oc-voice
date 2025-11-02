import { Elysia } from "elysia";
import * as v from "valibot";
import { doesIpExist } from "../../utils/store-ips";
import {
  getEntityDescription,
  setEntityDescription,
} from "../../utils/store-entity-descriptions";

function escapeHtml(val: string): string {
  return val.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c,
  );
}

function sanitizeInput(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 256);
}

export const ipDescriptionPlugin = new Elysia({ name: "ip-description" })
  // Display fragment
  .get(
    "/ips/:ip/description-display",
    async ({ params }) => {
      const { ip } = params as { ip: string };
      if (!(await doesIpExist(ip)))
        return new Response("Unknown IP", { status: 404 });
      let existing = "";
      try {
        const override = await getEntityDescription(ip);
        if (override && override.trim()) existing = override.trim();
      } catch {}
      const html = `<div id="ip-title-block" style="display:flex;align-items:center;gap:.5rem"><h1 style="margin:0">Sessions for ${escapeHtml(ip)}${existing ? " – " + escapeHtml(existing) : ""}</h1><button type="button" id="edit-ip-description-btn" title="Edit description" style="font-size:0.9rem" data-on:click="@get('/ips/${ip}/description-edit')">✎</button></div>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    { params: v.object({ ip: v.string() }) },
  )
  // Edit fragment
  .get(
    "/ips/:ip/description-edit",
    async ({ params }) => {
      const { ip } = params as { ip: string };
      if (!(await doesIpExist(ip)))
        return new Response("Unknown IP", { status: 404 });
      let existing = "";
      try {
        const override = await getEntityDescription(ip);
        if (override && override.trim()) existing = override.trim();
      } catch {}
      const valueEscaped = escapeHtml(existing);
      const jsEscaped = existing.replace(/[\\']/g, (ch) =>
        ch === "\\" ? "\\" : "\\'",
      );
      // Use a form so Datastar @post collects FormData; submit clears signal
      const html = `<form id="ip-title-block" style="display:flex;align-items:center;gap:.5rem" data-init="$ipDescription='${jsEscaped}'" data-on:submit="@post('/ips/${ip}/description-save'); $ipDescription=''">
<label style="flex:1"><input type="text" name="ipDescription" data-bind:ipDescription value="${valueEscaped}" placeholder="Enter IP description" style="width:100%;max-width:30rem"/></label>
<button type="submit">Save</button>
<button type="button" data-on:click=\"@get('/ips/${ip}/description-display')\">Cancel</button>
</form>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    { params: v.object({ ip: v.string() }) },
  )
  // Save fragment
  .post(
    "/ips/:ip/description-save",
    async ({ params, request }) => {
      const { ip } = params as { ip: string };
      if (!(await doesIpExist(ip)))
        return new Response("Unknown IP", { status: 404 });
      let descRaw = "";
      try {
        const form = await request.formData();
        descRaw = String(
          form.get("ipDescription") ||
            form.get("IpDescription") ||
            form.get("description") ||
            "",
        ).trim();
      } catch {}
      const desc = sanitizeInput(descRaw);
      try {
        if (desc) await setEntityDescription(ip, desc);
      } catch {}
      const html = `<div id="ip-title-block" style="display:flex;align-items:center;gap:.5rem"><h1 style="margin:0">Sessions for ${escapeHtml(ip)}${desc ? " – " + escapeHtml(desc) : ""}</h1><button type="button" id="edit-ip-description-btn" title="Edit description" style="font-size:0.9rem" data-on:click=\"@get('/ips/${ip}/description-edit')\">✎</button></div>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    { params: v.object({ ip: v.string() }) },
  );
