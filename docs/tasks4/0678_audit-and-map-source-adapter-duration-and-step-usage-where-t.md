---
schema_version: 1
name: "Audit and map source-adapter duration and step usage where the raw record carries them"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:44.976Z
updated_at: "2026-08-26T05:50:38.287Z"
feature_id: I81
priority: P2
tags: ["history", "importer", "telemetry", "ts-libs", "cross-repo"]
dependencies: ["0677"]
---

## 0678. Audit and map source-adapter duration and step usage where the raw record carries them

### Background

Cross-source performance and cost comparison is not population-representative because the source adapters map telemetry unevenly, and both history-anatomy reports flagged it as a coverage finding.

Measured on the current corpus: duration is recorded for 127,634 of 458,360 assistant steps — OMP is 100,664 of 101,046 and OpenCode is 10,908 of 10,911, Grok is 15,720 of 95,363, Pi is 342 of 100,744, and AGY, Claude, Codex and Gemini record none at all. Step-level provider usage is recorded for 251,335 of 458,360 assistant steps, with AGY at 0 of 58,716 and Codex at 0 of 53,406, while Codex nonetheless reports 11.36 billion input tokens at source-total granularity — so the data exists somewhere the step-level adapter is not reading it.

The consequence is that any cross-source ranking silently favors instrumented sources, which is why both reports had to declare relative performance "not available".

### Requirements
- [ ] R1. Audit each source adapter against its raw record shape and record, per source and per field (duration, input/output tokens, cache read/write, cost), whether the raw record carries the signal.
- [ ] R2. Map every field the audit proves is present and currently unmapped, so `stepsWithDuration` and `stepsWithUsage` rise for those sources.
- [ ] R3. Investigate the Codex asymmetry specifically: source-total tokens exist while step-level usage is zero — determine whether the aggregate is derived from a record the step-level path skips.
- [ ] R4. Document each source that genuinely exposes nothing as unsupported for that field, so its absence is a recorded fact rather than an open question.
- [ ] R5. Fabricate nothing. Where a source emits no timing, the honest outcome remains absent — do not synthesize duration from adjacent timestamps unless the audit shows that is the source's own semantics, and say so explicitly if it is.
- [ ] R6. Record the before/after `stepSupport` matrix over the same corpus as evidence.
### Acceptance Criteria

```gherkin
@core
Scenario: R11 — Duration and step usage are mapped wherever the raw record carries them
  Given an audit of each source adapter against its raw record shape
  When a source's raw records expose per-step duration or provider usage
  Then the adapter maps that field into the imported row
  And a source whose raw records expose neither is documented as unsupported rather than left silently empty
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Audit before mapping — a hard gate, not a formality.** The reports establish *that* coverage is uneven, not *why* per source. Writing adapter code before knowing which fields exist in each raw shape risks either fabricating values or missing them. R1 gates R2. The audit output is a per-source, per-field table that goes into the Solution section and stays as the standing answer to "why is source X still absent?".

**Where the change lands.** `~/xprojects/ts-libs/packages/llm-jsonl-importer` — the source definitions in `src/sources.ts` and the record mappers in `src/mappers.ts`. Published, then `bun update` in the dependent Spur workspaces. Land 0675 first if both are in flight, so re-import wall-clock measurements are not confounded.

**Codex is the highest-value single lead.** 11,360,397,215 input tokens at source-total granularity against **0 of 53,406** step-level usage rows is not an absent signal — it is a signal reaching a different code path. Whatever produces the source total is reading usage the step-level mapper skips. That one investigation probably explains AGY (0 of 58,716) too and is the change most likely to move the coverage number materially. Start there.

**Measured baseline to move.** Duration: OMP 100,664/101,046 and OpenCode 10,908/10,911 near-complete; Grok 15,720/95,363; Pi 342/100,744; AGY, Claude, Codex, Gemini zero. Usage: Claude, OMP, OpenCode, Pi substantially or fully covered; Gemini 1,383/1,389; Grok 466/95,363; AGY and Codex zero. Record the same matrix after the change.

**Derived duration is a semantics question, not a convenience.** For a source that records only timestamps, the interval between consecutive assistant records is a *plausible* duration, not a *measured* one. R5 forces that distinction to be argued explicitly, because 0677 has just spent its effort making absence honest and this task must not undo it. If a source's own format documents that interval as its step duration, mapping it is correct and the Solution says so; otherwise the field stays absent.

**Anti-patterns.** Do not synthesize duration to make a coverage number rise. Do not map a field the audit did not find in the raw shape. Do not change the analyze or render layers — 0677 owns absent-not-zero there; this task only changes what the importer writes.

**Depends on 0677** so the audit measures against a truthful baseline.

**Reversibility.** Per-source mappings revert independently.
### Plan

1. For each of the nine sources, sample raw records and record which of duration, input/output tokens, cache read/write, and cost are present in the raw shape.
2. Produce the per-source, per-field audit table; identify the mappable set.
3. Investigate the Codex source-total-vs-step-level asymmetry and record the cause.
4. Map the fields the audit proves present; leave the rest unmapped and documented.
5. Unit tests per newly-mapped source: a raw record carrying the field produces a populated row; one without it produces null.
6. Publish the importer, `bun update` the dependent Spur workspaces.
7. Re-import a bounded slice and record the before/after `stepSupport` matrix.
8. Run `bun run lint`, `bun run test`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
