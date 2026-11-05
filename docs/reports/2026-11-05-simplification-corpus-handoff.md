---
title: Approved simplification program corpus handoff
status: planned
created_at: 2026-11-05
updated_at: 2026-11-05
related:
  - docs/plans/2026-11-05-simplification-and-product-enhancement.md
  - docs/reports/2026-11-05-codebase-review.md
  - docs/reports/2026-11-05-simplification-corpus-receipt.json
tags: [evidence, planning, workflow]
---

# Approved simplification program corpus handoff

The later [implementation-ready audit](2026-11-05-implementation-ready-audit.md) supersedes this
initial scheduling snapshot: 21 tasks are todo and two remain blocked on fixture evidence. The
original conversion receipt and tables below are preserved as dated evidence.

## 1. Result and authorization

Converted the approved plan into four new child features, eleven existing feature updates and
twenty-three implementation/evidence tasks (1294–1316). Eighteen are todo; five are explicitly
blocked on measurement/decision conditions. No implementation pipeline was started in this conversion.

Authorization: Robin's 2026-11-05 approval of the simplification plan, request to convert it into
feature updates/new features and implementation tasks, and continuation of the same work. Feature
scope and task creation are authorized; deployment, public-verb changes, dependencies and guard
weakening are not implied. No new top-level feature or hierarchy migration was necessary.

Sources: [approved plan](../plans/2026-11-05-simplification-and-product-enhancement.md),
[code review](2026-11-05-codebase-review.md), [machine receipt](2026-11-05-simplification-corpus-receipt.json).
This is a dated planning snapshot. The [generated feature index](../features/INDEX.md) and task
records remain current-status authorities; the receipt is not an implementation PASS certificate.

## 2. Feature placement and scope

| Feature | Operation | Outcome owner | Tasks |
| --- | --- | --- | --- |
| [F22](../features/F22_complete-planning-corpus-reads-with-explicit-diagnostics.md) | created | Complete planning corpus reads with explicit diagnostics | 1296, 1297 |
| [F73](../features/F73_planning-board-query-convergence-and-actionable-daily-readiness.md) | created | Planning Board query convergence and actionable daily readiness | 1300, 1301, 1302 |
| [E94](../features/E94_measured-history-query-simplification-with-preserved-analytics-semantics.md) | created | Measured history query simplification with preserved analytics semantics | 1309, 1310 |
| [A34](../features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md) | updated | Local-first hybrid search: exact (rg) and semantic (zg) over docs and code | 1299 |
| [F8](../features/F8_features-board-module.md) | updated | Features board module | 1294 |
| [F7](../features/F7_task-kanban-web-parity.md) | updated | Task Kanban web parity | 1298 |
| [C3](../features/C3_coverage-artifact-provenance-and-completion-integrity.md) | updated | Coverage artifact provenance and completion integrity | 1314 |
| [H16](../features/H16_faster-default-quality-gate-while-keeping-per-file-90-90-coverage.md) | updated | Faster default quality gate while keeping per-file 90/90 coverage | 1295, 1316 |
| [A92](../features/A92_stack-neutral-sdlc-actions-builder-actions-spur-self-exec-and-script-structure-consolidation.md) | updated | Stack-neutral SDLC actions: builder.actions, spur self exec, and script-structure consolidation | 1303, 1304 |
| [D65](../features/D65_one-workflow-interpreter-and-executor-agnostic-agent-run-dispatch.md) | updated | One workflow interpreter and executor-agnostic agent.run dispatch | 1305, 1306 |
| [E71](../features/E71_disposable-run-scratch-with-durable-evidence-and-inspection.md) | updated | Disposable run scratch with durable evidence and inspection | 1307 |
| [E6](../features/E6_run-to-session-correlation-and-cost-path-repair.md) | updated | Run-to-session correlation and cost-path repair | 1308 |
| [A6](../features/A6_harness-trust-and-operational-controls.md) | updated | Harness trust and operational controls | 1313 |
| [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md) | updated | Downstream Spur Board modules and embedded resources | 1315 |
| [A331](../features/A331_verified-offline-migration-artifacts-and-safe-upgrades.md) | created | Verified offline migration artifacts and safe upgrades | 1311, 1312 |

Existing completed/verifying owners with new committed work were reopened through the feature
lifecycle, preserving their History and old scenario titles. Existing active owners stayed active;
H16 and the new children retain backlog status. No unrelated legacy task was reopened or relinked.
Foundation group A was left unchanged: it has no AC section, and the feature CLI correctly rejected
adding a missing section. The offline migration artifact follow-up was instead placed in A331 under
the existing release-artifact-integrity owner A33, with its own explicit contract.

