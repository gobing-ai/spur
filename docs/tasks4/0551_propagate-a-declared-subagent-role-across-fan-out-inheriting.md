---
template: feature-impl
schema_version: 1
name: "Propagate a declared subagent role across fan-out, inheriting when absent"
description: ""
status: done
type: task
profile: standard
feature_id: I4
parent_wbs: null
priority: P2
tags: []
dependencies: ["0536"]
ac_numbering: task-local
created_at: "2026-08-14T00:48:41.204Z"
updated_at: "2026-08-14T21:48:06.657Z"
---

## 0551. Propagate a declared subagent role across fan-out, inheriting when absent

### Background
Feature B2's fog names this as unexplored: *"`sp:parallel-execution` dispatches several subagents at
once. Whether each carries its own intention, or inherits the parent's, is unexplored."*

Once `--agent <role>` ships (batch 1, task 0536) and role attribution is recorded (batch 2, task
0545), leaving this unanswered has a concrete cost. A `planner`-role agent fanning out four
implementation subagents either routes all four through the `capable-2` tier — paying planning rates
for coder work, the exact waste tiers exist to prevent — or attributes their consumption to the wrong
role, corrupting the very data feature J6 exists to produce.

The rule is settled by feature I4 § Notes: **a dispatched subagent declares its own role; absent a
declaration it inherits the dispatcher's.** This task wires it.
### Requirements
- [x] **R1.** A subagent dispatched during fan-out that declares its own role resolves through that
      role's tier, not the dispatching agent's. Measurable: a `planner`-role dispatcher fanning out
      subagents declaring `coder` produces four `coder`-tier resolutions, and none at `capable-2`.
- [x] **R2.** A dispatched subagent declaring no role inherits the dispatching agent's, and the
      inheritance is **recorded** rather than merely implied. Measurable: the subagent's effective
      role equals the dispatcher's, and the record distinguishes it from a declared one.
- [x] **R3.** The effective role and its origin (declared or inherited) are visible per dispatched
      subagent, so a wrong inheritance is observable without reading the dispatcher's source.
      Measurable: inspecting a mixed fan-out shows each subagent's effective role and origin.
- [x] **R4.** The rule applies to every fan-out path that shells out to `spur agent run`, not only to
      `sp:parallel-execution`'s documented surface. Measurable: an inventory of dispatch paths is
      recorded, and each either applies the rule or is documented as out of scope with a reason.
### Acceptance Criteria
Covers feature I4 scenarios:

- **R1 — A dispatched subagent declaring a role uses its own**
- **R2 — A subagent declaring no role inherits the dispatcher's**
- **R3 — The effective role is visible per subagent**

