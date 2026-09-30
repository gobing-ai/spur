---
schema_version: 1
name: "dev-review target selectors: --tasks / --feature / --scope multi-target with deprecated positional alias"
status: done
template: feature-impl
created_at: 2026-09-30T18:12:19.059Z
updated_at: "2026-09-30T22:12:20.409Z"
feature_id: I33

dependencies: ["1021", "1022"]
ac_numbering: task-local
---

## 1023. dev-review target selectors: --tasks / --feature / --scope multi-target with deprecated positional alias

### Background

`/sp:dev-review` takes a single positional `<wbs|path>` (`dev-review.md:5`). Reviewing the project's main trees (`apps`, `packages`, `plugins`, `scripts`) takes four runs, reviewing a feature means enumerating its tasks by hand, and the positional is ambiguous (a directory named `0962`; the implicit `cwd` default silently becomes a whole-repo path review).

Operator decision (2026-09-30): replace the positional with three explicit, mutually exclusive selectors reusing existing glossary flags — `--tasks <selector>`, `--feature <id>[,<id>]`, `--scope <path>[,<path>]` — each accepting a comma list. This is the public-surface consent for the command change.

Depends on 1021 (honest per-task and path scope — fan-out multiplies any scope bug) and 1022 (single target forwarding, coordinator ownership of `## Review`).

### Requirements

- **R1** — Exactly one of `--tasks`, `--feature`, `--scope` per invocation. More than one → exit 2 naming the conflict before any review. None and no positional → exit 2 with usage (no implicit `cwd`).
- **R2** — `--tasks <selector>` uses the batch selector grammar from `execution-batch.md` (comma WBS list, `feature:<id>`; status pseudo-lists and `ready` rejected for review). `--feature <id>[,<id>]` is sugar for the union of `feature:<id>` sets. The set is resolved once and frozen.
- **R3** — Task targets: one WBS-mode review per task; each writes its own merged `## Review` (coordinator contract from 1022). Tasks in `backlog`/`todo`/`blocked` are reported as NOT-STARTED and skipped. The run ends with a combined summary table (WBS, verdict, P1/P2 counts). A per-task failure does not stop the remaining tasks.
- **R4** — `--scope <path>[,<path>]`: paths must exist (exit 2 otherwise), are normalized, and nested/duplicate paths are merged. Each remaining path gets a sub-review (path scope from 1021 Step 3p), eligible for native-subagent dispatch per `dispatch-surface.md`; the coordinator merges them, runs one cross-path architecture pass (`sp:code-improvement` over the inter-path imports), and emits one advisory report. No task mutation.
- **R5** — Positional `<wbs|path>` is a deprecated alias for one release: a token matching `^\d{4}$` with a resolvable task → `--tasks`; an existing path → `--scope`; otherwise exit 2. A deprecation warning names the replacement.
- **R6** — `config/workflows/task-pipeline.yaml` review step invokes `/sp:dev-review --tasks ${vars.wbs} --auto`; `bun run --filter @gobing-ai/spur build:bundle` regenerates `apps/cli/config/`.
- **R7** — `--worktree` with multi-target: admission requires every target to resolve; branch slug `sp/review-<first>-and-<N>-<short-id>` (single target keeps `sp/review-<slug>-<short-id>`); marker `selector` records the full normalized target list. `--triage` buckets findings across all targets once (dedupe identical `file:line` findings).
- **R8** — Argument-hint, Argument Flags table, Usage examples, `dev-operations.md` §2 row/text and `flag-glossary.md` (`#flag-tasks`, `#flag-feature`, `#flag-scope` gain `dev-review`; `#flag-feature` documents the comma list for dev-review) change together; `command-flag-parity.test.ts` passes.

### Acceptance Criteria

