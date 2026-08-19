---
schema_version: 1
name: "dev-* spine cost + drift inventory: measure the bootstrap, attribute it, name the fix path"
status: done
template: brainstorm
created_at: 2026-08-18T22:01:29.506Z
updated_at: "2026-08-19T02:33:12.733Z"
feature_id: I6
done_forced: "true"
done_reason: "Doc-authoring mode (operator-selected): deliverable verified against plan checklist; design doc written; zero source files modified; Solution/Testing/Review complete."
---

## 0594. dev-* spine cost + drift inventory: measure the bootstrap, attribute it, name the fix path

### Background
`wayfinder:research` — ticket on map **[I6]** (Spur harness self-improvement program).

#### The sharp question
**Where does a `/sp:dev-*` invocation actually spend its bootstrap tokens and wall-clock, and how much
of that spend is drift — capability the `spur` CLI already provides that `plugins/sp` or the workflow
YAML re-implements in prose?**

#### Why this is one ticket, not two
Measuring the cost without attributing it to specific loads produces a number nobody can act on;
inventorying the drift without the cost data produces a list nobody can rank. Both read the same
files. One session, one ranked table.

#### Ground truth already established (do not re-derive)
- `plugins/sp/commands/dev-*.md` are thin: 32–128 lines, 1,622 total. Not the weight.
- `plugins/sp` total markdown: **25,088 lines**. `skills/spur-dev/references/`: 4,577
  (`execution-batch.md` 799, `cross-cutting.md` 709, `dev-operations.md` 549, `flag-glossary.md` 439,
  `planning-workflow.md` 355, `execution-workflow.md` 354).
- `skills/spur-cli/references/`: 4,229 across per-noun files.
- `config/workflows/`: 3,410 lines across 11 YAMLs; `task-pipeline.yaml` 733, `idea-pipeline.yaml` 732,
  `planning-pipeline.yaml` 249.

#### Prior art — this is a delta-audit, not a first pass
Two closed features already did this exact inventory. **Read them before re-deriving anything:**

- **I2 — spur-dev/spur-cli parity-first drift audit and harness refinement** (`done`). Goal: make
  `sp:spur-dev`, `sp:spur-cli`, and their plugin integration surfaces demonstrably consistent with the
  current CLI, preserving the ownership split (facade owns noun/verb/flag semantics, spine owns
  lifecycle, CLI remains the validator).
- **I3 — Harness surface reconciliation: `plugins/sp` and `config/workflows/*.yaml` against the live
  `spur` CLI** (`done`). Goal: every flag, verb, and tier fact a command or workflow asserts is one
  that actually exists and behaves as described.

The operator's premise — "we had lots of changes on both spur CLI commands and `plugins/sp`" — is
therefore **"I2/I3 drifted again since they closed."** The valuable output is the **delta**: what
re-drifted, how fast, and why the reconciliation did not hold. A finding that merely re-states an
I2/I3 finding is a signal that the fix was documentation-only and needs enforcement, not that the
audit is thorough. Report re-drift rate as a first-class result — it is the argument for whether any
of this can stay prose.

#### What to produce
1. **Cost attribution table.** Per `/sp:dev-*` entry point, what loads and in what order: command md →
   `Skill()` → SKILL.md → which `references/*.md`. Measure tokens per load and identify which are
   loaded unconditionally vs on demand. Use `spur history analyze` over recent real sessions plus
   `.spur/context/token-ledger.jsonl` — do not estimate from file sizes alone.
2. **Cache-hit finding.** Determine empirically what breaks the prompt prefix cache between
   invocations. Candidates to test, not assume: SessionStart hook output that varies per session,
   dynamic `<system-reminder>` injection, per-invocation `Skill()` ordering, subprocess agents
   (`spur agent run`) starting cold by construction. State which are real and which are noise.
