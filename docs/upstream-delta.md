# Upstream delta

## pi-local-rag

Integration type: Adapter, no fork.

- Reuse public `openDb`, `initSchema`, `sha256`, SQLite tables, FTS5 triggers, file hash, project-local storage and index-state primitives.
- Do not call upstream `hybridSearch` or `indexFiles`: source inspection shows both execute embedding/vector work even when the configured hybrid weight is pure BM25.
- Add policy metadata tables and a semantic `PolicyChunker` outside upstream core.
- Insert policy chunks into upstream `chunks`/`chunks_fts`; keep `chunks_vec` empty; query `chunks_fts` with SQLite `bm25()`.
- Do not load the default Pi Coding Agent extension, auto-injection hooks, or runtime index-management tools.
- Add an explicit `@sinclair/typebox` dependency because the 0.4.1 root entry imports it without declaring it in the package manifest; no upstream source is modified.
- Load the public root through a typed dynamic Adapter because 0.4.1 publishes raw `.ts`; this prevents the application's strict compiler from re-checking upstream sources while preserving the real runtime package API.

## @raindrop-ai/pi-agent

Integration type: Adapter, no fork.

- Use the public `createRaindropPiAgent().subscribe()` subscriber and upstream flush/shutdown transport.
- Wrap the subscribed Agent with a redacting event proxy when content capture is disabled, because 0.1.0 records prompts, responses, tool arguments and tool results by default.
- Select a local recorder when disabled or missing a key. Telemetry failure is isolated from the answer path.

## @kkkiio/pi-web-ui

Integration type: minimal controlled fork of the public surface.

- Retain Vite, React, Tailwind, selected shadcn/Radix primitives, AI Elements conversation/message/sources/suggestion patterns, Markdown renderer, WebSocket reconnect and local HTTP server lifecycle.
- Replace the Coding Agent mirror source with `PolicyUiEventAdapter` connected to the restricted Pi Agent Core runtime.
- Delete model selection, thinking level, context metrics, command palette, tool toggles, session file paths, history tree, message branch navigation, file upload, raw JSON, stack traces, terminal features, thinking/reasoning blocks and raw tool event renderers.
- Browser commands are limited to `ask` and `reset`; server events are limited to `status`, `result`, `safe_error`, and `session_reset`.
- The final response is buffered until JSON parsing, schema validation and business validation complete.