```gherkin
Scenario: R1 — A dispatched subagent declaring a role uses its own
  Given a planner-role agent fans out subagents for implementation work
  When each subagent declares role coder
  Then each resolves through the coder tier
  And none inherits the dispatching agent's planner tier

Scenario: R2 — A subagent declaring no role inherits the dispatcher's
  Given a dispatching agent with a known role
  When it dispatches a subagent that declares none
  Then the subagent resolves through the dispatcher's role
  And the inheritance is recorded rather than implied

Scenario: R3 — The effective role is visible per subagent
  Given a fan-out of several subagents with mixed declarations
  When the dispatch is inspected
  Then each subagent's effective role and whether it was declared or inherited is visible
  And a wrong inheritance is observable without reading the dispatcher's source
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Declared or inherited by default?** Declared wins; absent inherits. Recorded in feature I4 §
  Notes with the reasoning — the alternative runs implementation work at planning rates.
- **Why not fail when undeclared?** Consistent with task 0536 R3's treatment of an unmapped role: a
  missing declaration is a plausible authoring omission, and refusing to run is disproportionate.
  Visibility (R3) is the safeguard.
- **Does nested fan-out need special handling?** No — the rule applies recursively by construction.
- **Is a new flag needed?** No; the role travels on `--agent`.

**Deferred with owner.**

- **Tightening to warn-on-inherit or hard-require** — owner: operator, and only after R3's visibility
  shows whether inheritance masks real mistakes. Reversible by design.
- **Whether `roleOrigin` appears in J6's attribution payload** — owner: task 0545. This task exposes
  it; the payload decision is J6's.
### Design
**Declared wins; absent inherits.** The rule is already decided (feature I4 § Notes) — implement it,
do not relitigate it. The rationale is recorded there: the alternative fails in the expensive
direction, running implementation work at planning rates.

**Inherit rather than refuse (R2).** Consistent with feature B2 task 0536's treatment of an unmapped
role: a missing declaration is a plausible authoring omission, and refusing to run is
disproportionate. What makes inheritance safe is that it is *recorded and visible* (R3), not silent.

**Record the origin, not just the value (R2/R3).** "This subagent ran as `coder`" and "this subagent
ran as `coder` because nobody said otherwise" are different facts. Feature J6's attribution will
aggregate over these, and an inherited role that should have been declared is exactly the kind of
mistake the aggregate should be able to surface.

**Inventory the dispatch paths (R4).** `sp:parallel-execution`'s
`references/dispatch-surface.md` is the documented surface, but any path that shells out to
`spur agent run` propagates or drops the role. Enumerate them and apply the rule or record why not —
a path that silently drops the role reintroduces the defect this task closes.

**Nested fan-out needs no special handling.** If a dispatched subagent itself fans out, the same rule
applies recursively by construction. Do not add depth tracking until a case demands it.

**Not in scope:** the role vocabulary and `--agent` (feature B2), recording or aggregating
attribution (feature J6), and how fan-out chooses concurrency.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Rule | declared role wins; absent inherits the dispatcher's | feature I4 § Notes |
| Role vocabulary | `scribe` · `coder` · `reviewer` · `planner` | `plugins/sp/references/roles.md` |
| Selector it passes through | `--agent <role>` | task 0536 |
| Origin marker | `roleOrigin: 'declared' \| 'inherited'` | new, recorded per dispatched subagent |
| Documented dispatch surface | `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` | § *Composition with ADR-033* |
| Precedent for inherit-not-refuse | unmapped role warns and defaults | task 0536 R3 |

**No new CLI flag.** The role travels on the existing `--agent`.

#### Anti-patterns — what not to implement

- Do **not** make a subagent inherit when it declared its own role — declared always wins (R1).
- Do **not** refuse to run when no role is declared. Inheritance is the chosen default; visibility
  (R3) is what keeps it safe.
- Do **not** record only the effective role. Origin (`declared` vs `inherited`) is a separate fact, and
  feature J6's aggregate is what would surface a wrong inheritance.
- Do **not** add depth tracking for nested fan-out. The rule applies recursively by construction.
- Do **not** leave a dispatch path silently dropping the role (R4) — that reintroduces the defect.

#### Cross-task contract

**Assumes from 0536 (batch 1):** `--agent <role>` accepts the four ids, so a propagated role resolves.

**Leaves for dependents:** feature J6 task **0545** records whatever role a dispatch resolved. This
task makes that value *correct* for fanned-out subagents; it does not record it. If `roleOrigin` is to
appear in attribution, that is 0545's payload decision, and this task must expose it.
### Plan
- [x] Inventory every fan-out path that shells out to `spur agent run` (R4)
- [x] Apply declared-wins-over-inherited on each, or record why a path is out of scope (R1, R4)
- [x] Pass a declared subagent role through to `--agent` so it resolves at its own tier (R1)
- [x] Inherit the dispatcher's role when a subagent declares none (R2)
- [x] Record the origin — declared or inherited — alongside the effective role (R2, R3)
- [x] Make effective role and origin visible per dispatched subagent (R3)
- [x] Add tests: declared overrides, absent inherits, mixed fan-out visibility, per-path coverage (R1-R4)
- [x] Update `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` and `docs/04_DESIGN.md` (T3), then run `bun run autofix && bun run spur-check`
### Solution
Declared role wins; absent a declaration the subagent inherits the dispatcher's, recorded as `roleOrigin` — implemented at the resolution source so every dispatch path inherits the rule (R4).

**Core change — `packages/app/src/services/agent-service.ts`:**

- `RolePropagatingProcessExecutor` (new, `packages/app/src/services/agent-service.ts:324-335`): wraps `PidObservingProcessExecutor`; stamps the dispatcher's effective role into every spawned subprocess env as `SPUR_ROLE`. Empty value strips a parent's stale role. Preserves all caller-supplied env keys.
- `AgentService.run()` wiring (`packages/app/src/services/agent-service.ts:652-689`): constructs the propagator for every run (even with injected runner), sets `SPUR_ROLE` to the resolved role after resolution, and re-sets it on each escalation hop (`packages/app/src/services/agent-service.ts:985-988`) so a stage escalation carries the corrected role.
- `inheritedRole()` (`packages/app/src/services/agent-service.ts:1585-1588`): reads `SPUR_ROLE` from `ctx.env`; absent/empty → undefined (top-level dispatch, no inheritance).
- `resolveAgentAuto` inheritance branch (`packages/app/src/services/agent-service.ts:1209-1221`): no declared role, no explicit stage → resolve through the inherited role's tier with `roleOrigin: 'inherited'`; unknown inherited role warns once ("ignoring inherited role '…'") and falls through to `agent.default`/priority — inheritance never hard-fails (R2, 0536 R3 precedent).
- `resolveRole(…, origin)` (`packages/app/src/services/agent-service.ts:1529-1582`): carries `roleOrigin` onto the resolution; the role selector path passes `'declared'` when `--agent <role>` was explicit (`packages/app/src/services/agent-service.ts:1110-1117`), `'inherited'` from the env branch.
- `resolvePinned` attribution (`packages/app/src/services/agent-service.ts:1113-1132`): pin wins routing, but with nothing declared the run inherits the dispatcher's role — recorded as `roleOrigin: 'inherited'`; the envelope carries both the executor pin and the attributed role.
- Envelope: `roleOrigin` added to `AgentResolveResult`, `AgentRunInvocation`, and the `--json` `resolved` block (`packages/app/src/services/agent-service.ts:131-133`, `175-177`, `1727-1729`).

**Tests:**

- `packages/app/tests/services/agent-service.test.ts` — `AgentService role propagation (0551)` (7 tests): R1 declared beats inherited `SPUR_ROLE` (origin `declared`); R2 absent inherits (origin `inherited`, source `role`, tier floor respected); R2 unknown inherited role warns + falls to priority; R3 explicit pin inherits attribution (pin wins routing, envelope carries role + origin); R3 role selector under an inherited role records `declared`; R3 mixed fan-out shows each subagent's role + origin.
- `packages/app/tests/observability/agent-execution.test.ts` — `RolePropagatingProcessExecutor (0551)` (6 tests): stamps `SPUR_ROLE`, strips stale parent role, `setRoleEnv(undefined)` reverts, preserves caller env, composes with pid sink, overrides a parent `SPUR_ROLE` in the child env.

**Docs (T3, same commit):**

- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` — new § Role propagation across fan-out (0551) + dispatch-path inventory (R4): `spur agent run` CLI, workflow `agent.run`, `agent loop`, `team` supervisor, native subagent fan-out all covered at source; `plugins/sp/evals/run-eval.ts` documented out of scope (top-level harness, no dispatcher role).
- `docs/04_DESIGN.md` — `--json` envelope shape gains `roleOrigin` (declared | inherited) with semantics.
### Testing
Independent re-audit 2026-08-14 (`/sp:dev-verify 0551 --auto --next --force --focus all --fix all`). `--fix all` flipped 4 leftover `[ ]` Requirement boxes and added a P1–P4 table to Review (L3.review-priority-table). Artifacts: `.spur/run/0551-verdict.json` (AC ids remapped to feature I4 scenario titles), `.spur/run/0551-verify-answer.txt`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Declared branch precedes inherit: `packages/app/src/services/agent-service.ts:1193-1204` (`resolveRole(..., 'declared')`). This run: test `R1: a declared role beats the inherited SPUR_ROLE` at `packages/app/tests/services/agent-service.test.ts:2154-2165` — `SPUR_ROLE=scribe` + `role: reviewer` → claude, `roleOrigin: 'declared'` |
| R2 | MET | `inheritedRole()` `packages/app/src/services/agent-service.ts:1592-1595`; auto inherit `packages/app/src/services/agent-service.ts:1215-1229`. This run: `packages/app/tests/services/agent-service.test.ts:2167-2180` inherit + `:2182-2195` coder tier-floor + `:2197-2206` unknown inherit warns |
| R3 | MET | `roleOrigin` on resolve result `packages/app/src/services/agent-service.ts:131-132` and `--json` envelope `packages/app/src/services/agent-service.ts:1733-1734`. Mixed fan-out this run: `packages/app/tests/services/agent-service.test.ts:2247-2267` — scribe/inherited and reviewer/declared |
| R4 | MET | Inventory `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:123-133`. Rule lives in `AgentService` so CLI/`loop`/`team` inherit; workflow `role:` mandatory; eval harness documented out of scope |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — A dispatched subagent declaring a role uses its own | MET | test | `packages/app/tests/services/agent-service.test.ts:2154-2165` this run: declared reviewer under inherited scribe → claude (capable-1), never scribe tier |
| Scenario: R2 — A subagent declaring no role inherits the dispatcher's | MET | test | `packages/app/tests/services/agent-service.test.ts:2167-2180` this run: roleOrigin inherited, source role; origin recorded not implied |
| Scenario: R3 — The effective role is visible per subagent | MET | test | `packages/app/tests/services/agent-service.test.ts:2247-2267` this run: mixed fan-out envelope shows each subagent role and origin |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | C | `packages/app/src/services/agent-service.ts:1206-1213` | Explicit `--stage` (direct CLI) skips inheritance; documented, not a core-AC miss |
| P4 | — | — | No P1–P2 findings; implement-time P3s already fixed |

