---
schema_version: 1
name: Harden batch execution against the G65 failure modes
status: todo
template: issue
created_at: 2026-09-15T20:37:23.908Z
updated_at: "2026-09-15T20:39:22.307Z"
feature_id: D6

---

## 0862. Harden batch execution against the G65 failure modes

### Background

Session-review triage of the G65 batch (2026-09-15). Six tasks shipped and landed on `main` (`26d0df827`), but the
batch cost **6:49:31 of agent-active time** for roughly 2:00 of certified work, and three of its checks
were blind to defects that independent review and verify later caught. This task owns the harness
defects that produced both halves of that bill. It is the single triage task for that session review;
the per-task product findings it is not the owner of are listed as pointers at the end.

**Where the time went** (`.spur/run/worktree-runall-g65-ac87-batch-report.md`):

- **1:45 lost to three killed implement dispatches** — 0858 timed out twice and 0860 once at the
  30-minute host limit, each with a half-migrated tree that then needed host completion.
- **1:37 to three remediation hops** — 0857's constant-rendered member model, 0860's dropped `teamId`
  wire key, 0861's stale help-diagram node: all invisible to a green gate.
- **~0:56 to twelve quality-gate runs** plus three host diagnostics.
- The enabler: `task-size-precheck.ts` reported `PASS — 0 R-items, 0 Plan items` for 0858, a task with
  seven `- **R1** — …` requirements and a five-step Plan, so the gate that exists to force a
  reviewer-tier executor or a split never fired.

