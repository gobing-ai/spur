---
schema_version: 1
name: Raise implementTimeoutMs default to 45 minutes
status: done
template: feature-impl
created_at: 2026-10-07T07:29:49.093Z
updated_at: "2026-10-08T15:16:50.288Z"
feature_id: H15

priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1108-verdict.json
---

## 1108. Raise implementTimeoutMs default to 45 minutes

### Background

`implementTimeoutMs` defaults to `"1800000"` (30m) at `config/workflows/task-pipeline.yaml:123`. Session evidence: 1096 and 1099 implement dispatches were killed at 30m mid-gate and needed re-dispatch; 1099's full implement consumed the raised 45m budget. The adjacent comment block (yaml :112-124) already documents that budget exhaustion is a real failure mode — the default predates multi-task batch usage.

**Refine corrections (2026-10-07)**

- **Premise error:** the P1 30m kills came from the **pi host subagent limit** ("Subagent timed out after 1800000ms"; pi's subagent `timeoutMs` default is 30m), not from the YAML value. Inline dispatch is governed by the host limit and `timeoutMs` does not apply inline (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612`, task 0727; `:401`). Raising the YAML default alone changes only subprocess surfaces (`spur workflow run`, `--mode parallel`, headless) — it would not have prevented the observed kills. R2 adds the inline half.
- 45m is **not proven sufficient**: 1099 also timed out at the raised 45m budget (resumed), and 1097 used ≈40 of 45 min. 45m is a reasoned default, not a measured bound; the comment must say so.
- Line references re-verified: default at `config/workflows/task-pipeline.yaml:123`, comment block `:118-122`, `stepTimeoutMs` `:117`, implement `agent.run` uses `timeoutMs: ${vars.implementTimeoutMs}` at `:300`.
- R3 (exhaustion visible) already holds — `packages/app/src/workflow/actions/agent-run.ts:1280` reports "terminated by signal … (configured timeout: Nms…)", asserted at `packages/app/tests/workflow/actions/agent-run.test.ts:1378`. Verification only, no new plumbing.
- Missed dependents of the default value: `plugins/sp/tests/skill-structure.test.ts:762` asserts `"1800000"`; `docs/design/planning-workflow-contracts.md:257` states the 30 min default; the comment in `plugins/sp/hooks/context-session-start.ts:77`; `plugins/sp/skills/spur-dev/references/execution-workflow.md:311` and `:349` (check); the generated `apps/cli/config/` copy.

### Requirements

- [x] R1. `config/workflows/task-pipeline.yaml:123` sets `implementTimeoutMs: "2700000"`. The comment block (`:118-122`) states the 45m default, that it governs subprocess surfaces, and that 45m is a reasoned default (P1: one 45m timeout still occurred) — not a proven bound.
- [x] R2. The inline driver timeout contract (`inline-pipeline-driver.md` § Timeout boundary, `:600-612`) is amended: when the host's dispatch tool accepts a per-dispatch timeout (pi: subagent `timeoutMs`), the driver passes the stage's resolved YAML `timeoutMs` (implement → `implementTimeoutMs`) and records `host timeout <ms> (yaml timeoutMs)`; when it does not, it records `(platform subagent limit)` as today. No-replay and resume-from-partial-tree rules are unchanged. The `:401` "timeoutMs not applicable inline" statement is reworded to match.
- [x] R3. The run-var override still works: `--vars '{"implementTimeoutMs":"..."}'` overrides the default on a subprocess run without YAML edits.
- [x] R4. Budget exhaustion stays visible: the existing `configured timeout` message (`agent-run.ts:1280`) and its test (`agent-run.test.ts:1378`) are unchanged and green.
- [x] R5. Every dependent of the old value is updated: `skill-structure.test.ts:762` assertion, `planning-workflow-contracts.md:257`, the `context-session-start.ts:77` comment, `execution-workflow.md:311`/`:349` if they state 30m, and `apps/cli/config/` regenerated via `bun run --filter @gobing-ai/spur build:bundle`.

### Acceptance Criteria

- [x] AC1 — Implement dispatch budget defaults to 45 minutes on subprocess and inline hosts and exhaustion is visible (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:15:15.178Z

- **Q: Does the YAML change fix the P1 kills?** A: No — those were the host limit. R2 makes the inline driver pass the YAML budget to the host when possible. Decided 2026-10-07 refine (amends the 0727 wording; recorded in the driver doc itself).
- **Q: 45m or higher?** A: 45m, labeled as a reasoned default. One P1 run still hit 45m while isolating an unrelated test failure; the resume path handles that case. Raising further without evidence is deferred.

### Design

**Approach:** one config value, one driver-contract amendment, dependent sync. No runtime code changes.

**Frozen names**

- Var `implementTimeoutMs` (unchanged name), default `"2700000"`.
- Run-log boundary strings: `host timeout <ms> (yaml timeoutMs)` | `host timeout <ms> (platform subagent limit)`.

**Inline amendment (R2):** the 0727 rule said the host limit governs and YAML `timeoutMs` is not applicable. The amendment keeps "host governs" as the fallback but makes the YAML budget the requested value whenever the host dispatch tool exposes a timeout parameter. Rationale: the operator sets one budget in one place; a host that silently imposes its own 30m default is what killed 1096 and 1099. A host without the parameter keeps today's behavior, so no host is broken.

**Anti-patterns**

- Claiming 45m is sufficient, or citing "two 30m kills" as a YAML-default failure.
- Adding new timeout plumbing in `agent-run.ts` (R4 is verification only).
- Hand-editing `apps/cli/config/` instead of running `build:bundle`.
- Changing `stepTimeoutMs` or other stage budgets (out of scope).

**Impacted surfaces:** `config/workflows/task-pipeline.yaml`, `apps/cli/config/` (generated), `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `docs/design/planning-workflow-contracts.md`, `plugins/sp/hooks/context-session-start.ts` (comment), `plugins/sp/tests/skill-structure.test.ts`.

**Dependency handoff:** 1107 R5 cites this task. Independent of 1109–1111.

### Plan

1. `rg -n '1800000|30 ?m(in)?' config/workflows plugins/sp docs/design apps/cli/src` — confirm the dependent list; add any missed hit to R5's set.
2. Edit `task-pipeline.yaml:118-123` (value + comment).
3. Amend `inline-pipeline-driver.md:600-612` and `:401` per R2.
4. Update `planning-workflow-contracts.md:257`, `context-session-start.ts:77` comment, `execution-workflow.md` if needed.
5. Update `skill-structure.test.ts:762` to `"2700000"`.
6. `bun run --filter @gobing-ai/spur build:bundle`; confirm `apps/cli/config/` diff carries the new value.
7. `(cd plugins/sp && bun test tests/skill-structure.test.ts)`; `(cd packages/app && bun test tests/workflow/actions/agent-run.test.ts)`; then `bun run spur-check`.

### Solution

One config default, one driver-contract amendment, and the dependents that pinned either. No runtime code change.

| File:line | Change |
| --- | --- |
| `config/workflows/task-pipeline.yaml:119-127` | `implementTimeoutMs` default `"1800000"` → `"2700000"`; the superseded 30-minute rationale is replaced by the pilot evidence (`docs/reports/i31/1107-runall-p1-pilot.md:70`), the subprocess-surface scope, and the explicit "reasoned default, not a proven bound" caveat |
| `plugins/sp/tests/skill-structure.test.ts:761-763` | R2a assertion follows the new default (`implementTimeoutMs: "2700000"`); the timeout-template assertions on the implement block are unchanged |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:401-411` | `agent.run` bullet: `timeoutMs` is now **requested from the host** where the host exposes a per-dispatch timeout, instead of being recorded not-applicable — implement passes `implementTimeoutMs` |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-616` | Timeout-boundary contract amended: the host's limit still governs as the fallback, the YAML budget is requested first, and the pre-dispatch record names which bound is in force (`host timeout <ms> (yaml timeoutMs)` vs `(platform subagent limit)`) |
| `scripts/commands/inline-execution-contract.test.ts:330-334` | The 0727 contract test pinned the superseded sentence; it now asserts the amended contract (host budget requested, both boundary strings) while keeping the classification and inline-resume assertions — an R2 dependent that R5's list did not name |
| `docs/design/planning-workflow-contracts.md:255-260` | Step-timeout contract states the two budgets separately: `stepTimeoutMs` `"1800000"` (30 min), `implementTimeoutMs` `"2700000"` (45 min), plus the inline host-limit rule |
| `plugins/sp/hooks/context-session-start.ts:77` | Comment states the implement budget as 45 min |

**Rationale.** The P1 evidence shows the 30-minute default was never the cause of the observed kills — those were the host's own default — so the change is deliberately two-part rather than a bare number bump: the subprocess default moves, and the inline driver stops discarding the operator's budget when the host can accept one. Both halves are labeled with what they do not prove: 45 minutes is a reasoned default (one P1 implement still hit it and resumed from the partial tree), and the host-boundary fallback keeps working for hosts without a per-dispatch timeout. `apps/cli/config/` is regenerated by `build:bundle`, never hand-edited.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `implementTimeoutMs: "2700000"` at `config/workflows/task-pipeline.yaml:127` with the 45m comment block at `config/workflows/task-pipeline.yaml:118-126`; bundle copy identical (`apps/cli/config/workflows/task-pipeline.yaml:127`, cmp IDENTICAL this run) |
| R2 | MET | Timeout boundary amended by 1108 at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:639-651`; agent.run timeout bullet `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:439-441` |
| R3 | MET | Run-var merge in `packages/app/src/services/workflow-service.ts:835`; test `packages/app/tests/services/workflow-service.test.ts:3108` passed this run (1 pass / 0 fail). Live dry-run with --vars blocked by capability attestation (exit 1) — unit evidence only |
| R4 | MET | "configured timeout" message at `packages/app/src/workflow/actions/agent-run.ts:1281`; test `packages/app/tests/workflow/actions/agent-run.test.ts:1378` green this run |
| R5 | MET | `plugins/sp/tests/skill-structure.test.ts:764-768`, `docs/design/planning-workflow-contracts.md:262-267`, `plugins/sp/hooks/context-session-start.ts:77`, `scripts/commands/inline-execution-contract.test.ts:336-337` (21 pass / 0 fail) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/skill-structure.test.ts:764-768` pins the 45m default; skill-structure suite 132 pass / 0 fail this run |
| R2 — Implement dispatch budget defaults to 45 minutes on subprocess and inline hosts and exhaustion is visible | MET | test | Default at `config/workflows/task-pipeline.yaml:127` consumed by `config/workflows/task-pipeline.yaml:329`; inline contract `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:639-651`; exhaustion test `packages/app/tests/workflow/actions/agent-run.test.ts:1378` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — config/doc/test surface only; 3-dimensional review executed in-session by the inline driver (reviewer independence not achievable on the host-inline path, recorded as P4).

**Requirement traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `config/workflows/task-pipeline.yaml:118-132` — `"2700000"` with the subprocess-scope and reasoned-default caveats |
| R2 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:401-411`, `:600-616` — host-budget request, both record strings, unchanged no-replay/resume rules |
| R3 | MET | `--vars` merge probed end-to-end (without `wbs` → failed at the YAML default; with `wbs=1108` → 11 transitions); the implement stage template at `config/workflows/task-pipeline.yaml:309` reads the var |
| R4 | MET | `packages/app/src/workflow/actions/agent-run.ts:1280` is not in the diff; its test file is green (163 pass) |
| R5 | MET | Every named dependent updated; `apps/cli/config/workflows/task-pipeline.yaml:132` regenerated by `build:bundle`; `scripts/commands/inline-execution-contract.test.ts:330-334` added as an R2 dependent |

**Findings**

| P | Finding | Disposition |
| --- | --- | --- |
| P3 | R5's list omitted `scripts/commands/inline-execution-contract.test.ts`, which pinned the superseded 0727 sentence and failed the first gate run | fixed in-flight; narrow + full gates green |
| P4 | R3's direct single-var E2E observation is blocked by an independent capability-attestation error on the subprocess surface | accepted; R3 stands on the merge probe plus the template assertion |
| P4 | `apps/cli/tests/helpers.test.ts:34` is flaky under full-suite load only | accepted; pre-existing |
| P4 | In-session review | accepted; P2 task |

No P1/P2 findings. Residual risk: the new default is a reasoned value, not a measured bound.


#### Review Report — 1108 (main-side implementation, commit `32c529a4a`)
_Preserved from `main` during the H15 merge: the concurrent main-side run reviewed its own patch for this task. Kept for the record; the verdict above is the run record of the branch's pipeline._

**Scope:** 1108 diff = commit 32c529a4a (6 files: `config/workflows/task-pipeline.yaml`, `docs/design/planning-workflow-contracts.md`, `plugins/sp/hooks/context-session-start.ts`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `plugins/sp/tests/skill-structure.test.ts`, task file excluded) + generated `apps/cli/config/workflows/task-pipeline.yaml` (gitignored)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The two frozen run-log boundary strings `host timeout <ms> (yaml timeoutMs)` / `(platform subagent limit)` have no contract-test guard; `inline-execution-contract.test.ts:331` pins only the surviving 0727 phrase, so the R2 pass-through clause could be reworded away silently. Optional `toContain` in that test if the strings are meant to stay frozen | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:641-644` | ACCEPTED |
| 2 | P4 (advisory) | usability | The driver names pi's subagent `timeoutMs` as the example dispatch-tool timeout parameter. That is an external host-API claim with no source cited; it is used only as an example and the fallback clause covers hosts without the parameter | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:640` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:126` `implementTimeoutMs: "2700000"`; comment at `:118-125` states the 45 min default, that it governs subprocess surfaces, and that it is "a reasoned default, not a proven bound". The superseded 30 min rationale was removed, so only one justification remains (per Notes) |
| R2 | MET | `inline-pipeline-driver.md:639-648` amends the Timeout boundary (YAML pass-through when the tool accepts a timeout; fallback to the platform limit) with both frozen log strings. No-replay and resume-from-partial-tree text is unchanged at `:648-655`. The `agent.run` bullet at `:438-441` was reworded to match |
| R3 | MET | `config/workflows/task-pipeline.yaml:311` `timeoutMs: ${vars.implementTimeoutMs}`; var name unchanged; override example at `:125`. Structure test `skill-structure.test.ts:762-765` asserts both the value and the implement-block binding |
| R4 | MET | `packages/app/src/workflow/actions/agent-run.ts:1280` `configured timeout` message re-read and not touched by this commit (`git log 32c529a4a..HEAD` on the file is empty, and the file is not in the diff); assertion at `packages/app/tests/workflow/actions/agent-run.test.ts:1378` |
| R5 | MET | `skill-structure.test.ts:762` asserts `"2700000"`; `planning-workflow-contracts.md:256-260` states 30 min stepTimeoutMs / 45 min implementTimeoutMs plus the inline pass-through; `context-session-start.ts:77` says 45 min; `execution-workflow.md:311` states no value and `:349-350` cites historical run `ca130182` (correctly left as is); generated `apps/cli/config/workflows/task-pipeline.yaml:126` carries `"2700000"` |

| AC | Status | Evidence |
|----|--------|----------|
| AC1 — Implement dispatch budget defaults to 45 minutes on subprocess and inline hosts and exhaustion is visible | MET | R1–R5 rows above; `bun run spur-check` PASS (host-reported); narrow suites recorded in Solution (skill-structure 91/0, agent-run 164/0, inline-execution-contract 21/0) |

##### Design Conformance

| Claim | Status | Evidence |
|-------|--------|----------|
| No runtime code changes / no new agent-run.ts plumbing | DONE | The diff touches only YAML, Markdown, one comment line (`context-session-start.ts:77`), and one test literal |
| No claim that 45m is sufficient | DONE | `task-pipeline.yaml:124` and `planning-workflow-contracts.md:258` both say "reasoned default, not a proven bound" |
| `stepTimeoutMs` untouched | DONE | `task-pipeline.yaml:117` is still `"1800000"`; no hunk touches it |
| `apps/cli/config/` regenerated, not hand-edited | DONE | Generated copy matches the SSOT at `:126`/`:311` |

SECUA: no security surface (config default plus docs). Efficiency: a longer kill bound only lengthens the worst-case wait on a hung subprocess, an accepted tradeoff documented inline. Architecture: the single-budget/single-place rationale is sound, and it degrades safely on hosts without a timeout parameter. No scope creep.

**Next:** proceed to verify; P4 rows are non-blocking.

### References

- Feature: H15
- `config/workflows/task-pipeline.yaml:117-123`, `config/workflows/task-pipeline.yaml:300`
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:401`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612` (task 0727)
- `packages/app/src/workflow/actions/agent-run.ts:1280`, `packages/app/tests/workflow/actions/agent-run.test.ts:1378`
- Evidence: 1107 report (`docs/reports/i31/1107-runall-p1-pilot.md`)

### History

- 2026-10-07T07:34:13.557Z backlog → todo (system)
- 2026-10-07T18:38:33.813Z todo → wip (system)
- 2026-10-07T19:06:46.534Z wip → testing (system)
- 2026-10-07T19:07:55.914Z testing → done (system)

### Notes

The comment at yaml :119-121 currently reasons about the 30m choice — supersede it with the evidence, don't leave two justifications. `stepTimeoutMs` (review/verify/test-fix hops, :113) is a separate budget: leave it alone. Static-vs-run-var discipline per ADR-115: this var is already a run var, so no new knob is being added — only the default moves.

