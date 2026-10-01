---
schema_version: 1
name: Add reusable dev-job-dump and dev-job-resume Markdown commands
status: done
template: meta
created_at: 2026-10-01T19:01:21.073Z
updated_at: "2026-10-01T21:23:16.188Z"
priority: P2
estimate_hours: 1

---

## 1041. Add reusable dev-job-dump and dev-job-resume Markdown commands

### Background

Operator requests two slash commands to transfer remaining work between coding sessions through a specified Markdown file. The provided feature-specific sample supplies structure only; its task identifiers, implementation details, paths and gate bypasses must not become generic instructions.

### Requirements

- [x] R1. Add dev-job-dump and dev-job-resume as thin command wrappers with a required shared --file <path> option.
- [x] R2. Define one reusable Markdown handoff structure covering mission, environment, completed and remaining work, execution, lessons, constraints and first actions.
- [x] R3. Dump verified session state to the specified file; resume validates current context and continues remaining work through existing lifecycle owners without replaying completion or inventing approvals.
- [x] R4. Index the commands and shared option, preserve portable plugin references, and pass command validation and existing contract checks.

### Acceptance Criteria

- [x] AC1 — Both commands declare the required --file path in their hint, table and usage (req: R1).
- [x] AC2 — Shared guidance contains all reusable sample sections and no feature-specific sample data (req: R2).
- [x] AC3 — Dump and resume specify input validation, verified Git and workflow state, missing data handling, and continuation through existing owners (req: R3).
- [x] AC4 — Superskill validation, command validation, shared flag parity and link checks pass for the changed surfaces (req: R4).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Keep the two requested command files thin and place the shared handoff contract and template in the existing spur-dev references. Reuse lifecycle and worktree owners for continuation; introduce no executable parser, runtime helper, dependency or public Spur CLI verb.

### Plan

- [x] Inspect existing command and handover contracts.
- [x] Scaffold both commands via Superskill and author the shared procedure and template.
- [x] Update command indexes and shared flag glossary.
- [x] Validate and review the changes, record requirement evidence and commit the task.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

The two commands use the existing lifecycle skill and a shared procedure/template rather than adding an executable helper or duplicating the handoff format.

| Change | Evidence |
| --- | --- |
| Dump remaining work | plugins/sp/commands/dev-job-dump.md:2 |
| Resume remaining work | plugins/sp/commands/dev-job-resume.md:2 |
| job-dump | plugins/sp/skills/spur-dev/references/dev-operations.md:343 |
| job-resume | plugins/sp/skills/spur-dev/references/dev-operations.md:355 |
| Job handoff template | plugins/sp/skills/spur-dev/references/dev-operations.md:368 |

Updated the existing operation/role/command indexes, shared flag glossary and owning planning-workflow contract. Updated the existing command-count assertions from 41 to 43. No runtime dependency or public Spur CLI verb was introduced.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/commands/dev-job-dump.md:4 and plugins/sp/commands/dev-job-resume.md:4 declare required --file; .spur/run/1041-verify/command-validation.log:2 confirms 43 wrappers pass all five gates. |
| R2 | MET | plugins/sp/skills/spur-dev/references/dev-operations.md:368 owns the shared eight-section template; .spur/run/1041-verify/instruction-contract-check.log:1 confirms reusable sections and sample filtering. |
| R3 | MET | plugins/sp/skills/spur-dev/references/dev-operations.md:349 covers dump validation and verified state; plugins/sp/skills/spur-dev/references/dev-operations.md:358 covers resume validation, reconciliation and existing-owner continuation; .spur/run/1041-verify/instruction-contract-check.log:2 and .spur/run/1041-verify/resume-reconciliation.json:3 prove the instruction contract and current-host walkthrough. |
| R4 | MET | plugins/sp/skills/spur-dev/references/flag-glossary.md:38 and plugins/sp/references/roles.md:53 index the shared option and roles; .spur/run/1041-verify/focused-tests.log (298 pass); .spur/run/1041-verify/dump-validation.json:2 and .spur/run/1041-verify/resume-validation.json:2 are valid; .spur/run/1041-verify/link-check.log:2 passes. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | bun .spur/run/1041-verify/instruction-contract-check.ts; .spur/run/1041-verify/instruction-contract-check.log:1 verifies both wrappers' required hint/table/usage and procedure links. |
| AC2 | MET | command | bun .spur/run/1041-verify/instruction-contract-check.ts; .spur/run/1041-verify/instruction-contract-check.log:1 verifies all eight reusable sections and excludes sample-specific content. |
| AC3 | MET | command | bun .spur/run/1041-verify/instruction-contract-check.ts; .spur/run/1041-verify/instruction-contract-check.log:2 verifies the prompt instructions' input-validation, live-state, missing-data and continuation obligations. Current-host inline dump/read-back/resume reconciliation used a path with spaces; .spur/run/1041-verify/dump-state.json:2 and .spur/run/1041-verify/resume-reconciliation.json:3 show fresh Git/task provenance, implementation skipped and the verification owner retained. This is instruction coverage plus one live inline walkthrough, not an arbitrary second-session/engine end-to-end claim. Fix-pass handoff artifacts written: .spur/run/1041-verify/instruction-contract-check.ts:1-35; .spur/run/1041-verify/dump-state.json:1-15; .spur/run/1041-verify/resume-reconciliation.json:1-17; .spur/run/1041-verify/handoff with spaces/job transfer.md:1-32. |
| AC4 | MET | test | Fresh focused command/flag/role/skill/section suites: .spur/run/1041-verify/focused-tests.log (298 pass); Superskill strict validation for both wrappers: .spur/run/1041-verify/dump-validation.json:2 and .spur/run/1041-verify/resume-validation.json:2; .spur/run/1041-verify/command-validation.log:2; .spur/run/1041-verify/link-check.log:2. Fix-pass review/evidence artifacts written: .spur/run/1041-verify/functional-review.md:1-10; .spur/run/1041-verify/secua-review.md:1-6; .spur/run/1041-verify/architecture-review.md:1-1; .spur/run/1041-verify/review.md:1-34; .spur/run/1041-verify/solution.md:1-11. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS**

