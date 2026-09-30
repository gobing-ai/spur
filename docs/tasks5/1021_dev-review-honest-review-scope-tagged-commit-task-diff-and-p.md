---
schema_version: 1
name: "dev-review honest review scope: tagged-commit task diff and path-mode SECUA scope"
status: done
template: feature-impl
created_at: 2026-09-30T18:12:18.446Z
updated_at: "2026-09-30T19:11:33.598Z"
feature_id: I33

ac_numbering: task-local
---

## 1021. dev-review honest review scope: tagged-commit task diff and path-mode SECUA scope

### Background

Every `/sp:dev-review` WBS-mode component derives the task's change scope from `sp:code-verification` Step 3 (`plugins/sp/skills/code-verification/SKILL.md:101-106`; `functional-review` Step 3 and `code-improvement` Step 1 defer to it). That recipe takes the **last** commit touching the task file and diffs `${COMMIT}~1..HEAD` filtered to `*.ts/*.tsx/*.js/*.jsx`.

Observed on task 1020: the last task-file commit is `a7ef9ba83 docs(tasks): updat tasks after verification`, the derived scope is 1 file, and implementation commit `bbef13522 … (1020)` (5 files incl. `config/workflows/task-pipeline.yaml` and two test files) is missed. Any commit after the anchor — other tasks' work — leaks in. The extension filter also drops `.md`/`.yaml`, which is most harness work in this repo.

Path mode is worse: `/sp:dev-review <path>` dispatches `code-verification` review mode, which "Runs Steps 3 + 7" (`SKILL.md:484-486`), but Step 3 requires a WBS. No step turns a path into a review scope, so the SECUA leg improvises.

This task is a prerequisite for multi-target review (1023): scope derivation must be right before it is fanned out.

### Requirements

- **R1** — WBS-mode change scope is the union of files changed by the task's implementation commits, identified by the `(<wbs>)` subject tag (`git log --format=%H --grep='(<wbs>)' --fixed-strings`), excluding commits that only touch the task file itself. Fallback when no tagged commit exists: the working-tree diff (`git status --porcelain`), stated explicitly in the review Scope line. No file-extension filter; generated/lock files (`*.generated.mjs`, `bun.lock`) may be excluded by name with the exclusion stated.
- **R2** — `sp:code-verification` review mode gains an explicit path-scope step: a path target resolves to the tracked files under it (`git ls-files -- <path>`), with the file count reported in the Scope line; review mode no longer claims to run Step 3 for a path target.
- **R3** — `sp:functional-review` Step 3, `sp:code-improvement` Step 1 and `sp:super-reviewer` Rules keep deferring to the single scope recipe (no restated copies); the recipe is the SSOT.

### Acceptance Criteria

```gherkin
  @core
  Scenario: R1 — task diff scope names the implementation commits
    Given a done task whose implementation commit subject carries "(<wbs>)" and whose task file was touched by a later docs-only commit
    When a WBS-mode review derives its change scope
    Then the scope contains every file changed by the tagged implementation commits, including .md and .yaml files
    And excludes files changed only by unrelated later commits

  @core
  Scenario: R2 — path-mode SECUA review has a defined scope
    Given /sp:dev-review is invoked with a path target
    When sp:code-verification review mode runs
    Then it derives its scope from the path per a documented step instead of a task WBS
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Chosen:** keep scope derivation as skill prose built from `git` + `spur task show` (no new public `spur` verb — out of scope per I33). Rewrite `code-verification` Step 3 as the SSOT:
  ```bash
  TASK_FILE=$(spur task show <wbs> --json | jq -r .filePath)
  COMMITS=$(git log --format=%H --fixed-strings --grep="(<wbs>)")
  for c in $COMMITS; do git diff-tree --no-commit-id --name-only -r "$c"; done \
    | sort -u | grep -vxF "${TASK_FILE#$PWD/}"
  # none tagged → git status --porcelain (state "working tree" in Scope)
  ```
- **Path step:** new "Step 3p — Path scope (review mode only)": `git ls-files -- <path>`; report count; large scopes are fanned out by the coordinator (1023), not here.
- **Rejected:** (a) status-history timestamps (`wip` entry → HEAD) — still leaks concurrent work on a shared branch; (b) a `spur task diff` verb — public-surface addition, not warranted for one recipe; (c) keeping the extension filter with more globs — the filter is the defect.
- **Invariant:** the tag convention is `(<wbs>)` at subject end per AGENTS.md "commit per task"; tasks without tagged commits degrade visibly, never silently.

### Plan

1. Rewrite Step 3 in `plugins/sp/skills/code-verification/SKILL.md` per Design; add Step 3p; fix the review-mode paragraph (`:482-488`) to name Step 3 (WBS) / Step 3p (path) + Step 7.
2. Check `functional-review` Step 3, `code-improvement` Step 1, `super-reviewer` "Establish scope first" still link rather than restate; remove the stale `*.ts/*.tsx/*.js/*.jsx` wording.
3. Verify the recipe by running it for WBS 1020 and pasting the output into Testing.
4. `(cd plugins/sp && bun test tests/skill-structure.test.ts)`, then `bun run spur-check`.

**Verification checks (evidence for the AC above):**

- [x] Running the documented R1 recipe for WBS 1020 lists the files of `bbef13522` (help-doc-parity test, task-pipeline.yaml, help-docs-parity test, skill-structure test) and not files from `a7ef9ba83` alone.
- [x] `code-verification/SKILL.md` review-mode section references the path-scope step, not Step 3, for path targets.
- [x] `grep -rn "'\*.ts' '\*.tsx'" plugins/sp/skills` returns no scope recipe.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/tests/skill-structure.test.ts:876` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/skills/code-verification/SKILL.md:105-119 — SSOT recipe (git log --fixed-strings --grep="(<wbs>)" → diff-tree union → task-file exclusion, no extension filter, visible fallback); executed for WBS 1020: returns exactly bbef13522's 4 files (incl. task-pipeline.yaml), no a7ef9ba83-only leak |
| R2 | MET | code-verification/SKILL.md:121-129 Step 3p (git ls-files -- <path>); executed ls-files on the 4-file skill dir; review-mode paragraph :505-509 routes path targets to Step 3p, never Step 3 |
| R3 | MET | functional-review/SKILL.md:214-217, code-improvement/SKILL.md:108-110, super-reviewer.md:96-99 all defer; grep across plugins/sp/{skills,agents,commands}: recipe exists only in code-verification/SKILL.md:109,127 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — task diff scope names the implementation commits | MET | command | git log --fixed-strings --grep="(1020)" → only bbef13522; recipe output matches expectation; old-recipe contrast executed (a7ef9ba83 anchor leaks AgentsView.tsx, drops .yaml) proving the defect gone |
| R2 — path-mode SECUA review has a defined scope | MET | command | Step 3p documented + executed (4 tracked files); review mode claims Step 3p for path targets (SKILL.md:507-508) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `plugins/sp/skills/code-verification/SKILL.md:97-107,482-488`
- `plugins/sp/skills/functional-review/SKILL.md:214-218`
- `plugins/sp/skills/code-improvement/SKILL.md:100-110`
- `plugins/sp/agents/super-reviewer.md` (Rules › Always)
- Evidence commits: `bbef13522`, `a7ef9ba83`

### History

- 2026-09-30T18:14:44.480Z backlog → todo (system)
- 2026-09-30T18:43:37.028Z todo → wip (system)
- 2026-09-30T19:08:21.362Z wip → testing (system)
- 2026-09-30T19:11:33.598Z testing → done (system)

