---
schema_version: 1
name: Dogfood 0800 findings register — inline proof binding, fingerprint globs, gate busy-retry, verify AC-id contract, and done-guard
status: todo
template: issue
created_at: 2026-09-08T00:53:08.613Z
updated_at: "2026-09-08T15:12:03.846Z"

priority: P2
ac_altitude: task-local
---

## 0804. Dogfood 0800 findings register — inline proof binding, fingerprint globs, gate busy-retry, verify AC-id contract, and done-guard

### Background

Revalidated on 2026-09-08 against source HEAD d37c1f6b3c41f93117f9c0eaefab0c91ac7434a2 (release 0.3.76). The 0800/0795 dogfood reports are historical observations, not proof that the same cause remains today. This task retains actionable harness gaps with corrected solutions; refinement does not implement them.

| Original finding / requirement | Current disposition | Evidence and correction |
| --- | --- | --- |
| F1 / R1 inline proof binding | Retain; strengthen identity and delivery design | Inline Run setup allocates an id and task link but no authoritative workflow row. Bound registration correctly refuses missing/mismatched identity. A raw upsert or manually pre-seeded test is insufficient. |
| F2 / R2 report fingerprint churn | Retain outcome; replace broad exclusions | Reports are tracked proof inputs. Freeze the report mirror during certification and keep the live ledger current. Do not exclude entire report/plan trees. |
| F3 / R3 busy retries | Retain; fix the proposed regex | The actual message is `SQLite database .spur/spur.db is busy`. Even the original proposed `SQLite database is busy` pattern misses it. |
| F4 / R4 AC identity | Retain; narrow matching contract | Exact titles work today; producer examples use a prefix the lint rejects. Feature matching supports AC-N, not a general ACn positional alias. Preserve explicit checklist AC1 tokens without inventing aliases. |
| F5 / R5 worktree advice | Retain small documentation gap | Existing advisory should be surfaced at planning time, including when only the testee mutates. Dirty porcelain alone does not prove a second writer. |
| F6 / R6 done guard | Retain early-guard consistency; drop bypass claim | YAML lacks --as done, but task update --no-lifecycle already calls runDoneGateCheck with the target status. The late backstop exists. |
| F7-F8 / R7 cost and logs | Retain; correct accounting | Unknown cache use is not zero; cache creation is not a cache hit. Capture bounded log excerpts without preventing targeted failure investigation. |
| F9 / R8 route filename | Retain defensive validation; cause unproven | Current shell trusts a nonempty run id. Historical literal file does not prove a current engine interpolation regression. |
| F10 / R9 evidence anchors | Replace workaround with root-cause fix | Current checker intends to exclude citation paths, but its bare-identifier scan still extracts snake_case/CamelCase fragments from them. Globs are not concrete file anchors; underscores alone do not make a real anchor invalid. |
| F11 / former R10 mirror deletion | Drop as independent work; merge recovery edge into R2 | Existing protocol already uses live as SSOT and mandates final sync to both paths. No separate recovery system is needed. |

Related fixes 0800, 0801, and 0803 remain owned by their original tasks. In particular, retry classification is still needed after 0801; 0803 watchdog/lock work is not reopened. Historical task-status inventories and token estimates from the old session are not current acceptance evidence. No feature link is invented for this cross-cutting register.

### Requirements