F22 owns corpus safety/snapshots; F73 owns the Board transport/subscription/readiness experience.
F7 owns the immediate task-store race fix and F8 the feature action defects. This keeps shared
mechanisms and user-facing slices distinct without inventing a cross-cutting root.

## 3. Task map and dependency order

| Task | Package | Feature | Deliverable | State at handoff | Prerequisites |
| --- | --- | --- | --- | --- | --- |
| [1294](../tasks5/1294_make-feature-sync-and-dependency-controls-match-effective-ru.md) | W0 | F8 | Make feature sync and dependency controls match effective runner behavior | todo | — |
| [1295](../tasks5/1295_restore-ordinary-suite-execution-of-real-renderer-markdown-s.md) | W0 | H16 | Restore ordinary-suite execution of real-renderer Markdown security proofs | todo | — |
| [1296](../tasks5/1296_reject-incomplete-planning-inputs-before-deriving-feature-st.md) | W1 | F22 | Reject incomplete planning inputs before deriving feature state | todo | — |
| [1297](../tasks5/1297_reuse-an-operation-scoped-planning-snapshot-across-corpus-re.md) | W1 | F22 | Reuse an operation-scoped planning snapshot across corpus readers | todo | 1296 |
| [1298](../tasks5/1298_keep-task-store-refreshes-owned-by-the-latest-folder-and-sub.md) | W2 | F7 | Keep task-store refreshes owned by the latest folder and subscription | todo | — |
| [1299](../tasks5/1299_preserve-bounded-exact-search-failures-and-skipped-fuzzy-out.md) | W2 | A34 | Preserve bounded exact-search failures and skipped fuzzy outcomes | todo | — |
| [1300](../tasks5/1300_converge-planning-board-procedures-on-existing-validated-orp.md) | W3 | F73 | Converge planning Board procedures on existing validated oRPC transport | todo | 1296, 1299 |
| [1301](../tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md) | W3 | F73 | Share planning-event invalidation across task and feature views | todo | 1298, 1300 |
| [1302](../tasks5/1302_explain-ready-work-blocking-dependencies-and-paused-runs-in-.md) | W3 | F73 | Explain ready work, blocking dependencies and paused runs in planning views | todo | 1297, 1301 |
| [1303](../tasks5/1303_propose-safe-npm-and-pnpm-bindings-through-existing-init-act.md) | W4 | A92 | Propose safe npm and pnpm bindings through existing init actions | todo | 1294, 1295 |
| [1304](../tasks5/1304_complete-language-and-monorepo-action-onboarding-without-gue.md) | W4 | A92 | Complete language and monorepo action onboarding without guessing commands | todo | 1303 |
| [1305](../tasks5/1305_unify-executor-admission-and-invocation-policy-across-existi.md) | W5 | D65 | Unify executor admission and invocation policy across existing dispatch surfaces | todo | 1294, 1295, 1299, 1298 |
| [1306](../tasks5/1306_share-executor-result-finalization-while-preserving-receipts.md) | W5 | D65 | Share executor result finalization while preserving receipts and partial work | todo | 1305 |
| [1307](../tasks5/1307_link-task-failures-and-paused-runs-to-retained-evidence-and-.md) | W6 | E71 | Link task failures and paused runs to retained evidence and safe recovery | todo | 1302, 1306 |
| [1308](../tasks5/1308_show-verified-outcomes-and-reconcilable-measured-cost-throug.md) | W6 | E6 | Show verified outcomes and reconcilable measured cost through current run links | todo | 1307, 1297 |
| [1309](../tasks5/1309_measure-raw-rollup-and-mart-parity-before-selecting-query-si.md) | W7 | E94 | Measure raw rollup and mart parity before selecting query simplification | blocked | 1308 |
| [1310](../tasks5/1310_consolidate-only-proven-equivalent-history-selectors-and-mea.md) | W7 | E94 | Consolidate only proven equivalent history selectors and measures | blocked | 1309 |
| [1311](../tasks5/1311_prove-migration-sql-ownership-and-offline-upgrade-parity-on-.md) | W7 | A331 | Prove migration SQL ownership and offline upgrade parity on fixtures | blocked | 1308 |
| [1312](../tasks5/1312_generate-offline-migration-embedding-from-verified-authorita.md) | W7 | A331 | Generate offline migration embedding from verified authoritative SQL | blocked | 1311 |
| [1313](../tasks5/1313_classify-executable-shell-positions-without-blocking-literal.md) | W8 | A6 | Classify executable shell positions without blocking literal read-only searches | todo | 1295 |
| [1314](../tasks5/1314_parse-coverage-diagnostic-thresholds-with-the-native-toml-pa.md) | W8 | C3 | Parse coverage diagnostic thresholds with the native TOML parser | todo | 1295 |
| [1315](../tasks5/1315_remove-unsupported-runtime-registration-promises-from-the-bo.md) | W8 | A8 | Remove unsupported runtime registration promises from the Board registry | todo | 1300 |
| [1316](../tasks5/1316_reduce-duplicated-test-mocks-behind-retained-behavioral-and-.md) | W8 | H16 | Reduce duplicated test mocks behind retained behavioral and gate evidence | blocked | 1295, 1301 |

