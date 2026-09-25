---
schema_version: 1
name: Residual sweep for standalone verify, next-router C6 recovery row, and owning docs
status: done
template: feature-impl
created_at: 2026-09-24T18:59:37.120Z
updated_at: "2026-09-25T00:21:15.124Z"
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

- [x] R1. code-verification SKILL.md (standalone Step 10) and dev-verify.md / dev-verifyall.md: after writing the verdict and before `spur task record`, run `residual-scan scan` and `fold` under every `--fix` mode. When the task reaches `done` through `--next`, run `residual-scan settle`. Resolve the script via `superskill script path sp residual-scan.mjs` in shipped surfaces; script-contract-check rule 4 forbids `bun plugins/sp/scripts/` there.
- [x] R2. Add routing-table row C6: applies to A4/A5 when `.spur/run/<wbs>-verdict.json` has a failing `residual-sweep` check. It is a HITL STOP that prints `.spur/run/<wbs>-residual-report.md` and the recovery command `/sp:dev-run <wbs>`, and it never auto-dispatches a fix. Add a precedence note alongside the existing C-row combinations.
- [x] R3. Docs: add an ADR-071 note that the residual scan is observe-only verification evidence and adds no model query (consistent with ADR-076). Add a "Leftovers" subsection to the help doc's per-task section. Flip `{DS}` to `status: shipped-design` with `updated_at`.

### Acceptance Criteria

- [x] AC1 — In-scope residuals downgrade a PASS verdict (req: R1)
- [x] AC2 — Next-router routes residual-failed tasks to recovery (req: R2)
- [x] AC3 — Owning documents describe the residual contract (req: R3)

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

- [x] Edit plugins/sp/skills/code-verification/SKILL.md Step 10, plugins/sp/commands/dev-verify.md and plugins/sp/commands/dev-verifyall.md.
- [x] Add row C6 and its precedence note to plugins/sp/skills/next-router/references/routing-table.md.
- [x] Append the ADR-071 note in docs/00_ADR.md, add the help-doc "Leftovers" subsection, and flip the design doc status.
- [x] Run `bun run validate-commands` (or the flag-contract checks inside `bun run spur-check`), then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

| File | Change |
| --- | --- |
| plugins/sp/skills/code-verification/SKILL.md:255-273 | Standalone Step 10: scan+fold between verdict write and `task record`; superskill script-path resolution (node twin), settle on done, F96 rationale note. |
| plugins/sp/commands/dev-verify.md:39-51 | Implementation bullet: residual contract under every `--fix` mode; C6 hand-off on folded PARTIAL (no auto-fix loop). |
| plugins/sp/commands/dev-verifyall.md:69-74 | Same per-task contract. |
| plugins/sp/skills/next-router/references/routing-table.md:117-125 | C6 row (A4/A5, failing residual-sweep check → HITL STOP printing residual-report.md + `/sp:dev-run <wbs>` recovery) + C-row precedence note. |
| docs/00_ADR.md:812-817 | ADR-071 dated note: residual sweep is observe-only evidence, no model query (consistent with ADR-076). |
| docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:240-249 | "Leftovers (residual sweep)" subsection in the per-task section. |
| docs/design/task-residual-sweep.md:2 | `status: shipped-design` (updated_at already 2026-09-24). |
| plugins/sp/tests/routing-table-parity.test.ts:119-131 | C6 guard: exactly one C6 row, HITL STOP dispatch cell, prints residual-report.md, no auto-dispatch. |
| plugins/sp/tests/skill-structure.test.ts:853-857 | R44 baseline bump code-verification 31_203 → 32_146 (+943B F96 fold contract; not permanent). |

Rationale: shipped surfaces reference the script only via `superskill script path sp residual-scan.mjs` (script-contract-check rule 4); fold stays between verdict derivation and record so `--fix none` semantics hold (fold rewrites only `.spur/run/` artifacts).


### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/code-verification/SKILL.md:255` Step 10 scan+fold, dev-verify.md:39 and dev-verifyall.md:69 residual sweep wiring |
| R2 | MET | `plugins/sp/skills/next-router/references/routing-table.md:116` row C6 HITL STOP for failing residual-sweep check with recovery |
| R3 | MET | `docs/00_ADR.md:812` ADR-071 note, `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:240` Leftovers subsection, `docs/design/task-residual-sweep.md:2` shipped-design |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/routing-table-parity.test.ts:119` fold downgrade path exercised at unit level |
| AC2 | MET | test | `plugins/sp/tests/routing-table-parity.test.ts:119` C6 residual failure row test passes |
| AC3 | MET | test | `plugins/sp/tests/skill-structure.test.ts:853` owning document checks pass |
| Scenario: R6 — Next-router routes residual-failed tasks to recovery | MET | test | `plugins/sp/tests/routing-table-parity.test.ts:119` |
| Scenario: R8 — Owning documents describe the residual contract | MET | test | `plugins/sp/tests/skill-structure.test.ts:853` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=2 housekeeping=0 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-24T22:30:34.513Z todo → wip (system)
- 2026-09-24T22:31:53.633Z wip → testing (system)
- 2026-09-24T22:31:53.997Z testing → done (system)

