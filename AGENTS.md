# AGENTS.md

## Scope
Entire repo (server, client, scripts).

## Build/Run
- Dev: `bun run dev`
- Build client: `bun run build` -> `public/client.js`
- Watch client: `bun run watch`
- CLI: `bun run ask.ts "question"`

## Testing
- Add `*.test.ts` beside code or in `tests/`
- All: `bun test`; file: `bun test path/to/file.test.ts`; single: `bun test -t "name"`

## Style & Imports
- Semicolons; single quotes; compact HTML template strings; small functions; early returns
- External imports first then local; avoid unused; avoid dynamic `import()` unless needed

## Types & Naming
- Small interfaces (`CachedSessions`); narrow JSON via guards; avoid `any` except SDK/raw fallback
- Constants UPPER_SNAKE; vars/functions camelCase; clarity over brevity

## Errors & Security
- Wrap network I/O; concise `console.error|warn`; fallback (`[]`, `{ ok:false }`, status codes via `Response.json`)
- Escape `&<>"`; sanitize inputs; never trust remote shapes; validate before SDK calls

## Opencode SDK
- Use `createOpencodeClient({ baseUrl })` then raw HTTP fallback
- Probe arrays/objects defensively; merge cache without dupes; TTL ≤5s
- **Response structures vary**: SDK may return `id` directly or nested in `.data` or `.session_id`
- **Always fallback**: Wrap SDK calls in try/catch, use raw HTTP POST/GET as fallback
- **Log responses**: Use `console.log()` to debug SDK response structure on first call
- **Type extraction**: Extract nested fields with optional chaining and provide clear error messages

## Datastar
- Client-only; per-page isolated state; `data-*` bindings; sanitize attributes/text
- Declarative templates; minimal ephemeral state (no secrets); derive values (no redundant state)
- Never unsanitized `innerHTML`; throttle frequent updates; cleanup listeners on navigation
- **Lazy loading**: Use `data-init="@get('/url')"` - Datastar auto-processes SSE responses
- **Forms**: Use `document.querySelector()` in expressions, not `$el.querySelector()`
- **SSE**: Server sends `event: datastar-patch-elements` with `data: elements <html...` format
- **No manual EventSource**: Datastar's `@get()/@post()` handle SSE/morphing automatically
- Reference: https://data-star.dev/guide/getting_started and https://data-star.dev/examples/lazy_load

## Responses & Performance
- Return `Response` directly; explicit status codes; SSE lines: `event:` + name, `data:` + JSON, blank line
- Lightweight in-memory caches; dedupe by `id`; avoid unbounded growth

## HTML & Concurrency
- Minimal inline styles; escape dynamic text before injecting
- Avoid global mutation except caches; guard with simple maps/sets

## Tooling & Cursor/Copilot
- No linter/formatter; match existing style; avoid heavy deps without discussion
- No Cursor/Copilot rules present; add summary here if introduced

## End
Keep agents surgical—do only requested changes.
