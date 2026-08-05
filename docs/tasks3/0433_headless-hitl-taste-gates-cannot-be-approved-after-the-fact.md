---
template: issue
schema_version: 1
name: "Headless HITL taste gates cannot be approved after the fact"
description: ""
status: done
type: issue
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-04T17:26:20.903Z"
updated_at: "2026-08-05T06:54:06.825Z"
---

## 0433. Headless HITL taste gates cannot be approved after the fact

### Background
A HITL taste gate cannot be approved from a non-interactive session once the
run has already paused. Headless `hitl.confirm` answers immediately with the
default (`no`, unless `SPUR_HITL_AUTO_APPROVE=1`), persists that value into
`__hitlAnswer`, and only then pauses. `spur workflow continue` restores the
persisted vars and re-evaluates guards — it never re-asks, and `--yes` only
skips the CLI's own "resume this run?" prompt, not the gate answer.

Live repro 2026-08-04: run `ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef`
(`idea-pipeline`, idea-eval) paused after a 0s headless confirm; operator
approved the report; `spur workflow continue … --yes` still took the
`__hitlAnswer=no` edge to `cancelled`. The design-approval `no → system-design`
edge makes the same pattern an agent-time loop if continue is repeated without
an injectable answer.

Feature D3 defect (workflow run reliability). Independent of the schema and
shell defects under the same feature.
### Requirements
- [x] R1. `spur workflow continue <run-id> --answer yes|no|cancel` writes the answer into the run's effective vars as `__hitlAnswer` (or the gate's configured `var`) **before** resume re-evaluates guards.
- [x] R2. Resume with `--answer yes` takes the gate's approve edge without any launch-time `idea_approved` / `design_approved` pre-clear.
- [x] R3. `--yes` remains CLI-only (skip "resume this run?" prompt) and must **not** imply a HITL gate answer.
- [x] R4. Answering one gate must not pre-clear later gates: `--answer` applies only to the current resume's vars merge; later `hitl.confirm` onEnter still runs for its own decision (R6).
- [x] R5. `no` and `cancel` remain separately expressible on the resume path and route to the edges their guards name (rejection parity).
- [x] R6. A design-approval rejection must not burn unbounded unattended agent passes: after an explicit `no`, the run either pauses for a fresh decision that does not silently re-apply a stale headless default, or terminates naming the rejected gate (R7).
- [x] R7. Regression tests cover the continue/answer merge and the design-gate loop break at the shared resume + HITL mechanism, not only idea-pipeline YAML.
- [x] R8. ADR-038: same-change update of the `sp:spur-cli` workflow reference for `continue --answer`.
### Acceptance Criteria
```gherkin
Feature: Headless HITL taste gates are answerable after pausing

  @core
  Scenario: R5 — a paused taste gate is answerable without relaunching
    Given a headless workflow run paused at a hitl.confirm gate with a persisted no answer
    When the operator resumes the run with an explicit approval
    Then the gate's approve edge is taken
    And no launch-time approval var was required

  @core
  Scenario: R6 — answering one gate never implies another
    Given a headless run containing more than one taste gate
    When the operator approves the first gate
    Then the later gate still pauses for its own decision

  @core
  Scenario: R7 — a rejected design gate cannot loop unattended
    Given a headless run whose design-approval gate is answered no
    When the run re-enters system-design and returns to the gate
    Then it does not re-consume the same stale answer indefinitely
    And it either pauses for a fresh decision or terminates naming the rejected gate

  @core
  Scenario: R8 — each defect is covered at the shared mechanism
    Given the three fixes are implemented
    When the test suite runs
    Then each defect has a regression test against schema loading, the shell action, or the HITL resume path
    And no defect relies solely on a test of the single workflow file where it was observed
```

**Rejection parity (not a scenario):** `no` and `cancel` must remain separately expressible on the
resume path and must route down the edges their guards name.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
## Approach

Two cooperating fixes: (1) let the operator inject a gate answer on resume;
(2) stop the design-approval reject path from burning unbounded headless
agent passes. Prefer app/CLI seams already present — do not invent a new verb.

## Chosen design

**1. `continue --answer` (primary — R5/R6)**

