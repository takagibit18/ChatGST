# Controlled public-policy adaptation of pi-web-ui

Baseline: `@kkkiio/pi-web-ui` 0.1.1, commit `a3ab3b1c46f0ad3d837d7ba9e968b7e61d5259da`.

The upstream project states that its UI started as a fork of `deflating/tau`. This adaptation retains the upstream MIT license, React/Vite/Tailwind foundation, selected AI Elements components, Markdown rendering, session-to-browser connection pattern, and WebSocket lifecycle pattern.

The upstream Coding Agent event source is intentionally not loaded. The policy server emits only `status`, `result`, `safe_error`, and `session_reset`. Full differences are documented in `docs/upstream-delta.md`.

