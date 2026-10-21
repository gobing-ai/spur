# Post-G11 source audit — 2026-10-21

Companion to [the full feature audit](2026-10-21-feature-legacy-audit.md). Review covered the application/domain/config layers, CLI/server/contracts, Board inbox and composer, plugin guest integration, workflow projection/execution/following, HTTP error handling, and test subprocess lifecycle. Confirmed findings were reproduced and repaired through tasks 1271 and 1272. Feature deprecation remains a separate operator decision.

## Task 1271 — inbox and integration correctness

| Finding | Repair and regression evidence |
| --- | --- |
| Shared asynchronous database transaction could roll back unrelated successful writes | Optional public synchronous ts-db transaction capability; native Bun transaction, thenable rejection and expired-handle protection. Domain isolation/rollback regressions. |
| Expired claim could settle or release another worker's reclaimed message | Exact `{id,attempts}` ownership propagated through DAO, coordinator, loop, guest and CLI; stale-owner regressions. |
| Claim result ordering depended on SQLite RETURNING order | Explicit creation-order sort with rowid tie-breaker; FIFO regression. |
| Idempotency replay ignored task/parent-run identity | Full metadata comparison, including unique-constraint race recovery; conflict regressions. |
| Guest hook rejected current JSON and repeated queued work | Bounded authorized claim/output/settle handoff, release on output failure, compatible JSON shapes and complete multiline content. Executable join/send/wait/reply/second-wait probe passed. |
| Composer inferred missing chat/direct receipts and stale run status | Exact any-kind receipt lookup, authoritative send receipt, run-status projection, active polling and concrete member addressing; server/web regressions. |
| Late responses crossed project/member selection boundaries | Generation-fenced pagination, sends, read state and draft clearing; A-to-B-to-A and equal-revision tests. |
| Inbox omitted fleet members with no messages and retained stale older status | Merge declared members and refresh through loaded history; selection/paging regressions. |
| Legacy feature/status aliases bypassed task filters, server projection and readiness digest | Shared canonical read projection retaining raw frontmatter; query/digest/server regressions. |
| Task scenario validation assumed sibling feature directories | Existing configured directory resolver used by validation; nonsibling-directory regression. |
| Removed accepted-baseline policy retained suppression code | Delete unused accepted-map option/filter and helper; retain strict/severity behavior and observed finding identity tests. |

Independent reviews traced sibling consumers and produced follow-up fixes for project-change send completion, draft identity, full guest instruction bodies and exact non-orchestrator request classification. Focused suites, workspace typechecks and script contract checks passed before integration. The task pipeline owns the final gate and certified requirement/acceptance evidence.

The dependency patch includes source, runtime distribution and declarations and is registered in the lockfile. It remains pinned to ts-db 0.5.32 until an upstream release provides the facade. Unsupported adapters reject inbox mutations explicitly. No upstream package was published.

## Task 1272 — workflow and process lifecycle

The independent review reproduced unbounded watchdog shutdown, first-attempt workflow status surviving a successful retry, hidden same-kind durable action rows, credential-bearing HTTP exception text, Windows launch argument loss, and follow timer/listener leakage. These findings and their regressions belong to task 1272; its final implementation and verification are recorded separately after task 1271 closes. Workflow cancellation's existing structured JSON success behavior was confirmed intentional and preserved.

## Limits

This is a broad source audit with executable regressions for confirmed findings, not a proof that every possible defect is absent. Historical feature evidence gaps remain in the feature report and were not waived. Native Windows execution, real browser interaction and live coding-agent runs require platform/runtime coverage beyond the isolated tests and CLI probes used here.
