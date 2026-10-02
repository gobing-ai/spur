---
kind: report
title: E71 run-storage ownership and one-off cleanup audit (task 1024)
created_at: 2026-09-30
task: 1024
feature: E71
base_sha: ac4b201e3661ee55e4f60f4f97f11e10225400e9
branch: sp/runall-e71-a0ce
mutation_policy: none (evidence-only; no production source, tests, workflows, plugin surfaces or CLI modified)
---

# Run-storage ownership and one-off cleanup audit

Task 1024 deliverable. Audits every producer and consumer of `.spur/run/` artifacts, classifies
artifact lifetimes per [ADR-131](../00_ADR.md) and
[disposable-run-storage.md](../design/disposable-run-storage.md), and classifies every one-off
deletion. This is an audit: nothing here changes storage behavior. Current locations remain in
force until tasks 1025–1027 implement.

## 1. Scope, method, and regenerated counts

Primary inputs: the [E71 brainstorm](../plans/2026-09-30-run-scratch-brainstorm.md), the accepted
storage design, `packages/app/src`, `apps/cli/src`, `apps/server/src`, `plugins/sp`,
`config/workflows`, `scripts/commands`, and their tests. Generated CLI config
(`apps/cli/config`, produced by `build:bundle`) and plugin `.mjs` twins were excluded as derived
surfaces (§7).

Saved search receipts (`run-reference-inventory.txt`, `cleanup-candidates.txt`) were **absent** in
this execution tree, so all scans were regenerated at base `ac4b201e`. Per the task contract the
dated discovery numbers (2,378 reference lines / 153 cleanup candidates) describe the earlier
discovery, not a pass threshold. Regenerated observations at base `ac4b201e`:

| Scan (command family) | Scope | Result |
| --- | --- | --- |
| `rg -n '\.spur/run'` over scoped src+tests, `!**/*.mjs` | packages/app, apps/cli, apps/server, plugins/sp, config/workflows, scripts/commands + tests | 1,466 matching lines |
| same, src-only (non-test, non-generated) | 56 files reference `.spur/run` or a computed join |
| computed joins `join(...,'run')` / `'.spur','run'` | src only | 35+ sites beyond literal paths (§5) |
| `runDir\|runRoot\|runLogDir` identifiers | src only | 23 files |
| workflow YAML artifact names `\.spur/run/\S+` | 8 workflow files | 428 mentions, 102 distinct filename families (with `$__runId`/`$wbs`/shell-var prefixes collapsed per §5) |
| deletion calls `rmSync\|unlinkSync\|rm -f\|rm -rf` near run/verdict/answer/status/tmp names | src + workflows | 33 sites classified (§4) |

Callers of every computed helper were traced (`resolveRunArtifactPath`, `readWorkflowRunRecord`,
`blockedStateFile`, `featureReceiptPaths`, `workflowPlanArtifactPath`, `inlineRunRecordLogPath`,
`defaultVerdictRunDir`), including config-provided overrides (`--verdict-dir`, `--verdict-file`,
`--from-answer`, `--from-file`, `workflow.logRetentionDays`, `agent.output` log bounds). The
escalation-packet family has **no source reader** and is carried as an explicit unmatched-consumer
row (§9), not silently dropped.

Live runtime observation in this tree: `.spur/run/` currently holds `inline-1024-233245.md`,
`inline-1024-233245.state.json`, `inline-1024-233245-precheck-roles.status`,
`inline-1024-233245-route-reason.txt`, `inline-1024-233245-script-root.json`, and
`1024-base.sha` — one live instance each of the pair family (D), plugin status family (G), and
base-sha family (G). No cleanup was run against them or any real project data.

## 2. Taxonomy (from ADR-131 and design §3)

Lifetime values (task R2): `attempt` (lives inside one workflow attempt), `run` (lives for the
duration of the run and its direct consumers), `recoverable` (must survive pause/resume and
interrupted recovery), `lasting` (evidence/inspection that must survive completed-scratch
disposal), `recomputable` (cache whose deletion forces recomputation, never acceptance failure).

Dispositions:

- **Durable owner** — moves to `.spur/memory/evidence/` (verdicts, receipts), `.spur/memory/runs/`
  (pairs, registered artifact bytes, agent sessions), or tracked `## Testing` (coverage). Owner
  tasks 1025/1026.
- **Scratch (stays)** — attempt/run-lifetime signals, status files, prompts, counters, handoffs;
  confined to `.spur/run/` by design.
- **Recomputable cache (stays or follows existing cache owner)** — deletion causes recomputation.
- **Legacy/migration** — existing data reconciled by `workflow clean` extension (1027/1026).

R3 one-off deletion classes: **freshness invalidation** (delete-before-dispatch/retry),
**atomic-publication cleanup** (`.tmp` failure unlink), **terminal housekeeping** (age-based
reclamation), **unrelated temporary storage** (system tmp, report retention, checkpoint
reclamation, test teardown).

## 3. Family inventory (R1+R2)

Legend: **W** = writer(s), **C** = consumer(s); all paths repo-relative; lifetimes per §2.

### 3a. Lasting structured evidence → owner 1025 (destination `.spur/memory/evidence/`)

