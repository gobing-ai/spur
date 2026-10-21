---
title: Post-G11 feature legacy and integrity audit
created_at: 2026-10-21
updated_at: 2026-10-21
status: review-complete-deprecation-pending
related: [G11, '1270', '1271']
tags: [audit, docs, planning]
---

# Post-G11 feature legacy and integrity audit

Reviewed all **195 feature records** and enumerated **1,267 tasks** through the source-local CLI across the five registered task folders. This is a working audit record under constitution §4.2; current product contracts remain with their owners. Snapshot base: 1ab91deddcfeac0ecfbb14c476efb819e57ac36f.

## Decisions requested

| Feature | Linked tasks proposed for deprecation | Replacement / reason |
| --- | --- | --- |
| M4 | 0422 | G64 retired standalone Inbox; G11 supplies Projects Inbox and new message plane. |
| G5 | 0565, 0566 | B task 0687 / ADR-087 replaces strict zero-dispatch inline and headless rejection. |
| F61 | 0586, 0670 | D61 task 0775 / ADR-108 retired accepted corpus baselines. |

**Confirmation is pending. No feature/task lifecycle state has been changed by this audit.** Robin’s “continue” authorizes continuing the review; it is not interpreted as approval of an unasked deprecation set. Preserve historical implementation and measurement evidence when a record is later frozen.

**Keep M5**: role-only resolution and role/executor attribution remain in FleetService, config and agent list. Annotate the retired Teams carrier and link G65/G71 rather than freeze the live behavior. B3 is likewise retained with an ADR-078/A4 supersession note because parts remain live. H82/H83, G1/G2/G61–G65, D2 and older workflow features contain mixed current/historical contracts; do not blanket-deprecate their tasks.

## Repairs and verification limits

- Refreshed the sixteen proven stale feature rosters through the CLI; corrected nine broken task links through feature section updates.
- Added current-reading notes to distinguish retired mechanisms and completed planning from present capability, preserving original AC identities and historical notes.
- Full feature check before changes: **141 PASS / 54 FAIL**, exit 1. Failures include missing historical dogfood/verification evidence and one invalid legacy BDD section, not an automatic finding that source code is broken.
- Lifecycle dry-run: exit 0; no writes; fifteen proposals stop at verifying, with 46 receipt-pending features (29 missing, 14 stale, three failed). No status was forced and no receipt fabricated. H16 still has an explicit unmet measurement condition. The later source pass found O only partially delivered: task 1272 owns ambiguous-row visibility and retry-state corrections before closure.
- Five features are already deprecated, five cancelled; no live task is linked to a deprecated/cancelled feature, and no task depends on a deprecated task. Historical task preservation exceptions are documented below, especially I5/0568.

Source review and repairs are tracked separately in tasks 1271 and 1272. Task 1085 delivered single-action retry grouping; the executable source pass found ambiguous action definitions still omit durable row IDs, superseding the document-only O closure inference in the appendices. Source findings are evidence-backed but this document does not certify every runtime path. The baseline proof debt remains visible; historical missing evidence must be recovered or rerun rather than waived.

Affected-input checks in the isolated worktree: 79 records checked,55 exit 0 and24 exit 1. Missing gitignored historical verdict artifacts expose additional evidence gaps compared with the original checkout; these are reported without inferring a source regression. Documentation assertions separately verify195 coverage rows,79 unchanged AC sections,16 exact rosters,nine repaired links and zero lifecycle changes.

## Detailed coverage and evidence

The original reviewer groups follow. All line references describe the reviewed baseline, before current-reading annotations shift lines. Apparent legacy roster edges in the A–F draft are resolved by the alias-aware integrity section; its sixteen-record roster list is authoritative. Paths under /tmp name ephemeral capture provenance; all conclusions and coverage needed for review are retained here.


## Appendix: A–F semantic review

## A–F feature corpus review — 2026-10-21

Read-only semantic audit, frozen scope: 101 feature records (A17/B11/C4/D17/E18/F34). Every listed file was read for Goal/Scope/Notes, AC identities and task roster; selected contradictions were checked against ADRs/current owners/source. Long historical records were inspected in sections. Source-local CLI task lookup was used for 0670; task metadata and edges come from the merged five-folder CLI snapshot. No corpus/source mutation, source fix or test was run. Full structural feature check and lifecycle previews are owned by the separate integrity review.

## Recommendation

Deprecation is warranted only when the capability/implementation is intentionally retired. Propose F61 strongly and B3 conditionally. Do not freeze broad A–F capabilities merely because a later feature replaced one implementation slice. Existing cancelled records C2/E4/F51 already carry disposition. Exact task IDs below are current explicit feature edges; no live dependent task was found for0572/0586/0670 in the frozen snapshot.

## Proposal table

| key | evidence | action | change | apply | verify |
| --- | --- | --- | --- | --- | --- |
| feature:F61:retired-baseline | docs/features/F61_corpus-citation-repair-pay-down-the-anchor-drift-the-content-gate-revealed.md:19,35,52; docs/features/D61_essential-workflow-checks-and-observable-execution.md:22,24,169; docs/00_ADR.md:1676 (ADR-108); packages/app/src/services/corpus-check.ts:4,164; no config/corpus-baseline.json in current inventory | doc or learning | P1 proposal: after Robin confirms, freeze F61 and tasks0586,0670 as deprecated; add History/Notes explaining D61/0775/ADR-108 retired accepted-debt snapshots; preserve the historical measurements and F91 matcher ownership | composer: feature update F61 deprecated; task update 0586 deprecated; task update 0670 deprecated; section writes through CLI; refresh F61 | feature/task affected-input checks; explicit linked edge/dependency audit; no fabricated implementation verification |
| feature:B3:superseded-code-ssot | docs/features/B3_role-routing-ssot-in-spur-config-code-owned-defaults-config-override-roles-md-as-projection.md:15,22; docs/00_ADR.md:697,1016; packages/app/src/services/agent-roles.ts:6,30 | doc or learning | P2 conditional proposal: freeze B3 plus sole task0572 as the obsolete code-owned SSOT implementation, with A4/ADR-078 as successor; explicitly retain role override, fallback, parity projection and deleted markdown parse under A4 | operator chooses freeze old variant vs retain with Current reading; composer uses feature/task update, not raw edits | B3/0572 checks; ensure A4 covers surviving behavior and no live dependent is stranded |
| feature:planning-snapshots:closure | A8:181–187; B2:43–45; B5:143–146; B61:65; D63:130; E93:142–143; F21:94 (paths in coverage below); CLI all-task snapshot shows shipped done tasks | doc or learning | P2: add concise Current closure + Historical planning headings; remove misleading next-run instructions from current reading without rewriting historical decisions or AC identities | feature update <id> --section Notes --from-file; B2 Goal replacement preserves text with explicit historical label | affected feature check; links to successor/task Testing; no claim that Notes alone proves acceptance |
| feature:E:stale-group-surface | docs/features/E_history.md:24,31,46; apps/cli/src/commands/history.ts:444; plugins/sp/commands/dev-find-issue.md:11; I8 owns the current report contract | doc or learning | P2: remove group claims that report is a deferred placeholder and that --use-history is the current bridge; link current report/history-anatomy owners. E5's old --create-task contract is superseded only at the find-issue slice | CLI section updates of E Scope/Notes; successor annotation on E5 Notes | read CLI registration and current command contract; feature check E/E5 |
| feature:F:stale-scope | docs/features/F_planning.md:23 vs F7/F8 Goal and shipped Board code; F1:70–72 still says active P0/manual roster until refresh ships | doc or learning | P3: align Planning group scope with its current Board children and label F1's bootstrap Notes as historical; do not deprecate substrate | CLI section updates | feature checks F/F1; preserve legacy roster edge provenance |
| feature:workflow-slices:supersession | D65 Scope:22–32; D66 Scope:20–26; config/workflows/task-pipeline.yaml:9–27; A6/F5/D5/D62/D64/D7/F821/F96 old proof/inline/stage/hook clauses | doc or learning | P2: add Current reading identifying D65/ADR-140 and D66 as owners of retired proof chain/inline interpreter/workflows; keep surviving observability, selector, gate, sync and residual capabilities active | CLI Notes annotations per feature after accepted scope; no AC title renumber/rewrite | scope diff review plus affected feature checks; no blanket task deprecation for partially surviving features |
| feature:D2:record-layout | docs/features/D2_all-in-one-per-run-workflow-run-log.md:15–21; E7:22–33; packages/app/src/workflow/run-record.ts:94,131,168 | doc or learning | P3: annotate E7/E71 as current storage owners; keep D2 as historical log/retention capability because no-log, legacy .log reads and reclamation still exist | feature update D2 --section Notes; do not deprecate all0426–0430 | current run-record callers and relevant feature checks |
| feature:roster:drift | frozen snapshot comparisons below; F51 task1204 deprecated but roster says done; D66 roster1253 actually links D3 | doc or learning | P2: scoped refresh for actual stale edge/status rosters after operator-approved document changes; distinguish legacy feature-id frontmatter failures from a nonexistent task | feature refresh --feature <id>; handle legacy edges via task CLI only if independently authorized | affected feature/task checks and freeze snapshot diff |