This run: `bun test packages/app/tests/services/agent-service.test.ts --test-name-pattern "0551|role propagation"` → 8 pass / 0 fail. Isolated-suite coverage exit 1 is not a product failure.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | — | — | None |
| P2 | — | — | None |
| P3 | C | `packages/app/src/services/agent-service.ts:1131-1136` | Unknown inherited role under an executor pin now warns (fixed in implement). Test: `R3: a stale inherited role under an executor pin warns` |
| P3 | U | `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:129` | Workflow inventory row now states step `role:` is mandatory (0538 R2); inheritance applies at the next fan-out boundary (fixed in implement) |
| P4 | C | `packages/app/src/services/agent-service.ts:1206-1213` | Explicit `--stage` skips inheritance (direct CLI only; documented) |
| P4 | A | `packages/app/src/services/agent-service.ts:324-335` | `SPUR_ROLE` is process-env coupling by design (recursive inherit). Accepted |

**Requirement verdicts**

- **R1 — declared wins — covered.** The declared role is checked before inheritance in both resolution paths: `resolveAgentAuto` returns via `resolveRole(…, 'declared')` before the inherited branch (agent-service.ts:1196-1207), and `resolvePinned` attributes the declared role ahead of inheritance (agent-service.ts:1117-1118). Tests assert the envelope value, not just routing: `R1: a declared role beats the inherited SPUR_ROLE` (agent-service.test.ts:2154-2166) verifies `role: reviewer`, `roleOrigin: 'declared'`, resolving through capable-1 under `SPUR_ROLE=scribe`; the mixed fan-out test (agent-service.test.ts:2236-2256) shows a declared `reviewer` under inherited `scribe` landing on claude (capable-1), never the scribe tier.
- **R2 — absent inherits, recorded — covered.** `inheritedRole()` reads `SPUR_ROLE` from `ctx.env`; absent/empty → undefined (agent-service.ts:1585-1588). The auto branch resolves through the inherited role's tier with `roleOrigin: 'inherited'` (agent-service.ts:1208-1221); the pinned path attaches the same attribution with the pin still winning routing (agent-service.ts:1119-1124). Tests assert origin `inherited`, `source: role`, tier floor (coder → standard, agent-service.test.ts:2182-2195), and graceful degradation on an unknown inherited role — warn + fall to priority, never hard-fail (agent-service.test.ts:2197-2205).
- **R3 — per-subagent visibility — covered.** `roleOrigin` rides `AgentResolveResult` (agent-service.ts:131-132), `AgentRunInvocation` (175-176), the invocation built in `executeRun` (861-863), and the `--json` `resolved` block (1726-1728). The mixed fan-out test parses two envelope lines and asserts `{ role, roleOrigin }` per subagent (agent-service.test.ts:2247-2255) — envelope values, not just resolution (acceptance item e).
- **R4 — every `spur agent run` path — covered.** Grep-verified against the tree: CLI `spur agent run` (apps/cli/src/commands/agent.ts:390 → `AgentService.run`), workflow `agent.run` (packages/app/src/workflow/actions/agent-run.ts → `runTraced`), `spur agent loop` (apps/cli/src/commands/agent.ts:583 → `AgentService.run` per drained iteration), `spur team` supervisor (packages/app/src/services/supervisor-service.ts:207-220 — the env spread passes `SPUR_ROLE` through), native in-session fan-out (documented, no shell-out), and `plugins/sp/evals/run-eval.ts` (`spawnSync('spur agent run', …)`, line 38-39) documented out of scope with a reason. No other `spur agent run` spawn site exists — remaining spur spawns (`task-write-guard.ts`, `guard-extension.ts`, `task-size-precheck.ts`, `workflow.ts`) are `task resolve`/`task check`/`workflow run`, not agent dispatch. The inventory table (dispatch-surface.md:125-131) matches the code. One doc-precision nit below (F2).

