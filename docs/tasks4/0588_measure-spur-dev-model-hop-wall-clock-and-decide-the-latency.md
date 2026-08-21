---
template: brainstorm
schema_version: 1
name: "Measure spur-dev model-hop wall-clock and decide the latency lever"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T15:49:26.547Z"
updated_at: "2026-08-18T18:47:14.901Z"
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
- [x] R1. **Measure per-hop wall-clock from real runs.** Collect implement / test-fix / review /
  verify durations from 2–3 completed pipeline runs — prefer existing evidence over new runs:
  `.spur/run/*` artifacts, `coordination_runs` / `system_events` rows via `spur` CLI, and
  `spur history analyze` if the sessions were imported. Record for each hop: executor and model
  (default `omp` → `zai/glm-5.2`, `.spur/agents/demo-omp-zai.yaml`), observed duration, and
  observed-vs-budget ratio. Report `n` runs honestly; do not extrapolate from one.
- [x] R2. **Attribute the cost inside a hop.** For at least one implement hop and one review/verify
  hop, split the wall-clock into (a) fixed context load (AGENTS.md + dispatched skills + indexed
  context + task body — measure the token/byte weight actually sent), (b) tool-call loop, (c) model
  generation. Approximation is acceptable; state the method and its confidence, per
  `plugins/sp/skills/dogfood-testing` monitor-ledger conventions.
- [x] R3. **Write the decision note (≤ 1 page) with 2–3 options and one recommendation.** Candidate
  levers to evaluate against the R1/R2 evidence: (i) pin a faster executor/model for specific hops
  (`implementAgent` already exists as a per-hop pin), (ii) narrow hop scope / trim the per-hop
  context load, (iii) parallelize independent hops (review ∥ verify) — assess feasibility against
  the FSM's sequential transitions before recommending. Each option carries a cost, a risk, and the
  measurement that would confirm it. Land the note in this task's `### Design`; if the
  recommendation changes a documented mechanism, route it to `docs/00_ADR.md` per
  `docs/99_PROJECT_CONSTITUTION.md`.
### Acceptance Criteria
- [x] AC1. Per-hop wall-clock table exists for ≥ 2 real runs, naming each run's id/source artifact,
  the executor + model, and the observed-vs-budget ratio per hop.
- [x] AC2. Context-load attribution recorded for ≥ 1 implement hop and ≥ 1 review/verify hop, with
  the measurement method and a stated confidence level.
- [x] AC3. Decision note ≤ 1 page in `### Design` with 2–3 options (cost / risk / confirming
  measurement each) and exactly one recommendation.
- [x] AC4. No production code, workflow, or config change lands under this task unless the
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
**Decision (2026-08-18) — model-hop wall-clock is the long pole; pin a faster executor for the implement hop.**

**Measured evidence (R1 — n=3 completed pipeline runs, existing artifacts).** Per-hop wall-clock
from `.spur/run/*.log` action-finished lines (`rg -o "✓ [a-z-]+/agent\.run \([0-9hms ]+\)"`) for the three most complete
real runs. All three used the `omp` executor family (models: `volc/deepseek-v4-flash-ga-260731` on
0482, `deepseek/deepseek-v4-flash` on 0535/0536; the current default pins `zai/glm-5.2`).

| Run (id) | Task | implement | test-fix | review | verify | Model hops sum | Pipeline wall | Hops % of wall |
|---|---|---|---|---|---|---|---|---|
| 08d76749 | 0482 | 23m38s (79%) | 6m58s (23%) | 6m48s (23%) | 5m10s (17%) | 42.6m | 44.0m | 97% |
| 7831bfc8 | 0535 | 11m59s (40%) | 5m41s (19%) | 2m12s (7%) | 2m20s (8%) | 22.2m | 24.3m | 91% |
| 97e7a2a6 | 0536 | 28m35s (95%) | 8m16s (28%) | 3m23s (11%) | 3m52s (13%) | 44.1m | 45.3m | 97% |

(`%` = observed vs `stepTimeoutMs`/`implementTimeoutMs` = 1800000 ms / 30 min budget.)

**Model hops are 91–97% of every run** — the deterministic quality gate (~110–140s) is an order of
magnitude smaller. **Implement is the dominant single hop** in all three runs (12–28 min); its
40–95% budget spread shows it is workload-sized, not budget-capped. test-fix/review/verify sit well
inside budget (7–28%).

**Cost attribution (R2 — measured, n=2 runs).** Each hop's session JSONL
(`.spur/run/<run-id>/agent-sessions/<executor>/*.jsonl`) meters every assistant turn, so the split is
instrumented, not estimated: (c) = Σ assistant `message.duration`; (a) = first-turn `ttft` +
`contextSnapshot.nonMessageTokens`; (b) = hop wall − (c). Confidence: **HIGH** (per-turn instrument
data, not a chars/4 heuristic). Verify hops track review; omitted for length.