3. **Drift table, per noun — `spur feature`, `spur agent`, `spur workflow` only.** `spur task` is
   **excluded** (feature F92, concurrent agent). For each: capability the CLI exposes but no plugin
   surface uses; prose in `plugins/sp` that restates or contradicts live CLI behavior; workflow YAML
   that hand-rolls what a CLI verb does. Cite `path:line` both sides. Apply the operator's principle:
   high cohesion internally, low coupling externally.
4. **Ranked fix path.** Top findings sized (S/M/L) with the expected cost delta each would buy, and a
   recommendation on **open question 2** (should `plugins/sp` prose relocate into the CLI's
   `--help`/`--json`?). Recommend; do not decide — the operator answers that on the map.

#### Known live discrepancy to fold in
`sp:wayfinder` documents `spur feature update <id> --section tags --from-file <(...)` for tagging a
map. That is wrong — `tags` is frontmatter, not a section; the CLI rejects it and the correct form is
`--field tags --value wayfinder-map`. Found while charting this map. Exactly the class of drift this
ticket inventories; include it and look for siblings.

#### Workflow YAML consolidation (operator item 2)
`config/workflows/` is 3,410 lines across 11 files, with `task-pipeline.yaml` (733),
`idea-pipeline.yaml` (732), and `planning-pipeline.yaml` (249) the bulk. Size how much is duplicated
across them and whether a shared-fragment mechanism exists in the engine or would have to be invented.
This rides along with R3 because it reads the same files — it is not a separate investigation.

#### Out of scope for this ticket
Applying any fix. This is measurement and inventory only — the fix path graduates into a feature.
### Requirements

- R1 — Produce a cost-attribution table for each `/sp:dev-*` entry point: what loads, in what order, how many tokens, and whether the load is unconditional or on demand. Measured from `spur history analyze` over real sessions and `.spur/context/token-ledger.jsonl` — not estimated from file sizes.
- R2 — Determine empirically what breaks the prompt prefix cache between invocations, testing each candidate (varying SessionStart hook output, dynamic system-reminder injection, `Skill()` ordering, cold subprocess agents) and reporting which are real causes and which are noise.
- R3 — Produce a drift table for `spur feature`, `spur agent`, and `spur workflow` only: CLI capability no plugin surface uses; `plugins/sp` prose that restates or contradicts live CLI behavior; workflow YAML that hand-rolls a CLI verb. Cite `path:line` on both sides. `spur task` is excluded (feature F92).
- R4 — Include the charting-discovered `sp:wayfinder` tagging discrepancy (`--section tags` vs `--field tags`) in the drift table and search for siblings of that class.
- R5 — Emit a ranked fix path with S/M/L sizing and the expected cost delta per item, plus a recommendation (not a decision) on map open question 2 — whether `plugins/sp` prose should relocate into the CLI's `--help`/`--json`.
- R6 — Read closed features I2 and I3 first and report the **delta**: which of their reconciliation findings re-drifted after they closed, and why the fix did not hold. Re-drift rate is a first-class result, not a footnote.
- R7 — Size how much of the 3,410 lines across the 11 `config/workflows/*.yaml` files is duplicated between `task-pipeline`, `idea-pipeline`, and `planning-pipeline`, and whether the engine already supports a shared-fragment mechanism or one would have to be invented.

### Acceptance Criteria