**Findings**

- **P3 — Warn on an unknown inherited role under a pinned dispatch (agent-service.ts:1119-1124).** The auto path warns once ("ignoring inherited role '…'") and falls through to default/priority (agent-service.ts:1213-1216), but the pinned path is silent: `attributed` is set only when the inherited role is known, and when it is not, nothing is emitted — no warning, no `roleOrigin` in the envelope. A stale `SPUR_ROLE` under an executor pin therefore bypasses R3's "wrong inheritance is observable" safeguard with zero trace, exactly the silent-drop anti-pattern the task forbids (though for attribution only — routing is unaffected because the pin wins regardless). Fix: mirror the auto path by emitting the same warning (or hoist it into `inheritedRole()`) when the inherited role is unknown. Non-blocking; routing unaffected.
- **P3 — dispatch-surface.md overstates workflow-path inheritance (dispatch-surface.md:127).** The inventory row claims "steps without one inherit via `SPUR_ROLE`", but `AgentRunActionRunner` hard-requires a Layer-1 role — a role-less step fails before any dispatch (agent-run.ts:193-198, 0538 R2). Inheritance can never engage on the workflow path, so the row describes an unreachable case and misleads the R4 reader about where the rule is actually exercised. Fix: reword the row (e.g. "step `role:` is mandatory (0538 R2) — declared wins; inheritance applies at the next fan-out boundary").

