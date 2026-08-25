---
schema_version: 1
id: "I8"
name: "History anatomy: daily cacheable diagnostic report, workflow orchestration, and bounded issue-finding migration"
status: verifying
priority: P2
tags: []
created_at: "2026-08-25T04:01:01.272Z"
updated_at: "2026-08-25T06:40:39.271Z"
---

# I8: History anatomy: daily cacheable diagnostic report, workflow orchestration, and bounded issue-finding migration

## Goal
Give Spur a report-only diagnostic capability that turns already-imported agent history into an
evidence-led anatomy of what actually happened — comprehensive and cacheable for a calendar day,
bounded and focused for an ad-hoc question — so that recurring failures, workflow deviations,
performance waste, and patterns worth preserving become visible without any model re-reading raw
conversation logs and without a report ever mutating the corpus.

### What reaching the end looks like

- **One skill owns interpretation.** `sp:history-anatomy` owns mode validation, evidence policy,
  finding taxonomy, comparison semantics, and the report contract. `/sp:dev-find-issue` becomes a
  thin forwarder to it.
- **`--mode <daily|ad-hoc>` replaces `--full`.** The flag names report *intent*, not verbosity:
  `daily` is the comprehensive, unfocused, cacheable calendar-day report (the default); `ad-hoc` is a
  focused question over explicit bounds, never cached.
- **A valid daily report is free the second time.** `docs/report/YYYY-MM-DD-history-anatomy.md`
  carries machine-readable provenance; a cache hit is proven by re-deriving the semantic artifact
  digest, never by trusting a filename or timestamp. A stale cache is never presented as current.
- **A dedicated workflow owns the mechanics.** `history-anatomy.yaml` owns the cache decision,
  deterministic analyze/render ordering, bounded model enrichment, independent evidence validation,
  and atomic publication — none of it living as prose a model has to re-execute correctly.
- **The forensics artifact stops overstating coverage.** True selection population counts and the
  applied leaderboard depth render as "top N of M"; last-import timestamps and parse/validation
  error detail appear in the coverage table (HA-S1, operator-approved 2026-08-24).
- **Findings are graded, not asserted.** Every finding separates observation from inference, carries
  per-finding confidence, shows contradicting signals beside itself, and names an owner surface,
  expected impact, and verification method. Unsupported dimensions read `not available` — never zero.
- **Migration is bounded, not permanent.** `sp:issue-finding` stays directly invocable during a
  measured coexistence window and is retired only against an explicit parity + adoption gate.
## Scope
In:

- A new independent skill `plugins/sp/skills/history-anatomy/SKILL.md`: mode validation, evidence
  policy, finding taxonomy, comparison/recurrence semantics, report contract, enrichment rubric, and
  evidence-validation rubric, plus its `enrich` and `validate` operations.
- Repointing `plugins/sp/commands/dev-find-issue.md` to a thin forwarder over `sp:history-anatomy`
  with the reduced `--mode`/`--date`/`--since`/`--until`/`--recompute`/`--agent`/`--output` surface;
  `--full`, `--save`, and the legacy source/session/category/severity/task-creation flags are dropped.
- A dedicated `config/workflows/history-anatomy.yaml` state-machine workflow owning the cache branch,
  deterministic stage ordering, executor dispatch, one bounded correction loop, and publication.
- One plugin-shipped helper script (with its `.mjs` twin, per ADR-065) performing only deterministic
  work: normalized semantic artifact digest, cache metadata comparison, structural report checks, and
  atomic file replacement. No finding or remediation logic.
- The `docs/report/YYYY-MM-DD-history-anatomy.md` daily cache contract: identity tuple, frontmatter
  provenance, freshness/invalidation rules, provisional-versus-closed current-day semantics, late-import
  handling, and the `--recompute` path.
- HA-S1 (operator-approved 2026-08-24): additive `analyze` artifact fields carrying true selection
  population counts and the applied leaderboard depth; forensics renderer changes rendering "top N of M"
  instead of a bounded array length, plus last-import and parse/validation error columns and warning
  detail in the existing coverage section. Additive only — pre-addition artifacts still render.
- Removal of `/sp:dev-history-load` and its plugin helper/twin, test, build-conversion entry, and
  `config/plugin-scripts.json` declaration.
- The bounded coexistence and retirement gate for `sp:issue-finding`: parity fixture set, adoption
  evidence definition, review date, and the explicit operator approval required to retire it.