```gherkin
Feature: dev-* spine cost and drift inventory

  Scenario: R1 — cost is attributed to named loads, not estimated
    Given recent real /sp:dev-* sessions exist in the history plane
    When the cost attribution table is produced
    Then each row names a specific file load and its measured token cost
    And the measurement source is history data, not file line counts

  Scenario: R2 — cache-miss causes are tested, not assumed
    Given a list of candidate prefix-cache breakers
    When each candidate is tested against real invocations
    Then every candidate is reported as confirmed or ruled out with evidence

  Scenario: R3 — drift is cited on both sides and excludes spur task
    Given the CLI surface and the plugins/sp surface for feature, agent, and workflow
    When the drift table is produced
    Then every finding cites path:line for the CLI side and the plugin side
    And no finding concerns spur task

  Scenario: R4 — the known wayfinder tagging drift is present
    Given the sp:wayfinder skill documents --section tags for a frontmatter field
    When the drift table is reviewed
    Then that discrepancy appears as a finding
    And sibling findings of the same class were searched for

  Scenario: R5 — the fix path ranks and sizes without deciding
    Given the cost and drift findings
    When the fix path is emitted
    Then each item carries an S/M/L size and an expected cost delta
    And open question 2 receives a recommendation rather than a decision

  Scenario: R6 — the audit reports drift since I2 and I3, not drift from zero
    Given features I2 and I3 already reconciled these surfaces and closed
    When the drift table is produced
    Then each finding states whether it re-drifted after I2 or I3 closed
    And a re-drift rate is reported as a result

  Scenario: R7 — cross-workflow duplication is sized
    Given eleven workflow YAML files totalling 3410 lines
    When the duplication is measured
    Then the overlap between task-pipeline, idea-pipeline, and planning-pipeline is quantified
    And the report states whether a shared-fragment mechanism exists in the engine
```

### Q&A
**Closed at charting.**
- Scope of the per-noun review — `spur feature`, `spur agent`, `spur workflow` only; `spur task` is excluded (feature F92, concurrent agent in this tree).
- Whether this is a first audit or a re-audit — re-audit. I2 and I3 are `done`; the delta is the deliverable.

**Deferred to the operator (map open question 2, owner: operator).**
Whether `plugins/sp` prose should relocate into the CLI's `--help` / `--json`. This task produces a
recommendation with evidence; it does not decide. Do not implement either side.

**Open, resolvable by the implementer.**
- Whether enough `/sp:dev-*` sessions exist in the history plane to measure at all. If the usable
  session set is too small, say so explicitly and report R1/R2 as **unmeasurable with current data**
  plus what import would be needed — do not substitute file-size estimates.
### Design
**WHAT.** A measurement + inventory report. No production code ships from this task — **no new API,
no new CLI flag, no source change.** The deliverable is a markdown artifact plus the task's own
Solution section.

**WHY.** Two closed features (I2, I3) already reconciled these surfaces. Re-running the same audit
from zero would re-derive their findings and teach nothing. The value is the *delta* and its rate.

**WHERE — read set (frozen).**

| Area | Paths |
| --- | --- |
| Entry points | `plugins/sp/commands/dev-*.md` (33 files, 1,622 lines) |
| Spine | `plugins/sp/skills/spur-dev/SKILL.md` + `references/*.md` (16 files, 4,602 lines) |
| Facade | `plugins/sp/skills/spur-cli/references/**` (4,229 lines) |
| Workflows | `config/workflows/*.yaml` (11 files, 3,410 lines) |
| CLI truth | `apps/cli/src/commands/{feature,agent,workflow}.ts` + `--help` output |
| Cost data | `spur history analyze` artifacts; `.spur/context/token-ledger.jsonl` |
| Prior art | `docs/features/I2_*.md`, `docs/features/I3_*.md` and their linked tasks |

**Output artifact (frozen path):** `docs/design/dev-spine-cost-and-drift.md`.

**Method — measurement (R1, R2).** Cost must come from recorded sessions, not file arithmetic.
`spur history import` then `spur history analyze` over sessions that invoked `/sp:dev-*`; the analyze
JSON is the substrate. File line counts are context, never the measurement. For R2, a cache-miss
cause counts as *confirmed* only when a controlled comparison shows it: same command, one variable
changed, measured difference. Anything else is listed as ruled-out or untested — never asserted.

**Method — drift (R3, R6).** For each of `spur feature`, `spur agent`, `spur workflow`: take the live
CLI as ground truth (`--help` + the commander source), then diff the plugin prose and workflow YAML
against it in both directions — *asserted but absent* and *available but unused*. Cite `path:line` on
both sides of every row. Classify each finding as **new** or **re-drift** against I2/I3.

