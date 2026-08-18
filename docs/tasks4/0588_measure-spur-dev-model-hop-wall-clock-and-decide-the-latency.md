---
template: brainstorm
schema_version: 1
name: "Measure spur-dev model-hop wall-clock and decide the latency lever"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T15:49:26.547Z"
updated_at: "2026-08-18T15:50:31.270Z"
---

## 0588. Measure spur-dev model-hop wall-clock and decide the latency lever

### Background
Split out of task 0587 (R5) so the deterministic `pr-reviewing.ts` / gate-composition fixes there stay
delegable and unblocked. Source: `docs/dogfood/2026-08-17-sp-dev-pr-review-dogfood.md` (run
`20260817-235410`, §4.2–4.5).

That dogfood profiled the deterministic layer of a `task-pipeline.yaml` run and found it is **not**
the bottleneck: `bun run lint` 6.1s, full suite with coverage 81.1s, `corpus-check` 44.9s, rule
engine 3.9s × 2, CLI ops ≤ 0.3s — a composed quality gate of ~110–140s per run. Against that, the
pipeline spends **3–5 sequential agent sessions per task** (implement / test-fix / review / verify),
each a fresh session re-loading AGENTS.md + skills + indexed context + task body, each budgeted at
`stepTimeoutMs`/`implementTimeoutMs` = 1800000 (30 min). Those budgets are themselves evidence: they
were raised 600s → 1800s after implement timed out at 600s in five consecutive runs
(`config/workflows/task-pipeline.yaml:71,77` comments).

The conclusion "model-hop wall-clock is the long pole" is currently an **inference from timeout
budgets, not a measurement**. This task measures it, then records a decision. Task 0587 covers the
two measured deterministic levers (targeted recheck probe, coverage opt-in); this one covers the
lever that needs evidence before anyone writes code for it.
### Requirements
- [ ] R1. **Measure per-hop wall-clock from real runs.** Collect implement / test-fix / review /
  verify durations from 2–3 completed pipeline runs — prefer existing evidence over new runs:
  `.spur/run/*` artifacts, `coordination_runs` / `system_events` rows via `spur` CLI, and
  `spur history analyze` if the sessions were imported. Record for each hop: executor and model
  (default `omp` → `zai/glm-5.2`, `.spur/agents/demo-omp-zai.yaml`), observed duration, and
  observed-vs-budget ratio. Report `n` runs honestly; do not extrapolate from one.
- [ ] R2. **Attribute the cost inside a hop.** For at least one implement hop and one review/verify
  hop, split the wall-clock into (a) fixed context load (AGENTS.md + dispatched skills + indexed
  context + task body — measure the token/byte weight actually sent), (b) tool-call loop, (c) model
  generation. Approximation is acceptable; state the method and its confidence, per
  `plugins/sp/skills/dogfood-testing` monitor-ledger conventions.
- [ ] R3. **Write the decision note (≤ 1 page) with 2–3 options and one recommendation.** Candidate
  levers to evaluate against the R1/R2 evidence: (i) pin a faster executor/model for specific hops
  (`implementAgent` already exists as a per-hop pin), (ii) narrow hop scope / trim the per-hop
  context load, (iii) parallelize independent hops (review ∥ verify) — assess feasibility against
  the FSM's sequential transitions before recommending. Each option carries a cost, a risk, and the
  measurement that would confirm it. Land the note in this task's `### Design`; if the
  recommendation changes a documented mechanism, route it to `docs/00_ADR.md` per
  `docs/99_PROJECT_CONSTITUTION.md`.
### Acceptance Criteria
- [ ] AC1. Per-hop wall-clock table exists for ≥ 2 real runs, naming each run's id/source artifact,
  the executor + model, and the observed-vs-budget ratio per hop.
- [ ] AC2. Context-load attribution recorded for ≥ 1 implement hop and ≥ 1 review/verify hop, with
  the measurement method and a stated confidence level.
- [ ] AC3. Decision note ≤ 1 page in `### Design` with 2–3 options (cost / risk / confirming
  measurement each) and exactly one recommendation.
- [ ] AC4. No production code, workflow, or config change lands under this task unless the
  recommendation explicitly calls for it AND the operator approves it — the deliverable is the
  recorded decision.
### Q&A
- **Why split from 0587:** 0587's other four requirements are deterministic, testable code changes
  with a bounded diff. This one is a measurement whose done-condition is a judgment call — bundling
  them made 0587 un-delegable and pushed it to the pipeline's 5-R-item size cap.
- **Evidence before code.** The 30-min timeouts are headroom, not measured latency. Nothing here
  authorizes changing `stepTimeoutMs` / `implementTimeoutMs` — a budget change without measurement is
  how they got to 30 min in the first place.
- **Prefer existing artifacts over new runs.** A fresh pipeline run to gather timings costs one full
  task's wall-clock. Exhaust `.spur/run/*`, run records, and imported history first.
### Design
<!-- Filled by R3: measured evidence, options, recommendation. -->

**Method (planned).** Evidence-first: read what the pipeline already wrote (`.spur/run/*`, run
records, imported history) before spending a fresh run. Attribution is approximate by design — the
question is which term dominates (context load vs tool loop vs generation), not its exact value.

**Bound.** Measure → document → recommend. No speculative code: each candidate lever (executor pin,
hop-scope narrowing, review∥verify parallelization) carries real cost/risk, and the 600s → 1800s
timeout raise is the precedent for what symptom-driven tuning without measurement produces.
### Plan
- [ ] Inventory available evidence: `.spur/run/*`, run records, imported history (R1)
- [ ] Extract per-hop wall-clock for 2–3 runs into a table (R1)
- [ ] Attribute one implement hop and one review/verify hop by cost term (R2)
- [ ] Draft the ≤1-page note: 2–3 options + recommendation, land it in `### Design` (R3)
- [ ] Route to `docs/00_ADR.md` if the recommendation changes a documented mechanism (R3)
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Parent finding: `docs/dogfood/2026-08-17-sp-dev-pr-review-dogfood.md` §4.2–4.5, §6 (P3 model-hop row)
- Split from: task `0587` (R5 removed there on 2026-08-18; deterministic levers stay in 0587)
- Budgets + comments: `config/workflows/task-pipeline.yaml:71` (`stepTimeoutMs`), `:77` (`implementTimeoutMs`), `:87` (`qualityGateCmd`)
- Hops: `config/workflows/task-pipeline.yaml:279` (implement), `:355` (test-fix), `:422` (review)
- Executor: `.spur/agents/demo-omp-zai.yaml` (`omp` → `zai/glm-5.2`); per-hop pin var `implementAgent` (`:66`)
### History
