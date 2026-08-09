---
template: meta
schema_version: 1
name: "Fix H1 pipeline contract defects: implement scope, agent pin, review table, fixall repeats"
description: ""
status: done
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-08T22:39:52.388Z"
updated_at: "2026-08-09T01:34:18.712Z"
---

## 0483. Fix H1 pipeline contract defects: implement scope, agent pin, review table, fixall repeats

### Background
The H1 feature batch (tasks 0480, 0482) completed with PASS verdicts but consumed roughly 4.3 hours
of wall clock (2026-08-08T16:20Z → 20:37Z) against ~1.5 h of pure agent pipeline time. Forensic
analysis of the pipeline run logs and the OMP agent session JSONL files under
`.spur/run/*/agent-sessions/` isolated four *actionable* defects, all of them contract or wiring
bugs rather than agent misbehaviour:

1. The implement hop is permitted to re-run the project quality gate that the pipeline's own `test`
   hop runs seconds later (R1).
2. `--agent` does not reach the implement hop, because `implementAgent` is an independent literal —
   which cost three aborted pipeline starts (R2).
3. `sp:functional-review` instructs the review agent to write a table shape into `### Review` that
   the L3 `review-priority-table` gate structurally rejects, which denied the `wip→testing` record
   transition and forced manual section repair (R3).
4. A single `/sp:dev-fixall` hop re-runs the full gate several times instead of deferring the
   deciding run to `test-recheck` (R4).

**Already resolved — not in scope.** The largest single measured waste was context compaction:
0480's implement session on `omp-zai`/glm-5.2 logged 8 compactions (16:44–17:07, ~1 per 3 min) plus
2 more in its review, against 0 across every `omp-dsv4-flash-volc` session. That was fixed before
this task was written — commit `a801891d` set `.spur/config.yaml:32` `agent.default` to
`omp-dsv4-flash-volc`, and `omp-zai-volc` is already commented out at `:72-75`. Re-specifying it
here would produce an empty diff and trip the pipeline's `requireDiff: true` guard. See Notes for
the residual `omp-zai` roster entry and why it is deliberately left alone.

Topic filter: none (full taxonomy scan of the H1 run sessions).
### Requirements
- [x] R1. **Ban project-gate commands inside the implement hop** — add an explicit rule to
  `plugins/sp/skills/code-implementation/SKILL.md` (the skill `/sp:dev-run --mode implement`
  dispatches; the file currently carries *no* test-scope guidance at all): during implement, run only
  targeted probes (`bun test <file>`, `--test-name-pattern`); never `bun run test` or
  `bun run spur-check`. Rationale is redundancy, not wall time — the pipeline's `test` hop runs
  `${vars.qualityGateCmd}` immediately after and is the gate that actually decides. Verified scope:
  0482's implement session issued 3× `bun run test` + 1× `bun run spur-check`; 0480's issued none.
- [x] R2. **Make `--agent` actually cover the implement hop** — `config/workflows/task-pipeline.yaml:62`
  claims `implementAgent` "Defaults to same as agent", but `:63` is the hardcoded literal `"omp"`, so
  a caller pinning `--agent X` silently leaves implement on `omp`. Fix mechanically at the single
  `--agent` → `--vars` forwarding boundary (`spur-dev/references/execution-batch.md` R4.3, the only
  place the flag crosses into per-task vars) so the pin populates **both** `agent` and
  `implementAgent`, and correct the false YAML comment. Documentation alone is not the fix: the split
  is *already* documented at `cross-cutting.md:131-144`, `docs/04_DESIGN.md:1081-1084`,
  `flag-glossary.md:43`, `dev-operations.md:83`, `cmd_workflow.md:79` — and the incident still
  happened.
- [x] R3. **Fix the `### Review` write contract in `sp:functional-review`** —
  `plugins/sp/skills/functional-review/SKILL.md:247` instructs the agent to run
  `spur task update <wbs> --section Review --from-file …` carrying the `| Req | Status | Evidence |`
  traceability table from `:262-270`. That table can never satisfy the L3 gate, which requires a cell
  matching `/^\s*P[1-4]\s*$/` (`packages/app/src/services/task-check.ts:96-106`). Either retarget that
  write away from `Review`, or require the emitted body to lead with a
  `| Priority | Dimension | Location | Finding |` table. Also reconcile the ownership contradiction:
  `functional-review/SKILL.md:272-273` says the record step transcribes its output into `## Review`,
  while `code-verification/SKILL.md:295-300` says `## Review` is owned by the review step and record
  transcribes only `## Testing`. One of the two is wrong; `task-record.ts:226-247` (`renderReview`)
  is the arbiter.
