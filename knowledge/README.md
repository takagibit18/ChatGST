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
