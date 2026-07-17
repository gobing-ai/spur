---
template: brainstorm
schema_version: 1
name: "Define /sp:dev-next v1 routing table (status × signals → command)"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dev-next"]
dependencies: []
created_at: "2026-07-17T00:54:24.636Z"
updated_at: "2026-07-17T01:03:06.375Z"
---

## 0270. Define /sp:dev-next v1 routing table (status × signals → command)

### Background
**Type:** `wayfinder:grilling` · **Feature:** [N](../features/N_sp-plugin-next-layer-ux-dev-next-router-and-dogfood-hardening.md)

**Question (answer when claimed):** What is the deterministic v1 routing table for `/sp:dev-next` — mapping (task/feature corpus status + optional light-gate signals) → exactly one recommended `/sp:dev-*` or `spur` verb, including multi-candidate **stop** cases?

**Product contract (locked):**

| Decision | Locked value |
| --- | --- |
| Product shape | Status-router + **dispatcher** over existing commands (no second pipeline FSM) |
| Auto-advance | Chain on clean success along existing `--next`/lifecycle edges; stop on HITL, guard fail, multi-candidate fork |
| Signals | Corpus status **first** (`spur task\|feature show\|list --json`); light gates only when needed |
| Identity | Task WBS primary; optional feature ID → next frontier task then route |
| Flags expected | `--dry-run` (print only), `--once` (no chain) |

**Why:** Operators must know which of ~27 commands to run. Partial automation exists (`--next` on refine/run/verify; full `dev-run` pipeline). Missing: a single status-aware entry that also covers hygiene (unit gaps, rule check, fixall) without reimplementing the spine.

**Prior art to read:**
- `plugins/sp/README.md` — command index + main flow
- `plugins/sp/commands/dev-run.md` — `--next` chain semantics
- `plugins/sp/commands/dev-refine.md` — backlog→todo + chain
- `plugins/sp/skills/spur-dev/references/dev-operations.md` — per-command contracts
- `plugins/sp/skills/spur-dev/references/execution-workflow.md` — status selection
- Task `0119` — original `--next` auto-chain
- Feature `I` (done) — hands-off ready baseline

**Out of this ticket:** Skill ownership (→ 0271), CLI flag details (→ 0272), implementation code.
### Requirements
- [x] R1. Table covers **planning half** statuses (at least): feature without AC / AC fail / no tasks; task `backlog` (needs refine); task `todo` ready to run.
- [x] R2. Table covers **execution half** statuses (at least): `wip` (resume implement or continue), `testing` (verify), review-pending / guard failure recovery pointer, `done` (wrap candidate).
- [x] R3. Table covers **hygiene / light-gate** routes when corpus status alone is insufficient: empty/insufficient tests → `dev-unit`; lint/type red → `dev-fixall`; rule findings → `spur rule run` or `rule-scan`/`rule-add` as appropriate; task check L3 failures → surface fix then re-route.
- [x] R4. Every row names: **precondition**, **primary signal source** (CLI verb + field), **command to dispatch**, **success → chain?** (yes/no + target), **stop reason** if not unique.
- [x] R5. Multi-candidate forks are explicit **HITL stop** rows (decision-brief), never silent priority hacks without documenting the priority order.
- [x] R6. Feature-ID path: algorithm to pick next frontier task (unblocked `todo`/`backlog`, deps done) is written; if none → feature-level next (e.g. wrapall / feature advance / plan) or stop with reason.
- [x] R7. Explicit non-routes: never dispatch into `task-pipeline.yaml` reimplementation; never bypass lifecycle guards.
- [x] R8. Deliverable written into this task's Solution as a markdown table + short narrative; map feature N Decisions so far gets a one-line gist when this ticket is marked done.
### Acceptance Criteria
```gherkin
@core
Scenario: Routing table is complete enough to implement the router
  Given task 0270 Solution contains a routing table
  When a designer implements /sp:dev-next against that table alone
  Then every common status an operator hits in the daily flow has a row
  And every multi-candidate case is a documented stop or ordered priority

@core
Scenario: No second FSM
  Given the Solution
  When reading recommended dispatches
  Then each dispatch targets an existing /sp:dev-* or spur verb
  And none invent a new multi-step engine inside dev-next
```
### Q&A
**Q (full pipeline vs next for todo).** Default is the --next implement chain (row A3). Full mode is not the v1 default.