| # | Family / artifact | W | C | Lifetime | Existing deletion | Disposition / destination | Test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Task verdict JSON `<wbs>-verdict.json` (canonical, with `proof` block) | `apps/cli/src/commands/task.ts:1329-1330` (`task verdict`/`record` emit); service default `packages/app/src/services/task-service.ts:1412`; proof stamp `config/workflows/task-pipeline.yaml:685` (atomic `$V.tmp`→`mv`); verify-hop producer invocation `config/workflows/task-pipeline.yaml:679` (`spur task verdict --from-answer`); wayfinder verify hop `config/workflows/wayfinder-resolution.yaml` (verdict write after fresh verify) | done gate `packages/app/src/services/done-transition-guard.ts:103-106` (deny messages hardcode path at :289,:320); CLI done guard wiring `apps/cli/src/commands/task.ts:630` (`--verdict-dir`, default `join(cwd,'.spur','run')`); task L4 check `packages/app/src/services/task-check.ts:1836-1837`; feature scenarios + F93 fallback `packages/app/src/services/feature-check.ts:840,988-1000` (fallback `parseTesting` at `packages/app/src/services/task-record.ts:307`, wired `feature-check.ts:846-870`); analytics `packages/app/src/services/verified-outcome.ts:208` (verdict/`proof.digest`/`proof.runId`/`proof.definitionDigest`); corpus check/sweep `packages/app/src/services/corpus-check.ts:102`, `corpus-sweep.ts:111`; server guard `apps/server/src/context.ts:412,482`; feature-service check `packages/app/src/services/feature-service.ts:493`; suppression mtime vector `packages/app/src/services/feature-sync-suppression.ts:97-98`; pipeline remediation `config/workflows/task-pipeline.yaml:440,772,1105,1135`; plugin fold `plugins/sp/scripts/residual-scan.ts:128-129`; wrapup verdict read `plugins/sp/scripts/wrapup-steps.ts:365`; checkpoint footer cites it `config/workflows/task-pipeline.yaml:806`; lifecycle gate description `config/workflows/task-lifecycle.yaml:39` (two-layer done gate referencing the CLI verdict guard) | **lasting** (verdict + proof identity) | Removed by wayfinder pre-verify invalidation (§4 W6) | Durable evidence root, existing filename retained (design §3) | `packages/app/tests/services/task-check.test.ts`, `done-transition-guard.test.ts`, `feature-check.test.ts`, `verified-outcome.test.ts`, `task-verdict.test.ts`, `verify-verdict.test.ts`, `apps/cli/tests/commands/task.test.ts`, `plugins/sp/tests/residual-scan.test.ts` |
| A2 | Feature verification receipts: run-scoped `<runId>-feature-verification.json`, feature-latest `<featureId>-feature-verification.json`, `.log`, `.status` | `packages/app/src/workflow/feature-verification-receipt.ts:32-36,99-131,167-218` (atomic temp+rename inside runDir :137,183); plugin glue `plugins/sp/scripts/feature-verification-steps.ts:172-243` (paths at :212,:220) | workflow guards `config/workflows/feature-verification.yaml:62,77` (status gate PASS); receipt readers resolve via `featureReceiptPaths` (:124-131, :342, :354) | **lasting** (run binding, latest receipt, scenario identity) | None found | Durable evidence root, existing filenames retained | `plugins/sp/tests/feature-verification-steps.test.ts`, `feature-verification-steps-mode.test.ts`, `feature-verification-scope.test.ts`, `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts` |
| A3 | Feature-sync blocked state `feature-sync-blocked-<id>.json` (+ verdict-mtime vector) | `packages/app/src/services/feature-service.ts:684-713` (via `blockedStateFile` `packages/app/src/services/feature-sync-suppression.ts:62-63`) | suppression replay `packages/app/src/services/feature-sync-suppression.ts:9,97-98`; feature-service read-back :675-681 | **recomputable** (derived cache keyed by input fingerprint; comment `feature-sync-suppression.ts:9`) | Cleared on non-BLOCKED outcome `feature-service.ts:696-703` (§4 W10) | May stay in scratch per design §3 (deletion must not weaken acceptance or cause invalid transitions); redirect verdict-mtime inputs with A1 | `packages/app/tests/services/feature-sync-suppression.test.ts` |

F93 distinction (task premise): the tracked `## Testing` fallback (`parseTesting`,
`packages/app/src/services/task-record.ts:307`; consumed `feature-check.ts:846-870`) is
**implemented** and stays the portable coverage representation. It covers *missing* artifacts only;
the structured verdict remains authoritative whenever present, and analytics proof fields
(`verified-outcome.ts:208-232`) and the done gate (`done-transition-guard.ts`) have no tracked
fallback — those are the remaining structured-proof dependencies 1025 must migrate.

### 3b. Retained records, bytes, sessions → owner 1026 (destination `.spur/memory/runs/`)