```gherkin
  @core
  Scenario: R3 — exactly one target kind per invocation
    Given the operator passes more than one of --tasks, --feature and --scope
    When /sp:dev-review parses its arguments
    Then it stops with exit 2 naming the conflicting selectors before any review runs

  @core
  Scenario: R4 — multi-task and feature targets review each task
    Given --tasks 0962,0963 or --feature <id>
    When the review runs
    Then each implemented task gets its own merged ## Review section and the run ends with a combined summary
    And feature tasks in backlog or todo are reported as NOT-STARTED and not reviewed

  @core
  Scenario: R5 — multi-path scope reviews the union once
    Given --scope apps,packages,plugins,scripts
    When the review runs
    Then overlapping paths are deduplicated, each path gets a sub-review, and one merged advisory report includes a cross-path architecture pass
    And no task file is mutated

  @core
  Scenario: R6 — positional target is a deprecated alias
    Given /sp:dev-review 0962 is invoked
    When arguments are parsed
    Then it behaves as --tasks 0962 and prints a deprecation warning
    And the task pipeline review step invokes --tasks ${vars.wbs}

  @core
  Scenario: R7 — command, agent and skill contracts agree
    Given the dev-review command, super-reviewer agent, review skills, flag glossary and dev-operations row
    When command-flag-parity and plugin structure tests run
    Then the target is forwarded once, one --focus vocabulary is referenced, no live route uses the deprecated --fix or removed --next, and --tasks/--feature/--scope/--auto appear in the argument hint, dev-operations row and glossary
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Flags reuse existing glossary entries** (`--tasks`, `--feature`, `--scope`) — operator-chosen over new `--task`/`--path`, which would collide with the existing `--task` family and duplicate `--scope`.
- **Task targets fan out, path targets merge.** `## Review` is per task, so tasks cannot share a report; path reviews are advisory, and architecture friction between packages is only visible over the union — hence per-path sub-reviews plus one cross-path pass.
- **Size guard via sub-reviews, not a hard file cap:** `code-improvement` Step 2 reads exports + callers per module, which overflows context on `apps,packages,plugins,scripts` in one pass. Sub-reviews bound each context; the coordinator only holds fragments.
- **Reuse the batch selector resolver** described in `execution-batch.md` (resolve + freeze, NOT-STARTED vocabulary from verifyall) instead of a review-specific parser. Rejected selector forms for review: status pseudo-lists and `ready` (they select work to do, not work to review).
- **Deprecated positional for one release** so the pipeline and existing muscle memory keep working while R6 migrates the pipeline in the same change. Removal is a follow-up, not this task.
- **Rejected:** mixing selector kinds in one run (operator: prefer single target kind; mixed WBS + path reports have incompatible write contracts).

### Plan

1. `plugins/sp/commands/dev-review.md`: hint `[--tasks <selector> | --feature <id>[,<id>] | --scope <path>[,<path>]] …`, flag table, usage, Implementation (selector validation, task fan-out, path merge, positional alias, worktree multi-target).
2. `plugins/sp/skills/spur-dev/references/dev-operations.md` §2 row + Modes/Inputs/Worktree text; `flag-glossary.md` `#flag-tasks`, `#flag-feature`, `#flag-scope`.
3. `plugins/sp/agents/super-reviewer.md`: multi-target coordination (per-task Review writes, summary table, path sub-review merge + cross-path pass).
4. `config/workflows/task-pipeline.yaml:593` → `--tasks ${vars.wbs} --auto`; `bun run --filter @gobing-ai/spur build:bundle`.
5. Extend `plugins/sp/tests/command-flag-parity.test.ts`; `(cd plugins/sp && bun test tests/command-flag-parity.test.ts)`.
6. E2E dogfood runs per AC; save transcript excerpt to Testing. `bun run spur-check`.

**Verification checks (evidence for the AC above):**

