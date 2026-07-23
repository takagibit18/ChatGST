# Verification record

Final local verification date: 2026-07-23, Windows, Node.js 24.12.0, pnpm 11.1.2. No DeepSeek or Raindrop credential was present; model-path tests used the real Pi Agent Core with deterministic `TestModelProvider`. Policy inputs and evidence-bearing Golden output used for this run remain local-only and are not published in Git.

| Check | Command / method | Result |
| --- | --- | --- |
| Dependency install | `pnpm install --frozen-lockfile` | Passed; exact lockfile installed with required Windows native bindings, `better-sqlite3`, Vite and esbuild assets |
| Community extensions | `pnpm inspect:extensions` | Passed; all three exact versions loaded; FTS5 query hit; vector rows 0; Raindrop subscriber/shutdown; upstream Web UI + bridge assets served |
| Knowledge validation | `pnpm knowledge:validate` | Passed locally; 6 ignored documents, 0 errors, 0 warnings |
| Raw/curated inspection | `pnpm knowledge:inspect` | Passed; strict hashes, dates, regions, source URLs and semantic chunk counts reported |
| Index rebuild | `pnpm rag:build -- --rebuild` | Passed locally; 6 ignored documents, 54 chunks, 0 vector rows |
| Chinese BM25 smoke | `pnpm rag:smoke` | Passed for amount, eligibility, payment, deadline, migration and benefit distinction |
| TypeScript + production UI | `pnpm build` | Passed; initial UI chunk about 340 KB, Markdown/CJK renderer in a lazy chunk |
| Unit/integration tests | `pnpm test` | 5 files, 32 tests passed |
| Runtime demos | `pnpm smoke` | Five tools only, no forbidden tool, amount/eligibility/clarification/comparison/distinction/empty/unsafe passed, third turn returned `SESSION_TURN_LIMIT` |
| D-mode eval | `pnpm eval` | Recall@5 0.95, MRR 0.80, region/intent/citation/source/factual/schema/business rates 1.00, unsupported-answer rate 0 |
| HTTP health | `GET /healthz` | `200`, `{status:"ok", service:"childcare-policy-assistant", host:"loopback"}` |
| WebSocket | integration test + browser | `status -> status -> result`; malformed input maps to `safe_error`; no raw Agent event type |
| Browser desktop | Playwright CLI with local Edge | Page loaded; amount question answered; two official sources expanded; no overflow |
| Browser mobile | 390×844 viewport | All controls and privacy notice remained within viewport |
| Browser dark theme | emulated system dark scheme | Tokens, borders, inputs, sources and contrast rendered correctly |
| Browser console | Playwright `console warning` | 0 errors, 0 warnings |
| Browser two-turn flow | reset, vague question, select Beijing | Clarification displayed, second response completed, second-turn action button count 0 |

Browser screenshots were captured locally under ignored `output/playwright/` during verification. The local server was then stopped; no process or public listener is intentionally left running.

Not claimed as passed: a real DeepSeek V4 Flash network call and live Raindrop upload. Both require user-provided credentials and an actual API model ID/project; their providers, subscriber registration, sanitization, timeout/failure isolation and local fallback are covered by automated tests.