Engine `resumeRun` already merges `options.vars` over the persisted
`effectiveVars` snapshot (ts-dual-workflow-engine `service.ts:167-173`,
"caller overrides win"). Wire that through:

| Layer | Change |
|---|---|
| CLI | `.option('--answer <yes\|no\|cancel>', …)` on `workflow continue`; validate enum; exit 2 on bad value |
| CLI | Pass `{ __hitlAnswer: answer }` into the service when set |
| App | `continuePaused(runId, opts?: { hitlAnswer?: 'yes'\|'no'\|'cancel'; hitlVar?: string })` → `resumeRun(…, { vars: { [var]: answer } })` |
| Docs | Clarify `--yes` ≠ gate answer (already true; keep the wording) |

Default `hitlVar` is `__hitlAnswer` (matches `hitl.confirm` / `hitl.select` default).
Gates that set a custom `var` can be a follow-up if needed; idea-pipeline uses the default.

Resume skips onEnter (engine driver resume path). Injecting `__hitlAnswer` on
continue is therefore enough for the *current* paused gate — guards re-evaluate
with the override. Later gates still execute their own onEnter confirm when first
entered (R6).

**2. Design-approval loop break (R7)**

Problem: `design-approval --[no]→ system-design → design-approval` re-runs
`hitl.confirm` onEnter; headless `DefaultHitlResponder` writes `no` again
before pause; each `continue` without `--answer` burns another design-agent
pass.

Preferred (pipeline-local, minimal): cap revises in
`.spur/workflows/idea-pipeline.yaml`:

- On `design-approval → system-design` (`no`): require
  `design_reject_count < 1` (or configurable max), and increment the counter
  via a small onExit/onEnter shell or a dedicated step.
- When the cap is exceeded: transition to `cancelled` (or `failed`) with a
  note naming `design-approval` as the rejected gate — not another
  `system-design` hop.

Interactive operators who need more revises can re-run the pipeline or raise
the cap later; v1 default max = 1 revise after the first `no`.

Rejected for v1: changing global `DefaultHitlResponder` to leave answers
empty (would change every headless confirm in the product). The continue
`--answer` path is the intentional headless approval channel; the cap is the
safety net.

**3. Non-goals**

- Do not repurpose `SPUR_HITL_AUTO_APPROVE` or launch-time `*_approved` vars as
  the post-pause channel (task Requirements forbid that).
- Do not add `spur workflow answer` as a separate verb — extend `continue`.
- Do not re-run `hitl.confirm` on resume (engine already skips onEnter).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `--yes` sets `__hitlAnswer=yes` | Breaks documented meaning; overloads two concerns |
| New `workflow answer` verb | Extra surface; continue is already the resume verb |
| Always auto-skip design-approval under profile=auto | Defeats the taste gate; `design_approved` already covers pre-clear |
| Infinite revise loop with only docs | Violates R7 |

## Invariants

- One `--answer` affects one resume; later gates re-ask via their onEnter.
- `no` and `cancel` stay distinct on the wire and in guards.
- TTY interactive path (`ClackHitlResponder`) unchanged.
### Plan
- [x] Confirm engine contract: `resumeRun` merges `options.vars` over snapshot `effectiveVars`; resume skips onEnter.
- [x] Extend `WorkflowAppService.continuePaused` to accept an optional HITL answer and pass `vars: { __hitlAnswer }` into `resumeRun`.
- [x] CLI: add `--answer <yes|no|cancel>` on `workflow continue`; validate enum; document that `--yes` does not set the gate answer.
- [x] Wire CLI → service; cover missing/invalid `--answer` (exit 2).
- [x] idea-pipeline: cap `design-approval → system-design` revises (default max 1); over-cap → cancelled/failed naming the gate.
- [x] Tests: paused headless run + continue `--answer yes` takes approve edge; `--answer no` / `cancel` route correctly; second design reject terminates; later gate still pauses (no bleed).
- [x] Update `plugins/sp/skills/spur-cli/references/workflows.md` continue signature (ADR-038).
- [x] Gate: service HITL suite (6 pass) + CLI `--answer` suite (4 pass) green this verify run.
### Root Cause
Reproduced live on 2026-08-04 in a headless (non-TTY) session.