| # | Family / artifact | W | C | Lifetime | Existing deletion | Disposition / destination | Test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Run-record pair `<runId>.md` + `<runId>.state.json` | engine sink `packages/app/src/observability/workflow-run-log-sink.ts:47-57,180-232` (state atomic temp+rename, `.tmp` unlink on failure :228); inline setup/driver `packages/app/src/services/inline-run-setup.ts:752-765` (atomic :796-804), header `:862-886` | shared reader `packages/app/src/workflow/run-record.ts:118-149` (pair wins over legacy log); inspection `packages/app/src/services/workflow-service.ts:1630-1634`; artifact ref probe `packages/app/src/services/agent-service.ts:2533-2540`; CLI tail `apps/cli/src/commands/workflow.ts:2022,2050-2063` (legacy→md switch 0926 R3); sink construction `apps/cli/src/commands/workflow.ts:888-898,1245-1256` (`--no-log` opt-out :533,:1060); persist-out copies pair `packages/app/src/services/inline-run-setup.ts:243-249`; `outputArtifactForRun` metadata link `workflow-service.ts:2196-2207`; provenance note in provenance doc `packages/config/src/index.ts` config docs | **lasting** (retained pair; `.state.json` is projection, DB trace authoritative) | `.md`/`.state.json` NOT reclaimed by clean (scope comment `workflow-service.ts:919-926`); pair copied out of worktrees before disposal (`inline-run-setup.ts:243-455`) | `.spur/memory/runs/<runId>.md` + `.state.json`, written directly there (design §3) | `packages/app/tests/services/workflow-service.test.ts`, `inline-run-setup.test.ts`, `inline-run-driver.test.ts`, `persist-worktree-runs.test.ts`, `apps/cli/tests/commands/workflow.test.ts`, `plugins/sp/tests/run-record-catalog.test.ts`, `inline-run-installed.test.ts`, `inline-run-trace.test.ts`, `inline-run-close-reason.test.ts` |
| B2 | Legacy run log `<runId>.log` | legacy sink (pre-pair) + trace-failure recorder `packages/app/src/workflow/action-trace.ts:412-433` (append emission failures; same filename as legacy log) | read fallback in `run-record.ts:149` and `inline-run-setup.ts:862-869` (pair wins, log fallback) | **lasting→legacy** (migration; readers only diagnostic after migration) | Age-based reclamation `packages/app/src/services/workflow-service.ts:919-962` (age only; documents that an old active log is reclaimed "rare, and acceptable") — §4 T1 | Migrate under `.spur/memory/runs/<runId>.log`; reclamation follows migrated root with active-ownership protection (design §4/§5) | `packages/app/tests/services/workflow-service.test.ts`, `plugins/sp/tests/run-record-catalog.test.ts` |
| B3 | Registered artifact registrations + bytes (`run.artifact`) | registration `packages/app/src/workflow/actions/run-artifact.ts:20,105,232` (path-only or proof-bound; calls confiner); workflow uses `config/workflows/task-pipeline.yaml:717` (verdict), `config/workflows/idea-pipeline.yaml:191` (feature id) | DB `ArtifactDao` rows; byte reader for HITL summaries `packages/app/src/services/workflow-service.ts:1949` (`resolveRunArtifactPath` + registered-path match + read); metadata readers via `ArtifactDao` | registrations **lasting** (DB); bytes currently scratch, **lasting** when retained | None for bytes | `.spur/memory/runs/<runId>/artifacts/<original-basename>`; persist accepted bytes before durable reference; validate run id; basename conflict fails visibly (design §3) | `packages/app/tests/workflow/actions/run-artifact.test.ts` |
| B4 | Agent session histories `.spur/run/<runId>/agent-sessions/<agent>/` | `packages/app/src/workflow/actions/agent-run.ts:558-592` (session dir join, both affinity and non-affinity paths) | history import discovery `packages/app/src/services/history-service.ts:481-519` (`runSessionAugmentedRoots`), prefix mapping :588-591 | **recoverable** then **lasting** (resumable sessions; import must finish before disposal) | None found | `.spur/memory/runs/<runId>/agent-sessions/<agent>/`; no folder move under a running process (design §3) | `packages/app/tests/services/history-service.test.ts`, `packages/app/tests/workflow/actions/agent-run.test.ts` |
| B5 | Worktree persist-out: cited + owned `.spur/run` evidence | copy obligation `packages/app/src/services/inline-run-setup.ts:243-455` (citations :171-231 regex, cap `:208` (64), comment :204, owned-prefix enumeration :256-304, conflict refusal :360-455) | invoking tree task files citing `.spur/run/<file>` (merged task docs); driver routes WT-5 on refusal | **lasting** (green-run evidence guarantee; copy before worktree disposal) | Copy is additive; no deletion | Destination families (A1/B1) become durable; citation/ownership enumeration must resolve durable paths (1026 with 1025) | `packages/app/tests/services/persist-worktree-runs.test.ts`, `plugins/sp/tests/inline-pipeline-driver.test.ts` |
| B6 | Planning handoff batch/result/order/ready/report `<runId>-idea-{task-batch.json,task-order.json,batch-create-result.json,handoff.md,ready.json}` | idea-pipeline stages `config/workflows/idea-pipeline.yaml` (batch create :464-470) | validator/consumer `packages/app/src/workflow/idea-handoff.ts:106-139,435` (fail-closed on missing batch/result/order) | **lasting** at handoff (feature + tasks must exist before scratch removal) | Retry invalidation §4 W2 | Final handoff report registered durably before scratch removal (design §6 "planning handoff gets durable registration") | `packages/app/tests/workflow/idea-handoff.test.ts`, `idea-handoff-cli.test.ts`, `plugins/sp/tests/idea-handoff-script.test.ts` |

### 3c. Attempt/run scratch (stays in `.spur/run/` under ADR-131) — no relocation