**Anti-patterns — do not do these.**
- Do not fix anything found. This is inventory; a fix here is out of scope and pollutes the delta.
- Do not estimate token cost from line counts and present it as measurement.
- Do not touch `spur task`, `packages/app/src/services/task-*`, or the section matrix — feature F92 is
  live in this tree from another agent.
- Do not re-run I2/I3's audit and report their findings as new.
- Do not propose a `plugins/sp` restructure. R5 recommends; map open question 2 decides.

**Handoff.** No dependent task. Findings graduate into features under `I` (spine), `D` (workflows),
`C` (rules, if enforcement is the answer). The ranked fix path in R5 is the input to that graduation.
### Plan
- [x] Read `docs/features/I2_*.md` and `I3_*.md` plus their linked tasks; extract their finding lists as the delta baseline (R6)
- [x] Import + analyze history over sessions that invoked `/sp:dev-*`; identify the usable session set and record its size (R1)
- [x] Build the per-entry-point load chain: command md → Skill() → SKILL.md → references, marking each load unconditional or on-demand (R1)
- [x] Attribute measured tokens to each load; emit the ranked cost table (R1)
- [x] Enumerate prefix-cache-break candidates; test each by controlled comparison; record confirmed / ruled-out / untested (R2)
- [x] Diff `spur feature` CLI against its plugin prose and workflow usage, both directions, with `path:line` citations (R3)
- [x] Repeat for `spur agent` (R3)
- [x] Repeat for `spur workflow` (R3)
- [x] Add the `sp:wayfinder` `--section tags` vs `--field tags` finding and grep for siblings of that class (R4)
- [x] Classify every drift row as new or re-drift vs I2/I3; compute and report the re-drift rate (R6)
- [x] Measure cross-YAML duplication across `task-pipeline` / `idea-pipeline` / `planning-pipeline`; check the engine for a shared-fragment mechanism (R7)
- [x] Write `docs/design/dev-spine-cost-and-drift.md`; emit the ranked fix path with S/M/L sizes and expected cost deltas (R5)
- [x] Record the open-question-2 recommendation explicitly as a recommendation, not a decision (R5)
- [x] Verification: every drift row carries two `path:line` citations; every cost figure traces to a history artifact; zero source files modified
### Solution
**Deliverable:** `docs/design/dev-spine-cost-and-drift.md` (feature I6 / task 0594: measurement +
drift inventory; zero source code changed).

**Headline results:**

- **R1 (cost):** over real history since I3 closed (2026-08-15), 198 sessions / 1,390 `/sp:dev-*`
  messages spent **310.2 K fresh input + 26,680.5 K cache-read tokens** — a **98.85 % prefix-cache
  hit ratio**. The spine reference set (4,602 lines / 16 files) is served from cache across
  invocations, not re-paid per call. **Per-file token attribution is unmeasurable with current
  data** (the ETL records per-message totals, not the injected file list) — reported honestly as
  the ceiling.
- **R2 (cache):** cold subagent launches are the **confirmed** breaker (97.15 % vs 98.96 % host
  ratio; short runs dip ~85–90 %). `Skill()` reordering ruled out on the common path; SessionStart
  + system-reminder injection listed untested (not asserted).
- **R3/R4 (drift):** one new **semantic-class** finding — `sp:wayfinder` `--section tags` at
  `plugins/sp/skills/wayfinder/SKILL.md` (line 123, finding D1 in the design doc) (valid flag, wrong operand; correct route is
  `--field tags --value`). **Zero siblings.** Every I2/I3-reconciled verb/flag still resolves.