**Already resolved by the session-review direct fixes (commit `0afd1405f`)** — not in scope here:
the C5 documentation half (the `ac-style-guide` rule that a single-line `- **ACn — …**` criterion
declares no id, and that at least one answer row must carry the verbatim feature scenario title) and
the C10 documentation half (the inline driver's delegate-hygiene paragraph). The review's carried
*documentation* findings are also closed there: the nonexistent `ts-ai-runner` `MessageService` chain,
the `spur status` help label, the event-tracking producer anchor, the `team:<id>` docstring,
`materializeTeam` comments, and 0861's survivor count.

**Pointers, not owned here** (recorded so they are not lost; each needs its own owner decision):
G65 cannot advance to `done` because 0857's verdict rows match no feature scenario and no
`docs/dogfood/` artifact exists; the carried product findings are the fleet snapshot's `enabled`
misreporting a declared-but-unresolvable roster (0858), the strategy default silently downgrading a
persisted `gtd` row and a non-atomic reconcile (0859), `getStatus()`'s zero callers and the dead Board
Team column (0860), and the untested `task.` activity prefix (0860).

**Feature scenarios graduated:** D6 `R1` (cost measured per pipeline), `R3` (a pipeline over budget
fails visibly), `R9` (findings remain actionable and truthful). The remaining criteria are task-local
harness fixes, which is why they are checklist rows rather than Gherkin scenarios.

**Evidence:** `.spur/run/worktree-runall-g65-ac87-{batch-report.md,verdicts/,reviews/}`;
`.spur/run/runall-g65-*-ac87.log` (dispatch boundaries and host-fallback provenance).

### Requirements

- **R1** — Count this corpus's requirement and Plan forms. `task-size-precheck.ts` must recognize
  `- **R1** — …` bullets in `### Requirements` and numbered items in `### Plan`, so a task with
  more than `maxImplementReqs` requirements or `maxImplementPlanItems` plan items fails the precheck
  (naming the executor tier it needs) instead of reporting `0 R-items`. Evidence: the precheck's
  `PASS — 0 R-items, 0 Plan items` on 0858 (seven requirements) and 0860 (five).
- **R2** — Make the dispatch budget an admission fact, not a discovery. The precheck (or the driver's
  Run setup) must estimate whether one `implement` dispatch can finish the task — workspace/file span
  plus requirement count — and route an over-budget task to a split or a reviewer-tier executor,
  with the estimate recorded in the run log. The `--worktree` / task-pipeline docs must state the
  30-minute host dispatch ceiling. Evidence: three killed dispatches, each losing a full 30:00.
- **R3** — Classify a coverage-threshold failure as a finding. When the project gate exits non-zero
  with `0 fail` and a per-file coverage shortfall, `quality-gate.ts` must write a findings entry
  naming the sub-threshold file and its measured values, so the fix hop receives a finding rather
  than an empty file. Evidence: 0856's `.spur/run/0856-test-gate.findings` was 0 bytes while the log
  showed `addressed-spec-ids.ts | 83.33 | 50.00`.
- **R4** — Normalize evidence anchors at record time. `spur task record` must write repo-relative
  `file:line` citations (or resolve short ones) instead of copying bare basenames from the verdict,
  which currently surface as `L4 Testing: Stale line anchor` on every recorded task. Evidence:
  `loader.ts:337`, `serve.ts:620`, `serve.ts:692`, `roster.ts:92` across 0857/0858/0860.
- **R5** — Enforce the AC-id rule mechanically. The corpus checker (or the verify-answer lint) must
  report a criterion that declares no machine-readable id — a single-line `- **ACn — …** Given …`
  bullet — and must warn when a task's answer carries no row keyed to a feature scenario it
  graduates, which is how 0857's verdict lost traceability. Evidence: 0857/0860 lint findings.
- **R6** — Gate refinement on the feature strict preflight. `dev-refine` / `dev-refineall` must run
  the feature-scoped strict check before reporting a refined set as ready, so an admission gate
  cannot be defeated by an earlier pass that never ran it. Evidence: the 2026-09-14 refineall
  reported `verdict clean` over the eight orphaned scenarios that aborted this batch.
- **R7** — Check derived surfaces. A rule must compare a mermaid block's declared node ids against
  its referenced ids (and flag retired names used as labels), because a stale `TeamSvc` edge shipped
  in `docs/help/index.md` where no checker could see it.
- **R8** — Detect invoking-tree divergence. A `--worktree` batch must detect that its base ref moved
  during the run — at task boundaries, not only at the terminal merge — and report it, so the
  merge-on-success promise never degrades silently into an operator decision. Evidence: `main`
  advanced twice mid-batch (`8a06c3ba1`, `beaf96090`) and the fast-forward failed.
- **R9** — Give the inline driver a first-class proof surface. `proof.fingerprint` and `run.artifact`
  are engine built-ins with no CLI surface (ADR-051), so the inline driver reproduced the digest
  through a gitignored scratch script importing `computeProofInputFingerprint`. Ship it as a
  repo-only `plugins/sp/scripts` entry the driver calls, mirroring `inline-run-setup.ts` (0804).
- **R10** — Surface delegate debris at the batch boundary. The batch report must list worktrees and
  scratch paths a dispatched stage left behind, so an 867 MB `/private/tmp` worktree is a reported
  fact rather than a manual discovery (the driver-side documentation half is already committed).
- **R11** — Make the anchor check tolerant of resolvable short paths. A citation whose basename
  resolves uniquely inside the repo must not read as a stale anchor; report only genuinely
  unresolvable or ambiguous ones. Evidence: repeated `L4.anchor-subject-mismatch` /
  `L4.stale-line-anchor` warnings on correct citations.
- **R12** — Put the wire-shape standard on the review path. Reviews of route/response changes must
  require a server-side assertion on the response key shape and at least one test that feeds the
  real payload into the real client parser — the missing check behind 0860's P1, where 8329 green
  tests coexisted with a hung Processes tab because fixtures carried the old key.

### Acceptance Criteria

Graduates D6 scenarios R1, R3 and R9 — the Gherkin below carries their exact feature titles; the table
under it is the task-local verify lens, one row per requirement (the verdict's requirement rows carry
the same ids).

```gherkin
  Scenario: R1 — Model-query cost and wall-clock are measured per pipeline
    Given the shipped pipelines carry agent.run hops whose cost has only ever been bounded as "not increasing"
    When the cost baseline is captured
    Then each pipeline records its model-query count and wall-clock against a named fixture set
    And the measurement is reproducible from a source-local command, not a hand-timed run
    And the numbers are committed as a checked budget rather than a prose claim

  Scenario: R3 — A pipeline exceeding its cost budget fails visibly
    Given a committed per-pipeline query and wall-clock budget
    When a change pushes a pipeline past its budget
    Then the gate fails naming the pipeline, the budget, and the measured value
    And the budget can only be raised by an explicit recorded decision, never silently

  Scenario: R9 — Findings remain actionable and truthful
    Given the current workflow definitions and D8 D9 D61 obligations
    When the audit is recorded
    Then simple repairs carry fresh checks and larger repairs have scoped tasks
    And delivery projections distinguish shipped work from newly discovered gaps
```

| Req | Acceptance | Verification |
| --- | --- | --- |
| R1 | The size precheck counts `- **Rn** — …` requirements and numbered Plan items | fixture task with 7 requirements fails the precheck naming the executor tier |
| R2 | An over-budget task is routed to a split or reviewer-tier executor before implement | Run-setup estimate recorded in the run log; `--worktree` docs name the dispatch ceiling |
| R3 | A per-file coverage shortfall becomes a finding, not a red gate with `0 fail` | gate run over a sub-threshold file yields a non-empty findings file naming it |
| R4 | Recorded `## Testing` citations are repo-relative | `task record` on a fixture verdict; `task check --as done` reports no stale-anchor warning |
| R5 | A criterion with no machine-readable id, and an answer with no scenario-keyed row, each report | fixture task + fixture answer produce the two named findings |
| R6 | Refine/refineall runs the feature strict preflight before reporting a set ready | fixture feature with an orphaned scenario is not reported ready |
| R7 | A mermaid reference that dangles or names a retired service fails the new rule | fixture doc with a `TeamSvc` edge fails; the committed corpus passes |
| R8 | A base-ref move during a `--worktree` batch is reported at the task boundary | driver boundary check records the moved ref in the run log and batch report |
| R9 | The inline driver computes the proof digest through a repo-only script, no scratch file | the script reproduces `computeProofInputFingerprint`'s digest for a fixture task |
| R10 | The batch report lists leftover worktrees and scratch paths | report field populated from a run that leaves a worktree |
| R11 | A uniquely resolvable basename is not reported stale; an unresolvable one still reports | fixture corpus with both citation forms |
| R12 | The review path requires a response key-shape assertion and a real-payload parser test | review contract text + fixture route change carrying both |

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Placement, one owner per defect — no new subsystem:

| Defect | Owner surface |
| --- | --- |
| R1 size counting, R11 anchor tolerance | the existing checkers (`plugins/sp/scripts/task-size-precheck.ts`, the anchor check in the corpus checker) |
| R3 coverage classification | `plugins/sp/scripts/quality-gate.ts` findings contract |
| R2 dispatch budget | precheck/Run-setup estimate + `spur-dev` references (task-pipeline vars, `--worktree` flag) |
| R4 anchor normalization | the record path in `packages/app` (task record), not the verifier's evidence text |
| R5 AC-id enforcement, R7 mermaid ids | the rule catalog (`spur rule`), so both are gate-visible rather than prose-only |
| R6 strict preflight, R12 wire-shape standard | `dev-refine*`'s exit gate and the review path contract |
| R8 divergence detection, R10 debris report | the batch driver contract (`execution-batch.md`), implemented in the driver's boundary checks |
| R9 proof fingerprint | a repo-only `plugins/sp/scripts` entry, mirroring `inline-run-setup.ts` (0804) |

Two invariants bound every item: **no gate is weakened to pass** (a threshold may only move through an
explicit recorded decision), and **each fix carries its own fixture** so the defect cannot return
silently. Items are independently shippable — R1 and R3 alone recover the largest share of the G65
batch's lost time, so they are first rather than bundled with the rest.

### Plan

Repair the shared counting/keying surfaces first, then add the missing checks. Every fix lands with a
fixture that fails before it and passes after; none may raise or lower a threshold, and none may
weaken an existing gate to go green.

1. **R1 + R3 — make the two silent surfaces speak.** Teach `task-size-precheck.ts` the corpus's
   `- **Rn** — …` / numbered-Plan forms (fixture: a task with 7 requirements must fail, naming the
   executor tier); teach `quality-gate.ts` to classify a zero-fail non-zero exit with a per-file
   coverage shortfall into a findings entry naming the file and its measured values (fixture: a
   sub-threshold file must produce a non-empty findings file).
2. **R2 — budget at admission.** Derive an estimate (requirements × workspaces touched) in the
   precheck or the driver's Run setup, route over-budget tasks to a split or reviewer-tier executor,
   and record the estimate plus the host dispatch ceiling in the run log and the `--worktree` /
   task-pipeline docs.
3. **R4 + R11 — normalize and tolerate anchors.** Normalize evidence citations to repo-relative paths
   at record time; make the anchor check resolve a unique basename instead of reporting it stale, and
   keep reporting genuinely unresolvable or ambiguous anchors.
4. **R5 + R6 — enforce what the docs now state.** Check for a criterion that declares no
   machine-readable id, and for an answer with no row keyed to a graduated feature scenario; run the
   feature strict preflight as refine/refineall's exit gate.
5. **R7 + R12 — close the two blind spots.** Add the mermaid declared-vs-referenced id rule (and
   retired-name labels), and put the wire-shape requirement on the review path with a server-side
   key-shape assertion convention.
6. **R8 — watch the base ref.** Detect base-ref movement at each task boundary of a `--worktree`
   batch and report it in the batch report, leaving the terminal merge decision to the operator.
7. **R9 + R10 — own the inline surfaces.** Ship the proof-fingerprint script as a repo-only
   `plugins/sp/scripts` entry (mirroring `inline-run-setup.ts`) and list leftover worktrees/scratch
   paths in the batch report.
8. **Gates.** `bun run spur-check`, the affected plugin tests, and a dry-run of the new fixtures.

### Root Cause

The batch pipeline's admission and evidence checks validate *shape* — a task file exists, a gate exited
zero, a verdict artifact says PASS — but not the conditions that make the work completable or the
evidence traceable. So:

1. **Two counters read zero.** `task-size-precheck.ts` matches a requirement form this corpus does not
   use (`- **Rn** — …`), so its count is always 0 and the size gate can never fire. The same class of
   blindness makes the gate blind to mermaid ids and to the dispatch budget: nothing counts the thing
   that actually decides the outcome (requirement mass, workspaces touched, rendered surfaces).
2. **A failing gate can be silent.** `bun test` exits 1 for a per-file coverage shortfall while
   printing `0 fail`, and `quality-gate.ts` derives its findings file only from rule output — so the
   fix hop is handed an empty findings file and has to rediscover the cause from a coverage table.
3. **Provenance is copied, not normalized.** The verdict artifact holds the verifier's evidence
   strings verbatim (short basenames, whole bullet lines as ids); record and the feature gate then
   read those same strings as identifiers and citations, and both fail on forms no author was told
   to avoid.
4. **The driver adapts around missing surfaces instead of owning them.** The engine-only action kinds
   have no inline execution surface, so the driver invents a scratch script; delegate debris lands
   outside the tree and is noticed only by hand.

Each defect is independently fixable and independently shippable. The ordering in Plan reflects
blast radius: the counting and classification fixes (R1–R3) remove the largest share of the batch's
cost, the keying fixes (R4, R5, R11) remove the recurring warning noise and restore traceability, and
the checker additions (R6–R8, R12) close the blind spots that let three defects reach a green gate.
No fix may lower a threshold, delete a check, or waive a gate to go green.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
