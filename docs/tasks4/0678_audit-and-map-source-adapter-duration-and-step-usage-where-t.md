---
schema_version: 1
name: "Audit and map source-adapter duration and step usage where the raw record carries them"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:44.976Z
updated_at: "2026-08-26T05:39:29.133Z"
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

**Audit before mapping.** The reports establish *that* coverage is uneven, not *why* per source. Writing adapter code before knowing which fields exist in each raw shape risks either fabricating values or missing ones — R1 is therefore a hard prerequisite gate on R2, not a formality. The audit output is a per-source, per-field table that goes into the task's Solution section and stays as the answer to "why is source X still absent?".

**Codex is the highest-value single lead.** 11.36 billion input tokens at source-total granularity against zero step-level usage rows is not an absent signal — it is a signal reaching a different code path. That asymmetry probably explains AGY too, and it is the one investigation most likely to move the coverage number materially.

**Derived duration is a semantics question, not a convenience.** For a source that records only timestamps, the interval between consecutive assistant records is a *plausible* duration but not a *measured* one. R5 forces that distinction to be argued explicitly rather than assumed, because the previous task just spent its effort making absence honest and this task must not undo it.

**Where the change lands.** `@gobing-ai/ts-llm-jsonl-importer` adapters in `~/xprojects/ts-libs`, with a publish plus `bun update` round-trip. Depends on the absent-not-zero task landing first, so the audit measures against a truthful baseline.

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
