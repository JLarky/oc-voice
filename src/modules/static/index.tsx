import { Elysia, file } from "elysia";

export const staticPlugin = new Elysia({ name: "static" }).get(
  "/client.js",
  file("public/client.js"),
);
