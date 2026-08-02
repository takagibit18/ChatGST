# Eval v2.1 — provisional

This dataset replaces the invalid v2.0 quality baseline. Gold candidates are bound directly to K4 source chunks without calling retrieval, and every item remains `pending_review`.

Current Gold is claim-first: every answerable case records an exact K4 quote, source line range, chunk character range and complete atomic claims. `required_facts` is derived exactly from those claims; fixed-prefix extraction is forbidden.

```bash
pnpm eval:v2.1:review-checklist
pnpm eval:v2.1:build-gold
pnpm eval:v2.1:validate
pnpm eval:v2.1:calibrate
pnpm eval:v2.1
```

Human reviewers should work from [`HUMAN-REVIEW-CHECKLIST.md`](./HUMAN-REVIEW-CHECKLIST.md), then copy each decision back to the authoritative files under `annotations/` before regenerating datasets.

The train-only calibration is locked before dev execution. Raw predictions contain no Gold labels; scoring happens in a separate process. Because no business owner has approved the annotations, all reports set `evaluation_status=provisional`, block the release gate, and must not be used as final quality claims.
