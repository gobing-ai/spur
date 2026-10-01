# E71 force-verification report

Verdict: PARTIAL
Shippable: FAIL

The frozen four tasks each retain material requirement gaps after repairs. The task-local and
feature-wide test gates pass; those gates do not establish the missing feature behavior.
The source-local shippable check reports all seven scenarios linked but unverified because
none has a covering PASS verdict.

## Scope and isolation

- Invocation: `sp-dev-verifyall --feature E71 --auto --next --force --agent inline --focus all --fix all`.
- Started: 2026-10-01T21:52:36.985Z. Outcome recorded: 2026-10-01T22:24:14Z.
- Initial root: `/Users/robin/xprojects/spur-new`, branch `main`, base
  `48edb0c99d120555829dcf7d7a5ffe7e4ac94757`; initial tree clean.
- Concurrent feature/follow-up work appeared after the first repair commit. Subsequent repairs
  and verification records use `/Users/robin/xprojects/spur-new-verify-e71`,
  branch `sp/verify-e71-20261001`, forked at `0cf5110db`.
- The frozen tasks are 1024, 1025, 1026 and 1027. Concurrent new tasks 1043/1044 were not
  absorbed into this batch. The main tree's feature reopening and follow-up task changes were preserved.
- Execution stayed inline; zero model subprocesses or subagents were dispatched.
- Evidence derives from current source, original implementation commits and tagged repair commits;
  generated plugin surfaces were rebuilt through their owner. No real project scratch was deleted.

## Per-task results

| Task | Previous status | Verification | Remaining condition |
| --- | --- | --- | --- |
| 1024 | done | PARTIAL | Exhaustive current producer/consumer ownership equality is unproved |
| 1025 | done | PARTIAL | Corpus/suppression readers and complete migration identity/ownership checks |
| 1026 | done | PARTIAL | Bound evidence, legacy reference/importer settlement, complete fail-closed export |
| 1027 | done | PARTIAL | Feature acceptance, imported-history and terminal producer disposal integration |

CLI-derived verdict artifacts were recorded through `spur task record`; durable canonical copies
also report PARTIAL with matching task identities. Residual scan/fold ran after every record:
each has zero blocking, zero deferrable, one advisory and zero housekeeping items. The residual
check passes; the requirement/AC PARTIAL rows still block completion. Fold caused no downgrade,
so no extra re-record was required.

Exact feature scenario identities were carried forward, including 1025's earlier R7 credit,
with corrected PARTIAL statuses. Record warnings about dropped MET credit are expected for
these regressions; no identity was relabeled MET to silence them.

`--next` made no transitions because no task passed. Existing terminal statuses remain
`done` in this force audit; the fresh Testing verdicts expose the gaps.

## Repairs

- **1025, `0cf5110db` (also on main):** atomically publish task verdicts and feature receipts
  to durable evidence; run migration before cleanup and fail before destructive housekeeping;
  confine migration paths and check dry-run conflicts; keep logs-only migration isolated.
- **1026, `5c2266b3`:** reuse physical confinement for retained artifacts, atomically publish
  without overwriting conflicting bytes, reject unsafe run IDs and retain optional-missing behavior.
- **1027, `81bfc6b5`:** remove the entire completed scratch directory twice, assert a nonzero
  verified-result count, and check that the next gate recreates scratch.
- **1024, `2a3e8cba`:** append the current unresolved ownership/disposal map to the historical
  [audit report](2026-09-30-E71-run-storage-ownership.md#13-force-verification-corrections-2026-10-01).
- Verification records: `586f0609` (1024), `f58d5a4d` (1025), `f02f4693` (1026),
  `74dd4909` (1027).

## Executable evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Focused evidence/receipt/path suites | 148 pass, 0 fail | Original root `.spur/run/E71-1025-focused.log` |
| CLI migration-before-cleanup regression | 14 pass, 0 fail | Original root `.spur/run/E71-cli-focused.log` |
| Installed plugin receipt/script checks | 4 pass, 0 fail | Original root `.spur/run/E71-plugin-focused.log` |
| Focused artifact/producer/export suites | 244 pass, 0 fail | Worktree `.spur/run/E71-1026-focused.log` |
| Focused disposal/workflow/quality/analytics suites | 371 pass, 0 fail | Worktree `.spur/run/E71-1027-focused.log` |
| `bun run spur-check` | PASS; 9629 tests, 0 fail; coverage/lint/types/pre/post rules pass | Worktree `.spur/run/E71-spur-check.log` |
| `bun run spur-check-feature` | PASS; 7 tests, 0 fail; contract/drift checks pass | Worktree `.spur/run/E71-feature-gate.log` |
| `bun run test-cf` | PASS; 1 test | Worktree `.spur/run/E71-test-cf.log` |
| `bun run build` | PASS | Worktree `.spur/run/E71-build.log` |
| `bun run plugin-smoke` | PASS | Worktree `.spur/run/E71-plugin-smoke.log` |
| Task checks after record | PASS for all four | Source-local CLI JSON results |
| `workflow clean --dry-run --json` | PASS; no real cleanup | Worktree `.spur/run/E71-clean-golden.json` |
| Feature shippable check | FAIL; seven `L4.scenario-unverified` findings | Worktree `.spur/run/E71-shippable-feature-check.json` |

All listed command outcomes are from this run. Source-local CLI provenance:
`bun run apps/cli/src/index.ts`, the repair checkout above. CLI link and bundle ownership were
exercised after the source change; portable TypeScript/Node surfaces were regenerated, not hand-edited.

## Remaining work and stopping condition

The [current audit map](2026-09-30-E71-run-storage-ownership.md#13-force-verification-corrections-2026-10-01) names source anchors and closure
checks. Required closure includes durable corpus/suppression discovery, family identity and live-owner
validation, durable bound-evidence inputs, legacy metadata redirection and importer obligations,
fail-closed complete worktree evidence export, and actual feature/imported-history/terminal-producer
equivalence after disposal. Existing main-tree follow-up 1043 owns the export problem.

The invoked [verification skill](/Users/robin/tools/dot_files/config/agents/skills/sp-code-verification/SKILL.md:368)
requires a bounded repair pass:

> Loop is bounded — if a fix doesn't move a requirement to MET after one retry, report the residual
> and stop (don't thrash).

The repair retry improves the storage/publication paths but does not close the listed requirements.
The batch therefore stops with PARTIAL and Shippable FAIL. The isolated branch is retained for review;
its later repairs and task records have not been merged into main.

The deterministic rollup is in `.spur/run/E71-verifyall-summary.json`:
**0 PASS, 4 PARTIAL, 0 FAIL, 0 NOT-STARTED**, `shippable: false`.
Per-task answers, derived/folded verdicts, residual artifacts and the event trace remain in the
worktree `.spur/run/`; canonical verdicts remain in `.spur/memory/evidence/`.
Failure diagnostics are also copied to the original root under
`.spur/run/E71-force-verifyall-20261001/`; that export does not mutate its task records.
