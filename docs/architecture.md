# Architecture

## Boundary and flow

```text
Browser
  -> loopback HTTP/WebSocket server
  -> PolicyUiEventAdapter
  -> PolicyAgentRuntime (Pi Agent Core)
       -> ModelProvider (DeepSeek or deterministic test)
       -> Childcare Profile + SkillLoader
       -> RestrictedToolRegistry
       -> InMemorySessionStore
       -> RuntimeBudget / ConcurrencyGate
       -> TraceRecorder
       -> Output validators
       -> PiLocalRagRetrievalProvider
            -> Query normalizer + Chinese SearchTextProcessor
            -> SQLite FTS5 / bm25()
            -> metadata/date/region/version filtering
            -> Evidence Pack
```

## Ontology Agent Architecture

The repository now also carries the ontology-agent layer recorded in the local notes. It lives in `packages/ontology` and is intentionally separate from the read-only RAG path:

```text
Policy Markdown data
  -> Step2 auto modeling
       -> POST /api/onto/extract
       -> POST /api/onto/derive
       -> POST /api/policies/{id}/merge-all dry run
       -> deterministic conflict resolutions
       -> POST /api/policies/{id}/merge-all commit
  -> review / golden run on the ontology platform
  -> ontology.json version snapshot
  -> rule engine /api/query
  -> Pi tool policy_rule_engine
  -> RAG tools as fallback evidence
```

`proxyOnto()` owns the ontology-platform login cookie, 30 minute TTL and one automatic 401 re-login. `runStep2AutoModeling()` scans Markdown data, records resumable per-file extract/derive completion in `_step2_done.json`, writes `step2_progress` into each version's `version.json`, and then performs the two-phase merge. Conflict detection remains a platform concern over structured rule fields; this repository supplies deterministic resolutions through `use_candidate`, `keep_existing` or `skip`.

The rule engine integration is opt-in at runtime. When ontology credentials are configured, `createPolicyToolRegistry()` exposes `policy_rule_engine` beside the five RAG tools. The rule tool calls `/api/query` and returns `allow`, `missing` or `deny`; local retrieval remains available when the rule engine is unavailable or when the answer needs source evidence.

Useful commands:

```bash
pnpm onto:step2 -- --project childcare --version v1 --policy ontology_xxx --data-root knowledge/raw
pnpm onto:finalize -- --project childcare --version v1 --regions 北京市,河北省 --rule-count 28
```

The generic runtime does not import domain facts. `SkillLoader` supplies answer method; the retrieval adapter supplies facts; tools expose bounded operations; validators enforce deterministic output and citation rules.

## Pi Runtime

`PolicyAgentRuntime` instantiates the public `Agent` from `@earendil-works/pi-agent-core@0.81.1`, sets `thinkingLevel: "off"`, uses sequential tool execution, and registers only `RestrictedToolRegistry.toPiTools()`. It subscribes to Pi events internally for call/step budgets and Raindrop, but does not forward those events to the browser.

The runtime flow is:

1. enforce input length/token, concurrency, queue and wall-clock budgets;
2. restore a TTL-bounded two-turn state;
3. normalize region/intent and reject unsafe or unsupported scope;
4. call read-only retrieval/version tools and build one Evidence Pack;
5. call the selected model through `ModelProvider`;
6. parse JSON and apply schema/business validators;
7. allow one minimal structure repair, otherwise use a deterministic safe template;
8. save the bounded session and flush trace recorders.

The Runtime enforces `MAX_AGENT_STEPS`, `MAX_MODEL_CALLS`, `MAX_TOOL_CALLS`, `MAX_INPUT_LENGTH`, `MAX_INPUT_TOKENS`, `MAX_OUTPUT_TOKENS`, `REQUEST_TIMEOUT_MS`, `MAX_CONCURRENT_RUNS`, `MAX_QUEUE_SIZE`, `SESSION_IDLE_TTL`, and `RETRIEVAL_TOP_K` in code.

## Retrieval and Evidence Pack

The adapter calls audited public `pi-local-rag` exports `openDb`, `initSchema` and `sha256`. It keeps the upstream `files`, `chunks`, `chunks_fts`, FTS triggers and index metadata. It deliberately bypasses upstream `indexFiles()` and `hybridSearch()` because 0.4.1 invokes embedding/vector code even with a pure-BM25 weight.

`SemanticPolicyChunker` recognizes Markdown headings, bold headings, Chinese chapters/articles, paragraphs, lists and tables. Oversized units split at paragraphs then Chinese clause boundaries. Every chunk retains deterministic ID, parent path and original line range.

`ChinesePolicySearchTextProcessor` normalizes 北京/北京市 and 河北/河北省, expands a small domain synonym dictionary, retains recognized phrases and adds Chinese bigrams. The original text stays in `policy_chunks`; only the search projection is expanded.

Query order is normalization, region/date parsing, FTS5 BM25 query, region/date/status filtering, version resolution, Top-K and Evidence Pack. Maternity-allowance documents are excluded unless the query explicitly asks about that concept. Sources in the response must exactly match Evidence Pack document IDs and URLs.

## Tools

All five tools implement the project `AgentTool<Input, Output>` metadata contract. Zod validates runtime input/output; TypeBox exposes the same bounded input to Pi. `get_policy_source` and `get_policy_metadata` accept registered IDs only. The registry rejects unlisted names, paths, URLs, SQL-shaped fields, excess calls, unsafe side-effect metadata and timed-out calls.

## Structured output

The public response contains `answer_markdown`, collapsibles, actions, sources, optional clarification and meta status. Zod enforces types, enums, URL form and array limits. Business validation then enforces Evidence Pack citations, region/date consistency, evidence before amount/eligibility claims, forbidden internal content, 1-3 main sentences, button constraints and no mechanical repetition.

Browser status may stream, but the result cannot. `PolicyUiEventAdapter` serializes only four discriminated event types after validation.

## Session and failure model

`InMemorySessionStore` clones state on read/write, expires inactive entries and never writes conversations to disk. The first user turn may produce one clarification; the second must answer or degrade. A third turn raises `SESSION_TURN_LIMIT` and maps to a safe public message.

The shared error taxonomy includes input/scope/context, retrieval/version, model/tool timeout/failure, invalid output/validation, session limit, index/telemetry/UI availability and internal failure. Public clients receive only the code and curated Chinese message.

## Observability

`TraceRecorder` is replaceable. `LocalTraceRecorder`, `RaindropTraceRecorder` and `CompositeTraceRecorder` share the interface. The Raindrop implementation uses the upstream Subscriber and transport; a sanitizing Agent proxy removes content before the subscriber sees it. Application events correlate request IDs and anonymous conversation IDs. All attach/record/flush/shutdown failures are isolated with settled promises or guarded calls.

## Web UI controlled fork

The UI retains upstream Vite/React/Tailwind foundation, Radix/shadcn primitives, AI Elements conversation/message/source/suggestion patterns, Streamdown Markdown rendering, reconnect behavior and local HTTP/WebSocket lifecycle. The Coding Agent event source is replaced entirely.

Removed from both UI and public protocol: thinking/reasoning blocks, raw tool calls/results, model and thinking selectors, context diagnostics, commands, tool toggles, session paths, history trees, branch navigation, file upload, terminal, prompts, stack traces and raw JSON.
