---
schema_version: 1
id: "I81"
name: "History-anatomy remediation: bounded daily windows, incremental import short-circuit, honest telemetry, and an actionable report contract"
status: backlog
priority: P2
tags: []
created_at: "2026-08-26T05:33:47.266Z"
updated_at: "2026-08-26T05:34:50.220Z"
---

# I81: History-anatomy remediation: bounded daily windows, incremental import short-circuit, honest telemetry, and an actionable report contract

## Goal
Restore `/sp:dev-find-issue` to the capability it was designed for and make its whole dependency
chain honest and fast.

The daily history-anatomy report currently resolves its calendar-day window into a selector sidecar
but never threads it into `spur history analyze`, so every run analyzes the entire 1.82 M-message
corpus twice. That single defect is simultaneously the correctness failure (`not-comparable`
recurrence for every key, empty provenance bounds, a baseline byte-identical to current) and the
performance failure (the two `agent.run` stages are each fed a 3.9 MB artifact instead of a 58 KB
one — 67× — which is what makes a run take 11–18 minutes). Alongside it, a no-op `spur history
import` still costs ~28 s because the importer opens and streams all 5,938 source files on every
run; `analyze` renders absent telemetry as `0` rather than `null`, producing 44.2 Bn ms of
"unattributed" time and pairing rows that read as 0 % success; and the published report, unlike the
dogfood report it should learn from, carries no severity, no repro command, no owner surface, and no
route from a remediation proposal into the task corpus.

Done means: a daily run analyzes exactly its local calendar day and a distinct preceding day,
recurrence classification works, a no-op import is near-instant, absent telemetry renders as
`not available` rather than zero, and each published finding names its severity, its repro command,
and the surface that owns the fix.
## Scope
- In:
  - `config/workflows/history-anatomy.yaml` — thread the resolved window into the `analyze` stage and
    give the baseline leg its own declared, ordered bounds; declare every var it references.
  - `plugins/sp/scripts/history-anatomy-cache.*` — provenance stamping of the audited window;
    post-stage assertion that a model stage wrote nothing outside its declared output path.
  - `plugins/sp/commands/dev-find-issue.md` — `--agent` flag contract on a headless surface.
  - `@gobing-ai/ts-llm-jsonl-importer` (`~/xprojects/ts-libs`) — file-level incremental
    short-circuit and batched checkpoint reads; source-adapter duration and step-usage mapping where
    the raw record carries the signal.
  - `history_import_checkpoint` schema — additive columns for the short-circuit, with a Spur
    migration at `max(prefix)+1`.
  - `packages/domain/src/analytics` — phase-interval ordering invariant; absent-vs-zero discipline in
    the analyze artifact and the forensics renderer.
  - Pairing telemetry (J8 surface) — explicit success/failure/unknown outcome, model, cost, duration.
  - `plugins/sp/skills/history-anatomy/references/report-contract.md` and its deterministic structure
    gate — severity, repro line, owner surface, remediation→task handoff, repeat-call advisory.

- Out:
  - New SQL indexes. E9 already landed `drizzle/0020` and `0022`; `idx_history_message_ts` exists and
    a bounded 22 k-record window analyzes in 2.0 s. The win here is bounding the window, not indexing.
  - Any change to a public `spur` CLI noun or verb (ADR-051 consent gate) — this feature changes
    flag semantics and output shape only.
  - Automatic loop interruption. The repeat-call signal ships as a report-only advisory; an automatic
    breaker needs comparable windowed evidence this feature does not yet produce.
  - Caching the deterministic analyze half. ADR-079 makes cache validity a derived fact; the fresh
    artifact must keep coming from a fresh analyze.
  - Fabricating telemetry for sources whose raw records carry no timing or usage. Where a source
    genuinely does not emit it, the honest outcome stays `not available`.
  - Retro-repairing already-published reports in `docs/report/`.
