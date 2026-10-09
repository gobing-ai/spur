---
schema_version: 1
name: Bound the history import scope for single-session evidence
status: todo
template: standard
created_at: 2026-10-09T16:51:45.834Z
updated_at: "2026-10-09T16:52:24.024Z"
feature_id: E2

ac_numbering: task-local
ac_altitude: task-local
---

## 1144. Bound the history import scope for single-session evidence

### Background

Measured in the 2026-10-08 session during task 1131's AC4 evidence collection. The requirement needed
one session's tool durations visible in the analyze artifact. The first attempt ran

`history import --source pi --mode force-file`

over the corpus: 4385 files scanned, about 1.19M messages. It aborted after **10m03s** with
`source 'pi' exceeded its 600000ms budget (elapsed 601832ms); remaining sources not started`, having
produced no evidence for the requirement. The budget check fires only after the time is spent, so the
command cannot warn a caller that the scope is disproportionate to the need.

The second attempt imported the single session with `--file <that session's transcript>` and took
**31.5 seconds** (1104 messages, 296 tool calls), which produced the AC4 evidence. The proportionate
form was available the whole time; the whole-corpus form was chosen because the requirement's wording
says "force re-imported" and the import surface reports its scope only after starting.

### Requirements

- [ ] R1. The import surface reports the scope it is about to process before it starts: at minimum the file count, and a message-volume estimate when cheaply obtainable. A caller deciding between a targeted import and a full replay sees the size first.
- [ ] R2. When an import aborts on its per-source budget, the failure output names the budget, the elapsed time, and the scoped form (`--file <path>`, or a narrower `--root`) that would satisfy a single-session need. The abort stays a failure; it gains a remedy.
- [ ] R3. The same remedy is documented where a driver looks for it: the history import help text and the history design satellite, so a one-session evidence need leads with `--file` rather than a corpus-wide force re-import.
- [ ] R4. Existing behavior is unchanged for a deliberate full replay: checkpoint resume, per-source isolation, the budget itself, and the fan-out contract.
- [ ] R5. This task's Testing records the measured comparison — the aborted whole-corpus run's elapsed time against the targeted run's — so the improvement is evidenced rather than asserted.

### Acceptance Criteria

```gherkin
Scenario: AC1 — scope is reported before work starts (req: R1)
  Given a history import with --source pi and --mode force-file
  When the import begins
  Then it reports the number of files it will process before scanning them
  And a caller can see the scope before the run commits time

Scenario: AC2 — a budget abort names a proportionate remedy (req: R2)
  Given an import that exceeds its per-source budget
  When it aborts
  Then the output names the budget, the elapsed time, and the --file form for a single-session need
  And the exit status remains non-zero

Scenario: AC3 — the targeted form is documented where it is needed (req: R3)
  Given the history import help text and the history design satellite
  Then a single-session evidence need is answered with --file <path>
  And the corpus-wide force re-import is described as a deliberate full replay

Scenario: AC4 — full replay behavior is unchanged (req: R4)
  Given a corpus-wide import with checkpoint state from a prior run
  When it runs again
  Then it resumes from the checkpoint as before
  And per-source isolation and the budget still apply

Scenario: AC5 — the improvement is measured (req: R5)
  Given this task's Testing section
  Then it records the aborted run's elapsed time and the targeted run's elapsed time for the same evidence need
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:52:01.208Z

- **Why is this not just a documentation fix?** Because documentation alone would not have prevented
  the loss: the requirement said "force re-imported" and the import reported nothing about scope until
  it had already spent ten minutes. The pre-scan and the abort remedy are the parts that change
  behavior; the doc wording follows.
- **Why not reduce the 600s budget?** The budget is a per-source timeout, not a scope limit, and the
  fan-out contract depends on it. Lowering it would abort legitimate replays.
- **Is `--file` equivalent evidence?** Yes for this class: the AC4 evidence needed one session's tool
  durations, and the targeted import produced 296 tool calls for that session. A requirement that
  needs cross-session state still calls for the corpus form.
- **Deferred:** incremental-import planning, checkpoint granularity, and any change to the analyzer.

### Design

**Two surfaces, one intent.** (1) A pre-scan line in the import command's human and `--json` output
that states file count (and an estimate when the scan has already walked the tree, which the fan-out
does anyway). (2) An abort message that carries the remedy, plus help-text and satellite wording that
leads with `--file` for a single-session need.

**Why a pre-scan rather than a size limit.** The corpus-wide form is legitimate for a deliberate
replay; refusing it on size would break a supported operation. The defect is that a caller cannot see
the scope before spending time on it. Reporting the scope preserves both paths and lets the caller
choose.

**Estimate cost.** The file count is a directory walk the importer already performs; the message
estimate, when unavailable cheaply, is omitted rather than computed by parsing every file — a
pre-scan must not itself become the expensive operation.

**Abort message shape.** The existing abort already names the source and the elapsed budget. The
change appends the scoped alternative; it does not soften the failure, and the exit status stays
non-zero, so a scripted caller still sees a failure.

**Impacted surfaces.** The history import command's output and help text, the history data-processing
design satellite. No schema, artifact or query change; analyze is untouched.

### Plan

1. Read the importer's fan-out entry to find where the file list is known and where the budget abort
   is raised.
2. Add the pre-scan scope line to both the human and `--json` output paths, reusing the existing walk
   so nothing is scanned twice.
3. Extend the budget abort message with the scoped remedy, keeping the non-zero exit.
4. Update the import help text and the history data-processing satellite to lead with `--file` for a
   single-session need.
5. Verify with a fixture-sized run: scope reported before scanning, abort path message on a forced
   budget, and an unchanged checkpoint-resume run. Record the measured comparison from this task's
   Background in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-09T16:52:24.024Z backlog → todo (system)

