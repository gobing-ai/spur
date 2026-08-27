# Lifecycle Projection Integrity (task 0625)

**Area:** feature lifecycle projection convergence, corpus-aware wrap-up observation, and content
checks for task/feature projections.
**Status:** implemented 2026-08-21.
**Decisions:** ADR-050 (two-sided corpus gate) and ADR-051 amendment 2026-08-21 (explicit
`feature refresh` scope). Architecture: `03_ARCHITECTURE.md` §12.5.

## 1. Surface matrix

| Surface | Shape |
| --- | --- |
| `wrapup-pipeline.yaml` var | `featureGateCmd`, default `bun run spur-check-new`; trusted project config executed through `sh -c` |
| wrap-up `feature-transition` | Capture feature-sync output and exit code; when `.applied == true` or sync exits non-zero after a possible partial transition, run `featureGateCmd` and print PASS/FAIL before returning. A clean no-op skips the gate. Gate failure is advisory and the shell exits 0. |
| `spur feature sync [id]` | After any lifecycle hop lands, call `refresh({ featureId: id })` in `finally` before returning or rethrowing a later-hop failure. Dry-run, confirmation refusal, and no-op proposals do not refresh. |
| `spur feature refresh --feature <id>` | Regenerate the global deterministic `INDEX.md`; rewrite only the named feature's `## Tasks` marker region. |
| `spur feature refresh --all` | Regenerate `INDEX.md`; rewrite every feature's `## Tasks` marker region. |
| bare `spur feature refresh` | Refuse before calling the service; print scope guidance and exit 2. |
| `spur task check` | Add the warning `L4.testing-verdict-stub`; widen the existing `L4.anchor-subject-mismatch` check for prose-free Solution change-map rows. |
| `spur feature check` | `L4.dogfood-missing` accepts a dogfood filename only when the feature ID is a non-alphanumeric-delimited segment. |

`--feature` and `--all` are mutually exclusive write-breadth selectors. Refresh never changes
feature lifecycle status; `sync` owns status alignment.

## 2. Task projection checks

### `L4.testing-verdict-stub`

- **Severity:** warning; ratcheted in `config/corpus-baseline.json` per ADR-062/T10.
- **Trigger:** the `## Testing` body contains the record-generated table row
  `| — | — | No requirements recorded; verify verdict <token> |` (ASCII/en/em dash runs accepted).
- **Non-trigger:** prose mentioning the phrase, or a populated requirement/evidence table.
- **Repair:** re-run the verify/record hop so Testing is projected from a populated verdict artifact.

### Path-derived subject tokens

`checkLineAnchors` normally derives subject tokens from the prose in the row containing a citation,
excluding every backticked anchor in that row (so an id the row merely cites as evidence is not its
own subject). The matcher reads the cited lines plus an ±`ANCHOR_WINDOW_LINES` (20) surrounding
window — a single-line anchor inside a symbol can lexically miss the symbol's name (task 0688).
For a `Solution` row with no such tokens, it still derives them from the cited path basename
(0688 disposition: kept — prose-free rows carry zero tokens to widen):

1. remove the final extension;
2. split on `-`, `_`, and `.`;
3. keep identifier-shaped fragments of at least three characters;
4. lowercase the fragments and reuse `citedLinesNameSubject`.

A plain basename remains one token (`workflow.ts` → `workflow`); camelCase is not split
(`taskService.ts` → `taskservice`). Testing rows and Solution rows that already carry prose keep the
existing prose-token path.

## 3. Feature projection checks

For a `verifying` or `done` feature whose linked task Solutions touch self-referential workflow
infrastructure, the dogfood check scans `docs/dogfood/` with this identity shape:

```text
(^|[^A-Za-z0-9])<featureId>([^A-Za-z0-9]|$)
```

An incidental substring no longer satisfies the gate. The finding remains a warning in a normal
check and becomes blocking under the existing strict feature-done gate.

## 4. Write-scope and gate invariants

1. `syncFeature` refreshes in `finally` only after `appliedHops.length > 0`, and always passes the
   current `featureId`; it converges partial multi-hop failures and never invokes the global sweep.
2. `FeatureService.refresh({ featureId })` always regenerates the deterministic index but writes a
   feature file only when that feature's rendered marker region differs.
3. The CLI requires an explicit breadth token before calling `refresh`; `--all` is the only public
   opt-in to the all-feature roster sweep.
4. The feature-transition gate runs after an applied sync or a non-zero sync exit that may follow a
   partial transition. It does not move the corpus sweep into the per-task fast gate.
5. New or widened findings are reconciled two-sided by key and severity in the implementing change;
   historical task/feature corpus is not silently rewritten by the check implementation.

## 5. Implementation anchors

| Concern | Source |
| --- | --- |
| explicit refresh breadth | `apps/cli/src/commands/feature.ts` |
| scoped post-sync refresh | `packages/app/src/services/feature-service.ts` |
| dogfood identity match | `packages/app/src/services/feature-check.ts` |
| hollow Testing + path-token checks | `packages/app/src/services/task-check.ts` |
| finding-code registry | `packages/config/src/finding-codes.ts` |
| post-transition corpus observation | `config/workflows/wrapup-pipeline.yaml` |
