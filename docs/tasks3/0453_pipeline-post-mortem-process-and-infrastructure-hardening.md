---
template: feature-impl
schema_version: 1
name: "0451 pipeline post-mortem: process and infrastructure hardening"
description: "Fix 6 findings from the 0451 pipeline runs: YAML shell syntax validation, feature reopen lifecycle, verdict parser format, task check error messages, and agent output format mismatches"
status: todo
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P2
tags: ["pipeline", "infrastructure", "process"]
dependencies: []
created_at: "2026-08-05T23:59:00.000Z"
updated_at: "2026-08-05T23:59:00.000Z"
---

## 0453. 0451 pipeline post-mortem: process and infrastructure hardening

### Background

During task 0451 implementation, the pipeline ran 4 times across 3 distinct failure modes, wasting ~26 minutes of agent compute plus operator diagnosis time. All 6 root causes are preventable with targeted fixes.

**Pipeline run timeline:**

| Run ID | Phase | Outcome | Waste | Cause |
|--------|-------|---------|-------|-------|
| 8d19a847 | precheck | FAIL | ~30s | Feature H83 `done` — task check rejected |
| c567bd2d | implement→test | FAIL | 17m 54s | YAML `#` comments in `>-` folded block breaking shell syntax |
| 6dda08de | precheck | FAIL | ~30s | Re-parented but task check still failing |
| 12a3bf2c | →verify/shell | FAIL | 7m 55s | Verify agent `R#` table header not parsed by verdict parser |

**Related companion task:** 0452 residual cleanup (independent — these are new findings from the 0451 pipeline run, not from the code review)

**Authority:** 0451 pipeline run logs (`.spur/run/`), operator session 2026-08-05

### Requirements

**P1 — must fix (blocking pipeline runs)**

- [ ] **R1. Feature done→active reopen lifecycle with auto-reopen support.**

  **Issue (current code).** The feature lifecycle FSM (`.spur/workflows/feature-lifecycle.yaml`) treats `done` as a terminal state with **no outgoing transitions**. When a task references a `done` feature (e.g. 0451→H83), `spur task check` fails the precheck guard and the pipeline stops.

  **Acceptance**
  - `done → active` transition exists in the lifecycle, gated on operator confirmation (interactive) or auto-accepted (`--auto` / `profile=auto`).
  - When `spur task check` encounters a done feature linked to a task being worked on, it should either:
    - (interactive) surface a confirmation question: "Feature X is done. Reopen to `active` to allow this task?"
    - (`--auto`) reopen the feature automatically.
  - The pipeline precheck should detect this case and reopen the feature before the `spur task check` guard runs, rather than failing and requiring operator intervention.

  **Preferred approach:**
  1. Add `done → active` transition to `feature-lifecycle.yaml` with a guard that checks for `--auto` / `profile=auto` (always allow) or interactive (requires confirmation).
  2. In the pipeline precheck, detect `feature_id` pointing to a `done` feature → reopen to `active` (auto if `profile=auto`, else HITL).
  3. The `spur task check` error message should also suggest the reopen command.

  **Primary files:** `.spur/workflows/feature-lifecycle.yaml`, `.spur/workflows/task-pipeline.yaml` (precheck), `packages/app/src/services/task-check.ts` (error message)

---

- [ ] **R2. `spur task verdict` parser must accept `R#` table header.**

  **Issue (current code).** `extractRequirements` in `task-verdict.ts` (~108) checks `h0.includes('req') || h0 === 'requirement'` for the table header column. The verify agent writes `| R# | Severity | Evidence | Status |` which doesn't match either pattern. Result: `UNKNOWN` verdict with 0 requirements.

  **Acceptance**
  - `R#` (case-insensitive) is accepted as a requirement column header.
  - `r\d` patterns (e.g. `R1`, `R2`, `Reqs`) also accepted.
  - Unit test in `task-verdict.test.ts` covers `R#` header parsing.
  - The verify agent's prompt template is updated to use `| Req | Status | Evidence |` as the canonical header (belt-and-suspenders).

  **Primary files:** `packages/app/src/services/task-verdict.ts` (`extractRequirements`), `packages/app/tests/services/task-verdict.test.ts`

---

**P2 — should fix (process hardening)**

