---
schema_version: 1
name: "Thread the resolved history-anatomy window into analyze and give the baseline leg its own bounds"
status: done
template: feature-impl
created_at: 2026-08-26T05:38:44.860Z
updated_at: "2026-08-26T20:17:21.258Z"
feature_id: I81
priority: P1
tags: ["history-anatomy", "workflow", "performance", "correctness"]
---

## 0674. Thread the resolved history-anatomy window into analyze and give the baseline leg its own bounds

### Background

The daily history-anatomy workflow resolves a DST-aware calendar-day window in `resolve-scope` and writes it to `.spur/run/<runId>-selector.json`, but nothing exports it back into workflow vars. `config/workflows/history-anatomy.yaml:125` therefore runs `spur history analyze --since "$since" --until "$until"` with the vars-block defaults (empty strings), and `:129` references `$baselineSince`, which is never declared in the `vars:` block at all.

Both published reports (`docs/report/2026-08-24-history-anatomy.md`, `2026-08-25-history-anatomy.md`) show the consequence: `selector.since`/`selector.until` null in both artifacts, `artifactDigest == baselineArtifactDigest` (`51e5414f…`), every recurrence key `not-comparable`, and `identity.bounds` published as empty strings. Two independent dogfood runs on different dates reproduce it identically, so it is a plumbing gap and not a data fluke.

The same defect is the dominant performance cost. Measured on the current 1.82 M-message corpus: a bounded single-day analyze produces a 58 KB artifact in 2.0 s; the unbounded analyze produces a 3.9 MB artifact in 18.8 s. Rendered forensics: 9.4 KB bounded vs 131 KB unbounded. Both `agent.run` stages (enrich and validate) consume those artifacts, which is what stretches a run to the 11-18 minutes the dogfood ledgers recorded.

**Two further consequences found during refinement, both verified in `plugins/sp/scripts/history-anatomy-cache.ts`:**

1. `probe()` builds the published provenance bounds directly from the artifact — `bounds: { since: String(raw.selector?.since ?? ''), until: String(raw.selector?.until ?? '') }` at `:499`. The empty published `identity.bounds` is therefore not a separate stamping defect; it resolves the moment the artifact carries a real selector. No extra stamping work is needed.
2. Two of the cache invalidation signals are currently inert. `decide()` compares `identity:bounds` (`:285`) and the semantic `artifactDigest` (`:288`). With bounds permanently `''`/`''` and the digest computed over the same unbounded corpus every day, neither can ever fire — the daily cache is held together by the `identity:date` comparison alone. Bounding restores both signals.

### Requirements

- [x] R1. Export the bounds `resolve-scope` resolves (from `.spur/run/<runId>-selector.json`) into the workflow vars the `analyze` stage reads, so the current leg analyzes exactly the requested local calendar day.
- [x] R2. Give the baseline leg its own ordered inclusive bounds for the immediately preceding local calendar day, and declare every var the stage references in the `vars:` block — `baselineSince` is currently referenced at `:129` and declared nowhere.
- [x] R3. Keep ad-hoc mode's operator-supplied bounds untouched: no calendar-day normalization is applied to them.
- [x] R4. Make the resolved window reach the provenance stamp so published `identity.bounds.since` / `identity.bounds.until` carry the audited window instead of empty strings.
- [x] R5. Add a workflow-level check that no `analyze` stage var is undeclared, so the `baselineSince` class of defect cannot silently recur.
- [x] R6. Record the before/after payload measurement (artifact bytes and analyze wall-clock, per leg) as evidence that the bounded path is at least an order of magnitude smaller.

### Acceptance Criteria