Run `ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef` (`idea-pipeline.yaml`, `profile=auto`,
`idea_approved=false`) reached the `idea-eval` taste gate and paused as designed:

```
▶ idea-eval [running]
→ idea-eval/hitl.confirm · timeout=unbounded
✓ idea-eval/hitl.confirm (0s)
▶ idea-eval [paused]
workflow paused: idea-pipeline -> idea-eval
```

Note the confirm completed in 0s *before* the pause — the headless responder had already written
`no`. The operator then reviewed the evaluation report and approved. Resuming:

```
$ spur workflow continue ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef --yes
workflow failed: idea-pipeline -> cancelled
```

The run cancelled despite an explicit human approval, because `continue` evaluated the persisted
`__hitlAnswer=no` against the guard `test "${vars.__hitlAnswer}" = yes`
(`.spur/workflows/idea-pipeline.yaml`, `from: idea-eval`). `--yes` only skips the CLI's own resume
confirmation.

The `design-approval` loop was not executed to exhaustion — its edge
`from: design-approval → to: system-design` guarded on `__hitlAnswer = no` makes the cycle
self-evident from the definition, and running it would have burned repeated ~5-minute design-agent
passes.

Workaround used to complete the session: relaunch from scratch with `idea_approved=true` and
`design_approved=true` so both gates take their auto-skip edges. That discards the run's prior work
(discovery re-ran) and pre-answers a gate rather than answering it.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:429` |
| `apps/cli/src/commands/workflow.ts:436` |
| `apps/cli/src/commands/workflow.ts:464` |
| `apps/cli/src/commands/workflow.ts:473` |
| `apps/cli/src/commands/workflow.ts:479` |
| `apps/cli/tests/commands/workflow.test.ts:284` |
| `packages/app/src/services/workflow-service.ts:416` |
| `packages/app/src/services/workflow-service.ts:442` |
| `packages/app/src/services/workflow-service.ts:452` |
| `packages/app/src/services/workflow-service.ts:476` |
| `packages/app/src/services/workflow-service.ts:490` |
| `packages/app/src/services/workflow-service.ts:497` |
| `packages/app/src/services/workflow-service.ts:500` |
| `packages/app/src/services/workflow-service.ts:646` |
| `packages/app/src/services/workflow-service.ts:653` |
| `packages/app/src/services/workflow-service.ts:655` |
| `packages/app/src/services/workflow-service.ts:667` |
| `packages/app/src/services/workflow-service.ts:675` |
| `packages/app/src/services/workflow-service.ts:683` |
| `packages/app/tests/services/workflow-service.test.ts:283` |
| `packages/app/tests/services/workflow-service.test.ts:795` |
### Testing
**Force re-verify** 2026-08-04 (`/sp-dev-verify 0433 --auto --next --force --focus all --fix all`)

**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | CLI `--answer` enum validated (`apps/cli/src/commands/workflow.ts:429-445`, exit 2 on bad value); `continuePaused` injects `{ [hitlVar]: answer }` into `resumeRun` before guards (`packages/app/src/services/workflow-service.ts:678-688`). Service test R1/R5 yes-override (`packages/app/tests/services/workflow-service.test.ts:875-890`). |
| R2 | MET | Taste-gate fixtures never set `idea_approved`/`design_approved`; `hitlAnswer=yes` alone reaches `approved` (service `:875-890`; CLI `continue --answer yes` test). |
| R3 | MET | `--yes` only skips resume confirm; comment + branch at `apps/cli/src/commands/workflow.ts:428,463-465`. CLI test `continue --answer does not imply --yes` (`apps/cli/tests/commands/workflow.test.ts:393+`) — `--answer yes` without `--yes`/run-id still prompts and aborts. |
| R4 | MET | Two-gate service test: first approve → pause at gate2 (`packages/app/tests/services/workflow-service.test.ts:917-983`). |
| R5 | MET | `hitlAnswer=no` → `cancelled` (`:893-901`); `hitlAnswer=cancel` → `cancelled` via dedicated cancel guard (`:904-914`, YAML cancel edge `:849-854`). CLI enum accepts yes/no/cancel. |
| R6 | MET | idea-pipeline reject counter + cap: onEnter increment (`.spur/workflows/idea-pipeline.yaml:229-233`); `no→system-design` when count≤1 (`:470-476`); over-cap `no→failed` naming design-approval (`:477-483`). Mechanism test R6/R7 (`packages/app/tests/services/workflow-service.test.ts:998-1080`). |
| R7 | MET | Shared-mechanism suites: 6 service HITL tests + 4 CLI `--answer` tests; reject-cap YAML is not idea-pipeline. |
| R8 | MET | ADR-038 docs: continue table (`plugins/sp/skills/spur-cli/references/workflows.md:93`), command surface (`:207`), HITL `--answer` vs `--yes` paragraph (`:256-260`). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R5 — a paused taste gate is answerable without relaunching | MET | test | `bun test packages/app/tests/services/workflow-service.test.ts -t "continue - HITL"` — R1/R5 yes-override; CLI `--answer yes` → approved. |
| R6 — answering one gate never implies another | MET | test | R4 two-gate test pauses at gate2 after first approve (`packages/app/tests/services/workflow-service.test.ts:917-983`). |
| R7 — a rejected design gate cannot loop unattended | MET | test | R6/R7 reject-cap: 2nd reject → `failed` (`packages/app/tests/services/workflow-service.test.ts:998-1080`); idea-pipeline edges `:470-483`. |
| R8 — each defect is covered at the shared mechanism | MET | test | HITL resume mechanism tests (not idea-pipeline-only); D3 siblings 0431/0432 covered elsewhere. |
| Rejection parity: no and cancel expressible | MET | test | Separate service tests for no and cancel edges; both `finalState=cancelled`. |

**Command evidence (this run)**

```
$ bun test packages/app/tests/services/workflow-service.test.ts -t "continue - HITL"
6 pass, 0 fail, exit 0