- [ ] **R3. Shell syntax validation in `spur workflow validate`.**

  **Issue (current code).** `spur workflow validate` validates YAML structure and schema conformance, but does not extract `command:` strings from `shell` actions and run them through `sh -n` (syntax check). This allowed a syntactically valid YAML file with invalid shell syntax to pass validation — the `#` comments inside `>-` folded blocks broke the `if/else` shell blocks.

  **Acceptance**
  - `spur workflow validate` extracts all `command:` fields under `shell` actions and runs `sh -n` (or equivalent) on each.
  - A shell syntax error in any `command:` field produces a validation error with the file:line of the offending command.
  - The existing `task-pipeline.yaml` passes validation (the `#` comments were already removed in 0451).

  **Primary files:** `packages/app/src/services/workflow-service.ts` or `apps/cli/src/commands/workflow.ts` (validate command)

---

- [ ] **R4. `spur task check` error message for done-feature rejection must be actionable.**

  **Issue (current code).** When `spur task check` rejects a task because its `feature_id` points to a `done` feature, the error message doesn't tell the operator what to do.

  **Acceptance**
  - Error message includes: `task <wbs> references feature <id> which is <status>. Tasks cannot be added to a done feature.`
  - Suggests: `Reopen with: spur feature update <id> active` (or auto-reopen if `--auto`).
  - The suggestion is actionable (copy-paste command).

  **Primary file:** `packages/app/src/services/task-check.ts` (feature lifecycle L4 check, ~605-610)

---

**P3 — docs / debt (clear for task done)**

- [ ] **R5. Verify agent prompt: enforce `| Req | Status | Evidence |` table header.**

  **Issue (current code).** The verify agent's prompt doesn't enforce a specific markdown table header format for the per-requirement traceability table. The review agent happened to use `Req` (parsable), but the verify agent used `R#` (not parsable before R2 fix).

  **Acceptance**
  - The verify agent's skill/prompt explicitly states: "Write the per-requirement traceability table with header `| Req | Status | Evidence |`."
  - The `sp:code-verification` / `sp:functional-review` skill instructions include this format requirement.

  **Primary files:** `plugins/sp/agents/*/verify*.md` or `plugins/sp/skills/*/verification*.md` (verify agent prompt)

---

- [ ] **R6. Implement agent: enforce `file:line` backtick citations in Solution section.**

  **Issue (current code).** The implement agent writes the Solution section in prose format (`packages/app/src/...ts: line — description`), but `spur task check` L3 validation requires backtick-delimited `file:line` citations (`` `path:line` ``).

  **Acceptance**
  - The implement agent's prompt explicitly states: "Write Solution citations as backtick-delimited `path:line` (e.g. `` `src/foo.ts:42` ``)."
  - The `sp:code-implementation` skill instructions include this format requirement.
  - `spur task record --solution-from-diff` is the primary mechanism; agent-written sections are supplementary.

  **Primary files:** `plugins/sp/skills/code-implementation/SKILL.md` or agent prompt

**Explicitly out of scope (do not implement here)**
- Full YAML `shell` command static analysis (linting)
- `spur workflow run` --dry-run shell syntax check (validate is sufficient)
- Changing the default `R#` to `Req` in the verify agent's output — that's R5 (prompt change)

### Acceptance Criteria
```gherkin
Feature: 0451 pipeline post-mortem hardening

  @core
  Scenario: R1 — feature done→active reopen
    Given feature H83 is done and task 0451 references H83
    When the pipeline precheck runs with profile=auto
    Then H83 is automatically reopened to active
    And task check passes without error
    And when profile is not auto, a confirmation is raised before reopening

  @core
  Scenario: R2 — verdict parser accepts R# header
    Given a verify answer file with table header | R# | Status | Evidence |
    When spur task verdict --from-answer parses it
    Then requirements are extracted with correct IDs and statuses
    And the verdict is not UNKNOWN

  @core
  Scenario: R3 — YAML shell syntax validation
    Given a workflow YAML with a shell command containing sh syntax errors
    When spur workflow validate runs
    Then it reports a validation error citing the file and line
    And the error explains the shell syntax issue

  @core
  Scenario: R4 — actionable done-feature error message
    Given a task with feature_id pointing to a done feature
    When spur task check runs
    Then the error message includes the feature ID, status, and a reopen command suggestion

  @core
  Scenario: R5 — verify agent uses canonical header
    Given the verify agent is invoked
    When it produces a per-requirement traceability table
    Then the header is | Req | Status | Evidence |

  @core
  Scenario: R6 — implement agent uses backtick file:line citations
    Given the implement agent writes the Solution section
    When the section contains file references
    Then they are in backtick `path:line` format
```

### Design

## Approach

Implement **P1 first** (R1–R2) — these directly block pipeline runs. Then P2 (R3–R4) — process hardening. Then P3 (R5–R6) — prompt/docs.

---

## R1 — Feature done→active reopen

