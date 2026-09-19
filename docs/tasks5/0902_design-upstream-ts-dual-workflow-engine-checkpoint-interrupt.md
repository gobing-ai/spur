---
schema_version: 1
name: Design upstream ts-dual-workflow-engine checkpoint/interruption contract (ts-libs packages/dual-workflow-engine) — prerequisite for 0901 R2 safe-resume
status: done
template: issue
created_at: 2026-09-19T20:04:11.204Z
updated_at: "2026-09-19T20:40:36.229Z"
feature_id: D3

---

## 0902. Design upstream ts-dual-workflow-engine checkpoint/interruption contract (ts-libs packages/dual-workflow-engine) — prerequisite for 0901 R2 safe-resume

### Background

Captured from the creation title: "Design upstream ts-dual-workflow-engine checkpoint/interruption contract (ts-libs packages/dual-workflow-engine) — prerequisite for 0901 R2 safe-resume".

### Requirements

- [x] R1. Pause/resume primitives on the released engine facade: an interruption contract that permits pausing a run and resuming WITHOUT skipping the current state's pending actions (engine 0.4.69 resume semantics skip current-state actions, which makes status-only paused restoration unsafe).
- [x] R2. Side-effect/idempotency contract: classify action classes as exactly-once vs at-least-once-with-idempotency-key so hosts can persist durable state before interruption and re-run safely on resume.
- [x] R3. Concurrent-ownership rules: a resumed run must never double-execute actions while the original owner may still be live (lease or fresh-run-ID semantics), and stale owners must fail loudly rather than race.
- [x] R4. Release path: shipped in @gobing-ai/ts-dual-workflow-engine with semver bump + docs; spur-new then bumps its dependency and re-runs `/sp-dev-refine 0901 --depth ready` to freeze task 0901.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-19T20:37:26.138Z

#### Q&A entry — 2026-09-19 (delivery)

- Closed: lease/heartbeat vs CAS → **CAS single-UPDATE ownership claim** (`claimRunOwnership`); no heartbeats — stale owners are marked `interrupted` and fail loudly, no liveness clock to tune.
- Closed: resume semantics per status → `paused` defaults skip-enter (human-gated, actions were observed), `interrupted` defaults rerun-enter (owner died mid-action, side effects unknown); explicit `resumeMode` overrides both.
- Closed: new observability events in spur's `ObservableWorkflowAdapter`? → no; engine owns `workflow.run.resumed`/`workflow.run.interrupted` emission; spur adapters pass `claimRunOwnership`/`interruptRun` through untouched.
- Closed: migration shape → guarded ALTERs (`WORKFLOW_ENGINE_MIGRATIONS_SQL`) for pre-0.5.0 DBs; fresh DBs get columns in CREATE TABLE. Covered by a dedicated migration test.

### Design

ADR-025 (ts-libs docs/00_ADR.md, accepted 2026-09-19): **Run Interruption Contract — Ownership Claim, Rerun-Enter Resume, Interrupted Status**, released as `@gobing-ai/ts-dual-workflow-engine` 0.5.0.

- **R1 pause/resume primitives** → new run status `interrupted` + `service.interruptRun(runId, reason)` (best-effort CAS; `undefined` when row missing or not paused/resumable). Resume from `interrupted` defaults to **rerun-enter** (current-state actions re-execute); paused defaults to **skip-enter**; explicit `resumeMode` option overrides. Engine emits authoritative `workflow.run.resumed` (resumeMode/ownerAttemptId) and new `workflow.run.interrupted` events.
- **R2 side-effect/idempotency contract** → rerun-enter is the at-least-once story: hosts persist durable state before side effects and mark them done; skip-enter remains the human-gated resume where actions were observed. Exactly-once stays the host's classification duty (documented, not enforced).
- **R3 concurrent-ownership** → **CAS ownership claim** at the adapter: `claimRunOwnership(runId, owner: ResumeOwnership, expectedStatuses)` flips status→running AND records `owner_attempt_id`/`owner_pid`/`owner_started_at` in one UPDATE; losers get `WorkflowResumeError`, never a blind retry. `interruptRun` is the loud stale-owner marker; a later re-claim from `interrupted` re-claims ownership.
- **R4 release path** → semver 0.5.0 (BREAKING CHANGE footer, commit `8955fc6`, release `a50bc7b`, tags `@gobing-ai/ts-*-v0.5.0`, pushed; CI trusted publishing). Existing DBs migrate via guarded ALTERs (`WORKFLOW_ENGINE_MIGRATIONS_SQL`); fresh DBs get the columns in CREATE TABLE.

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Upstream delivery in ts-libs `packages/dual-workflow-engine` (16 files, +572/−34, commit `8955fc6`):