- [x] R4. **One gate run per `/sp:dev-fixall` hop** — `plugins/sp/commands/dev-fixall.md`: fix from the
  captured `--gate-log` anchor, re-run the gate at most once to confirm, then return and let the
  pipeline's `test-recheck` state be the deciding run. Do **not** narrow `qualityGateCmd` itself —
  `test-recheck` must execute the full gate or its PASS is meaningless. Evidence: the 0482 test-fix
  session ran the full gate three times plus a standalone `bun run test` inside a single hop.
### Acceptance Criteria
```gherkin
Feature: H1 batch pipeline contract fixes

  Scenario: R1 implement never runs the project gate
    Given plugins/sp/skills/code-implementation/SKILL.md
    When the implement scope rule is read
    Then it forbids `bun run test` and `bun run spur-check` during implement
    And it directs the agent to targeted probes plus the pipeline `test` hop

  Scenario: R2 a pinned --agent reaches the implement hop
    Given a caller passes --agent <name> to a pipeline run
    When the forwarding boundary builds per-task --vars
    Then the vars payload sets both "agent" and "implementAgent" to <name>
    And the implement step's agent.run logs `agent=<name>`, not `agent=omp`

  Scenario: R2 the pipeline comment matches the pipeline behaviour
    Given config/workflows/task-pipeline.yaml
    When the implementAgent var declaration is read
    Then its comment no longer claims it defaults to the `agent` var unless that is true

  Scenario: R3 the review write contract can satisfy the L3 gate
    Given plugins/sp/skills/functional-review/SKILL.md
    When its `### Review` write instruction is followed verbatim
    Then the resulting body satisfies hasPopulatedPriorityTable
    And `spur task check` reports no L3_REVIEW_PRIORITY_TABLE finding

  Scenario: R3 Review ownership is stated once
    Given functional-review/SKILL.md and code-verification/SKILL.md
    When both describe who writes `## Review` under the pipeline
    Then the two statements agree with renderReview in task-record.ts

  Scenario: R4 a fixall hop runs the gate at most once
    Given plugins/sp/commands/dev-fixall.md
    When its remediation loop is read
    Then it fixes from the --gate-log anchor and re-runs the full gate at most once
    And qualityGateCmd itself is unchanged so test-recheck still runs the full gate
