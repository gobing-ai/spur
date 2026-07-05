---
template: meta
schema_version: 1
name: F6 — improve cache-hit rate for programmatic dev-run drives
description: ""
status: cancelled
type: task
profile: standard
parent_wbs: "0130"
priority: P3
tags: [meta]
dependencies: []
created_at: 2026-06-27T07:03:28.263Z
updated_at: 2026-06-27T16:30:48.345Z
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
**Half A — baseline + measurement honesty (done as part of scoping).**

- [x] Audited the cache-hit source: the ~46% / "steps 3–7 under 40%" figure is a **self-reported
      estimate** by the dogfooding agent, computed via the heuristic in
      `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:41-55`. The doc itself states
      "a skill cannot read its own exact token meter." `ccusage` (the only hard telemetry) reports
      **daily aggregate** only — no per-step data exists anywhere in Spur.
- [x] Conclusion: the achievable measurement is a **trend comparison of two estimates by the same
      heuristic** (before vs after the lever fix), re-running the same dogfood drive. Flagged as
      estimated, not measured. Building real per-step instrumentation is a separate observability
      task (split candidate), not this one.

**Half B — the concrete lever (the fixable surface).**

The `monitor-ledger.md` cache-health rule (lines 57-67) **detects** low cache% ("emit a P3
finding") but gives the driver **no mitigation guidance** — it never tells the dogfooding agent
how to *avoid* re-reading CLI outputs or re-sending scaffolding. That missing guidance IS the
lever the finding named. The fixable surface:

- [ ] Add a **cache-conservation** subsection to `monitor-ledger.md` (and a one-line pointer in
      `dogfood-testing/SKILL.md` Phase 2/3) telling the driver: (a) reuse CLI output already in
      context — don't re-invoke `spur task show`/`check`/`list` for data a prior step captured;
      reference the prior result; (b) don't re-ground shared scaffolding (command docs, skill
      preamble) per step when it's unchanged — the agent's own context already holds it; (c) prefer
      `--json` + targeted fields over re-printing full human output.
- [ ] In `dev-run.md` / `execution-workflow.md`, where steps are described, add a one-line
      "reuse in-context task state" note so a programmatic driver doesn't re-fetch what it just
      wrote.

**Half C — re-measure (estimated, flagged).**

- [ ] Re-run the same programmatic `dev-run` dogfood drive; have the driver populate the ledger
      with before/after estimated cache%. Record both in `### Testing` as `[~estimate]` trend data.
      The signal is the **delta and the per-step trend**, not an absolute number.
### Solution