## Source-phase leads (not verified runtime bugs)

1. packages/app/src/services/task-check.ts:533,576,660 and planning-check-base.ts:331,366 still accept and apply accepted-debt maps although ADR-108 retired baselines. No production caller supplies `accepted` in the current source search, so this is unused retired machinery, not evidence of a current CLI bypass. Remove only with a caller/export/test audit; leave unsuppressible findings protected.
2. packages/app/src/services/agent-service.ts:63,110,154,234,282 and apps/cli/src/context.ts:85,133 still call DEFAULT_AGENT_ROLES the SSOT/ADR-061, contradicting agent-roles.ts:6/ADR-078. Comment/contract drift; no observed routing malfunction.
3. D7 Goal/Scope promises topological ordering while its Notes132–138 and stable R2 explicitly select declared node order. Keep the shipped behavior; annotate historical premise rather than invent topological sorting.
4. D2 log-layout migration, A8 project isolation proof0997 cancellation, and E93 source-format coverage need targeted source-phase validation; document done status is not an executable proof. No runtime issue established in this document pass.

## Frozen coverage

Disposition K means retained live capability or intentional historical record; C means confirmation-only deprecation candidate; R means retained with a stale-section/roster/status or supersession annotation proposal. Feature-level verifying/active with terminal tasks is a sync-preview lead, not authority to force done.

