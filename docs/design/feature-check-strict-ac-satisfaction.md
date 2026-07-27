# Feature check `--strict`: AC satisfaction (task 0340)

**Status:** implemented  
**Date:** 2026-07-26  
**Authority:** design satellite for task 0340 R1 (constitution: surface/design decisions live under `docs/design/`; process remains in `docs/99`)

## Decision

`spur feature check <id> --strict` asserts **AC satisfaction** in addition to **AC linkage** (DD-09). The two are independent dimensions.

| Dimension | Question | Owner |
| --- | --- | --- |
| Linkage (DD-09) | Is every feature AC scenario covered by at least one linked task? | Existing `L4.uncovered-feature-scenario` |
| Satisfaction (0340) | Is every *linked* scenario verified by a covering task? | New `L4.scenario-unverified` |

## Evidence source

Per-task verdict artifacts at `.spur/run/<wbs>-verdict.json` (the same artifacts `spur task verdict` / the done-transition guard use). No new artifact format.

A scenario is **linked-and-verified** when **any** covering task is `done` **and** its verdict has `verdict: PASS` **and** a matching `requirements[]` row with `status: MET`. Matching uses normalized scenario title **or** `AC-N` ordinal alias (1-based).

## Three states (per scenario)

1. **linked-and-verified** — no finding  
2. **linked-but-unverified** — covering task exists but is not done, or done with missing/PARTIAL/FAIL verdict, or matching requirement not MET  
3. **orphaned** — no covering task (existing DD-09 path only; never emits `L4.scenario-unverified`)

## Failure semantics

| Mode | Unverified finding severity | Effect on `pass` |
| --- | --- | --- |
| Default (non-strict) | `warning` | `pass` stays `true` (R6) |
| `--strict` | `error` (via existing severity elevation) | `pass` becomes `false` when any linked-but-unverified exists (R4) |

Orphan findings keep their existing warning severity in both modes.

## Non-goals

- Changing non-strict check behavior beyond additive warnings  
- Blocking feature transitions without operator opt-in (`--strict`)  
- Replacing DD-09 linkage checks  

## Implementation map

- `packages/app/src/services/feature-check.ts` — `checkScenarioSatisfaction` / `isScenarioVerified` / `readVerdictArtifact`  
- `packages/config/src/finding-codes.ts` — `L4.scenario-unverified`  
- Tests: `packages/app/tests/services/feature-check.test.ts` (`0340 …` cases)
