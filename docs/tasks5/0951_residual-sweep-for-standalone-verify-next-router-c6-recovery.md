---
schema_version: 1
name: Residual sweep for standalone verify, next-router C6 recovery row, and owning docs
status: todo
template: feature-impl
created_at: 2026-09-24T18:59:37.120Z
updated_at: "2026-09-24T19:00:56.073Z"
feature_id: F96
priority: P2
tags:
  - residual-sweep
  - docs
  - next-router
estimate_hours: 4

dependencies: ["0949", "0950"]
---

## 0951. Residual sweep for standalone verify, next-router C6 recovery row, and owning docs

### Background

Depends on the pipeline wiring task (same feature). Standalone `/sp:dev-verify` and `/sp:dev-verifyall` must apply the same residual fold so that a manual verify cannot certify what the pipeline would reject. `/sp:dev-next` must route residual-failed tasks to a human stop instead of another automatic fix loop. This task also finalizes the owning docs.

Premises (verified 2026-09-24):
- Standalone verify writes `.spur/run/<wbs>-verdict.json` itself and then runs `spur task record <wbs> --verdict-file …` (plugins/sp/skills/code-verification/SKILL.md:256-262). The fold must happen between those two steps.
- dev-verify's `--fix` modes are none|blockers-first|all (plugins/sp/commands/dev-verify.md:18). On PASS, `--next` hands off to the next-router, and non-PASS halts at `testing` (plugins/sp/commands/dev-verify.md:46-49). dev-verifyall has the same rule per task (plugins/sp/commands/dev-verifyall.md:51-53).
- Router TABLE C probe rows end at C5 (plugins/sp/skills/next-router/references/routing-table.md:111-115). A4/A5 cover `wip` tasks (plugins/sp/skills/next-router/references/routing-table.md:64-65). C4 is the existing HITL STOP pattern (:114).
- ADR-071 is the proof-state invariant (docs/00_ADR.md:803). ADR-076 retired the earlier model-bearing residual-sweep stage (docs/00_ADR.md:909).
- The daily help doc has a per-task section ("## Driving one existing task by hand") in docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md.
- `docs/design/task-residual-sweep.md` carries `status: proposed-design`.

### Requirements

- [ ] R1. code-verification SKILL.md (standalone Step 10) and dev-verify.md / dev-verifyall.md: after writing the verdict and before `spur task record`, run `residual-scan scan` and `fold` under every `--fix` mode. When the task reaches `done` through `--next`, run `residual-scan settle`. Resolve the script via `superskill script path sp residual-scan.mjs` in shipped surfaces; script-contract-check rule 4 forbids `bun plugins/sp/scripts/` there.
- [ ] R2. Add routing-table row C6: applies to A4/A5 when `.spur/run/<wbs>-verdict.json` has a failing `residual-sweep` check. It is a HITL STOP that prints `.spur/run/<wbs>-residual-report.md` and the recovery command `/sp:dev-run <wbs>`, and it never auto-dispatches a fix. Add a precedence note alongside the existing C-row combinations.
- [ ] R3. Docs: add an ADR-071 note that the residual scan is observe-only verification evidence and adds no model query (consistent with ADR-076). Add a "Leftovers" subsection to the help doc's per-task section. Flip `{DS}` to `status: shipped-design` with `updated_at`.

### Acceptance Criteria

- [ ] AC1 — In-scope residuals downgrade a PASS verdict (req: R1)
- [ ] AC2 — Next-router routes residual-failed tasks to recovery (req: R2)
- [ ] AC3 — Owning documents describe the residual contract (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Contract owner: `docs/design/task-residual-sweep.md` (§Terminal path, §Surfaces changed).

Decisions:
- Standalone verify stays observe-only. `fold` only rewrites `.spur/run/` artifacts, so `--fix none` semantics hold.
- C6 is a STOP, not a fix hop. By the time C6 fires, the bounded remediation loop has already failed, and repeating it unattended burns quota without new information.
- The ADR change is a dated note appended under ADR-071; no ADR renumbering.
- Anti-patterns: no new flags on dev-verify/dev-verifyall; no edits to the constitution.

### Plan

- [ ] Edit plugins/sp/skills/code-verification/SKILL.md Step 10, plugins/sp/commands/dev-verify.md and plugins/sp/commands/dev-verifyall.md.
- [ ] Add row C6 and its precedence note to plugins/sp/skills/next-router/references/routing-table.md.
- [ ] Append the ADR-071 note in docs/00_ADR.md, add the help-doc "Leftovers" subsection, and flip the design doc status.
- [ ] Run `bun run validate-commands` (or the flag-contract checks inside `bun run spur-check`), then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