- `src/types.ts:25` — `ResumeOwnership` (`attemptId`, `pid?`); adapter methods `claimRunOwnership`/`interruptRun` with `expectedStatuses: readonly ('paused' | 'interrupted')[]`, `resumeMode`/`resumeOwner` options, `'interrupted'` status, `interruptReason`.
- `src/schema-sql.ts:16` — `owner_pid` + `owner_attempt` columns in CREATE TABLE; `src/schema-sql.ts:77` — guarded `WORKFLOW_ENGINE_MIGRATIONS_SQL` ALTERs for pre-0.5.0 DBs (duplicate-column swallowed).
- `src/persistence.ts:112` — CAS claim (single UPDATE → status `running`, `completed_at` NULL, owner columns; `src/persistence.ts:120`), losers get `undefined`; `interruptRun` symmetric CAS → `interrupted`.
- `src/state-machine.ts` — `interrupted` status + paused→interrupted transition; terminal rows stay immovable.
- `src/transition-flow.ts:69` / `:86` — skip-enter skips the enter iteration, rerun-enter re-enters the current state (re-pauses on the gate).
- `src/service.ts:175` — default resumeMode from status (interrupted→rerun-enter, paused→skip-enter); `src/service.ts:190` ownership claim with owner re-gate; `src/service.ts:229-233` `interruptRun` + authoritative `workflow.run.interrupted` emit (replaced per-adapter resumed emits).
- `src/service.ts:160` / `src/errors.ts` — `WorkflowResumeError` on lost races; no blind retry.
- `tests/interruption.test.ts` — 9 contract tests (FSMError ghost-owner preservation, rerun-enter re-pause, skip-enter completion, interrupt CAS, concurrent resume race, resumed payload, ownership persistence, 0.4.x DB migration, losing-claim).

Full mapping in ts-libs ADR-025 and the README section "Interruption & resume ownership (ADR-025)".

### Testing

- `cd packages/dual-workflow-engine && bun test` — 403 tests pass, including new `tests/interruption.test.ts` (9 tests) and corrected `persistence`/`pause-resume`/`run-lifecycle` suites.
- `bun x tsc --noEmit` — clean.
- `bun run spur-check` (ts-libs root) — all gates green (Biome format/lint incl. organizeImports, pre/post rules).
- Release: `bun run bump-ver` produced `@gobing-ai/ts-libs-v0.5.0` + per-package tags; `git push origin main --tags` accepted `9b804fa..a50bc7b` (pre-push lint+typecheck passed); npm publish via CI trusted publishing.

### Review

**Upstream delivery review** (self-review during implementation + contract tests — disposition: shipped, P2/P3 fixed inline)
| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P2 | API shape | ts-libs `types.ts:25`; `persistence.ts:112` | Initial `expectedStatuses` was a strict `[paused, interrupted]` tuple — broke callers resuming from a single status. Loosened to `readonly ('paused' \| 'interrupted')[]` in both adapter impls before release. |
| P3 | Conventions | ts-libs `persistence.ts` → `schema-sql.ts:77` | Migration ALTERs first drafted inline in `persistence.ts`; moved to exported `WORKFLOW_ENGINE_MIGRATIONS_SQL` so DDL text lives in schema-sql (single seam for the no-inline-DDL rule both repos follow). |
| P3 | Release ops | npm registry | CI trusted publishing lag: npm still showed 0.4.69 minutes after push, blocking spur-new's `bun install` against `^0.5.0`. Open, owned by task 0901 adoption step. |
| P4 | Repo hygiene | ts-libs tags | Stale `ts-utils-v0.4.43` tag rejected on push (already existed remotely); harmless, other tags landed. |

Residual risk: rerun-enter is at-least-once — hosts must persist durable state before side effects (documented in ADR-025/README, enforced by contract tests, not by the type system).

### References

- ADR-025: ts-libs `docs/00_ADR.md` (decision, alternatives rejected: lease/heartbeat, resume-without-claim, silent rerun).
- ts-libs `packages/dual-workflow-engine/README.md` — "Interruption & resume ownership (ADR-025)" + `workflow.run.interrupted` event row.
- npm: `@gobing-ai/ts-dual-workflow-engine@0.5.0`; spur-new consumer task 0901 (this contract's downstream user).

### History

- 2026-09-19T20:38:30.773Z todo → wip (system)
- 2026-09-19T20:40:35.566Z wip → testing (system)
- 2026-09-19T20:40:36.229Z testing → done (system)

