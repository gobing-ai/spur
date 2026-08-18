---
template: feature-impl
schema_version: 1
name: "Harden implement-agent Solution prompt + re-measure pipeline cache hit rate"
description: ""
status: done
type: task
profile: standard
feature_id: B1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-26T06:16:27.866Z"
updated_at: "2026-08-18T04:42:46.904Z"
---

## 0128. Harden implement-agent Solution prompt + re-measure pipeline cache hit rate

### Background
Follow-up to task **0127** (sp-dev-run 0102 dogfood). 0127's core P0/P1 reliability work — liveness-only agent readiness gate, timeout-kill ⇒ fail, auth/liveness decouple (ts-ai-runner 0.4.1), doctor auth column, async-invocation doc, `--next` full-mode warning — shipped and went `done` gate-green. These **two minor, non-blocking** items were split out so the finished reliability work could close.

#### P2 — implement-agent does not reliably author `## Solution`

The pipeline's implement stage owns `## Solution` (`plugins/sp/skills/spur-dev/references/execution-workflow.md:49-58`), but the spawned subprocess did not author it in the 0102 dogfood — the `record --solution-from-diff` safety net + review agent backfilled instead. Partly mitigated now (claude is a saner default than the unusable omp), but the prompt hardening + a confirming test run were never done.

- Confirm via a small-task pipeline run (agent=claude) whether the implement agent authors `## Solution` with the current prompt. If yes → this is closed (it was an omp-compliance artifact). If no → harden the `/sp:dev-run --mode implement` prompt to explicitly instruct: "author `## Solution` via `spur task update <wbs> --section Solution --from-file <path>` — a file:line change-map," and re-verify.
- Files: `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `plugins/sp/commands/dev-run.md` (implement mode), `plugins/sp/commands/dev-implement.md` if still present.

#### P3 — re-measure pipeline cache hit rate

0127's dogfood logged ~47% cache hit rate, but that was conflated with the omp timeout-wall (every stage ran to the 600s cap). Now that the executor problem is fixed, re-measure under a healthy agent before doing any context-efficiency tuning.

- Run a small-task pipeline (agent=claude, `--async` + `spur workflow trace`); capture per-stage cache% from the trace.
- If cache% lands healthy under a usable agent → close as an omp artifact (the original measurement was contaminated). Only if it stays < 50% under claude, pursue tuning (compact context bootstrap, condensed task-file snapshot, trimmed skill context) — and if non-trivial, spin a further task.


- Parent task: `docs/tasks/0127_sp-dev-run-0102-dogfood-fix-sync-orphan-solution-section-cac.md`
- Dogfood report: `docs/dogfood/2026-06-26-sp-dev-run-0102-dogfood.md`
- Execution-workflow reference (Solution ownership): `plugins/sp/skills/spur-dev/references/execution-workflow.md:49-58`
- agent-run action: `packages/app/src/workflow/actions/agent-run.ts`
### Acceptance Criteria
Checklist-tier AC (verification + conditional hardening, not new behavior — mirrors parent feature **B1**'s two-tier convention, design §3.1). Investigation outcome (see `### Solution`): P3 is **not measurable** with current tooling; P2's prompt is **already MUST-hardened** with no remaining prose gap.

**P2 — implement-agent authors `## Solution`**

- [x] Audited the implement-stage prompt across `plugins/sp/commands/dev-run.md` (§ Section ownership, L54-67), `plugins/sp/skills/spur-dev/references/execution-workflow.md` (L49-58), and `dev-operations.md §4`: the instruction is already imperative (`MUST`), names the exact `spur task update <wbs> --section Solution --from-file` verb, the `file:line` change-map shape, and the write-only-when-bare rule. **No prose gap remains to harden.**
- [x] Confirmed the original non-authoring was an **omp-executor artifact** (0128 Background: "Partly mitigated now — claude is a saner default than the unusable omp"). The `record`-step `git diff --name-only` safety-net backfill remains intact as the fallback.
- [ ] **Behavioral confirmation deferred to the next natural pipeline run** under `agent=claude` — observe whether the implement stage authors `## Solution` unaided. If it does → P2 closed. If it does not → re-open with the concrete failing run as evidence (a throwaway probe-run that implements an unrelated task purely to test this was judged a disproportionate side effect).

**P3 — re-measure pipeline cache hit rate**

- [x] **Closed as not-measurable.** Investigation found **no cache instrumentation** anywhere in the agent-run path (`packages/app/src/services/agent-service.ts`, `packages/app/src/workflow/actions/agent-run.ts`) or domain persistence, and `spur workflow trace` exposes no cache field. The original ~47% was a **tagged `[~estimate]`** in `docs/dogfood/2026-06-26-sp-dev-run-0102-dogfood.md` (L14/42/57/79) — heuristic token eyeballing, not a measured trace value. There is no regression signal to re-measure against.
- [x] Recorded the prerequisite: a genuine re-measurement would first require **adding token/cache capture** to the agent-run path and surfacing it in `spur workflow trace` — a real feature warranting its own task if context-efficiency tuning is ever pursued. Not spun now (operator chose close-as-not-measurable, not spin-instrumentation-task).
### Design
**Outcome: investigation closed both items without a code change.** This task was an investigation-first measure-then-decide pair. The investigation (recorded in `### Solution`) found that neither item warrants the code/doc change originally hypothesized:

**P2 — already hardened, behavioral confirmation deferred.** The implement-stage prompt is already imperative and complete across all three docs that carry the contract:

| File | State |
|------|-------|
| `plugins/sp/commands/dev-run.md` (L54-67) | `MUST` author `## Solution` + exact `spur task update … --section Solution --from-file` verb + `file:line` change-map shape + write-only-when-bare |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md` (L49-58) | Ownership + `replaceSection` upsert semantics + `record`-step safety net |
| `dev-operations.md §4` | Aligned one-line mention |

There is **no prose gap to harden**. The only remaining uncertainty is empirical — does claude honor the already-strong prompt unaided? — and the original non-authoring was diagnosed (in 0128's own Background) as an **omp-executor artifact**, not a prompt defect. Confirming it requires a real pipeline run that implements an actual task as a side effect; a throwaway probe-run against an unrelated task (0103/0104) was judged a disproportionate side effect. So the behavioral confirmation is **deferred to the next natural pipeline run** rather than forced now.

**P3 — not measurable, no instrumentation exists.** `spur workflow trace` returns step/run status only. There is **zero** token/cache capture in `agent-service.ts`, `agent-run.ts`, or domain persistence. The ~47% baseline was a **tagged `[~estimate]`** in the dogfood report — a heuristic, never a measured value. "Re-measuring" is impossible without first building cache instrumentation into the agent-run path and surfacing it in the trace (a real feature, its own task). Operator chose to **close P3 as not-measurable** rather than spin that instrumentation task.

**Net change set:** docs-only — rewrite this task's own AC / Design / Plan / Solution to record the investigation findings and dispositions. **No** changes to `dev-run.md`, `execution-workflow.md`, `dev-operations.md`, or any code: the prompt was already hardened and P3 has nothing to measure.

**Invariant preserved:** the `record`-step `git diff --name-only` Solution backfill remains untouched as the safety net.

**Out of scope:** building cache instrumentation (deferred, un-spun per operator); a probe-run that implements an unrelated task purely to test P2; any prompt-prose change (none warranted).
### Plan
- [x] **P2 — audit the implement-stage prompt** across `dev-run.md`, `execution-workflow.md`, `dev-operations.md §4`. Finding: already `MUST`-hardened with exact CLI verb + `file:line` shape — no prose gap.
- [x] **P2 — classify the original non-authoring** as an omp-executor artifact (per Background), not a prompt defect. Safety-net backfill confirmed intact.
- [x] **P2 — defer behavioral confirmation** to the next natural `agent=claude` pipeline run (no throwaway probe-run forced).
- [x] **P3 — search for cache/token instrumentation** in `agent-service.ts`, `agent-run.ts`, domain persistence, and `spur workflow trace`. Finding: none exists.
- [x] **P3 — trace the 47% baseline** to `docs/dogfood/2026-06-26-sp-dev-run-0102-dogfood.md` (L14/42/57/79): a tagged `[~estimate]`, not a measured value. Close P3 as not-measurable.
- [x] **Record findings + dispositions** in this task's `### Solution`; rewrite AC/Design/Plan to reflect the closed items.
- [x] **Gate** — docs-only change to this task file; `git status` shows only `docs/tasks/0128_*.md`. No code or sp-skill/command files touched, so the `bun run lint`/`test` surface is unchanged.
### Solution
Investigation-only task; **no code or sp-doc change** — both sub-items closed by audit. The only file touched is this task file itself (AC/Design/Plan/Solution rewritten to record findings).

| File | Change | What / why |
|------|--------|------------|
| `docs/tasks/0128_*.md` | sections rewritten | Record investigation outcome: P2 already hardened (defer behavioral confirmation), P3 not-measurable (close) |
| _(none)_ | — | No change to `dev-run.md` / `execution-workflow.md` / `dev-operations.md` — prompt already `MUST`-hardened, no prose gap |
| _(none)_ | — | No code change — P3 has no instrumentation to re-measure against |

**P2 finding — prompt already hardened.** `plugins/sp/commands/dev-run.md:54-67` already instructs the implement agent to author `## Solution` with `MUST` + the exact `spur task update <wbs> --section Solution --from-file` verb + a `file:line` change-map shape + write-only-when-bare. `plugins/sp/skills/spur-dev/references/execution-workflow.md:49-58` and `dev-operations.md §4` carry the matching contract. The original non-authoring (0102 dogfood) was an **omp-executor artifact** — 0128 Background: "Partly mitigated now — claude is a saner default than the unusable omp." Behavioral confirmation under claude is deferred to the next natural pipeline run rather than forced via a throwaway probe that would implement an unrelated task (0103/0104) as a side effect. The `record`-step `git diff --name-only` backfill remains the safety net.

**P3 finding — not measurable.** No token/cache capture exists in `packages/app/src/services/agent-service.ts`, `packages/app/src/workflow/actions/agent-run.ts`, or domain persistence; `spur workflow trace` returns step/run status only. The ~47% baseline was a tagged `[~estimate]` in `docs/dogfood/2026-06-26-sp-dev-run-0102-dogfood.md` (L14/42/57/79) — heuristic token eyeballing, never a measured trace value. A genuine re-measurement would first require building cache instrumentation into the agent-run path + surfacing it in the trace (a separate feature). Operator chose **close-as-not-measurable**; instrumentation task **not** spun.

**Disposition:** P3 closed (not-measurable); P2 prompt confirmed already-hardened, behavioral confirmation deferred to next natural run. Task ready to move to `done` as an investigation with recorded findings — no regression risk (zero code/prompt change).
### Testing

### Review

### References

### History
- 2026-06-26T06:25:48.561Z todo → wip (system)
- 2026-06-26T06:26:30.340Z wip → testing (system)
- 2026-06-26T06:26:30.686Z testing → done (system)
