---
template: feature-impl
schema_version: 1
name: "Wire next-router into super-coder (preflight + one-shot recovery)"
description: ""
status: done
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: []
dependencies: ["0275"]
created_at: "2026-07-17T06:34:53.279Z"
updated_at: "2026-07-17T06:43:49.588Z"
---

## 0279. Wire next-router into super-coder (preflight + one-shot recovery)

### Background
**Type:** feature-impl · **Feature:** N · **Package:** plugins/sp agents + next-router

**Goal:** Lightly empower `plugins/sp/agents/super-coder.md` with `sp:next-router` / `/sp:dev-next` so batch runs **preflight** each WBS against the status→command tables and, after a failed/stuck task, can take **at most one recovery hop** — without replacing `task-pipeline.yaml` or inventing a second FSM.

**Context (brainstorm 2026-07-17):**
- `sp:super-coder` = batch pipeline driver (execution-batch.md): resolve→freeze→topo→per-task pipeline→verdict→continue/halt→report.
- `sp:next-router` + `/sp:dev-next` = single-step status router (routing-table.md TABLE A/B/C); step budget = one dispatch; not a pipeline.
- Option **B (operator-locked):** light empowerment. Rejected A (docs-only), C (deep merge / loop dev-next as batch engine).

**Authority:** `plugins/sp/agents/super-coder.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md`, `plugins/sp/skills/next-router/SKILL.md` + `references/routing-table.md`, `plugins/sp/commands/dev-next.md`, `plugins/sp/skills/spur-dev/references/dev-operations.md` (dev-next is not a spine op; runall → super-coder).

**Predecessor:** 0275 shipped next-router + dev-next. 0276–0278 dogfood/done-gate hardening is orthogonal but available for gates.

**Out of scope:**
- Replacing per-task `task-pipeline.yaml` with repeated `/sp:dev-next`.
- Self-looping `dev-next` until feature done (unbounded tokens; forbidden by router step budget).
- Changing TABLE A/B/C semantics (consume as SSOT; do not fork tables into super-coder).
- Auto-approving HITL multi-candidate router stops inside the batch (still surface to operator).
### Requirements
- [x] R1. **Document the boundary** in `super-coder.md`: super-coder owns batch between-run orchestration; next-router owns single-WBS step selection; happy path remains `spur workflow run task-pipeline.yaml` per frozen WBS.
- [x] R2. **Skill wiring:** add `sp:next-router` to super-coder frontmatter `skills:` (and description triggers only if needed). Do not remove existing skills.
- [x] R3. **Preflight (default on for batch):** before launching each per-task pipeline, apply TABLE A preconditions (or invoke `sp:next-router` / equivalent with dry-run semantics) using `spur task show --json` (+ deps). If the row is a hard STOP (A2 unmet deps, A9 cancelled, A7 blocked without recovery policy), **do not** start the pipeline; mark the WBS pre-blocked/skipped in the batch report with the same rationale shape as `dev-next:` messages.
- [x] R4. **Preflight does not rewrite happy path:** when TABLE A says refine/run/verify chain would apply, still launch the **full task-pipeline** (or existing runall path) for that WBS — preflight is readiness/skip only, not a substitute for the pipeline.
- [x] R5. **One-shot recovery (optional, default on after FAIL):** when a per-task pipeline ends non-PASS (or status stuck at wip/testing with no path forward in the batch report), consult next-router once for that WBS. If cardinality=1 and the dispatch is a single lifecycle hop (e.g. verify, implement chain), either (a) print the exact child command for the operator, or (b) dispatch once under explicit `--auto` when the batch was started with `--auto`. Never loop recovery.
- [x] R6. **Parallel mode:** preflight still runs per WBS before fan-out; recovery remains sequential (one WBS) to avoid concurrent corpus mutation from dual recovery dispatches.
- [x] R7. **Cross-doc:** add a short subsection to `execution-batch.md` (and optionally `dev-operations.md`) pointing at preflight + recovery and forbidding deep-merge.
- [x] R8. **Non-regression:** `dev-next` / next-router behavior and TABLES unchanged except optional explicit "batch consumer" note. No change required to TABLE rows unless a bug is found.
- [x] R9. Tests or dogfood: at least one automated or scripted check that preflight skips unmet-deps (A2) without calling `workflow run`; document manual dogfood of `/sp:dev-runall` on a tiny fixture set if unit harness is thin for agents.
### Acceptance Criteria
```gherkin
@core
Scenario: Super-coder still drives the pipeline for ready tasks
  Given a frozen batch with a todo task whose dependencies are all done
  When super-coder runs the batch
  Then each ready task is executed via task-pipeline.yaml (or the existing runall path)
  And next-router is not used as a substitute for the full pipeline happy path

@core
Scenario: Preflight skips unmet dependencies
  Given a todo task whose dependencies include a non-done WBS
  When super-coder preflights that WBS before pipeline launch
  Then no workflow run is started for that WBS
  And the batch report records a skip/pre-block with the unmet dep list

@core
Scenario: One-shot recovery after FAIL
  Given a batch task ends with a non-PASS verdict or stuck lifecycle status
  When recovery is enabled
  Then super-coder consults next-router at most once for that WBS
  And it either prints or dispatches a single child command
  And it does not self-loop until done

@core
Scenario: Boundary is explicit in agent docs
  Given super-coder.md and execution-batch.md after this task
  When an operator reads the orchestrator boundary
  Then they see that batch orchestration and status-routing are complementary
  And deep-merge (batch driven only by looping dev-next) is forbidden

@edge
Scenario: Multi-candidate router stop is not auto-picked
  Given recovery or preflight would yield more than one candidate hop
  When super-coder handles that case
  Then it stops with a HITL/decision-brief style message
  And --auto on the batch does not silently choose among candidates
```
### Q&A
**Q: Docs-only vs light vs deep merge?**  
**A (2026-07-17 brainstorm):** Operator chose **B light empowerment**. Deep merge rejected (second FSM). Docs-only rejected as insufficient for skip/recovery.