| ID | Status | Disposition | File | Reading |
| --- | --- | --- | --- | --- |
| A | active | R | docs/features/A_foundation.md | Keep platform group; stale hidden-alias scope and missing task 1155 roster. |
| A1 | done | R | docs/features/A1_init-scaffold-ownership-contract.md | Keep scaffold capability; historical template copying later narrowed by A4. |
| A2 | verifying | R | docs/features/A2_embedded-job-queue-and-scheduler.md | Keep live queue/scheduler; verifying with terminal linked tasks requires receipt-aware sync, not depreciation. |
| A21 | done | K | docs/features/A21_reusable-execution-deadlines-and-unlimited-jobs.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| A3 | done | R | docs/features/A3_harness-surface-governance-workflow-composition-measures-and-script-surface-placement-rules.md | Keep CLI/governance capabilities; annotate later A9/A91 ownership and B4 auth-output amendments. |
| A31 | done | K | docs/features/A31_global-cli-logo-suppression-and-machine-output-banner-policy.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| A32 | done | K | docs/features/A32_content-verified-standard-script-twins.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| A33 | active | R | docs/features/A33_repo-release-tooling-integrity-verified-binary-installs-and-single-source-generated-plugin-lib-bindings.md | Keep release integrity; active despite all tasks done; roster omits 1143/1185. |
| A4 | done | R | docs/features/A4_spur-config-1-2-global-project-layered-configuration.md | Keep current config SSOT; historical planning/Open questions need closure wrapper. |
| A5 | done | K | docs/features/A5_universal-config-loading-composition-root-merged-config-wiring-consumer-audit-and-agent-surface-json-error-contract.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| A6 | done | R | docs/features/A6_harness-trust-and-operational-controls.md | Keep trust controls; ADR-140 supersedes proof-chain slices only. |
| A7 | done | R | docs/features/A7_spur-board-layout-optimization-and-global-orchestrator-agent-interface.md | Keep Board shell; old module-order inventory predates Projects/G11. |
| A71 | done | K | docs/features/A71_desktop-board-shell-and-native-macos-integration.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| A8 | done | R | docs/features/A8_downstream-spur-board-modules-and-embedded-resources.md | Keep shipped extension capability; done conflicts with unimplemented Notes at 181–187. |
| A9 | done | K | docs/features/A9_script-placement-contract-cli-owned-logic-thin-plugin-glue-and-pipeline-check-diet.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| A91 | verifying | K | docs/features/A91_harness-script-ownership-consolidation-and-exception-retirement.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| A92 | done | K | docs/features/A92_stack-neutral-sdlc-actions-builder-actions-spur-self-exec-and-script-structure-consolidation.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| B | active | K | docs/features/B_agent-execution.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| B1 | verifying | R | docs/features/B1_agent-run-hardening.md | Keep run hardening; single-LLM-surface wording predates ADR-140 host/subprocess/fleet; stale 0068 roster edge. |
| B2 | done | R | docs/features/B2_invocation-agnostic-executor-selection-intention-vocabulary-quality-ordering-and-one-selector-concept.md | Keep selector policy; closed-map body still says None shipped (43–45); old team/selector promises are historical. |
| B21 | verifying | K | docs/features/B21_executor-tier-policy-as-a-leaf-module.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| B3 | verifying | C | docs/features/B3_role-routing-ssot-in-spur-config-code-owned-defaults-config-override-roles-md-as-projection.md | Candidate: freeze obsolete code-as-SSOT variant; A4/ADR-078 now owns it; task0572. |
| B4 | done | K | docs/features/B4_agent-doctor-as-the-routing-inspection-surface-capability-tier-rendering-full-eligible-ladder-auth-removal-and-cached-probes.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| B5 | done | R | docs/features/B5_executor-availability-and-quota-driven-disabling.md | Keep quota-disable base; B6 extends global persistence/recovery; stale approval Notes145. |
| B6 | done | K | docs/features/B6_executor-availability-lifecycle-disable-ownership-recovery-global-config-persistence-and-an-explicit-usage-producer.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| B61 | done | R | docs/features/B61_usage-availability-decision-correctness-and-bounded-capture.md | Keep conservative usage decision/capture; stale no-production-fix Note65. |
| B7 | done | K | docs/features/B7_run-scoped-executor-session-resolve-once-per-run-pin-across-stages-per-stage-fresh-session-policy.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| B8 | done | K | docs/features/B8_runner-capability-matrix-per-agent-session-and-stdin-capabilities-declared-upstream-and-consumed-by-spur.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| C | active | K | docs/features/C_rules.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| C1 | done | K | docs/features/C1_rule-surface-contract-and-catalog-integrity.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| C2 | cancelled | K | docs/features/C2_lockstep-dependency-catalog-integrity.md | Keep cancelled historical decision; cancellation explicitly justified, do not deprecate again. |
| C3 | verifying | K | docs/features/C3_coverage-artifact-provenance-and-completion-integrity.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| D | done | K | docs/features/D_workflows.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| D1 | done | R | docs/features/D1_workflow-run-observability-enriched-step-lines-fsm-transitions-async-follow.md | Keep observability; investigation Frontier/ground truth are historical, not open implementation. |
| D2 | done | R | docs/features/D2_all-in-one-per-run-workflow-run-log.md | Keep retained log/compatibility policy; canonical .log layout superseded by E7/E71. |
| D3 | active | R | docs/features/D3_workflow-run-reliability-defects-schema-resolution-shell-interpolation-headless-hitl.md | Keep live reliability owner; terminal linked tasks and stale 1256/1259 roster require reconciliation. |
| D4 | done | K | docs/features/D4_workflow-yaml-rule-style-extensions.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| D5 | done | R | docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md | Keep composition/progress capabilities; annotate D65 proof-chain and D66 workflow-retirement supersession. |
| D6 | done | K | docs/features/D6_workflow-cost-deterministic-ownership-surface-and-role-addressed-coordination.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| D61 | done | K | docs/features/D61_essential-workflow-checks-and-observable-execution.md | Keep essential gate policy; historical section already explicitly marked; no rewrite needed. |
| D62 | done | R | docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md | Keep engine observability/gate scope; inline-driver implementation superseded by D65; partial pilot evidence explicitly retained. |
| D63 | done | R | docs/features/D63_reliable-and-measured-daily-workflow-adoption.md | Keep reliability capabilities; stale todo/blocked Notes130 contradict terminal rosters. |
| D64 | done | R | docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md | Keep check/decision/fleet capabilities; supersede per-surface inline parity with D65 only. |
| D65 | done | R | docs/features/D65_one-workflow-interpreter-and-executor-agnostic-agent-run-dispatch.md | Keep current engine foundation; feature-verification pilot was subsequently retired by D66. |
| D66 | done | K | docs/features/D66_workflow-consolidation-one-owner-per-lifecycle-d65-primitives-everywhere.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| D7 | done | K | docs/features/D7_workflow-todo-projection-show-format-for-deterministic-plan-rendering.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| D8 | done | K | docs/features/D8_proportional-workflow-upgrade-strategy.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| D9 | done | R | docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md | Keep stabilization record and explicit Option B closure; D65 supersedes proof/inline slices, not whole feature. |
| D91 | verifying | K | docs/features/D91_workflow-service-locality-composition-lint-and-run-record-modules-extracted.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E | done | R | docs/features/E_history.md | Keep History group; obsolete --use-history and deferred report placeholder (24/31/46). |
| E1 | done | R | docs/features/E1_history-data-plane-trustworthy-end-to-end-forensic-etl-verified-incremental-import-analyze-report-one-scheduled-loop.md | Keep import/analyze/report data plane; charting open implementation/stub facts historical and need wrapper. |
| E2 | active | R | docs/features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md | Keep completed forensics map; all linked tasks done; current active status and missing1144 roster drift. |
| E3 | done | K | docs/features/E3_operation-triggered-history-refresh-coalesced-import-and-analyze-off-the-hot-path.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E31 | done | K | docs/features/E31_history-refresh-process-isolation-and-single-flight-execution.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E4 | cancelled | K | docs/features/E4_session-forensics-implementation-retention-derived-variables-report-modes-find-issue-rewrite.md | Keep cancelled duplicate historical record; E5 is live implementation owner; no linked tasks. |
| E5 | active | R | docs/features/E5_session-forensics-implementation-retention-derived-variables-report-modes-find-issue-rewrite.md | Keep live forensics/derived metrics; find-issue CLI slice later superseded by I8, not entire feature. |
| E6 | verifying | K | docs/features/E6_run-to-session-correlation-and-cost-path-repair.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E7 | done | K | docs/features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E71 | active | R | docs/features/E71_disposable-run-scratch-with-durable-evidence-and-inspection.md | Keep scratch/evidence portability; all linked tasks terminal but active and incomplete roster. |
| E72 | done | K | docs/features/E72_observability-trace-tab-for-workflow-run-inspection.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E8 | done | K | docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E81 | done | K | docs/features/E81_history-board-tool-using-tab-sequence-visualization-and-investigation-for-history-tool-calls.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E82 | done | K | docs/features/E82_history-board-service-seam-production-owned-port-and-test-only-mock-subpath.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E9 | done | K | docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E91 | done | K | docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E92 | done | K | docs/features/E92_history-schema-ddl-ownership-repatriation-importer-owned-columns-schema-version-constant-and-source-table-registry.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| E93 | done | R | docs/features/E93_history-capability-detection-for-commands-subagents-and-skills.md | Keep capability extraction; done contradicts planning-only Notes142–143. |
| F | verifying | R | docs/features/F_planning.md | Keep planning group; old Out board UI text conflicts with child F7/F8 scope; legacy roster edge0088. |
| F1 | verifying | R | docs/features/F1_planning-foundation.md | Keep schema/BDD/lock substrate; stale active-P0/manual-roster Notes70–72; legacy tasks unresolved via modern feature_id. |
| F2 | done | K | docs/features/F2_task-management-cli.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F21 | active | R | docs/features/F21_consistent-task-creation-and-default-implementation-readiness.md | Keep ready creation; all tasks done; Note94 incorrectly says planned/unimplemented; roster misses1132/1137. |
| F3 | verifying | R | docs/features/F3_feature-management-cli.md | Keep feature CLI; legacy roster edges and missing1119/1126, gate-aware sync needed. |
| F31 | verifying | R | docs/features/F31_feature-tree-restructure-kit-audit-hierarchy-guide-and-sp-dev-featurechange.md | Keep restructure kit; all linked tasks done, verifying status must use receipt-aware sync. |
| F4 | done | K | docs/features/F4_lifecycle-and-events.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F41 | done | K | docs/features/F41_transport-parity-task-transition-gates-one-guarded-transition-for-cli-and-server.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F42 | verifying | R | docs/features/F42_deprecated-feature-status-frozen-but-retained-lifecycle-state-with-guarded-consumers.md | Keep deprecation semantics; all linked tasks done, verifying status must use receipt-aware sync. |
| F43 | active | R | docs/features/F43_task-level-deprecated-status-frozen-but-retained-task-lifecycle-state-with-guarded-consumers.md | Keep task deprecation semantics; all four tasks done, stale testing/todo roster and active status. |
| F5 | done | R | docs/features/F5_execution-pipeline.md | Keep task pipeline capability; old seven-stage graph replaced D65 and needs current-reading annotation. |
| F51 | cancelled | R | docs/features/F51_review-confidence-certification-at-pipeline-pass-boundaries.md | Already cancelled and task1204 already deprecated; refresh roster only. |
| F511 | done | R | docs/features/F511_retire-asserted-confidence-machinery-from-the-pipeline.md | Keep asserted-confidence retirement record; ADR-141/146 explicitly amend derived answer/changelog exceptions; roster missing1207. |
| F6 | verifying | K | docs/features/F6_corpus-migration.md | Keep migrate utility/history; not stale merely because one-time cutover has occurred. |
| F61 | done | C | docs/features/F61_corpus-citation-repair-pay-down-the-anchor-drift-the-content-gate-revealed.md | Strong candidate: accepted-baseline capability retired by D61/ADR-108; tasks0586/0670. |
| F7 | active | R | docs/features/F7_task-kanban-web-parity.md | Keep live Board; active despite terminal tasks, missing1162 roster; gap snapshot is historical. |
| F71 | done | K | docs/features/F71_apply-design-md-to-tasks-module-task-kanban-visual-fine-tune.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F72 | done | K | docs/features/F72_tasks-module-history-shell-parity-unified-header-inline-filters-full-bleed-density.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F8 | verifying | R | docs/features/F8_features-board-module.md | Keep Features Board; verifying despite terminal tasks needs receipt-aware sync. |
| F81 | done | K | docs/features/F81_board-features-detail-action-group-lifecycle-ops-async-runner-observability.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F82 | done | R | docs/features/F82_feature-status-feedback-loop-derivation-sync-refresh-command-board-status-ux.md | Keep feature sync policy/map; mark old stub/roster survey historical; D66 now owns feature verification. |
| F821 | done | R | docs/features/F821_feature-status-sync-derivation-engine-refresh-command-hook-wiring.md | Keep current sync derivation; old wrapup hook placement changed D66. |
| F822 | done | K | docs/features/F822_features-tree-status-affordance-icon-only-leading-indicator-with-accessible-name.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F83 | done | K | docs/features/F83_feature-detail-action-progress-transparency.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F84 | done | K | docs/features/F84_features-board-layout-alignment-collapsible-panels-and-floating-agent-bar.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F841 | done | K | docs/features/F841_features-board-overlay-panels-wider-folded-prompt-bar-and-branch-folding.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F9 | done | K | docs/features/F9_ac-verifiable-execution-bdd-test-scaffolds-and-tunable-validation-gates.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F91 | active | R | docs/features/F91_corpus-gate-integrity-content-verified-evidence-anchors-external-evidence-notation-ac-altitude-carve-out-and-a-two-sided-warning-ratchet.md | Keep anchor/altitude validation; retire old baseline/warning-ratchet scope annotation only; Notes127 is stale after D61. |
| F92 | done | K | docs/features/F92_task-completion-contract-centralization-section-matrix-target-state-validation-canonical-verdict.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F93 | done | R | docs/features/F93_durable-verification-evidence-the-completion-gate-reads-the-tracked-task-record-not-a-gitignored-artifact.md | Keep durable Testing fallback; historical baseline delta and scratch paths are superseded slices. |
| F94 | done | R | docs/features/F94_pipeline-close-out-and-gate-friction-baseline-reconcile-verb-anchor-drift-detection-verified-box-auto-flip-and-fsm-denial-guidance.md | Keep anchor/checkbox/denial fixes; old baseline and sweep-once policy superseded D61. |
| F95 | done | K | docs/features/F95_cli-json-envelope-standard-normalized-ok-data-error-shape-across-spur-nouns.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |
| F96 | done | R | docs/features/F96_residual-sweep-for-task-execution.md | Keep residual sweep; verify/test-fix stage naming predates D65 merged review/remediate. |
| F961 | done | K | docs/features/F961_residual-scan-ignores-placeholder-no-finding-review-rows.md | Keep shipped/live capability; no evidence of full retirement in reviewed contract. |