- Same-commit surface documentation: shared flag glossary entries (including a canonical `--date`),
  roles inventory, `plugins/sp/README.md`, command/skill structure tests, and `docs/04_DESIGN.md`.

Out:

- Any new `spur history` verb or flag. HA-S1 is additive artifact/renderer work inside the existing
  `analyze` and `report --mode forensics` surfaces; a new verb or flag is a separate consent decision.
- Raw JSONL parsing, session-root discovery, or any importer/schema change. Missing narrative or
  causal evidence is reported as a telemetry gap, never recovered by reading raw logs.
- Any import path change: `bun run load-history` and the History module's **Import & Analyze** action
  remain the sole import owners and are preserved byte-for-byte. The skill never imports implicitly.
- Automatic remediation of any kind — no `--create-task`, no `--resolve`, no fix mode. The skill and
  workflow must not call task, feature, rule, workflow-definition, docs, or source mutation surfaces.
- Retiring `sp:issue-finding` in this feature. Retirement is a separate change gated on parity PASS,
  demonstrated use of both modes, no open high-impact regression, and explicit operator approval.
- Merging with `sp:dev-daily` / `sp:daily-summary`, which summarizes usage/git/notes rather than
  diagnosing imported conversation behavior.
- Database schema changes, transport DTOs, Board UI surfaces, scheduler changes, and new dependencies.
- Bespoke adoption telemetry. Adoption evidence comes from existing workflow run records.
## Acceptance Criteria
```gherkin
Feature: History anatomy: daily cacheable diagnostic report, workflow orchestration, and bounded issue-finding migration

  # --- Command surface and mode contract ---

  @core
  Scenario: R1 — The command is a thin forwarder carrying only the reduced surface
    Given the sp plugin command file "plugins/sp/commands/dev-find-issue.md"
    When the plugin command structure test suite loads it
    Then its body contains exactly one skill invocation and that invocation names "sp:history-anatomy"
    And its argument-hint lists "--mode", "--date", "--since", "--until", "--recompute", "--agent" and "--output"
    And its argument-hint names none of "--full", "--save", "--source", "--sessions", "--feature", "--template", "--priority", "--severity", "--category", "--top", "--min-cost", "--strict-topic", "--create-task" or "--json"
    And the body links the shared flag glossary at "../skills/spur-dev/references/flag-glossary.md"

  @core
  Scenario: R2 — Daily is the default mode and rejects ad-hoc-only arguments
    Given an operator invoking "/sp:dev-find-issue" with no mode argument
    When the skill resolves the mode
    Then the resolved mode is "daily"
    And the resolved window is the current local calendar day
    And the report prints the normalized inclusive ISO bounds and the timezone used
    And an invocation combining "--mode daily" with focus text, "--since", "--until" or "--output" fails loud naming the conflicting argument

  @core
  Scenario: R3 — Ad-hoc mode requires a focus and two ordered bounds
    Given an operator invoking "/sp:dev-find-issue" with "--mode ad-hoc"
    When the skill validates the arguments
    Then a missing or empty focus fails loud
    And "--until" without "--since" fails loud
    And "--until" earlier than "--since" fails loud
    And "--date" or "--recompute" combined with "--mode ad-hoc" fails loud
    And a valid ad-hoc run writes to the run directory unless "--output <path>" is explicit

  @edge
  Scenario: R4 — A daily date selector maps to a DST-aware local calendar interval
    Given a local timezone in which the requested calendar date is 23 or 25 hours long
    When the operator runs "/sp:dev-find-issue --date <that-date>"
    Then the normalized bounds span the full local calendar day including the DST shift
    And the report states the timezone alongside the bounds
    And the bounds are not computed as a fixed 24-hour offset from local midnight

  # --- Daily cache contract ---

  @core
  Scenario: R5 — A valid daily cache is reused without repeating model enrichment
    Given a published report at "docs/report/<date>-history-anatomy.md" whose frontmatter provenance is well-formed
    And the imported history for that window is unchanged since publication
    When the operator runs "/sp:dev-find-issue --date <date>"
    Then the workflow re-derives the semantic artifact digest from a fresh deterministic analyze
    And the digest matches the digest recorded in the cached report's frontmatter
    And the model enrichment stage is not invoked
    And the returned report records cache disposition "hit" and a refreshed "validated_at"

  @core
  Scenario: R6 — Changed imported data invalidates the cache before it can be presented
    Given a published daily report for a closed calendar day
    And history for that day has since been imported from an additional source
    When the operator runs "/sp:dev-find-issue --date <that-day>"
    Then the freshly derived semantic artifact digest differs from the recorded digest
    And the workflow regenerates through analyze, render, enrichment and validation
    And the stale cached report is never returned to the operator as current evidence
    And the republished report records cache disposition "miss"

  @core
  Scenario: R7 — Changed report logic invalidates the cache even when the data is identical
    Given a published daily report whose data digest still matches
    And the report contract version, skill digest or workflow digest has since changed
    When the operator runs "/sp:dev-find-issue --date <that-day>"
    Then the recorded logic digests do not match the current ones
    And the workflow regenerates the report rather than reusing the cached enrichment

  @core
  Scenario: R8 — The current day is always labeled provisional and closes exactly once
    Given the operator requests today's report while the local day is still in progress
    When the report is generated
    Then its window spans local midnight through invocation time
    And its frontmatter records "window_state: provisional"
    And it displays an "imported snapshot as of" banner derived from per-source lastImportedAt
    And it never claims a source was imported later than that source's recorded timestamp
    And the first invocation after the local day closes analyzes the complete calendar interval, records "window_state: closed", and invalidates the provisional cache

  @core
  Scenario: R9 — Forced recompute bypasses both deterministic and enrichment reuse
    Given a daily cache that would otherwise be a valid hit
    When the operator runs "/sp:dev-find-issue --date <date> --recompute"
    Then the full analyze, render, enrichment and validation path executes
    And the published report records cache disposition "forced-recompute"

  @core
  Scenario: R10 — A failed candidate never replaces a valid cached report
    Given a published daily report that passed evidence validation
    When a later run for the same day fails structural validation twice
    Then the workflow terminates with a failure status naming the validation stage
    And the previously published report at "docs/report/<date>-history-anatomy.md" is left byte-identical
    And no partial or unvalidated candidate is written to that path

  @edge
  Scenario: R11 — Missing or malformed cache provenance is treated as a miss, not a crash
    Given a file exists at "docs/report/<date>-history-anatomy.md" with absent, truncated or unparsable frontmatter
    When the operator runs "/sp:dev-find-issue --date <date>"
    Then the cache probe classifies it as a miss and states why
    And the workflow regenerates the report
    And the run does not abort on the malformed file

  @edge
  Scenario: R12 — Degraded source coverage invalidates a cache that claimed broader coverage
    Given a published report recording coverage over a set of sources
    And the current analyze covers strictly fewer of those sources
    When the cache is probed
    Then the cache is rejected as not equivalent
    And the regenerated report states the reduced coverage and lists the unavailable sources

  # --- Workflow orchestration ---

  @core
  Scenario: R13 — The workflow owns cache, generation, enrichment, validation and publication ordering
    Given the workflow definition "config/workflows/history-anatomy.yaml"
    When it is validated and dry-run
    Then it passes "spur workflow validate"
    And its states resolve scope, probe the cache, analyze the selected and previous comparable windows, render both artifacts, invoke enrichment, run a deterministic structure gate, run independent evidence validation, and publish atomically
    And publication is reachable only from a passing validation state

  @core
  Scenario: R14 — Correction is capped at exactly one pass
    Given a generated report candidate that fails independent evidence validation
    When the workflow enters the correction path
    Then exactly one correction pass is attempted
    And a second validation failure terminates the run without publishing

  @core
  Scenario: R15 — Analysis and rendering always use explicit run-scoped artifact paths
    Given the workflow generates a current-window artifact and a baseline artifact
    When it renders them
    Then each "spur history analyze" invocation writes to an explicit unique path
    And each "spur history report --mode forensics" invocation names that exact path
    And no stage reads the mutable "latest.json" pointer

  @core
  Scenario: R16 — The helper script performs only deterministic file, hash and schema work
    Given the plugin-shipped cache helper and its ".mjs" twin
    When "bun run script-contract-check" runs
    Then the twin is present and up to date and the script is declared in "config/plugin-scripts.json"
    And the script contains no finding, remediation, severity or ranking logic
    And the script names no repo-relative "bun plugins/sp/scripts/" path in a shipped surface

  # --- Report contract ---

  @core
  Scenario: R17 — Every published report carries all eleven required sections
    Given a report published in either mode
    When its structure is checked
    Then it contains scope and provenance, executive summary, baseline comparison, findings table, recurrence ledger, telemetry gaps, remediation options, performance analysis, workflow improvements, positive patterns, and an evidence ledger
    And no section contains a placeholder, a TODO, or an empty body

  @core
  Scenario: R18 — Every finding carries the full per-finding field set
    Given the findings table of a published report
    When each row is inspected
    Then it carries a stable key of the form "<category>:<owner-surface>:<signal>"
    And its category is one of reliability, repetition, workflow, performance, coverage, telemetry or positive
    And it carries impact, trend, observation, inference, confidence and at least one evidence anchor
    And any contradicting signal is shown beside the finding rather than silently reconciled
    And confidence is per finding, not one blanket score for the report

  @core
  Scenario: R19 — Observation and inference are separated and causality is gated on two signals
    Given a finding asserting that one condition caused another
    When the evidence validation stage reviews it
    Then a causal claim supported by two or more independent signals passes
    And a causal claim supported by exactly one signal fails unless it is labeled a hypothesis with a stated confirmation path
    And an inference that does not name its supporting observations fails validation

  @core
  Scenario: R20 — Unsupported dimensions read "not available" and are never rendered as zero
    Given the artifact carries no data for a dimension the report contract requires
    When the report renders that dimension
    Then it reads "not available"
    And it is not rendered as zero
    And it is not silently omitted
    And it is also listed in the telemetry gaps section

  @core
  Scenario: R21 — Baseline comparison states an explicit comparability verdict
    Given a daily report for a closed calendar day
    When the baseline is computed
    Then it compares against the immediately preceding local calendar day
    And an ad-hoc report instead compares against the immediately preceding equal-duration window
    And missing or materially different baseline coverage renders "not comparable"
    And no trend, delta or percentage is stated for a "not comparable" baseline

  @core
  Scenario: R22 — The recurrence ledger classifies every finding against the baseline
    Given a report with a comparable baseline
    When the recurrence ledger renders
    Then every finding is classified as new, recurring, regressed, improved, resolved or not-comparable
    And classification matches on the stable key, not the prose title
    And rewording a finding's title between two runs does not reclassify a recurring finding as new

  @core
  Scenario: R23 — Remediation options are proposals with an owner, an impact and a verification method
    Given the remediation section of a published report
    When each option is inspected
    Then it names the owner surface that would apply it
    And it states expected impact and a verification method
    And it states its reversibility
    And it does not contain an applied change, a diff, or a command the report claims to have already run

  @core
  Scenario: R24 — Process and workflow improvements are gated on recurrence or a high-impact violation
    Given a proposed workflow or process improvement
    When the evidence validation stage reviews it
    Then it passes when the underlying signal recurs across at least two independent sessions
    And it also passes when it cites exactly one explicit high-impact contract violation with repo-relative "file:line" evidence
    And it fails when neither condition holds
    And a single-session low-impact observation is recorded as a finding but not promoted to a process change

  @core
  Scenario: R25 — Positive patterns are held to the same evidence standard as problems
    Given the positive patterns section of a published report
    When each entry is inspected
    Then it carries the same observation, inference, confidence and evidence anchor fields as a problem finding
    And an entry without a supporting evidence anchor fails validation

  @core
  Scenario: R26 — The evidence ledger anchors every claim to a citable source
    Given the evidence ledger of a published report
    When each entry is inspected
    Then every quantitative claim names the artifact field or renderer section it came from, together with the selector
    And every repository-contract claim names repo-relative "file:line" evidence
    And a claim with no anchor fails the deterministic structure gate

  @edge
  Scenario: R27 — Focus biases ranking without suppressing high-severity off-topic evidence
    Given an ad-hoc invocation carrying a focus string
    When the report is produced
    Then the focus changes finding ranking and emphasis
    And material off-topic findings within the window remain visible in the report

  # --- Non-mutation boundary ---

  @core
  Scenario: R28 — The skill and workflow contain no mutation, import or raw-log path
    Given the new skill and workflow definitions
    When the boundary test suite scans them
    Then they contain no invocation of "spur task", "spur feature", "spur rule", a workflow-definition mutation, a docs mutation, or a source edit
    And they contain no invocation of "spur history import" and no JSONL or session-root discovery recipe
    And the only writes they perform are run-scoped intermediates, analyze artifacts, and the requested report or cache file

  # --- HA-S1: history artifact and forensics renderer correction ---

  @core
  Scenario: R29 — The analyze artifact records true selection population and applied depth
    Given a window whose selection contains more sessions and tools than the applied leaderboard depth
    When "spur history analyze --top <n>" writes the artifact
    Then the artifact records the true total session population and the true total tool population for the selection
    And it records the applied leaderboard depth
    And the bounded "bySession" and "byTool" arrays remain at most the applied depth

  @core
  Scenario: R30 — The forensics renderer reports "top N of M" instead of a bounded array length
    Given an artifact whose true session population exceeds the applied leaderboard depth
    When "spur history report --mode forensics" renders it
    Then the sessions figure reports the true population, not the bounded array length
    And each leaderboard is labeled with its applied depth against the true population
    And no bounded array length is presented as a total

  @core
  Scenario: R31 — The coverage section renders freshness and error detail the artifact already carries
    Given an artifact whose coverage entries carry lastImportedAt, parse errors, validation errors and sample overflow
    When the forensics report renders its coverage section
    Then it shows per-source lastImportedAt
    And it shows parse-error and validation-error counts
    And it indicates when error samples were truncated
    And it renders warning detail rather than only a warning count

  @core
  Scenario: R32 — Pre-addition artifacts still render without the new fields
    Given an artifact written before the HA-S1 fields existed
    When "spur history report --mode forensics" renders it
    Then rendering succeeds
    And the absent population and depth values render as "not available"
    And no population figure is fabricated from the bounded array length

  # --- Preservation, removal and bounded migration ---

  @core
  Scenario: R33 — Both supported import paths are preserved unchanged
    Given the feature is fully implemented
    When the import surfaces are inspected
    Then the "load-history" script in "package.json" is unchanged
    And the History module's "Import & Analyze" action and its queued refresh path are unchanged
    And running the new command never triggers an import

  @core
  Scenario: R34 — The obsolete history-load command is removed cleanly
    Given "/sp:dev-history-load" and its plugin helper are removed
    When the repository gates run
    Then "plugins/sp/commands/dev-history-load.md", the helper script, its ".mjs" twin, its test and its build-conversion entry are absent
    And its "config/plugin-scripts.json" declaration is absent
    And "bun run script-contract-check" passes
    And no shipped surface still references the removed command

  @core
  Scenario: R35 — Coexistence: the legacy skill stays invocable while the command resolves to the new one
    Given the feature is shipped
    When the plugin package is inspected
    Then "sp:issue-finding" remains packaged and directly invocable
    And it is documented as the legacy path
    And "/sp:dev-find-issue" resolves to "sp:history-anatomy"
    And no logic is copied from the legacy skill into the new one

  @core
  Scenario: R36 — The retirement gate is written down with a parity fixture set and a review date
    Given the coexistence window is defined
    When the retirement contract is inspected
    Then it lists parity fixtures covering typed history analysis, daily and focused range selection, repeated-work and error reporting, evidence and confidence, remediation proposals, performance, process observations, and positive patterns
    And it names raw JSONL parsing and task creation as intentional exclusions rather than parity gaps
    And it defines adoption evidence as successful workflow run records across both modes, with no bespoke telemetry added
    And it sets a review point of one minor release or 30 days, whichever is later
    And it states that retirement requires explicit operator approval and is a separate change

  @core
  Scenario: R37 — Shared surface documentation lands in the same change as the surface
    Given the command, skill and workflow surfaces have changed
    When the documentation gates run
    Then the shared flag glossary carries a canonical "--date" entry and no dead roster references to removed flags
    And the roles inventory, "plugins/sp/README.md" and "docs/04_DESIGN.md" describe the new surfaces
    And "bun run spur-check" passes
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0657 | HA-S1: true population counts and truthful coverage rendering in the history forensics artifact | done |
| 0658 | sp:history-anatomy skill: mode contract, finding taxonomy, and the eleven-section report contract | done |
| 0659 | History-anatomy cache helper: semantic artifact digest, invalidation matrix, structure gate, atomic publish | done |
| 0660 | history-anatomy.yaml workflow: cache branch, deterministic stage ordering, bounded correction, atomic publication | done |
| 0661 | Repoint /sp:dev-find-issue, remove /sp:dev-history-load, and land the coexistence and surface documentation | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-25T06:40:38.841Z backlog → active (system)
- 2026-08-25T06:40:39.271Z active → verifying (system)