**Q: Wayfind map vs single task?**  
**A:** Destination is clear (integrate router into super-coder at batch boundaries only). Single feature-impl task 0279; no multi-session map.

**Q: Preflight invoke Skill or pure logic?**  
**A:** Prefer pure TABLE A STOP evaluation for determinism and unit tests; Skill dry-run is acceptable fallback if pure helper is incomplete in v1 — document which landed in Solution.
### Design

**Seams:**

1. **Docs + skill frontmatter (R1, R2, R7)** — cheap, high leverage for agents that load super-coder cold.
2. **Preflight hook in the batch loop (R3, R4, R6)** — insert Step 2.5 in execution-batch.md algorithm: for each WBS before `workflow run`, load task JSON, evaluate STOP rows (A2/A7/A9 and analogous). Implementation options:
   - **Preferred:** pure function or thin helper that mirrors TABLE A STOP preconditions (status + deps) without spawning a full Skill subprocess — deterministic, testable.
   - **Acceptable:** invoke `sp:next-router` with dry-run args and parse plan output (more coupled to agent runtime).
3. **Recovery hook (R5)** — after Step 3.3 verdict inspect, if non-PASS and recovery enabled, one router consultation. Default: print plan line; with batch `--auto`, optional single dispatch of the child only when safe (no multi-candidate).

**Rejected:**

| Alt | Why |
|-----|-----|
| Docs only (A) | Misses skip of doomed pipelines and stuck recoveries |
| Deep merge (C) | Second FSM; unbounded tokens; violates router step budget and super-coder boundary |
| Always dispatch recovery without print-first | Surprising mutation after FAIL; prefer print unless `--auto` |

**Invariants:**
- One primary pipeline launch attempt per ready WBS per batch (unless recovery hop is the *only* extra action).
- Recovery ≤ 1 per WBS per batch.
- TABLES A/B/C remain SSOT in next-router; super-coder does not fork a private table.

**Impacted surfaces:**
| File | Role |
|------|------|
| `plugins/sp/agents/super-coder.md` | Boundary, skills, preflight/recovery Always rules |
| `plugins/sp/skills/spur-dev/references/execution-batch.md` | Algorithm steps 2.5 + 3.3 recovery |
| `plugins/sp/skills/next-router/SKILL.md` or routing-table.md | Optional "batch consumer" note |
| Optional: small TS helper under `plugins/sp/scripts/` if pure preflight is unit-tested |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | Cross-link only |
### Plan
1. Read super-coder.md + execution-batch.md end-to-end; draft boundary paragraphs (R1).
2. Add `sp:next-router` to super-coder `skills:` (R2).
3. Specify preflight algorithm in execution-batch.md Step 2.5 (inputs, STOP set, report fields) (R3–R4, R6).
4. Implement preflight: pure helper preferred; unit tests for A2 unmet deps + ready todo (R3, R9).
5. Specify recovery in Step 3.3 / super-coder Always rules; print-first vs `--auto` dispatch (R5).
6. Cross-link dev-operations + optional next-router "batch consumer" note (R7–R8).
7. Run unit tests / manual dry-run of preflight against a fixture WBS; paste evidence in Testing.
8. Solution change-map; leave task at `testing` for review/verify chain.
### Solution
| File | Change |
|------|--------|
| `plugins/sp/scripts/batch-preflight.ts:1-210` | Pure `preflightTask` (A2/A7/A8/A9 STOP) + `recoveryHint` + CLI for agents |
| `plugins/sp/tests/batch-preflight.test.ts:1-130` | 12 tests: A2 skip, ready run, recovery hops, CLI exit codes |
| `plugins/sp/agents/super-coder.md:22-140` | skills + next-router; boundary; Always preflight/recovery; Never deep-merge |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:138-230` | Step 2.6 preflight; loop + 3.3b one-shot recovery |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:35-45` | Batch consumer note for dev-next |
| `plugins/sp/skills/next-router/references/routing-table.md:10-25` | § Batch consumers |
### Testing
**Verification:** `/sp-dev-verify 0279 --auto --next` re-run 2026-07-17 (standalone; status already `done` — strict-core re-validated).