**Residual risk**

- **Stage-flagged children skip inheritance.** `resolveAgentAuto` returns via stage policy before the inherited branch (agent-service.ts:1205-1215), so a role-less child carrying an explicit `--stage` (direct CLI only — the workflow action exposes no stage option) resolves with no role and no `roleOrigin`. The doc's unconditional "one that declares nothing resolves through the inherited role's tier" (dispatch-surface.md:114-116) is overbroad; the code comment documents the intent ("no declared role, no explicit stage").
- **Env inheritance is implicit coupling by design.** `SPUR_ROLE` is stamped into every spawned subprocess, so any nested `spur agent run` — a shell step inside the coding agent, the eval harness, a spur invocation inside the agent — inherits the dispatcher's role. Recursive-by-construction is the documented intent (dispatch-surface.md:116-117), and the env-based approach is the right call versus per-dispatch option passing (which would need a flag threaded through every spawn site and would break recursion), but the variable is now part of the process-env contract alongside the ai-runner correlation vars and is not scoped away from non-fan-out descendants. An operator-facing note is recommended; no code change required.
- **Config-sourced roles carry no origin.** `agent.default`-routed role values (source `default`) record `role` without `roleOrigin` (resolveExecutorSelector passes no origin for `default`) — correct per the declared/inherited taxonomy, but task 0545's attribution must not treat an absent `roleOrigin` as inherited.
- **Escalation-hop re-stamping untested.** `setRoleEnv` re-set on each hop (agent-service.ts:985-988) has no direct test; it is a two-line wiring, low risk.

**Disposition: approve.** All four requirements are implemented and asserted at the envelope level (role, roleOrigin, tier, executor, source), the dispatch inventory is accurate, and the quality gate is reported green. The two P3 findings are non-blocking; recommend folding F1 (warning asymmetry) into a follow-up since it is the same warning path the auto branch already has.
**P3 follow-up resolution (same run, post-review):** both P3 findings addressed and gate re-run green.

- P3-1 (warning asymmetry) — **fixed** in `agent-service.ts:1122-1129`: the pinned branch now mirrors the auto path and warns `ignoring inherited role '…'` when `SPUR_ROLE` names an unknown role under an executor pin. New test `R3: a stale inherited role under an executor pin warns — never drops silently` (agent-service.test.ts). 8/8 0551 tests pass.
- P3-2 (workflow-row overstatement) — **fixed** in `dispatch-surface.md`: the workflow row now states step `role:` is mandatory (0538 R2) with inheritance applying at the next fan-out boundary; the mechanism paragraph notes the explicit-`--stage` exemption (direct CLI only).
### References
- **Documented dispatch surface (R4):**
  `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:40-80` (§ *Composition with
  ADR-033*, § *The sandbox reliability tax on `spur agent run`*)
- **Role selector this propagates:** feature B2 task 0536 (`--agent <role>`); vocabulary in
  `plugins/sp/references/roles.md` (task 0535)
- **Precedent for inherit-and-warn over refuse:** feature B2 task 0536 R3 (unmapped role warns and
  defaults rather than failing)
- **Consumer of the value this corrects:** feature J6 task 0545 (records role attribution)
- **Open question this closes:** feature B2 § *Not yet specified* — "Parallel fan-out … whether each
  carries its own intention, or inherits the parent's, is unexplored"
- **Surface docs (T3, same commit):**
  `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`, `docs/04_DESIGN.md`
### History
- 2026-08-14T21:18:00.927Z todo → wip (system)
- 2026-08-14T21:30:35.424Z wip → testing (system)
- 2026-08-14T21:31:02.838Z testing → done (system)
