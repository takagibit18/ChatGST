# Eval v2.1 — provisional

This dataset replaces the invalid v2.0 quality baseline. Gold candidates are bound directly to K4 source chunks without calling retrieval, and every item remains `pending_review`.

```bash
pnpm eval:v2.1:validate
pnpm eval:v2.1:calibrate
pnpm eval:v2.1
```

The train-only calibration is locked before dev execution. Raw predictions contain no Gold labels; scoring happens in a separate process. Because no business owner has approved the annotations, all reports set `evaluation_status=provisional`, block the release gate, and must not be used as final quality claims.