Scope: task 1041, `--focus all --agent inline --auto`. Exact `(1041)` tag lookup had no commits and the initial working tree was clean; the identified implementation commit `317ff19397feab61c8674219a56bd48e337c1845` (`feat(sp-1041)`) supplies nine non-task surfaces, reviewed against current contents. This session coordinates functional, SECUA and architecture fragments.

#### Findings and dispositions

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | Correctness | docs/tasks5/1041_add-reusable-dev-job-dump-and-dev-job-resume-markdown-comman.md:89 | The authored Review was prose-only and failed the populated-priority-table done guard. This coordinated report supplies the required table. | FIXED |
| P3 | Correctness | docs/tasks5/1041_add-reusable-dev-job-dump-and-dev-job-resume-markdown-comman.md:62 | Three Solution citations pointed at blank lines after a shared-reference edit; updated to the actual job-dump, job-resume and template headings. | FIXED |

Security: dump validates paths and rejects corpus targets; resume verifies embedded commands, execution identity, ownership and pending approvals; credentials are redacted. Efficiency: artifacts are linked, with no parser/runtime/dependency introduced. Correctness: required input, live Git/task reconciliation, frozen membership, completion evidence, unavailable notes/checkpoints and drift are covered by explicit instructions and assertions. Usability: required --file is consistent in hints, tables, usage and glossary. Architecture: two approved thin entries dispatch to one existing owner/template and reuse lifecycle/wrap contracts.

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | plugins/sp/commands/dev-job-dump.md:4; plugins/sp/commands/dev-job-resume.md:4; 43 wrappers pass the validator. |
| R2 | MET | plugins/sp/skills/spur-dev/references/dev-operations.md:368; reusable-section and sample-exclusion assertions pass. |
| R3 | MET | plugins/sp/skills/spur-dev/references/dev-operations.md:349; plugins/sp/skills/spur-dev/references/dev-operations.md:358; executable instruction assertions and current-host dump/resume reconciliation pass. |
| R4 | MET | plugins/sp/skills/spur-dev/references/flag-glossary.md:38; plugins/sp/references/roles.md:53; focused tests, strict Superskill validation, shared-flag parity and link check pass. |

#### Architecture

All five architecture lenses reviewed: the two thin entry points are the approved command contract; shared behavior resides once in the existing reference, with no redundant runtime layer. Index/role/glossary updates are required integration points. No cross-workspace value imports, new dependency, public CLI verb, duplicate parser, engine snapshot or alternate lifecycle is introduced. The instruction contract is directly testable and a current-host handoff walkthrough is recorded. No architectural deepening candidate remains.

#### Fresh verification evidence

- `bun run spur-check`: exit 0; 9598 pass, 0 fail across 563 files; lint/typechecks, 50 pre-check rules and 2 post-check rules pass. Evidence: `.spur/run/1041-verify/spur-check.log`.
- Focused command/flag/role/skill/section tests: 298 pass, 0 fail, 2464 assertions. Evidence: `.spur/run/1041-verify/focused-tests.log`.
- Both Superskill strict validators: valid=true; 43 commands pass all five wrapper gates; link-check passes. Superskill's generic role-key warning is covered by Spur's role contract tests.
- `bun .spur/run/1041-verify/instruction-contract-check.ts`: PASS; live current-host dump/read-back/resume reconciliation used a path with spaces. This proves instruction coverage and one inline walkthrough; it does not claim an arbitrary second-session or engine run.

No unresolved P1-P4 findings. No feature-specific sample content, quota dates, parser workarounds or provenance/gate bypass instructions were introduced. Continue the guarded completion path using the fresh PASS verdict.

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-10-01T19:09:30.557Z todo → wip (system)
- 2026-10-01T19:26:56.361Z wip → testing (system)
- 2026-10-01T21:19:18.220Z testing → done (system)