**Q (sequential vs parallel light gates).** Sequential short-circuit C1 through C5 (deterministic, lower token cost).

**Q (fixall or unit auto re-enter next).** No in v1. Operator re-invokes /sp:dev-next (one primary dispatch per invocation).

**Assumptions.** Status enums from packages/domain/src/planning/schema.ts; command contracts from dev-operations.md.
### Design
**Selected direction:** Deterministic table-driven router (TABLE A task / TABLE B feature / TABLE C light gates) with sequential short-circuit probes and HITL multi-candidate stops. One dispatch per invocation; chains only via existing --next on refine/run/verify.

**Rejected:**
1. Always full pipeline for todo — too heavy vs locked auto-chain style.
2. Parallel light-gate probes — non-deterministic and higher token cost.
3. Self-looping dev-next until done — unbounded cost; operator re-invokes after non-chain dispatches.
### Plan
1. Load command index + lifecycle status model from spur-dev references.
2. Draft rows for pure status transitions (no light gates).
3. Add light-gate rows with short-circuit order recommendation.
4. Add feature-ID frontier selection algorithm.
5. Stress-test table against 3 fictional scenarios (new feature, mid-implement, post-done wrap).
6. Write Solution; update feature N Decisions so far; mark done.
### Solution
**Answer:** The v1 routing table below is the SSOT for `/sp:dev-next`. The router is a pure status→command dispatcher: resolve target → load corpus → apply primary table → optional light-gate short-circuit → single dispatch or HITL stop → optional chain.

---

## 0. Algorithm (deterministic)

```
INPUT:  positional target (WBS | feature-id | omit), flags (--dry-run, --once, --auto?, --agent?)
OUTPUT: printed plan; optionally invoke one /sp:dev-* or spur verb; optionally chain

1. Resolve target
   a. Digits-only or known WBS → task mode
   b. Feature-id regex ^[A-Z][1-9]*$ → feature mode (pick frontier task, else feature-level row)
   c. Omitted → NOT v1 (see Non-routes); stop with usage
2. Load signals (corpus first)
   - task:  spur task show <wbs> --json
   - feature (if any): spur feature show <id> --json
   - deps: for each dependencies[] entry, spur task show <dep> --json → status
3. Primary route = TABLE A (task) or TABLE B (feature-level when no frontier task)
4. Light gates — ONLY if the matched row sets probe=yes
   - Run TABLE C probes in listed short-circuit order; first hit replaces dispatch
5. Cardinality
   - 0 candidates → stop (message: no route)
   - 1 candidate → dispatch (or print if --dry-run)
   - >1 candidates → HITL STOP (decision-brief; never silent pick)
6. On dispatch success and not --once and row.chain is set → invoke chain command
   On guard/HITL/fail → stop; leave status; print recovery line
```

**Default flags forwarded into dispatched lifecycle commands:** `--auto` when the operator passed it or when chaining (chain links already use `--auto` per existing refine→run→verify convention). `--agent` forwarded only when the child command documents it.

---

## 1. TABLE A — Task primary routes (corpus status)

Statuses from `TASK_STATUSES`: backlog | todo | wip | testing | blocked | done | cancelled.

