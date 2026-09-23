---
schema_version: 1
name: Re-verify legacy H1 umbrella scenarios and close out the feature
status: todo
template: feature-impl
created_at: 2026-09-23T06:52:01.213Z
updated_at: "2026-09-23T06:58:40.575Z"
feature_id: H1

priority: P3
estimate_hours: 2
dependencies: ["0931", "0933"]
---

## 0934. Re-verify legacy H1 umbrella scenarios and close out the feature

### Background

Closes the H1 umbrella. The 2026-09-22 re-baseline found four H1 scenarios with no linked task:
- "Every LLM output is CLI-gated before write";
- "Decomposition lands atomically";
- "Commands are thin wrappers";
- "R9 test-driven-development remains a referenced discipline skill".

They shipped with 0065/0161/0141-era work but were never bound to a task AC, so `spur feature check H1` reports `L4.uncovered-feature-scenario` for each. This task re-verifies them against the current tree with durable evidence, runs the final drift sweep after Slice A (0931) and Slice B (0933), and moves H1 to done.

Evidence already in the tree, to be confirmed rather than rebuilt:
- Feature check loop: `plugins/sp/skills/spur-dev/references/planning-workflow.md:16`, `:67` (Step 3, loop until clean).
- Batch atomicity: `packages/app/tests/services/task-service.test.ts:688` ("rolls back all tasks on partial failure").
- Command wrappers: `plugins/sp/tests/command-contract.test.ts` (heading and frontmatter contracts; every command's `## Implementation` dispatches a skill).
- TDD discipline: `plugins/sp/skills/test-driven-development/` exists, and is referenced at `plugins/sp/skills/code-implementation/SKILL.md:34`, `:142` and `plugins/sp/skills/code-testing/SKILL.md:32`, `:68`, `:94`.

Rubric: E1 D1 L1 C1 R0 = 4. Mutation policy: tests + docs only.

### Requirements

- [ ] R1. Re-verify each of the four legacy scenarios against the current tree. Where an assertion is missing, add the smallest automated test:
  - atomicity: a schema-invalid batch leaves zero files and returns findings;
  - thin wrappers: every `plugins/sp/commands/*.md` `## Implementation` delegates to a `Skill(skill="sp:…")` and holds no pipeline state machine.
  Cite `file:line` evidence for the others.
- [ ] R2. Drift sweep after 0931/0933:
  - `rg -n '0142|workspace module|inbox module|v1 is sequential|team mode' plugins/sp docs/design` returns no live-contract hits (history/ADR text excepted);
  - update the H1 Notes re-baseline paragraph to past tense with the landed task IDs;
  - `spur feature check H1 --json` has no `L4.uncovered-feature-scenario`.
- [ ] R3. Close-out: `spur feature refresh --feature H1` and `spur feature sync H1`. H1 reaches `done` once 0931–0934 are done.

### Acceptance Criteria

- [ ] AC1 — Every LLM output is CLI-gated before write (req: R1, R2, R3)
  Given the planning half generates a feature with AC
  When the feature check gate fails
  Then the skill loops on the findings
  And nothing reaches the corpus until the gate passes
  Verify by citing `planning-workflow.md` Step 3 and a CLI test showing that `spur feature check` returns non-pass findings for invalid AC. Add a plugin contract assert that Step 3 states the loop-until-clean rule if none exists. The close-out applies the same gate to H1 itself: once 0931–0933 are done, `spur feature check H1 --json` reports no `L4.uncovered-feature-scenario`, the R2 drift grep is clean, and `spur feature sync H1` moves H1 to done.

- [ ] AC2 — Decomposition lands atomically (req: R1)
  Given a generated decomposition JSON
  When it violates task-batch.schema.json
  Then batch-create writes nothing and returns findings
  Verify with a TaskService or CLI test that submits a schema-invalid batch and asserts zero new task files plus a findings payload. Reuse the test at `task-service.test.ts:688` if it already covers schema rejection; otherwise add a sibling test.

- [ ] AC3 — Commands are thin wrappers (req: R1)
  Given any shipped sp:dev-* command
  When its definition is inspected
  Then it delegates to its owning skill and contains no pipeline logic
  Verify with a `command-contract.test.ts` assertion: every command's `## Implementation` contains `Skill(skill="sp:` and no `kind: state-machine` / `transitions:` block.

- [ ] AC4 — R9 test-driven-development remains a referenced discipline skill (req: R1)
  Given two mature systems disagree on whether TDD is its own skill
  When the split is complete
  Then test-driven-development remains a thin discipline skill referenced by code-implementation and code-testing
  And it is not absorbed into either
  Verify with a `skill-structure.test.ts` assertion that `plugins/sp/skills/test-driven-development/SKILL.md` exists and that both code-implementation and code-testing SKILL.md reference `sp:test-driven-development`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T06:57:46.971Z

- **Legacy unverified warnings (closed).** The 52 `L4.scenario-unverified` and 3 `L4.evidence-not-recoverable` warnings come from tasks that predate durable verdict artifacts. They are accepted residuals, recorded in the H1 Notes, and not re-verified retroactively. Only the four *uncovered* scenarios are in scope.

### Design

- Tests only, placed in the existing suites: `plugins/sp/tests/command-contract.test.ts`, `plugins/sp/tests/skill-structure.test.ts`, and `packages/app/tests/services/task-service.test.ts` (AC2, only if no schema-rejection test exists). No production code changes. If an assertion fails, fix the offending command or skill doc in this task. If the fix is more than trivial, stop and report it.
- H1 Notes update goes through `spur feature update H1 --section Notes --from-file`.
- **Budget.** About 2 h. Mutation policy: tests + docs.
- **Depends on** 0931 and 0933, since the drift sweep needs both. 0932 lands first through 0933.

### Plan

1. Run `spur feature check H1 --json` and record the uncovered set.
2. Add the missing assertions (AC2–AC4), then run `cd plugins/sp && bun test tests/command-contract.test.ts tests/skill-structure.test.ts` and `cd packages/app && bun test tests/services/task-service.test.ts`.
3. Run the drift grep, fix any hits, and update the H1 Notes.
4. Run `bun run spur-check`, then `spur feature refresh --feature H1` and `spur feature sync H1`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature `docs/features/H1_spur-dev-skill.md`: the three original umbrella scenarios and R9.
- `plugins/sp/skills/spur-dev/references/planning-workflow.md`; `plugins/sp/tests/command-contract.test.ts`; `plugins/sp/tests/skill-structure.test.ts`; `packages/app/tests/services/task-service.test.ts:688`.
- ADR-028 (functional decomposition), task 0161.
- Depends on 0931 and 0933.

### History

- 2026-09-23T06:58:40.575Z backlog → todo (system)

