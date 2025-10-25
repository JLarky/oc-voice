// src/client.ts
// Datastar-driven client - fully declarative
// Uses data-init and data-on:* attributes per https://data-star.dev/examples/lazy_load
// Datastar handles:
// - Form submissions (data-on:submit)
// - Page initialization (data-init)
// - SSE streaming (automatic via @get/@post responses)
// - DOM morphing (automatic for matching element IDs)
//
// No manual event handlers or state management needed!
