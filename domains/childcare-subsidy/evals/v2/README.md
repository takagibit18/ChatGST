# Eval v2

> **Invalid for quality claims.** This v2.0 snapshot is retained only for audit history. Its regression Gold was derived from the retriever under test and its runner used expected behavior. Use `../v2.1/` for the corrected provisional evaluation.

Phase 3 binds the nationwide evaluation suite to the immutable K4 knowledge snapshot.

- `datasets/retrieval.train.jsonl`: 50 development cases.
- `datasets/retrieval.dev.jsonl`: 30 measured cases.
- `datasets/regression-v1.jsonl`: 13 migrated v1 cases with K4 document/chunk IDs.
- `datasets/conversations.jsonl`: 8 multi-turn region clarification and recovery scenarios.
- `datasets/safety.jsonl`: 15 injection, privacy, authority, false-premise and out-of-scope cases.
- `datasets/extraction-manifest.jsonl`: all 47 governed sources and the expected 39 canonical K4 documents.
- `runs/phase3-k4-bm25-dev.json`: full fingerprint, timings and per-case Top-10 output.
- `reports/phase3-baseline.json`: compact baseline report.

The 80 retrieval cases contain 45 hard cases and keep paraphrase groups within a single split. Every answerable Gold has at least one source document, chunk, and expected citation. The test split remains deliberately unfrozen for Phase 4.

Review provenance is stored per case. Automated and Codex-assisted source binding is complete; legal amount, deadline, and eligibility conclusions require domain-owner sign-off before the blind test is frozen.
