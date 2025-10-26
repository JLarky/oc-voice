// elysia-app.ts - minimal Elysia server prototype (port 3333)
import { Elysia } from "elysia";

// Simple in-memory counter for demonstration
let hits = 0;

const app = new Elysia()
  .get("/", () => {
    hits++;
    return { ok: true, message: "hello from elysia", hits };
  })
  .get("/time", () => ({ now: new Date().toISOString() }))
  .post("/echo", ({ body }) => ({ echo: body }))
  .listen(3333);

console.log(`Elysia demo running on http://localhost:${app.server?.port}`);
