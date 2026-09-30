---
schema_version: 1
name: "dev-review target selectors: --tasks / --feature / --scope multi-target with deprecated positional alias"
status: done
template: feature-impl
created_at: 2026-09-30T18:12:19.059Z
updated_at: "2026-09-30T21:04:35.249Z"
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
- [x] E2E dogfood: `/sp:dev-review --scope plugins/sp/commands,plugins/sp/agents` produces one merged report with a cross-path section and `git status --short docs/tasks*` unchanged; `/sp:dev-review --tasks 1021,1022` writes `## Review` on both. Transcript excerpt saved as the verifiable artifact in Testing.
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
| R1 | MET | plugins/sp/commands/dev-review.md:42 — "Exactly one target kind per invocation: `--tasks`, `--feature`, or `--scope`. More than one → exit 2 naming the conflicting selectors; none (and no positional) → exit 2 with usage — there is no implicit `cwd` target", stated under Selector validation before any review runs; mirrored in plugins/sp/skills/spur-dev/references/dev-operations.md:121 (Inputs: exactly one of the three, both exit-2 contracts). Proven by plugins/sp/tests/command-flag-parity.test.ts task-1023 R1 test (pass): asserts the exclusivity sentence and that the hint (dev-review.md:4) declares --tasks, --feature, --scope, --auto |
| R2 | MET | plugins/sp/commands/dev-review.md:16 + :42 — set resolved once and frozen through the execution-batch.md Step 1 batch resolver (comma WBS list or `feature:<id>`; status pseudo-lists and `ready` rejected for review; no review-specific parser); :42 --feature is sugar for the union of the feature:<id> sets. plugins/sp/skills/spur-dev/references/flag-glossary.md:238-241 (#flag-tasks) restricts dev-review to the review-safe forms. Proven by command-flag-parity task-1023 R2 test (pass) |
| R3 | MET | plugins/sp/commands/dev-review.md:44 — one WBS-mode review per task in the frozen set, each writing its own merged `## Review`; backlog/todo/blocked reported NOT-STARTED and skipped; per-task failure does not stop the rest; run ends with a combined summary table (WBS, verdict, P1/P2 counts); coordinator per-task write via `spur task update <wbs> --section Review --from-file` at :45. plugins/sp/agents/super-reviewer.md:76-91 Multi-target coordination repeats the contract; NOT-STARTED vocabulary SSOT at plugins/sp/skills/spur-dev/references/dev-operations.md:146 (§ 3a). Proven by command-flag-parity task-1023 R8a test (pass, asserts NOT-STARTED + selectors in the ops row/text) |
| R4 | MET | plugins/sp/commands/dev-review.md:18 + :46 — paths must exist (exit 2 otherwise), normalized, nested/duplicate paths merged; one sub-review per surviving path (Step 3p scope), eligible for native-subagent dispatch per dispatch-surface.md; coordinator merges sub-reviews, runs ONE cross-path architecture pass (`sp:code-improvement` over inter-path imports), emits ONE advisory report; no task mutation. plugins/sp/skills/spur-dev/references/dev-operations.md:120 (Path-set mode) and plugins/sp/agents/super-reviewer.md:85-89 agree. Proven by command-flag-parity task-1023 R8a + R8b tests (pass: --scope <path>[,<path>] in ops, glossary #flag-scope "comma list of paths" at flag-glossary.md:213-214) |
| R5 | MET | plugins/sp/commands/dev-review.md:19 + :47 — deprecated positional alias for one release: `^\d{4}$` token with a resolvable task → `--tasks <wbs>`; existing path → `--scope <path>`; otherwise exit 2; deprecation warning names the replacement selector; removal is a follow-up. Mirrored in plugins/sp/skills/spur-dev/references/dev-operations.md:121. Proven by command-flag-parity task-1023 R5 test (pass: asserts the alias row, the `^\d{4}$` rule and both replacement selectors) |
| R6 | MET | config/workflows/task-pipeline.yaml:593 — grep shows `input: /sp:dev-review --tasks ${vars.wbs} --auto`; generated apps/cli/config/workflows/task-pipeline.yaml:593 matches byte-for-byte (grep output identical). Proven by command-flag-parity task-1023 R6 test (pass: forwarded token present, bare positional absent in both files) |
| R7 | MET | plugins/sp/commands/dev-review.md:50 — admission requires every target to resolve before the tree is cut; branch slug `sp/review-<first>-and-<N>-<short-id>` multi-target, `sp/review-<slug>-<short-id>` single; marker `selector` = the full normalized target list; :48 + plugins/sp/agents/super-reviewer.md:90-91 --triage buckets findings across all targets once with identical file:line dedupe. Mirrored in plugins/sp/skills/spur-dev/references/dev-operations.md:127 and execution-batch.md:592-597. Proven by command-flag-parity task-1023 R7 test (pass: slugs in dev-review.md and dev-operations.md, admission and marker phrasing) |
| R8 | MET | Changed together in this diff: plugins/sp/commands/dev-review.md:4 (argument-hint), :13-19 (flags table), :30-34 (usage); plugins/sp/skills/spur-dev/references/dev-operations.md:71 (§2 row) + :115-127 (§2 text); plugins/sp/skills/spur-dev/references/flag-glossary.md:184-185 (#flag-feature comma list), :213-214 (#flag-scope gains dev-review), :238-241 (#flag-tasks gains dev-review with review-safe restriction); plugins/sp/agents/super-reviewer.md:76-91; plugins/sp/skills/spur-dev/references/execution-batch.md:592-597. Proven by executed suites: command-flag-parity.test.ts 99 pass (7 new task-1023 tests incl. R1/R8a/R8b), skill-structure.test.ts 91 pass, scripts/commands/command-contract.test.ts 67 pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — exactly one target kind per invocation | MET | test | dev-review.md:42 selector validation (exit 2 naming the conflicting selectors before any review; none → usage, no implicit cwd) + dev-operations.md:121; executed command-flag-parity task-1023 R1 test pass (hint declares --tasks/--feature/--scope/--auto and the exclusivity sentence) |
| R4 — multi-task and feature targets review each task | MET | test | dev-review.md:44 task fan-out (own merged `## Review` per task, combined summary, NOT-STARTED skip for backlog/todo/blocked) + super-reviewer.md:76-91; executed command-flag-parity task-1023 R8a test pass (ops row/text carry the selectors and NOT-STARTED contract). Behavioral dogfood (`--tasks 1021,1022` writes) intentionally not run in this read-only hop; contract is coordinator-owned per task in three surfaces |
| R5 — multi-path scope reviews the union once | MET | test | dev-review.md:46 + :18 (paths merged/deduped, sub-review per surviving path, one cross-path architecture pass, one advisory report, no task mutation) + dev-operations.md:120 + flag-glossary.md:213-214; executed command-flag-parity task-1023 R8a + R8b tests pass |
| R6 — positional target is a deprecated alias | MET | test | dev-review.md:19 + :47 alias rule with warning naming the replacement; executed greps: config/workflows/task-pipeline.yaml:593 and apps/cli/config/workflows/task-pipeline.yaml:593 both read `input: /sp:dev-review --tasks ${vars.wbs} --auto`; executed command-flag-parity task-1023 R5 + R6 tests pass (alias documented; bare positional absent from both pipeline files) |
| R7 — command, agent and skill contracts agree | MET | test | Executed suites this hop: command-flag-parity.test.ts 99 pass (task-1023 R1/R2/R5/R6/R7/R8a/R8b: forwarded once, one --focus vocabulary, no live route recommends --fix or --next, selectors present in hint + ops row + glossary, worktree slug/marker agreed), skill-structure.test.ts 91 pass, scripts/commands/command-contract.test.ts 67 pass; contract text agrees across dev-review.md, super-reviewer.md:26-91, dev-operations.md:71,115-127, flag-glossary.md:184-185,213-214,238-241, execution-batch.md:592-597 |
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

