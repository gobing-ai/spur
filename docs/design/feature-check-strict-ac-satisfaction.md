# Feature check `--strict`: AC satisfaction (tasks 0340, 0410)

**Status:** implemented  
**Date:** 2026-07-26  
**Updated:** 2026-08-01 (task 0410)
**Authority:** design satellite for tasks 0340 and 0410 (constitution: surface/design decisions live under `docs/design/`; process remains in `docs/99`)

## Decision

`spur feature check <id> --strict` asserts **AC satisfaction** in addition to **AC linkage** (DD-09). The two are independent dimensions.

| Dimension | Question | Owner |
| --- | --- | --- |
| Linkage (DD-09) | Is every feature AC scenario covered by at least one linked task? | Existing `L4.uncovered-feature-scenario` |
| Satisfaction (0340) | Is every *linked* scenario verified by a covering task? | New `L4.scenario-unverified` |

## Evidence source

Per-task verdict artifacts at `.spur/run/<wbs>-verdict.json` (the same artifacts `spur task verdict` / the done-transition guard use).

Canonical producers write `{ id, status }` rows in `requirements[]` and optional
`acceptanceCriteria[]`. Feature-check also accepts `{ scenario, status }` as compatibility input and
normalizes it to `id`. When both keys are present, equal string values are accepted with `id`
authoritative; differing or non-string values reject the row.

A scenario is **linked-and-verified** when **any** covering task is `done`, its artifact has
`verdict: PASS`, and either coverage array contains a matching `MET` row. Matching remains exact
after normalized scenario-title handling and the `AC-N` ordinal alias (1-based).

Missing/unreadable artifacts, malformed JSON or non-object roots, a missing required
`requirements` array, non-array coverage fields, and rejected rows emit one bounded
`L4.malformed-verdict-artifact` finding per task/artifact. The finding names the task WBS, artifact
path, failure mode, rejected-row count, and deduplicated invalid fields. Valid empty arrays and valid
unmatched rows are not malformed.

## Three states (per scenario)

1. **linked-and-verified** — no finding  
2. **linked-but-unverified** — covering task exists but is not done, or done with missing/PARTIAL/FAIL verdict, or matching requirement not MET  
3. **orphaned** — no covering task (existing DD-09 path only; never emits `L4.scenario-unverified`)

## Failure semantics

| Finding | Default | `--strict` |
| --- | --- | --- |
| `L4.scenario-unverified` | `warning`; `pass` stays `true` | Elevated to `error`; `pass` becomes `false` |
| `L4.malformed-verdict-artifact` | `warning`; rows are not silently dropped | Elevated to `error`; `pass` becomes `false` |

Orphan findings keep their existing warning severity in both modes.

## Non-goals

- Changing non-strict check behavior beyond additive warnings  
- Blocking feature transitions without operator opt-in (`--strict`)  
- Replacing DD-09 linkage checks  

## Implementation map

- `packages/app/src/services/feature-check.ts` — `checkScenarioSatisfaction` / `isScenarioVerified` / `readVerdictArtifact`  
- `packages/config/src/finding-codes.ts` — `L4.scenario-unverified`, `L4.malformed-verdict-artifact`
- Tests: `packages/app/tests/services/feature-check.test.ts` (`0340 …` and `0410 …` cases)