- [ ] R1. Inline full-pipeline execution creates or safely attaches an authoritative workflow run identity at setup, using the resolved project-or-bundled workflow, current project DB, canonical definition digest and source/workdir metadata. The same identity reaches proof capture and bound run.artifact registration. Identical resume is idempotent; conflicting project/definition/run identity is refused rather than overwritten. Registration failures stop record according to the YAML policy; no unbound fallback or fabricated PASS.
- [ ] R2. Dogfood monitoring does not change tracked report files while a pipeline proof window is open. Open the mirror before capture, append each observation to the existing ignored live ledger during certification, and sync/validate the mirror only after the final proof-sensitive action (including done/provenance checks), or after abort. Recover a missing/empty mirror from valid live content; missing live evidence cannot manufacture complete. Keep the existing proof exclusions; actual source, plan, report and authority-document changes remain detectable.
- [ ] R3. All five existing SQLite retry classifiers in task-pipeline.yaml recognize raw database-locked errors, SQLITE_BUSY and the current path-bearing CLI busy message. Preserve each site's current retry count/delay and non-lock failure behavior. No timeout increase or retry framework.
- [ ] R4. Verify answer production and lint use unambiguous AC identities. Producers copy the task's exact Scenario title or explicit checklist label/token. For scenario forms already documented by ac-style-guide, lint and downstream feature matching agree on exact/bare title, Scenario prefix, bracket tags and AC-N identity; ACn is accepted only when explicitly declared by a checklist. Resolve aliases to one canonical identity before detecting duplicates; ambiguous task/feature ordinal mappings fail with an actionable diagnostic. Paraphrases, invalid statuses/types and empty evidence remain rejected.
- [ ] R5. Dogfood Phase 1 surfaces the existing isolated-worktree advisory when the driver or testee may mutate and the tree is dirty or the testee drives a pipeline. Include observe-only driver mode when the testee itself mutates. Do not infer a concurrent writer from dirtiness or add a new refusal gate; known concurrent writes still follow the project's one-writer rule.
- [ ] R6. The record-to-done YAML guard checks the done target with --as done, so open checkboxes fail before entering the done state. Preserve the current task-update structural/verdict backstops and --no-lifecycle bookkeeping. No automatic checkbox completion.
- [ ] R7. Dogfood Cost separates driver and chained usage with explicit measurement scope. Unknown cache splits yield unknown cache percentages, not observed zero-percent cache use; aggregate only comparable known inputs and disclose excluded/unknown rows. Cache-read counts may contribute hits; cache-creation/write counts never become hits. Keep heuristic estimates distinct from provider telemetry and avoid low-cache diagnoses based solely on missing data. Gate logs stay on disk; status and a bounded tail are the default context input, with targeted excerpts allowed to investigate failures.
- [ ] R8. The route-reason shell action rejects unresolved interpolation and unsafe path components in a nonempty run id before creating its reason file. Preserve the empty-id pipeline-$wbs fallback and valid UUID/timestamp-slug forms. Invalid input exits nonzero without a reason artifact; do not claim the historic literal file identifies the current producer defect.
- [ ] R9. Task-check subject extraction ignores complete parsed citation spans before scanning bare identifiers, so path fragments cannot become evidence subjects. Preserve actual symbols outside citations, stale-path/line-bound checks, terminal-record behavior and multi-anchor policy. Replace stale inline-driver advice to discard underscore paths with exact existing-file/range guidance; verifier docs require concrete anchors, with glob summaries expanded into concrete evidence.

Non-goals: task implementation during this refinement; new public CLI nouns/verbs; a second workflow engine; unbound proof registration; broad proof exclusions; host telemetry changes; speculative worktree guards; changes to 0803's watchdog. Former R10 is removed as duplicate and covered by R2.

### Acceptance Criteria

- [ ] AC1 (R1): Given a real inline setup in an isolated fixture project, when bound record executes with current PASS stage evidence, then its authoritative run and artifact rows share the resolved definition identity. Identical attach/resume is idempotent; missing row, stale proof, mismatched definition/project and registration failure still refuse. Exercise the actual setup path, not only a manually inserted row.
- [ ] AC2 (R2): Given a proof capture after both report artifacts open, when monitoring appends live rows, then the fingerprint and tracked mirror remain unchanged until certification ends. Finalize restores a removed/empty mirror from live and validates both artifacts; absent live evidence aborts. Editing a source file, tracked plan or report during the window still changes the fingerprint.
- [ ] AC3 (R3): Given failing commands emitting the actual path-bearing errorMessage output, raw database-is-locked text, SQLITE_BUSY, or a non-lock error, when each retry shell snippet runs against stubs, then the lock cases retry within existing budgets and the non-lock case does not. A successful first attempt never retries. Pin all five YAML sites.
- [ ] AC4 (R4): Given scenario and checklist fixtures plus linked-feature scenarios with different ordering, when lint processes canonical titles and documented aliases, then only uniquely resolved identities pass and alias-equivalent duplicate rows fail. Prefix/bracket/bare forms agree with feature verification. Undeclared ACn, paraphrases, invalid status/type and empty evidence fail; explicitly declared AC1 checklist tokens pass.
- [ ] AC5 (R5): Given dirty mutating, clean pipeline-driving and observe-only-driver/mutating-testee examples, when Phase 1 is authored, then the advisory is visible without a new refusal or an unsupported concurrent-writer claim. A clean read-only run adds no warning.
- [ ] AC6 (R6): Given a testing task with open Plan boxes, when the record-to-done guard runs, then it rejects before the done action. A compliant PASS task proceeds. A direct task update done --no-lifecycle remains protected by the existing target-aware check.
- [ ] AC7 (R7): Given driver-only usage, known chained cache-read usage and unknown chained splits, when Cost is assembled, then scope and unknowns remain explicit, cache writes are not hits, and percentages use documented comparable denominators. Unknown usage alone generates no false low-cache finding. A large failing gate log is inspected via status/tail and targeted excerpts while remaining available on disk.
- [ ] AC8 (R8): Given empty, valid UUID/slug, literal interpolation and traversal/path-separator run ids, when the extracted route-reason action executes in a temporary project, then only empty-fallback and valid ids write their expected paths; invalid ids fail without a reason artifact.
- [ ] AC9 (R9): Given valid single anchors with snake_case/CamelCase filenames and no subject outside the anchor, when task check runs on live evidence, then no filename-based mismatch appears. A real absent symbol still reports mismatch; nonexistent files and invalid line ranges still report. Updated guidance preserves exact underscore-path citations and never treats a glob as a concrete anchor.