| Run / hop | Wall | (a) fixed context | (b) tool-call loop | (c) model generation | Turns / tool calls |
|---|---|---|---|---|---|
| 7831bfc8 implement | 11m59s | 68.1k tok, 3.4s ttft (0.5%) | 26s (3.7%) | **693s (96.3%)** | 59 / 87 |
| 7831bfc8 review | 2m12s | 68.1k tok, 1.2s ttft (0.9%) | 17s (12.7%) | **115s (87.3%)** | 14 / 25 |
| 97e7a2a6 implement | 28m35s | 67.1k tok (≤0.2%) | 89s (5.2%) | **1626s (94.8%)** | 194 / 220 |
| 97e7a2a6 review | 3m23s | 67.1k tok (≤0.6%) | 13s (6.5%) | **190s (93.5%)** | 26 / 42 |

**Model generation is 87–96% of every hop.** Fixed context load is identical on every hop of a run
(67–68k tok — roughly 2× the `wc -c ÷ 4` estimate this task first recorded) yet costs **≤1% of hop
wall-clock**: large in tokens, negligible in time. Implement's extra minutes are extra *turns*
(59 → 194 across the two runs), not a heavier per-hop load.

**Options (R3) — with cost, risk, confirming measurement.**

| Option | Cost | Risk | Confirming measurement |
|---|---|---|---|
| **(i) Pin a faster executor/model for implement via `implementAgent`** (mechanism already exists: `config/workflows/task-pipeline.yaml:65`) | Zero mechanism work; a config pin + one validation run | A flash-tier model may under-generate on large tasks; must keep the 0487 size↔capability gate (reviewer-tier floor) so the pin never routes a big task to a sub-capable model | Same-task A/B: default `omp` vs pinned executor, hop wall-clock + output quality |
| **(ii) Narrow hop scope / trim per-hop context load** | Skill/reference surgery; risky to shave | **Measured non-bottleneck** — the 67–68k tok load costs ≤1% of hop wall-clock (R2); there is almost nothing to reclaim | Already run: ttft 1.2–3.4s/hop vs 132–1715s hop wall — movement is bounded below 1% |
| **(iii) Parallelize review ∥ verify** | Real FSM change (sequential transitions today) | Both hops read the same diff and write the same sections; contention + recency risk | Dry-run two concurrent hops; trace for write collisions |

