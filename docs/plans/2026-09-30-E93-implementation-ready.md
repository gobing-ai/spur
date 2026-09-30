---
kind: plan
title: E93 implementation-ready refinement
status: done
created_at: 2026-09-30
updated_at: 2026-09-30
related:
  - E93
  - docs/design/history-capability-detection.md
  - docs/plans/2026-09-30-history-capability-detection-brainstorm.md
tags: [refine, history, evidence]
---

# E93 implementation-ready refinement

Depth: **ready**. Frozen set: **1028, 1029, 1030**, refined in dependency order through the task CLI. All three specifications are implementation-ready; product acceptance remains unverified until implementation and its runnable checks pass.

| Task | Corrections | Before → after | Failed checklist IDs | Execution prerequisites |
| --- | --- | --- | --- | --- |
| 1028 | 5 | todo → todo | none | Clean isolated ts-libs checkout; upstream implementation gates |
| 1029 | 5 | todo → todo | none | 1028 done and its actual released importer package available |
| 1030 | 5 | todo → todo | none | 1028 and 1029 done; isolated database and complete fixture source populations |

## Audit and corrected contracts

The [design freeze](../design/history-capability-detection.md#8-implementation-ready-freeze-2026-09-30) fixes column/API names, source parsing boundaries, verified artifact origin input, invocation identity, result pairing, timestamp handling, counting and replay. Each task's Background records five dated corrections; Design, Plan, Acceptance Criteria and Q&A now carry their corresponding implementation instructions. Existing scenario titles and requirement bindings were preserved.

1028 owns the existing upstream importer rather than a second parser. Superskill currently supplies no universal origin-kind field, so conversion classification requires a verified supplied artifact index. Missing or conflicting historical origin remains unresolved. Failed and unconfirmed attempts cannot certify successful loads; late results pair by source/session/call identity across incremental runs.

1029 fixes the existing minute-grain materialized breakdown and its consumers. The additive `byCapability` contract separates evidence and outcomes; legacy arrays count confirmed loads. A frozen fixture must yield eight logical usages and three confirmed loads despite a duplicate representation. The current service has no separate raw capability fallback: direct SQL is the test reference, not a new runtime scan.

1030 tests existing full/incremental replay with injected fixture roots and an isolated database. Full reconciliation covers an entire source, so a partial source file list can retire unrelated same-source evidence. The task therefore requires a complete isolated source population, another-source sentinel, unchanged raw bytes, zero-write dry-run, two stable replays and a late-result incremental refresh. It adds no reset command or manual ledger deletion.

## Seven ready checks

| ID | Result and evidence |
| --- | --- |
| requirements | PASS: numbered local requirements remain bound to all nine E93 scenario titles; task and feature checks pass. |
| design | PASS: §8 freezes producer fields and input types, identity/outcome algorithms, consumer DTO/counts and replay boundaries; task Designs name their existing file targets and excluded scope. |
| plan | PASS: each Plan orders requirement-bound work, focused test homes, workspace gates and predecessor handoffs. |
| ac | PASS: original scenario titles remain intact; executable verification lenses name source fixtures, SQL/count oracles and replay observations. |
| decisions | PASS: Q&A closes origin input, timestamp/status/count semantics, consumer transport and replay safety decisions. No implementation choice is deferred as discovery. |
| dependencies | PASS: existing predecessor IDs resolve and remain ordered 1028 → 1029 → 1030; real package release is an execution condition. Other worktree changes require isolation before implementation. |
| premises | PASS: producer dispatch and Codex parsing verified at `node_modules/@gobing-ai/ts-llm-jsonl-importer/src/mappers.ts:121` and `:253`; consumer counts at `packages/domain/src/analytics/history-board-rollup.ts:268`; import entry at `packages/app/src/services/history-service.ts:339`; schema ownership at `docs/00_ADR.md:1538`. Upstream checkout and Superskill adapter/manifest sources were inspected directly; their facts are recorded in §8. |

## Deterministic evidence and limits

`task check <wbs> --as todo --json` passes for all three. Only expected predecessor-not-done warnings remain on 1029/1030. `feature check E93` with the original inventory passes and finds all nine scenarios linked; it correctly warns that they are not yet verified by implementation verdicts. Run-scoped ready evidence binds current task planning digests and the seven checklist rows, and the idea handoff is refreshed against those contents.

This receipt covers specification readiness. It does not claim implementation, product test success, upstream release or safe execution against a live history database. Implement in dependency order using the task pipeline and the frozen design.

The recommended pre-check rule gate passes all 50 rules with zero findings. Focused `git diff --check` also passes. Machine-readable checklist rows, current planning digests and correction counts are retained in `.spur/run/refine-E93-20260930-report.json`.
