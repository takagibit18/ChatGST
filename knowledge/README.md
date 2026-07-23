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

The generated SQLite index and evidence-bearing Golden output are also local-only.
