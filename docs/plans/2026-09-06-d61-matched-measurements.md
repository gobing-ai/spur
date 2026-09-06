# D61 matched-input reconstruction — 2026-09-06

Historical source: `f85094a7f16e24a9ac9b5a36b1a76b1525b2d5e5` (operator-selected original ADR-108 revision).
After source: current working tree; per-definition digests are in
`.spur/run/d61-matched-measurements.json`. Binary: `bun run apps/cli/src/index.ts`; Bun 1.3.14.

Task 0772 Design permits isolated replay when an original comparison is missing. This supplies that
fallback, not recovery of the deleted worktree's logs. Replay: `.spur/run/d61-measure.ts`.

## Matched execution boundaries

Historical/current task-pipeline gate shells executed against the identical 200-line deterministic
payload and proof digest in fresh fixture directories. Each asserts the actual gate status and all
200 log lines. Success and failure branches are compared separately.

| Branch | Before / after stdout bytes | Before / after elapsed ms | Gate calls | Durable log bytes |
| --- | --- | --- | --- | --- |
| PASS | 6090 / 80 | 22.19 / 22.12 | 1 / 1 | 6127 / 6127 |
| FAIL | 6090 / 1324 | 21.84 / 22.57 | 1 / 1 | 6127 / 6127 |

The measured saving is console output, not gate invocations. Timing differences are single-sample
noise, not a speedup claim. These are executed shell actions with fixture gate commands, not whole
model-bearing pipeline runs.

## Eleven-definition projection compatibility

The same current source-local CLI loaded each historical/current YAML pair and returned valid plans.
Each sample invokes one CLI process and zero models. These are projection measurements, not predicted
execution counts or terminal runs; no dry-run outcome receives execution credit.

| Definition | Before / after elapsed ms | Before / after stdout bytes | Verified projection outcome |
| --- | --- | --- | --- |
| basic | 272.08 / 226.37 | 1663 / 1662 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| docs-pipeline | 209.20 / 210.35 | 3481 / 4269 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| feature-dev | 201.10 / 197.82 | 3974 / 4175 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| feature-lifecycle | 199.32 / 190.88 | 1765 / 1764 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| history-anatomy | 199.82 / 215.52 | 7344 / 7569 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| idea-pipeline | 210.56 / 208.45 | 11174 / 11461 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| pr-review | 220.25 / 193.68 | 3974 / 4197 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| task-lifecycle | 287.19 / 218.47 | 1928 / 1927 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| task-pipeline | 203.19 / 210.52 | 7351 / 7350 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| wayfinder-resolution | 214.44 / 223.60 | 2811 / 3382 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |
| wrapup-pipeline | 213.43 / 218.88 | 3856 / 5450 | VALID_DECLARED_PLAN / VALID_DECLARED_PLAN |

Version/description additions can increase JSON size; that remains visible. The machine artifact
records historical/current digests, input hashes, exact commands, exit status, stderr bytes and
invocation counts.

## Limits

- Real terminal model-bearing runs measured: **0**; D9 fast-mode eligibility is unchanged.
- Tokens/cost: **null / unmeasured** throughout, not zero or an inferred percentage.
- Projection timings isolate definition changes using the current CLI, not old/new binary speed.
- Original workload measurements remain unavailable. This is the explicitly allowed reconstruction;
  no completed task was reopened to manufacture runs.
- Final code, bundle, task and feature gates are separate evidence; fixtures do not replace them.
