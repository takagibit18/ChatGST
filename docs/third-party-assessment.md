# Third-party assessment

Assessment date: 2026-07-23. Versions are exact and are committed in `package.json` and `pnpm-lock.yaml`.

## pi-local-rag

| Item | Assessment |
| --- | --- |
| Actual installed target | `pi-local-rag@0.4.1` |
| Source / baseline | https://github.com/vahidkowsari/pi-local-rag, `2a78d4e2255a08b8c340e254f2a8e8bdea4a28fa` |
| License | MIT |
| Manifest / peer | Node `>=20`; peer `@mariozechner/pi-coding-agent >=0.60.0`. The root source imports `@sinclair/typebox` at runtime but 0.4.1 omits it from dependencies; this project pins `@sinclair/typebox@0.34.52` explicitly. |
| Direct reuse | Public SQLite database helpers, FTS5 schema/triggers, file hashing, metadata/index state, project-local store and scoring basis |
| Disabled | Default auto-injection, embedding/vector retrieval, reranking, arbitrary-path indexing, clear/rebuild/exclude tools, default `rag_*` Agent tools |
| Adapted | Semantic policy chunks, policy metadata, region/date/version filters, Chinese search text preprocessing, Evidence Pack and read-only tool wrapper |
| Why high-level API is not direct | In 0.4.1 `hybridSearch()` embeds every query and searches `chunks_vec` even when `alpha=1`; `indexFiles()` also embeds every chunk. Its default chunker is line-count based. These violate pure BM25 and policy-semantic chunking requirements. |
| Decision | Direct public-core integration through an Adapter; no fork |
| Pi compatibility | Package peer still names the pre-namespace Pi Coding Agent. We do not load that extension. Public storage exports are independent; the restricted runtime uses current `@earendil-works/pi-agent-core@0.81.1`. |
| Tests reviewed | Published package includes source and changelog but omits tests; repository contains `__tests__` and reports 104 tests. Project adds API, schema, pure-BM25 and vector-row assertions. |
| Recent breaking changes | 0.3.0 renamed Lens commands/tools/storage to RAG; 0.4.0 replaced JSON storage with SQLite, moved to per-project storage and modular exports; 0.4.1 is documentation-only. |

## @raindrop-ai/pi-agent

| Item | Assessment |
| --- | --- |
| Actual installed target | `@raindrop-ai/pi-agent@0.1.0` |
| Source / baseline | npm manifest has no repository or `gitHead`; no verifiable source commit is published. Exact package integrity is retained in `THIRD_PARTY_NOTICES.md`. Documentation: https://www.raindrop.ai/docs/integrations/pi-agent/ |
| License | MIT |
| Manifest / peer | `@earendil-works/pi-agent-core >=0.74.0`; optional `@earendil-works/pi-coding-agent >=0.74.0` |
| Public API | `createRaindropPiAgent(options)`, client `subscribe`, `flush`, `shutdown`, event/user/signal helpers |
| Direct reuse | Programmatic Pi subscriber, run/span/event transport, token and timing collection, lifecycle flush/shutdown |
| Disabled | Extension auto-loading and third-party capture when disabled/missing key; unredacted prompt/response/tool content capture |
| Adapted | `TraceRecorder`, redacting Agent proxy, request/conversation correlation, anonymous properties, local and composite fallback, fault isolation |
| Why direct subscription needs a guard | Bundle inspection shows default attributes for prompt text, response text, tool arguments and tool result. There is no first-party capture-content switch in 0.1.0. |
| Decision | Direct subscriber behind a privacy Adapter; no fork |
| Pi compatibility | Directly compatible with current namespaced Pi Agent Core; Coding Agent is optional and not installed for runtime use. |
| Tests reviewed | npm artifact contains compiled programmatic and extension entrypoints but no test directory. Project tests subscriber registration, redaction, shutdown and failure isolation. |
| Recent breaking changes | 0.0.9 to 0.0.10 changes only generated type chunk naming. 0.1.0 adds per-run `eventId()` at client and subscribe levels; existing signatures otherwise remain compatible. |

## @kkkiio/pi-web-ui

| Item | Assessment |
| --- | --- |
| Actual installed target | `@kkkiio/pi-web-ui@0.1.1` |
| Source / baseline | https://github.com/kkkiio/pi-web-ui, `a3ab3b1c46f0ad3d837d7ba9e968b7e61d5259da` |
| License | MIT |
| Manifest / peer | Node `>=18`; peer `@earendil-works/pi-coding-agent *`; runtime dependency `ws` |
| Direct reuse | React/Vite/Tailwind base, selected shadcn/Radix and AI Elements components, Markdown rendering, local HTTP and WebSocket connection/session patterns |
| Disabled/removed | Reasoning, thinking, raw tool call/result, model picker, thinking level, context debug, commands, tool toggles, session path/history tree, branch navigation, file upload, terminal and raw internal events |
| Adapted | Safe browser protocol, restricted runtime event source, structured policy response renderer, local-only server and privacy notice |
| Why package extension is unsafe directly | Its mirror server intentionally forwards raw Agent messages/tool/thinking events and exposes Coding Agent controls and session files. CSS hiding would leave the protocol callable. |
| Decision | Controlled minimal fork of the UI/event bridge, with MIT license and documented delta |
| Pi compatibility | Upstream requires Pi Coding Agent. The fork retains its browser foundation but replaces that event source with restricted Pi Agent Core; no Coding tools are created. |
| Tests reviewed | Exact 0.1.1 source snapshot contains no automated test directory. Project adds protocol, DOM-string, WebSocket and browser verification. |
| Recent breaking changes | 0.1.1 differs from 0.1.0 only by npm public `publishConfig` and version metadata; no runtime API change found. |