- **R6 (delta):** **re-drift rate = 0 / 8 (0 %)**; the surviving finding was never in I3's visible
  scope (existence-check can't see a wrong-operand misuse).
- **R7 (YAML):** cross-pipeline duplication is **low**; the only repeated boilerplate is the
  `retry_transient` helper defined 3× inside `task-pipeline.yaml`. Engine has **no shared-fragment
  mechanism** (would have to be invented).

**R5 (fix path, recommendation only — operator decides open question 2):** F1 fix `wayfinder
SKILL.md:123` (S); F2 semantic-drift layer in the parity harness (M); F3 record injected file list
for per-file cost (M–L); F4 cold-subagent prefix reuse (L, conditional). OQ2 recommendation: **do
not relocate prose wholesale into `--help`** — the reference set is already cache-served; keep the
facade ownership split and add the semantic layer instead.
### Testing
- **Cost figures trace to a history artifact:** all R1/R2 numbers come from
  `spur history import --mode full` via the source-local binary `apps/cli/src/index.ts`
  (importer `@gobing-ai/ts-llm-jsonl-importer@0.4.38`, provenance header `binary=apps/cli/src/index.ts`)
  — never the stale `spur` on PATH. Read directly via SQL over the `history_message` ETL
  (`WHERE content_text LIKE '%/sp:dev-%' AND ts>='2026-08-15'`); cross-checked against the
  2.7 MB `history analyze --json` artifact. All figures are `GROUP BY` aggregates, not file-size
  estimates.
- **Drift rows carry two sides:** each R3 row names both a CLI `path:line` and a plugin
  `path:line`; the R4 finding is confirmed at `plugins/sp/skills/wayfinder/SKILL.md` (line 123) and the correct route in
  `docs/tasks3/0473…`.
- **Sibling sweep:** `rg '--section (tags|priority|status|phase|id|parent|name|owner|scope)'` over
  `plugins/` → exactly one hit (`plugins/sp/skills/wayfinder/SKILL.md` (line 123)); no siblings.
- **Zero source files modified:** `git status` shows only `docs/design/dev-spine-cost-and-drift.md`
  + the task corpus sections. `spur task`, `packages/app/src/services/task-*`, and the section
  matrix untouched (F92).

- **Coverage:** N/A — analysis task; zero source files modified, so no code coverage claim applies.
### Review
| Priority | Finding | Evidence / Disposition |
| --- | --- | --- |
| P1 | None — no blocking defects; deliverable is analysis-only | Design doc + sections complete; zero source files modified |
| P2 | Per-file token attribution unmeasurable with current ETL (records per-message totals, not injected file lists) | R1 reported at aggregate level; fix path F3 (record injected file list) graduates to a feature |
| P3 | `sp:wayfinder` line 123 documents `--section tags` (wrong operand; frontmatter field) | Finding D1; fix path F1 (S, document-only); zero siblings found in sweep |
| P4 | Prefix-cache: SessionStart/system-reminder injection candidate listed untested, not asserted | R2 evidence hierarchy honored; cold-subagent breaker confirmed (97.15 % vs 98.96 %) |

Risks / follow-ups: F2 semantic-drift layer (M) in the parity harness is the structural guard against D1's class; OQ2 recommendation recorded as recommendation only (do not relocate prose wholesale into `--help`).
### References
- Map: [I6](../features/I6_spur-harness-self-improvement-program-dev-spine-cost-event-5w1h-ssot-run-record-consolidation-and-board-module-boundaries.md)
- Prior art (delta baseline): [I2](../features/I2_spur-dev-spur-cli-parity-first-drift-audit-and-harness-refinement.md), [I3](../features/I3_harness-surface-reconciliation-plugins-sp-and-workflow-yaml-against-the-live-spur-cli.md)
- ADR-051 — CLI surface consent gate (any noun/verb change needs operator consent)
- ADR-028 — skill decomposition by function (why the spine dispatches competencies)
- `AGENTS.md` § Verification gate — the targeted-test-first rule and the `spur-check` cost contract
- Sibling tickets: [0595] (eval suite — consumes this task's cost baseline), [0596] (pipeline2)
### History
- 2026-08-19T01:12:46.334Z todo → wip (system)
- 2026-08-19T01:14:35.372Z wip → testing (system)
- 2026-08-19T01:15:03.843Z testing → done (system)