## Roster comparison details

- A: 1155:missing→done
- A33: 1143:missing→done; 1185:missing→done
- B1:  ; roster without modern feature_id edge: 0068
- D3: 1259:todo→done; 1256:testing→done
- D66:  ; roster without modern feature_id edge: 1253
- E2: 1144:missing→done
- E71: 1141:missing→done; 1148:missing→done; 1140:missing→done; 1165:missing→done; 1139:missing→done; 1149:missing→done; 1145:missing→cancelled
- F:  ; roster without modern feature_id edge: 0088
- F1:  ; roster without modern feature_id edge: 0041,0042,0043,0044,0045,0048
- F2:  ; roster without modern feature_id edge: 0050,0051,0052,0054
- F21: 1132:missing→done; 1137:missing→done
- F3: 1126:missing→done; 1119:missing→done ; roster without modern feature_id edge: 0056,0057,0058,0060,0061
- F4:  ; roster without modern feature_id edge: 0046,0049,0053,0055,0059
- F43: 1191:todo→done; 1192:todo→done; 1190:todo→done; 1189:testing→done
- F5:  ; roster without modern feature_id edge: 0062,0063
- F51: 1204:done→deprecated
- F511: 1207:missing→done
- F6:  ; roster without modern feature_id edge: 0047
- F7: 1162:missing→done
- F91: 1254:missing→done; 1153:todo→done

Legacy roster-only IDs are not automatically deleted: the earliest corpus uses legacy frontmatter rather than modern feature_id and its schema failures require task lookup/normalization decisions. Parent integrity report owns the definitive structural verdict.

## Task sets for accepted deprecations

- F61:0586(done),0670(done).0586 owns baseline-aware acceptance,0670 reconciled the removed baseline and recorded a matcher proposal explicitly owned by F91. Keep0670 ADR measurements as history.
- B3:0572(done). Surviving fallback/override/projection behavior belongs to A4.
- Existing F51:1204(deprecated); do not attempt cancelled→deprecated on F51 because that lifecycle edge is not declared.

Skipped: runtime execution, test gates, automatic feature sync and corpus mutation. Risk: source inspection proves ownership/supersession, not runtime correctness; broad source review remains the next phase.


## Appendix: G collaboration review

## Collaboration feature review

Read all 21 G records. No feature/task lifecycle changes applied.