```
### Q&A
- Q: The draft called R1 (implement heaviness) the top fix. Why is it now the smallest?
  - A: Because the session logs contradict the draft. 0480's implement ran zero full-suite commands
    and was the *slower* of the two (27.6 min); 0482 ran four and was faster (23.6 min). The variable
    that actually tracked implement wall time was compaction — 8 events on 0480, 0 on 0482 — and that
    is already fixed. R1 remains worth doing because a gate run inside implement is redundant with
    the `test` hop that follows it, but it is a cleanliness fix, not the batch's dominant cost.

- Q: Why was R2 (executor default) dropped entirely?
  - A: It is already in the tree. `a801891d` set `.spur/config.yaml:32` to `omp-dsv4-flash-volc` and
    `omp-zai-volc` is commented out at `:72-75`. Re-specifying it yields an empty diff, which the
    implement hop's `requireDiff: true` guard (`task-pipeline.yaml:176-180`) treats as a no-op
    failure and routes to `failed`. A requirement that cannot produce a diff cannot pass this
    pipeline.

- Q: Why is the `implementAgent` fix mechanical rather than documentation?
  - A: The documentation already exists in five places, including an SSOT section in
    `cross-cutting.md:141-144` that states explicitly that `implementAgent` is not derived from
    `agent` and must be passed separately. The incident occurred with all of that in place.
    Prescribing more prose repeats a remedy that has already failed. The defect is that
    `task-pipeline.yaml:62` documents behaviour the code does not implement — so either the comment
    or the wiring must change, and the wiring is the one callers actually want.

- Q: Why did the review agent write the wrong table?
  - A: Because `sp:functional-review` told it to. `functional-review/SKILL.md:247` instructs a
    `--section Review` write, and `:262-270` defines the payload as `| Req | Status | Evidence |`.
    The L3 gate needs a `/^\s*P[1-4]\s*$/` cell. The agent complied with its skill and the gate
    rejected the result — a contract bug in one file. The draft's target, `code-review/SKILL.md`, is
    not even loaded by `/sp:dev-review`.

- Q: Should `test-fix` run only the failing tests, as the draft proposed?
  - A: No. `test-recheck` (`task-pipeline.yaml:259-270`) is what writes `PASS` to the gate status
    file; if it runs a narrowed command, a green status no longer means the suite is green. The
    fixable waste is repetition *inside* one fixall hop — the 0482 hop ran the full gate three times
    before exiting into a fourth run. R4 bounds that and leaves `qualityGateCmd` and `test-recheck`
    alone.

- Q: Is this still worth a dedicated task after dropping one requirement and rewriting three?
  - A: Yes, and more clearly than before. R2 and R3 are concrete wiring/contract bugs with confirmed
    reproductions (three aborted starts, one denied record transition); R1 and R4 are cheap
    single-file edits. All four are documentation- and config-scale changes with no production code
    risk.

- Q: What is the honest expected saving?
  - A: Smaller than the draft's "~40–60 min per 2-task batch", because the ~20–25 min compaction
    component was already banked by `a801891d`. What remains is the recovery time this batch spent
    on three aborted starts and one manual Review repair — call it 30–45 min of avoided wall time
    per recurrence, plus one redundant gate run per implement and two per fixall hop.
### Design
All paths below were resolved against the working tree. The original draft cited
`plugins/sp/skills/sp-code-implementation/`, `sp-code-review`, and `sp-code-verification` — none of
those directories exist; the real names carry no `sp-` prefix (`plugins/sp/skills/code-implementation/`,
`code-review/`, `code-verification/`).

#### R1 — implement must not run the project gate

- Target: `plugins/sp/skills/code-implementation/SKILL.md`. A grep for
  `bun run test|spur-check|full-suite|targeted|test-name-pattern` over that skill returns **nothing**,
  so this is greenfield guidance, not a tightening.
- Why this skill: `task-pipeline.yaml:169-172` invokes `/sp:dev-run --mode implement <wbs> --auto`,
  and `dev-run --mode implement` dispatches `sp:code-implementation`. Anti-recursion and implement
  discipline are deliberately kept in the skill, not in YAML prose (ADR-043, per the comment at
  `task-pipeline.yaml:170-171`) — so the rule belongs in the skill.
- Scope claim, measured: 0482's implement session issued `bun run test` ×3 and `bun run spur-check`
  ×1; 0480's issued zero (its runs were all `bun test <file>` / `--test-name-pattern`, i.e. already
  compliant). This is a redundancy fix worth roughly one gate-run per implement, not the batch's
  dominant cost.

#### R2 — `--agent` must reach implement

- `config/workflows/task-pipeline.yaml:62` reads "Implement-only executor override (R1, task 0454).
  Defaults to same as agent." — `:63` is `implementAgent: "omp"`, an independent literal. The comment
  is false and is the proximate cause of the foot-gun.
- Confirmed in the logs: both aborted runs recorded
  `→ implement/agent.run · agent=omp` at seq=13 (`bd1949dc` 16:20:44, `78678365` 16:36:06) while the
  operator had pinned a different executor, and the sole `agent-sessions/` subdirectory in each run
  is `omp/`. Both then died on a 403 quota against `omp`.
- Single fix point: `plugins/sp/skills/spur-dev/references/execution-batch.md` documents
  `--agent <value>` as the only flag that crosses the orchestrator→pipeline boundary into per-task
  `--vars` (R4.3, echoed by `dev-operations.md:83`). Setting both keys there fixes every caller at
  once. Then correct the `task-pipeline.yaml:62` comment.
- Note the tension to respect: `cross-cutting.md` §"Executor exhaustion is survivable, not a
  pin-away problem" (task 0482 R1/R5) argues against treating executor pinning as durable guidance.
  R2 is not a pin recommendation — it makes an *existing* pin behave as documented.

#### R3 — the `### Review` write contract

- `/sp:dev-review` (invoked by `task-pipeline.yaml:278`) dispatches `sp:functional-review` +
  `sp:code-verification` + `sp:code-improvement` (`plugins/sp/commands/dev-review.md:29`). It does
  **not** load `sp:code-review` — the original draft's target. `code-review/SKILL.md` is the
  requesting/receiving-a-review skill and is not in this path.
- `functional-review/SKILL.md:247` instructs:
  `spur task update <wbs> --section Review --from-file /tmp/<wbs>-functional.md`, and `:262-270`
  defines that file's content as the `| Req | Status | Evidence |` traceability table.
