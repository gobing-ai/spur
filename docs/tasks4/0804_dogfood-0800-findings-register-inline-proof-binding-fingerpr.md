---
schema_version: 1
name: Dogfood 0800 findings register — inline proof binding, fingerprint globs, gate busy-retry, verify AC-id contract, and done-guard
status: done
template: issue
created_at: 2026-09-08T00:53:08.613Z
updated_at: "2026-09-08T19:40:15.872Z"

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

- [x] R1. Inline full-pipeline execution creates or safely attaches an authoritative workflow run identity at setup, using the resolved project-or-bundled workflow, current project DB, canonical definition digest and source/workdir metadata. The same identity reaches proof capture and bound run.artifact registration. Identical resume is idempotent; conflicting project/definition/run identity is refused rather than overwritten. Registration failures stop record according to the YAML policy; no unbound fallback or fabricated PASS.
- [x] R2. Dogfood monitoring does not change tracked report files while a pipeline proof window is open. Open the mirror before capture, append each observation to the existing ignored live ledger during certification, and sync/validate the mirror only after the final proof-sensitive action (including done/provenance checks), or after abort. Recover a missing/empty mirror from valid live content; missing live evidence cannot manufacture complete. Keep the existing proof exclusions; actual source, plan, report and authority-document changes remain detectable.
- [x] R3. All five existing SQLite retry classifiers in task-pipeline.yaml recognize raw database-locked errors, SQLITE_BUSY and the current path-bearing CLI busy message. Preserve each site's current retry count/delay and non-lock failure behavior. No timeout increase or retry framework.
- [x] R4. Verify answer production and lint use unambiguous AC identities. Producers copy the task's exact Scenario title or explicit checklist label/token. For scenario forms already documented by ac-style-guide, lint and downstream feature matching agree on exact/bare title, Scenario prefix, bracket tags and AC-N identity; ACn is accepted only when explicitly declared by a checklist. Resolve aliases to one canonical identity before detecting duplicates; ambiguous task/feature ordinal mappings fail with an actionable diagnostic. Paraphrases, invalid statuses/types and empty evidence remain rejected.
- [x] R5. Dogfood Phase 1 surfaces the existing isolated-worktree advisory when the driver or testee may mutate and the tree is dirty or the testee drives a pipeline. Include observe-only driver mode when the testee itself mutates. Do not infer a concurrent writer from dirtiness or add a new refusal gate; known concurrent writes still follow the project's one-writer rule.
- [x] R6. The record-to-done YAML guard checks the done target with --as done, so open checkboxes fail before entering the done state. Preserve the current task-update structural/verdict backstops and --no-lifecycle bookkeeping. No automatic checkbox completion.
- [x] R7. Dogfood Cost separates driver and chained usage with explicit measurement scope. Unknown cache splits yield unknown cache percentages, not observed zero-percent cache use; aggregate only comparable known inputs and disclose excluded/unknown rows. Cache-read counts may contribute hits; cache-creation/write counts never become hits. Keep heuristic estimates distinct from provider telemetry and avoid low-cache diagnoses based solely on missing data. Gate logs stay on disk; status and a bounded tail are the default context input, with targeted excerpts allowed to investigate failures.
- [x] R8. The route-reason shell action rejects unresolved interpolation and unsafe path components in a nonempty run id before creating its reason file. Preserve the empty-id pipeline-$wbs fallback and valid UUID/timestamp-slug forms. Invalid input exits nonzero without a reason artifact; do not claim the historic literal file identifies the current producer defect.
- [x] R9. Task-check subject extraction ignores complete parsed citation spans before scanning bare identifiers, so path fragments cannot become evidence subjects. Preserve actual symbols outside citations, stale-path/line-bound checks, terminal-record behavior and multi-anchor policy. Replace stale inline-driver advice to discard underscore paths with exact existing-file/range guidance; verifier docs require concrete anchors, with glob summaries expanded into concrete evidence.

Non-goals: task implementation during this refinement; new public CLI nouns/verbs; a second workflow engine; unbound proof registration; broad proof exclusions; host telemetry changes; speculative worktree guards; changes to 0803's watchdog. Former R10 is removed as duplicate and covered by R2.

### Acceptance Criteria

