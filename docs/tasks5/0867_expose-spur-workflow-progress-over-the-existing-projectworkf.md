---
schema_version: 1
name: Expose spur workflow progress over the existing projectWorkflowProgress projection
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.223Z
updated_at: "2026-09-17T17:19:24.853Z"
feature_id: D62
priority: P1
tags:
  - workflow
  - cli
  - observability

---

## 0867. Expose spur workflow progress over the existing projectWorkflowProgress projection

### Background

packages/app/src/workflow/progress-projection.ts (506 lines) exports projectWorkflowProgress and is tested, but has zero CLI consumers — the projection that would answer "where is this run" is unreachable from the terminal. This is the cheapest half of ADR-117: wiring, not building.

### Requirements

- [x] R1. `spur workflow progress <run-id> --json` returns the projectWorkflowProgress projection for that run.
- [x] R2. The output names the current state, each action's attempts, and the next candidate transitions.
- [x] R3. The command adds no projection logic beyond rendering — all derivation stays in packages/app.
- [x] R4. A running or incomplete run exits without error and marks missing data as unknown.
- [x] R5. An unknown run id produces a named error rather than an empty success.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R3 — A progress read surface exposes the existing projection
    Given a workflow run id with recorded states, actions and transitions
    When the operator runs "spur workflow progress <run-id> --json"
    Then the output is the projectWorkflowProgress projection for that run
    And it names the current state, each action's attempts, and the next candidate transitions
    And the command adds no new projection logic beyond rendering

  @edge
  Scenario: R11 — The progress surface degrades gracefully on an unknown or incomplete run
    Given a run id that is unknown, still running, or missing action rows
    When the operator runs "spur workflow progress <run-id> --json"
    Then the command exits without error for a running or incomplete run and marks the missing data as unknown
    And an unknown run id produces a named error rather than an empty success
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

apps/cli is a thin transport (ADR-021): the command resolves the run id, calls projectWorkflowProgress, and renders. No new projection, no new query shape. Human output is a rendering of the same projection object, never a second derivation path. Adding a verb under the existing `workflow` noun needs operator consent per the public-surface governance rule — that consent is recorded in feature D62's scope, so no further gate blocks this task.

### Plan

1. Read progress-projection.ts's exported shape and its existing tests.
2. Add the `progress` verb to apps/cli/src/commands/workflow.ts, --json and human rendering.
3. Handle unknown-run and incomplete-run paths per R4/R5.
4. Add CLI tests in apps/cli/tests covering a complete run, an incomplete run, and an unknown id.
5. Update docs/design/cli-contracts.md and docs/help/cmd_workflow.md.

### Solution

Wiring only: `spur workflow progress <run-id>` exposes the projection that already existed — `packages/app` is untouched (R3).

**Change map**