| Piece | Location | Change |
|-------|----------|--------|
| `done → active` transition | `.spur/workflows/feature-lifecycle.yaml` | Add `from: done, to: active` with `guard: always` — external lifecycle transition (requestTransition), not auto-advance. Same pattern as `verifying → active` rework. |
| Pipeline precheck | `.spur/workflows/task-pipeline.yaml` precheck state | After doctor PASS but before `spur task check`, add a shell step that checks `feature_id` against `spur feature show` status. If `done`, run `spur feature update <id> active` (when `profile=auto`) or emit a HITL prompt. |
| Task check error message | `packages/app/src/services/task-check.ts` | Improve the L4 finding for missing/bad feature_id to include the reopen command. |

**Note:** The `done → active` transition is a lifecycle change (design §2.3). The feature-lifecycle YAML already has `verifying → active` as always-allowed — `done → active` follows the same pattern.

---

## R2 — Verdict parser R# header

```ts
// In extractRequirements, widen the header check:
const h0 = (cells[0] ?? '').toLowerCase();
const h1 = (cells[1] ?? '').toLowerCase();
const isReqHeader = h0.includes('req') || h0 === 'requirement' || /^r\d*$/.test(h0) || h0 === 'r#';
if (isReqHeader && (h1.includes('status') || h1 === 'verdict')) {
    inTable = true;
    continue;
}
```

---

## R3 — Shell syntax validation

```ts
// In workflow validate, after schema validation:
for each state/node with onEnter/onExit/action:
    if action.kind === 'shell' and action.options.command:
        try execSync(`sh -n -c ${JSON.stringify(command)}`, { stdio: 'pipe' })
        catch → add validation error with file:line
```

---

## R4 — Actionable error message

Update the L4 finding at `task-check.ts` ~605:

```ts
message: `Feature "${featureId}" is ${featureStatus} — tasks cannot reference a done feature. `
    + `Reopen with: spur feature update ${featureId} active, or use --auto on the pipeline to auto-reopen.`,
```

---

## R5–R6 — Agent prompt changes

Surgical edits to agent skill/description files:
- `sp:code-verification` / `sp:functional-review`: Add `| Req | Status | Evidence |` table header to the output format spec.
- `sp:code-implementation`: Add backtick `path:line` citation format requirement.

---

## Touch map

| File | Why |
|------|-----|
| `.spur/workflows/feature-lifecycle.yaml` | R1: `done → active` transition |
| `.spur/workflows/task-pipeline.yaml` | R1: precheck auto-reopen step |
| `packages/app/src/services/task-check.ts` | R1, R4: error message |
| `packages/app/src/services/task-verdict.ts` | R2: header detection |
| `packages/app/tests/services/task-verdict.test.ts` | R2: R# header test |
| `packages/app/src/services/workflow-service.ts` / `apps/cli/src/commands/workflow.ts` | R3: sh -n validation |
| `plugins/sp/skills/code-verification/SKILL.md` (or verify agent) | R5: table header format |
| `plugins/sp/skills/code-implementation/SKILL.md` (or implement agent) | R6: file:line citation format |

### Plan
- [ ] R1: Add `done → active` lifecycle transition; pipeline precheck auto-reopen; task check error message
- [ ] R2: Widen verdict parser header detection; add `R#` test
- [ ] R3: Add `sh -n` shell syntax check to `spur workflow validate`
- [ ] R4: Improve `spur task check` done-feature rejection message
- [ ] R5: Verify agent prompt: enforce `| Req | Status | Evidence |` header
- [ ] R6: Implement agent prompt: enforce backtick `file:line` citations
- [ ] Gate: targeted tests green, then `bun run autofix && bun run spur-check`

### Solution

<!-- Filled during implementation -->

### Testing

<!-- Filled during verification -->

### Review

<!-- Filled during review -->

### References
- Pipeline run logs: `.spur/run/8d19a847*.log`, `.spur/run/c567bd2d*.log`, `.spur/run/6dda08de*.log`, `.spur/run/12a3bf2c*.log`
- Pipeline YAML: `.spur/workflows/task-pipeline.yaml` (test/recheck shell commands — comments removed in 0451)
- Verdict parser: `packages/app/src/services/task-verdict.ts` (`extractRequirements` ~108)
- Feature lifecycle: `.spur/workflows/feature-lifecycle.yaml` (no `done → active` transition)
- Task check: `packages/app/src/services/task-check.ts` (~605 feature_id L4 finding)
- Code verification skill: `plugins/sp/skills/` verify agent
- Code implementation skill: `plugins/sp/skills/` implement agent