## Acceptance Criteria
```gherkin
Feature: History-anatomy remediation: bounded daily windows, incremental import short-circuit, honest telemetry, and an actionable report contract

  @core
  Scenario: R1 — Daily mode analyzes exactly its resolved local calendar day
    Given the history-anatomy workflow runs in daily mode for the local calendar day 2026-08-24
    And resolve-scope has written DST-aware inclusive bounds to the run-scoped selector sidecar
    When the analyze stage invokes "spur history analyze" for the current leg
    Then the produced current artifact carries a non-null "selector.since" and "selector.until" equal to those resolved bounds
    And no workflow var referenced by the analyze stage is undeclared in the workflow "vars" block

  @core
  Scenario: R2 — The baseline leg analyzes the immediately preceding local calendar day
    Given a daily run whose current leg is bounded to the local calendar day 2026-08-24
    When the analyze stage invokes "spur history analyze" for the baseline leg
    Then the baseline artifact's bounds are the immediately preceding local calendar day
    And the baseline artifact digest differs from the current artifact digest

  @core
  Scenario: R3 — Recurrence classification produces real verdicts once both windows are bounded
    Given a current artifact and a distinct preceding-day baseline artifact for the same daily run
    When the enrich stage builds the recurrence ledger
    Then no stable key is classified "not-comparable" for the reason that window bounds are unavailable
    And each stable key carries one of "new", "recurring", "regressed", "improved", or "resolved"

  @core
  Scenario: R4 — The published report makes its audited window auditable
    Given a daily run that completed through the stamp stage
    When the report is published
    Then the frontmatter "identity.bounds.since" and "identity.bounds.until" hold the audited window rather than empty strings
    And "identity.timezone" names the timezone those bounds were resolved in

  @core
  Scenario: R5 — A bounded daily run costs materially less than an unbounded one
    Given the current corpus of roughly 1.8 million history messages
    When a daily run analyzes one local calendar day instead of the whole corpus
    Then the artifact handed to the enrich and validate stages is at least an order of magnitude smaller than the unbounded artifact
    And the deterministic analyze half completes in under five seconds per leg

  @core
  Scenario: R6 — A no-op incremental import skips unchanged files without reading them
    Given every discovered source file was fully imported by a previous run and none has changed since
    When "spur history import" runs in incremental mode
    Then no unchanged file is read from disk
    And the run reports zero new messages and zero new tool calls
    And the run completes in under a fifth of the wall-clock time of the equivalent full-read run

  @core
  Scenario: R7 — A source file that changed since its checkpoint is still imported
    Given a source file whose recorded size or modification time differs from its checkpoint entry
    When "spur history import" runs in incremental mode
    Then that file is read from its checkpoint line onward
    And every record after the checkpoint line is imported exactly once

  @core
  Scenario: R8 — Checkpoint lookups do not cost one query per file
    Given a source with several thousand discovered files
    When the importer resolves checkpoints for that source
    Then checkpoint state is fetched in a bounded number of queries independent of the file count

  @core
  Scenario: R9 — A derived phase whose end precedes its start is rejected or explicitly marked
    Given a derivation input that would produce a phase with "endedAt" earlier than "startedAt"
    When the analyze stage derives phases
    Then that phase does not enter elapsed-duration analysis as a positive interval
    And the artifact records it as invalid rather than silently emitting a negative duration

  @core
  Scenario: R10 — Unmeasured telemetry is null, never zero
    Given a source whose assistant steps carry no measured duration and no provider usage
    When the analyze artifact and the forensics renderer present that source
    Then its duration and usage values are absent rather than zero
    And the rendered output shows "not available" for them

  @core
  Scenario: R11 — Duration and step usage are mapped wherever the raw record carries them
    Given an audit of each source adapter against its raw record shape
    When a source's raw records expose per-step duration or provider usage
    Then the adapter maps that field into the imported row
    And a source whose raw records expose neither is documented as unsupported rather than left silently empty

  @core
  Scenario: R12 — A pairing dispatch records an explicit outcome
    Given an executor-role dispatch completes, fails, or ends in an unknown state
    When the pairing telemetry is written
    Then the row carries an explicit "success", "failure", or "unknown" outcome
    And a model, cost, or duration that was not measured is stored as absent rather than zero

  @core
  Scenario: R13 — Each published finding names its severity, repro command, and owner surface
    Given an enriched report candidate containing at least one finding
    When the deterministic structure gate checks the candidate
    Then the gate fails any finding missing a severity, a repro command, or an owner surface
    And a candidate whose findings carry all three passes

  @core
  Scenario: R14 — An accepted remediation proposal can be handed to the task corpus
    Given a published report with a remediation proposal the operator accepts
    When the operator takes the report's handoff route
    Then the report supplies the "spur task" invocation that lands that proposal as a task
    And the created task references the finding's stable key

  @core
  Scenario: R15 — A headless surface never advertises an execution mode it rejects
    Given "/sp:dev-find-issue" targets the engine-driven history-anatomy workflow
    When an operator reads the command's "--agent" flag contract
    Then the contract does not present "inline" as the default for that surface
    And invoking the documented default does not produce the headless-rejection error

  @core
  Scenario: R16 — A model stage that writes outside its declared output path fails the run
    Given the enrich stage declares one expected output file
    When the stage also writes a file elsewhere in the working tree
    Then the workflow reports the undeclared write and does not publish
    And the report names the offending path

  @edge
  Scenario: R17 — The workflow's default executor is not a quota-dead one
    Given an operator runs the history-anatomy workflow without naming an executor
    When the first "agent.run" stage dispatches
    Then the resolved executor is one the project currently expects to be reachable
    And a quota or availability failure names the executor and the sanctioned alternatives

  @edge
  Scenario: R18 — The report carries a report-only repeated-call advisory
    Given the analyze artifact reports repeated identical tool-and-argument signatures
    When the report is enriched
    Then it surfaces the repeated signatures as an advisory
    And it proposes no automatic interruption of the repeated call

  @edge
  Scenario: R19 — A file rewritten in place within one modification-time tick is not skipped
    Given a source file whose content changed but whose modification time is unchanged
    When "spur history import" runs in incremental mode
    Then the short-circuit does not skip that file on the basis of modification time alone

  @edge
  Scenario: R20 — Ad-hoc mode keeps its operator-supplied bounds unchanged
    Given an ad-hoc run supplying its own ordered inclusive bounds and a focus
    When the analyze stage runs
    Then the current artifact's selector equals the operator-supplied bounds
    And no daily calendar-day normalization is applied to them
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0674 | Thread the resolved history-anatomy window into analyze and give the baseline leg its own bounds | todo |
| 0675 | Short-circuit unchanged files in the incremental JSONL importer and batch its checkpoint reads | todo |
| 0676 | Make the find-issue surface honest about --agent and fail the run on undeclared model-stage writes | todo |
| 0677 | Enforce analyze invariants: ordered phase intervals and absent-not-zero telemetry | todo |
| 0678 | Audit and map source-adapter duration and step usage where the raw record carries them | todo |
| 0679 | Record explicit pairing outcomes so executor-role routing is evidence-based | todo |
| 0680 | Upgrade the history-anatomy report contract with severity, repro, owner surface, and a task handoff | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