| Feature | Disposition | Evidence / reason |
| --- | --- | --- |
| G | Repair Goal, Scope and Notes | `G_collaboration.md:15` still names removed spur team; line 27 calls done tasks 0530/0531 unfinished. Preserve live collaboration umbrella. |
| G1 | Retain; add G11 supersession note and refresh roster | `G1_inbox-ipc.md:18` names TeamService/MessageService and removed /api/messages routes; lines 21–22 name --agent and Observability Inbox. G11 owns replacement; live events/watch/thread guarantees remain. Roster omits done 1164/1168. |
| G11 | Retain | Current InboxDao/InboxService/oRPC/member inbox design; tasks 1266–1269 done. Review source separately. |
| G2 | Retain; annotate retired surfaces | `G2_team-process-supervision.md:24` names old /api/team and spur team commands. SupervisorService/process streaming remain live; do not deprecate shared process tasks solely because transport names changed. |
| G3 | Already deprecated, consistent | Both 0196/0197 deprecated. |
| G4 | Retain; verify closure and scope annotations | 0529–0531 done; feature verifying. Identity pins/artifacts/wait remain live. Old team env/CLI examples should be explicitly historical after G65/G72. |
| G5 | DEPRECATION PROPOSAL: feature and 0565/0566 | `G5_restore-inline-agent-with-host-session-only-semantics.md:15,20–21,38–49` require no dispatch and headless rejection. Current `plugins/sp/skills/spur-dev/references/cross-cutting.md:40–47` explicitly reverses both via 0687/H83; `apps/cli/src/commands/agent/run.ts:44–53` accepts inline. Preserve history, link replacement. |
| G6 | Retain historical design map; clarify finished investigation | Notes still identify 0828 as first frontier and cutover as open; 0828–0830 done and G64 records cutover. Design-only completion is valid, not obsolete functionality. |
| G61 | Retain; annotate replaced storage owner/mechanism | `G61_durable-project-command-and-result-loop.md:175` says inbox_messages belongs to ts-db; G11/0054 now owns it in Spur. At-least-once safety/idempotency/receipts remain current. Do not rewrite historical engine-release statements as current. |
| G62 | Retain; annotate G65/G72 supersession | Scope and Notes describe generated specs/materialization and old team member shape. Fleet identity, orchestrator, strategy, leases, capacity remain live. |
| G63 | Retain; annotate G11 and current tab/transport structure | `G63_projects-board-module-and-global-input-wiring.md:20` incorrectly says no production global input; lines 30–33 describe old Conversation/Agents/Work layout. Current tabs and oRPC Inbox replaced these; durable drafts and project boundaries still apply. |
| G631 | Retain | Live read-only Database tab, Inspector DAO/service/contract/handler. |
| G64 | Retain; refresh roster and label old staging as history | `G64_retire-workspace-inbox-teams-and-spur-team.md:252` calls staging current; later supersession is present but lower. Lines 271,285–287 claim exactly 0846–0851 and backlog 0852/0853; actual roster has ten done tasks 0846–0855. Migration converter subsequently removed by G65; deletion outcome remains valid. |
| G65 | Retain; annotate G72 in-memory specs | `G65_fleet-declaration-in-spur-config.md:32` says materializes; current `FleetService.specs` derives specs in memory, no .spur/agents writes. All six tasks done; feature verifying needs real verification, not forced status. |
| G66 | Retain | Persistent/resume/one-shot session behavior remains in MemberSession; extraction into G67 did not remove capability. |
| G67 | Retain | App-layer AgentLoop/MemberSession extraction is present. Source line references describe original baseline, not defects by themselves. |
| G7 | Status/traceability review; retain | Backlog umbrella with no direct task edges despite G71 verifying and G72/G73 done. Do not force done from child completion: parent AC lacks direct verification evidence. |
| G71 | Retain; verify closure | All six linked tasks done, feature verifying. Dispatcher/receipts/execution record remain live. |
| G72 | Retain | Removal outcome remains valid; G11 adds later ownership. |
| G73 | Retain | Guest participation/hooks/join/leave/report remain live. |

## Source leads

- `apps/cli/src/commands/agent/run.ts:145–148` still says inline is rejected, contradicting validator line 53 and later selector contract. Fix comment with sibling-class search in source phase.
- `packages/app/src/services/supervisor-service.ts:133` still says every process starts from `.spur/agents/<id>.yaml`; G72 supports fleet specs in memory. Documentation cleanup candidate only, no runtime defect inferred.
- Source-side correctness review remains separate; these document observations do not establish a source PASS.


## Appendix: H–P semantic review

## H–P feature review checkpoint

Read-only review; no corpus or source mutation. Source-local CLI feature/task snapshots and task show were used. Freeze: 74 records. Feature Goal/Scope/AC/Notes were inspected across this group; historical task implementations were sampled where needed, not exhaustively reverified. Structural check/sync evidence is supplied separately by the corpus-integrity reviewer. This report does not claim a runtime verification PASS.

## Proposals

| key | evidence | action | change | apply | verify |
| --- | --- | --- | --- | --- | --- |
| feature:M4:retired | docs/features/M4_inbox-board-module-unified-agent-message-plane-all-supervisor-per-agent-tabs.md:15,26,30,143; G64 retirement record:275–301; G11 Scope:20–27 and R14–18; apps/web/src/modules/projects/InboxView.tsx:4 | doc or learning | Strong confirmation candidate: deprecate M4 and sole linked task 0422. Its standalone All/Supervisor/per-agent tab and mixed message/process timeline were retired; Projects Inbox now uses member list/thread/composer and typed InboxService APIs. Preserve historical receipt, explicitly retire deferred relay-hold promise at M4:206 rather than create work for the removed layout. | After operator confirmation, feature/task update via source-local CLI with supersession notes; no direct corpus writes | Feature/task checks plus roster refresh |
| feature:M5:retain-core | docs/features/M5_teams-declared-by-role-a-member-is-a-role-plus-an-executor.md:29–37,97–98; packages/config/src/index.ts:568–614; packages/app/src/services/fleet-service.ts:187–240,314–332; apps/cli/src/commands/agent/list.ts:60–85; docs/design/fleet-config-declaration.md:166 | doc or learning | Retain M5 and tasks 0543/0544 as mixed historical/live capability. Teams carrier and display surfaces retired, but role-only executor resolution, pin precedence, role validation and separate role/executor display remain implemented with explicit 0543/0544 ownership comments. Annotate transfer to agent.fleet/G65/G71 instead of declaring capability absent. If freezing old Teams branch is desired, first explicitly transfer the live contract ownership. | Source-local feature section update after approval of documentation scope | Check M5 and linked tasks; confirm live resolution/display tests |
| feature:H82:partial-supersession | docs/features/H82_unified-agent-execution-surface-selector.md:21–30,53–66,75–94; plugins/sp/skills/spur-dev/references/cross-cutting.md:40–58; task 0687 via source-local task show | doc or learning | Retain feature; annotate R2/R3 named-selector/subprocess and explicit-inline semantics superseded by H83/0687. Core selector collapse, reserved names, glossary stubs, forwarding and tier fallback remain live. Scope:24 one-release aliases conflicts with its own R5 amendment:80–83: removed prompt flags use glossary redirects, not parsed aliases. | CLI feature section update preserving scenario titles/history | H82 check; contract parity |
| feature:H83:partial-supersession | docs/features/H83_run-scoped-agent-session-affinity-live-agent-streaming-unified-agent-inline.md Goal/Scope and R2–R6; current cross-cutting session-policy section; task 0687 | doc or learning | Retain affinity, host-session isolation and live pipe-streaming capability. Annotate later 0687 headless inline substitution and B7 role-specific fresh/reuse policy as current reading; do not blanket deprecate durable execution safety. | CLI feature section update, preserve historical decisions | H83 check; current session/selector tests |
| feature:O:already-delivered | docs/features/O_observability-run-detail-refinements.md:24,37–41; packages/app/src/workflow/progress-projection.ts:531–549; packages/app/tests/workflow/progress-projection.test.ts:537–595; commit afd015b42 (2026-10-04); source-local task show 1085 (done, E72) | doc or learning | O backlog/no-task promise already implemented in task 1085: same-kind retries surface as attempts. Record delivery and close/cancel duplicate backlog through lifecycle policy; do not deprecate live projection behavior. Check remaining ambiguous multi-action mapping separately during source phase. | Source-local feature update with 1085/commit evidence; explicit lifecycle decision | Feature check O and focused progress projection tests |
| feature:M6:stale-staging | docs/features/M6_workspace-overview-removal-and-inbox-teams-supervisor-label-split.md:86–106; M3:160–180; G64:275–301 | doc or learning | Append current-reading supersession to cancelled M6/M3: their Current reconciliation says 0849/0850 cancelled and ADR-116 absent, but G64 records shipped cutover. Preserve dated staging history and cancelled status. M3 linked task 0269 remains historical delivered implementation; no automatic deprecation of cancelled records proposed. | CLI feature Notes section updates | Feature checks M3/M6; verify G64 task statuses |
| feature:H16:measurement-gap | docs/features/H16_faster-default-quality-gate-while-keeping-per-file-90-90-coverage.md:28,61–67; source-local task show 1154 (done) | task | Do not infer feature completion solely from 1154 done: current Scope explicitly says no-isolate honored and beats-serial-baseline not measured. Reconcile backlog status with delivered gate changes and unresolved R3 measurement; task 1154 old serial-only requirement was superseded by later Bun 1.4.3 change. | Feature lifecycle/section correction only after evidence decision; measurement task under live owner if needed | Scoped check + actual benchmark evidence, not prose assertion |
| feature:H:frozen-routing | docs/features/H_agent-integration.md:15–20,35–37; docs/features/I_sp-plugin.md:19–23,38; H1 tasks 1127–1209 and H16 creation postdate freeze | doc or learning | H says frozen/new work forbidden but remains done and has newer work descendants. Reconcile historical ownership/routing; avoid mass deprecation because live descendants remain. | Evidence-backed owner proposal via feature move dry-run or scope clarification; no automatic broad reparent | Feature checks and task links |
| feature:I8:bounded-legacy-window | docs/design/history-anatomy.md:220–238; plugins/sp/README.md:364–373; plugins/sp/skills/issue-finding/SKILL.md still packaged | doc or learning | Schedule explicit coexistence gate review; no evidence gathered here proves parity/adoption/approval to retire legacy issue-finding. Record dated extension if gate not met; do not silently treat bounded coexistence as permanent. | Doctor proposal to owner; retirement separately requires operator approval | Parity fixtures, both-mode run evidence and regression review |