- The gate: `hasPopulatedPriorityTable` (`packages/app/src/services/task-check.ts:96-106`) scans
  each `|`-split row for a cell matching `/^\s*P[1-4]\s*$/` with at least one non-placeholder
  sibling cell. A `| Req | Status | Evidence |` table has no such cell, so the L3
  `L3_REVIEW_PRIORITY_TABLE` finding fires at `:511-517` and denies `wip→testing`.
- Conclusion: the 0480 review agent followed its skill's documented contract exactly. This is a
  contract bug in one file, not an agent-discipline gap.
- The correct shape is already written down twice — `code-verification/SKILL.md:281` and
  `task-record.ts:226-247` (`renderReview`) both emit
  `| Priority | Dimension | Location | Finding |`. Reuse that shape; do not invent a third.
- Ownership contradiction to settle in the same change: `functional-review/SKILL.md:272-273` claims
  the record step transcribes its output into `## Review`; `code-verification/SKILL.md:295-300`
  claims record transcribes only `## Testing` and that `## Review` is owned by the review step, with
  `task-service.ts:485`'s `sectionIsBare` guard preserving non-bare Review content.

#### R4 — fixall hop discipline

- `task-pipeline.yaml:247` passes `/sp:dev-fixall "${vars.qualityGateCmd}"`, and `:85` sets
  `qualityGateCmd: "bun run format && bun run spur-check"`. The test-fix agent ran the full gate
  because the pipeline handed it that exact command — the original draft's framing ("despite
  AGENTS.md's targeted-test-first guidance") misattributes a wiring outcome to agent discretion.
- Do not narrow `qualityGateCmd` or the `test-recheck` shell at `:259-270`: that recheck is what
  writes `PASS` to `.spur/run/<wbs>-test-gate.status`, and a targeted recheck passing would not
  prove the suite is green.
- Real waste, measured in the 0482 test-fix session (20:02:04): the full gate ran three times
  (`> /tmp/fixall-gate.log`, `> /tmp/fixall-gate2.log`, `| tail -200`) plus a standalone
  `bun run test`, all inside one hop whose exit is followed immediately by `test-recheck` running
  the gate again.
- Partial mitigation already in the working tree (task 0482 R3): `task-pipeline.yaml` now captures
  the gate output to `.spur/run/<wbs>-test-gate.log` and passes `--gate-log` to `/sp:dev-fixall`.
  `plugins/sp/commands/dev-fixall.md` is modified in the same uncommitted change — build R4 on top
  of it rather than re-deriving it.
### Plan
Plan items are deliberately written without an `R<n>.` prefix: the implement-size precheck matches
`R_ITEM_RE` (`/^\s*-\s*\[[ xX]\]\s*(\*\*)?R\d+\./`) against the *whole* document while it scopes the
Plan count to the Plan section, so `R#.`-prefixed plan items are double-counted as requirements and
trip `maxImplementReqs`. Requirement mapping is given inline in parentheses.

- [x] Add the implement test-scope rule to `plugins/sp/skills/code-implementation/SKILL.md` (R1)
- [x] Forward `--agent` into both `agent` and `implementAgent` at the execution-batch boundary, and correct the false `task-pipeline.yaml:62` comment (R2)
- [x] Correct the `### Review` write contract in `plugins/sp/skills/functional-review/SKILL.md` and settle Review ownership against `renderReview` (R3)
- [x] Bound `/sp:dev-fixall` to one confirming gate run per hop in `plugins/sp/commands/dev-fixall.md` (R4)
### Solution
All four defects fixed; each is a contract/wiring change with no production-code risk.

**R1 — implement scope (code-implementation/SKILL.md).** Added `## Implement scope: do not run the project quality gate` after the Anti-recursion section. Forbids `bun run test`, `bun run spur-check`, `bun run check` inside implement; directs to targeted probes (`bun test <file>`, `--test-name-pattern`) and defers the full gate to the pipeline `test` hop.

**R2 — `--agent` reaches implement.** Two-part fix:
1. `execution-batch.md` §3.2 R4.3 row + `execution-workflow.md` single-task path + `cross-cutting.md` SSOT: `--agent <value>` now forwards into **both** `agent` and `implementAgent` keys in per-task `--vars`, so a pinned executor reaches every hop including implement. `plugins/sp/skills/spur-dev/references/cross-cutting.md:140-144` (the SSOT that previously said `--agent` affects every hop *except* implement) was corrected to match — this was a five-place consistency obligation.
2. `config/workflows/task-pipeline.yaml:60-64` comment corrected: no longer claims `implementAgent` "Defaults to same as agent"; now documents the forwarding rule and the `--vars '{"implementAgent":"..."}'` escape hatch for pinning implement only.