$ bun test apps/cli/tests/commands/workflow.test.ts -t "continue --answer"
4 pass, 0 fail, exit 0
```

**Design conformance**

| Claim | Status | Evidence |
|-------|--------|----------|
| `continue --answer` CLI + service inject before resume | DONE | apps/cli/src/commands/workflow.ts:429-480; packages/app/src/services/workflow-service.ts:658-688 |
| `--yes` ≠ gate answer | DONE | apps/cli/src/commands/workflow.ts:428,464; CLI R3 test |
| Design-approval revise cap max 1 then fail naming gate | DONE | idea-pipeline.yaml:217-233,470-483 |
| Mechanism-level tests (not only idea-pipeline) | DONE | packages/app/tests/services/workflow-service.test.ts:812-1080 |
| Out of scope: DefaultHitlResponder global change | N/A | Intentionally not changed |

**Checks**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | All in-scope claims DONE |
| evidence-rule-pass | pass | Core AC rows backed by test/command |
| tests-pass | pass | 6+4 targeted tests exit 0 this run |
| cli-golden-path-present | pass | CLI `--answer yes|no|invalid|no-yes-bleed` tests |
| scope-creep | pass | Deliverable matches Design (continue --answer + reject cap + docs) |

**Coverage:** N/A for full-suite %; targeted regression executed this run.

**Fix-pass artifacts:**
- `.spur/run/0433-verdict.json` rewritten with feature-aligned AC `id`s (prior empty `acceptanceCriteria` blocked D3 L4 for R5–R7)
- Cancel edge added to taste-gate fixture for true R5 cancel routing (`packages/app/tests/services/workflow-service.test.ts:849-854,904-914`)
- Requirements/Plan checklists completed; Review P1–P4 table
### Review
**SECUA review** (standalone verify --force) — aggregate: PASS

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | — | — | None |
| P2 | — | — | None |
| P3 | U | `apps/cli/src/commands/workflow.ts:428-431` | Operators must discover `--answer` is distinct from `--yes`; mitigated by option help text + spur-cli docs (`workflows.md:256-260`). |
| P4 | C | `packages/app/src/services/workflow-service.ts:678-688` | Resume injects HITL answer via engine vars merge (caller wins); headless default no longer sticky across continue with `--answer`. |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-05T03:57:55.517Z todo → wip (system)
- 2026-08-05T05:51:43.963Z wip → testing (system)
- 2026-08-05T05:51:53.344Z testing → done (system)