| # | Family (representative filenames) | W | C | Lifetime | Notes |
| --- | --- | --- | --- | --- | --- |
| C1 | Pre/post-exit signals: expectFile/answerFile/escalationFile targets (e.g. `<wbs>-verify-answer.txt`, `<runId>-idea-feature-id.txt`, `<runId>-idea-eval-report.md`, `<wbs>-question.md`) | agent stages write them (`config/workflows/task-pipeline.yaml:674`; `config/workflows/idea-pipeline.yaml:138,138-191`); answer lint reads `.spur/run/<wbs>-verify-answer.txt` per `packages/app/src/services/verify-answer-lint.ts:7` and CLI `apps/cli/src/commands/task.ts:1264` (`--from-answer` default) | post-exit checks `packages/app/src/workflow/actions/agent-run.ts:1080-1160`; escalation detection :1087; CLI verdict derivation `task.ts:1264-1330` | attempt | Delete-before-dispatch is freshness protection (§4 W7/W8); answer file is an *input* to the durable verdict, verdict itself is A1 |
| C2 | Retry/attempt counters: `<runId>-idea-{ac,decompose}-retry-count`, `<wbs>-test-fix-attempt`, `<wbs>-escalation-count`, `<runId>-idea-design-reject-count`, `<runId>-correction-count` | shell stages `config/workflows/idea-pipeline.yaml:224,397`; `config/workflows/task-pipeline.yaml:440`; residual fold `plugins/sp/scripts/residual-scan.ts:213-222` | same stage guards | attempt | `attemptFile` truncation in quality-gate `packages/app/src/services/quality-gate.ts:557-562` |
| C3 | Gate/status files: `<wbs>-test-gate.{log,findings,status}`, `<wbs>-check-receipt.json`, `<wbs>-light-gate.log`, `<runId>-*-status` (pr-review ×7, wrapup ×5, wayfinder ×2, history-anatomy, feature-verification, idea) | quality gate `packages/app/src/services/quality-gate.ts:27,437-440,555-667`; plugin twin `plugins/sp/scripts/quality-gate.ts:46-53`; stage shells (workflows) | guards route on status tokens (`config/workflows/feature-verification.yaml:62,77`); receipt digest reuse `quality-gate.ts:272` | attempt (receipt is an identity+digest check receipt, not durable evidence) | Light-gate artifacts `quality-gate.ts:437-441` |
| C4 | Prompts/inputs/intermediates: `<runId>-idea-{input.md,goal.md,scope.md,candidate.md,recommendation.txt,needs-design.json,design-route.txt,precheck-doctor.status,ac-check.status,ac-ready.status,ac-content.md,ac-done.txt,design-check.status,design-review.md,eval-report.md}`, wayfinder `{input.json,answer.md,status.txt,precheck/final.status}`, pr-review `{request,collect,preflight,precheck,hygiene,findings,ensure,push,wait,status,since,head,context}.json/.txt/.status`, `<runId>-{paths.txt,validation.txt,publishable.md,provenance.json,mode.txt,drift-probe.json,route-reason.txt}` | workflow stages (8 YAML files; full filename census in §5 alias table) | subsequent stages in the same run | attempt/run | `file.read-into-var` designed for these (`packages/app/src/workflow/actions/file-read-into-var.ts:28`) |
| C5 | Wrapup capture set: `<runId>-wrapup-tasks.json`, `-route-reason.txt`, `-wrapup-resolve.status`, `-drift-probe.json`, `-wrapup-{metrics,sync,feature-verify,learnings,doc-tripwire,repair}.status` | `plugins/sp/scripts/wrapup-steps.ts:129-132,213-236,316-319,469-470`, `plugins/sp/scripts/wrapup-drift-probe.ts:189-193` | wrapup stages `config/workflows/wrapup-pipeline.yaml` (55 refs); learnings/metrics append durably to `.spur/memory/` (`wrapup-pipeline.yaml:215,288-301,352,456`) | run | Durable outputs already land in `.spur/memory`; capture JSON is scratch |
| C6 | Residual/diffstat/base set: `<wbs>-base.sha`, `<wbs>-diffstat.json`, `<wbs>-residuals.json`, `<wbs>-residual-deferrals.json`, `<wbs>-residual-background.md`, `<wbs>-residual-report.md`, `<wbs>-test-gate.findings`, `<wbs>-{triage,failure-class}.decision`, `<wbs>-{taskpath,featurepath,report,priority}.txt` | `plugins/sp/scripts/task-diffstat.ts:147-179`, `plugins/sp/scripts/residual-scan.ts:93-222` | task-pipeline stages; verdict fold (`residual-scan.ts:143-147`); task file §Notes citations | run | `<wbs>-base.sha` is the anchored base for diffstat (`task-diffstat.ts:6-8`) |
| C7 | History-anatomy run scratch: `<runId>-history-anatomy-{baseline,current}.{json,md}`, `<runId>-history-anatomy-run.id`, `<runId>-selector.json`, `<runId>-cache-disposition.txt`, baseline `{validate,enrich,correct}.txt` | `config/workflows/history-anatomy.yaml` (55 refs); selector observation `plugins/sp/scripts/history-anatomy-cache.ts:141-150` (written only after validation; "historical selector files … are not consumed") | plugin history-anatomy steps; report published atomically via `packages/app/src/services/history-anatomy.ts:867-884` to report targets (not scratch) | run | Published report + retention live in `.spur/reports/history` (§8 U2) |
| C8 | Workflow plan artifact `<runId>-workflow-plan.json` | `apps/cli/src/commands/workflow.ts:238,330-341` (redacted preview written pre-run) | async-run inspection; plan preview into sink (:888-898) | run | Run-scoped (0768 R2) |
| C9 | Script-root record `<runId>-script-root.json` | `plugins/sp/scripts/script-root.ts:119-128` | `config/workflows/feature-verification.yaml:62` (mode/source resolution later in the same run) | run | |
| C10 | Escalation packet `<runId>-escalation.json` | `packages/app/src/observability/escalation-packet-sink.ts:65,121,206` | **no source reader found** — advisory projection (§9 X1) | run | |
| C11 | verifyall batch input `.spur/run/verifyall-batch-input.json` | agents per skill prose (`plugins/sp/skills/spur-cli/references/tasks.md:239-243`, `references/tasks/verbs.md:388`) | `apps/cli/src/commands/task.ts:1357` (`--from-file` default) | attempt | Default path is a documented contract (`docs/design/run-record-contract.md:142`) |
| C12 | Doctor cache `.spur/run/agent-doctor.json` | `packages/app/src/services/agent-service.ts:2613,2698,608` | doctor output :574-625; server health projection `apps/server/src/modules/health/index.ts:194-206` | **recomputable** (TTL 60 s; fingerprint-keyed) | Stays per design §3 (deletion ⇒ recomputation) |
| C13 | Partial-work preservation `<runId>-<node>-partial.md` | `packages/app/src/services/workflow-service.ts:2549-2552`; named in failure message `packages/app/src/workflow/actions/agent-run.ts:1108-1116` | failure inspection readers | run | Failure evidence with run binding; candidate for retained-family review in 1026 |
| C14 | Eval-pipeline fixture scratch (self-dev) | `scripts/commands/eval-pipeline.ts:40,50,259,412,504-543` (reads gate outcomes per `{wbs}` from run dir of isolated fixture worktrees) | eval report | attempt (fixtures cleaned in `finally`, R4) | `scripts/commands/eval-pipeline.test.ts` |