- `apps/cli/src/commands/workflow.ts:1382-1414` — `progress` verb under the existing `workflow` noun. Resolves the adapter (`context.getDb()`), calls `projectWorkflowProgress(runId, { db, projectRoot: context.cwd })`, renders. The one decision the CLI owns is R5's not-found branch, read off the projection's own `orphan-row` diagnostic — no extra query, no re-derivation.
- `apps/cli/src/commands/workflow.ts:1463-1523` — `formatWorkflowProgress`: human rendering of the same object (status, current state, definition identity, each state's actions with their attempts, candidate next transitions, diagnostics). Unanswered values print as `unknown` (R4); the formatter derives nothing.
- `apps/cli/src/commands/workflow.ts:14,33` — imports `projectWorkflowProgress` and `WorkflowProgressProjection` from the `@gobing-ai/spur-app` barrel (`packages/app/src/index.ts:755`).
- `apps/cli/tests/commands/workflow.test.ts:2592-2770` — four CLI tests: complete run (R1/R3: `--json` deep-equals a direct `projectWorkflowProgress` call apart from `projectedAt`), running run (R2/R4: exit 0, attempts + `mid → done` next transition, `unknown` for unanswered values), incomplete run with an unresolvable definition (R4: exit 0, `States: none recorded` + `definition-unavailable`), unknown run id (R5: exit 1, plain stderr + structured `NOT_FOUND` under `--json-envelope`).
- `apps/cli/tests/json-envelope-inventory.test.ts:278-284` — the 0699 R1 census pin `66 → 67` plus its count-history comment; the one production-adjacent file the **test-fix** stage changed (review finding #1 backfill).
- `docs/tasks5/0867_expose-spur-workflow-progress-over-the-existing-projectworkf.md` — this task file (§Solution/§Testing backfilled in `record`).
- Docs + parity: `docs/help/cmd_workflow.md:276`, `docs/help2/workflow.md:124`, `docs/design/cli-contracts.md:590`, `docs/04_DESIGN.md:152`, `plugins/sp/skills/spur-cli/references/workflows.md:116,266`, `apps/cli/tests/spur-cli-parity.test.ts:38`.

**Notes**

- R1/R2/R4 come from the projection's existing contract: `--json` emits it verbatim, and a running or incomplete run already reports `unknown`/`pending`/diagnostics rather than failing. The CLI adds only the R5 not-found decision, so an unknown run id stops reading as the projection's empty `unknown` success.
- Human output is a rendering of the same projection object, never a second derivation path.
- Verb-consent: recorded in feature D62's scope (`spur workflow progress` read surface); `plugins/sp/skills/spur-cli/references/workflows.md` and the parity test inventory were updated in the same change so the live/docs verb sets stay equal.
- Not in this WBS: `--follow`/streaming over `followWorkflowProgress` (the other half of ADR-117).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/workflow.ts:1382-1414` registers `workflow progress <run-id>` with `--json` and emits `projectWorkflowProgress(runId, { db, projectRoot })` verbatim; test `apps/cli/tests/commands/workflow.test.ts:2628` deep-equals the `--json` payload against a direct projection call; fresh command this run: `workflow progress smoke-0867 --json` → exit 0, `{schemaVersion:1, runId:"smoke-0867", workflow:"progress-flow", status:"completed", currentState:"done", ...}` |
| R2 | MET | `apps/cli/src/commands/workflow.ts:1463-1523` (`formatWorkflowProgress`) renders `currentState`, each `states[].actions[].attempts[]`, and `nextTransitions[]` from the projection object; test `apps/cli/tests/commands/workflow.test.ts:2670` asserts `currentState:'mid'`, attempt `{actionRunId:'ar-1', status:'running', durationMs:null}` and the `mid → done [blocked]` next transition; fresh command this run printed `Current state: done` plus per-attempt lines `attempt <id>: done ok=yes 0ms` |
| R3 | MET | `git diff --stat` shows zero `packages/**` paths — all derivation stays in `packages/app/src/workflow/progress-projection.ts`; the verb body is a single call at `apps/cli/src/commands/workflow.ts:1393-1396` plus rendering; test `apps/cli/tests/commands/workflow.test.ts:2628` asserts the CLI payload equals the projection apart from `projectedAt` |
| R4 | MET | `apps/cli/src/commands/workflow.ts:1494-1503` renders unanswered values as `unknown` (`durationMs === null ? 'unknown'`, `attempt.ok === null ? 'unknown'`); test `apps/cli/tests/commands/workflow.test.ts:2670` (running run: exit 0, `definitionDigest:null`, `definition-digest-missing`, `durationMs:null`) and `apps/cli/tests/commands/workflow.test.ts:2721` (unresolvable definition: exit 0, `Current state: unknown`, `States: none recorded`, `definition-unavailable`); fresh command this run: complete run exit 0 with no fabricated values |
| R5 | MET | `apps/cli/src/commands/workflow.ts:1398-1402` routes the projection's `orphan-row` diagnostic through `writeJsonError(..., 'NOT_FOUND')` + `setExitCode(1)`; test `apps/cli/tests/commands/workflow.test.ts:2741` asserts exit 1, empty stdout, plain + `--json-envelope` `{ok:false, error:{code:'NOT_FOUND'}}`; fresh command this run: `workflow progress nope` → exit 1, stderr `Run nope not found.`, `--json --json-envelope` → `{"ok":false,"error":{"code":"NOT_FOUND","message":"Run nope not found."}}` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — A progress read surface exposes the existing projection | MET | test | `apps/cli/tests/commands/workflow.test.ts:2628` (`--json` equals a direct `projectWorkflowProgress` call modulo `projectedAt`; names current state, per-action attempts, next transitions); `packages/**` absent from `git diff --stat`; fresh scratch-project command this run: `workflow progress smoke-0867 --json` exit 0 emitting the projection |
| Scenario: R11 — The progress surface degrades gracefully on an unknown or incomplete run | MET | test | `apps/cli/tests/commands/workflow.test.ts:2670` (running run exits 0, gaps `unknown`/`null`) and `apps/cli/tests/commands/workflow.test.ts:2741` (unknown id exits 1 with named `NOT_FOUND`, never an empty success); fresh scratch-project command this run: unknown id → exit 1 `Run nope not found.` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0867 (pass 1)

**Scope:** worktree diff vs base `308acf61d` — 10 files, +374/−11: the `progress` verb + human formatter in `apps/cli/src/commands/workflow.ts` (2 hunks), 4 new CLI tests in `apps/cli/tests/commands/workflow.test.ts`, 3 inventory/parity test touch-ups, 5 doc surfaces, and the task file itself. `packages/**` is untouched, which is the point (R3).
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — 0 P1, 0 P2, 1 P3 (minor), 3 P4 (advisory); no finding blocks the P1/P2 gate
**Independence:** reviewer session separate from implement; implementation context reached this stage only via the persisted task spec, the recorded diff and the run artifacts.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
| --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness | The Solution change map describes 8 files; the reviewed diff is 10. `apps/cli/tests/json-envelope-inventory.test.ts` — the 0699 R1 census pin `66 → 67` plus its count-history comment, the one production-adjacent file the **test-fix** stage changed — is absent from the map, and the task file itself is not counted either. The map therefore understates the task's own change exactly as 0866 finding #3 did for its remediation file. Not a gate failure (no checker compares the map to the diff); fix in the `record` stage backfill or by hand. | `apps/cli/tests/json-envelope-inventory.test.ts:278-284` vs `docs/tasks5/0867_…md` §Solution / §Change map |
| 2 | P4 (advisory) | usability | The D62 design SSOT still carries the present-tense claim that `projectWorkflowProgress` has "no CLI consumer today" — this task falsifies it. The doc is marked `Status: proposed (feature D62)`, so re-scoping is legitimately deferred to the feature-completion doc pass; flagged here so that pass does not miss it. | `docs/design/workflow-execution-economy.md:87` |
| 3 | P4 (advisory) | architecture | The CLI derives "unknown run" by string-matching the projection's own `orphan-row` diagnostic code. The choice is deliberate and documented (task §Design: no extra query, no re-derivation), is covered by a test, and cannot misfire — `orphan-row` is pushed only on the `traceRowById` miss, and `traceRowById` (`run-dao.ts:112`) is an unfiltered `WHERE id = ?`, so a real row never produces it. The residual is coupling: `apps/cli` now depends on one member of the projection's diagnostic union as a control-flow signal. An explicit existence field would decouple it; not worth doing at this size. | `apps/cli/src/commands/workflow.ts:1398-1402`; `packages/app/src/workflow/progress-projection.ts:166-171` |
| 4 | P4 (advisory) | correctness | The census doc-comment above the pin still reads "the static census over **all 69**" while the pin is 67 (and was 66 before this change — so the number was already stale, and this diff narrowed the gap from 3 to 2). The diff edits the same describe block, so it is a one-word fix in a touched file. | `apps/cli/tests/json-envelope-inventory.test.ts:128` |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `spur workflow progress <run-id> --json` emits the projection. Test `R1/R3` deep-equals the CLI payload against a direct `projectWorkflowProgress` call apart from `projectedAt`, and independently re-derived this stage in a scratch project: `--json` returned `{schemaVersion:1, runId:'smoke-complete', workflow:'progress-flow', status:'completed', currentState:'done', transitions:['start->mid','mid->done'], …}`. |
| R2 | MET | The `--json` payload names `currentState`, each `state.actions[].attempts[]` (`actionRunId`, status, `ok`, started/completed, `durationMs`) and `nextTransitions[]` with eligibility; the human formatter renders the same three. Verified both ways this stage: human output printed `Current state: done`, `start:onEnter:0 [note] — passed` + `attempt <id>: done ok=yes 0ms`, and `mid → done [blocked] — mid passed` on the running fixture. |
| R3 | MET | `packages/**` is untouched by the diff. The verb body is one `projectWorkflowProgress(runId, { db, projectRoot: context.cwd })` call plus rendering; the only decision `apps/cli` owns is R5's not-found branch, read off a diagnostic the projection already computed. The human path calls the same object through `formatWorkflowProgress`, which contains no derivation. |
| R4 | MET | Running run: exit 0, `definitionDigest: null` + `definition-digest-missing`, attempt `{status:'running', durationMs:null, completedAt:null}`, human prints `Definition: version unknown · digest unknown` and `ok=unknown`. Unresolvable-definition run: exit 0, `Current state: unknown`, `States: none recorded`, `definition-unavailable`. Both reproduced by the recorded tests and by the fresh gate run. |
| R5 | MET | Unknown id: the projection returns its `orphan-row` early-exit, the verb routes it through `writeJsonError(..., 'NOT_FOUND')` and `setExitCode(1)` — stdout empty, stderr `Run <id> not found.`; under `--json --json-envelope` the machine consumer gets `{ok:false, error:{code:'NOT_FOUND'}}` and still exit 1. Re-derived this stage: `workflow progress nope` → `Run nope not found.`, exit 1. |

##### Acceptance criteria

| Scenario | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R3 — a progress read surface exposes the existing projection | MET | executed + recorded | New verb in `workflow --help`; `--json` byte-identical to a direct projection call modulo `projectedAt` (recorded test + independent scratch-project re-derivation); names current state, per-action attempts and candidate next transitions; `packages/**` unmodified in the diff |
| R11 — the progress surface degrades gracefully on an unknown or incomplete run | MET | executed | Running and unresolvable-definition runs exit 0 and mark unanswered values `unknown`/`null`; unknown id exits 1 with a named `NOT_FOUND`, never an empty success (three recorded test cases plus a fresh smoke run) |

##### Verification evidence (fresh this stage)

| Command | Result |
| --- | --- |
| `.spur/run/0867-test-gate.status` / `.log` (test-recheck, written 17:18Z, ~4 s before review entry) | `PASS`; `8317 pass / 0 fail`, `33941 expect() calls`, 470 files; post-check rule run `All 2 rules passed — no violations found` |
| `cd apps/cli && bun test tests/commands/workflow.test.ts` | `135 pass / 0 fail` — the four D62 cases (`R1/R3`, `R2/R4`, `R4`, `R5`) all pass |
| `cd apps/cli && bun test tests/spur-cli-parity.test.ts tests/json-envelope-inventory.test.ts tests/help-doc-parity.test.ts tests/shared-option-parity.test.ts` | `22 pass / 0 fail` — the `progress` row is in the skill reference, the envelope census pin is 67, the help-doc flag parity holds for the new section |
| Scratch-project end-to-end (`mktemp -d`; `workflow run --run-id smoke-complete` then `workflow progress smoke-complete` / `--json` / `nope`) | human + JSON render the projection as specified; `nope` → exit 1, `Run nope not found.` — independent of the recorded tests |
| `bun apps/cli/src/index.ts task check 0867 --json` | `pass: true`, 0 findings, 0 missing required sections |
| `bun apps/cli/src/index.ts workflow --help` / `workflow progress --help` | verb registered with `--json` + `--json-envelope`; description matches the docs |
| coverage line in the gate log for `apps/cli/src/commands/workflow.ts` | `99.76% lines`; uncovered lines `229, 847-848` only — every added line (verb 1382-1414, formatter 1463-1523) is executed |
| `git status --porcelain` vs `.spur/run/0867-pre-review-snapshot.txt` | identical 10-entry set; `git diff --cached` empty; no untracked files |

##### Coverage / honest-loss audit

- No production path loses coverage: `packages/**` is unmodified, and the CLI additions are exercised end-to-end by the four new tests (complete run, running run, incomplete run, unknown id), covering both the `--json` and human branches of the verb and all four formatter branches (`states.length === 0`, `actions.length === 0`, non-empty next transitions, diagnostics).
- The `--json-envelope` failure path is asserted directly (`doc.ok === false`, `error.code === 'NOT_FOUND'`), not inferred from the raw-stderr case.
- Behavioural risk outside tests: none found. The verb is read-only; it issues no query the projection did not already issue; `writeJsonError` normalizes non-string messages before touching string methods, so the error emitter cannot throw while reporting an error.

##### Reviewer mutation statement

No source file was touched by this stage. The reviewed diff is the implement + test-fix stages' diff; the only write this stage makes is the `## Review` section via `spur task update --section`, which the proof-input fingerprint excludes from the certified input set (`packages/app/src/workflow/proof-input-fingerprint.ts:311` scopes task content to Background / Requirements / Acceptance Criteria / Design / Plan).

**Next:** approve → `/sp:dev-verify 0867`.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T17:07:06.108Z todo → wip (system)
- 2026-09-16T17:37:31.283Z wip → testing (system)
- 2026-09-16T17:37:33.173Z testing → done (system)