### Q&A

Refinement decisions frozen at filing (2026-09-08) so the implementer inherits no open choices.

- **D1 — F1 persist, do not unbind.** Bound `proofBinding: current` stays fail-closed (0785 R3 / ADR-071). The defect is the missing `runs` row, not the refusal. Persistence is an internal plugin script (or workflow-service `createOrAttachRun` reused from a script), not a new public `spur` verb (harness-surface governance). `task run-link` is the wrong table.

- **D2 — F2 exclude generated-report trees only.** Add `docs/dogfood*`, `docs/plans*`, `docs/report*`. Do not exclude `docs/design/`, `docs/00`–`05`/`99`, `docs/help/`, or gitignored `.spur/**` (0612 pathspec pitfall). `docs/report/` is the directory that exists (not `docs/reports/`).

- **D3 — F3 match the remapped message; do not edit 0801.** The classifier expands; `errorMessage()` stays. 0803's watchdog is a different process (the wedged child); this slice is "retry when the message is busy, not only locked".

- **D4 — F4 both ends, paraphrases still fail.** Producer copies canonical titles. Lint gains the four ac-style-guide forms (including `AC-N` / `ACn` positional). A descriptive sentence that is not a label remains a hard fail — that is the 0800 resume cost we are preventing, not papering over.

- **D5 — F5 echo, do not refuse.** Task 0296 made the worktree advisory non-gating. Phase 1 prints it when porcelain is dirty or the testee is pipeline-driving. Parallel-session detection via `lsof` / process lists is out of scope (sandboxed CLIs may lack them; porcelain is enough).

- **D6 — F6 put `--as done` on the pipeline guard.** `task-lifecycle.yaml` is already correct; `--no-lifecycle` is why that YAML is skipped. Auto-flip remains a non-goal (0800 R1).

- **D7 — F7 report split only.** Host-platform cache fields are `[unverifiable]` and out of scope. Shipping a second Cost line is the feasible half of the report's own reframe.

- **D8 — F8 conservation rule, not a new meter.** The YAML already tails 40 lines on FAIL. The driver must not ingest the body.

- **D9 — F9 refuse unresolved literals.** Empty still maps to `pipeline-$wbs`. A string containing `$` / `{` / `}` / `vars.` is a failed action, not a creative filename.

- **D10 — F10 document at the producer.** L4 matcher unchanged. Glob / underscore paths become prose in verify answers, matching the Solution-table rule.

- **D11 — F11 restore from live.** The report's "no action beyond keeping live authoritative" is promoted to a finalize restore so a deleted report cannot abort a complete run.

- **D12 — no feature_id.** Cross-cutting harness register. `ac_altitude: task-local`. L4 missing-feature_id advisory accepted (same posture as 0801).

- **Dependencies / premises.** No prerequisite WBS. 0803 and 0801 are related but shipped; this task must not reopen them. Premises verified in Root Cause.

#### Q&A entry — 2026-09-08T15:12:03.845Z

2026-09-08 operator scope: evaluate/refine 0804 and 0805 against the reinstalled current version; correct/drop stale items and add substantiated findings; do not implement. Applied as semantic refinement even though structural task check already passed. Status remains todo; no implementation verdict is recorded.