## Coverage and disposition

Every ID below is included in the frozen H–P inventory. Keep means no evidence of wholly retired capability from this document pass; it does not certify every AC is currently implemented. Lifecycle means linked tasks are all terminal while feature remains verifying/active/backlog; use separate check/sync evidence, never blindly mark done.

| ID | Disposition |
| --- | --- |
| H | Frozen routing conflict; retain mixed history, reconcile ownership |
| H1 | Keep live spine/batch capability; stale remaining-delivery and verifying close-out prose needs current-reading note |
| H11 | Keep conflict finder; lifecycle verification review |
| H12 | Keep frontier prioritizer; historical counts are dated premises |
| H13 | Keep refactor/preservation contract |
| H14 | Keep document authoring contract |
| H15 | Keep batch gate/budget/brief capability |
| H16 | Delivered changes plus unresolved measurement; do not auto-close |
| H2 | Keep mixed write guard/companion history; old companion names superseded by H1 facade extraction |
| H21 | Keep shared host hook core; lifecycle verification review |
| H3 | Keep migration receipt; anti-hallucination transfer is already annotated |
| H4 | Keep router/dogfood capability; historical feature N and super-coder orchestration names need current-reading context |
| H5 | Keep architecture/reliability history; stale no-dependencies-CLI claim at Notes:250 superseded by its own 0303 task |
| H51 | Keep retry/format/lifecycle guardrails |
| H52 | Keep pipeline cost and record auto-walk capability |
| H53 | Keep reliability/mutation policy capability |
| H6 | Keep role-charter/parity/dispatch contract; historical immature-noun exclusions superseded by later facade coverage |
| H7 | Keep hook/verdict/remediation capability |
| H8 | Keep flag chain contract; one-release warning expiry requires version evidence before removal |
| H81 | Keep argument contract/parity capability |
| H82 | Partial selector semantics superseded; retain live collapse/reserved names/tests |
| H83 | Partial selector/session policy superseded; retain durable affinity/streaming safety |
| H9 | Keep fallback capability; inline spelling changed later, annotate current reading |
| I | Keep plugin ownership root; lifecycle review and frozen-H routing conflict |
| I1 | Keep hands-off planning/wrap capability |
| I11 | Keep idea-evaluation gate |
| I12 | Keep verbatim intake/inventory gate |
| I13 | Keep completed two-layer progress investigation/productization |
| I2 | Keep parity/refinement capability |
| I21 | Keep composer/doctor/layer capability; historical script implementation references may be superseded by later app services |
| I3 | Keep harness/CLI reconciliation capability |
| I31 | Keep completed improvement roadmap; completed investigation is not deprecated |
| I32 | Keep dispatch/session guidance adoption |
| I33 | Keep review scope selectors; one-release positional alias review requires release evidence |
| I4 | Keep role propagation; lifecycle verification review |
| I5 | Already deprecated; no new feature transition; task scope mixed historical import/report capability, no blanket task retirement inferred |
| I6 | Keep investigation history; M6 keep-three recommendation later superseded by G64; contradictory second-directory premise already partly corrected but still repeated |
| I7 | Keep semantic operand drift gate; lifecycle verification review |
| I8 | Keep history-anatomy capability; explicit legacy coexistence review due under its gate |
| I81 | Keep history correctness/telemetry remediation; lifecycle verification review |
| I9 | Keep proposal-only environment lens |
| J | Keep observability foundation; obsolete Inbox tab scope superseded by M4/G64/G11; lifecycle review |
| J1 | Keep mixed table/accessibility history; later J9/J91/J92 supersede layout details |
| J2 | Keep diagnostics/producer audit; later presenter implementation supersedes local tooltip details; lifecycle review |
| J3 | Keep event ingestion/read/retention foundation; team event promises retired by G65/G72; lifecycle review |
| J31 | Keep catalog-open ingestion/time range; header naming later superseded by J92 |
| J4 | Keep observability capabilities; Teams supervisor subset retired by G64 with accepted reductions, do not blanket deprecate |
| J5 | Keep event context/redaction/trace capability; lifecycle verification review |
| J6 | Keep routing attribution/token capability; lifecycle verification review |
| J7 | Keep Board routing/token surface |
| J8 | Keep pairing evidence/report capability |
| J9 | Keep event-specific presenters/outcomes |
| J91 | Keep human projection/agent attribution |
| J92 | Keep table customization; default header/tab/range details superseded by J93, not wholly retired |
| J93 | Keep current Summary/Jobs/schedule surface |
| K | Keep Features Board/product identity; lifecycle review |
| K1 | Keep project switcher/registry |
| K2 | Keep port-error/test-seam robustness |
| K21 | Keep Windows argv preservation |
| K3 | Keep registry cleanup; lifecycle review (all 5 tasks done) |
| L | Keep live builder umbrella; backlog/zero direct tasks is not proof of abandonment; ID reuse documented |
| L1 | Keep builder PR/topology capability; lifecycle review |
| M | Already deprecated with 9 deprecated tasks; no transition |
| M1 | Already deprecated with 6 deprecated tasks; no transition |
| M2 | Already deprecated with 4 deprecated tasks; no transition |
| M3 | Cancelled superseded UI plan; stale staging note; historical task 0269 done |
| M4 | Strong deprecation candidate with task 0422, requires confirmation |
| M5 | Retain live role/executor core; annotate retired Teams carrier/surfaces |
| M6 | Cancelled superseded plan; stale staging note |
| N | Keep lifecycle/verdict/checker hardening |
| O | Backlog residual already delivered by E72/1085; reconcile duplicate pending promise |
| P | Keep decision catalogs/noun foundation; stage-specific workflow deferral superseded by P1 delivery |
| P1 | Keep decision production/adoption; inline decide compatibility has explicit one-release clock starting 2026-10-07; removal requires release evidence |
| P11 | Keep readiness/probe capability |