- [x] AC1 (R1): Given a real inline setup in an isolated fixture project, when bound record executes with current PASS stage evidence, then its authoritative run and artifact rows share the resolved definition identity. Identical attach/resume is idempotent; missing row, stale proof, mismatched definition/project and registration failure still refuse. Exercise the actual setup path, not only a manually inserted row.
- [x] AC2 (R2): Given a proof capture after both report artifacts open, when monitoring appends live rows, then the fingerprint and tracked mirror remain unchanged until certification ends. Finalize restores a removed/empty mirror from live and validates both artifacts; absent live evidence aborts. Editing a source file, tracked plan or report during the window still changes the fingerprint.
- [x] AC3 (R3): Given failing commands emitting the actual path-bearing errorMessage output, raw database-is-locked text, SQLITE_BUSY, or a non-lock error, when each retry shell snippet runs against stubs, then the lock cases retry within existing budgets and the non-lock case does not. A successful first attempt never retries. Pin all five YAML sites.
- [x] AC4 (R4): Given scenario and checklist fixtures plus linked-feature scenarios with different ordering, when lint processes canonical titles and documented aliases, then only uniquely resolved identities pass and alias-equivalent duplicate rows fail. Prefix/bracket/bare forms agree with feature verification. Undeclared ACn, paraphrases, invalid status/type and empty evidence fail; explicitly declared AC1 checklist tokens pass.
- [x] AC5 (R5): Given dirty mutating, clean pipeline-driving and observe-only-driver/mutating-testee examples, when Phase 1 is authored, then the advisory is visible without a new refusal or an unsupported concurrent-writer claim. A clean read-only run adds no warning.
- [x] AC6 (R6): Given a testing task with open Plan boxes, when the record-to-done guard runs, then it rejects before the done action. A compliant PASS task proceeds. A direct task update done --no-lifecycle remains protected by the existing target-aware check.
- [x] AC7 (R7): Given driver-only usage, known chained cache-read usage and unknown chained splits, when Cost is assembled, then scope and unknowns remain explicit, cache writes are not hits, and percentages use documented comparable denominators. Unknown usage alone generates no false low-cache finding. A large failing gate log is inspected via status/tail and targeted excerpts while remaining available on disk.
- [x] AC8 (R8): Given empty, valid UUID/slug, literal interpolation and traversal/path-separator run ids, when the extracted route-reason action executes in a temporary project, then only empty-fallback and valid ids write their expected paths; invalid ids fail without a reason artifact.
- [x] AC9 (R9): Given valid single anchors with snake_case/CamelCase filenames and no subject outside the anchor, when task check runs on live evidence, then no filename-based mismatch appears. A real absent symbol still reports mismatch; nonexistent files and invalid line ranges still report. Updated guidance preserves exact underscore-path citations and never treats a glob as a concrete anchor.

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

