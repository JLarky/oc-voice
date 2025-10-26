// app/plugins/ip.tsx - Elysia IP routes plugin with persistence parity (JSX fragments)
import { Elysia } from "elysia";
import { addIp, removeIp } from "../../domain/ip";
import { dataStarPatchElementsString } from "../../rendering/datastar";
import { rename } from "fs/promises";
import { renderUpdatedStatus } from "../../rendering/fragments";

export const ipPlugin = (ipStore: string[]) => {
  const IP_STORE_FILE = "ip-store.json";
  function loadIps() {
    Bun.file(IP_STORE_FILE)
      .text()
      .then((text) => {
        try {
          const arr = JSON.parse(text);
          if (Array.isArray(arr))
            arr.forEach(
              (v) =>
                typeof v === "string" &&
                !ipStore.includes(v) &&
                ipStore.push(v),
            );
        } catch {}
      })
      .catch(() => {});
  }
  async function persistIps() {
    try {
      const json = JSON.stringify(ipStore);
      await Bun.write(IP_STORE_FILE + ".tmp", json);
      await rename(IP_STORE_FILE + ".tmp", IP_STORE_FILE);
    } catch (e) {
      try {
        await Bun.write(IP_STORE_FILE, JSON.stringify(ipStore));
      } catch {}
    }
  }
  loadIps();
  return new Elysia({ name: "ip" })
    .get("/ips", () => ({ ok: true, ips: ipStore }))
    .get("/ips/stream", () => {
      // Parity SSE: status + ips list using legacy ids
      const stream = new ReadableStream({
        start(controller) {
          let interval: any;
          function push() {
            try {
              const statusJsx = renderUpdatedStatus("ips-status");
              const listJsx = (
                <div id="ips-list">
                  <ul id="ips-ul">
                    {ipStore.map((ip) => (
                      <li>{ip}</li>
                    ))}
                  </ul>
                </div>
              );
              controller.enqueue(
                new TextEncoder().encode(
                  dataStarPatchElementsString(statusJsx),
                ),
              );
              controller.enqueue(
                new TextEncoder().encode(dataStarPatchElementsString(listJsx)),
              );
            } catch (e) {
              clearInterval(interval);
              try {
                controller.close();
              } catch {}
            }
          }
          push();
          interval = setInterval(push, 5000);
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
    .post("/ips/add", async ({ body }) => {
      const raw = (body as any)?.ip ?? (body as any)?.IP ?? "";
      const result = addIp(ipStore, String(raw));
      if (result.ok) await persistIps();
      return result;
    })
    .post("/ips/remove/:ip", async ({ params }) => {
      const result = removeIp(ipStore, params.ip);
      if (result.ok) await persistIps();
      return result;
    });
};