## Source leads for later phase

- Progress projection ambiguous same-kind definitions: branch marks candidate rows consumed yet diagnostic message names action rather than each row; investigate against O's every-row contract.
- Shared InboxService consumer integration, guest pull/settle, request receipts and Board sender identity after G11 require end-to-end source review.
- Historical one-release compatibility surfaces (H8 warning, I33 positional target, P1 inline decide, L1 builder pr alias) need release-specific removal decisions, not whole-feature deprecation.

Skipped exhaustive runtime tests and every historical linked task body in this read-only document phase. Risks: lifecycle statuses and legacy promises need CLI checks/current implementation evidence before mutation; this artifact is a proposal checkpoint, not a completion certificate.


## Appendix: Deterministic integrity review

## Feature corpus deterministic integrity audit — 2026-10-21
Read-only review. No repository mutation. Source-local CLI used for all enumerations, check, and sync preview. All 195 feature records and 1,267 tasks across all five registered folders included.

## Snapshots and outcomes
- Raw task snapshot: /tmp/spur-feature-review-all-tasks.json
- Alias-normalized task snapshot: /tmp/spur-feature-review-all-tasks-normalized.json (55 legacy feature-id aliases promoted only in snapshot)
- Feature snapshot: /tmp/spur-feature-review-features.json
- feature check --json: exit 1; /tmp/spur-feature-review-integrity-check.json; 141 PASS, 54 FAIL
- feature sync --all --dry-run --json: exit 0; /tmp/spur-feature-review-integrity-sync.json; 195 total, 189 evaluated, 0 updated
- Task statuses: {'done': 1168, 'cancelled': 70, 'blocked': 4, 'deprecated': 25}
- Feature statuses: {'active': 16, 'done': 134, 'verifying': 31, 'cancelled': 5, 'deprecated': 5, 'backlog': 4}
- INDEX.md lists all 195 records and matches every frontmatter status. No duplicate task WBS found.

The check and sync commands run for minutes, CPU-active, with empty stdout until their final JSON serialization. This was not a 5-second timeout. FeatureCheckService reads all registered task folders for each feature; sync similarly repeatedly collects tasks. Both commands completed; do not report them hung or green.

## Proposal table
| key | evidence | action | change | apply | verify |
| --- | --- | --- | --- | --- | --- |
| task:list:legacy-feature-alias | packages/app/src/services/task-query-ops.ts:37,122; task show 0041 has feature-id:F1 but feature_id:null; source-local task list --folder docs/tasks --feature F1 --json returns [] | task | Support legacy feature-id in show/list projection and feature filter; 55 existing records affected | Harness task + code fix | Regression for canonical/legacy keys; source-local F1 list returns 0041/0042/0043/0044/0045/0048 |
| feature:A:roster | docs/features/A_foundation.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1155 | spur feature refresh --feature A --json | Compare roster to normalized task edges |
| feature:A33:roster | docs/features/A33_repo-release-tooling-integrity-verified-binary-installs-and-single-source-generated-plugin-lib-bindings.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1143,1185 | spur feature refresh --feature A33 --json | Compare roster to normalized task edges |
| feature:D3:roster | docs/features/D3_workflow-run-reliability-defects-schema-resolution-shell-interpolation-headless-hitl.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: status 1256 testing→done, 1259 todo→done | spur feature refresh --feature D3 --json | Compare roster to normalized task edges |
| feature:D66:roster | docs/features/D66_workflow-consolidation-one-owner-per-lifecycle-d65-primitives-everywhere.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: extra 1253 | spur feature refresh --feature D66 --json | Compare roster to normalized task edges |
| feature:E2:roster | docs/features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1144 | spur feature refresh --feature E2 --json | Compare roster to normalized task edges |
| feature:E71:roster | docs/features/E71_disposable-run-scratch-with-durable-evidence-and-inspection.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1139,1140,1141,1145,1148,1149,1165 | spur feature refresh --feature E71 --json | Compare roster to normalized task edges |
| feature:F21:roster | docs/features/F21_consistent-task-creation-and-default-implementation-readiness.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1132,1137 | spur feature refresh --feature F21 --json | Compare roster to normalized task edges |
| feature:F3:roster | docs/features/F3_feature-management-cli.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1119,1126 | spur feature refresh --feature F3 --json | Compare roster to normalized task edges |
| feature:F43:roster | docs/features/F43_task-level-deprecated-status-frozen-but-retained-task-lifecycle-state-with-guarded-consumers.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: status 1189 testing→done, 1190 todo→done, 1191 todo→done, 1192 todo→done | spur feature refresh --feature F43 --json | Compare roster to normalized task edges |
| feature:F51:roster | docs/features/F51_review-confidence-certification-at-pipeline-pass-boundaries.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: status 1204 done→deprecated | spur feature refresh --feature F51 --json | Compare roster to normalized task edges |
| feature:F511:roster | docs/features/F511_retire-asserted-confidence-machinery-from-the-pipeline.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1207 | spur feature refresh --feature F511 --json | Compare roster to normalized task edges |
| feature:F7:roster | docs/features/F7_task-kanban-web-parity.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1162 | spur feature refresh --feature F7 --json | Compare roster to normalized task edges |
| feature:F91:roster | docs/features/F91_corpus-gate-integrity-content-verified-evidence-anchors-external-evidence-notation-ac-altitude-carve-out-and-a-two-sided-warning-ratchet.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1254; status 1153 todo→done | spur feature refresh --feature F91 --json | Compare roster to normalized task edges |
| feature:G1:roster | docs/features/G1_inbox-ipc.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1164,1168 | spur feature refresh --feature G1 --json | Compare roster to normalized task edges |
| feature:H16:roster | docs/features/H16_faster-default-quality-gate-while-keeping-per-file-90-90-coverage.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: status 1154 todo→done | spur feature refresh --feature H16 --json | Compare roster to normalized task edges |
| feature:K3:roster | docs/features/K3_project-registry-freshness-purge-non-existent-projects-kill-orphaned-serve-ports-and-clean-worktree-leftovers.md ## Tasks; task snapshot | doc or learning | Rebuild derived roster: missing 1156,1157 | spur feature refresh --feature K3 --json | Compare roster to normalized task edges |
| feature:F821:ac-format | feature check F821: L3.ac-bdd-error / L3.ac-bdd-invalid; Acceptance Criteria consists of R1 @core prose through R5 @edge | doc or learning | Preserve requirements and IDs while converting AC to recognized Gherkin syntax | spur feature update F821 --section "Acceptance Criteria" --from-file <approved-content> --json | feature check F821 --json |
| feature:E4:notes | feature check E4: L2.missing-required-section | doc or learning | Add missing Notes section if retained cancelled record needs normalization | spur feature update / check --fix (authorized structural scope) | feature check E4 --json |
| feature:I6:notes-level | feature check I6: L2.heading-level; Notes is level 3 | doc or learning | Normalize Notes to level 2 without changing history | spur feature check I6 --fix --json | feature check I6 --json |

16 stale rosters: A, A33, D3, D66, E2, E71, F21, F3, F43, F51, F511, F7, F91, G1, H16, K3. D66 extra task1253 actually belongs to D3; this is a stale roster, not an orphan task.