- [x] R1: Implement and test authoritative inline setup/attach through the existing workflow service/persistence seam; wire installed internal-script delivery and preserve failure/terminal behavior.
- [x] R2: Align the three dogfood protocol documents on live-only proof-window writes and final recovery/sync; verify fingerprint sensitivity remains intact.
- [x] R3/R6/R8: Correct the five retry classifiers, done target guard and route-id validation; run behavioral shell fixtures and existing proof-chain tests.
- [x] R4: Align producer examples, canonical identity resolution and feature compatibility; exercise scenario/checklist/ambiguous-alias/duplicate fixtures.
- [x] R5/R7: Surface the existing worktree advice, correct cache accounting and document bounded log inspection; validate representative report examples.
- [x] R9: Add filename-fragment regression coverage, fix shared subject extraction and replace stale evidence advice. Run the required T10 unsuppressed audit for this checker change.
- [x] Close: Run focused tests for changed seams, final project code gates once, source/install parity and relevant docs sync checks. Verify each retained requirement before recording implementation PASS; leave unchecked items open until evidence exists.

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:232` |
| `packages/app/src/services/task-check.ts:333` |
| `packages/app/src/services/task-check.ts:345` |
| `packages/app/src/services/task-check.ts:347` |
| `packages/app/src/services/task-check.ts:351` |
| `packages/app/src/services/task-check.ts:355` |
| `packages/app/src/services/task-check.ts:357` |
| `packages/app/src/services/task-check.ts:384` |
| `packages/app/src/services/task-check.ts:389` |
| `packages/app/src/services/task-check.ts:393` |
| `packages/app/src/services/task-check.ts:396` |
| `packages/app/src/services/workflow-service.ts:1716` |
| `packages/app/tests/services/task-check.test.ts:2920` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:2` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:345` |
| `plugins/sp/scripts/verify-answer-lint.ts:260` |
| `plugins/sp/scripts/verify-answer-lint.ts:313` |
| `plugins/sp/scripts/verify-answer-lint.ts:317` |
| `plugins/sp/scripts/verify-answer-lint.ts:319` |
| `plugins/sp/scripts/verify-answer-lint.ts:321` |
| `plugins/sp/scripts/verify-answer-lint.ts:375` |
| `plugins/sp/scripts/verify-answer-lint.ts:378` |
| `plugins/sp/scripts/verify-answer-lint.ts:440` |
| `plugins/sp/scripts/verify-answer-lint.ts:457` |
| `plugins/sp/scripts/verify-answer-lint.ts:466` |
| `plugins/sp/scripts/verify-answer-lint.ts:478` |
| `plugins/sp/scripts/verify-answer-lint.ts:479` |
| `plugins/sp/scripts/verify-answer-lint.ts:481` |
| `plugins/sp/scripts/verify-answer-lint.ts:507` |
| `plugins/sp/tests/verify-answer-lint.test.ts:447` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/inline-run-setup.ts:127` — `createOrAttachInlineRun`: resolve via shared `resolveWorkflowDefinition` `:136`, canonical digest, engine create via `DbWorkflowPersistenceAdapter` `:243-255` (fresh row `status: 'running'`, never synthetic done) + `runDao.stampRunIdentity` `:255` re-read this run; identity-checked attach refusals re-read at `:176` (no digest), `:184` (digest mismatch), `:193` (workflow name), `:205`/`:220` (source/workdir mismatch); fail-closed delegate `plugins/sp/scripts/inline-run-setup.ts:178-182` (result not ok → exit 1, no unbound fallback) re-read. Driver wiring `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:51-60` (delegate before any stage; missing script → fail closed with install remediation). Tests `cd packages/app && bun test tests/services/inline-run-setup.test.ts` → 10 pass / 0 fail this run. |
| R2 | MET | Proof-window discipline now consistent across the whole doc set, re-read this run: `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:31-38` rule 3 — live-only append from first proof capture to final proof-sensitive action incl. done/provenance checks, mirror frozen mid-window, abort sync, finalize recovery from valid live, "missing live evidence cannot manufacture complete"; `plugins/sp/skills/dogfood-testing/SKILL.md:189-191` — mirror mandate now "unconditional **outside** a pipeline proof window; **inside** one the mirror stays **frozen**"; `plugins/sp/skills/dogfood-testing/references/report-template.md:30` — "promoted on open + every step + finalize" now carries the identical proof-window exception with cross-link. Grep this run: no unconditional per-step mirror mandate remains (`SKILL.md:189` and `report-template.md:30` are the only hits, both carrying the exception). `DEFAULT_EXCLUDE_GLOBS` unchanged `packages/app/src/workflow/proof-input-fingerprint.ts:172` (existing exclusions kept per R2; reports stay tracked and detectable — the superseding Design/Q&A decision, not D2's original exclusion prescription). |
| R3 | MET | All five classifier sites re-read carrying the expanded path-aware alternation: `config/workflows/task-pipeline.yaml:346`, `:442`, `:558`, `:758`, `:805` (`database is locked |
| R4 | MET | `plugins/sp/scripts/verify-answer-lint.ts` re-read this run: `normalizeAcTitle` `:272-285` (bracket-tag/`Scenario:` strip loop), `buildAcIdentityIndex` `:305+` (checklist labels+tokens, task and feature ordinals), `resolveAcIdentity` `:339-380` (AC-N alias with ambiguity refusal naming both lists), canonical-key duplicate detection `:472-481`, invalid status/type and empty-evidence rejections `:483-489`; forms agree with `plugins/sp/skills/spur-dev/references/ac-style-guide.md:101-112` (four accepted forms + bracket tags) and the feature `AC-N` alias `packages/app/src/services/feature-check.ts:654-658`; permissive trailing-Gherkin fallback not adopted. Tests `cd plugins/sp && bun test tests/verify-answer-lint.test.ts --test-name-pattern "0804"` → 8 pass / 0 fail this run. |
| R5 | MET | `plugins/sp/skills/dogfood-testing/SKILL.md:435-437` — worktree advisory surfaced at Phase 1 for fix-mode dogfoods of pipeline-driving/mutating testees, "advisory, not a hard gate"; `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:52-63` re-read — planning-time surfacing whenever driver or testee may mutate and tree dirty, or testee drives a pipeline (including observe-only driver over a mutating testee); "Dirtiness alone is not proof of a concurrent writer and must not be reported as one"; one-writer rule preserved; "A clean, read-only run adds no warning". No new refusal gate. |
| R6 | MET | `config/workflows/task-pipeline.yaml:1033-1035` re-read — record→done guard `task check $wbs --as done` with verdict-PASS and proof-digest backstops preserved; `--as` is a real flag validated against TASK_STATUSES (`apps/cli/src/commands/task.ts:1364-1369` re-read); direct `task update done --no-lifecycle` still protected by the target-aware check (`apps/cli/src/commands/task.ts:1720`, `asStatus: targetStatus` re-read). R6 proof-chain test in the 5-pass run above. |
| R7 | MET | Unknown-bucket doctrine present in all three docs, re-read this run: `plugins/sp/skills/dogfood-testing/SKILL.md:213-220` (unobservable chained row → Fresh/Cached `~unknown`, excluded from cache% aggregate or surfaced as separate unknown bucket, never `Cached ~0`, mandatory `P3 — chained-step cost not observable`), `SKILL.md:303-306` (report cache% recomputable from observable ledger rows only), `SKILL.md:481-494` (driver/chained segmentation; observable chained rows count, `~unknown` excluded, never folded in); `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:102` (`~unknown` row carries `—`, never `0%`), `:119-123` (row formula + aggregate over observable rows only), `:148-157`/`:166-171` (unobservable chained usage → `~unknown` + P3), `:233-234` (worked example `round(2050/5750*100) = 36%` — arithmetic checked, P3 cache-health finding emitted); `plugins/sp/skills/dogfood-testing/references/report-template.md:161-181` (observable-rows-only aggregate, `~unknown` cells, mandatory Basis, no invented percentages) and `:136` (unobservable → `~unknown` + P3). Grep this run: remaining `~0` mentions are only the prohibitions themselves. Missing data now yields the observability P3 instead of a false low-cache finding; the estimate model counts only reused context as cached, so cache-creation is never a hit. |
| R8 | MET | `config/workflows/task-pipeline.yaml:283-288` re-read — empty id falls back to `pipeline-$wbs` `:285`; case-guard `:286` refuses `$`, `{`, `}`, `vars.`, `/`, `\`, `..` with nonzero exit before `REASON_FILE` construction `:287` (no reason artifact). Behavioral proof-chain test "empty falls back, valid ids write, unsafe ids fail without a reason artifact (R8)" — pass in the 5-pass run above. |
| R9 | MET | `packages/app/src/services/task-check.ts:341-356` re-read — `extractSubjectTokens` blanks every parsed citation span `:352-356` before all bare-identifier scans; multi-anchor 0688 R2 policy kept `:347-351`; independent line-anchor validation untouched. Tests `cd packages/app && bun test tests/services/task-check.test.ts --test-name-pattern "0804"` → 4 pass / 0 fail this run (`:2925` snake_case, `:2934` CamelCase, `:2941` multi-anchor, `:2949` real absent symbol still reports). Guidance re-read: exact underscore-path citations preserved `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:224-229`; concrete-anchor rule `plugins/sp/skills/code-verification/SKILL.md:145` and `plugins/sp/skills/code-verification/references/verdict-schema.md:119-124`. Residual: the T10 unsuppressed `corpus-check` audit for this checker-policy change is still not evidenced in `.spur/run/` — owned by the task's Close plan item (round-1 and round-2 review dispositions unchanged); it gates implementation PASS at close, not this requirement. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/inline-run-setup.test.ts:127+` — "AC1: setup creates the authoritative row, and bound run.artifact record then ACCEPTS the inline run": exercises the real `createOrAttachInlineRun` path (not a hand-inserted row), asserts row/workflow/digest/definitionSource identity; siblings pin idempotent attach, changed-definition refusal, resume-digest precedence, different-workflow/project refusals, malformed-metadata and pre-identity refusals, empty runId, unresolvable workflow — 10 pass / 0 fail this run (`cd packages/app && bun test tests/services/inline-run-setup.test.ts`). |
| AC2 [docs-only] | MET | static-ref | Protocol docs re-read this run: freeze window boundaries and live-only append incl. done/provenance scope and live-based finalize recovery `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:31-38`; mirror mandates conditional inside a proof window `plugins/sp/skills/dogfood-testing/SKILL.md:189-191` and `plugins/sp/skills/dogfood-testing/references/report-template.md:30`; tracked source/plan/report edits remain fingerprint inputs (exclusions unchanged, `packages/app/src/workflow/proof-input-fingerprint.ts:172`). Docs-authoring AC per Design R2 ("Update SKILL.md, monitor-ledger.md and report-template.md together") — evidence is the authored, mutually consistent content; no executable protocol surface was in scope, hence `[docs-only]` per the verdict-schema marker rule. |
| AC3 | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` --test-name-pattern "0804" — 5 pass / 0 fail this run: verbatim five-site alternation pin (`config/workflows/task-pipeline.yaml:346,442,558,758,805`), behavioral retry-once and quality-gate classifiers retry only lock-class failures (path-bearing busy message per `apps/cli/src/errors.ts:39-40`, raw locked text, SQLITE_BUSY; non-lock does not retry; first-attempt success never retries) within existing budgets (3×`sleep 2` `:347/:759/:806`, 2×`-ge 5`/`sleep 10` `:445-447`/`:561-563`). |
| AC4 | MET | test | `plugins/sp/tests/verify-answer-lint.test.ts` --test-name-pattern "0804" — 8 pass / 0 fail this run: scenario/bare titles resolve to one identity, alias-equivalent duplicates fail, undeclared ACn never a positional alias, AC-N with no ordinal fails actionable, AC-N resolves via linked-feature list when task declares none, ambiguous task/feature ordinal fails naming both, paraphrase never resolves, declared AC-1 checklist token resolves; rejection classes pinned in the lint (`plugins/sp/scripts/verify-answer-lint.ts:472-489`). |
| AC5 [docs-only] | MET | static-ref | Advisory authored and re-read this run: `plugins/sp/skills/dogfood-testing/SKILL.md:435-437` (Phase 1 worktree advisory, "advisory, not a hard gate") + `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:52-63` (dirty-mutating, clean pipeline-driving, observe-only-driver/mutating-testee cases; no unsupported concurrent-writer claim; clean read-only run adds no warning). AC is explicitly an authoring AC ("when Phase 1 is authored"); no executable surface in scope → `[docs-only]`. |
| AC6 | MET | test | Proof-chain R6 test (in the 5-pass run above) asserts the guard text and backstops; guard `config/workflows/task-pipeline.yaml:1033-1035`; `--as` validation `apps/cli/src/commands/task.ts:1364-1369`; `--no-lifecycle` target-aware backstop `apps/cli/src/commands/task.ts:1720`. |
| AC7 [docs-only] | MET | static-ref | Cost doctrine re-read this run: scope/unknowns explicit and cache writes never hits (`plugins/sp/skills/dogfood-testing/SKILL.md:213-220,303-306,481-494`; `monitor-ledger.md:102,119-123,148-157,166-171`; `report-template.md:161-181,136`); percentages use the documented observable-rows denominator with worked example arithmetic verified (`monitor-ledger.md:233-234`, 2050/5750 → 36% + P3). Unknown usage alone generates the observability P3, not a false low-cache finding. Gate-log rule: status/bounded tail default, targeted excerpts allowed, logs stay on disk (pre-existing D8 baseline). Docs-authoring AC per Design R7 ("Align cost instructions in dogfood SKILL.md, monitor-ledger.md and report-template.md"; sample calculations verified; validate-report.ts explicitly not claimed as accounting proof) → `[docs-only]`. |
| AC8 | MET | test | Proof-chain behavioral test "empty falls back, valid ids write, unsafe ids fail without a reason artifact (R8)" — pass in the 5-pass run above, executing the route-reason action in a temporary project: empty → `pipeline-$wbs`, valid UUID/timestamp-slug ids write expected paths, `$`/`{`/`}`/`vars.` and traversal/separator ids exit nonzero with no artifact; guard source `config/workflows/task-pipeline.yaml:283-288`. |
| AC9 | MET | test | `packages/app/tests/services/task-check.test.ts:2925-2953` — 4 pass / 0 fail this run: snake_case/CamelCase fragments never subjects, tokenless-path rows match, multi-anchor rows lose every citation span, real subject outside the anchor still reports. Stale-path/invalid-range and terminal-record behavior untouched (pre-existing coverage green in the implement-stage full gate 7827/0; not re-run this round per stage contract). Guidance re-read: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:224-229`, `plugins/sp/skills/code-verification/SKILL.md:145`, `plugins/sp/skills/code-verification/references/verdict-schema.md:119-124`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope:** cumulative worktree diff vs merge-base `main` (9e838f7d) — 15 modified + 3 new files. **Dimensions:** functional traceability, SECUA, architecture (`--auto`, all three). **Verdict: PARTIAL** — R2/R7 doc alignment incomplete (matches implement residual); R1/R3/R4/R5/R6/R8/R9 MET with specific evidence below. Spot verification this run: `inline-run-setup.test.ts` 10 pass / 0 fail; `task-pipeline-proof-chain.test.ts --test-name-pattern 0804` 5 pass / 0 fail; `task-check.test.ts --test-name-pattern 0804` 4 pass / 0 fail; `verify-answer-lint.test.ts --test-name-pattern 0804` 8 pass / 0 fail; `spur task check 0804` PASS (D12 advisory accepted).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | security | `plugins/sp/scripts/inline-run-setup.ts:98` | New delegate writes `.spur/run/<run-id>-inline-setup.json` without validating `--run-id` as a single safe filename component — the exact unsafe-id class R8 fixes at `config/workflows/task-pipeline.yaml:286`. An id carrying `/`, `..`, `$`/`{`/`}` traverses or writes unintended paths (likelihood low: the driver allocates uuidgen ids, but the threat model is the task's own). Remediation: apply the R8 refusal pattern (unresolved interpolation, separators, dot traversal) in the delegate before `writeOutcome`, with a traversal-refusal test. |
| P3 | correctness | `packages/app/src/services/inline-run-setup.ts:127` | Create path is non-atomic: engine `createOrAttachRun` then `RunDao.stampRunIdentity` are two statements; a failure between leaves a `{}`-metadata row that every later attach refuses as "pre-identity legacy" (`:176`). Fail-closed and safe, but recovery needs a new run id. Remediation: wrap both in one adapter transaction or compensate (delete the just-created row) on stamp failure. |
| P3 | correctness | `plugins/sp/scripts/inline-run-setup.ts:104` | `process.exit(0/1)` inside the `try` whose `finally { projectDb.close(); }` never runs — the close is dead on every exit path (WAL not checkpointed; crash-safe on next open, so cosmetic). Close before exiting or drop the misleading `finally`. |
| P3 | correctness | `plugins/sp/skills/dogfood-testing/SKILL.md:189` | R2 doc set not updated together (Design R2): `SKILL.md:189` still mandates per-step mirroring and `plugins/sp/skills/dogfood-testing/references/report-template.md:30` still says "promoted on open + every step + finalize", both now conflicting with the proof-window freeze at `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:31-38`. A driver following SKILL.md Phase 3 literally churns the tracked mirror mid-window. Same root cause as R2 PARTIAL row below. |
| P3 | correctness | `plugins/sp/skills/code-verification/references/verdict-schema.md:113` | Still documents the lint as exact-match-only ("AC ids that do not exactly match …"); since 0804 R4 the lint accepts the four ac-style-guide forms plus declared `AC-N`. Under-describes accepted forms — conservative direction, low impact; update the rejection-class list. |
| P4 | architecture | `config/plugin-scripts.json:40` | Design R1 "Cover installed-script delivery as well as repository execution" is narrowed to repo-only + fail-closed refusal with remediation on bundle-only installs. Safe (no unbound fallback, exactly R1's policy) and documented in the script header, but the deviation is not yet recorded in the task's Solution (record pending) — transcribe it there; if bundle-only inline pipelines are a supported surface, a follow-up must ship a bundled setup path. |
| P4 | architecture | `plugins/sp/scripts/verify-answer-lint.ts:272` | Bracket/`Scenario:` strip loop is duplicated verbatim in `normalizeAcTitle` and `resolveAcIdentity` (`:339`); `openInlineRunProjectDb` shadows the module-level `resolve` import with a dynamic re-import (`packages/app/src/services/inline-run-setup.ts:114-121`). Cosmetic only. |

**Architecture dimension:** no blocker/major candidates. Seam placement is correct — persistence rules live in packages/app (`packages/app/src/services/inline-run-setup.ts:127`) via the engine `DbWorkflowPersistenceAdapter` and `RunDao.stampRunIdentity` (conditional, identity-immutable: `packages/domain/src/dao/run-dao.ts:145`), the plugin script carries no SQL/hash/policy (D1, ADR-065 repo-only contract), and no new public CLI verb was added. Digest comes from the shared resolver (`packages/app/src/workflow/workflow-resolver.ts:229`), not a second hasher.

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/inline-run-setup.ts:127` — two-tier resolve + canonical digest + create-or-attach; identity-checked attach and refusals `:163-220`; fail-closed delegate `plugins/sp/scripts/inline-run-setup.ts:104`; driver wiring `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:51`; AC1 end-to-end bound-record acceptance `packages/app/tests/services/inline-run-setup.test.ts:127` (real setup path, not a hand-inserted row); idempotent attach tested. Bundle-only narrowing → P4. |
| R2 | PARTIAL | `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:31-38` — proof-window freeze, live-only append, finalize recover/validate. MISSING: the paired SKILL.md/report-template.md alignment the Design required (`SKILL.md:189`, `report-template.md:30` still unconditional per-step mirror) — see P3 finding. |
| R3 | MET | All five classifiers expanded `config/workflows/task-pipeline.yaml:346,442,558,758,805`; matches the actual `errorMessage` output `apps/cli/src/errors.ts:38`; verbatim + behavioral pins (busy retries, non-lock does not, first-attempt success never retries, budgets 3×`sleep 2`/2×`sleep 10`/`-ge 5`) in `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:378-463` — 5 pass this run. |
| R4 | MET | `plugins/sp/scripts/verify-answer-lint.ts:272,305,339,478` — canonical normalization, identity index, `AC-N` positional alias with ambiguity refusal, canonical-key duplicates; forms agree with `ac-style-guide.md:101` four forms and feature `AC-N` alias (`packages/app/src/services/feature-check.ts:657`); permissive trailing-Gherkin fallback correctly not adopted; 8 targeted lint tests pass this run. Doc drift → P3. |
| R5 | MET | `plugins/sp/skills/dogfood-testing/SKILL.md:431-437` + `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:52-60` — planning-time surfacing, observe-only/mutating-testee case, dirtiness ≠ concurrent writer, advisory non-gating, clean read-only adds no warning. |
| R6 | MET | `config/workflows/task-pipeline.yaml:1033` — guard now `task check $wbs --as done` (flag is real: `apps/cli/src/commands/task.ts:1362`), verdict-PASS and proof-digest backstops preserved `:1034-1035`; asserted by the R6 test this run; CLI `--no-lifecycle` target-aware backstop pre-existing (`task.ts:1720`). |
| R7 | PARTIAL | No diff evidence for the cost-accounting alignment; contradicted guidance remains: `SKILL.md:488-489` ("Cached = ~0" pessimistic marking for unknown basis, chained rows still counted into aggregate cache%) and `SKILL.md:217` ("Cached ~0" alternative), `monitor-ledger.md:102,119-121` formulas unchanged, `report-template.md` untouched — exactly the unknown-as-zero/false-low-cache pattern R7 rejects. Baseline partials only: driver/chained separation exists and bounded gate-log tails pre-exist (D8). |
| R8 | MET | `config/workflows/task-pipeline.yaml:286` — case-guard refuses `$`/`{`/`}`/`vars.`/separators/`..` with nonzero exit and no artifact; empty falls back to `pipeline-$wbs`; behavioral test covers empty/valid/unsafe/log-only-success this run. |
| R9 | MET | `packages/app/src/services/task-check.ts:353-355` — parsed citation spans blanked before all scans (multi-anchor 0688 R2 policy kept); real subjects/stale-path/range behavior preserved and tested (`packages/app/tests/services/task-check.test.ts:2920-2953`, 4 pass this run); stale underscore advice replaced `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:224-229`; concrete-anchor rule added `plugins/sp/skills/code-verification/references/verdict-schema.md:119-124` and `plugins/sp/skills/code-verification/SKILL.md:145`. |

**Residual risk:** the T10 unsuppressed `corpus-check` audit for the checker-policy change (R9) is not evidenced in `.spur/run/` — the close stage must run and record it before implementation PASS (task Plan owns this item). The P2 run-id validation gap ships unvalidated. R2/R7 completion is required before done; both are documentation-only and consistent with the implementer's declared residual.

**Final disposition:** review verdict PARTIAL — no blocker findings; P2 recommended for fix-forward in this task (small, in-pattern); P3s advisory. Implementation approach (app-service persistence, fail-closed delegate, CLI-gated YAML/docs changes) conforms to Design and D1–D12. Review-only run: no code repaired.

#### Round 2 — remediation verification addendum (2026-09-08T19:04Z, review-only)

Scope: verify the attempt-2 remediation hop against round-1 findings by reading current file contents (not the summary); delta review of the three touched areas for new issues. No repairs. Spot verification this run: `plugins/sp` guard tests 2 pass / 0 fail (5 unsafe forms + valid-id no-false-refusal); `packages/app` inline-run-setup tests 10 pass / 0 fail.

| Round-1 item | Disposition | Evidence (current file contents) |
| --- | --- | --- |
| P2 run-id validation gap | **RESOLVED** (fix-forward confirmed) | `plugins/sp/scripts/inline-run-setup.ts:69` `SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/` + `:71` `refuseUnsafeRunId()`, fired at `:136` before `resolveAppEntry`/`writeOutcome` — refusal writes no artifact (no `.spur` tree created). `plugins/sp/tests/inline-run-setup.test.ts` covers `../evil`, `a/b`, `$(id)`, `run..../../escape`, `..` (exit 1, `refusing unsafe run id`, no artifact) plus a valid id reaching the normal fail-closed resolver path (no false refusal); re-ran green this run. Guard is stricter than the YAML R8 guard (also refuses any leading dot, not only `..`/separators/interpolation) — fail-closed direction, same threat class. |
| P3 finding 4 — R2 doc pair | **RESOLVED** | `SKILL.md:189-193` Phase 3 mirror now conditional: unconditional only outside a proof window; inside one the mirror stays frozen (live rows only) until the window closes, then sync/validate with live-based recovery (cross-links monitor-ledger rule 3). The other dual-write mandates carry the same condition: `SKILL.md:42` (at-a-glance), `:297`, `:572`. `report-template.md:30` aligned with the identical exception + cross-link. Window boundaries live in `monitor-ledger.md:31-38` (first proof capture → final proof-sensitive action incl. done/provenance checks; abort sync; recover mirror from valid live at finalize write failure; missing live evidence cannot manufacture complete) — matches Design R2 ("end the freeze after done/provenance checks, not merely after record"). No unconditional per-step mirror mandate remains in the doc set. |
| R7 functional PARTIAL | **RESOLVED** | Unknown-bucket doctrine present in all three docs: `SKILL.md:217-220` (Phase 4 step 4: unobservable chained row → Fresh/Cached `~unknown`, excluded from cache% aggregate or surfaced as a separate unknown bucket, never `Cached ~0`, mandatory `P3 — chained-step cost not observable` finding), `SKILL.md:304-305` (report cache% recomputable from observable rows), `SKILL.md:481-494` (cost segmentation: observable chained rows count toward the aggregate; `~unknown` excluded, never folded in); `monitor-ledger.md:102` (`~unknown` row carries `—`, never `0%`), `:119-123` (row formula + aggregate over observable rows only), `:148-157`, `:168-169` (chained/unobservable usage → `~unknown` + P3); `report-template.md:117-137,161-181` (untouched in round 1, now aligned: Cost honesty rules, observable-rows-only aggregate, `~unknown` exclusion). Worked-example arithmetic correct (2050/5750 = 36%, P3 cache-health finding emitted). No contradictory `~0`/`0%` guidance remains (grep: only the prohibitions themselves). Heuristic-vs-telemetry distinction intact (`[~estimate]`/Method/confidence/`Meter: n/a`); the low-cache rule now operates on observable rows only, so missing data yields the observability P3 instead of a false low-cache finding (AC7). R7's cache-read-vs-creation clause has no contradicting text — the estimate model counts only reused context as cached. |
| P3 non-atomic create path | UNCHANGED | `packages/app/src/services/inline-run-setup.ts:244,253` — `createOrAttachRun` then `stampRunIdentity` still two statements, no transaction/compensation; fail-closed, recovery = new run id. Advisory. |
| P3 dead `finally` close | UNCHANGED | `plugins/sp/scripts/inline-run-setup.ts:188` — `process.exit(0/1)` still inside the `try`, so `finally { projectDb.close(); }` remains unreachable on every exit path. Cosmetic. |
| P3 verdict-schema doc drift | UNCHANGED | `plugins/sp/skills/code-verification/references/verdict-schema.md:113` still "AC ids that do not exactly match …"; under-describes the four ac-style-guide forms + declared `AC-N`. Conservative direction, low impact. |
| P4 bundle-only narrowing not transcribed to Solution | UNCHANGED | Solution section still placeholder (`<!-- Filled during implementation -->`); transcription still pending before close. |
| P4 duplicated strip loop / shadowed dynamic import | UNCHANGED | `plugins/sp/scripts/verify-answer-lint.ts:272,339` bracket/`Scenario:` strip loop duplicated verbatim; `openInlineRunProjectDb` still dynamically re-imports `node:path`/`node:fs`. Cosmetic. |

**New findings this round: none above P4.**

- P4 (cosmetic, new): `plugins/sp/tests/inline-run-setup.test.ts:8` header comment cites "Task 0804 R7/P2" — the guard mirrors the **R8** route-reason class; R7 is cost doctrine. Fix the label opportunistically.
- Informational: script guard class vs YAML R8 guard asymmetry (leading dot) — no action; fail-closed direction.

**Round-1 residual risk unchanged:** the T10 unsuppressed `corpus-check` audit for the R9 checker-policy change is still not evidenced in `.spur/run/`; the close stage must run and record it before implementation PASS.

**Round-2 disposition:** P2, P3 finding 4 (R2 pair), and the R7 functional partial are verified resolved against current file contents; the delta introduces no blocker/major findings. R1/R3/R4/R5/R6/R8/R9 remain MET per round-1 evidence (sources untouched by this hop except the three dogfood docs, the delegate guard, and the new guard test). Remaining open: P3×3 + P4×2 advisory (non-blocking), the new P4 label nit, and the T10 audit at close. Review-only run: no code repaired.

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

- 2026-09-08T17:23:56.173Z todo → wip (system)
- 2026-09-08T19:33:37.778Z wip → testing (system)
- 2026-09-08T19:40:15.872Z testing → done (system)