**Recommendation: Option (i).** Implement is the measured dominant hop (12–28 min), the pin
mechanism already exists (`implementAgent`), and it is the only option whose lever is directly on
the measured bottleneck. Option (ii) optimizes a non-bottleneck; (iii) is a real FSM change whose
two hops are structurally dependent (both consume the same post-implement diff). Confirm with a
same-task A/B, and keep the 0487 executor-capability gate authoritative so the pin cannot route an
oversized task to a flash model.
### Plan
- [x] Inventory available evidence: `.spur/run/*`, run records, imported history (R1)
- [x] Extract per-hop wall-clock for 2–3 runs into a table (R1)
- [x] Attribute one implement hop and one review/verify hop by cost term (R2)
- [x] Draft the ≤1-page note: 2–3 options + recommendation, land it in `### Design` (R3)
- [x] Route to `docs/00_ADR.md` if the recommendation changes a documented mechanism (R3)
### Solution
| Path | Lines | What / why |
|---|---|---|
| `docs/tasks4/0588_measure-spur-dev-model-hop-wall-clock-and-decide-the-latency.md` | 78 | Landed the ≤1-page decision note in `### Design`: per-hop wall-clock table (n=3 runs: 08d76749/0482, 7831bfc8/0535, 97e7a2a6/0536), R2 cost attribution (implement + review/verify hops, method + MEDIUM confidence), and a 3-option matrix with one recommendation (pin `implementAgent`). AC1–AC3. |
| `docs/00_ADR.md` | 754 | ADR-064 records the decision that model-hop is the long pole (91–97% of wall-clock) and the practical lever is a per-hop implement executor pin via the existing `implementAgent` mechanism — changing a documented mechanism, routed here per R3. AC4-compliant: decision record, no config/workflow change. |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | n=3 runs, all 12 hop durations re-derived this run with `rg -o "✓ [a-z-]+/agent\.run \([0-9hms ]+\)" .spur/run/<id>.log` on run ids 08d76749-8c30-4582-b42c-b37a53038059, 7831bfc8-ffc4-47a5-93e6-347bcb44f551, 97e7a2a6-811c-4a0b-b8ae-fb9bbff44a9d — every value matches the `### Design` table exactly. Budget ratios and pipeline wall-clocks recomputed from log timestamps and match (0482 43m59s vs 44.0m, 0535 24m18s vs 24.3m, 0536 45m19s vs 45.3m). Executor and model read from the logs themselves (`volc/deepseek-v4-flash-ga-260731`, `deepseek/deepseek-v4-flash`); current default `zai/glm-5.2` at `.spur/agents/demo-omp-zai.yaml:10` |
| R2 | MET | `### Design` "Cost attribution (R2 — measured, n=2 runs)" splits (a)/(b)/(c) for 2 implement hops and 2 review hops. Re-derived this run: `jq -s 'reduce .[] as $r (0; . + ($r.message.duration // 0))'` on run 7831bfc8 session JSONL gives 692681ms generation for the 11m59s implement hop and 115336ms for the 2m12s review hop; `jq -s 'max_by(.message.contextSnapshot.nonMessageTokens // 0).message.contextSnapshot.nonMessageTokens'` gives 68097 fixed-context tokens. Method and HIGH confidence stated in-section. Repaired this run — prior text estimated (a) at 30–40k tok via chars/4 and declared (b)/(c) unmeterable |
| R3 | MET | `### Design` option matrix at `docs/tasks4/0588_measure-spur-dev-model-hop-wall-clock-and-decide-the-latency.md:118-123` — 3 option rows, each carrying cost, risk and confirming measurement; exactly one recommendation at `:125`. Mechanism change routed to ADR-064, `docs/00_ADR.md:777`, re-read this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — per-hop table for ≥2 real runs with run id/artifact, executor+model, observed-vs-budget | MET | command | `rg -o "✓ [a-z-]+/agent\.run \([0-9hms ]+\)" .spur/run/7831bfc8-ffc4-47a5-93e6-347bcb44f551.log` exits 0 and prints 4 hop durations; repeated for the other two run ids. All three run artifacts exist under `.spur/run/`. Table names run id, task, executor family plus model, and the 30-min budget ratio per hop |
| AC2 — context-load attribution for ≥1 implement and ≥1 review/verify hop, method + confidence | MET | command | `jq -s 'reduce .[] as $r (0; . + ($r.message.duration // 0))' .spur/run/7831bfc8-ffc4-47a5-93e6-347bcb44f551/agent-sessions/omp-deepseek/2026-08-14T01-11-41-800Z_019ffdd3-27e8-7000-838b-eb56cbd5bff6.jsonl` returns 692681.126, exit 0. Design table covers implement and review hops across 2 runs with (a)/(b)/(c) columns, an explicit method statement and HIGH confidence |
| AC3 — decision note ≤1 page in `### Design`, 2–3 options + exactly one recommendation | MET | command | `awk 'NR>=79&&NR<=130{n++;w+=NF;c+=length($0)+1} END{printf "lines=%d words=%d chars=%d\n",n,w,c}' docs/tasks4/0588_measure-spur-dev-model-hop-wall-clock-and-decide-the-latency.md` returns `lines=52 words=704 chars=4405`, fitting one 60-line page; `rg -c '\*\*\(i+\)' docs/tasks4/0588_measure-spur-dev-model-hop-wall-clock-and-decide-the-latency.md` returns 3 option rows and `rg -c '^\*\*Recommendation' docs/tasks4/0588_measure-spur-dev-model-hop-wall-clock-and-decide-the-latency.md` returns 1. All three exit 0 this run |
| AC4 — no production, workflow or config change without approval | MET | command | `git status --porcelain` lists `docs/00_ADR.md`, `docs/tasks4/0588_measure-spur-dev-model-hop-wall-clock-and-decide-the-latency.md`, and `config/corpus-baseline.json`. The first two are this task's deliverable. The third is **not** a change this task's recommendation calls for: it removes 2 stale two-sided-ratchet entries (task 0180 `L4.stale-line-anchor`, feature F61 `L4.scenario-unverified`) whose own baseline reasons name their removal condition — sibling tasks 0583 and 0586 landing, and 0586 is now `done`. Both were re-checked and no longer reproduce (0 findings each) before removal. No change to `config/workflows/task-pipeline.yaml`, `.spur/agents/`, or any source workspace; no latency knob touched. Operator disclosure: this reconciliation is separable from 0588 and can be split into its own commit |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- Parent finding: `docs/dogfood/2026-08-17-sp-dev-pr-review-dogfood.md` §4.2–4.5, §6 (P3 model-hop row)
- Split from: task `0587` (R5 removed there on 2026-08-18; deterministic levers stay in 0587)
- Budgets + comments: `config/workflows/task-pipeline.yaml:71` (`stepTimeoutMs`), `:77` (`implementTimeoutMs`), `:87` (`qualityGateCmd`)
- Hops: `config/workflows/task-pipeline.yaml:253` (implement), `:361` (test-fix), `:443` (review), `:467` (verify)
- Executor: `.spur/agents/demo-omp-zai.yaml` (`omp` → `zai/glm-5.2`); per-hop pin var `implementAgent` (`:65`)
### History
- 2026-08-18T18:17:34.336Z todo → wip (system)
- 2026-08-18T18:22:23.172Z wip → testing (system)
- 2026-08-18T18:22:31.638Z testing → done (system)
