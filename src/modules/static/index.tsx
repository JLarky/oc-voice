import { Elysia } from "elysia";

interface BuildCacheEntry {
  code: string;
  builtAt: number;
  etag: string;
  durationMs: number;
}
const dynCache: { entry?: BuildCacheEntry } = {};
let buildPromise: Promise<BuildCacheEntry> | null = null;

const isProd = process.env.NODE_ENV === "production";

async function startBuildPromise(): Promise<BuildCacheEntry> {
  const start = Date.now();
  const build = await Bun.build({
    entrypoints: ["src/client/index.ts"],
    target: "browser",
    minify: isProd,
  });
  if (!build.success) throw new Error(build.logs[0]?.message || "build failed");
  const code = await build.outputs[0].text();
  const etag = 'W/"' + Bun.hash(code).toString(16) + '"';
  const durationMs = Date.now() - start;
  dynCache.entry = { code, builtAt: Date.now(), etag, durationMs };
  return dynCache.entry;
}

export const staticPlugin = new Elysia({ name: "static" }).get(
  "/client.js",
  async ({ request }) => {
    let coldBuild = 0;
    // Build strategy:
    // - Dev: always rebuild (fast) (deduped concurrently)
    // - Prod: reuse previous build until restart (only build once)

    if (!buildPromise && (!isProd || !dynCache.entry)) {
      coldBuild = 1;
      buildPromise = startBuildPromise()
        .finally(() => {
          buildPromise = null;
        })
        .catch((e) => {
          buildPromise = null;
          throw e;
        });
    }
    if (buildPromise) await buildPromise;
    const entry = dynCache.entry;
    const ifNoneMatch = request.headers.get("If-None-Match");
    const cacheControl = isProd ? "public, max-age=30" : "public, max-age=0";
    if (entry && ifNoneMatch && ifNoneMatch === entry.etag) {
      return new Response("", {
        status: 304,
        headers: {
          ETag: entry.etag,
          "Cache-Control": cacheControl,
          "Server-Timing": `${coldBuild ? "bundle_cold" : "bundle"};dur=${entry.durationMs}`,
        },
      });
    }
    return new Response(entry?.code || "// no build output", {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": cacheControl,
        ETag: entry?.etag || "",
        "Server-Timing": entry
          ? `${coldBuild ? "bundle_cold" : "bundle"};dur=${entry.durationMs}`
          : "bundle_cold;dur=0",
      },
    });
  },
);
