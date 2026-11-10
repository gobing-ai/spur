---
schema_version: 1
name: "Thread the resolved history-anatomy window into analyze and give the baseline leg its own bounds"
status: done
template: feature-impl
created_at: 2026-08-26T05:38:44.860Z
updated_at: "2026-11-10T21:11:31.440Z"
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

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/history-anatomy.yaml:131` passes HA_SINCE and HA_UNTIL to the current analyze leg. `packages/app/src/services/history-anatomy.ts:719` emits those daily bounds. This run read `.spur` `run/05d14930-17c2-4089-b3da-cff6b318b3c1-history-anatomy-current.json` line 6 and line 7: selector since 2026-11-08T00:00:00.000-08:00 and until 2026-11-08T23:59:59.999-08:00. |
| R2 | MET | `config/workflows/history-anatomy.yaml:65` and `config/workflows/history-anatomy.yaml:66` declare baselineSince and baselineUntil. `config/workflows/history-anatomy.yaml:136` passes HA_BASELINE_SINCE and HA_BASELINE_UNTIL. This run read `.spur` `run/05d14930-17c2-4089-b3da-cff6b318b3c1-history-anatomy-baseline.json` line 6 and line 7: selector since 2026-11-07T00:00:00.000-08:00 and until 2026-11-07T23:59:59.999-08:00. |
| R3 | MET | `packages/app/src/services/history-anatomy.ts:715` returns operator since and until unchanged and emits no baseline pair. `packages/app/tests/services/history-anatomy-cli.test.ts:459` exited 0 this run. |
| R4 | MET | `packages/app/src/services/history-anatomy.ts:957` copies selector since and until into identity bounds. `docs/report` `2026-11-08-history-anatomy.md` line 6 names timezone America/Los_Angeles and line 8 and line 9 hold the offset bounds. |
| R5 | MET | `packages/app/src/workflow/composition-lint.ts:634` defines the undeclared-shell-var check and `packages/app/src/services/workflow-inspect-ops.ts:153` runs it during validate. `packages/app/tests/workflow/undeclared-shell-vars.test.ts:19` 8 pass, 0 fail this run. |
| R6 | MET | This run: warm current-leg analyze 0.542 s and 39601 bytes; baseline leg 0.497 s and 38204 bytes; unbounded analyze 80.194 s and 2885486 bytes. 2885486 is 72.9 times the current artifact and 75.5 times the baseline artifact. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Daily mode analyzes exactly its resolved local calendar day | MET | command | `.spur` `run/05d14930-17c2-4089-b3da-cff6b318b3c1-history-anatomy-current.json` line 6 and line 7 equal the resolved local day 2026-11-08T00:00:00.000-08:00 through 2026-11-08T23:59:59.999-08:00. `packages/app/tests/workflow/undeclared-shell-vars.test.ts:19` 8 pass, 0 fail this run, so no analyze-stage var is undeclared. |
| R2 — The baseline leg analyzes the immediately preceding local calendar day | MET | command | `.spur` `run/05d14930-17c2-4089-b3da-cff6b318b3c1-history-anatomy-baseline.json` line 6 and line 7 are the preceding local day 2026-11-07T00:00:00.000-08:00 through 2026-11-07T23:59:59.999-08:00. `docs/report` `2026-11-08-history-anatomy.md` line 17 artifactDigest 2c0b929b1a40c19d5399f9539d49639b95971b4dd8dd265bcbfe61cfa0409388 differs from line 18 baselineArtifactDigest a745d59b4c5f7eacae1f666df08ce3d85979e807190545a27f3ac0a6c09d29f5. |
| R3 — Recurrence classification produces real verdicts once both windows are bounded | MET | command | `docs/report` `2026-11-08-history-anatomy.md` line 95 comparability verdict is comparable. Line 302 states no key is not-comparable. Ledger lines 306 through 320 are regressed, recurring, or new. None is not-comparable. |
| R4 — The published report makes its audited window auditable | MET | command | `docs/report` `2026-11-08-history-anatomy.md` line 8 and line 9 hold non-empty identity bounds for 2026-11-08 with offset -08:00. Line 6 names timezone America/Los_Angeles. |
| R5 — A bounded daily run costs materially less than an unbounded one | MET | command | This run wrote /tmp/i81-bounded.json at 39601 bytes in 0.542 s and /tmp/i81-baseline.json at 38204 bytes in 0.497 s. /tmp/i81-unbounded.json is 2885486 bytes in 80.194 s. Both bounded legs are under five seconds. The bounded artifacts are more than ten times smaller than the unbounded artifact. |
| R20 — Ad-hoc mode keeps its operator-supplied bounds unchanged | MET | test | `packages/app/tests/services/history-anatomy-cli.test.ts:459` passes operator bounds through and emits no baseline pair. That file exited 0 this run, 44 pass, 0 fail, including the ad-hoc case. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Functional traceability** — all six requirements MET: R1/R2/R3 via resolvePaths bound derivation and the analyze stage sourcing those bounds; R4 via the artifact selector written into published identity bounds; R5 via collectUndeclaredShellVarViolations wired into workflow validate; R6 via the bounded-versus-unbounded measurement recorded in Solution and re-checked against the 2026-11-08 artifacts.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | Validator exempts UPPER_SNAKE identifiers (ambient/sourced-env namespace); an undeclared UPPER_SNAKE workflow var would not be flagged | DEFER: documented ceiling. Repo workflow vars are lowercase or camelCase, so this defect class stays covered. The upgrade path is parsing sourced env files. |
| P4 | Bounded-leg wall-clock measurement is startup/load sensitive (cold versus warm on a busy box) | Advisory. The acceptance bound is the warm analyze. The byte ratio is the load-independent signal. |

SECUA — no new trust boundaries. The helper emits trusted repo-glue env and the validator reads tracked YAML only. DST spring and fall unit tests cover the offset arithmetic. Zone arithmetic stays in the helper per ADR-069 R1.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-26T06:31:13.852Z todo → wip (system)
- 2026-08-26T06:37:44.499Z wip → testing (system)
- 2026-08-26T06:43:30.998Z testing → done (system)
