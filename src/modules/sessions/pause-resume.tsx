import { Elysia } from "elysia";
import { dataStarPatchElementsSSE } from "../../../rendering/datastar";
import { doesIpExist } from "../../utils/store-ips";
import { setPauseState } from "./pubsub";
import { buildCacheKey } from "./cache-key";
import * as v from "valibot";

export const pauseResumePlugin = new Elysia({
  name: "sessions-pause-resume",
})
  .post(
    "/sessions/:ip/:sid/pause",
    async function* ({ params }) {
      const { ip, sid } = params;
      if (!ip || !sid || !(await doesIpExist(ip))) {
        return new Response("Unknown IP", { status: 404 });
      }
      const cacheKey = buildCacheKey(ip, sid);
      setPauseState(cacheKey, true);

      yield dataStarPatchElementsSSE(
        <button
          type="button"
          id="pause-resume-btn"
          data-paused="true"
          data-on:click={`if (document.getElementById('pause-resume-btn').dataset.paused === 'false') { @post('/sessions/${ip}/${sid}/pause') } else { @post('/sessions/${ip}/${sid}/resume') }`}
        >
          Resume
        </button>,
      );
      yield dataStarPatchElementsSSE(
        <div id="pause-resume-status" class="result">
          Stream paused
        </div>,
      );
    },
    {
      params: v.object({
        ip: v.string(),
        sid: v.string(),
      }),
    },
  )
  .post(
    "/sessions/:ip/:sid/resume",
    async function* ({ params }) {
      const { ip, sid } = params;
      if (!ip || !sid || !(await doesIpExist(ip))) {
        return new Response("Unknown IP", { status: 404 });
      }
      const cacheKey = buildCacheKey(ip, sid);
      setPauseState(cacheKey, false);

      yield dataStarPatchElementsSSE(
        <button
          type="button"
          id="pause-resume-btn"
          data-paused="false"
          data-on:click={`if (document.getElementById('pause-resume-btn').dataset.paused === 'false') { @post('/sessions/${ip}/${sid}/pause') } else { @post('/sessions/${ip}/${sid}/resume') }`}
        >
          Pause Stream
        </button>,
      );
      yield dataStarPatchElementsSSE(
        <div id="pause-resume-status" class="result">
          Stream resumed
        </div>,
      );
    },
    {
      params: v.object({
        ip: v.string(),
        sid: v.string(),
      }),
    },
  );
