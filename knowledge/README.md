# Local-only policy corpus

Policy source Markdown is intentionally excluded from Git and must not be published with this repository.

For local development, create these directories as needed:

```text
knowledge/raw/
knowledge/curated/
knowledge/metadata/
```

Place source Markdown under `raw/` or reviewed local snapshots under `curated/`. Optional filename-keyed metadata overrides belong in `metadata/overrides.json`. All of those paths are ignored by Git.

Then run:

```bash
pnpm knowledge:validate
pnpm rag:build -- --rebuild
```

The committed nationwide intake uses a separate, hash-bound governance manifest. Verify it and build only its approved records with:

```bash
pnpm knowledge:governance:validate
pnpm rag:build:nationwide -- --rebuild
```

The nationwide loader resolves administrative aliases to canonical codes and excludes every `quarantined` or `unknown` record before indexing. `knowledge/metadata/overrides.json` remains the backwards-compatible local override path.

Phase 2 artifacts are regenerated and verified with:

```bash
pnpm knowledge:phase2:write      # intentional artifact refresh
pnpm knowledge:phase2:validate   # read-only reproducibility check
pnpm rag:build:nationwide -- --rebuild
```

`duplicate-candidates.json` is machine-generated and does not itself suppress retrieval. Only confirmed groups in `duplicate-groups.json` assign a canonical document. Immutable K0–K4 manifests live under `knowledge/snapshots/`; the K4 hash is persisted into the SQLite index on a nationwide build.

The generated SQLite index and evidence-bearing Golden output are also local-only.

Phase 3 Eval v2.1 artifacts are reproducible against the K4 index:

```bash
pnpm eval:v2.1:prepare     # validate source-first annotations and materialize datasets
pnpm eval:v2.1:validate    # read-only schema, inventory, leakage and K4 binding checks
pnpm eval:v2.1:calibrate   # calibrate no-answer threshold from train only
pnpm eval:v2.1             # isolated runner and scorer; write the provisional report
```

The committed annotations, train/dev datasets, calibration record, label-free predictions and provisional report live in `domains/childcare-subsidy/evals/v2.1/`. All 143 annotations are `pending_review`; the release gate remains blocked until the responsible domain owner signs off. The blind test split is intentionally not frozen.

Eval v2.0 remains under `domains/childcare-subsidy/evals/v2/` for audit only. Its Gold labels were influenced by retrieval output and its runner consumed expected behavior, so it is invalid for quality claims. The legacy `eval:v2*` commands now fail with a migration notice instead of regenerating artifacts.