### 3d. Confinement and identity seams (must hold unchanged; design §5, R5)

| Seam | Location | Binding |
| --- | --- | --- |
| Run-scratch physical confinement (symlink/boundary) | `packages/app/src/workflow/actions/run-path.ts:5,22-53,64-76,125` | callers: `run-artifact.ts:105,232`, `command-gate.ts:123`, `workflow-service.ts:1949` |
| Command-gate result confinement | `packages/app/src/workflow/actions/command-gate.ts:41,72,113-123` | scratch-only by design (design §3: "Command-gate output confinement remains scratch-only") |
| Doctor-probe result confinement | `packages/app/src/workflow/actions/doctor-probe.ts:51,71,91-98` (boundary-compare rejects `.spur/run-evil`, `.spur/run2`) | status token under `.spur/run` (`packages/app/src/workflow/builtins.ts:120`) |
| Run id as single safe path segment | `packages/app/src/workflow/run-record.ts:16,253-264` (rejection of traversal-shaped ids); `plugins/sp/scripts/inline-run-setup.ts:33`; `agent-run.ts` safe-id reuse | all `<runId>`-keyed families |
| Citation parsing / root-qualified exclusion | `packages/app/src/services/inline-run-setup.ts:217-231` | persist-out (B5) |
| Gitignore scoping of `.spur/run*` out of proof digests | `packages/app/src/workflow/actions/../proof-input-fingerprint.ts:234` | proof freshness |
| Relative-path check for expect/answer files (0689) | `packages/app/src/workflow/actions/agent-run.ts:845-861` | C1 |
| Durable destinations are NOT inside the scratch confinement | design §3/§6 | 1025 must add an explicit allowed destination for evidence (widening scratch confinement is rejected) |

## 4. One-off cleanup classification (R3)

| # | Site | What it deletes | Class | Disposition |
| --- | --- | --- | --- | --- |
| W1 | `config/workflows/idea-pipeline.yaml:224` | stale `<runId>-idea-ac-content.md`, `<runId>-idea-ac-done.txt` + writes retry count | freshness invalidation | Keep; candidates for removal only if attempt identity makes stale reuse impossible (design §5; decide in 1027 with regenerated proof) |
| W2 | `config/workflows/idea-pipeline.yaml:397` | stale batch/order/sentinel/result/handoff/ready files before decompose retry | freshness invalidation | Keep (protects B6 handoff truthfulness); revisit under attempt identity |
| W3 | `config/workflows/idea-pipeline.yaml:464` | `$P.failed`, `$P-result.json`, `$P-result.json.tmp` before batch-create | freshness invalidation + atomic-publication cleanup | Keep |
| W4 | `config/workflows/idea-pipeline.yaml:470` | `$P-result.json.tmp` on failure branch | atomic-publication cleanup | Keep |
| W5 | `config/workflows/task-pipeline.yaml:249` | `<wbs>-question.md` after appending the Q/A pair to escalation log | freshness invalidation (question-consumption ordering; disarms escalate edge, comment :240-242) | Keep — ordering and old-question re-trigger protection |
| W6 | `config/workflows/wayfinder-resolution.yaml:99` | `<runId>-wayfinder-verify-answer.txt` + `<wbs>-verdict.json` before fresh verify | freshness invalidation | Keep for scratch; **note**: deleting the verdict also destroys prior attempt's A1 evidence — after 1025 the durable copy is authoritative and the scratch delete remains freshness-only; an old PASS must never satisfy a new attempt |
| W7 | `packages/app/src/workflow/actions/agent-run.ts:327-337` (fleet) and `:830-843` (single) | expectFile exists-before-dispatch | freshness invalidation | Keep or replace with equally strict attempt identity (design §5) |
| W8 | `packages/app/src/workflow/actions/agent-run.ts:809-824` | escalationFile before dispatch (incl. fleet path) | freshness invalidation | Keep |
| W9 | `packages/app/src/services/quality-gate.ts:608,619` | `${logFile}.probe` and `attemptLogPath` intermediates | atomic-publication/fold cleanup (local scratch) | Keep; consolidation only if proven redundant after disposal contract (brainstorm disposition) |
| W10 | `packages/app/src/services/feature-service.ts:696-703` | resolved feature-sync blocked state | derived-cache invalidation (not terminal) | Keep |
| W11 | `packages/app/src/services/inline-run-setup.ts:796-804` | `<runId>.state.json.tmp` on failure | atomic-publication cleanup | Keep (0926 R1) |
| W12 | `packages/app/src/observability/workflow-run-log-sink.ts:226-231` | `<runId>.state.json.tmp` on failure | atomic-publication cleanup | Keep (0926 R1) |
| W13 | `packages/app/src/services/history-anatomy.ts:867-884` | `${target}.tmp` on failed report publication | atomic-publication cleanup (report target, not run scratch) | Keep; unrelated to `.spur/run` lifetime |
| W14 | `plugins/sp/scripts/residual-scan.ts:203` | consumed deferral entries file during fold | terminal housekeeping (fold consumes staging deferrals) | Keep (semantic consumption, not space reclamation) |
| T1 | `packages/app/src/services/workflow-service.ts:932-962` + CLI `apps/cli/src/commands/workflow.ts:1308-1340` | legacy `<runId>.log` older than retention (age-only; no active-run guard) | terminal housekeeping (existing `workflow clean --logs`) | Reconcile in 1027: follow migrated legacy-log root, protect active ownership, leave retained pairs alone (design §4/§5); no public surface change (operator-consented extension) |
| T2 | `packages/app/src/services/workflow-service.ts:cleanCheckpoints` (called `workflow.ts:1340`) | `.spur/memory/sessions` checkpoints past retention | terminal housekeeping — outside `.spur/run` | Out of scope; unchanged |
| U1 | `packages/app/src/services/quality-gate.ts:528-541` | `tmpdir()/spur-quality-gate-*` shell-output dir | unrelated temporary storage | Keep, out of scope |
| U2 | `packages/app/src/services/history-service.ts:1661-1692` (`pruneReports`) + symlink pointer `:1500-1507` | `.spur/reports/history/<date>` past retention; `latest.json` relink | unrelated (report retention) | Keep, out of scope |
| U3 | `packages/app/src/workflow/proof-input-fingerprint.ts:260`, `agent-run.ts:1741` | alternate git index files in tmpdir | unrelated temporary storage | Keep |
| U4 | `plugins/sp/scripts/residual-scan.ts:11,67` (settle mode) | `/tmp/<wbs>-*` staging residue | unrelated temporary storage | Keep |
| U5 | `scripts/commands/script-contract-check.ts:372,412`, `plugin-install-smoke.ts:92,112`, `verify-pack.ts:85`, `eval-pipeline.ts:201` | self-dev tmpdirs/fixture trees | unrelated temporary storage (self-dev tooling) | Keep |
| U6 | Test teardown `rmSync` of isolated roots (e.g. `scripts/commands/command-contract.test.ts:172-938`, `plugins/sp/hooks/pi/guard-extension.test.ts:241-260`) | fixture temp dirs | unrelated (test fixtures) | Keep |