**Fresh commands this run:**

| Command | Result |
|---------|--------|
| `bun test plugins/sp/tests/batch-preflight.test.ts` | **12 pass / 0 fail** (100% fn / ~93% lines on helper) |
| `batch-preflight … --status todo --deps 0275 --dep-status 0275:todo --json` | exit **2**, `action: skip`, code **A2**, unmetDeps `["0275"]` |
| `batch-preflight … --dep-status 0275:done` | exit **0**, `run: preflight clear — launch task-pipeline` |
| `batch-preflight --status testing --recovery` | exit **0**, `/sp:dev-verify 0042 --auto --next` |
| `spur task check 0279 --strict-core` | **pass**, no errors |

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `super-coder.md` boundary: batch vs status-routing; pipeline happy path; deep-merge forbidden |
| R2 | MET | `super-coder.md:22` `skills: […, sp:next-router]` |
| R3 | MET | `preflightTask` A2/A7/A8/A9 + test "A2 — todo with unmet dep is skipped"; CLI exit 2 this run |
| R4 | MET | ready todo → `action: run` (test + CLI); docs: never substitute pipeline with dev-next loop |
| R5 | MET | `recoveryHint` + CLI `--recovery`; execution-batch §3.3b budget ≤1 |
| R6 | MET | execution-batch parallel: preflight per WBS; recovery sequential |
| R7 | MET | execution-batch Step 2.6/3.3b; dev-operations batch consumer note |
| R8 | MET | routing-table.md § Batch consumers; tables not forked into super-coder |
| R9 | MET | batch-preflight.test.ts 12 pass this run |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Super-coder still drives the pipeline for ready tasks | MET | test + static-ref | ready → run; super-coder/execution-batch keep task-pipeline happy path |
| Preflight skips unmet dependencies | MET | test + command | A2 unit test + CLI exit 2 this run with unmet 0275 |
| One-shot recovery after FAIL | MET | test + command | recoveryHint + CLI prints single `/sp:dev-verify …`; §3.3b never loop |
| Boundary is explicit in agent docs | MET | static-ref | super-coder.md orchestrator boundary + Never deep-merge |
| Multi-candidate router stop is not auto-picked | MET | static-ref | super-coder Never: multi-candidate HITL; --auto does not break ties |

**Design conformance:** DONE — light empowerment (option B): pure helper preferred; pipeline unchanged; recovery print-first.

**SECUA:** no blockers/majors. Advisory P3 (TABLE C probes not in preflight) accepted — live dev-next owns light gates.

**Coverage:** `batch-preflight.ts` 100% functions / ~93% lines (bun coverage this run).

**Fix pass:** none (`--fix` omitted).

Verdict: PASS
### Review
**Review scope:** batch-preflight helper + super-coder / execution-batch / next-router docs (task 0279 light empowerment).

**Functional:** R1–R9 MET (see Testing). AC: pipeline happy path preserved; A2 preflight skip tested; recovery one-shot documented + recoveryHint tested; boundary explicit; multi-candidate HITL forbidden in Never rules.

**Priority findings (P1–P4)**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | — | — | none |
| P2 | — | — | none |
| P3 | architecture | batch-preflight.ts | Pure helper mirrors A2/A7/A8/A9 only — light-gate TABLE C probes not duplicated (acceptable; full probe stays on live dev-next). |
| P4 | usability | recovery dispatch | Auto-dispatch of recovery under batch `--auto` is policy in docs; no separate flag to disable recovery (default on) — operators can ignore printed hints. |

**SECUA / Architecture:** PASS — no secrets; pure status logic; SSOT tables remain in next-router.

**Disposition:** PASS
### References
- Feature: [N](../features/N_sp-plugin-next-layer-ux-dev-next-router-and-dogfood-hardening.md)
- Dep: [0275 Ship /sp:dev-next](./0275_ship-sp-dev-next-command-and-sp-next-router-skill.md)
- Agents: `plugins/sp/agents/super-coder.md`
- Router: `plugins/sp/skills/next-router/`, `plugins/sp/commands/dev-next.md`
- Batch SSOT: `plugins/sp/skills/spur-dev/references/execution-batch.md`
### History
- 2026-07-17T06:41:15.668Z todo → wip (system)
- 2026-07-17T06:41:17.283Z wip → testing (system)
- 2026-07-17T06:41:21.827Z testing → done (system)