| File | What / Why |
|------|------------|
| `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:68-94` | Added a "Cache-conservation discipline" subsection. The existing cache-health rule *detected* low cache% ("emit a P3 finding") but gave the dogfooding driver no mitigation guidance. The new section tells the driver concretely how to keep cache% high: (1) reuse CLI output already in context — don't re-invoke `spur task show/check/list` for data a prior step captured (the #1 cause of sub-40% steps); (2) don't re-ground shared scaffolding (command docs, skill preamble) per step; (3) prefer `--json` + targeted fields over full human dumps; (4) estimate `~cached` honestly. This is the lever the F6 finding named — previously missing. |
| `plugins/sp/skills/dogfood-testing/SKILL.md:90-97` | Phase 3 (Monitor) now points at the conservation discipline and frames low cache% as usually the driver re-fetching data it holds. Gets the guidance in front of the driver at the moment it matters. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:64-79` | Step 1 (Task selection) gained a "Reuse in-context task state" note: don't re-fetch `show`/`check` output already in context; when you must fetch, use the smallest `--json` shape. Keeps a programmatic dev-run drive's cache hit rate high; cross-links the dogfood discipline. |

**Why this is the right lever (and not a no-op).** The dogfood report's own monitor-ledger rule
(`monitor-ledger.md:61`) attributes sub-40% steps to "re-reading files or re-sending prompt
context." The skill *detected* that but never told the driver how to *avoid* it. The fix adds the
missing mitigation at exactly the surface (the dogfooding driver's behavior + the dev-run step
framing) where the waste originates. The Anthropic prompt cache cannot carry across the pipeline's
separate subprocesses by design — so the only controllable cache% is the *driver's* context
hygiene, which is what this guidance targets.

### Testing
**Measurement honesty (the core caveat — R12).**

The F6 baseline ("~46% aggregate, steps 3–7 under 40%") is a **self-reported estimate** by the
dogfooding agent, computed via the heuristic in `monitor-ledger.md:41-55`, which itself states "a
skill cannot read its own exact token meter." No hard per-step telemetry exists in Spur; `ccusage`
(the only hard source) reports **daily aggregate** only and is **not installed** in this
environment. So a before/after measurement requires **re-running the same programmatic `dev-run`
dogfood drive** and having the driver populate the ledger's estimated `~cached`/`cache%` columns
under both the old and new guidance. That is a multi-minute live run against a real task — not
done in this session.

**What IS verified.**

- The three guidance edits land at the correct surface: `monitor-ledger.md` (the SSOT for the
  cache rule) now has a mitigation section where it previously only had a detection rule; the
  dogfood SKILL Phase 3 and the dev-run Step 1 both point at it.
- Internal consistency: the new "Reuse in-context task state" note in `execution-workflow.md`
  cross-links the dogfood discipline; the SKILL Phase 3 pointer matches the monitor-ledger
  section title. No drift.
- No executable test surface — these are skill/reference doc files; the consuming agent reads the
  guidance. No code parses token counts (grep for token-meter reads returns nothing in `apps/`).

**Requirement traceability.**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (reproducible measurement command/procedure) | PARTIAL | The procedure is "re-run the same dogfood drive, populate the ledger" — reproducible in *method*, but the number is an estimate by heuristic, not a metered value. `ccusage` aggregate is unavailable here. Documented honestly. |
| R2 (per-step hit rate) | NOT DELIVERED | Requires building per-step token instrumentation (no such telemetry exists in Spur today). This is the split candidate — a separate observability task, not achievable within F6's doc-only scope. |
| R3 (eliminate re-sent scaffolding) | PASS (by guidance) | `monitor-ledger.md` discipline item 2 + dev-run Step 1 note directly address this. Behavioral verification (re-measure) deferred — needs the live drive. |
| R4 (eliminate re-reads of CLI outputs) | PASS (by guidance) | `monitor-ledger.md` discipline item 1 names this as the #1 cause and tells the driver to reuse in-context output. Behavioral verification deferred. |
| R5 (measured before/after delta as acceptance) | NOT DELIVERED | Cannot measure here: `ccusage` absent, live dogfood re-run out of session scope. The guidance is the deliverable; the measured delta is owed by a future run. |

**Honest bottom line.** This task shipped the **lever** (concrete cache-conservation guidance at the
surface where cache% is actually controlled — the driver's context hygiene) but **not the measured
proof** that it raises cache%. The proof requires a live dogfood re-run that this session cannot
perform. Claiming a cache% improvement without that run would be fabrication (R12).
### Review

| Priority | Status | Note |
|----------|--------|------|
| P1 | n/a | Doc/guidance change; no correctness/security concern |
| P2 | DONE | The cache-conservation lever — previously missing entirely — is now documented at the SSOT (monitor-ledger), the dogfood SKILL, and the dev-run step where state is read |
| P3 (back-issue) | OPEN | The measured before/after cache% delta is NOT delivered — `ccusage` is unavailable here and a live dogfood re-run is out of session scope. The lever ships; the proof is owed by a future run |

**Correctness of the approach.** The Anthropic prompt cache cannot cross the pipeline's separate
`agent.run` subprocesses by design — so cross-step caching is impossible regardless of changes.
The only cache% the driver can control is its **own** context hygiene, which is exactly what the
new guidance targets. This is the correct lever; chasing cross-subprocess caching would be tilting
at windmills.

**What would close the back-issue.** A future session re-runs the same programmatic `dev-run`
dogfood drive under the new guidance, populates the ledger's estimated cache% for each step, and
compares to the original ~46%/[steps 3–7 <40%] estimate. If per-step rigor is wanted, split a
new task (0141) to build real per-step token instrumentation into the pipeline — that is the only
path to a non-estimated cache%.

### References

### History
- 2026-06-27T16:20:13.616Z todo → wip (system)
- 2026-06-27T16:23:05.730Z wip → blocked (system)
- 2026-06-27T16:30:48.345Z blocked → cancelled (system)
