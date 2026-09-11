---
schema_version: 1
name: Step profiles give spur-doctor per-node duration, idle-gap and cache evidence
status: todo
template: feature-impl
created_at: 2026-09-10T23:51:14.075Z
updated_at: "2026-09-11T15:56:10.898Z"
feature_id: I21
priority: P2
tags:
  - plugin
  - skills
  - workflow

ac_numbering: task-local
dependencies: ["0820", "0822"]
---

## 0827. Step profiles give spur-doctor per-node duration, idle-gap and cache evidence

### Background

ADR-115 sets step boundaries by the provider cache window, not the clock: a cache expires after an idle gap and refreshes on every hit.

Trace already records each action event's:
- `node`, `actionKind` and `durationMs`;
- `startedAt` and `completedAt`;
- `invocation`, including `continue`;
- `cost.exact` and `cost.estimated`, each `{totals, cacheHit, estimated}` or null.

Nothing aggregates this per node.

Evidence from 2026-09-11, over the last 60 done runs (12 of them non-dry):
- 15 `agent.run` actions, none of them resumed (`invocation.continue: true`);
- 9 with `cost.exact`;
- 6 with a numeric `cacheHit`.

`idea-pipeline`'s max-sane wall-clock is 8.8 h (`config/pipeline-budgets.json`, n=37), mostly HITL waits. A step that resumed a session after such a wait would start with an expired cache.

Implements:
- R24 — spur-doctor judges workflows by composition findings and step profiles

Ordering: after 0820 (spur-doctor exists) and 0822 (findings carry `level`).

### Requirements

- [ ] R1. The plugin script `plugins/sp/scripts/workflow-step-profile.ts` ships with its `.mjs` twin and a `config/plugin-scripts.json` entry (ADR-065). It reads `spur workflow trace --json` for a workflow's last N completed, non-dry runs. Per node and action kind it reports:
  - the number of runs and executions;
  - the p50 and max `durationMs`;
  - the p50 idle gap before the step;
  - the session mode (`fresh`, `resumed` or `mixed`, from `invocation.continue`);
  - the `cacheHit` p50 with its coverage.

  A missing value is unknown (`null`), never zero, in every aggregate. The script flags each satellite §10 cache-window budget against W, which defaults to 300 s. spur-doctor names the profile and `spur workflow validate --json` as workflow evidence. It maps each composition finding (by `level`) and each flag to a workflow-optimization proposal whose change comes from the §10 table.

Non-goals:
- A public `spur workflow trace --profile` flag, or any change to trace or validate output.
- `cost.estimated`. It comes from retroactive mappings and never mixes with exact evidence.
- Writes. The script and doctor stay read-only; composer applies accepted proposals (0820).
- Grouping by `state:index`. Trace action events carry a UUID `actionId`, not the action index.

### Acceptance Criteria

