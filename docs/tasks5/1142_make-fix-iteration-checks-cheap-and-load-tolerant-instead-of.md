---
schema_version: 1
name: Make fix-iteration checks cheap and load-tolerant instead of re-running the full gate
status: done
template: standard
created_at: 2026-10-09T16:51:44.722Z
updated_at: "2026-10-10T02:51:54.037Z"

ac_numbering: task-local
ac_altitude: task-local
feature_id: H1
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1142-verdict.json
---

## 1142. Make fix-iteration checks cheap and load-tolerant instead of re-running the full gate

### Background

Measured from the 2026-10-08/09 session (see the session review that filed this task): the three
tasks in that session ran **nine full quality gates**, roughly 71 minutes of gate wall clock —
`1130` one run (9m51s), `1131` three (~24m), `1133` five plus a post-rebase run (~32m), and the
integration re-run (~6m). Three of the five gate runs in `1133` failed on classes that are checkable
in seconds: a biome formatter diff on two changed files, the `every-export-has-tsdoc` post-check
rule, and the `R44 — skill BODY budgets` test. One more failed on a load-sensitive test timeout.

The cheap tiers already exist and are fast. `bun run test-pre-check` runs 50 rules in 7.7 s;
`bun run test-post-check` runs 2 rules in about a second; `bunx biome check <changed paths>` finishes
in under two seconds. `packages/app/src/services/quality-gate.ts` also implements a scope-aware
`light` tier derived from the changed files, which preserves the full-tier receipt rather than
overwriting it. The inline driver never invoked any of them during fix iterations; it re-ran the full
gate each time, so every trivial fix cost 6–12 minutes.

`status command > reports project status` (apps/cli/tests/commands/status.test.ts) timed out at its
hard 5000 ms bound twice in that session while three to four worktrees were running full suites. Each
occurrence consumed a complete gate cycle, and the first looked like a failure of the change under
gate. Task 1127 serialized *gates* host-wide (the lock logs `queueWaitMs`), but concurrent *test*
runs still contend for CPU, so the timeout bound remains the defect.

**Refine corrections (2026-10-09)**

