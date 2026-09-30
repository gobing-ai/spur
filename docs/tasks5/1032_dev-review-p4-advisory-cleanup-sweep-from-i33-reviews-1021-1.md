---
schema_version: 1
name: Dev-review P4 advisory cleanup sweep from I33 reviews (1021-1023)
status: done
template: feature-impl
created_at: 2026-09-30T21:56:23.251Z
updated_at: "2026-09-30T22:13:37.648Z"
feature_id: I33

ac_altitude: task-local
---

## 1032. Dev-review P4 advisory cleanup sweep from I33 reviews (1021-1023)

### Background

I33 dev-review reviews (2026-09-30, tasks 1021–1023) deferred nine P4 advisories as non-blocking. The three P3s were fixed inline in commit `f86aa20de`; these P4s remain and must be dispositioned before I33 ships.

### Requirements

## Background

I33 dev-review reviews (2026-09-30, tasks 1021–1023) deferred nine P4 advisories as non-blocking. The three P3s were fixed inline in commit `f86aa20de`; these P4s remain. Finding texts recovered from session transcript `2026-09-30T18-17-02-838Z_01a0f388-….jsonl` (pipeline Review sections carry verify-step records only).

## Requirements

From 1021 review (code-verification scope recipe):
- R1: `code-verification/SKILL.md:105` — `--grep` matches the full commit message body, not just the subject; body task-id mentions over-include. Prescribed: restrict to subject (`git log --format='%h %s' --grep …`) or document the residual explicitly inline.
- R2: `SKILL.md:107,114` — task-file exclusion assumes cwd = repo root. Prescribed: `${TASK_FILE#$(git rev-parse --show-toplevel)/}`.
- R3: `SKILL.md:114-118` — uncovered edge: tagged commit exists but touches only the task file → empty scope. Prescribed: one sentence naming the degradation (explicitly empty Scope via grep -vxF exit 1) so empty reads as specified, not broken.

From 1022 review (contract hygiene):
- R4: `dev-review.md:18` restates the full `--focus` vocabulary inline next to the SSOT link — silent-drift risk. Prescribed: link-only, or extend `command-flag-parity.test.ts` to pin vocabulary equality.
- R5: R5 `--fix` test slices on `## Mode: review`/`---` heading anchors. Prescribed: stable marker or assert both markers exist before slicing.

From 1023 review (selector surface):
- R6: Positional-only examples survive in 4 cross-referencing docs — migrate to `--tasks` selector form before any alias removal: `code-verification/SKILL.md:39`, `next-router/references/routing-table.md:134`, `spur-dev/references/execution-workflow.md:50`, `spur-dev/references/gate-checklists.md:158`.
- R7: `sys-architecture/SKILL.md:76` characterizes `/sp:dev-review` as per-task DIFF review — refresh to cover task sets and advisory `--scope` path review.
- R8: Specify both unspecified selector edges in the dev-review grammar: (a) `--scope apps,apps/cli` nesting-merge direction; (b) trailing positional beside `--tasks` → error or absorbed. Assert in the command contract test.

#### AC-1: All nine P4 advisories dispositioned
- G/R: For each of R1–R8 (R6 = four files), each carries the fix or an explicit documented residual-risk note in place, with file:line traceability to this task.

#### AC-2: No behavior change beyond docs/contract text
- G/R: Existing section-scoped contract tests pass unchanged, or are updated only where a test pins the changed text (R4/R8).

#### Verification

- Docs/contract text only. `bun run lint` + affected workspace typecheck; `command-flag-parity.test.ts` when R4/R8 touched; grep sweep for remaining stale restatements after.

#### Reference

