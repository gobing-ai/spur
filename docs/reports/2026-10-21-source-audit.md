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

Independent reviews traced sibling consumers and produced follow-up fixes for project-change send completion, draft identity, full guest instruction bodies and exact non-orchestrator request classification. Focused suites, workspace typechecks and script contract checks passed before integration. The integrated task gate passed: **11,557 tests, zero failures, 43,708 assertions across 742 files**, plus lint, all workspace typechecks and pre/post rules. All nine requirements and nine acceptance criteria are certified MET; residual blocking findings are zero. A review-table authoring error stopped the original pipeline close; the table/citation was corrected and normal guarded standalone recording completed without a waiver.

The dependency patch includes source, runtime distribution and declarations and is registered in the lockfile. It remains pinned to ts-db 0.5.32 until an upstream release provides the facade. Unsupported adapters reject inbox mutations explicitly. No upstream package was published.

## Task 1272 — workflow and process lifecycle

The independent review reproduced unbounded watchdog shutdown, first-attempt workflow status surviving a successful retry, hidden same-kind durable action rows, credential-bearing HTTP exception text, Windows launch argument loss, and follow timer/listener leakage. The fixes and regressions are integrated through task 1272:

| Finding | Repair |
| --- | --- |
| TERM-resistant suite blocked its watchdog indefinitely | Independent one-second TERM-to-KILL escalation, owned process-group reaping; bounded Windows taskkill with owned-handle fallback. |
| Successful retry retained its first failure as current status | Latest recorded attempt supplies current status; every attempt remains visible. |
| Ambiguous same-kind action rows disappeared | Diagnostics name every candidate durable action row ID without inventing a mapping. |
| HTTP exception exposed requested URL or header credentials | Existing URL sanitizer plus longest-first individual header-value redaction, including overlapping values. |
| Async Windows worker argv lost bytes, including source paths with spaces | Existing resolveSpurArgv at both callers; data-only PowerShell Start-Process handoff and standard Windows argument escaping. |
| Progress follow leaked resources and could not promptly abort a long poll | Finally cleanup for deadline/listener and abortable shared polling sleep; preserve configurable cadence. |

Focused app/CLI/watchdog regressions and typechecks passed in the isolated implementation tree; the integrated task gate is the final authority. Workflow cancellation's existing structured JSON success behavior was confirmed intentional and preserved.

## Unsuppressed corpus audit

The required `bun run corpus-check` completed with **463 errors and 299 warnings, no suppressions**, in the isolated audit checkout. This includes unrecoverable historical verdict evidence, scenario-row identity mismatch, missing dogfood artifacts and other corpus diagnostics. Gitignored historical receipts are absent in this checkout; these counts are distinct from the original feature-check baseline in the companion report. The corpus audit is **not green**, and no legacy evidence was fabricated or waived.

## Limits

This is a broad source audit with executable regressions for confirmed findings, not a proof that every possible defect is absent. Historical feature evidence gaps remain in the feature report and were not waived. Native Windows execution, real browser interaction and live coding-agent runs require platform/runtime coverage beyond the isolated tests and CLI probes used here.