- **The driver policy half already exists.** Task 1127 R8 (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:671-683`) forbids implement and test-fix workers from running the full gate. They run the **changed-path matrix** instead (`plugins/sp/skills/code-implementation/SKILL.md:127-152`). Old R1's "the driver never invoked the cheap tiers" is therefore wrong in its premise.
- **The actual gap is that the matrix and the light tier miss three of the four observed failure classes.**
  - The matrix runs targeted tests and typechecks, but **no biome check** and **no rule presets**.
  - `planLightChecks` (`packages/app/src/services/quality-gate.ts:397-425`) runs biome, typecheck and related tests, but **no rule presets**.
  - `scopeFromFiles` maps only `<ws>/src/**` → `<ws>/tests/**`, so a change to `plugins/sp/skills/**`, `commands/**` or `references/**` maps to **no test**. The `R44 — skill BODY budgets` test in `plugins/sp/tests/skill-structure.test.ts` therefore never runs before the full gate.

  The result: biome diffs, `every-export-has-tsdoc` (post-check preset) and skill budgets were all first seen at the full gate.
- **Status-test flake.** `apps/cli/tests/commands/status.test.ts:13-16` calls `main(['status'])` with **no `cwd`**, so it scans the live repository (the whole corpus), unlike its siblings, which use a `mkdtemp` cwd (`:19-35`). Unloaded, the file runs in 0.78 s (measured 2026-10-09). The 5 s default bound is only reached because a real-repo scan contends for CPU. The fix is to isolate the input, not to change the bound.
- Feature: H1 (spur-dev umbrella skill; owns the driver reference and the 1127 lineage).

### Requirements

- [x] R1. **The light tier covers the cheap failure classes.** `planLightChecks` appends, after the biome step, two plans:
  - `rules:pre` → `bun run test-pre-check`;
  - `rules:post` → `bun run test-post-check`.

  They run whenever the scope is non-empty, in the existing light receipt. The full-tier receipt is still preserved (`quality-gate.ts:519`).
- [x] R2. **Plugin prose changes map to their structure tests.** In `scopeFromFiles`, a changed path under `plugins/sp/{skills,commands,agents,references}/**` adds `plugins/sp/tests/skill-structure.test.ts` to the `plugins/sp` workspace's tests. Under `plugins/sp/commands/**` it also adds `plugins/sp/tests/flag-contract-parity.test.ts`. A changed `plugins/sp/scripts/<x>.ts` maps to `plugins/sp/tests/<x>.test.ts` when that file exists.
- [x] R3. **Workers use the light tier as their iteration check.** `inline-pipeline-driver.md` § 1127 R8 and `code-implementation/SKILL.md` § Changed-path targeted checks state the order:
  1. the changed-path matrix (narrow behaviour tests);
  2. `bun plugins/sp/scripts/quality-gate.ts light` (biome, typecheck, rule presets, related tests).

  Neither step takes the full-gate lock. The pipeline's `test` / `test-recheck` hop remains the only full gate. No new script, verb or flag.
- [x] R4. **Measured speed and catch.** On a fixture tree, the light tier finishes in under 30 s and fails on each of these seeded defects:
  - (a) a biome formatter diff in a changed `.ts` file;
  - (b) an exported function without TSDoc (post-check preset);
  - (c) a skill `SKILL.md` body over its R44 budget.
- [x] R5. **The status test is deterministic.** `status.test.ts` `reports project status` passes a fresh `mkdtemp` cwd with a minimal `.spur/config.yaml`, as its sibling does, so it no longer scans the live repository. The default 5000 ms bound is kept. Testing records the per-test time unloaded and under four concurrent `bun run test` runs.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The light tier runs the rule presets (req: R1)
  Given a non-empty light scope
  When planLightChecks builds the plan
  Then the plan contains rules:pre and rules:post after format-lint:changed
  And a light run leaves an existing full-tier receipt intact
```

```gherkin
Scenario: AC2 — Plugin prose changes select their structure tests (req: R2)
  Given a changed path plugins/sp/skills/x/SKILL.md and a changed plugins/sp/commands/y.md
  When scopeFromFiles computes the scope
  Then the tests include plugins/sp/tests/skill-structure.test.ts and plugins/sp/tests/flag-contract-parity.test.ts
  And a changed plugins/sp/scripts/z.ts selects plugins/sp/tests/z.test.ts when it exists
```

```gherkin
Scenario: AC3 — The light tier catches the three cheap classes quickly (req: R4)
  Given a fixture tree seeded with a biome diff, an undocumented export and an over-budget skill body
  When "quality-gate.ts light" runs on it
  Then it fails naming each class
  And the measured wall clock is under 30 seconds
```

```gherkin
Scenario: AC4 — Worker docs state the iteration order (req: R3)
  Given the updated driver reference and code-implementation skill
  When a reader looks up the worker iteration check
  Then the matrix and the light tier are named in order
  And the full gate is named only for the test and test-recheck hops
```

```gherkin
Scenario: AC5 — The status smoke test no longer reads the live repository (req: R5)
  Given the status smoke test
  When it runs
  Then it passes a temporary cwd and stays under the default 5000 ms bound
  And the Testing section records its unloaded and loaded timings
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:51:53.554Z

- **Why not just make the full gate faster?** That is a different, larger problem (10.6k tests). The
  measured loss here is not gate speed but *repeating* the gate for fixes whose failure class is
  checkable in seconds. Fixing the iteration order removes the loss without touching the gate.
- **Is the light tier trusted for the boundary?** No. It is the iteration check only. The boundary
  still requires the full gate, and a post-gate source edit requires it again (the freeze boundary
  owned by task 1135).
- **Why include a test-timing fix in this task?** It is the same measured cost centre — a load
  artifact that forced a full gate cycle — and the fix is local. Keeping it separate would produce a
  second task for a few lines.
- **Deferred:** any change to gate scheduling or to the host-wide lock (task 1127 already serialized
  gates); any change to the rule set itself.

#### Q&A entry — 2026-10-09T18:13:37.680Z

- **Q: Should we add a new "iteration" mode?** A (closed 2026-10-09): no. The existing `light` mode (0939/ADR-124) is the iteration tier. This task fills its coverage gaps and points the worker docs at it.
- **Q: Is the rule-preset cost acceptable inside light?** A: yes. The pre-check preset ran 50 rules in 7.7 s and post-check took about 1 s (session measurement). That is well inside the R4 budget of 30 s.
- **Q: What about the status-test bound?** A: keep 5000 ms. The test was slow only because it scanned the live repository; isolating the cwd removes the load sensitivity at its source.

### Design

- **`quality-gate.ts`.**
  - `planLightChecks`: after `format-lint:changed`, push `{id:'rules:pre', cmd:'bun run test-pre-check'}` and `{id:'rules:post', cmd:'bun run test-post-check'}` when `scope.files.length > 0`.
  - `scopeFromFiles`: add a `plugins/sp` branch implementing the R2 mappings, with each candidate tested by `exists()` as the `src → tests` branch already does.
  - Tests go in `packages/app/tests/services/quality-gate*.test.ts`, extending the existing plan and scope assertions.
- **Docs.** Two prose edits (R3). The `inline-pipeline-parity-check` and the skill budget test must stay green.
- **Status test.** Copy the sibling's `mkdtemp` + `.spur/config.yaml` setup. Assert `exitCode === 0` instead of `typeof number`, which is a stronger smoke check.
- **Boundaries.**
  - No change to the full gate, the gate lock, or the receipt schema.
  - No new flag or verb.
  - No change to the `test`/`test-recheck` YAML.
- **Failure inventory (tests first).**
  - Rule presets running from a workspace cwd. They must run from the repo root, so their plans carry no `cd`.
  - A plugin mapping selecting a non-existent test.
  - The light tier overwriting a full receipt.
  - The skill-structure test being slow enough to break R4.

### Plan

1. Write the plan and scope tests for R1/R2 and the seeded fixture for R4. Confirm they fail.
2. Implement R1/R2 in `quality-gate.ts`.
3. R5: isolate the status test, then measure it unloaded and under load.
4. R3: make the doc edits.
5. Acceptance drill. Seed the three defects in a scratch worktree, run `bun plugins/sp/scripts/quality-gate.ts light`, and record the output and wall clock.
6. Run `bun run spur-check`.

### Solution

Change map (file:line in task worktree):

| File | Change |
| --- | --- |
| `packages/app/src/services/quality-gate.ts:471` | `planLightChecks` appends `rules:pre` (`bun run test-pre-check`) and `rules:post` (`bun run test-post-check`) after the biome step whenever `scope.files.length > 0` (R1). Full-tier receipt is preserved. |
| `packages/app/src/services/quality-gate.ts:405` | `lightScope` (and exported alias `scopeFromFiles`) adds mappings for `plugins/sp/{skills,commands,agents,references}/**` to `plugins/sp/tests/skill-structure.test.ts`, `plugins/sp/commands/**` to `plugins/sp/tests/flag-contract-parity.test.ts`, and `plugins/sp/scripts/<x>.ts` to `plugins/sp/tests/<x>.test.ts` when it exists (R2). |
| `apps/cli/tests/commands/status.test.ts:13` | `reports project status` uses a fresh `mkdtemp` cwd with minimal `.spur/config.yaml`, isolating it from live repository scanning so it is deterministic and fast (R5). |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:684` | States the worker iteration order (changed-path matrix, then `quality-gate.ts light`), reserving full gate for `test`/`test-recheck` (R3). |
| `plugins/sp/skills/code-implementation/SKILL.md:135` | Documents the worker iteration check order in § Changed-path targeted checks (R3). |
| `plugins/sp/tests/quality-gate-receipt.test.ts:220` | Unit tests for AC1 (rules:pre and rules:post in plan), AC2 (plugin prose and script mapping), AC3 (light tier catch on format-lint diff) (R1, R2, R4). |
| `scripts/commands/bundle-plugin-lib.ts:518` | Declares `scopeFromFiles` export in quality-gate declarations. |

Rationale: repeating full gates for cheap failures wastes hours of developer and agent time. Adding pre/post rule checks to the light tier catches biome, TSDoc, and rule violations in seconds without full-gate lock contention.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/quality-gate.ts:514` planLightChecks pushes rules:pre and rules:post after format-lint:changed at `:523-524`; asserted by `plugins/sp/tests/quality-gate-receipt.test.ts:247`; full-tier receipt preserved per `plugins/sp/tests/quality-gate-receipt.test.ts:517` |
| R2 | MET | `packages/app/src/services/quality-gate.ts:429-461` maps plugins/sp prose to skill-structure.test.ts, commands to flag-contract-parity.test.ts, scripts to their tests; alias at `:479`; asserted by `plugins/sp/tests/quality-gate-receipt.test.ts:223` |
| R3 | MET | worker iteration order at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:744-752` and `plugins/sp/skills/code-implementation/SKILL.md:155-168`; pinned this run by `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:109` (verify fix pass: the prior Testing cited skill-structure.test.ts doc assertions that do not exist) |
| R4 | MET | Drill this run on a detached scratch worktree of HEAD seeded with a biome diff plus undocumented export (packages/app/src/seeded-drill.ts) and a 600-line padded code-verification SKILL.md: quality-gate.ts light reported FAIL in 16 s wall; format-lint:changed FAIL, rules:post FAIL (every-export-has-tsdoc), test:plugins/sp FAIL (R44 skill BODY budgets); worktree removed after the run |
| R5 | MET | `apps/cli/tests/commands/status.test.ts:13-16` uses a mkdtemp cwd with minimal .spur/config.yaml; junit timing this run: 0.090 s unloaded, 0.166 s under four concurrent apps/cli bun run test (load average 22.4); 5000 ms bound kept |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The light tier runs the rule presets (req: R1) | MET | test | `plugins/sp/tests/quality-gate-receipt.test.ts:247` run-order case and `:517` full-tier receipt case; 43 pass 0 fail this run |
| AC2 — Plugin prose changes select their structure tests (req: R2) | MET | test | `plugins/sp/tests/quality-gate-receipt.test.ts:223` prose and script mapping case |
| AC3 — The light tier catches the three cheap classes quickly (req: R4) | MET | command | bun plugins/sp/scripts/quality-gate.ts light on the seeded scratch worktree: status FAIL, 16 s wall (< 30 s); receipt rows format-lint:changed FAIL, rules:pre FAIL, rules:post FAIL naming every-export-has-tsdoc, test:plugins/sp FAIL naming R44 skill BODY budgets; unit backstop `plugins/sp/tests/quality-gate-receipt.test.ts:502` |
| AC4 — Worker docs state the iteration order (req: R3) | MET | test | `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:109` asserts matrix before light tier and the full gate named only for test/test-recheck in both docs; 9 pass 0 fail |
| AC5 — The status smoke test no longer reads the live repository (req: R5) | MET | test | `apps/cli/tests/commands/status.test.ts:13` reports project status: 0.090 s unloaded, 0.166 s under four concurrent test runs, 4 pass 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Self-review over the full diff (SECUA + traceability). No P1/P2 findings; disposition PASS.

| Sev | Finding | Disposition |
| --- | --- | --- |
| P1 | — | none found |
| P2 | — | none found |
| P3 | `rules:pre` and `rules:post` add ~12s to light tier runs. | Accepted: 12 seconds is vastly faster than re-running a 6–10 minute full gate with lock queue waits. |
| P4 | `scopeFromFiles` is an alias of `lightScope`. | Exported to maintain parity with the task specification naming. |

Requirement traceability:
- R1: `planLightChecks` appends `rules:pre` and `rules:post` when scope is non-empty. Full-tier receipt is preserved.
- R2: `lightScope` maps `plugins/sp` prose and script paths to structure tests.
- R3: Worker iteration order documented in `inline-pipeline-driver.md` and `code-implementation/SKILL.md`.
- R4: Light tier catches formatting, TSDoc, and rule violations quickly.
- R5: `status.test.ts` uses temp dir with minimal config; deterministic and fast.

### References

- Light tier: `packages/app/src/services/quality-gate.ts:184-189` (tiers), `:340-366` (`scopeFromFiles`), `:397-425` (`planLightChecks`), `:519` (full receipt preserved). CLI script: `plugins/sp/scripts/quality-gate.ts:43`.
- Worker rule: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:671-683` (1127 R8). Matrix: `plugins/sp/skills/code-implementation/SKILL.md:127-152`.
- Presets: `package.json:79-80`. Budget test: `plugins/sp/tests/skill-structure.test.ts` (R44).
- Status test: `apps/cli/tests/commands/status.test.ts:13-16`; sibling pattern at `:18-42`.
- Lineage: 0939 (light tier), 1111 (deferred tier), 1127 (gate lock and worker rule).

### History

- 2026-10-09T16:52:23.334Z backlog → todo (system)
- 2026-10-10T00:16:28.669Z todo → wip (system)
- 2026-10-10T00:16:31.379Z wip → testing (system)
- 2026-10-10T00:16:35.162Z testing → done (system)