Every task carries requirements, scenario-to-feature mapping, implementation design, owned
surfaces/callers/tests/docs, a pre-code failure inventory, a test-first checklist, verification
commands, estimates and preservation constraints. Scenario count was not used mechanically as
task count: cohesive pairs (feature controls and search response correctness) share one task.
Sequential admission/finalization tasks share an action file but have distinct reviewable contracts
and explicit ordering. No parallel execution is authorized by this handoff; one writer per tree
still applies.

The task list was checked against all five configured task folders using the source-local CLI:
1,291 existing task records, no overlapping nonterminal work; four legacy blocked records were
unrelated. Historical done work remains intact. Task 1294 explicitly preserves the starting sync
fix and its test rather than reimplementing or claiming it is absent.

The harness dependency projection covers all 23 tasks and reports no cycle. Dependency-free todo
roots are 1294, 1295, 1296, 1298, 1299. Start with the trust tranche: 1294–1296,
1298 and 1299. Task 1297 then reuses the safe read path. Later work can only start after its
recorded prerequisites are integrated and checked. At most two work packages should be active;
shared-file tasks remain serial even if their broader packages are independent.

## 4. Conditional work and deliberate limits

- 1309 and 1311 wait for W6 measurements, then produce evidence and a go/no-go recommendation.
- 1310 and 1312 additionally require recorded go decisions selecting concrete equivalent definitions
  or authoritative SQL, with compatible available upstream facades where needed.
- 1316 waits for measured test-scaffolding duplication and stronger behavioral replacement proof.
- An optional TanStack Query pilot is a design decision within the Board work, not an installed
  dependency or a second independent feature. It needs dependency approval and a net benefit.

The CLI considered the detailed conditional captures todo even when their batch Plan was omitted.
The normal legal todo-to-blocked transition therefore represents their actual scheduling impediment;
there was no raw rewrite to backlog or lifecycle bypass. Q&A/Background/Plan record the conditions.
Passing dependencies alone does not satisfy an external go/no-go condition.

## 5. Validation and remaining findings

- Runtime taskBatchSchema accepted all 23 records; source-local batch-create wrote the batch.
- Task checks passed for all 23; implementation prechecks evaluated as todo passed for all 18
  nonconditional tasks. These are spec/readiness checks, not proof implementation is complete.
- Feature checks passed for all 15 affected owners. Every added scenario has a linked task;
  historical scenario titles were compared against the saved baseline and preserved.
- All fifteen affected task rosters and the generated feature index were refreshed through Spur.
- The harness dependency-order projection reports no cycle and includes every task exactly once.

Task diagnostic counts at this handoff: {"L4.prerequisite-not-done": 28, "L4.readiness-blocked": 5}.
Feature diagnostic counts: {"L4.evidence-not-recoverable": 4, "L4.scenario-unverified": 35, "L4.uncovered-feature-scenario": 10}.

Prerequisite-not-done and scenario-unverified findings are truthful for planned work. Older uncovered
scenarios and unrecoverable historical evidence remain on F7/F8/H16 from the baseline; this campaign
did not fabricate evidence or create unrelated tasks to silence them. Structural PASS does not mean
strict done gates or an implementation verify PASS. Original and final check payloads are in the
receipt/session ledger for comparison.

No full code test/build gate was rerun for this corpus-only conversion. The prior review's ordinary
gate had the independently reproduced search failure now owned by 1299. Prior uncommitted source
and review artifacts were preserved. No commits, deployments, external messages, workflow edits,
new toolchains or dependency installation were performed.

Local links, receipt arithmetic and scenario/task coverage reconcile. `git diff --check` reports one
cosmetic trailing blank line at the end of F8, emitted by the shared corpus serializer during the
lifecycle/section update. The serializer deliberately terminates modified sections with a blank
line; this tool-owned file was not raw-edited to conceal that diagnostic.
