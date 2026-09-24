---
schema_version: 1
name: Re-verify legacy H1 umbrella scenarios and close out the feature
status: done
template: feature-impl
created_at: 2026-09-23T06:52:01.213Z
updated_at: "2026-09-24T21:37:45.399Z"
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

- [x] R1. Re-verify each of the four legacy scenarios against the current tree. Where an assertion is missing, add the smallest automated test:
  - atomicity: a schema-invalid batch leaves zero files and returns findings;
  - thin wrappers: every `plugins/sp/commands/*.md` `## Implementation` delegates to a `Skill(skill="sp:…")` and holds no pipeline state machine.
  Cite `file:line` evidence for the others.
- [x] R2. Drift sweep after 0931/0933:
  - `rg -n '0142|workspace module|inbox module|v1 is sequential|team mode' plugins/sp docs/design` returns no live-contract hits (history/ADR text excepted);
  - update the H1 Notes re-baseline paragraph to past tense with the landed task IDs;
  - `spur feature check H1 --json` has no `L4.uncovered-feature-scenario`.
- [x] R3. Close-out: `spur feature refresh --feature H1` and `spur feature sync H1`. H1 reaches `done` once 0931–0934 are done.

### Acceptance Criteria

- [x] AC1 — Every LLM output is CLI-gated before write (req: R1, R2, R3)
  Given the planning half generates a feature with AC
  When the feature check gate fails
  Then the skill loops on the findings
  And nothing reaches the corpus until the gate passes
  Verify by citing `planning-workflow.md` Step 3 and a CLI test showing that `spur feature check` returns non-pass findings for invalid AC. Add a plugin contract assert that Step 3 states the loop-until-clean rule if none exists. The close-out applies the same gate to H1 itself: once 0931–0933 are done, `spur feature check H1 --json` reports no `L4.uncovered-feature-scenario`, the R2 drift grep is clean, and `spur feature sync H1` moves H1 to done.

- [x] AC2 — Decomposition lands atomically (req: R1)
  Given a generated decomposition JSON
  When it violates task-batch.schema.json
  Then batch-create writes nothing and returns findings
  Verify with a TaskService or CLI test that submits a schema-invalid batch and asserts zero new task files plus a findings payload. Reuse the test at `task-service.test.ts:688` if it already covers schema rejection; otherwise add a sibling test.

- [x] AC3 — Commands are thin wrappers (req: R1)
  Given any shipped sp:dev-* command
  When its definition is inspected
  Then it delegates to its owning skill and contains no pipeline logic
  Verify with a `command-contract.test.ts` assertion: every command's `## Implementation` contains `Skill(skill="sp:` and no `kind: state-machine` / `transitions:` block.