- Reviews: tasks 1021–1023 (2026-09-30); owner feature I33 (done); P3 siblings fixed in `f86aa20de` (verdict-schema.md:30; functional-review SKILL.md 271/295; code-improvement SKILL.md:190; execution-batch.md Step 1)
- Transcript: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-09-30T18-17-02-838Z_01a0f388-c876-7519-9482-a58ecc2ca979.jsonl`

### Acceptance Criteria

#### AC-1: All nine P4 advisories dispositioned
- G/R: For each of R1–R8 (R6 counts as four files), when addressed, then each either carries the fix or an explicit documented residual-risk note in place, with file:line traceability to this task.

#### AC-2: No behavior change beyond docs/contract text
- G/R: Existing section-scoped tests (command/skill contract tests) pass unchanged or are updated only where a test pins the changed text.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Fix, not residual note, for all eight.** Every item is a one-line doc/test edit; documenting a residual would cost as much text as the fix.
- **R1 subject-only match:** `git log --format='%H %s' | grep -F "(<wbs>)" | cut -d' ' -f1` — `grep -F` keeps fixed-string semantics; `%s` is subject only. Rejected: `--grep` + post-filter (two passes).
- **R2 root anchor:** `ROOT=$(git rev-parse --show-toplevel)`; exclude `${TASK_FILE#$ROOT/}`. `spur task show` returns an absolute path, so this is cwd-independent.
- **R3:** same visible fallback as "no tagged commit" — one bullet, no new mechanism.
- **R5:** slice with `/^## Mode: review[^\n]*\n/m` up to the next `/^## /m`; `expect(section.length).toBeGreaterThan(0)` makes a moved heading fail loud.
- **R8:** ancestor-wins merge matches "nested/duplicate paths collapse" (a child is already covered by its ancestor); positional + selector is rejected, consistent with R1 of 1023 (exactly one target kind).
- **Tests:** one `task 1032` describe block in `plugins/sp/tests/command-flag-parity.test.ts`, written first (red), no new file.
- **Invariant:** no behavior change beyond contract text (AC-2).

### Plan

1. Add `task 1032` tests (R1–R4, R6–R8) and harden the 1022 R5 slice in `plugins/sp/tests/command-flag-parity.test.ts`; run → red.
2. `plugins/sp/skills/code-verification/SKILL.md` Step 3 recipe (R1/R2) + edge bullet (R3) + mode-table example (R6).
3. `plugins/sp/commands/dev-review.md` `--focus` row link-only (R4); `--scope` row and selector validation edges (R8).
4. R6 migrations: routing-table, execution-workflow, gate-checklists; R7 sys-architecture paragraph.
5. `(cd plugins/sp && bun test tests/command-flag-parity.test.ts tests/skill-structure.test.ts)` green; `bun run spur-check`.

**Verification checks (evidence for the AC above):**

- [x] Each of R1–R8 has a fix with `file:line` in Solution.
- [x] `command-flag-parity.test.ts` + `skill-structure.test.ts` pass; only tests pinning changed text were updated.
- [x] Executed R1/R2 recipe for WBS 1020 from a subdirectory still returns bbef13522's 4 files.

### Solution

All eight advisories fixed (no residual notes). Tests written first: `plugins/sp/tests/command-flag-parity.test.ts:444` (`task 1032` block) went 7 red → green.

| Req | Change (`file:line`) |
|-----|----------------------|
| R1 | Subject-only match `git log --format='%H %s' \| grep -F "(<wbs>)"` — `plugins/sp/skills/code-verification/SKILL.md:109` |
| R2 | `ROOT=$(git rev-parse --show-toplevel)`; `spur task show` runs in `$ROOT` (it resolves the corpus from cwd — found while executing the recipe from `apps/cli`); exclusion `${TASK_FILE#$ROOT/}` — `plugins/sp/skills/code-verification/SKILL.md:107-111` |
| R3 | Empty-scope degradation bullet (no tagged commit, or tagged commits touch only the task file) — `plugins/sp/skills/code-verification/SKILL.md:118` |
| R4 | `--focus` row link-only — `plugins/sp/commands/dev-review.md:21` |
| R5 | Anchored-heading slice + non-empty assertion — `plugins/sp/tests/command-flag-parity.test.ts:338-342` |
| R6 | `--tasks <wbs>` migrations — `plugins/sp/skills/code-verification/SKILL.md:39`, `plugins/sp/skills/next-router/references/routing-table.md:134`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:50`, `plugins/sp/skills/spur-dev/references/gate-checklists.md:158`, plus `docs/design/e2e-workflow-for-system-development.md:192` (found by sweep); 1022 R5 routing pin updated |
| R7 | Task-set + advisory `--scope` wording — `plugins/sp/skills/sys-architecture/SKILL.md:76` |
| R8 | Ancestor-collapse (`--scope apps,apps/cli` → `apps`) — `plugins/sp/commands/dev-review.md:18,46`, `plugins/sp/skills/spur-dev/references/dev-operations.md:120`; positional beside a selector → exit 2 — `plugins/sp/commands/dev-review.md:42` |

Deviation: `code-verification/SKILL.md` body budget (skill-structure R44, baseline 33959 B) — additions offset by trimming three redundant phrases in Step 3/3p; baseline not raised.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/code-verification/SKILL.md:109` subject-only `git log --format='%H %s' \| grep -F`; test `plugins/sp/tests/command-flag-parity.test.ts:450` pass; executed for WBS 1020 → only bbef13522 |
| R2 | MET | `plugins/sp/skills/code-verification/SKILL.md:107-111` ROOT anchor + `spur task show` in `$ROOT`; executed from `apps/cli` → bbef13522's 4 files, task file excluded; test `plugins/sp/tests/command-flag-parity.test.ts:450` pass |
| R3 | MET | `plugins/sp/skills/code-verification/SKILL.md:118` empty-scope degradation bullet; test `plugins/sp/tests/command-flag-parity.test.ts:459` pass |
| R4 | MET | `plugins/sp/commands/dev-review.md:21` link-only `--focus` row; test `plugins/sp/tests/command-flag-parity.test.ts:463` pass |
| R5 | MET | `plugins/sp/tests/command-flag-parity.test.ts:338-342` anchored slice + non-empty assertion, pass |
| R6 | MET | `plugins/sp/skills/code-verification/SKILL.md:39`, `plugins/sp/skills/next-router/references/routing-table.md:134`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:50`, `plugins/sp/skills/spur-dev/references/gate-checklists.md:158`, `docs/design/e2e-workflow-for-system-development.md:192` use `--tasks <wbs>`; test `plugins/sp/tests/command-flag-parity.test.ts:469` pass |
| R7 | MET | `plugins/sp/skills/sys-architecture/SKILL.md:76` task set + advisory `--scope`; test `plugins/sp/tests/command-flag-parity.test.ts:479` pass |
| R8 | MET | `plugins/sp/commands/dev-review.md:18` and `plugins/sp/commands/dev-review.md:46` ancestor collapse, `plugins/sp/commands/dev-review.md:42` positional+selector exit 2, `plugins/sp/skills/spur-dev/references/dev-operations.md:120`; test `plugins/sp/tests/command-flag-parity.test.ts:486` pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1: All nine P4 advisories dispositioned | MET | test | all of R1–R8 fixed (none deferred) with `file:line` in Solution; `(cd plugins/sp && bun test tests/command-flag-parity.test.ts tests/skill-structure.test.ts)` → 196 pass / 0 fail |
| AC-2: No behavior change beyond docs/contract text | MET | test | diff touches only `.md` docs and `plugins/sp/tests/command-flag-parity.test.ts`; only the 1022 R5 test changed (routing pin + slice, both pinning changed text); `(cd plugins/sp && bun test tests/)` → 848 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-30T22:05:28.289Z backlog → todo (system)
- 2026-09-30T22:05:28.495Z todo → wip (system)
- 2026-09-30T22:10:03.311Z wip → testing (system)
- 2026-09-30T22:10:13.714Z testing → done (system)

