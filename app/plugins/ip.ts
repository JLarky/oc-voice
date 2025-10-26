// app/plugins/ip.ts - Elysia IP routes plugin
import { Elysia } from "elysia";
import { addIp, removeIp } from "../../domain/ip";

export const ipPlugin = (ipStore: string[]) =>
  new Elysia({ name: "ip" })
    .get("/ips", () => ({ ok: true, ips: ipStore }))
    .get("/ips/stream", () => {
      // Basic parity SSE: status + ips list lines similar shape
      const stream = new ReadableStream({
        start(controller) {
          function push() {
            try {
              const status = `event: datastar-patch-elements\ndata: elements <div id=\"ips-status\" class=\"status\">Updated ${new Date().toLocaleTimeString()}<\\/div>\n\n`;
              let listHtml = '<ul id="ips-list">';
              for (const ip of ipStore) listHtml += `<li>${ip}</li>`;
              listHtml += "</ul>";
              const ips = `event: datastar-patch-elements\ndata: elements <div id=\"ips-list\">${listHtml}<\\/div>\n\n`;
              controller.enqueue(new TextEncoder().encode(status));
              controller.enqueue(new TextEncoder().encode(ips));
            } catch {
              controller.close();
            }
          }
          push();
          const interval = setInterval(push, 5000);
          (controller as any).interval = interval;
        },
        cancel() {
          const interval = (this as any).interval;
          if (interval) clearInterval(interval);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    })
    .post("/ips/add", ({ body }) => {
      const raw = (body as any)?.ip ?? (body as any)?.IP ?? "";
      return addIp(ipStore, String(raw));
    })
    .post("/ips/remove/:ip", ({ params }) => {
      return removeIp(ipStore, params.ip);
    });
