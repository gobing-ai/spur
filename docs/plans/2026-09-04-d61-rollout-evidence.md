# D61 rollout evidence — task 0772 (2026-09-06)

## Correction — 2026-09-06 reconstruction

Original gitignored captures referenced below were not recoverable after the batch worktree was
removed. [Matched-input reconstruction](2026-09-06-d61-matched-measurements.md) supplies the isolated
replay allowed by task 0772 Design. It separates executed gate-shell fixtures from plan projections
and credits neither as real model-bearing terminal runs. Claims below are preserved as history,
not presented as fresh measurements.

Aggregate rollout evidence for feature D61 ("Essential workflow checks and observable
execution"), package P8, per task 0772 R3. Per-task matched before/after captures live under
`.spur/run/d61-<wbs>-{before,after}.json` in worktree
`/Users/robin/xprojects/spur-new-runall-d61-8229` (branch `sp/runall-d61-8229`); this report
commits the aggregate.

## Method and honesty rules

- Savings are compared **only between successful outcomes with matched inputs**; failure branches
  are compared separately. Fixture/worktree reproductions are labeled and never counted as real
  terminal pipeline outcomes.
- Token and cost figures are **null everywhere**: the source-local CLI runs carry no token/cost
  accounting. No percentage savings claim is made.
- The historical 39.586-second corpus sample is context, not a statistically supported claim.
- Static/structural pins and dry validations are labeled `static` and excluded from real-run
  coverage.

## Per-task matrix

| Task | Owned workflows | Definition digest before → after | Verified outcome | Measured (real runs) | Static evidence |
| --- | --- | --- | --- | --- | --- |
| 0765 | task-check precheck | — | gate exit 0 at record | — | proof chain pins |
| 0766/0773/0774/0775 | corpus audits | — | corpus: 0 new errors, 76 new warnings classified class-b/c; no repairs needed | corpus-check real run: exit 0, 32.6 s, 15,976 B stdout (`.spur/run/d61-0773-after.json`) | 299-key baseline classification |
| 0767 | composition entrypoint retirement | budgets/corpus digests unchanged across capture | entrypoint check deleted; baseline JSON gone | — | structural pins |
| 0768 | plan/version identity | — | workflow suite green | — | static |
| 0769 | proportional routing | — | route table + diagnostics | — | static |
| 0770 | wrapup-pipeline, feature-dev, task/feature-lifecycle | wrapup `0d1fab0c…`→`f85c1be9…`, feature-dev `4c847b0c…`→`31eb8d55…`, task-lc `b0c3244f…`→`d9b088e2…`, feature-lc `25c3841d…`→`bb670c71…` | workflow suite 625 pass / 0 fail in 5.73 s (post-change); full gate 7420 pass / 0 fail, 114.3 s | gate re-measured on post-change tree; **pre-change suite re-measure unavailable** (post-change tree required for new pins) — recorded null, not a claim | 20 new behavior pins |
| 0771 | basic, history-anatomy, pr-review | basic `302e2bff…`→`283c0d45…`, history-anatomy `b081934d…`→`ec6e6e7f…`, pr-review `8da5bf68…`→`30924ed1…` | full gate 7373 pass / 0 fail, rc=0; plugin suite 1267 pass | — | head-pinned collect guards |
| 0772 | task-pipeline | task-pipeline `e5e1e86a…` (unversioned) → versioned, bounded gate output | resilience suite 11 pass (incl. 0772 pin); proof-chain suite 70 pass; bundle parity 11/11 byte-identical | — | bounded-summary behavior pin |

## Bundle migration (0772 R2)

- All eleven canonical definitions (basic, docs-pipeline, feature-dev, feature-lifecycle,
  history-anatomy, idea-pipeline, pr-review, task-lifecycle, task-pipeline, wayfinder-resolution,
  wrapup-pipeline) carry a quoted `version: "1"`.
- Rebuilt via `bun run --filter @gobing-ai/spur build:bundle`; `config/workflows/` vs
  `apps/cli/config/workflows/` byte-identical for all 11; bundled workflows dir contains exactly
  11 files — no retired corpus-baseline/composition-baseline asset remains.
- Unversioned external definitions remain supported (`apps/cli/tests/commands/workflow-version.test.ts`,
  6 pass; workflow command suite 125 pass). Generated output is gitignored; `verify-pack` and
  `bundle-config` root tests pass (6).
- Canonical skill/template/docs surfaces updated in the same change: `docs/04_DESIGN.md`
  (bounded gate output), `docs/design/essential-workflow-checks.md` (implemented note).

## Task-pipeline proof floor (0772 R1 — unchanged)

Proof-input-fingerprint owner, task-spec inclusion, immutable captured digest across review and
verify, fresh read-only verifier, PASS + MET-row matching, runId/definitionDigest binding, and
current tree/spec equality at record/done are untouched. Adverse paths (failed gate, fix
exhaustion, stale/missing/non-PASS verdict, changed task spec or tree, run/definition mismatch)
deny done and route to `failed` — verified by
`packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` (70 tests across the four target
files). Fast mode stays dormant: `mode: ""` retained; no first-party production `mode=fast`
caller; D9's ≥5 real terminal runs and ≥80% mapped coverage per workflow remain the activation
condition and were not manufactured.

## Limitations

- No token/cost accounting exists for any measured run; all such fields are null with reason
  recorded in the fixtures.
- 0770/0772 "behavior measurements" are test-suite executions (green/red evidence), not terminal
  pipeline runs; real terminal-run counts are unchanged by D61 and D9 coverage thresholds are
  therefore not met — fast activation stays a separate operator decision.
- Elapsed-time comparisons across tasks use different suites and trees; they are recorded per
  fixture with provenance (source commit, CLI importer, command, exit code, output bytes) and are
  not aggregated into a single savings number.

## Final verification (this change)

- `bun run spur-check`: see `.spur/run/d61-0772-after.json` gate block (exit 0 recorded).
- `bun run test-cf`: pass (Cloudflare worker suite).
- Focused suites: task-pipeline-proof-chain / proportional-routing / proof-input-fingerprint /
  done-transition-guard (70 pass), task-pipeline-resilience (11 pass incl. the 0772 bounded-summary
  pin), bundle-config + verify-pack (6 pass), workflow-version (6 pass), workflow commands (125 pass).
