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

The generated SQLite index and evidence-bearing Golden output are also local-only.