No unclassified deletion candidate remains: every `rm`/`unlink` site reachable from the
regenerated scans is classified above or explicitly listed as unrelated (U1–U6).

## 5. Computed paths, config-provided roots, and shell-variable aliases

Computed path helpers (all call-sites traced): `resolveRunArtifactPath`
(`run-path.ts:37`), `readWorkflowRunRecord` (`run-record.ts:118`), `featureReceiptPaths`
(`feature-verification-receipt.ts:124`), `blockedStateFile` (`feature-sync-suppression.ts:62`),
`workflowPlanArtifactPath` (`apps/cli/src/commands/workflow.ts:238`), `inlineRunRecordLogPath`
(`inline-run-setup.ts:867`), `defaultVerdictRunDir` (`feature-check.ts:1199`; comment :1196-1197, flat layout
`<root>/tasks → <root>/.spur/run`), `runSessionAugmentedRoots` (`history-service.ts:495`).

Config/CLI-provided scratch roots (override the default; must keep working after relocation only
where they name durable families): `task done --verdict-dir` (`task.ts:467,630`), `task verdict
--verdict-file` (`task.ts:1184`), `--from-answer` (`task.ts:1264`), `--from-file` (`task.ts:1357`),
`FeatureCheckOptions.runDir` (`feature-check.ts:187-188`, CLI `feature.ts:460-461,677`), server
`ctx.runDir` (`apps/server/src/context.ts:164-165,412`), `workflow.logRetentionDays`
(`packages/config/src/index.ts:764`).

Shell-variable aliases in workflows (each resolves to a named family above; exhaustive list of
composed names at base `ac4b201e`): `$V` = `<wbs>-verdict.json` (`task-pipeline.yaml:685`);
`$MF` = `<wbs>-mode.txt` (`task-pipeline.yaml:550`); `$REASON_FILE` = `<runId>-route-reason.txt`
(`task-pipeline.yaml:209`); `$P` = `<runId>-idea-batch-create{,-result.json,.done,.failed}`
(`idea-pipeline.yaml:464-470`); `$P.failed` sentinel; `"$P-result.json.tmp"` atomic temp; `$S`
(`feature-verification.yaml:62`) = script-root resolved script path (reads
`<runId>-script-root.json`); `$LEARNINGS_FILE` → `.spur/memory/learnings.md` (durable, not
scratch). Every `$__runId-…`/`$wbs-…` mention maps to families C1–C7; the 102 distinct YAML
filename families are the union of the named families above with these prefixes.

## 6. Parity and generated surfaces (not independent owners)

- Plugin `.mjs` twins of every script in §3c/§3b (`plugins/sp/scripts/*.mjs`) are generated through
  the plugin build owner; installed copies follow. They are parity consumers (ADR-130/131), to be
  regenerated when source contracts change (1025–1027), never edited independently.
- `apps/cli/config` workflow bundle mirrors `config/workflows/` via `build:bundle` — parity only.
- `packages/domain/src/analytics/verified-outcome.ts:39` documents the verdict-artifact input shape
  (interface comment; the read happens in `packages/app/src/services/verified-outcome.ts:208`).
- `apps/web/tests/modules/projects/responsive.test.tsx:6` mentions a `.spur/run/g63-projects/…`
  browser-check runner — prose comment describing agent-authored scratch (family C4 pattern); no
  code dependency.

## 7. Docs and prose consumers (grouped; exhaustive file list)

Documentation that names `.spur/run` locations must be updated in the same commit as the location
change (T3) by the owning task. Files (reference counts at base `ac4b201e`):

- **Design/authority**: `docs/design/run-record-contract.md` (22; owns current record locations),
  `disposable-run-storage.md` (2), `planning-workflow-contracts.md` (16), `planning-record-contracts.md` (4),
  `planning-command-contracts.md`, `workflow-run-log.md`, `workflow-execution-economy.md`,
  `workflow-composition-contract.md`, `workflow-catalogue-refactor.md`, `task-residual-sweep.md`,
  `task-creation-readiness.md`, `spur-artifact-evolution.md`, `session-pinned-dispatch.md`,
  `inter-agent-control-plane.md`, `history-cli-contracts.md`, `history-anatomy.md`,
  `fleet-config-declaration.md`, `feature-check-strict-ac-satisfaction.md`,
  `essential-workflow-checks.md`, `e2e-workflow-for-system-development.md`,
  `dev-spine-cost-and-drift.md`, `dev-refactor-command.md`, `dev-agent-flag-and-dogfood-skill.md`,
  `data-output-contracts.md`, `workflow-shell-ownership.md`, `docs/00_ADR.md` (ADR-131).