- [x] `command-flag-parity.test.ts` asserts `--tasks`, `--feature`, `--scope` in the dev-review hint, dev-operations row and glossary entries.
- [x] `grep -n "dev-review" config/workflows/task-pipeline.yaml` shows `--tasks ${vars.wbs}`; generated `apps/cli/config/` matches after `build:bundle`.
- [x] E2E dogfood (run inline from on-disk dev-review.md, I33 verifyall 2026-09-30): `/sp:dev-review --scope plugins/sp/commands,plugins/sp/agents` produces one merged report with a cross-path section and `git status --short docs/tasks*` unchanged; `/sp:dev-review --tasks 1021,1022` writes `## Review` on both.
- [x] `bun run spur-check` is green.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/tests/command-flag-parity.test.ts:352` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-review.md:42` selector validation (exactly one kind; conflict → exit 2 naming selectors; none → usage, no implicit cwd); test `plugins/sp/tests/command-flag-parity.test.ts:375` pass |
| R2 | MET | `plugins/sp/commands/dev-review.md:15-16,42` batch selector grammar, review-safe forms, resolve-once freeze, `--feature` union sugar; `plugins/sp/skills/spur-dev/references/flag-glossary.md:238-241`; test `plugins/sp/tests/command-flag-parity.test.ts:382` pass |
| R3 | MET | `plugins/sp/commands/dev-review.md:44-45` per-task fan-out, own `## Review`, NOT-STARTED skip, no stop-on-failure, combined summary; per-task dispatch now forwards the resolved `<wbs>` (`plugins/sp/commands/dev-review.md:43`, fixed this run); `plugins/sp/agents/super-reviewer.md:76-83`; test `plugins/sp/tests/command-flag-parity.test.ts:396` pass |
| R4 | MET | `plugins/sp/commands/dev-review.md:17,46` path existence/normalize/merge, Step 3p sub-review per path, one cross-path pass, one advisory report, no mutation; `plugins/sp/agents/super-reviewer.md:84-89`; tests `plugins/sp/tests/command-flag-parity.test.ts:396,408` pass |
| R5 | MET | `plugins/sp/commands/dev-review.md:18,47` deprecated positional alias with `^\d{4}$` rule and warning; test `plugins/sp/tests/command-flag-parity.test.ts:389` pass |
| R6 | MET | `config/workflows/task-pipeline.yaml:593` `input: /sp:dev-review --tasks ${vars.wbs} --auto`; generated `apps/cli/config/workflows/task-pipeline.yaml` byte-identical (`cmp` exit 0, gitignored build output); test `plugins/sp/tests/command-flag-parity.test.ts:425` pass |
| R7 | MET | `plugins/sp/commands/dev-review.md:50` admission, multi-target slug, marker selector; `plugins/sp/skills/spur-dev/references/execution-batch.md:592-598`; test `plugins/sp/tests/command-flag-parity.test.ts:434` pass |
| R8 | MET | hint `plugins/sp/commands/dev-review.md:4`, flags `:13-19`, usage `:30-34`; `plugins/sp/skills/spur-dev/references/dev-operations.md:71`; glossary `plugins/sp/skills/spur-dev/references/flag-glossary.md:184,213-214,238-240`; command-flag-parity + skill-structure 190 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — exactly one target kind per invocation | MET | test | `plugins/sp/tests/command-flag-parity.test.ts:375` pass; contract `plugins/sp/commands/dev-review.md:42` |
| R4 — multi-task and feature targets review each task | MET | command | E2E dogfood `/sp:dev-review --tasks 1021,1022` run inline from `plugins/sp/commands/dev-review.md:42-45` (2026-09-30): frozen set {1021,1022}, Step 3 scope per task (`77f0d10dd` 7 files, `f5a0b8edc` 10 files), each task got its own merged `## Review` via `spur task update --section Review --from-file` (`spur task check` pass on both), combined summary table WBS/verdict/P1/P2 emitted; contract tests `plugins/sp/tests/command-flag-parity.test.ts:291-302,396` pass |
| R5 — multi-path scope reviews the union once | MET | command | E2E dogfood `/sp:dev-review --scope plugins/sp/commands,plugins/sp/agents` (2026-09-30): Step 3p per path (41 + 4 tracked files), one merged advisory report with a cross-path architecture section (0 broken links, all Skill/agent targets resolve), 1 P4; `git status --short docs/tasks*` and `git diff docs/tasks*` hash identical before/after (no task mutation); contract `plugins/sp/commands/dev-review.md:46`, tests `plugins/sp/tests/command-flag-parity.test.ts:396,408` pass |
| R6 — positional target is a deprecated alias | MET | test | `plugins/sp/tests/command-flag-parity.test.ts:389,425` pass; both pipeline YAMLs carry `--tasks ${vars.wbs}` (grep + cmp this run) |
| R7 — command, agent and skill contracts agree | MET | test | command-flag-parity + skill-structure 190 pass / 0 fail; `bun run spur-check`: lint+typecheck pass, 9454 pass / 5 sandbox-only fail (git hooks copy denied, Chromium) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `plugins/sp/commands/dev-review.md`
- `plugins/sp/skills/spur-dev/references/execution-batch.md` (selector resolution, worktree isolation WT-*)
- `plugins/sp/skills/spur-dev/references/dev-operations.md` §2 review, §3a verifyall (NOT-STARTED vocabulary)
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` `#flag-tasks`, `#flag-feature`, `#flag-scope`
- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`
- `config/workflows/task-pipeline.yaml:593`
- `plugins/sp/tests/command-flag-parity.test.ts:28-33,232`

### History

- 2026-09-30T18:14:44.930Z backlog → todo (system)
- 2026-09-30T20:17:48.855Z todo → wip (system)
- 2026-09-30T21:04:33.326Z wip → testing (system)
- 2026-09-30T21:04:35.249Z testing → done (system)

