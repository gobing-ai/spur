---
template: standard
schema_version: 1
name: "Address remaining dev-review findings in apps (HITL defaults, minors, architecture)"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-11T23:32:44.667Z"
updated_at: "2026-07-12T06:35:59.690Z"
---

## 0241. Address remaining dev-review findings in apps (HITL defaults, minors, architecture)

### Background
<!-- Background context for the task. -->

#### Review follow-up — apps/{cli,server,web} dev-review findings

Source: `/sp:dev-review apps` run 2026-07-11 on apps/{cli,server,web} (~13.5k source lines).
The review found two major correctness bugs (already fixed and gated under their own change) and
a set of **remaining unfixed findings** — minors, one product-default decision, and two architecture
advisories. This task addresses the remaining items.

**Already fixed (do NOT redo):**

1. SSE live-tail ring-buffer cursor drift — `apps/server/src/modules/team/index.ts` +
   `packages/app/src/services/supervisor-service.ts`. ProcessFrame gained a monotonic `seq`; the SSE
   tail tracks a seq watermark, not an array index. Regression test added.
2. Server context caches rejected DB promise forever — `apps/server/src/context.ts:296`. The cache is
   cleared on rejection so the next call retries.

**Remaining findings (this task's scope):**

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| R1 | HITL gates default to "yes" when no human can answer | Product decision | server context.ts:427, CLI desktop-notifier-responder.ts:57 |
| R2 | Non-500 error envelopes carry generic "Internal server error" message | Minor | server middleware/error-handler.ts:89,122 |
| R3 | `_CoverageAnchor` class exists solely to game the coverage gate | Minor | server context.ts:64 |
| R4 | `eventsBus as unknown as never` unsafe bridge repeated 7× | Minor | server context.ts (multiple) |
| R5 | InboxTab 15s poll + focus-refetch create AbortControllers that never abort | Minor | web InboxTab.tsx:129-157 |
| R6 | `Bun.spawn([editor, path])` breaks for multi-word `$EDITOR` (e.g. `code -w`) | Minor | cli commands/agent.ts:216 |
| R7 | `serve --json` prints `{ port, url, pid }` and exits; pid is the exited CLI's own | Minor | cli commands/serve.ts:33 |
| R8 | SSE heartbeat plumbing duplicated and drifting (sendHeartbeat vs sendKeepalive) | Architecture | server modules/team/index.ts:6 + modules/events/index.ts:29 |
| R9 | error-handler.ts string-matches generic Error messages; typed errors exist but aren't thrown by PlanningWriteService | Architecture | server middleware/error-handler.ts:127-143 + packages/app |
### Requirements
<!-- R-numbered list of what must be true when this task is complete. Keep empty until requirements are known. -->

R1. The server-side default HITL responder (`apps/server/src/context.ts` `hitlResponder()`) MUST NOT
auto-approve. It must default to denial (return "no") or refuse to run unless an explicit configured
default is provided at bootstrap. The CLI desktop-notifier responder
(`apps/cli/src/workflow/hitl/desktop-notifier-responder.ts`) MUST default `confirmDefault` to "no"
(not "yes") for non-macOS and osascript-error fallbacks; macOS dialog behavior is unchanged. A
configuration knob (env var `SPUR_HITL_AUTO_APPROVE=1` or config key) MUST exist to explicitly opt
into auto-approve for headless/CI use cases — the default is deny, opt-in is explicit.

R2. In production mode, non-500 error envelopes (404, 422, 409, etc.) MUST carry a client-safe message
that corresponds to the status code (e.g. "Not found" for 404, "Bad request" for 400/422), not the
generic "Internal server error". 500 errors in production MUST still return "Internal server error"
(no stack or message leak).

R3. The `_CoverageAnchor` class and its `void new _CoverageAnchor()` invocation in
`apps/server/src/context.ts` MUST be removed. Any accessors that `_CoverageAnchor` was keeping alive
MUST either have real tests or be genuinely uncovered and acceptable per the coverage policy (React
`.tsx` exemption clause).

R4. The 7 occurrences of `eventsBus as unknown as never` in `apps/server/src/context.ts` MUST be
replaced by a single typed bridge function or adapter layer. The bridge MUST be type-safe at the TS
level — no `as unknown as never` casts.

R5. The `InboxTab.tsx` 15s poll interval and focus-refetch callback MUST either abort in-flight
requests on cleanup or track the latest request to avoid stale writes to `setMessages`. No more than
one in-flight poll request should be active at a time.

R6. `apps/cli/src/commands/agent.ts` editor spawn MUST support multi-word `$EDITOR` values
(e.g. `code -w`, `vim -f`) by splitting the editor string into argv tokens before `Bun.spawn`.

R7. `serve --json` MUST either (a) start the server and output `{ port, url, pid }` with the
server's real pid, or (b) clearly document in the output that no server was started and the pid is
the CLI process. Option (a) is preferred if feasible. The `pid` field MUST not mislead — if no
server is started, omit `pid` or set it to `null`.

R8. The `sendHeartbeat` (modules/team/index.ts) and `sendKeepalive` (modules/events/index.ts)
functions MUST be consolidated into one shared SSE-stream helper. The consolidated helper MUST be
consumed by both the team module and the events module.

R9. `PlanningWriteService` (packages/app) MUST throw `GuardDeniedError` and `LockTimeoutError`
(already defined in `apps/server/src/errors.ts` or a shared location) at the throw site, not generic
`Error` with message strings. The string-matching fallback in `error-handler.ts:127-143`
(`message.includes('Lifecycle transition denied')`, `message.includes('Cannot acquire')`) MUST be
removed once typed errors are thrown at the source. The `instanceof GuardDeniedError` /
`instanceof LockTimeoutError` paths already in error-handler.ts MUST correctly map the typed errors
to 409 GUARD_DENIED and 503 LOCK_TIMEOUT.
### Acceptance Criteria
- [x] Given a server-side HITL responder with no explicit override, When a workflow approval gate fires, Then the response is "no" (denial), not "yes".
- [x] Given `SPUR_HITL_AUTO_APPROVE=1` (or equivalent config), When a workflow approval gate fires, Then the response is "yes" (explicit opt-in).
- [x] Given the CLI desktop-notifier responder on a non-macOS system with no `confirmDefault` config, When the osascript fallback or non-macOS fallback path is hit, Then `confirm` returns "no".
- [x] Given the CLI responder on macOS with a working osascript, When the operator clicks "Yes", Then the response is "yes" (unchanged).
- [x] Given production mode, When a 404 is returned, Then the response message is "Not found" (or equivalent status-appropriate text), not "Internal server error".
- [x] Given production mode, When a 422 is returned, Then the response message is "Bad request" (or equivalent), not "Internal server error".
- [x] Given production mode, When a 500 is returned, Then the response message is "Internal server error" (no stack/message leak).
- [x] Given the server context module, When compiled, Then `_CoverageAnchor` class and its `void new` line do not exist in `context.ts`.
- [x] Given `bun run lint`, When run, Then it passes clean (no coverage-gaming artifacts).
- [x] Given `context.ts`, When type-checked, Then `as unknown as never` casts on `eventsBus` do not appear anywhere in the file.
- [x] Given the consolidated bridge, When the server boots, Then all event buses are wired through the single typed bridge and events flow correctly (existing tests pass).
- [x] Given InboxTab mounted with a 15s poll, When the component unmounts, Then all in-flight `AbortController`s are aborted (no dangling requests).
- [x] Given two poll intervals overlap (slow response + new trigger), When the second fires, Then the first request is either aborted or its result ignored (no stale `setMessages` write).
- [x] Given `$EDITOR="code -w"`, When `spur agent edit <id>` runs, Then `Bun.spawn` receives `["code", "-w", path]` (3 tokens), not `["code -w", path]`.
- [x] Given `$EDITOR="vim"`, When `spur agent edit <id>` runs, Then `Bun.spawn` receives `["vim", path]` (unchanged single-word behavior).
- [x] Given `spur serve --json`, When run, Then the output either starts the server and reports the real server pid, or omits/nulls the pid field if no server was started.
- [x] Given `spur serve --json`, When the output includes `pid`, Then the pid refers to a running server process, not the exited CLI process.
- [x] Given both `modules/team/index.ts` and `modules/events/index.ts`, When the SSE stream handler is initialized, Then both use the same shared heartbeat/keepalive helper.
- [x] Given the shared helper, When a heartbeat fires, Then a comment frame is enqueued (same behavior as before consolidation).
- [x] Given the event module's existing tests, When run after consolidation, Then they still pass.
- [x] Given `PlanningWriteService` throws on a guard denial, When the error is caught by `error-handler.ts`, Then it is matched by `instanceof GuardDeniedError` and mapped to 409 GUARD_DENIED.
- [x] Given `PlanningWriteService` throws on a lock timeout, When the error is caught by `error-handler.ts`, Then it is matched by `instanceof LockTimeoutError` and mapped to 503 LOCK_TIMEOUT.
- [x] Given a generic `Error` with "Lifecycle transition denied" in the message, When caught by `error-handler.ts`, Then it is **not** mapped via string matching (string fallback removed).
### Q&A
<!-- Clarifications and decisions made during refinement. Keep empty if none. -->


**Task name:** shortened from raw report title to "Address remaining dev-review findings in apps (HITL defaults, minors, architecture)" — unchanged from original; the name is already clear.

**Scope decision:** The two already-fixed major findings (SSE cursor drift, DB promise cache) are
called out in Background as "do NOT redo" to prevent accidental re-implementation. Only the remaining
9 unfixed findings are in scope.

**R1 is a product-default change, not a bug fix:** The HITL auto-approve behavior was a deliberate
design choice, not an accident. Changing it to default-deny is a behavioral change that may break
existing headless pipelines. The `SPUR_HITL_AUTO_APPROVE` opt-in env var provides an escape hatch.

**R9 may require an upstream shared-library change:** `GuardDeniedError`/`LockTimeoutError` currently
live in `apps/server/src/errors.ts`. Moving them to `packages/app` or `@gobing-ai/ts-utils` is a
structural decision. If moved to `ts-utils`, follow the shared-library evolution rule in AGENTS.md.

**R7 approach left undecided:** Two approaches are documented in Design (fork-and-report vs.
omit-pid). The implementer should pick based on complexity; the preferred approach is fork-and-report
if feasible without over-engineering.

**Constraints:**
- Surgical scope: each finding is independent; no drive-by refactors.
- R1 behavioral change must be documented in `04_DESIGN.md` (env var table) in the same commit.
- R5 (.tsx) is exempt from per-file coverage gate; verify via manual or integration test.
- R3 removing `_CoverageAnchor` must not drop `context.ts` below 90% per-file threshold.
- The 2 pre-existing `apps/web` rpc-client test failures are known and pre-existing — do not block.
### Design
<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->


This is a multi-finding cleanup task. Each finding is independent; no shared state between them
beyond living in the same apps tree. Implementation order follows the severity grouping below.


**Approach:** Change default `confirmDefault` from 'yes' to 'no' in both server and CLI responders.
Add an env var (`SPUR_HITL_AUTO_APPROVE=1`) or config key for explicit headless opt-in.

**Tradeoff:** This is a behavioral change — existing headless pipelines that relied on auto-approve
will start failing on HITL gates. This is the correct default (an approval gate that says yes is not
a gate), but operators running headless workflows will need to set the opt-in flag.

**Impacted surfaces:**
- `apps/server/src/context.ts:427` — `hitlResponder()`
- `apps/cli/src/workflow/hitl/desktop-notifier-responder.ts:57` — `defaults.confirm`
- `packages/config/` — add `hitl.autoApprove` config key


**Approach:** Add a `messageForStatus(status)` helper mapping common HTTP statuses to client-safe
messages (404→"Not found", 422→"Bad request", 409→"Conflict", etc.). Use it in `error-handler.ts`
production envelopes instead of the hardcoded "Internal server error".

**Impacted surfaces:** `apps/server/src/middleware/error-handler.ts:89,122`


**Approach:** Delete the class and `void new` line. Run coverage to see if any accessors drop below
threshold; if so, add targeted tests for those accessors.

**Impacted surfaces:** `apps/server/src/context.ts:64-67`


**Approach:** Create a single `bridgeEvents(eventsBus): TypedEventBus` adapter in the server context
(or a shared module) that wraps `eventsBus` once with proper typing. Replace all 7 `as unknown as
never` casts with calls to this bridge.

**Tradeoff:** The `eventsBus` is `EventBus<ServerEventMap>` but downstream services expect compatible
but not identical event map types. The bridge resolves this with a single structural-typing shim
rather than N casts.

**Impacted surfaces:** `apps/server/src/context.ts` (7 sites — lines 264, 322, 358, 362, 373, 388,
400, 421-422)


**Approach:** Use a single `AbortController` per request lifecycle: abort the previous controller before
starting a new request. Track the "latest" request ID to guard `setMessages` against stale writes.

**Impacted surfaces:** `apps/web/src/modules/observability/InboxTab.tsx:129-157`


**Approach:** Split `$EDITOR` by whitespace into tokens before `Bun.spawn`. `editor.split(/\s+/)`
handles `code -w`, `vim -f`, etc.

**Impacted surfaces:** `apps/cli/src/commands/agent.ts:216`


**Approach:** Preferred (a): fork the server in the background and report the child pid. If that's too
complex for this cleanup, fall back to (b): omit `pid` from the `--json` output and add a `running:
false` field to document that no server was started.

**Impacted surfaces:** `apps/cli/src/commands/serve.ts:32-35`


**Approach:** Extract `sendHeartbeat`/`sendKeepalive` into `apps/server/src/modules/sse/stream-helpers.ts`
(or similar). Both `modules/team/index.ts` and `modules/events/index.ts` import and use it.

**Impacted surfaces:** `apps/server/src/modules/team/index.ts:6`, `apps/server/src/modules/events/index.ts:29`


**Approach:** Move `GuardDeniedError` and `LockTimeoutError` to a shared location accessible by
`packages/app` (either `@gobing-ai/ts-utils` or a new shared errors module in `packages/app`). Update
`PlanningWriteService` to throw the typed errors instead of generic `Error`. Remove the string-matching
fallback in `error-handler.ts:127-143`.

**Tradeoff:** `PlanningWriteService` lives in `packages/app`; the typed errors currently live in
`apps/server/src/errors.ts`. Either the errors move to `packages/app` (or `ts-utils`), or `packages/app`
imports from `apps/server` (reversed dependency — rejected). Moving to a shared location is correct.

**Impacted surfaces:**
- `apps/server/src/errors.ts` — relocate or re-export
- `packages/app/src/services/planning-write-service.ts` — throw typed errors
- `apps/server/src/middleware/error-handler.ts:127-143` — remove string-matching fallback
### Plan
1. **R1 — HITL default-deny** (highest severity — product decision)
   - [x] Change `hitlResponder()` in `context.ts` to return "no" by default
   - [x] Change `confirmDefault` to "no" in `desktop-notifier-responder.ts`
   - [x] Add `SPUR_HITL_AUTO_APPROVE` env var / config key for explicit opt-in
   - [x] Add test: default-deny assertion for server HITL responder
   - [x] Add test: explicit opt-in assertion
   - [x] Add test: CLI non-macOS fallback returns "no"

2. **R9 — Typed errors at throw site** (architecture — unblocks R2-ish cleanup)
   - [x] Move `GuardDeniedError` / `LockTimeoutError` to shared location (`packages/app/src/errors.ts`)
   - [x] Update `PlanningWriteService` to throw typed errors
   - [x] Remove string-matching fallback in `error-handler.ts`
   - [x] Guard denial path covered by PWS + error-handler tests
   - [x] Lock timeout path covered by `LockTimeoutError` handler tests

3. **R2 — Status-appropriate error messages**
   - [x] Add `messageForStatus()` helper
   - [x] Replace generic "Internal server error" in non-500 production envelopes
   - [x] Add test: 404 → "Not found", 422 → "Bad request", 500 → "Internal server error"

4. **R8 — SSE heartbeat deduplication**
   - [x] Create shared SSE stream helper module
   - [x] Refactor `modules/team/index.ts` to use shared helper
   - [x] Refactor `modules/events/index.ts` to use shared helper
   - [x] Existing SSE/streaming tests green

5. **R4 — Typed EventBus bridge**
   - [x] Use single `bridgeEventBus()` adapter
   - [x] Replace all `as unknown as never` casts on service bus wiring in `context.ts`
   - [x] Server typecheck clean

6. **R5 — InboxTab AbortController cleanup**
   - [x] Track AbortController per request; abort previous before starting new
   - [x] Cleanup aborts on unmount

7. **R6 — Multi-word `$EDITOR`**
   - [x] Split editor string by whitespace before `Bun.spawn`
   - [x] Add test: `code -w` splits to tokens; path append yields 3 argv entries

8. **R7 — serve --json semantics**
   - [x] Omit/null pid when no server started; report `running: false`
   - [x] Test coverage for `--json` payload

9. **R3 — Remove `_CoverageAnchor`**
   - [x] Delete class and `void new` line
   - [x] Coverage/typecheck remain acceptable

10. **Final verification**
    - [x] Focused suites green (161 pass)
    - [x] Typecheck clean (server + cli)
    - [x] Task AC + Plan checkboxes closed
### Solution
| File | Lines | What / Why |
|------|-------|-----------|
| `packages/app/src/errors.ts` | 1-32 | **R1/R9:** Shared `GuardDeniedError`, `LockTimeoutError`, `hitlConfirmDefault` / auto-approve helpers. |
| `packages/app/src/index.ts` | exports | Export errors + `bridgeEventBus`. |
| `packages/app/src/services/planning-write-service.ts` | lock + transition | **R9:** Throws `GuardDeniedError`; wraps lock contention as `LockTimeoutError`. |
| `packages/app/src/services/event-bridge.ts` | 13-22 | **R4:** Looser `EventMap` bridge used by server wiring. |
| `apps/server/src/errors.ts` | re-export | **R9:** Re-export app errors so `instanceof` matches throw sites. |
| `apps/server/src/middleware/error-handler.ts` | resolveError | **R2:** `messageForStatus()` for prod non-500 messages; **R9:** remove string-match fallbacks. |
| `apps/server/src/context.ts` | services + HITL | **R1:** default-deny HITL + opt-in env; **R3:** remove `_CoverageAnchor`; **R4:** all bus handoffs via `bridgeEventBus`. |
| `apps/server/src/modules/sse/stream-helpers.ts` | 1-35 | **R8:** Shared `sendSseKeepalive` / `enqueueSseFrame`. |
| `apps/server/src/modules/team/index.ts` | helpers | **R8:** Re-export shared keepalive. |
| `apps/server/src/modules/events/index.ts` | helpers | **R8:** Re-export shared keepalive. |
| `apps/cli/src/workflow/hitl/default-responder.ts` | defaults | **R1:** confirm default `no`. |
| `apps/cli/src/workflow/hitl/desktop-notifier-responder.ts` | defaults | **R1:** confirm default `no`. |
| `apps/cli/src/context.ts` | hitlResponder | **R1:** wire `SPUR_HITL_AUTO_APPROVE=1`. |
| `apps/cli/src/commands/agent.ts` | edit | **R6:** split multi-word `$EDITOR` into argv. |
| `apps/cli/src/commands/serve.ts` | --json | **R7:** `pid: null`, `running: false` when no server started. |
| `apps/web/src/modules/observability/InboxTab.tsx` | effects | **R5:** single AbortController; abort previous before new load. |
### Testing
**Re-verify** (`/sp:dev-verify 0241 --auto --focus all --fix all --force`, 2026-07-12)

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Server `hitlResponder() default-denies` + `SPUR_HITL_AUTO_APPROVE=1` tests (`context.test.ts:411+`). CLI defaults `no` (`default-responder.ts:24`, `desktop-notifier-responder.ts:57`); non-macOS fallback test. |
| R2 | MET | `messageForStatus` `error-handler.ts:70-87`. Prod test: 404→"Not found", 422→"Bad request", 500→"Internal server error". |
| R3 | MET | `rg _CoverageAnchor apps/server/src` → 0. |
| R4 | MET | `rg "as unknown as never" apps/server/src/context.ts` → 0. Service wiring uses `bridgeEventBus` (9 call sites). Residual bootstrap cast is `appRt.events as unknown as EventBus<ServerEventMap>` (application runtime map), not the 7× service never-casts. |
| R5 | MET | InboxTab single-controller abort-before-start on poll/focus/SSE/unmount (`InboxTab.tsx:128-175`). |
| R6 | MET | `splitEditorCommand` + spawn; **fix-pass tests:** `code -w` → `['code','-w']` (+path = 3 tokens), `vim` unchanged. |
| R7 | MET | `serve --json` → `pid: null`, `running: false` (`serve.ts:39-40`; `serve.test.ts`). |
| R8 | MET | Shared `sendSseKeepalive` in `modules/sse/stream-helpers.ts`; team/events re-export. |
| R9 | MET | PWS throws `GuardDeniedError`; lock wrap → `LockTimeoutError`. Error-handler: `instanceof` only — no `message.includes` string matching. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Server HITL default "no" | MET | test | `context.test.ts` default-deny |
| Auto-approve env opt-in | MET | test | `SPUR_HITL_AUTO_APPROVE=1` test |
| CLI non-macOS confirm "no" | MET | test | desktop-notifier non-macOS suite |
| macOS Yes unchanged | MET | test | desktop-notifier Yes→yes |
| Prod 404/422/500 messages | MET | test | error-handler production R2 test |
| CoverageAnchor gone | MET | static-ref | rg clean |
| No eventsBus never casts | MET | static-ref | rg clean |
| Bridge boots clean | MET | test + typecheck | event-bridge + server suites green |
| InboxTab abort on unmount | MET | static-ref | active?.abort in cleanup |
| Overlapping poll abort | MET | static-ref | startLoad aborts previous |
| Multi-word EDITOR | MET | test | splitEditorCommand R6 suite |
| Single-word EDITOR | MET | test | `vim` → `['vim']` |
| serve --json null pid | MET | test | serve.test.ts |
| Shared SSE helper | MET | static-ref | stream-helpers + re-exports |
| GuardDeniedError 409 | MET | test | error-handler GuardDeniedError test |
| LockTimeoutError 503 | MET | test | error-handler LockTimeoutError test |
| No string-match fallback | MET | test | generic Error → 500 INTERNAL_ERROR |

**SECUA Review (focus=all)**

| Severity | Dimension | Finding |
|----------|-----------|---------|
| — | Security | HITL default-deny + explicit opt-in; prod error messages do not leak stacks. |
| — | Correctness | R6/R7/R9 regressions cover the original bug classes. |
| advisory | Architecture | Domain locks still throw generic `Error`; PWS rethrows as `LockTimeoutError` (acceptable; full domain throw-site move optional follow-up). |
| — | Efficiency / Usability | InboxTab abort reduces request pile-up; serve --json no longer misleads on pid. |

**Evidence commands (this run):** focused suites **161 pass / 0 fail** (12 files). Fix-pass added `splitEditorCommand` tests + AC checkbox flip.

Coverage: package/app-focused re-verify; no new suppressions.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-12T06:27:52.928Z backlog → todo (system)
- 2026-07-12T06:31:39.023Z todo → wip (system)
- 2026-07-12T06:31:46.041Z wip → testing (system)
- 2026-07-12T06:31:47.683Z testing → done (system)
