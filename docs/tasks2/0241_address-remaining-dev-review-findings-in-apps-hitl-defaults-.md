---
template: standard
schema_version: 1
name: "Address remaining dev-review findings in apps (HITL defaults, minors, architecture)"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-11T23:32:44.667Z"
updated_at: "2026-07-11T23:46:58.074Z"
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
<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->


- [ ] Given a server-side HITL responder with no explicit override, When a workflow approval gate
      fires, Then the response is "no" (denial), not "yes".
- [ ] Given `SPUR_HITL_AUTO_APPROVE=1` (or equivalent config), When a workflow approval gate fires,
      Then the response is "yes" (explicit opt-in).
- [ ] Given the CLI desktop-notifier responder on a non-macOS system with no `confirmDefault` config,
      When the osascript fallback or non-macOS fallback path is hit, Then `confirm` returns "no".
- [ ] Given the CLI responder on macOS with a working osascript, When the operator clicks "Yes",
      Then the response is "yes" (unchanged).


- [ ] Given production mode, When a 404 is returned, Then the response message is "Not found" (or
      equivalent status-appropriate text), not "Internal server error".
- [ ] Given production mode, When a 422 is returned, Then the response message is "Bad request" (or
      equivalent), not "Internal server error".
- [ ] Given production mode, When a 500 is returned, Then the response message is "Internal server
      error" (no stack/message leak).


- [ ] Given the server context module, When compiled, Then `_CoverageAnchor` class and its `void new`
      line do not exist in `context.ts`.
- [ ] Given `bun run lint`, When run, Then it passes clean (no coverage-gaming artifacts).


- [ ] Given `context.ts`, When type-checked, Then `as unknown as never` casts on `eventsBus` do not
      appear anywhere in the file.
- [ ] Given the consolidated bridge, When the server boots, Then all event buses are wired through the
      single typed bridge and events flow correctly (existing tests pass).


- [ ] Given InboxTab mounted with a 15s poll, When the component unmounts, Then all in-flight
      `AbortController`s are aborted (no dangling requests).
- [ ] Given two poll intervals overlap (slow response + new trigger), When the second fires, Then the
      first request is either aborted or its result ignored (no stale `setMessages` write).


- [ ] Given `$EDITOR="code -w"`, When `spur agent edit <id>` runs, Then `Bun.spawn` receives
      `["code", "-w", path]` (3 tokens), not `["code -w", path]` (2 tokens with binary "code -w").
- [ ] Given `$EDITOR="vim"`, When `spur agent edit <id>` runs, Then `Bun.spawn` receives
      `["vim", path]` (unchanged single-word behavior).


- [ ] Given `spur serve --json`, When run, Then the output either starts the server and reports the
      real server pid, or omits/nulls the pid field if no server was started.
- [ ] Given `spur serve --json`, When the output includes `pid`, Then the pid refers to a running
      server process, not the exited CLI process.


- [ ] Given both `modules/team/index.ts` and `modules/events/index.ts`, When the SSE stream handler
      is initialized, Then both use the same shared heartbeat/keepalive helper.
- [ ] Given the shared helper, When a heartbeat fires, Then a comment frame is enqueued (same behavior
      as before consolidation).
- [ ] Given the event module's existing tests, When run after consolidation, Then they still pass.


- [ ] Given `PlanningWriteService` throws on a guard denial, When the error is caught by
      `error-handler.ts`, Then it is matched by `instanceof GuardDeniedError` (not string matching)
      and mapped to 409 GUARD_DENIED.
- [ ] Given `PlanningWriteService` throws on a lock timeout, When the error is caught, Then it is
      matched by `instanceof LockTimeoutError` and mapped to 503 LOCK_TIMEOUT.
- [ ] Given the string-matching fallback (`message.includes('Lifecycle transition denied')` etc.),
      When the typed errors are thrown at the source, Then the fallback block is removed from
      `error-handler.ts`.
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
<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

1. **R1 — HITL default-deny** (highest severity — product decision)
   - [ ] Change `hitlResponder()` in `context.ts` to return "no" by default
   - [ ] Change `confirmDefault` to "no" in `desktop-notifier-responder.ts`
   - [ ] Add `SPUR_HITL_AUTO_APPROVE` env var / config key for explicit opt-in
   - [ ] Add test: default-deny assertion for server HITL responder
   - [ ] Add test: explicit opt-in assertion
   - [ ] Add test: CLI non-macOS fallback returns "no"

2. **R9 — Typed errors at throw site** (architecture — unblocks R2-ish cleanup)
   - [ ] Move `GuardDeniedError` / `LockTimeoutError` to shared location (packages/app or ts-utils)
   - [ ] Update `PlanningWriteService` to throw typed errors
   - [ ] Remove string-matching fallback in `error-handler.ts:127-143`
   - [ ] Add test: PlanningWriteService throws GuardDeniedError on guard denial
   - [ ] Add test: PlanningWriteService throws LockTimeoutError on lock timeout

3. **R2 — Status-appropriate error messages**
   - [ ] Add `messageForStatus()` helper
   - [ ] Replace generic "Internal server error" in non-500 production envelopes
   - [ ] Add test: 404 → "Not found", 422 → "Bad request", 500 → "Internal server error"

4. **R8 — SSE heartbeat deduplication**
   - [ ] Create shared SSE stream helper module
   - [ ] Refactor `modules/team/index.ts` to use shared helper
   - [ ] Refactor `modules/events/index.ts` to use shared helper
   - [ ] Run existing SSE/streaming tests to verify no regression

5. **R4 — Typed EventBus bridge**
   - [ ] Create single `bridgeEvents()` adapter
   - [ ] Replace all 7 `as unknown as never` casts in `context.ts`
   - [ ] Run `bun run lint` to verify type-clean

6. **R5 — InboxTab AbortController cleanup**
   - [ ] Track AbortController per request; abort previous before starting new
   - [ ] Add latest-request guard on `setMessages`
   - [ ] Verify with manual browser test (dev server + InboxTab)

7. **R6 — Multi-word `$EDITOR`**
   - [ ] Split editor string by whitespace before `Bun.spawn`
   - [ ] Add test: `code -w` splits to 3 tokens

8. **R7 — serve --json semantics**
   - [ ] Decide: fork-and-report-real-pid (preferred) or omit-pid (fallback)
   - [ ] Implement chosen approach
   - [ ] Add test or manual verification

9. **R3 — Remove `_CoverageAnchor`**
   - [ ] Delete class and `void new` line
   - [ ] Run coverage check; add tests for any accessors that drop below threshold

10. **Final verification**
    - [ ] `bun run lint` clean
    - [ ] `bun run test` passes (all workspaces)
    - [ ] `bun run build` succeeds
    - [ ] `git status` shows only intentional changes
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