- **Plugin skills** (`plugins/sp/skills/`): `spur-dev` (SKILL 2 + 10 reference files, heaviest
  `execution-batch.md` 36 — worktree export/handoff contract), `code-verification` (SKILL 20 +
  verdict-schema 3 + secu-review 1), `spur-cli` (workflows 6, tasks 8+6+1+1, features 1, agent 1),
  `dogfood-testing` (SKILL 7 + report-template 4 + monitor-ledger 1), `wrapup`-adjacent
  `inline-pipeline-driver.md` (12; per-stage artifact inventory), `idea-evaluation.md` (4),
  `gate-checklists.md` (5), `cross-cutting.md` (5), `dev-operations.md` (6), `execution-workflow.md` (3),
  `flag-glossary.md` (3), `planning-workflow.md` (9), `done-housekeeping.md` (3), glossary/ac-style/
  decision-brief (1 each), `spur-check` (2), `brainstorm` (2), `code-refactoring` (2+2+schema 1),
  `spec-decomposition` (2), `next-router` (3), `wayfinder` pipeline-resolution (1),
  `issue-finding` session-formats (1), `history-anatomy` report-contract (1),
  `parallel-execution` dispatch-surface (1), `spur-composer` (1).
- **Plugin commands/agents**: `dev-run.md` (3), `dev-verify.md` (2), `dev-refresh.md`,
  `dev-idea.md`, `dev-fixall.md` (1 each), `agents/super-planner.md` (4).

## 8. Unrelated temporary storage verified (not cleanup scope)

Verified in source: quality-gate tmpdir shell capture (U1), history report pruning + latest
symlink (U2), proof/scope git-index tmpfiles (U3), residual `/tmp` staging settle (U4), self-dev
tmpdirs (U5), test teardowns (U6), project-registry lock dir (`packages/app/src/services/project-registry.ts:324,337`).

## 9. Unresolved / unmatched candidates (explicitly carried, not dropped)

| # | Candidate | Status | Required decision/owner |
| --- | --- | --- | --- |
| X1 | `<runId>-escalation.json` (escalation packet) has **no source reader**; only the sink writes it (`escalation-packet-sink.ts:121,206`) | Advisory projection by design (comment :65); classified `run` scratch | No ownership decision blocks 1025. If 1026 treats packets as retained coordination evidence, it must name a durable destination; otherwise packet stays scratch. Flagged, not silently classified as disposable-by-omission. |
| X2 | W6 deletes the *only* copy of the prior verdict until 1025 lands | Current behavior preserved | 1025 must publish durable evidence before any scratch-removal claim; wayfinder invalidation then deletes only the scratch copy. No policy change made here. |
| X3 | T1 reclaims old active `.log` (age-only) | Existing policy, documented in-code (`workflow-service.ts:919-926`) | 1027 reconciles with active-ownership protection; operator already consented to the `workflow clean` extension context (ADR-131). |
| X4 | C13 partial-work `.md` has run binding and failure evidence value; design §3 does not name it | Classified `run` | 1026 decides retained-vs-scratch when it owns record families. |
| X5 | Dated discovery receipts (`idea-run-scratch-20260930-9f41c7-*`) absent in this tree | Regenerated scans substitute (§1); receipts optional per task | None. |
| X6 | `readGateOutcomes` (`eval-pipeline.ts:412-415`) globs `{wbs}`-patterned gate outcome files by directory listing | Fixture-scoped (isolated worktree run dirs) | Self-dev only; no product ownership. |

No other unmatched or dynamic candidate remains from the regenerated scans: every literal and
computed reference site found in §1 scans is either classified in §3/§4, resolved by the §5 alias
table, or listed above.

## 10. Scenario coverage (task R1–R4 + design R5, AC1)

| Req | Scenario | Status | Where covered |
| --- | --- | --- | --- |
| R1 | Trace every direct and computed run-storage producer and all consumers (app/CLI, workflows, plugins, tests, server, config-provided paths) | **Covered** | §1 scans + §3 W/C columns + §5 computed/config roots; all caller modes listed per family |
| R2 | Classify each artifact lifetime and record durable destination or removable/recomputable disposition | **Covered** | §2 taxonomy + §3 lifetime/disposition columns (102 distinct workflow filename families folded into named families with §5 alias completeness) |
| R3 | Classify every one-off deletion (freshness invalidation / atomic publication / terminal housekeeping / unrelated temporary) | **Covered** | §4 W1–W14, T1–T2, U1–U6 — 33 sites, all classified |
| R4 | Publish persistent ownership inventory + regression mapping; no unclassified candidate silently disposable | **Covered** | This report §3–§5, §9; unmatched consumers carried as X1–X6 |
| R5 (design §5/§6) | Preserve freshness/confinement semantics; identify proven-redundant cleanup without executing it | **Covered as audit** | §3d seam inventory; §4 keeps every correctness-dependent deletion, removes nothing; disposal regression scenarios enumerated for 1027 (brainstorm §5 decisive regression + design §6 integration check) |
| AC1 | Every run storage dependency and cleanup site has a disposition | **Covered** | §3 families + §4 deletions + §9 explicit unresolved rows; nothing silently dropped |

Not done by design: no behavior verification, no migration, no deletion on real data, no product
diff (`requireDiff` untouched), no source edits (mutationPolicy none).

## 11. Handoff

- **To 1025** (durable task/feature evidence): families A1, A2 (+A3 inputs); required paths and
  readers in §3a; F93 fallback boundary documented §3a; confinement note §3d (evidence destination
  needs its own explicit allowed root); parity surfaces §6.
- **To 1026** (retained pairs/artifacts/sessions/exports): families B1–B6 (+C13 decision, X1
  packet); handoff/export ordering in §3b.
- **To 1027** (disposal + cleanup reconciliation): §4 deletion rows (keep-set W1–W12, W14;
  reconcile T1), X2/X3 preconditions, decisive regression scenarios in §10 R5 row.