Decisions: replace broad fingerprint exclusions with proof-window mirror discipline; merge former R10 into R2; retain early done guard while acknowledging the CLI backstop; replace underscore-path prose workaround with a confirmed shared extractor fix; reject invented ACn aliases and unknown-as-zero cache rates. These supersede the original frozen solution prescriptions.

### Design

This is the future implementation contract. The 2026-09-08 refinement changes task content only and does not certify implementation.

- R1: Keep workflow resolution, digest calculation and persistence in packages/app/domain, using the existing workflow persistence adapter and exported resolver/hash machinery. A thin internal plugin script may expose the setup operation through the existing ADR-065 script distribution path; no direct SQL in plugin code, raw RunDao.open substitute, silent conflicting upsert or second hasher. Return the authoritative id/digest to the inline var overlay. Attach only matching source/workdir/definition identity; changed-definition resume must use existing explicit resume rules. Record real lifecycle outcomes, never a synthetic completed row merely to satisfy binding. Cover installed-script delivery as well as repository execution.
- R2: Solve observer-generated churn in dogfood-testing's existing dual-artifact protocol, not DEFAULT_EXCLUDE_GLOBS. Read the actual YAML to identify the final proof consumer; end the freeze after done/provenance checks, not merely after record. Update SKILL.md, monitor-ledger.md and report-template.md together so per-step mirroring and proof-window freezing do not conflict. Final synchronization recreates the mirror from the valid live ledger and reports any write failure.
- R3/R6/R8: Work in config/workflows/task-pipeline.yaml and its existing proof-chain tests. Use a path-aware lock expression such as database is locked|SQLite database .*is busy|SQLITE_BUSY; test against errorMessage output, not a hand-shortened fixture. Retry-transient retains one retry after 2s; quality loops retain at most five attempts with 10s delays. Keep the YAML done guard and CLI backstop aligned. Validate the route id as a single safe filename component before constructing REASON_FILE; unresolved syntax, slash/backslash and dot traversal are invalid.
- R4: Compare extractAcIdentities in verify-answer-lint.ts with feature-check.ts rowMatchesScenario and ac-style-guide. Canonical task title/label is the preferred answer-file form. Preserve downstream compatibility, but do not import a private feature matcher or copy its permissive trailing-Gherkin fallback as a new authoring rule. Use canonical identity resolution for uniqueness. Feature ordinals must not silently refer to a differently ordered task AC list; ambiguous aliases require the title. Reuse the existing fixture-based lint tests and feature matching tests; no generalized parser framework.
- R5: Change the planning instruction and its existing examples only. Reuse pipeline detection and mutation classification; no new helper or flag is needed.
- R7: Align cost instructions in dogfood SKILL.md, monitor-ledger.md and report-template.md; reconcile conflicting numeric-only and unknown guidance. validate-report.ts currently checks report structure/cardinality, not cache arithmetic: do not claim it proves accounting correctness. Cover sample calculations and report-shape validation. Use existing log/status paths and bounded reads, without a blanket ban on necessary diagnostics.
- R9: Fix extractSubjectTokens at the shared checker seam: scan text with parsed anchor spans removed, rather than attempting to blacklist every filename fragment afterward. Keep independent line-anchor validation untouched. Update inline-pipeline-driver.md and code-verification evidence guidance to match. The new checker-policy change requires T10's explicit unsuppressed audit at implementation time; this task-only refinement requires affected-input checks under T11.

Future workflow edits and any public-surface changes retain the project's explicit authorization requirements. No permission for those mutations is implied by this requirements-only request. No new dependencies are prescribed.

### Plan

- [ ] R1: Implement and test authoritative inline setup/attach through the existing workflow service/persistence seam; wire installed internal-script delivery and preserve failure/terminal behavior.
- [ ] R2: Align the three dogfood protocol documents on live-only proof-window writes and final recovery/sync; verify fingerprint sensitivity remains intact.
- [ ] R3/R6/R8: Correct the five retry classifiers, done target guard and route-id validation; run behavioral shell fixtures and existing proof-chain tests.
- [ ] R4: Align producer examples, canonical identity resolution and feature compatibility; exercise scenario/checklist/ambiguous-alias/duplicate fixtures.
- [ ] R5/R7: Surface the existing worktree advice, correct cache accounting and document bounded log inspection; validate representative report examples.
- [ ] R9: Add filename-fragment regression coverage, fix shared subject extraction and replace stale evidence advice. Run the required T10 unsuppressed audit for this checker change.
- [ ] Close: Run focused tests for changed seams, final project code gates once, source/install parity and relevant docs sync checks. Verify each retained requirement before recording implementation PASS; leave unchecked items open until evidence exists.