**R3 — Review write contract (functional-review/SKILL.md).** Step 7 rewritten: `--section Review` payload now MUST lead with `| Priority | Dimension | Location | Finding |` (P4 row for clean, P1–P3 for findings) before the traceability table. This satisfies `hasPopulatedPriorityTable` (`packages/app/src/services/task-check.ts:96-106`). Ownership contradiction settled: functional-review owns `## Review` (it is the review step dispatched by `/sp:dev-review`); record step transcribes only `## Testing`; `sectionIsBare` preserves non-bare Review content. Matches `plugins/sp/skills/code-verification/SKILL.md:293-300` and `renderReview` (`packages/app/src/services/task-record.ts:226-247`).

**R4 — fixall gate discipline (dev-operations.md #10 + dev-fixall.md).** Behavior loop rewritten: targeted probes during fix loops (not full gate per fix), one confirming full-gate run at most (step 8), step 9 makes pipeline-awareness explicit — `test-recheck` is the deciding run, so a second/third gate run inside fixall is pure redundancy. `qualityGateCmd` unchanged. `dev-fixall.md` surfaces the one-gate-run rule.

**Validation.** `spur task check 0483` PASS (L4 advisory only). `spur workflow validate task-pipeline.yaml` valid. `spur rule run` 43 rules, 0 findings. `validate-flag-contracts.ts` — all 64 surfaces agree. `corpus-check` OK (0 new, 0 stale).
### Testing
**Verdict: PASS** (re-verified 2026-08-09 with `--force --focus all --fix all`; all line anchors re-read this run)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/code-implementation/SKILL.md:55-67` — `## Implement scope` forbids `bun run test`/`bun run spur-check`/`bun run check` during implement; directs targeted probes + defers to pipeline `test` hop (re-read this run) |
| R2 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:223` (`--agent` sets both `agent`+`implementAgent`), `plugins/sp/skills/spur-dev/references/execution-workflow.md:121-130`, `plugins/sp/skills/spur-dev/references/cross-cutting.md:140-144`, `config/workflows/task-pipeline.yaml:60-64` (comment corrected); `validate-flag-contracts.ts` 64/64 agree, `flag-contract-parity.test.ts` 40/40 pass |
| R3 | MET | `plugins/sp/skills/functional-review/SKILL.md:241-294` — Review body leads with `\| Priority \| Dimension \| Location \| Finding \|` (P4 clean row satisfies `hasPopulatedPriorityTable`, `packages/app/src/services/task-check.ts:96-106`); ownership settled vs `plugins/sp/skills/code-verification/SKILL.md:293-300` + `renderReview` (`packages/app/src/services/task-record.ts:226-247`) |
| R4 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md:383-395` (step 8: one confirming gate run; step 9: `test-recheck` is the deciding run; invariant at :395) + `plugins/sp/commands/dev-fixall.md:29-32`; `qualityGateCmd` unchanged at `config/workflows/task-pipeline.yaml:87`; `test-recheck` full-gate shell unchanged at `:259-272` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 implement never runs the project gate | MET | static | `plugins/sp/skills/code-implementation/SKILL.md:64-65` NEVER list names `bun run test`, `bun run spur-check`, `bun run check`; :62-63 directs targeted probes; :57-60 defers deciding run to pipeline `test` hop |
| Scenario: R2 a pinned --agent reaches the implement hop | MET | test | `plugins/sp/tests/flag-contract-parity.test.ts` — 40 pass 0 fail (this run); `validate-flag-contracts.ts` — all 64 surfaces agree (this run) |
| Scenario: R2 the pipeline comment matches the pipeline behaviour | MET | static | `config/workflows/task-pipeline.yaml:60-64` no longer claims "Defaults to same as agent"; documents the both-keys forwarding rule + `--vars '{"implementAgent":"..."}'` escape hatch |
| Scenario: R3 the review write contract can satisfy the L3 gate | MET | static | `plugins/sp/skills/functional-review/SKILL.md:251-253` payload leads with `\| P4 \| — \| — \| … \|`; gate regex `/^\s*P[1-4]\s*$/` at `packages/app/src/services/task-check.ts:100` + non-placeholder sibling at :102 both satisfied |
| Scenario: R3 Review ownership is stated once | MET | static | `plugins/sp/skills/functional-review/SKILL.md:289-294` (owns `## Review`) agrees with `plugins/sp/skills/code-verification/SKILL.md:293-300` (record transcribes only `## Testing`) and `renderReview` `packages/app/src/services/task-record.ts:225-246` |
| Scenario: R4 a fixall hop runs the gate at most once | MET | static | `plugins/sp/skills/spur-dev/references/dev-operations.md:392` confirming run "at most once"; :393 defers deciding run to `test-recheck`; `qualityGateCmd` `config/workflows/task-pipeline.yaml:87` unchanged |

**Commands run (all this run, repo root):**

| Command | Outcome |
| --- | --- |
| `spur task check 0483 --json` | PASS — L4 advisories only (uncovered-task-scenario, expected for meta tasks); no L1–L3 findings |
| `spur workflow validate config/workflows/task-pipeline.yaml --json` | `valid: true` |
| `spur rule run --json` | 43 rules, 0 findings, 0 fixes |
| `bun run plugins/sp/scripts/validate-flag-contracts.ts` | All 64 contract surfaces agree |
| `bun test plugins/sp/tests/flag-contract-parity.test.ts` | 40 pass, 0 fail |
| `bun run corpus-check` | OK — 4 baselined, 0 new, 0 stale |

Coverage: N/A (documentation/contract-only change; no runtime code path added).

**Fix pass disclosure (`--fix all`).** One stale line anchor found and repaired this run: `sectionIsBare` lives at `packages/app/src/services/task-service.ts:485`, not `:563`. Corrected in deliverables `plugins/sp/skills/functional-review/SKILL.md:293` and `plugins/sp/skills/code-verification/SKILL.md:245,299` (tracked files, visible in `git status`), and in this task's Design/References sections via CLI. Verdict artifact: `.spur/run/0483-verdict.json` (gitignored, written this run after verdict final).

**Anchor correction (0482 R3 follow-on, 2026-08-08).** Task 0482 R3 added a `--findings <anchors>` row to `dev-fixall.md`'s Argument Flags table, shifting the R4 pipeline-awareness paragraph from `:28-31` to `:29-32`. Citation updated above; content re-read and unchanged. `dev-operations.md` steps 8/9 and the invariant remain at `:392`, `:393`, `:395`. Re-verified this run: `validate-flag-contracts.ts` all 64 contract surfaces agree; `bun test plugins/sp/tests/` 516 pass.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; all four defects fixed at contract/wiring layer, no production code risk. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `code-implementation/SKILL.md:55-67` — `## Implement scope` forbids `bun run test`/`spur-check` during implement; directs to targeted probes + pipeline `test` hop |
| R2 | MET | `execution-batch.md:223`, `execution-workflow.md:121-130`, `cross-cutting.md:140-144` — `--agent` forwards into both `agent` + `implementAgent`; `task-pipeline.yaml:60-64` comment corrected; `validate-flag-contracts.ts` 64/64 agree |
| R3 | MET | `functional-review/SKILL.md:241-294` — Step 7 payload leads with `\| Priority \| Dimension \| Location \| Finding \|` (P4 clean row); ownership settled: functional-review owns `## Review`, record transcribes only `## Testing`, matches `renderReview` |
| R4 | MET | `dev-operations.md:383-395` — fix loop uses targeted probes, one confirming gate run (step 8), step 9 defers deciding run to `test-recheck`; `dev-fixall.md:28-31` surfaces the rule; `qualityGateCmd` unchanged |

**Residual risk:** Low. R2 changes documentation of `--agent` forwarding semantics across 4 reference files; the actual `--vars` construction lives in the thin command wrappers which read these references as their contract. If a future wrapper hardcodes only `"agent"`, implement would silently fall back — but `validate-flag-contracts.ts` now enforces parity, so drift is caught. R4 is advisory discipline on the test-fix agent; a non-compliant agent could still over-run the gate, but the cost is wall time, not correctness.
### References
Edit targets (all verified present in the working tree):

- R1: `plugins/sp/skills/code-implementation/SKILL.md`
- R2: `plugins/sp/skills/spur-dev/references/execution-batch.md` (`--agent` → `--vars` boundary, R4.3);
  `config/workflows/task-pipeline.yaml:62-63`
- R3: `plugins/sp/skills/functional-review/SKILL.md:247,262-273`;
  cross-check `plugins/sp/skills/code-verification/SKILL.md:281,295-300`
- R4: `plugins/sp/commands/dev-fixall.md` (already modified in the tree by task 0482 R3)

Read-only contracts consulted (do not edit as part of this task):

- L3 review gate: `packages/app/src/services/task-check.ts:96-106` (`hasPopulatedPriorityTable`),
  `:492-517` (finding emission)
- Review render contract: `packages/app/src/services/task-record.ts:226-247` (`renderReview`)
- Record section-preservation guard: `packages/app/src/services/task-service.ts:485` (`sectionIsBare`)
- Review dispatch: `plugins/sp/commands/dev-review.md:29`
- Pipeline vars and steps: `config/workflows/task-pipeline.yaml:59,63,85,169,247,259-270`
- Implement-size precheck: `plugins/sp/scripts/task-size-precheck.ts:108,114`
- Executor roster: `.spur/config.yaml:32,72-79`
- Prior guidance to stay consistent with: `plugins/sp/skills/spur-dev/references/cross-cutting.md:131-144`
  (implementAgent SSOT) and its "Executor exhaustion is survivable" section (task 0482 R1/R5)

Forensic sources:

- 0480 run `d1d03ef6`: `.spur/run/d1d03ef6-cdf4-4e3c-895d-313cd066ebfc.log` + `agent-sessions/omp-zai/`
  (implement `2026-08-08T16-43-13…jsonl`, 8 compactions; review `…T17-11-40…jsonl`, 2)
- 0482 run `08d76749`: `.spur/run/08d76749-8c30-4582-b42c-b37a53038059.log` +
  `agent-sessions/omp-dsv4-flash-volc/` (implement `…T19-37-48…jsonl`; test-fix `…T20-02-04…jsonl`)
- Wrapup run `e0fdf1f6`: `.spur/run/e0fdf1f6-98b7-49e2-a8d0-9644eb4cbf62.log`
- Aborted starts: `1096bb93…log` (precheck doctor `status: missing`), `bd1949dc…log` and
  `78678365…log` (both `implement/agent.run · agent=omp` at seq=13, then 403 quota)
- Already-landed fix for the compaction cause: commit `a801891d`
  "chore(config): switch default agent to omp-dsv4-flash-volc"

Agent source: `omp-zai` (0480) and `omp-dsv4-flash-volc` (0482, wrapup). Confidence: High (OMP adapter).
### History
- 2026-08-09T00:08:39.491Z todo → wip (system)
- 2026-08-09T00:08:39.875Z wip → testing (system)
- 2026-08-09T00:29:49.392Z testing → done (system)
### Notes
Root-cause analyses with forensic evidence (meta template — analyses live in Notes, no Root Cause
section). Revised after verifying every claim in the original draft against the tree and the session
JSONL; corrections are marked.

- **RC1 — the implement hop may re-run the project gate (R1).** 0482's implement session
  (`08d76749…/2026-08-08T19-37-48…jsonl`) issued `bun run test` ×3 and `bun run spur-check` ×1,
  seconds before the pipeline's own `test` hop ran `${vars.qualityGateCmd}`.
  **CORRECTION to the original draft:** the draft asserted "8–12 full test runs" per implement and
  named this the dominant cost. That does not survive the logs. 0480's implement — the *slower* of
  the two at 27.6 min — issued **zero** `bun run test` / `bun run spur-check`; every one of its runs
  was `bun test <file>` or `--test-name-pattern`, already the prescribed targeted form. 0482, with 4
  gate-scale runs, finished implement *faster* (23.6 min). Full-suite runs therefore anti-correlate
  with implement wall time across this sample, and the draft's "≤ 15 min implement" and "~10 min/task
  saving" targets have no supporting evidence; both were removed. R1 survives on redundancy grounds
  alone, which is sufficient and provable.

- **RC2 — `omp-zai`/glm-5.2 compaction churn. ALREADY FIXED; no work item.** 0480's implement logged
  8 `"type":"compaction"` events (16:44, 16:46, 16:47, 16:50, 16:53, 16:59, 17:03, 17:07) and its
  review logged 2; every `omp-dsv4-flash-volc` session across 0482 and wrapup logged 0. At roughly
  2.5 min each this was ~20–25 min — the batch's single largest measured waste. Commit `a801891d`
  already set `.spur/config.yaml:32` `agent.default: omp-dsv4-flash-volc`, and `omp-zai-volc` is
  already commented out at `:72-75`. The original R2 is therefore a no-op diff and was dropped.
  **Residual, deliberately not actioned:** the `omp-zai` roster entry (`agent: omp`,
  `model: zai/glm-5.2`, `tier: standard`) is still active. It is unreachable by default — executor
  selection takes the cheapest executor at or above the stage's `min_tier`, and plain `omp` precedes
  it at the same `standard` tier, so `omp-zai` is only entered by an explicit pin. Annotating or
  removing it is out of scope here; `cross-cutting.md`'s 0482 R1/R5 section already argues that
  curating a "safe executor" list is not durable guidance.

- **RC3 — `--agent` does not reach the implement hop (R2).** `task-pipeline.yaml:63` declares
  `implementAgent: "omp"` as a literal independent of `vars.agent`, while `:62`'s comment claims it
  "Defaults to same as agent". Both aborted runs logged `→ implement/agent.run · agent=omp`
  (`bd1949dc` seq=13 16:20:44; `78678365` seq=13 16:36:06) and then took a 403 quota error on `omp`.
  A third start (`1096bb93`, 13:22) failed earlier and for a different reason — the precheck doctor
  reported `status: missing` because the then-default `omp-zai-volc` was commented out; that half is
  already resolved by `a801891d`.
  **CORRECTION:** the draft prescribed documentation ("add a pre-launch guard/notice"). The split is
  already documented in five places — `cross-cutting.md:131-144` (SSOT, and explicit that
  `implementAgent` is *not* derived from `agent`), `docs/04_DESIGN.md:1081-1084`,
  `flag-glossary.md:43`, `dev-operations.md:83`, `docs/help/cmd_workflow.md:79` — and the incident
  happened anyway. More prose is a remedy that has already failed once; R2 is now the mechanical fix.

- **RC4 — `sp:functional-review` documents a Review body the L3 gate must reject (R3).**
  `functional-review/SKILL.md:247` tells the agent to write `--section Review` from a file whose
  content (`:262-270`) is the `| Req | Status | Evidence |` traceability table.
  `hasPopulatedPriorityTable` (`task-check.ts:96-106`) requires a cell matching `/^\s*P[1-4]\s*$/`,
  which that table cannot contain, so `L3_REVIEW_PRIORITY_TABLE` fires and the `wip→testing` record
  transition is denied (run `d1d03ef6`, verify→record 17:23:36, GuardDeniedError).
  **CORRECTION:** the draft called this a guidance gap in `sp-code-review` / `sp-code-verification`
  and blamed the agent for writing "requirement-traceability tables … instead of" the priority table.
  `/sp:dev-review` never loads `sp:code-review` (`dev-review.md:29` dispatches functional-review +
  code-verification + code-improvement), and the agent wrote the traceability table because
  functional-review told it to. The target moved to `functional-review/SKILL.md`; the fix is a
  contract correction in one file, not agent discipline. Nothing needs to change in
  `code-review/SKILL.md`.

- **RC5 — a single fixall hop re-runs the full gate (R4).** The 0482 test-fix session (20:02:04) ran
  `bun run format && bun run spur-check` three times plus a standalone `bun run test`, then exited
  into `test-recheck`, which ran the gate a fourth time.
  **CORRECTION:** the draft framed this as the agent ignoring AGENTS.md's targeted-test-first rule.
  It had no choice — `task-pipeline.yaml:247` passes `/sp:dev-fixall "${vars.qualityGateCmd}"` and
  `:85` defines that as exactly `bun run format && bun run spur-check`. The draft's remedy ("have
  test-fix run only the failing tests plus a narrow recheck") would also break the gate: the
  `test-recheck` shell at `:259-270` is what writes `PASS`, and a narrowed recheck would certify a
  suite it never ran. R4 therefore bounds *repetition within a hop* and leaves the gate command and
  `test-recheck` untouched.

Sizing note: 4 R-items and 4 Plan items sit under the implement-size precheck ceilings
(`maxImplementReqs: 5`, `maxImplementPlanItems: 8`, compared with `>`), so no split is required.

What worked well (preserve): `omp-dsv4-flash-volc` drove the 0482 pipeline to PASS end-to-end with 0
compactions; 0480's implement session was already fully compliant with targeted-test-first; and the
record-gate failure was recovered cleanly through CLI-gated section writes.