| # | Precondition | Primary signal | Dispatch | probe | Chain on success? | Stop / notes |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | `status == backlog` | `task.show.status` | `/sp:dev-refine <wbs> --auto --next` | yes (refine skip-gate sections) | **yes** — refine's own `--next` → run → verify | If refine fails guard → stop review-pending |
| A2 | `status == todo` AND any open dep `status != done` | `dependencies[]` + dep statuses | *(none)* | no | no | **STOP** — blocked by deps; print unmet dep WBS list. Do not invent parallel work. |
| A3 | `status == todo` AND deps satisfied | `task.show.status` + deps | `/sp:dev-run <wbs> --auto --next` | yes | **yes** — run's `--next` → verify | Prefer chain-link implement path (matches existing auto chain), not full pipeline reimplementation |
| A4 | `status == wip` AND checkpoint exists under `.spur/memory/sessions/*-<wbs>-*` | checkpoint `next_action` | `/sp:dev-run <wbs> --continue` | no | no (continue owns resume) | If continue cannot resume → fall through A5 |
| A5 | `status == wip` (no usable checkpoint) | `task.show.status` | `/sp:dev-run <wbs> --mode implement --auto --next` | yes | **yes** → verify | Completes implement step then chain |
| A6 | `status == testing` | `task.show.status` | `/sp:dev-verify <wbs> --auto --next` | yes | **yes** — verify `--next` → done (FSM + provenance guards) | On PARTIAL/FAIL → stop review-pending (do not force done) |
| A7 | `status == blocked` | `task.show` + Notes/History for blocker text | `/sp:dev-handover "<blocker summary from Notes or status>"` | no | no | **STOP** after handover doc; human unblocks |
| A8 | `status == done` | `task.show.status` | `/sp:dev-wrap <wbs>` | no | **no** (wrap's `--merge` is irreversible HITL; never auto) | Operator may re-invoke with `--merge` explicitly later |
| A9 | `status == cancelled` | `task.show.status` | *(none)* | no | no | **STOP** — no-op; print "cancelled — nothing to advance" |

**Priority when multiple TABLE A rows could match:** lowest row number wins (A1–A9 are mutually exclusive by status except A2/A3 which split `todo`).

---

## 2. TABLE B — Feature-ID path (rollup)

When input is a feature id:

| # | Precondition | Primary signal | Dispatch | probe | Chain? | Stop / notes |
| --- | --- | --- | --- | --- | --- | --- |
| B0 | Feature missing / invalid id | `feature show` exit ≠ 0 | *(none)* | no | no | **STOP** — unknown feature |
| B1 | `feature.status == cancelled` | feature status | *(none)* | no | no | **STOP** |
| B2 | `feature.status == done` | feature status | *(none)* | no | no | **STOP** — suggest archive/docs only; no auto wrapall |
| B3 | Feature has ≥1 frontier task | task list under feature | **Recurse TABLE A** on chosen task | per A | per A | Frontier = open (`backlog`\|`todo`\|`wip`\|`testing`\|`blocked`), unblocked (all `dependencies[]` done), prefer WBS-ascending among `todo` then `backlog` then `wip` then `testing` then `blocked` |
| B4 | No frontier tasks AND `feature.status == backlog` AND AC placeholder/invalid | `feature check` / AC body | `/sp:dev-plan` continuation is not WBS-shaped — **STOP** with: run `/sp:dev-plan --feature <id>` or fix AC then `spur feature check <id>` | no | no | Planning-half entry needs a description; do not invent idea text |
| B5 | No frontier tasks AND feature has valid AC but zero tasks | feature + empty task roster | **STOP** with: `/sp:dev-plan --feature <id>` (decompose/batch-create) | no | no | Avoid auto-running plan without operator description confirmation in v1 |
| B6 | No frontier tasks AND all child tasks `done` AND feature in `active`\|`verifying` | task list all done | `/sp:dev-wrapall --feature <id>` | no | no | Advances feature via wrapall guards; `--merge` never auto |
| B7 | No frontier tasks AND mixed cancelled/done only | statuses | **STOP** — print summary; suggest feature status update manually | no | no | |
| B8 | `feature.status == blocked` | feature status | **STOP** — print feature blocked; do not pick tasks | no | no | |

**Frontier selection algorithm (B3) — precise:**

```
candidates = tasks where feature_id == ID
             AND status ∈ {backlog, todo, wip, testing, blocked}
             AND every dep in dependencies[] has status == done
order = stable sort by:
  1. status rank: todo=0, backlog=1, wip=2, testing=3, blocked=4
  2. WBS ascending (numeric)
pick = first(candidates)
if pick is null → TABLE B rows B4–B7
else → TABLE A(pick)
```

---

## 3. TABLE C — Light-gate short-circuit (probe=yes rows only)

**Order is sequential short-circuit** (first match wins). Never parallel in v1 (simpler, lower token, deterministic).

| Order | When evaluated | Probe | Signal | Redirect dispatch | Else |
| --- | --- | --- | --- | --- | --- |
| C1 | A1, A3, A5 (pre-implement / refine path) | `spur task check <wbs> --json` | Any **L3** finding on sections ∈ {Background, Requirements, Plan} | Force `/sp:dev-refine <wbs> --auto` (**without** `--next` if already mid-refine; with `--next` only when status was backlog/todo and operator wants chain — default: keep `--next` for A1/A3) | continue |
| C2 | A3, A5 after C1 clean | Cheap workspace health: `bun run lint` (or project lint) exit ≠ 0 **and** scope inferable from task Solution/Plan paths or default repo | lint/type failures | `/sp:dev-fixall` (optional `--scope` if single package known) | continue |
| C3 | A5/A6 when Testing empty/N/A **and** verify would fail for missing tests — only if prior implement claims code exists | Coverage/test signal: `bun test` fail attributed to task paths OR explicit "insufficient tests" in prior verify verdict artifact `.spur/run/<wbs>-verdict.json` | test fail / coverage gap | `/sp:dev-unit <wbs> --auto` | continue |
| C4 | A3/A5/A6 when operator or task tags mention rules, OR `spur rule run` last report dirty in `.spur/` if present | `spur rule run` (default project preset) non-zero with findings | rule findings | **HITL STOP** — print rule summary; suggest `/sp:rule-scan` or `rule-add`/`rule-refine` (do not auto-author rules) | continue |
| C5 | A6 only | Existing `.spur/run/<wbs>-verdict.json` with FAIL and findings pointing at coverage | verdict artifact | `/sp:dev-unit <wbs>` then re-verify on next invocation (`--once` friendly) | `/sp:dev-verify …` |

**Explicit non-probes in v1:** no freeform chat history; no always-on full `bun run test` for every call; no git dirtiness as a route (optional advisory print only).

---

## 4. Multi-candidate HITL STOP matrix

| Situation | Why not auto | Operator brief options (recommended first) |
| --- | --- | --- |
| C2 and C3 both true | lint vs tests both red | (1) fixall (2) unit (3) abort |
| Feature B3 pick ambiguous because two `todo` same rank — **should not happen** after WBS sort | — | N/A — WBS tie-break is total |
| Task `todo` but also feature-level AC invalid when invoked via feature id | feature health vs task progress | (1) fix feature AC (2) proceed with task A3 |
| `testing` with open P1 in Review section | verify vs review-fix | (1) `/sp:dev-review <wbs> --fix blockers-first` (2) verify anyway |
| `wip` with both checkpoint and dirty Solution L3 | resume vs re-implement | (1) `--continue` (2) implement `--next` |

When HITL STOP fires: print decision-brief (question, stakes, recommended option, alternatives). **Do not dispatch** until operator answers (or `--auto` is **not** allowed to break multi-candidate ties in v1 — `--auto` only skips confirmations *inside* a single chosen command).

---

## 5. Chain semantics (success path)

| After successful dispatch | If not `--once` | Notes |
| --- | --- | --- |
| `dev-refine … --next` | already chains internally | Router does not double-chain |
| `dev-run … --next` | already chains to verify | Router does not double-chain |
| `dev-verify … --next` | already attempts done | Router stops after return |
| `dev-unit` / `dev-fixall` / `dev-wrap` / `dev-handover` | **no auto re-entry** into router in v1 | Operator re-invokes `/sp:dev-next` for the next hop (keeps token cost bounded) |
| HITL / guard failure | no chain | Print recovery one-liner with exact re-run command |

**Step budget:** one router invocation performs **at most one primary dispatch** (+ whatever that command's own `--next` chain does). It does **not** loop `dev-next` on itself (prevents unbounded auto).

---

## 6. Non-routes (explicit)

| Temptation | Why forbidden in v1 |
| --- | --- |
| Reimplement `task-pipeline.yaml` inside next | Spine owns full pipeline; use `dev-run` without `--next` only if we add a future row — **not default** |
| Default to `/sp:dev-run --mode full` for every `todo` | Heavier HITL surface; chain-link is the locked auto-advance style |
| Infer target from git dirty / chat | Locked out of v1 signals |
| Auto `--merge` on wrap | Irreversible |
| Auto `rule-add` | Authoring needs human judgment |
| `dev-runall` as default for feature | Batch is a deliberate aperture; feature path picks **one** frontier task |
| Lifecycle bypass (`--no-lifecycle`) to force progress | Guards are the product |

---

## 7. Worked scenarios (stress tests)

**S1 — New task, backlog, empty Plan L3**  
Signals: status=backlog → A1 → C1 may still refine → `/sp:dev-refine 0042 --auto --next` → chains to implement/verify.

**S2 — Mid implement, wip, no checkpoint**  
A5 → C1 clean → C2 lint red → short-circuit `/sp:dev-fixall` → stop (no auto re-enter). Operator runs `/sp:dev-next 0042` again → A5 → implement.

**S3 — Feature F, three todo tasks, one blocked by dep**  
B3 frontier filter drops blocked-by-dep; WBS-ascending picks lowest ready todo → A3.

**S4 — All tasks done, feature active**  
B6 → `/sp:dev-wrapall --feature F`.

**S5 — testing, verify would fail on tests**  
A6 → C5/C3 → unit first if verdict says so; else verify.

---

## 8. R-checklist coverage

| R | Satisfied by |
| --- | --- |
| R1 planning statuses | A1, B4, B5 |
| R2 execution statuses | A3–A8 |
| R3 hygiene light gates | TABLE C |
| R4 row columns | all tables |
| R5 multi-candidate | §4 |
| R6 feature frontier | B3 algorithm |
| R7 non-routes | §6 |
| R8 this Solution | here |

---

## 9. Fog graduated by this answer

Now sharp enough for later tickets (do **not** implement in this session):

- Light-gate C2 scope inference details (package boundary heuristics)
- Whether `todo` should ever prefer `--mode full` via an explicit `/sp:dev-next --full` flag (CLI surface → 0272)
- Interaction with `dev-runall` as an **opt-in** feature flag (still fog for product)

Still fog (unchanged): skill ownership (0271), dogfood (0273/0274), CLI flag names (0272), provenance friction as separate lifecycle fix.

**Source anchors (file:line):**
- Task status enum: `packages/domain/src/planning/schema.ts:20`
- Feature status enum: `packages/domain/src/planning/schema.ts:23`
- Dev operations map: `plugins/sp/skills/spur-dev/references/dev-operations.md:37-56`
- `--next` chain on run: `plugins/sp/commands/dev-run.md:104-127`
- Refine skip-gate sections: `plugins/sp/skills/spur-dev/references/dev-operations.md:114-128`
- Task lifecycle wip→testing guard: `config/workflows/task-lifecycle.yaml:48-54`

### Testing
**Validation performed.**
- Confirmed task statuses in packages/domain/src/planning/schema.ts:20
- Confirmed feature statuses in packages/domain/src/planning/schema.ts:23
- Cross-checked dispatch targets against plugins/sp/skills/spur-dev/references/dev-operations.md:37-56
- Cross-checked --next chain against plugins/sp/commands/dev-run.md:104-127
- Walked stress scenarios S1-S5 against tables (manual)

**Runtime tests.** N/A for this investigation ticket (router not implemented yet).
### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Feature N map: `docs/features/N_sp-plugin-next-layer-ux-dev-next-router-and-dogfood-hardening.md`
- Depends on: (none — frontier)
- Blocks: 0272 (CLI surface needs table)
- Related: 0271 (ownership can proceed in parallel)
### History
- 2026-07-17T01:01:10.818Z todo → wip (system)
- 2026-07-17T01:03:00.153Z wip → testing (system)
- 2026-07-17T01:03:06.375Z testing → done (system)