### Root Cause

Current source evidence, distinguished from historical driver behavior:

- F1: inline-pipeline-driver.md Run setup has no workflow persistence/digest step; run-artifact.ts executeBound requires the authoritative row and digest. Its rejection is correct; historical drivers continuing after rejection violated the declared failure policy.
- F2/F11: proof-input-fingerprint.ts hashes tracked reports; dogfood monitor-ledger.md requires per-step mirror promotion and final retry from live. The conflict is observer write timing. Final mirror reconstruction is already implied by the existing SSOT/sync contract.
- F3: errorMessage produces the path-bearing busy string. A read-only Bun probe on 2026-09-08 confirmed the old proposed regex returns false and the path-aware expression returns true.
- F4: verify-answer-lint.ts checks exact identity-set membership. code-verification examples emit Scenario-prefixed ids, while feature-check accepts additional normalized title/AC-N forms. Neither a paraphrase nor a universal ACn positional alias is justified by that feature contract.
- F5/F7/F8: the worktree advice, separate chained rows and log files exist. Remaining gaps are when advice is surfaced and inconsistent cost/unknown accounting; log size alone does not measure provider cache efficiency.
- F6: task-pipeline.yaml has a current-status guard, but apps/cli/src/commands/task.ts invokes runDoneGateCheck for --no-lifecycle and passes asStatus: targetStatus. The old assertion that this flag bypasses all structural enforcement is false.
- F9: the shell accepts a nonempty run id without filename validation. The original literal artifact's producer/version is unverified.
- F10: extractSubjectTokens excludes full citation/path tokens, then scans the original row for bare identifiers. A read-only probe of a minimal row citing docs/help/cmd_example.md:12 returned cmd_example plus r1. citedLinesNameSubject can therefore reject an otherwise valid row solely because of the filename. Existing tokenless-path coverage uses workflow.ts and misses this case. Multi-anchor/terminal suppression already exists and must remain.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Current-source anchors (checked 2026-09-08 at d37c1f6b3):
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:49` — setup; `:206` — stale filename advice.
- `packages/app/src/workflow/actions/run-artifact.ts:324` — authoritative identity refusal.
- `packages/app/src/services/workflow-service.ts:698` — canonical definition digest injection.
- `packages/domain/src/dao/run-dao.ts:37` — open allocates its own id; not inline identity persistence.
- `packages/app/src/workflow/proof-input-fingerprint.ts:172` — current exclusions.
- `apps/cli/src/errors.ts:37` — actual busy diagnostic; 0805 R4 owns diagnostic wording, 0804 R3 owns retry behavior.
- `config/workflows/task-pipeline.yaml:277` — route id; `:338`, `:434`, `:550`, `:750`, `:797` — retries; `:1020` — done guard.
- `apps/cli/src/commands/task.ts:532` and `:1702` — independent target-aware transition backstop.
- `plugins/sp/scripts/verify-answer-lint.ts:260` and `:361` — AC extraction and membership.
- `packages/app/src/services/feature-check.ts:1067` — feature identity matcher; `plugins/sp/skills/spur-dev/references/ac-style-guide.md:101` — documented forms.
- `packages/app/src/services/task-check.ts:334` and `:1490` — token extraction and live-anchor matching.
- `packages/app/tests/services/task-check.test.ts:2905` and `:3578` — existing coverage to extend.
- `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:28` — live SSOT and mirror retry; `:126` — unobservable usage.
- `plugins/sp/skills/dogfood-testing/SKILL.md:201` — finalization; `:478` — cost segmentation.
- `plugins/sp/scripts/dogfood-testing/validate-report.ts:61` — report validator's actual scope.
- Historical evidence: docs/dogfood/2026-09-07-dev-run-0800-dogfood.md and docs/dogfood/2026-09-07-sp-dev-run-0795-auto-next-agent-inline-dogfood.md.
- Governance: docs/99_PROJECT_CONSTITUTION.md T10/T11; docs/design/harness-surface-governance.md; ADR-065 internal-script delivery.

### History
