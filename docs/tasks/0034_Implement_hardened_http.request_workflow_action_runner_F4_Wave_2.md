---
name: Implement hardened http.request workflow action runner (F4 Wave 2)
description: Implement hardened http.request workflow action runner (F4 Wave 2)
status: Backlog
created_at: 2026-06-10T00:46:55.044Z
updated_at: 2026-06-10T00:46:55.044Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0034. Implement hardened http.request workflow action runner (F4 Wave 2)

### Background

Wave 2 of task 0032. The `http.request` workflow action was split out of 0032 because it is the **odd
one out**: highest security surface (network / SSRF) and lowest relevance to the `feature-dev` loop
(none of brainstorm→…→verify needs HTTP). 0032 ships `agent.run` + `rule.check` + `file.*` first —
which fully de-`note`s `feature-dev.yaml` — and defers HTTP here so it gets the security hardening it
needs without blocking the dev-loop automation.

It registers as a spur built-in via `registerSpurBuiltins` (same factory as 0032), dependency-free
(built-in `fetch`).

### Requirements

1. **HttpRequestActionRunner** (kind: `http.request`), registered in `registerSpurBuiltins`.
2. Options: `url` (required), `method` (default **`GET`** — the conventional default; the original
   `POST` was surprising), `headers`, `body`, `failOnStatus: number[]`, `timeoutMs`.
3. **Security (gating — do not ship without):**
   - Reject non-`http(s)` schemes before any fetch (no `file://`, `gopher://`, etc.).
   - Scheme/host allowlist or an explicit opt-in gate (mirror the engine extension loader's fail-closed
     pattern) — a workflow shouldn't reach arbitrary hosts by default.
   - **Never log `headers`** (auth tokens); redact in any diagnostic output.
   - Treat templated `url`/`headers`/`body` (`${...}`) as untrusted input.
4. Execution: template-resolve `url`/`headers`/`body`; build `RequestInit`; `AbortSignal.timeout` when
   `timeoutMs` set; read response body as text.
5. Success mapping: `response.ok && !failOnStatus.includes(status)` → `ok: true`; else `ok: false`.
   `data: { status, headers, body }`. Network error/timeout → caught → `ok: false` with message.
6. With F1 (task 0033) available, optionally `setVars` the response body/status into a named var for a
   downstream action.
7. Tests (mock global `fetch`): GET default; non-http(s) scheme rejected pre-fetch; 200 ok; 500 with
   empty `failOnStatus` → fail; 200 with `failOnStatus:[200]` → fail; network error → fail; headers
   never logged.
8. Gate: `bun run check` + `bun run build` green; no regressions.

### Q&A

**Q1. Why GET default, not POST?** HTTP convention. 0032's original POST default would surprise authors
and make read requests verbose.

**Q2. Allowlist vs. opt-in flag?** Decide in design. Default-deny (allowlist) is safer; an opt-in
`allowNet`-style gate is simpler. Whichever, the runner must not reach arbitrary hosts silently.

### Design

_Pending._

### Solution

_Pending design._

### Plan

1. Implement `HttpRequestActionRunner` with the security gate (scheme check + allowlist/opt-in + header
   redaction).
2. Register in `registerSpurBuiltins` (extend the 0032 factory).
3. Tests (mock `fetch`, all the cases above incl. the security rejections).
4. Optional F1 `setVars` integration once 0033 lands.
5. Gate green.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


