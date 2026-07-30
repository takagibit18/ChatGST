# ChatGST Learning Kit Reference Source

This directory stores supplemental reference source copied from the local learning package. The files are not part of the TypeScript runtime build; they are kept for architecture study, future porting, and implementation comparison.

## Layout

| Directory | Contents |
| --- | --- |
| `pipeline-core/` | Python document capture, parsing, enrichment, export and OKF conversion code. |
| `frontend-vue/` | Vue 3 management-console source snippets for API clients, layout, UI primitives and business panels. |
| `deploy/` | Linux install/run/systemd/nginx deployment samples. |

## Integration Notes

The current production path remains the TypeScript policy assistant in `apps/` and `packages/`. Treat this directory as a reference shelf: useful for borrowing pipeline logic or UI patterns, but not automatically executed by tests or builds.