```gherkin
Feature: Step profiles give spur-doctor per-node duration, idle-gap and cache evidence

  Scenario: R1 — spur-doctor judges workflows by composition findings and step profiles
    Given completed runs of a workflow and its `spur workflow validate --json` output
    When spur-doctor evaluates the workflow
    Then the step profile reports per node the run count, p50 and max duration, p50 idle gap, session mode and cacheHit p50 with coverage
    And cache evidence is unknown, not zero, when the executor reports no usage
    And each composition finding and each flagged cache-window budget becomes a workflow-optimization proposal
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T15:56:10.897Z

Refined at depth=ready (refineall I21, 2026-09-11). Closed decisions:
- **Consent granted 2026-09-10** (governance §4) for the new plugin script. No public verb or flag.
- **The evidence claim is softened.**
  - The earlier Background claimed that four idea-pipeline steps resumed their session after waits of up to 8.3 h. The trace does not support this: on 2026-09-11, the last 60 done runs (12 non-dry) held 15 `agent.run` actions, none with `invocation.continue: true`.
  - The recorded fact is idea-pipeline's max-sane wall-clock of 8.8 h (n=37).
  - The profile exists to catch resumed-after-idle steps, not because one was observed.
- **Session comes from `invocation.continue`**, not from the YAML `freshSession`, because trace records what actually ran.
- **Cache evidence is sparse.** 9 of those 15 actions carry `cost.exact`, and 6 have a numeric `cacheHit`; `cacheHitRatio` (`packages/domain/src/analytics/costs.ts:26`) returns null when no record carries usage or input tokens are 0. Every `cacheHit` figure therefore carries its coverage, and unknown never becomes 0.
- **The script computes the flags.** Thresholds are arithmetic over the profile; doctor maps flag ids to proposals and never re-derives numbers from prose.
- **Rows group by node and action kind**, the R1 grain. Trace action ids are UUIDs, so `state:index` cannot be recovered reliably.
- **p50 is the nearest-rank median**, so every reported value was observed.
- **Flags still exit 0.** The profile is evidence, not a gate. Only a failed or unparsable `spur` call, or a missing workflow argument, exits 1.

### Design

**Approach.** The profile is a plugin script, not a public flag. Doctor runs on agent machines that have only the plugin, and the profile composes an existing `--json` surface (governance §2).

**Files.**
- `plugins/sp/scripts/workflow-step-profile.ts` and its generated `workflow-step-profile.mjs`.
- `config/plugin-scripts.json`: `{ "rel": "workflow-step-profile.ts", "contract": "standard", "twin": "workflow-step-profile.mjs" }`.
- `package.json` `build:scripts`: append `&& superskill script convert sp workflow-step-profile.ts`.
- `plugins/sp/tests/workflow-step-profile.test.ts`.
- `plugins/sp/skills/spur-doctor/SKILL.md` (created by 0820): the evidence row and the flag table.
- `plugins/sp/tests/skill-structure.test.ts`: the doctor assertions.
- `plugins/sp/README.md`: a script row next to `scripts/batch-preflight.ts` (:490).
- `docs/design/spur-artifact-evolution.md` §10: flag ids in the table's Flag column. Nothing else changes.

**CLI.** `workflow-step-profile <workflow> [--last <N>] [--window <sec>] [--json] [--spur-bin <cmd>]`.
- Defaults: N = 20, window = 300.
- `--help` prints usage and exits 0.
- CLI resolution: copy `defaultSpurBin()` and `runSpurJson()` from `feature-sync-bounded.ts:252-293`. The chain is `--spur-bin`, then `SPUR_BIN`, then the monorepo-local entry, then `spur` on PATH. Twins are self-contained, and no plugin script imports another.

**Inputs.**
1. `spur workflow trace --workflow <w> --status done --last <N> --json` returns `{entries: [{runId, isDryRun, …}], total}`. Drop entries with `isDryRun: true`.
2. For each run, `spur workflow trace <runId> --json` returns `{run, events}`. Keep the events with `kind === 'action'`, sorted by `startedAt`.

**Per execution.**
- Duration: `durationMs` as recorded.
- Idle gap: `startedAt` minus the previous action's `completedAt` in the same run. The first action of a run has none.
- Session (`agent.run` only): `invocation.continue === true` is resumed, `false` is fresh, and a missing value is unknown. Current writers always record the boolean (`agent-service.ts:1245`); only older events lack it.
- `cacheHit`: `cost.exact.cacheHit` when it is a number, otherwise unknown. `cost.estimated` is ignored.

**Per row** (node, actionKind):
- `runs` (distinct runs) and `executions`;
- `durationMs: {p50, max}`;
- `idleGapMs: {p50}`, which is null when no execution has a previous action;
- `session`: `fresh`, `resumed` or `mixed` over the known executions. It is null for non-`agent.run` kinds, or when every execution is unknown.
- `cacheHit: {p50, known, of}`: `known` counts numeric values, `of` = `executions`, and `p50` is null when `known` = 0;
- `flags: string[]`.

p50 is the nearest-rank median, `sorted[Math.ceil(n / 2) - 1]`, so every reported value was observed.

**Flags.** W is in seconds; durations are compared as `ms > W * 1000`.

| Flag id | Condition | §10 row |
| --- | --- | --- |
| `step-over-window` | kind is not `agent.run` and `durationMs.p50 > W` | Deterministic step, p50 > W |
| `resume-after-idle` | `agent.run`, session `resumed` or `mixed`, `idleGapMs.p50 > W` | Resumed `agent.run`, idle gap > W |
| `resume-cold-cache` | `agent.run`, session `resumed` or `mixed`, `cacheHit.known > 0` and `cacheHit.p50 < 0.5` | Resumed `agent.run`, `cacheHit` p50 < 0.5 |
| `agent-run-over-2w` | `agent.run` and `durationMs.p50 > 2W` | `agent.run`, p50 > 2W |

**Output.**
- `--json`: `{ workflow, windowSec, sampledRuns, rows }`, with rows sorted by `node`, then `actionKind`.
- Human mode: one line per row with node, kind, runs/executions, p50, max, idle p50, session, cacheHit `p50 (known/of)` and flags. Seconds carry one decimal; `?` marks an unknown value.
- Exit 0 whenever a profile is produced, including `sampledRuns: 0` and flagged rows. Exit 1, with a stderr message, when a `spur` call fails, its JSON does not parse or the workflow argument is missing.

**Doctor (`sp:spur-doctor`).**
- The workflow evidence row names two commands:
  - `spur workflow validate --json` (findings by `level`);
  - `node "$(superskill script path sp workflow-step-profile.mjs)" <workflow> --json`.
- The workflow flag table carries the §10 rows, each with its flag id and proposed change, including the two validate-finding rows by `level`.
- Each finding and each flag becomes one proposal row with action class *workflow optimization*. A proposal that changes a shared workflow goes through the §7 shared step and its recorded consent.
- A row with `cacheHit.known = 0` raises no cache flag. Doctor reports its cache evidence as unknown, never as a zero hit rate.

**Tests** (`plugins/sp/tests/workflow-step-profile.test.ts`) use inline fixtures in the live trace shape.
- Runs and executions, p50 and max, across three runs, with one node executed twice in a run.
- The idle gap is taken from the previous action's `completedAt`; the first action has none.
- Session is `fresh`, `resumed` or `mixed`, and null for a shell step.
- A node with `cost.exact: null` gives `{p50: null, known: 0}`. Mixed known and unknown values give `known < of`. `cost.estimated` is ignored.
- Each flag fires just above its threshold and not at it, and `--window` moves the threshold.
- Dry runs are dropped.
- `main` runs end to end with `--spur-bin` pointing at a stub that prints canned list and per-run JSON: the `--json` output parses. A failing stub exits 1.

`skill-structure.test.ts`: doctor names `workflow-step-profile.mjs`, `workflow validate --json`, the four flag ids and `300`.

**Invariants.**
- Read-only: there are no trace writes, and doctor still writes nothing.
- Unknown stays distinct from zero.
- No public verb or flag is added, and trace output is unchanged.

**Rejected.**
- `spur workflow trace --profile`. A public flag needs consent and ties an analysis view to the trace verb; revisit if a second consumer appears.
- Session mode from the YAML `freshSession`. Trace records what actually ran.
- Grouping by `state:index` inferred from event order. Skipped actions would shift the index.
- Mixing `cost.estimated` into `cacheHit`.

### Plan

1. Tests first (R1). Write `plugins/sp/tests/workflow-step-profile.test.ts` with inline fixtures in the live trace shape, per the Design's test list, and watch it fail.
2. Script (R1).
   - Implement `plugins/sp/scripts/workflow-step-profile.ts`, register it in `config/plugin-scripts.json`, append it to `build:scripts`, then run `bun run build:scripts`.
   - Run `bun test plugins/sp/tests/workflow-step-profile.test.ts` and `bun run script-contract-check`.
3. Doctor (R1).
   - Add the evidence row and the flag table to `plugins/sp/skills/spur-doctor/SKILL.md`, the doctor assertions to `skill-structure.test.ts`, the README row and the §10 flag ids.
   - Run `bun test plugins/sp/tests/skill-structure.test.ts` and `superskill skill validate` on spur-doctor.
4. Smoke (R1): `node plugins/sp/scripts/workflow-step-profile.mjs idea-pipeline --json` on local history exits 0, prints rows and reports a missing `cacheHit` as null.
5. Verify: `bun run build:scripts` leaves no further diff; then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