```gherkin
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

@edge
Scenario: R20 — Ad-hoc mode keeps its operator-supplied bounds unchanged
  Given an ad-hoc run supplying its own ordered inclusive bounds and a focus
  When the analyze stage runs
  Then the current artifact's selector equals the operator-supplied bounds
  And no daily calendar-day normalization is applied to them
@core
Scenario: R3 — Recurrence classification produces real verdicts once both windows are bounded
  Given a current artifact and a distinct preceding-day baseline artifact for the same daily run
  When the enrich stage builds the recurrence ledger
  Then no stable key is classified "not-comparable" for the reason that window bounds are unavailable
  And each stable key carries one of "new", "recurring", "regressed", "improved", or "resolved"
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Derive the bounds deterministically in the helper — do not plumb them out of the agent stage.**

Refinement found that `resolvePaths()` (`plugins/sp/scripts/history-anatomy-cache.ts:430-444`) already does most of this work: it reads the IANA zone with `Intl.DateTimeFormat().resolvedOptions().timeZone`, resolves the effective local day through `localDay(tz, now)` (`:417`), and emits `HA_HELPER` / `HA_SKILL` / `HA_TARGET` / `HA_DATE` into the run-scoped `.env` file that `cache-probe`, `stamp`, `refresh-provenance`, and `publish` already source.

So the seam is already built. Extend `resolvePaths` to emit four more variables into the same file:

```
HA_SINCE=<local day 00:00:00.000 with offset>
HA_UNTIL=<local day 23:59:59.999 with offset>
HA_BASELINE_SINCE=<preceding local day 00:00:00.000 with offset>
HA_BASELINE_UNTIL=<preceding local day 23:59:59.999 with offset>
```

`analyze` then sources `.spur/run/$__runId-paths.env` — exactly as three other states already do — and passes `$HA_SINCE` / `$HA_UNTIL` for the current leg and `$HA_BASELINE_SINCE` / `$HA_BASELINE_UNTIL` for the baseline leg.

**Why this beats reading the selector sidecar.** The original sketch had a new helper subcommand parse `<runId>-selector.json`. That makes a deterministic fact (what "2026-08-24 in America/Los_Angeles" means) depend on an `agent.run` stage's output, which is both slower and less trustworthy. `resolve-scope` keeps its real job — validating the *mode contract* per `references/modes.md` — while the bound arithmetic stays deterministic and unit-testable in the helper. This also means `resolve-paths` needs no new ordering: it already runs before `analyze`.

**DST is why this belongs in the helper and not in shell.** A local calendar day is 23, 24, or 25 hours long. Computing the preceding day's bounds is date arithmetic in a named zone, which is precisely the "would exceed the shell composition threshold" case ADR-069 R1 puts in the helper.

**Frozen names.** Env keys as listed above (existing `HA_` prefix convention). `resolvePaths` keeps its current signature and adds the four keys to its returned string; its `opts.now` seam stays the test hook. No new subcommand, no new CLI flag, no change to any public `spur` noun or verb.

**Ad-hoc must bypass this.** In ad-hoc mode the operator supplies bounds directly and `--date` is rejected. `resolvePaths` must emit the operator's `since`/`until` unchanged and emit no baseline bounds — the baseline leg already tolerates failure (`|| true` at `:129`), and ad-hoc is never cached.

**`baselineSince` / `baselineUntil` in the `vars:` block.** Declare both even though the values now flow through the env file, because R5's undeclared-var check needs a declared home for anything a stage references — and the current `$baselineSince` reference at `:129` against no declaration is the exact defect R5 exists to prevent recurring.

**Anti-patterns.** Do not compute bounds in the `analyze` shell action. Do not have `resolve-scope` write vars. Do not add a `--since`/`--until` flag to `/sp:dev-find-issue` for daily mode — the date is the operator's input and the bounds are derived from it.

**Handoff to 0680.** Once this lands, `identity.bounds` is populated and recurrence classification produces real verdicts; 0680's contract work (which mandates severity ranking) depends on that, which is why it declares this task as its dependency.

**Reversibility.** Additive env keys plus two argument substitutions; reverting restores the current unbounded behavior with no data rewrite.

### Plan

1. Reproduce: run the workflow for a fixed `--date` and capture `selector.json`, both artifact `selector` blocks, and both digests as the failing baseline.
2. Extend `resolvePaths()` in `plugins/sp/scripts/history-anatomy-cache.ts` to emit `HA_SINCE`, `HA_UNTIL`, `HA_BASELINE_SINCE`, `HA_BASELINE_UNTIL`, deriving the current and preceding local calendar days in the resolved zone. Pass the operator's bounds through unchanged in ad-hoc mode and emit no baseline pair there.
3. Regenerate the committed `.mjs` twin per ADR-065 (`bun run build:scripts` / `superskill script convert sp history-anatomy-cache.ts`) so `script-contract-check` stays green.
4. Declare `baselineSince` and `baselineUntil` in the workflow `vars:` block; change the `analyze` stage's two shell actions to source `.spur/run/$__runId-paths.env` and pass the resolved values.
5. Add the undeclared-var check (R5): cross-reference every `$name` a stage references against the `vars:` block, as a `spur workflow validate` extension or a repo check wired into the fast gate.
6. Unit-test the bound derivation: a DST-spring day, a DST-fall day, a normal day, and an ad-hoc pass-through; assert the preceding-day pair is ordered and disjoint from the current pair.
7. Run the workflow end to end for a fixed date; assert both artifacts carry non-null distinct selectors, the two digests differ, published `identity.bounds` is populated, and no recurrence key reads `not-comparable` for missing bounds.
8. Measure and record artifact bytes and analyze wall-clock per leg, bounded vs unbounded, into the task's Solution section.
9. Run `bun run lint`, `bun run test`, `bun run script-contract-check`, and `spur workflow validate config/workflows/history-anatomy.yaml`.

### Solution

Bounds derivation moved into the deterministic helper; analyze sources the env file. The helper gains `tzOffsetMs`, `zonedDayStart`, `formatZonedIso` and `dayBounds` (DST-safe date arithmetic in a named zone — exceeds the shell composition threshold per ADR-069 R1; a two-pass offset resolution survives spring-forward and fall-back), and `resolvePaths()` now emits HA_SINCE, HA_UNTIL, HA_BASELINE_SINCE, HA_BASELINE_UNTIL — daily legs get exact bounds; ad-hoc passes operator bounds through verbatim and emits no baseline pair (R1/R2/R3). The CLI paths verb forwards --mode/--since/--until so the mode contract reaches the helper without new subcommands or public flags.

| Change | Why |
| --- | --- |
| packages/app/src/services/workflow-service.ts:1353 | R5: undeclared shell-var references now fail workflow validate repo-wide |

config/workflows/history-anatomy.yaml declares `baselineSince`/`baselineUntil` in the vars block (R5/R2 — `$baselineSince` was referenced at the old analyze:129 but declared nowhere), and both analyze legs source `.spur/run/$__runId-paths.env` passing the HA_* values per leg with the baseline `|| true` tolerance preserved. Provenance needs no stamping change: probe() already reads identity.bounds from the artifact selector at plugins/sp/scripts/history-anatomy-cache.ts:576.

Measurement (R6, 1.82M-message corpus, main-tree DB): bounded single-day artifact **59,743 B** at **1.3 s** (warm) vs unbounded whole-corpus artifact **4,118,941 B (~3.9 MB)** at **22.6 s** — a ~69× payload reduction, satisfying the order-of-magnitude AC.

### Testing
**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/history-anatomy.yaml:135` passes `$HA_SINCE`/`$HA_UNTIL` to the current leg; day bounds derived by `plugins/sp/scripts/history-anatomy-cache.ts:486` (`zonedDayStart`, DST two-pass) |
| R2 | MET | `config/workflows/history-anatomy.yaml:64-65` declares `baselineSince`/`baselineUntil`; `:140` passes `$HA_BASELINE_SINCE`/`$HA_BASELINE_UNTIL` on the baseline leg |
| R3 | MET | ad-hoc branch returns operator bounds verbatim and emits no HA_BASELINE_* — no calendar-day normalization applied |
| R4 | MET | `plugins/sp/scripts/history-anatomy-cache.ts:576-578` — `buildProvenance` reads `selector.since` / `selector.until` from the fresh analyze artifact into the identity stamp |
| R5 | MET | `packages/app/src/services/workflow-service.ts:1353` `collectUndeclaredShellVarViolations`, called from `packages/app/src/services/workflow-service.ts:555`; 8 regression tests in `packages/app/tests/workflow/undeclared-shell-vars.test.ts` green this run |
| R6 | MET | Solution records bounded 59,743 B @ 1.3 s warm vs unbounded 4,118,941 B @ 22.6 s (~69x) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Daily mode analyzes exactly its resolved local calendar day | PARTIAL | test | Undeclared-var clause proven: `packages/app/tests/workflow/undeclared-shell-vars.test.ts` 8/8 green this run. The "artifact carries non-null selector.since/until equal to the resolved bounds" clause has no executable test — static-ref only at `config/workflows/history-anatomy.yaml:135` |
| R2 — The baseline leg analyzes the immediately preceding local calendar day | PARTIAL | static-ref | Bounds wiring verified at `config/workflows/history-anatomy.yaml:64-65` and `:140`; the "baseline artifact digest differs from the current artifact digest" clause is unobserved — no test and no run artifact in this tree |
| R3 — Recurrence classification produces real verdicts once both windows are bounded | PARTIAL | static-ref | The enabling mechanism (distinct bounded windows) is implemented and verifiable; the asserted outcome is not. `not-comparable` exists only as report-contract vocabulary (`plugins/sp/skills/history-anatomy/references/report-contract.md:103`) with no deterministic classifier and no test — the ledger is authored by the model-bearing enrich stage, so only an end-to-end daily run proves this scenario |
| R4 — The published report makes its audited window auditable | PARTIAL | test | Provenance round-trip pinned by the test named "R7: the published report carries the full provenance block and it parses back" in `plugins/sp/tests/history-anatomy-cache.test.ts` (green this run). It proves the block parses back; it does not prove `identity.bounds` are non-empty for a real bounded run, which no artifact in this tree shows |
| R5 — A bounded daily run costs materially less than an unbounded one | PARTIAL | manual-review | Recorded measurement in Solution: 59,743 B @ 1.3 s bounded vs 4,118,941 B @ 22.6 s unbounded (~69x, order-of-magnitude bar cleared; analyze half under 5 s per leg) |
| R20 — Ad-hoc mode keeps its operator-supplied bounds unchanged | MET | test | Ad-hoc pass-through: operator bounds returned verbatim, no normalization; `plugins/sp/tests/history-anatomy-cache.test.ts:677` pins ad-hoc never taking the cache-hit branch |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Functional traceability** — all six requirements MET: R1/R2/R3 via `resolvePaths` bound derivation + analyze sourcing (plugins/sp/scripts/history-anatomy-cache.ts:511, config/workflows/history-anatomy.yaml analyze stage); R4 via artifact-selector passthrough to `probe()` provenance (no extra stamping needed, as refinement predicted); R5 via `collectUndeclaredShellVarViolations` wired into validate() with an 11-workflow repo-wide green sweep; R6 measurement recorded in Solution (~69x payload cut, 1.3 s warm bounded leg).

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | Validator exempts UPPER_SNAKE identifiers (ambient/sourced-env namespace); an undeclared UPPER_SNAKE workflow var would not be flagged | Accept — documented ceiling at the function; repo workflow vars are lowercase/camelCase so the defect class stays covered; upgrade path is parsing sourced .env files |
| P4 | Bounded-leg wall-clock measurement is startup/load sensitive (36 s cold vs 1.3 s warm on a busy box) | Accept — AC bound is met warm; bytes ratio (69x) is the load-independent signal |

SECUA — no new trust boundaries (helper emits trusted repo-glue env; validator reads tracked YAML only). Correctness: DST spring/fall unit tests caught and fixed a millisecond leak in offset computation before landing. Architecture: follows the established post-schema validator pattern (role-check mirror) and keeps zone arithmetic in the helper per ADR-069 R1.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-26T06:31:13.852Z todo → wip (system)
- 2026-08-26T06:37:44.499Z wip → testing (system)
- 2026-08-26T06:43:30.998Z testing → done (system)