- Docs ownership for path changes: §7 file list (T3 same-commit rule).

## 12. Verification record

- Scans regenerated at base `ac4b201e3661ee55e4f60f4f97f11e10225400e9` on branch
  `sp/runall-e71-a0ce` (isolated worktree; main tree untouched): literal, computed-join, identifier,
  YAML-artifact, and deletion scans (§1 table).
- Caller tracing performed for all exported path helpers and config-provided roots (§5).
- No tests run (no code changed); no cleanup executed; no `.mjs` twins or generated config edited.
- Candidate-set equality check: 56 non-test source files + 8 workflow YAMLs + self-dev scripts
  enumerated; every located site mapped to a family in §3 or a row in §4/§9.

## 13. Force verification corrections (2026-10-01)

The original inventory is a historical audit, not proof that every current run-storage dependency
has been retired. A fresh source census was regenerated with
`rg -n --glob '*.ts' --glob '*.yaml' --glob '*.md' '\.spur/run|runStoragePaths|runSessionsDir|runArtifactsDir|runRoot|runLogDir'`
over app/CLI/server source, portable plugin surfaces, workflows and self-development scripts.
The invoking verification retains the rows as `.spur/run/E71-current-storage-census.txt`.
There is no executable candidate-to-classified-location equality check in this report; the earlier
file-count statement alone does not prove exhaustive producer/consumer coverage. R1 remains PARTIAL.

Current unresolved ownership and regression mapping:

| Dependency | Current disposition | Required closure |
| --- | --- | --- |
| Corpus sweep verdict discovery | Still scans scratch rather than durable evidence | Redirect the existing discovery seam; verify identical sweep inputs after scratch removal (1025 R2) |
| Feature-sync suppression verdict mtime vector | Still scans scratch | Include canonical evidence changes in invalidation without letting absent scratch change acceptance (1025 R2) |
| Retained legacy artifact/session migration | Copies bytes but has no metadata-redirection or settled-importer port | Redirect owner references and prove importer obligations before claiming disposable data (1026 R4) |
| Worktree result export | Carries records with skipped-conflict outcomes; durable evidence is not a complete transferred family | Require truthful failure and repairable replay before teardown (1026 R3; existing follow-up 1043) |
| Session-history disposal regression | Existing decisive test compares retained session bytes | Execute the real late importer and compare imported history, feature acceptance and producer outcomes (1027 R3) |
| Classified JSON identity | Migration accepts an object without full family identity validation | Reject and preserve foreign/malformed task, feature and record identities (1025 R4) |

Keep correctness invalidation, atomic publication cleanup and unrelated temporary cleanup.
No real project scratch was deleted during this re-verification. The repaired record/receipt
writers and migration confinement do not settle the unresolved consumers above. R4 remains PARTIAL
until the current candidate set is closed; no unresolved family is silently declared disposable.

## 14. Completion audit (2026-10-02)

The current reviewed census is [machine-readable](2026-10-01-E71-run-storage-census.json).
It records each candidate's file, line and source-line SHA-256, its source owner, and its
family dispositions linked to §§3–6 above. The read-only equality check is:

```bash
bun scripts/commands/run-storage-census.ts
```

At this closure checkpoint, **3,222 candidate locations = 3,222 classified locations**, across
276 owners; zero duplicate or unclassified locations. Equality compares location identities,
not file counts. The scan includes direct paths, computed joins, root/helper aliases, and
deletion calls across app/CLI/server/domain/config source, workflows, plugin instructions,
hooks and scripts, and tests. Broad deletion matches outside run storage are explicitly
U1–U6/T2, including fixture teardown and lock/publication cleanup. Generated CLI config and
the bundled CLI plugin copy are derived consumers excluded from this source census; `.mjs`
twins are checked through the build/install parity gates. A changed candidate must be
reviewed before updating the census. Runtime unknowns remain preserved migration candidates.

The earlier unresolved rows now have concrete owners and executable closure evidence:

| Dependency | Disposition and regression |
| --- | --- |
| Corpus and suppression inputs | Durable-first discovery; `corpus-sweep.test.ts` and `feature-sync-suppression.test.ts` compare inputs after scratch removal |
| Residual fold and wrap-up metrics | Canonical evidence is authoritative; fold updates it atomically and mirrors the attempt copy; plugin tests exercise downgrade and malformed durable rejection |
| Legacy identities and live owners | Existing verdict/receipt parsers plus record identities; migration tests reject foreign identities and preserve proof/receipt live owners |
| Legacy artifact/session references | Domain owner transaction redirects references and importer checkpoints; real OMP import remains stable before/after repeated disposal and later full import |
| Worktree durable families | Canonical verdicts, both receipts, artifacts/links, records and session roots transfer; export regression deletes the source tree and reads receiving references; conflicts fail visibly |
| Bound evidence and registered summaries | Fixed evidence root binding and source-proven retained summary lookup; real decision workflow consumes its registered summary after whole scratch removal |
| C13/X4 failed-agent handoff | Lasting under the existing run artifact directory, including a redacted latch snapshot; failure writer and tracing regressions retain it after disposal |
| Feature/producer equivalence | Real task record, receipt writer and feature completion checker remain equal; real paused workflow resumes then retains trace/records after repeated removal |
| Cleanup sites | W1–W14 correctness invalidation/publication cleanup stays; legacy log reclamation protects live owners; U/T2 cleanup keeps its existing owner |

Task 1043 was completed by the other coding agent and integrated here. It owns record-pass
prevalidation and replay repair after an earlier row/file tear; the integrated export suite also
covers its two follow-up branches (1045). Task 1046 makes inline trace emission explicit in the
interpreter loop. No live project scratch was removed. Test fixtures remove the
whole completed scratch directory only after their retained data and consumers settle.
