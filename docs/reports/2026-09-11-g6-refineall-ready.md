---
title: G6 ready-depth refinement batch
date: 2026-09-11
feature: G6
operation: sp-dev-refineall
depth: ready
result: clean
---

# G6 ready-depth refinement batch

Invocation: `sp-dev-refineall --feature G6 --auto --depth ready`.
Frozen membership: 0828, 0829, 0830; all were todo. No exclusions, failures or skipped refinements.
Order: 0828 → 0829 → 0830; 0829 and 0830 both depend on 0828 and have no dependency on one another.

**Result: all three specifications refined to ready depth.** This is specification readiness,
not task completion or permission to execute an unmet dependency. All tasks remain todo;
0828 is the execution frontier.

| Task | Outcome | Main refinement | Execution admission |
| --- | --- | --- | --- |
| [0828 — Inventory and probe project fleet identity, delivery, and legacy migration](../tasks4/0828_inventory-and-probe-project-fleet-identity-delivery-and-lega.md) | refined | Fixed report sections, source/test seams, six fault categories, migration matrix and downstream input contract | No task prerequisite |
| [0829 — Prototype rest and GTD dispatch traces with capacity and restart failures](../tasks4/0829_prototype-rest-and-gtd-dispatch-traces-with-capacity-and-res.md) | refined | Fixed simulator/check/report paths, request identity, deterministic selection, rest/owner races, snapshot restart and unknown-outcome handling | Waits for 0828 |
| [0830 — Prototype Projects conversation, agents, work, and global input interactions](../tasks4/0830_prototype-projects-conversation-agents-work-and-global-input.md) | refined | Fixed portable prototype/report/check paths, delayed-receipt draft protection, colliding project-label fixtures, accessibility and mock-state evidence | Waits for 0828 |

## Ready-depth checklist

| Criterion | Evidence across the three tasks |
| --- | --- |
| Observable requirements and non-goals | Each task retains R1–R4 with explicit investigation/prototype outputs and excluded production mutations |
| WHAT / WHY / WHERE | Design names existing source/test seams, frozen output paths, private prototype behavior, and no new production API |
| Executable plan | Ordered R-linked checklists include probe/interaction commands and evidence collection |
| Acceptance | Four executable Given/When/Then checklist rows per task; G6 remains a wayfinder map without fabricated product acceptance |
| Closed/deferred decisions | Q&A records Robin's approval and defers only cutover, concrete visual feedback, and production schema decisions to their owners |
| Dependency handoffs | 0828 freezes Runtime path / Fault probes / Migration matrix / Handoff; 0829 and 0830 consume those sections without re-owning findings |
| Verified premises | Current source confirms the input stub, drain-before-run ordering, queue behavior and closed role vocabulary; future outputs are explicitly identified as not yet created |

The source checks exposed a material distinction: production role validation accepts only
scribe/coder/reviewer/planner (`packages/config/src/index.ts`). The prototypes explicitly bind
a planner-role instance as orchestrator. They do not pretend that `SPUR_ROLE=orchestrator`
already passes current validation or add a new public role during investigation.

Other checked sources: `apps/cli/src/commands/agent.ts`,
`packages/app/src/services/team-service.ts`, `supervisor-service.ts` in that directory,
`apps/web/src/components/GlobalAgentBar.tsx`, `packages/config/src/projects.ts`,
the existing agent-team/occupant-wait test seams, and ADR-052. Existing toolchain/happy-dom
availability was checked in the workspace manifest.

## Validation

- Quick readiness: `quickReadiness` from `plugins/sp/scripts/batch-preflight.ts` admitted all
  three for operation refine. This is admission evidence, not the semantic depth check.
- G6 feature check: PASS, no findings.
- 0828 task check: PASS; two L4 gate-language advisories in Background/Plan. They match the word
  “approved”; Robin's actual approval is recorded in G6 and the design. No unfulfilled approval
  dependency is inferred, no fictitious task edge added, and the advisories remain visible.
- 0829 and 0830 task checks: PASS; each retains the expected L4 prerequisite-not-done warning
  for 0828. They cannot execute yet.
- Recommended pre-check: PASS, 45 rules, no findings or automatic fixes.
- Saved-section readback: Background, Requirements, Design, Plan, Acceptance Criteria and References
  match the authored content; Q&A was appended through its owning CLI contract.
- All statuses/dependencies and Solution/Testing/Review sections were preserved.
- Refinement-only change: no runtime tests, browser checks or production build were run. These remain
  explicit work in the investigation/prototype tasks; no runtime verify verdict is claimed.

## Scope and provenance

All task writes used the source-local CLI with section files; no task corpus was edited directly.
Seven sections were written per task, 21 successful section updates total. Model-bearing refinement
ran inline; no subagent, executor subprocess, or workflow was launched. No worktree was requested.

Branch: `wayfind/project-agent-fleet`.
Initial HEAD: `b96146112e450c18dfb47deacb7b0189ff19380c`.
Observed final HEAD: `6bcdc792b5227afa4399988fcb7ea461cc477209`.
Concurrent commits captured G6 and the refined 0828 while this turn was in progress. Post-change
readback confirmed the intended task content. Unrelated help-document edits were preserved; this
refinement operation did not create those commits.

Local audit artifacts: `.spur/run/refine-g6-ready/before.json`,
`.spur/run/refine-g6-ready-input.json`, section payloads beneath
`.spur/run/refine-g6-ready/`, `pre-check.json` in that directory, and
`.spur/run/refine-g6-ready-event-trace.md`. They are gitignored; the durable specification is in
the task files and this report. The user's continue resumed the same batch and did not change scope.

