import { Elysia } from "elysia";
import * as v from "valibot";
import { dataStarPatchElementsSSE } from "../../../rendering/datastar";
import { addIp, getIpStore, persistIps, removeIp } from "../../utils/store-ips";
import { IpsUl } from "../../../rendering/lists";
import { StatusDiv } from "../../../rendering/fragments";

export const ipsPlugin = new Elysia({ name: "ips" })
  .onError(function* ({ error }) {
    console.error("Add IP error", error);
    yield dataStarPatchElementsSSE(
      <div id="add-ip-result" class="result">
        Error: {String(error)}
      </div>,
    );
    yield dataStarPatchElementsSSE(<IpsUl ips={getIpStore()} />);
  })
  .get("/ips/stream", async function* ({ request }) {
    while (!request.signal.aborted) {
      yield dataStarPatchElementsSSE(
        <StatusDiv
          id="ips-status"
          text={`Updated ${new Date().toLocaleTimeString()}`}
        />,
      );
      yield dataStarPatchElementsSSE(<IpsUl ips={getIpStore()} />);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.log("IPs stream ended");
  })
  .post(
    "/ips/add",
    async function* ({ body: { ip } }) {
      ip = ip.trim();
      if (ip && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) ip = "";
      let ok = false;
      if (ip) ok = addIp(ip);
      if (ok) await persistIps();
      console.log("Add IP attempt", { parsedIp: ip, ok });
      yield dataStarPatchElementsSSE(
        <div id="add-ip-result" class="result">
          {ok ? `Added IP: ${ip}` : "Invalid or duplicate IP"}
        </div>,
      );

      yield dataStarPatchElementsSSE(<IpsUl ips={getIpStore()} />);
    },
    {
      body: v.object({
        ip: v.string(),
      }),
    },
  )
  .post(
    "/ips/remove/:ip",
    async function* ({ params: { ip } }) {
      let ok = false;
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) ok = removeIp(ip);
      if (ok) await persistIps();
      console.log("Remove IP path attempt", { ip, ok });

      yield dataStarPatchElementsSSE(
        <div id="add-ip-result" class="result">
          {ok ? "Removed IP: " + ip : "IP not found"}
        </div>,
      );

      yield dataStarPatchElementsSSE(<IpsUl ips={getIpStore()} />);
    },
    {
      params: v.object({
        ip: v.string(),
      }),
    },
  );
