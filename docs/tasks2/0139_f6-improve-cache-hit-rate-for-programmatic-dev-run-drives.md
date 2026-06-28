---
template: meta
schema_version: 1
name: "F6 — improve cache-hit rate for programmatic dev-run drives"
description: ""
status: todo
type: meta
profile: standard
feature_id: null
parent_wbs: "0130"
priority: P3
tags: ["meta"]
dependencies: []
created_at: "2026-06-27T07:03:28.263Z"
updated_at: 2026-06-27T16:12:21.297Z
---

## 0139. F6 — improve cache-hit rate for programmatic dev-run drives

### Background
Child of 0130 (dogfood findings). Covers F6 (P3) — **reframed from "improve cache-hit" to a
measurement-first diagnostic + targeted-lever task** (per operator, option b).

**Original concern.** The `/sp:dev-run 0129 --auto --next` dogfood run reported ~46% aggregate
cache-hit rate, with steps 3–7 under 40%. The dogfood ledger's own accounting
(`cacheTokens / (inputTokens + cacheTokens)`, computed in
`plugins/sp/skills/daily-summary/scripts/daily-summary.ts`) produced the figure, and the report
flagged it `[~estimate]` from a single run.

**Identified root causes (from the dogfood report, `docs/dogfood/2026-06-26-…-dogfood.md:51`).**
The low hit rate came from two concrete behaviors, not a black box:
1. The drive **re-sent prompt scaffolding** across closely-spaced dev-run steps (the same
   command/skill preamble re-grounded each step instead of being reused from cache).
2. The drive **re-read small CLI outputs** (e.g. `spur task show`, `spur task check`) that a prior
   step had already established in context.

**Why this was reframed (not "just optimize").** F6 is exploratory perf work built on a single-run
`[~estimate]`. Optimizing without a reproducible measurement loop would mean guessing and claiming
improvement that can't be verified (R8/R12). So the task is split into two honest halves: **(A) make
the measurement reproducible**, then **(B) attack the two known causes and re-measure.** Half A must
land before Half B can claim anything.

Parent: docs/tasks2/0130_sp-dev-run-0129-auto-next-dogfood-findings.md.
Files in scope: the dogfood ledger / daily-summary cache-accounting
(plugins/sp/skills/daily-summary/scripts/daily-summary.ts), the dev-run step sequencing
(plugins/sp/skills/spur-dev/references/execution-workflow.md), and any shared prompt scaffolding
across dev-run steps.
### Requirements

- [ ] R1. **(Half A — reproducible measurement)** A single deterministic command (or documented
      procedure) reproduces the programmatic `dev-run` cache-hit measurement: it drives a fixed
      `dev-run` invocation the same way the dogfood run did, captures per-step and aggregate
      `cacheTokens / (inputTokens + cacheTokens)`, and prints both. The figure is no longer a
      hand-waved `[~estimate]` from one run — re-running yields the same number (±noise) on the
      same inputs.
- [ ] R2. **(Half A)** The measurement reports **per-step** hit rate (so "steps 3–7 under 40%" is
      verifiable, not asserted), not just aggregate.
- [ ] R3. **(Half B — targeted levers, gated on Half A)** Eliminate re-sent prompt scaffolding
      across closely-spaced dev-run steps: where the same command/skill preamble is re-grounded
      each step, restructure so it is reused from cache (or factored out of the per-step prompt).
      Verified by re-running the Half-A measurement: the affected steps' hit rate rises.
- [ ] R4. **(Half B)** Eliminate re-reads of small CLI outputs a prior step already established:
      where steps 3–7 re-read `spur task show`/`check` output already in context, reference the
      prior result instead of re-invoking. Verified by re-running the Half-A measurement.
- [ ] R5. **(Acceptance)** After Half B, the Half-A measurement reports a higher aggregate cache-hit
      rate than the ~46% baseline, with the per-step data showing the improvement concentrated in
      the previously-under-40% steps. Directional target ≥ 60% aggregate — but the **measured
      before/after delta** is the acceptance signal, not hitting an absolute number.

### Plan
**Half A — reproducible measurement (must land first).**

- [ ] Audit the dogfood ledger / daily-summary cache accounting
      (`plugins/sp/skills/daily-summary/scripts/daily-summary.ts`) — confirm it captures per-step
      `cacheTokens`/`inputTokens`, not just aggregate. If only aggregate, extend it to per-step.
- [ ] Define the fixed programmatic `dev-run` drive (the exact invocation + task the measurement
      re-runs) so re-runs are comparable. Document it in this task's `### References` or a
      `docs/dogfood/` note.
- [ ] Produce the baseline measurement: per-step + aggregate cache-hit for the fixed drive. Record
      the numbers + the date in `### Testing` (this becomes the before-snapshot for Half B).

**Half B — targeted levers (gated on Half A; do not start until A's baseline is recorded).**

- [ ] Lever 1 (re-sent scaffolding): trace which dev-run steps re-ground the same command/skill
      preamble. Restructure so it's cache-reused or factored out. Re-measure.
- [ ] Lever 2 (re-read CLI outputs): find steps 3–7 that re-invoke `spur task show`/`check` for data
      a prior step already produced. Reference the prior result instead. Re-measure.
- [ ] Final: re-run the Half-A measurement; record the after-snapshot alongside the baseline in
      `### Testing`. The delta is the acceptance signal for R5.

**Sequencing rule.** Half B changes are unverifiable until Half A exists — do not attempt
optimization before the baseline is captured, or the task ships an un-verifiable "improvement."
### Testing

### References

### History