## Broken Markdown links
Nine links in four records use docs/... targets relative to docs/features, so links resolve under docs/features/docs/... and fail. Correct targets to ../tasksN/... using task show/path; no task file search needed.
- F82:73: `docs/tasks2/0322_decide-feature-status-derivation-rules-and-where-the-sync-lo.md`
- F82:75: `docs/tasks2/0323_decide-post-verify-feature-refresh-hook-placement-missing-fe.md`
- F82:77: `docs/tasks2/0324_decide-refresh-command-surface-single-dev-refresh-with-modes.md`
- I13:84: `docs/tasks5/1101_audit-native-todo-adoption-host-capability-matrix-and-observ.md`
- I13:88: `docs/tasks5/1102_prototype-the-two-layer-a-z-1-9-plan-projection-for-single-t.md`
- M:75: `docs/tasks2/0250_team-config-schema-shape-of-agent-team-id-name-work-dir-memb.md`
- M:77: `docs/tasks2/0251_member-identity-unify-member-id-across-inbox-recipient-agent.md`
- M:78: `docs/tasks2/0252_spur-team-up-down-materialize-roster-into-spur-agents-specs-.md`
- M:80: `docs/tasks2/0253_team-lifecycle-over-supervisor-self-drain-keep-alive-autosta.md`

## Historical current-ID heading drift
Eight H1 headings still display pre-restructure feature IDs. These are presentational historical labels, not missing records. Preserve heading anchors/history; annotate current identity through corpus-authorized section edits if useful rather than renumbering history.
- D1: H1 displays P
- F82: H1 displays R
- F821: H1 displays R1
- F822: H1 displays R2
- F9: H1 displays Q
- H5: H1 displays O
- J1: H1 displays K
- J2: H1 displays L

## Lifecycle preview and evidence gaps
15 proposed status movements, all stop at verifying due receipt issues:
- E5: active→verifying; L4.feature-receipt-stale
- D3: active→verifying; L4.feature-receipt-stale
- K3: active→verifying; L4.feature-receipt-missing
- E71: active→verifying; L4.feature-receipt-stale
- E2: active→verifying; L4.feature-receipt-missing
- G63: active→verifying; L4.feature-receipt-missing
- F7: active→verifying; L4.feature-receipt-missing
- F43: active→verifying; L4.feature-receipt-failed
- A: active→verifying; L4.feature-receipt-missing
- A33: active→verifying; L4.feature-receipt-failed
- G1: active→verifying; L4.feature-receipt-missing
- F21: active→verifying; L4.feature-receipt-missing
- B: active→verifying; L4.feature-receipt-stale
- F91: active→verifying; L4.feature-receipt-stale
- H16: backlog→verifying; L4.feature-receipt-missing

46 receipt-pending features; 29 missing, 14 stale, three failed. Failed receipts: A33, F42, F43. A verifying feature is not stale merely because all its implementation tasks are done: the completion proof is intentionally outstanding. H16 backlog→verifying is particularly non-mechanical: its History explicitly says the parallelism bar remains unresolved despite task1154 done. Do not auto-promote it.

Check errors are historical proof debt unless separate source evidence proves a bug. Never fabricate receipts, suppress guards, or retroactively claim tests ran. Error codes and affected features:
- L3.ac-bdd-error: 1 findings in F821
- L3.ac-bdd-invalid: 1 findings in F821
- L4.dogfood-missing: 38 findings in A1, A3, A4, A5, B2, B4, D2, D5, D7, E, F4, F5, F82, F821, F92, F94, H, H2, H3, H4, H5, H51, H52, H6, H7, H8, H81, H82, H83, H9, I1, I11, I12, I2, I8, I9, J9, N
- L4.evidence-not-recoverable: 59 findings in A1, A3, A7, D4, E1, E81, F71, F81, F822, F83, F9, G2, H12, H2, H5, H6, H7, H81, I1, J1, J7, K2
- L4.scenario-unverified: 249 findings in A1, A21, A3, A7, D2, D4, E1, E81, F71, F81, F822, F83, F9, G2, H12, H2, H4, H5, H6, H7, H81, H82, I1, I11, I12, J1, J4, J7, K2, N
- L4.verdict-rows-match-no-scenario: 25 findings in A21, D2, E1, F822, H4, H5, H6, I12, I2, J4, N

## Deprecated/cancelled feature task consistency
- C2 cancelled: 1202 cancelled
- E4 cancelled: no linked tasks
- F51 cancelled: 1204 deprecated
- G3 deprecated: 0197 deprecated, 0196 deprecated
- I5 deprecated: 0569 done, 0568 done, 0567 done
- M deprecated: 0256 deprecated, 0253 deprecated, 0252 deprecated, 0251 deprecated, 0257 deprecated, 0258 deprecated, 0250 deprecated, 0255 deprecated, 0254 deprecated
- M1 deprecated: 0264 deprecated, 0263 deprecated, 0261 deprecated, 0262 deprecated, 0260 deprecated, 0259 deprecated
- M2 deprecated: 0265 deprecated, 0268 deprecated, 0266 deprecated, 0267 deprecated
- M3 cancelled: 0269 done
- M6 cancelled: no linked tasks
I5 Notes explicitly retain 0567/0568/0569 as done historical evidence after command removal in0661. 0568 also fixed general pipeline size-gate/verdict/record/PATH/dogfood behavior that remains useful; blanket deprecation needs scope judgment, unlike sole-surface0567/0569. No live tasks under any deprecated/cancelled feature. No tasks depend on a deprecated task.

## Old unresolved work / missing historical feature edges
Four live tasks remain, all blocked:
- 0015: Plugin harness registry (AgentShim overlay); feature=F-5 plugin-system
- 0016: Plugin runtime sandboxing for curated and untrusted tiers; feature=F-5 plugin-system
- 0036: Web/desktop-notifier HITL responder (desktop done, web deferred); feature=None
- 0186: R2d probe — trivial pipeline smoke test (0182/0183); feature=None
0015/0016 target the obsolete F-5 plugin-system alias. Their dependencies are prose phase/external prerequisites, not resolvable WBS references. This is legacy intentional metadata rather than proof of deleted task files; inspect Superskill ownership before proposing cancellation/deprecation. 0036 mixes delivered desktop notifier and deferred web HITL/config selection. 0186 explicitly calls itself a disposable diagnostic probe, says no code change landed, and remains blocked since2026-07-03: propose cancelling/deprecating probe after confirmation rather than shipping its stale premise.
28 task feature edges target names absent from the current feature tree, mainly pre-restructure aliases. Map aliases using task semantics/history, never guess from similar IDs:
- F-3 agent-run: 0004 done
- F-4 app-services: 0008 done, 0009 done, 0011 done, 0005 done, 0010 done
- F-5 plugin-system: 0012 done, 0013 done, 0015 blocked, 0016 blocked, 0014 done, 0006 done
- F-6 team-mode: 0007 done
- F-rule: 0027 done
- S0: 0076 done
- S1: 0074 done, 0073 done, 0072 done
- S2: 0075 done
- S3: 0078 done
- S4: 0077 done
- S5: 0079 done
- W1: 0080 done
- W2: 0083 done, 0082 done
- W3: 0084 done
- W4: 0085 done
- W5: 0081 done

Skipped source implementation fixes and all corpus writes by assignment; content-level supersession judgment belongs to the other review groups. Risk: missing legacy proof cannot establish present implementation failure, and done tasks may contain useful behavior even when their original feature surface was removed.
