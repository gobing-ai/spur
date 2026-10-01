---
schema_version: 1
name: Add reusable dev-job-dump and dev-job-resume Markdown commands
status: testing
template: meta
created_at: 2026-10-01T19:01:21.073Z
updated_at: "2026-10-01T19:26:56.361Z"
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
| job-dump | plugins/sp/skills/spur-dev/references/dev-operations.md:342 |
| job-resume | plugins/sp/skills/spur-dev/references/dev-operations.md:354 |
| Job handoff template | plugins/sp/skills/spur-dev/references/dev-operations.md:367 |

Updated the existing operation/role/command indexes, shared flag glossary and owning planning-workflow contract. Updated the existing command-count assertions from 41 to 43. No runtime dependency or public Spur CLI verb was introduced.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | .spur/run/1041-handoff-contract-check.log; .spur/run/1041-command-validation.log |
| R2 | MET | .spur/run/1041-handoff-contract-check.log |
| R3 | MET | Reviewed job-dump and job-resume live-state reconciliation, input validation and existing-owner continuation in dev-operations.md; .spur/run/1041-handoff-contract-check.log |
| R4 | MET | .spur/run/1041-focused-tests.log (289 pass); .spur/run/1041-dump-validation.json; .spur/run/1041-resume-validation.json; .spur/run/1041-link-check.log |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | .spur/run/1041-handoff-contract-check.log; .spur/run/1041-command-validation.log |
| AC2 | MET | command | .spur/run/1041-handoff-contract-check.log |
| AC3 | MET | manual-review | Reviewed job-dump and job-resume live-state reconciliation, input validation and existing-owner continuation in dev-operations.md; .spur/run/1041-handoff-contract-check.log |
| AC4 | MET | command | .spur/run/1041-focused-tests.log (289 pass); .spur/run/1041-dump-validation.json; .spur/run/1041-resume-validation.json; .spur/run/1041-link-check.log |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the command wrappers, shared handoff procedure, template, argument contracts, role assignments and documentation synchronization against the task requirements and existing plugin owners.

No P1-P4 findings remain in the changed surfaces. The shared structure removes all feature-specific identifiers, implementation maps, quota dates, parser workarounds and provenance bypasses from the supplied example. Resume reconciles live Git/run/task state before writing and preserves frozen membership, existing approvals and the owning lifecycle gates.

Validation covers prompt structure, shared flag/role parity, links and removal of sample-specific content. These are prompt instructions executed by a coding agent; validation does not claim an end-to-end run of an arbitrary resumed job.

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-10-01T19:09:30.557Z todo → wip (system)
- 2026-10-01T19:26:56.361Z wip → testing (system)

