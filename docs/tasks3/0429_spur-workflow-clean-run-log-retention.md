---
template: feature-impl
schema_version: 1
name: "spur workflow clean run-log retention"
description: ""
status: done
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "cli", "clean", "log", "retention"]
dependencies: ["0426"]
created_at: "2026-08-04T17:25:04.943Z"
updated_at: "2026-08-05T02:13:49.571Z"
---

## 0429. spur workflow clean run-log retention

### Background

Feature D2 — reclamation of retained run logs. Extends the existing `spur workflow clean` housekeeping verb to remove retained `.spur/run/<RUNID>.log` files older than a retention threshold, configurable via a new `workflow.logRetentionDays` config key (default 30 days). Preserves the verb's existing stale-run finalization. Updates its own `spur-cli` workflow reference row (ADR-038 parity).

Implements: R9 — spur workflow clean reclaims retained run logs under a retention policy.

Rubric: E2 D1 L2 C1 R0 = 6 → decompose (child of parent score 14).

### Requirements
- [x] R1. `spur workflow clean` reclaims retained `.spur/run/<RUNID>.log` files older than a retention threshold.
- [x] R2. The retention threshold is configurable via `workflow.logRetentionDays` (default 30 days).
- [x] R3. `--logs` scopes clean to log reclamation only; `--dry-run` lists what would be removed without writing.
- [x] R4. Existing stale-run finalization behavior (`--force`/`--older-than`) is preserved.
- [x] R5. Update the `spur-cli` workflow reference clean signature (ADR-038 parity test must pass).
### Acceptance Criteria
```gherkin
Feature: spur workflow clean run-log retention

  @core
  Scenario: R9 — spur workflow clean reclaims retained run logs under a retention policy
    Given one or more retained RUNID.log files exist in .spur/run
    When the operator runs spur workflow clean
    Then logs exceeding the configured retention policy are removed
    And logs within the retention policy are kept
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
## Approach

Extend the existing `spur workflow clean` housekeeping verb with a **log
reclamation** scope: remove retained `.spur/run/<RUNID>.log` files older than a
configurable retention threshold. Default threshold is **30 days**, keyed as
`workflow.logRetentionDays` in `.spur/config.yaml`. Preserve today's stale-run
finalization behavior (`--older-than` / `--force` / `--dry-run`).

## Chosen design

1. **Config key** — add a top-level `workflow` object to the spur config schema
   (`packages/config`):
   ```ts
   WorkflowConfigSchema = z.object({
     logRetentionDays: z.number().int().positive().default(30),
   })
   ```
   Wire into the root Spur config as `workflow?: WorkflowConfig`. Loader falls
   back to 30 when the key is absent (same degrade-to-defaults pattern as
   `resolveOutputLogConfig` / `agent.output`).
2. **Service API** — extend `WorkflowAppService.clean` (or add a sibling
   `cleanRunLogs`) to:
   - List `.spur/run/*.log` files under the project cwd.
   - Keep files whose mtime is newer than `now - retentionDays`.
   - Delete (or list under dry-run) the rest.
   - Return a structured result `{ reclaimed: [{ runId, path, mtime }], dryRun, retentionDays }`.
   Keep stale-run finalization as a separate concern in the same verb so the
   CLI can compose both in one invocation.
3. **CLI surface** (`workflow clean`)
   - `--logs` — scope to log reclamation only (skip stale-run finalization).
   - Without `--logs`: run **both** scopes (stale-run finalization + log
     reclamation) so a single `spur workflow clean` remains the housekeeping
     one-liner. Document this in the description.
   - Existing `--dry-run` applies to both scopes.
   - Existing `--older-than` / `--force` remain **stale-run only** (minutes /
     force-all-non-terminal); log age uses `workflow.logRetentionDays`, not
     `--older-than`, to avoid unit confusion (minutes vs days).
4. **ADR-038 parity** — same-change spur-cli workflow reference update for
   clean signature + config key note.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| New `spur workflow clean-logs` verb | Operator settled: extend existing `clean`. |
| Reuse `--older-than` (minutes) for log age | Unit mismatch (minutes vs days); retention is a policy, not a one-shot age override. |
| Delete logs on run finalize by default | Contradicts retain-by-default / R6. |
| Glob-delete without mtime check | Would wipe active runs' logs; mtime + retentionDays is the gate. |

## Invariants

- Never delete a log for a still-running run whose file is within the retention
  window; age is the only gate (active runs with old mtimes are rare and
  acceptable under the policy).
- Best-effort deletes: a permission error on one file does not abort the rest;
  report failures in the result / stderr.
- `--dry-run` lists candidates without unlinking.
- Does not touch `.spur/runs/workflow/<RUNID>.jsonl` or `*-partial.md`
  (distinct authorities per design doc).

## Surfaces touched

| Surface | Change |
|---|---|
| `packages/config/src/index.ts` | `WorkflowConfigSchema` + root `workflow` key |
| `packages/app/src/services/workflow-service.ts` | log reclamation in/alongside `clean` |
| `apps/cli/src/commands/workflow.ts` | `--logs`; compose scopes; human/json output |
| tests (config + service + CLI) | retention default, dry-run, --logs-only, preserves stale-run path |
| `plugins/sp/skills/spur-cli/references/workflows.md` | clean signature + config note (ADR-038) |
### Plan
- [x] Add `WorkflowConfigSchema` (`logRetentionDays`, default 30) and root `workflow` key in `packages/config`.
- [x] Implement log reclamation (list `.spur/run/*.log`, filter by mtime vs retention, delete or dry-run list).
- [x] Compose with existing stale-run finalization in `WorkflowAppService.clean` (or sibling + CLI orchestration).
- [x] CLI: add `--logs` (logs-only scope); document dual-scope default; reuse `--dry-run` / `--json`.
- [x] Keep `--older-than` / `--force` as stale-run-only; log age reads config only.
- [x] Tests: default 30d; config override; dry-run lists; `--logs` skips stale finalization; stale path still works.
- [x] Update `plugins/sp/skills/spur-cli/references/workflows.md` clean signature + config key (ADR-038).
- [x] Gate: `bun run lint` + config/service/CLI tests green.
### Solution
Implemented log reclamation in `spur workflow clean` (feature D2 / R9).

- `packages/config/src/index.ts:413` - new `WorkflowConfigSchema` (`logRetentionDays`, int > 0, default 30) + root `workflow` key in `spurConfigSchema` (`:444`); `WorkflowConfig` type; `workflow` added to `SpurAppConfig` Pick.
- `packages/app/src/services/workflow-service.ts:536` - new `cleanRunLogs(retentionDays, dryRun)` sibling of `clean`: lists `.spur/run/*.log`, filters by mtime vs `now - retentionDays`, deletes (or lists under dry-run), best-effort with `failures` reporting; missing run dir is a no-op; never touches `.spur/runs/workflow/` JSONL or partials. New `resolveWorkflowLogRetentionDays(cwd)` (`:901`) degrades to 30 on unreadable/absent config (same pattern as `resolveOutputLogConfig`). New `ReclaimedRunLog` / `RunLogReclamationResult` types.
- `packages/app/src/index.ts` - exports `resolveWorkflowLogRetentionDays`.
- `apps/cli/src/commands/workflow.ts:487-500` - `clean` gains `--logs` (log-reclamation-only scope); without it, runs **both** scopes (stale-run finalization + log reclamation) in one invocation. `--dry-run` applies to both; `--older-than`/`--force` remain stale-run-only (minutes vs days unit split per design). Human output per scope; JSON is additive: `{ olderThanMinutes, dryRun, cleaned, logs: { retentionDays, dryRun, reclaimed, failures } }`, or the reclamation object alone under `--logs`. Per-file removal failures go to stderr.
- Tests - config: schema default/rejection + root key (4 cases). Service: reclaim-old/keep-fresh, dry-run lists without unlinking, missing-dir no-op, non-log files ignored (4); resolver: override/default/unreadable (3). CLI: `--logs` skips stale finalization, `--logs --dry-run` lists without deleting, dual-scope one-liner, `workflow.logRetentionDays` override honored, JSON shape, plus existing clean/--force tests pinned to temp cwds (the verb now scans the real filesystem).
- `plugins/sp/skills/spur-cli/references/workflows.md:95,209,270` - clean row + signature gain `--logs`; new "clean - housekeeping scopes" section documenting dual-scope default, `--logs`, `workflow.logRetentionDays` (days, not minutes), JSON shape, and the `.spur/runs/workflow/` non-touch invariant (ADR-038 parity).
### Testing
**Re-verify results** (2026-08-05T02:13:49Z, `/sp-dev-verifyall --feature D2 --force --fix all`)

- Verdict: PASS
- Fresh tests: config logRetentionDays 2/2; service cleanRunLogs 14 pass; CLI clean scopes in 88/88; parity 14/14.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/workflow-service.ts:545-579`; `packages/app/tests/services/workflow-service.test.ts:1290-1304` |
| R2 | MET | `packages/config/src/index.ts:410-417`; `packages/app/src/services/workflow-service.ts:903-909`; `packages/config/tests/loader.test.ts` retention cases |
| R3 | MET | `apps/cli/src/commands/workflow.ts:487-488,503`; `apps/cli/tests/commands/workflow.test.ts:997,:1019` |
| R4 | MET | `apps/cli/src/commands/workflow.ts:485-486`; dual-scope `apps/cli/tests/commands/workflow.test.ts:1040` |
| R5 | MET | `plugins/sp/skills/spur-cli/references/workflows.md:95,209,260-273`; `apps/cli/tests/spur-cli-parity.test.ts` 14/14 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R9 — clean reclaims under retention | MET | test | `packages/app/tests/services/workflow-service.test.ts:1290`; CLI dual-scope `apps/cli/tests/commands/workflow.test.ts:1040` |

Coverage: N/A.
Fix-pass: Requirements+Plan [x]; scenario-title verdict ids; full-path anchors.
### Review
**Functional review (0429, --auto)**

Requirements traceability - all MET:

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/workflow-service.ts:536` - `cleanRunLogs()` lists `.spur/run/*.log`, deletes mtime < now−retentionDays (best-effort, failures reported); composed into `clean` at `apps/cli/src/commands/workflow.ts:498-500`. Tests: `packages/app/tests/services/workflow-service.test.ts:1290`, `apps/cli/tests/commands/workflow.test.ts:1040` |
| R2 | MET | `packages/config/src/index.ts:413` - `WorkflowConfigSchema.logRetentionDays` int > 0, default 30; root `workflow` key `:444`; resolver `resolveWorkflowLogRetentionDays` `packages/app/src/services/workflow-service.ts:901` degrades to 30. Tests: `packages/config/tests/loader.test.ts:197-215`, `workflow-service.test.ts:1496-1513`, `apps/cli/tests/commands/workflow.test.ts:1058` |
| R3 | MET | `apps/cli/src/commands/workflow.ts:491` - `--logs` option; `logsOnly` skips stale-run finalization (`:497`); `--dry-run` applied to both scopes (`:499-500`); service dry-run lists without unlink (`workflow-service.ts:557`). Tests: `workflow.test.ts:997` (`--logs` skips stale finalization), `:1019` (`--logs --dry-run` lists without deleting; file still exists asserted at `:1037`) |
| R4 | MET | Stale-run path unchanged: `svc.clean(minutes, dryRun)` still runs unless `--logs` (`workflow.ts:498`); `--older-than`/`--force` remain stale-run-only (`:490-492`). Pinned tests green: `workflow.test.ts:956-994`, `:1214-1241` - 85 pass in file |
| R5 | MET | `plugins/sp/skills/spur-cli/references/workflows.md` - clean row + signature gain `--logs` + `workflow.logRetentionDays` note (ADR-038); parity test green `apps/cli/tests/spur-cli-parity.test.ts:204` - 14 pass |

Evidence (run this turn): config loader 56 pass / 0 fail; workflow-service 61 pass / 0 fail; CLI workflow 85 pass / 0 fail; spur-cli parity 14 pass / 0 fail.

Functional Verdict: **PASS**

---

**SECUA review (0429, --auto)**

Design conformance: all chosen-design claims DONE (config key `WorkflowConfigSchema`; sibling `cleanRunLogs` API; `--logs` scope; dual-scope default; `--dry-run` both scopes; `--older-than`/`--force` stale-run-only; ADR-038 reference). No scope creep in the 0429 hunk; working-tree also carries 0427/0428 changes, out of this task's scope.

| Severity | Finding | Evidence |
|----------|---------|----------|
| P1 | - | - |
| P2 | - | - |
| P3 | Misplaced JSDoc: the 0426 doc block ("Resolve per-run consolidated-log bounds … R8") now dangles above `resolveWorkflowLogRetentionDays`; `resolveOutputLogConfig` was left undocumented. 0429 insertion spliced at the wrong point. | `packages/app/src/services/workflow-service.ts:892-909` - doc for 0426 sits on the 0429 resolver; `resolveOutputLogConfig` at `:909` has no doc. Fix: move the 0426 block down to `resolveOutputLogConfig` |
| P4 | Dir-level failure is silent: a `readDir` error on `.spur/run` (e.g. permission denied) is swallowed as a no-op, so the CLI prints "No retained run logs older than 30d." - reads as success. Per-file failures are reported; dir failure is not. | `packages/app/src/services/workflow-service.ts:554-557` - `catch {}` returns empty result; `apps/cli/src/commands/workflow.ts:514` prints the no-op line |

SECUA verdict: PASS (2 findings - 1 minor docs, 1 advisory; neither blocks).

---

**Architecture review (0429, --auto)**

No candidates - all five lenses clean:

| Lens | Result | Evidence |
|------|--------|----------|
| Shallow module | none - `cleanRunLogs` has a real body (list/filter/delete, best-effort failures); `resolveWorkflowLogRetentionDays` follows the existing `resolveOutputLogConfig` degrade-to-defaults seam | `packages/app/src/services/workflow-service.ts:536-576`, `:901-908` |
| Tight coupling | none - CLI composes two independent backends (DB `clean`, FS `cleanRunLogs`); no lockstep change | `apps/cli/src/commands/workflow.ts:497-500` |
| Wrong seam | none - FS via `createNodeFileSystem()` on `ctx.cwd` matches file pattern (`workflow-service.ts:375`); retention resolution stays in service, not CLI | `workflow-service.ts:546` |
| Weak locality | none - schema in config, reclamation in service, flags in CLI, each at its natural layer; `workflow` vs `workflows` key adjacency is deliberate and documented | `packages/config/src/index.ts:413-419`, `workflows.md` clean row |
| Poor test surface | none - core mtime/dry-run logic tested directly on the service with temp dirs; CLI pinned to temp cwds | `packages/app/tests/services/workflow-service.test.ts:1279-1330`, `apps/cli/tests/commands/workflow.test.ts:997-1076` |

Architecture Verdict: **no candidates** (advisory-only dimension; no deepening work proposed).

**Disposition:** APPROVE. No P1/P2; one P3 (minor docs - misplaced JSDoc), one P4 (advisory - silent dir-level failure). Neither blocks.
### References

D2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-04T23:13:19.741Z todo → wip (system)
- 2026-08-04T23:26:58.461Z wip → testing (system)
- 2026-08-04T23:26:58.925Z testing → done (system)