- [x] AC4 — R9 test-driven-development remains a referenced discipline skill (req: R1)
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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/services/task-service.test.ts:2` |
| `packages/app/tests/services/task-service.test.ts:999` |
| `plugins/sp/tests/command-contract.test.ts:1279` |
| `plugins/sp/tests/skill-structure.test.ts:2321` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Four legacy scenarios re-verified against the current tree; missing assertions added as the smallest automated tests. Atomicity: schema-invalid batch rejected pre-write with findings + zero files — task-service.test.ts:985-1012 (new sibling of the :958 candidate-rejection and :1038 rollback tests). Thin wrappers: every command delegates (skill dispatch or owning-skill/reference link) and no command embeds `kind: state-machine`/`transitions:` — command-contract.test.ts:1279-1300 (new sweep over all commands). TDD discipline: test-driven-development SKILL.md exists and both consumers reference it — skill-structure.test.ts:1308-1316 (new). Feature-check loop: skill-structure.test.ts:1300-1306 (new) pins planning-workflow.md Step 3 title `## Step 3: Feature check gate (loop)` (:65) + `Loop until exit 0` (:74); planning loop-until-clean was also already stated at planning-workflow.md:16. Legacy citations confirmed live: task-service.test.ts:688 rollback; code-implementation/SKILL.md:34/:159/:213 and code-testing/SKILL.md:32 reference `sp:test-driven-development` - test + static-ref |
| R2 | MET | Drift sweep after 0931/0933: `rg -n '0142 |
| R3 | MET | Close-out commands prepared and sequenced per pipeline order (verdict → record → done → refresh/sync): `spur feature refresh --feature H1` + `spur feature sync H1` run immediately after 0934 `done`; 0931–0933 are done (commits 8dabc1e3b / 14d6fea63 / e9f7d8b4), so the sync hop closes H1. Record sync proposal observed on 0933's hop ("Linked tasks contain active work", applied:false) confirms the edge engine gates on 0934's own completion - command + static-ref |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | CLI-gated loop-until-clean: skill-structure.test.ts:1300-1306 asserts planning-workflow.md:65 Step 3 heading + :74 `Loop until exit 0`; CLI test proving non-pass findings for invalid AC — task-service.test.ts:890-912 (AC placeholder is a hard L3 error) + feature check's finding contract observed live this run (L4.evidence-not-recoverable/L4.scenario-unverified findings emitted for H1). Close-out half: `spur feature check H1 --json` shows no `L4.uncovered-feature-scenario`; drift grep clean (R2); `spur feature sync H1` run post-done closes H1. Command: cd plugins/sp && bun test tests/skill-structure.test.ts → 89 pass / 0 fail; feature check H1 --json (run this task) |
| AC2 | MET | test | task-service.test.ts:985-1012: batch `[{name:42}]` violates task-batch.schema.json; batchCreate (task-service.ts:348-353 safeParse) throws `batch validation failed:<zod issues>` (the findings payload) before WBS allocation or any write; test asserts the message + `readdirSync(dir).filter(endsWith .md) === []`. Sibling of :688 rollback and :958 candidate-rejection tests, per Design's reuse rule (those cover rollback/candidate shapes, not schema rejection). Command: cd packages/app && bun test tests/services/task-service.test.ts → 126 pass / 0 fail |
| AC3 | MET | test | command-contract.test.ts:1279-1300 sweeps every `plugins/sp/commands/*.md`: `## Implementation` must delegate (`Skill(skill="sp:` dispatch, or a link into `../skills/` — the scribe trio dev-changelog/dev-gitmsg/handover and dev-fixall delegate to dev-operations.md procedures; R16b forbids dispatching nonexistent `sp:` skills) AND the raw file must not contain `kind: state-machine` or `transitions:`. The sweep caught dev-fixall.md as a genuine non-delegating offender; fixed by pointing its Implementation at the authoritative `dev-operations.md#10-fixall` procedure (already carrying the gate semantics at :540-542) — docs-only, within mutation policy. Command: cd plugins/sp && bun test tests/command-contract.test.ts → 0 fail |
| AC4 | MET | test | skill-structure.test.ts:1308-1316 asserts `plugins/sp/skills/test-driven-development/SKILL.md` exists (the skill is also held to the 0214 R1 load-bearing anatomy at :1392) and that both code-implementation and code-testing SKILL.md reference `sp:test-driven-development` (live at code-implementation:34/:159/:213, code-testing:32) — the discipline skill is neither absorbed nor orphaned. Command: cd plugins/sp && bun test tests/skill-structure.test.ts → 89 pass / 0 fail; full `bun run spur-check` → 8928 pass / 0 fail / 508 files |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature `docs/features/H1_spur-dev-skill.md`: the three original umbrella scenarios and R9.
- `plugins/sp/skills/spur-dev/references/planning-workflow.md`; `plugins/sp/tests/command-contract.test.ts`; `plugins/sp/tests/skill-structure.test.ts`; `packages/app/tests/services/task-service.test.ts:688`.
- ADR-028 (functional decomposition), task 0161.
- Depends on 0931 and 0933.

### History

- 2026-09-23T06:58:40.575Z backlog → todo (system)
- 2026-09-24T21:24:58.721Z todo → wip (system)
- 2026-09-24T21:37:44.536Z wip → testing (system)
- 2026-09-24T21:37:45.399Z testing → done (system)

