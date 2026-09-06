# Workflow conflict audit — 2026-09-06

Eight findings: **three repaired, five follow-ups open**. Do not treat the workflow as release-ready while P1 tasks 0782–0785 remain.

Task 0781 recorded verify PASS and reached done. D6 remains active: its structural check passes with nine expected unverified-scenario warnings for open work. After the full gate, an unrelated concurrent edit appeared in `apps/server/src/serve.ts`; it is excluded from this audit change and not certified by that earlier gate.

Priority: proof/confinement (0785), resume (0784), wrapup correctness (0783), planning reuse (0782), then capability guidance (0786). Keep D9 Option B; spend model effort on planning gaps and implementation, and reuse deterministic results only until relevant inputs change.

| Envelope | Value |
| --- | --- |
| schema_version | 1 |
| command | dev-find-conflict |
| scope | D8/D9/D61 workflow upgrade and D6 workflow reliability/cost owners |
| mode | full |
| pillars | ["source","tasks","features","authority"] |

## Authority map

- **process** — docs/99_PROJECT_CONSTITUTION.md. AGENTS.md: 99 owns process; T10 explicit checker-policy audit, T11 affected-input ordinary writes.
- **structural-decision** — docs/00_ADR.md. AGENTS.md: 00 wins; ADR-107 Option B and ADR-108 operator correction retained.
- **product-scope** — docs/01_PRD.md. AGENTS.md: 01 owns scope; no agent-platform rewrite or fast-route activation.
- **feature/task-obligation** — D6/D8/D9/D61 and linked task Requirements/AC. Accepted obligations constrain implementation; status alone is not executable evidence.
- **observed-behavior** — source-local code, fixtures and actual gate output. Observed code does not override normative authority; divergence is recorded explicitly.

## Inventory

All freshness dates are 2026-09-06. Graph scans are not live executions; retrieved task bodies are not automatically counted as reviewed.

| Pillar | Identity / path | Anchor | Scan status |
| --- | --- | --- | --- |
| source | basic — `config/workflows/basic.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | docs-pipeline — `config/workflows/docs-pipeline.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | feature-dev — `config/workflows/feature-dev.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | feature-lifecycle — `config/workflows/feature-lifecycle.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | history-anatomy — `config/workflows/history-anatomy.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | idea-pipeline — `config/workflows/idea-pipeline.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | pr-review — `config/workflows/pr-review.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | task-lifecycle — `config/workflows/task-lifecycle.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | task-pipeline — `config/workflows/task-pipeline.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | wayfinder-resolution — `config/workflows/wayfinder-resolution.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| source | wrapup-pipeline — `config/workflows/wrapup-pipeline.yaml` | states/actions/transitions | parsed action graph; deeper source inspection focused on linked findings |
| tasks | 0729 — `docs/tasks4/0729_audit-workflow-adrs-gates-baselines-and-capability-ownership.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0730 — `docs/tasks4/0730_measure-workflow-cost-human-attention-and-bypass-pressure.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0733 — `docs/tasks4/0733_synthesize-the-task-ready-workflow-upgrade-strategy.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0731 — `docs/tasks4/0731_classify-shipped-workflows-by-fit-and-select-surrounding-pil.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0732 — `docs/tasks4/0732_prototype-proportional-gates-on-a-surrounding-workflow.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0758 — `docs/tasks4/0758_s3-pilot-the-proportional-route-table-on-wrapup-pipeline-and.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0759 — `docs/tasks4/0759_s5-migrate-task-pipeline-to-proportional-gates-last.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0753 — `docs/tasks4/0753_s0c-repair-action-options-run-id-confinement-nested-composit.md` | metadata, Requirements, Design | selected body reviewed |
| tasks | 0757 — `docs/tasks4/0757_re-measure-gate-re-run-the-workflow-run-economy-measurement-.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0762 — `docs/tasks4/0762_add-r4-and-r6-scenarios-to-feature-d9-acceptance-criteria.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0761 — `docs/tasks4/0761_await-the-first-r1-rejection-assertion-in-proof-input-finger.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0764 — `docs/tasks4/0764_reconcile-d9-option-b-closure-evidence-and-corpus-findings.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0755 — `docs/tasks4/0755_s2-give-the-inline-pipeline-driver-a-single-owner-and-an-exe.md` | metadata, Requirements, Design | selected body reviewed |
| tasks | 0754 — `docs/tasks4/0754_s1-repair-authority-and-derived-doc-drift-regenerate-corpus-.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0760 — `docs/tasks4/0760_s0-sibling-make-docs-pipeline-proof-fail-closed-task-path-lo.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0756 — `docs/tasks4/0756_s4-optional-behavior-neutral-workflow-version-contract-in-bo.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0752 — `docs/tasks4/0752_s0b-unify-the-workflow-load-resolve-preflight-seam-and-bind-.md` | metadata, Requirements, Design | selected body reviewed |
| tasks | 0751 — `docs/tasks4/0751_s0a-make-workflow-proof-fail-closed-git-tree-task-lookup-ver.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0769 — `docs/tasks4/0769_upgrade-planning-and-evidence-workflows-without-structural-c.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0768 — `docs/tasks4/0768_unify-workflow-plan-identity-and-readable-execution-progress.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0767 — `docs/tasks4/0767_replace-composition-mirrors-with-live-workflow-facts-and-beh.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0770 — `docs/tasks4/0770_upgrade-lifecycle-and-wrapup-workflows-with-truthful-outcome.md` | metadata, Requirements, Design | selected body reviewed |
| tasks | 0772 — `docs/tasks4/0772_complete-the-final-task-pipeline-and-packaged-workflow-rollo.md` | metadata, Requirements, Design | selected body reviewed |
| tasks | 0771 — `docs/tasks4/0771_upgrade-example-history-and-pr-review-workflow-behavior.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0774 — `docs/tasks4/0774_migrate-cli-fallback-accepted-callers-and-dependent-fixtures.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0765 — `docs/tasks4/0765_make-essential-completion-checks-explicit-without-blanket-st.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0766 — `docs/tasks4/0766_retire-routine-corpus-sweeps-and-suppression-based-acceptanc.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0777 — `docs/tasks4/0777_d61-batch-execution-findings-register-consolidated-fixes-for.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0775 — `docs/tasks4/0775_delete-corpus-composition-baselines-and-snapshot-tests.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0773 — `docs/tasks4/0773_audit-and-migrate-config-corpus-baseline-json.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| tasks | 0776 — `docs/tasks4/0776_fix-d61-pipeline-execution-blockers-stale-executor-doc-and-0.md` | metadata, Requirements, Design | metadata reviewed; body retrieved but not exhaustively reverified |
| features | D6 — `docs/features/D6_workflow-cost-deterministic-ownership-surface-and-role-addressed-coordination.md` | Goal / Scope / Acceptance Criteria / Tasks / Notes | body reviewed through source-local feature show |
| features | D8 — `docs/features/D8_proportional-workflow-upgrade-strategy.md` | Goal / Scope / Acceptance Criteria / Tasks / Notes | body reviewed through source-local feature show |
| features | D9 — `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md` | Goal / Scope / Acceptance Criteria / Tasks / Notes | body reviewed through source-local feature show |
| features | D61 — `docs/features/D61_essential-workflow-checks-and-observable-execution.md` | Goal / Scope / Acceptance Criteria / Tasks / Notes | body reviewed through source-local feature show |
| authority | AGENTS.md — `AGENTS.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/00_ADR.md — `docs/00_ADR.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/01_PRD.md — `docs/01_PRD.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/02_ROADMAP.md — `docs/02_ROADMAP.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/03_ARCHITECTURE.md — `docs/03_ARCHITECTURE.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/04_DESIGN.md — `docs/04_DESIGN.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/05_FEATURES.md — `docs/05_FEATURES.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/99_PROJECT_CONSTITUTION.md — `docs/99_PROJECT_CONSTITUTION.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |
| authority | docs/design/essential-workflow-checks.md — `docs/design/essential-workflow-checks.md` | workflow-linked sections | relevant sections; not an unrelated whole-document prose audit |

## Findings

### F-01 — Artifact descendant boundaries

- **claim_type:** implementation-behavior
- **conflict_type:** contradiction
- **pillars:** ["source","authority"]
- **artifacts:** ["docs/03_ARCHITECTURE.md","packages/app/src/workflow/actions/command-gate.ts","packages/app/tests/workflow/actions/run-artifact.test.ts"]
- **normative_authority:** docs/03_ARCHITECTURE.md §20 requires safe .spur/run artifact paths.
- **observed_reality:** Before repair both action runners accepted .spur/run-other and .spur/run itself; separator-qualified checks now reject them before effects.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/03_ARCHITECTURE.md` (heading: 20.3 Proof-state invariant): Artifacts are confined and metadata cannot weaken proof. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read docs/03_ARCHITECTURE.md at heading 20.3 Proof-state invariant`.
- `packages/app/src/workflow/actions/command-gate.ts` (symbol: CommandGateActionRunner.execute): Original startsWith(allowedDir) accepted sibling names. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `git show bdace0e72b74b8d65593104d0089dc65437e8c4e:packages/app/src/workflow/actions/command-gate.ts`.
- `packages/app/tests/workflow/actions/run-artifact.test.ts` (symbol: rejects sibling prefixes and the run directory even without an existence probe (0781)): New regression verifies lexical refusal; valid descendant tests still pass. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `cd packages/app && bun test tests/workflow/actions/command-gate.test.ts tests/workflow/actions/run-artifact.test.ts`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** high
- **confidence:** high
- **false_positive_check:** An executable counterexample violated a current path contract, not a planned guarantee or historical migration. Symlink safety is explicitly not inferred from this repair.
- **proposed_repair:** Use the platform separator at both existing boundary owners; physical symlinks remain F-07.
- **repair_owner:** source lifecycle / task 0781
- **status:** resolved

### F-02 — CLI JSON pipe completeness

- **claim_type:** command/api/schema-surface
- **conflict_type:** contradiction
- **pillars:** ["source","authority"]
- **artifacts:** ["docs/design/essential-workflow-checks.md","apps/cli/src/index.ts","apps/cli/tests/cli-pipe.test.ts"]
- **normative_authority:** docs/design/essential-workflow-checks.md requires one complete JSON stdout document.
- **observed_reality:** Original explicit process.exit truncated a source CLI feature-list pipe to 65536 of 77158 bytes in repeated reproductions. Natural shutdown now preserves output and nonzero status.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/design/essential-workflow-checks.md` (heading: Corpus-check contract): JSON stdout remains one document. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read docs/design/essential-workflow-checks.md at heading Corpus-check contract`.
- `apps/cli/src/index.ts` (symbol: runCli): Original composition root force-exited immediately after runCli returned. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `git show bdace0e72b74b8d65593104d0089dc65437e8c4e:apps/cli/src/index.ts`.
- `apps/cli/tests/cli-pipe.test.ts` (symbol: CLI drains large JSON to a pipe before exiting (0781)): Real OS pipe with delayed consumer retains >64 KiB JSON; missing feature still exits 1. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `cd apps/cli && bun test tests/cli-pipe.test.ts tests/bootstrap.test.ts`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** high
- **confidence:** high
- **false_positive_check:** The same command succeeds to a regular file and failed through a pipe before the fix. A delayed real OS-pipe regression ruled out jq/schema error; no format migration or intentional truncation applies.
- **proposed_repair:** Set process.exitCode and let the already-closed runtime drain naturally; no new stream framework.
- **repair_owner:** source lifecycle / task 0781
- **status:** resolved

### F-03 — feature-dev reuses accepted planning and checks once

- **claim_type:** task-obligation
- **conflict_type:** contradiction
- **pillars:** ["source","tasks","features","authority"]
- **artifacts:** ["docs/tasks4/0770_upgrade-lifecycle-and-wrapup-workflows-with-truthful-outcome.md","config/workflows/feature-dev.yaml","docs/design/essential-workflow-checks.md"]
- **normative_authority:** Task 0770 Design and D61 R8 require existing-feature execution; essential checks run once per unchanged logical input.
- **observed_reality:** feature-dev precheck only checks nonempty feature/doctor, then always dispatches brainstorm and plan before runall; strict final feature checking appears in opposing guards.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/tasks4/0770_upgrade-lifecycle-and-wrapup-workflows-with-truthful-outcome.md` (heading: Design): Reuse existing feature AC and linked roster rather than replanning delivered contracts. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `bun apps/cli/src/index.ts task show 0770 --json`.
- `config/workflows/feature-dev.yaml` (symbol: precheck / brainstorm / plan / transitions): The graph routes every accepted input through both planning model steps and repeats final checks. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read config/workflows/feature-dev.yaml at symbol precheck / brainstorm / plan / transitions`.
- `docs/design/essential-workflow-checks.md` (heading: Completion integrity): Sibling guards should inspect one captured logical check result. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read docs/design/essential-workflow-checks.md at heading Completion integrity`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** high
- **confidence:** high
- **false_positive_check:** Task 0770 is done and names existing-feature reuse explicitly. This is extra live model work, not merely different wording. ADR-107 fast routes remain disabled and are not required for this fix.
- **proposed_repair:** Resolve and freeze the feature/roster once; reuse accepted plans and execute pending tasks; capture final check once.
- **repair_owner:** workflow owner / task 0782
- **status:** confirmed

### F-04 — wrapup input and synchronization truth

- **claim_type:** feature-ac
- **conflict_type:** contradiction
- **pillars:** ["source","tasks","features","authority"]
- **artifacts:** ["docs/tasks4/0770_upgrade-lifecycle-and-wrapup-workflows-with-truthful-outcome.md","config/workflows/wrapup-pipeline.yaml",".spur/run/0781-wrap-probe-k5jp2q"]
- **normative_authority:** D61 R8 and task 0770 require invalid input and failed required synchronization to refuse success.
- **observed_reality:** The extracted task-resolve shell returns PASS for tasks=[" "] with spurBin=false: whitespace word splitting executes zero tasks. Metrics can likewise skip missing input; applied:false can hide blocked feature synchronization.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/tasks4/0770_upgrade-lifecycle-and-wrapup-workflows-with-truthful-outcome.md` (heading: Acceptance Criteria): Wrapup validates input and reports failed synchronization honestly. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `bun apps/cli/src/index.ts task show 0770 --json`.
- `config/workflows/wrapup-pipeline.yaml` (symbol: task-resolve / metrics / feature-sync): Reason, actions and guards reparse raw input; shell splitting and applied-only logic admit false success. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read config/workflows/wrapup-pipeline.yaml at symbol task-resolve / metrics / feature-sync`.
- `.spur/run/0781-wrap-probe-k5jp2q` (command: isolated task-resolve shell probe): Exit 0 with PASS for a whitespace-only task and a command that cannot succeed. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Parse wrapup-pipeline.yaml, execute the final task-resolve shell in a scratch workdir with tasks='[" "]', spurBin=false and __runId=probe; inspect its status file.`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** high
- **confidence:** high
- **false_positive_check:** The whitespace reproducer executes the shipped shell directly, not an invented replacement. A no-op success is not intentional fast routing: the raw input is invalid before route choice.
- **proposed_repair:** Consume one normalized WBS list; validate command exit and result shapes; distinguish no-change from blocked or unconfirmed synchronization.
- **repair_owner:** workflow owner / task 0783
- **status:** confirmed

### F-05 — Workflow resume source and checkpoint identity

- **claim_type:** architecture-mechanism
- **conflict_type:** contradiction
- **pillars:** ["source","tasks","features","authority"]
- **artifacts:** ["docs/design/essential-workflow-checks.md","packages/app/src/services/workflow-service.ts","plugins/sp/skills/spur-dev/references/cross-cutting.md","packages/app/src/workflow/checkpoint-contract.ts"]
- **normative_authority:** D61 R5 and task 0752 require consistent launch/resume identity and checkpoint freshness.
- **observed_reality:** continuePaused re-resolves row.workflow_name instead of the original explicit file. Resume compares checkpoint status literally with paused despite the canonical checkpoint vocabulary excluding paused; freshness omits current HEAD and workdir-relative artifact probing.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/design/essential-workflow-checks.md` (heading: Planning and version identity): Plan/run/continue must resolve the same definition identity. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read docs/design/essential-workflow-checks.md at heading Planning and version identity`.
- `packages/app/src/services/workflow-service.ts` (symbol: continuePaused / validateResumeCheckpointFreshness): Name-only resolution, literal status comparison and checkpointStaleness(meta) omit required launch/freshness inputs. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read packages/app/src/services/workflow-service.ts at symbol continuePaused / validateResumeCheckpointFreshness`.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` (line: 650): Canonical checkpoint status values do not include paused. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read plugins/sp/skills/spur-dev/references/cross-cutting.md at line 650`.
- `packages/app/src/workflow/checkpoint-contract.ts` (symbol: checkpointStaleness): Commit drift is checked only when sourceCommit is supplied; default artifact probe uses the supplied path without run-root resolution. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read packages/app/src/workflow/checkpoint-contract.ts at symbol checkpointStaleness`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** high
- **confidence:** high
- **false_positive_check:** Explicit-path launch and paused continuation are current supported surfaces. The mismatching vocabularies and omitted optional inputs are concrete call-site gaps, not a demand for a new resume engine. No real paused production run was mutated.
- **proposed_repair:** Retain resolved definition source in existing run metadata; map paused checkpoint semantics; supply HEAD and run-workdir probes; reconcile redundant checkpoint writers.
- **repair_owner:** application workflow owner / task 0784
- **status:** confirmed

### F-06 — Delivered workflow documentation

- **claim_type:** architecture-mechanism
- **conflict_type:** stale
- **pillars:** ["source","tasks","features","authority"]
- **artifacts:** ["docs/00_ADR.md","docs/features/D61_essential-workflow-checks-and-observable-execution.md","config/workflows/docs-pipeline.yaml","docs/03_ARCHITECTURE.md"]
- **normative_authority:** ADR-108 operator correction and delivered D61/0704 records govern derived delivery projections.
- **observed_reality:** ADR-108 and roadmap described pending D61 work; architecture still claimed synthetic docs PASS and pending 0704, plus a checked composition baseline. Those current projections are corrected; historical decision text remains historical.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/00_ADR.md` (heading: ADR-108): Original design-only delivery label lagged implementation; operator correction preserves explicit unsuppressed audits. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `git show bdace0e72b74b8d65593104d0089dc65437e8c4e:docs/00_ADR.md`.
- `docs/features/D61_essential-workflow-checks-and-observable-execution.md` (heading: Current closure (2026-09-06)): D61 records all 13 tasks done; its planning snapshot is expressly historical. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `bun apps/cli/src/index.ts feature show D61 --json`.
- `config/workflows/docs-pipeline.yaml` (symbol: verify): Docs verification is measured, read-only and runs before record; no synthetic PASS writer. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read config/workflows/docs-pipeline.yaml at symbol verify`.
- `docs/03_ARCHITECTURE.md` (heading: 20.3 Proof-state invariant): Removed current-state claims about synthetic PASS and a composition snapshot. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `git diff -- docs/03_ARCHITECTURE.md`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** medium
- **confidence:** high
- **false_positive_check:** Only current-state projections were repaired. D61's explicitly historical planning snapshot and ADR-0754 historical baseline amendments are not live contradictions and were preserved.
- **proposed_repair:** Add dated ADR delivery correction and correct roadmap/architecture projections without rewriting historical decisions.
- **repair_owner:** sp-doc-evolve / task 0781
- **status:** resolved

### F-07 — Proof inputs, binding and physical artifact confinement

- **claim_type:** implementation-behavior
- **conflict_type:** omission
- **pillars:** ["source","tasks","authority"]
- **artifacts:** ["docs/03_ARCHITECTURE.md","packages/app/src/workflow/actions/proof-fingerprint.ts","packages/app/src/workflow/actions/run-artifact.ts","config/workflows/task-pipeline.yaml"]
- **normative_authority:** ADR-071 proof-state invariant and current confinement contract require actual certified inputs and truthful stage evidence.
- **observed_reality:** Declared missing taskFile still returns ok:true; paths are read outside context.workdir resolution. A symlink inside .spur/run to an outside file is accepted. proofBinding=current checks digest-shaped vars only. Dormant fast review skip still stamps review completed.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/03_ARCHITECTURE.md` (heading: 20.3 Proof-state invariant): Quality, review and verification must name the same actual proof inputs. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read docs/03_ARCHITECTURE.md at heading 20.3 Proof-state invariant`.
- `packages/app/src/workflow/actions/proof-fingerprint.ts` (symbol: readOptional / ProofFingerprintActionRunner.execute): Declared missing file is silently omitted; a source-local mock-git probe with a definitely missing taskFile returned ok:true. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read packages/app/src/workflow/actions/proof-fingerprint.ts at symbol readOptional / ProofFingerprintActionRunner.execute`.
- `packages/app/src/workflow/actions/run-artifact.ts` (symbol: RunArtifactActionRunner.execute): Lexical check accepts a symlink outside; current binding checks a run variable shape, not artifact correspondence. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read packages/app/src/workflow/actions/run-artifact.ts at symbol RunArtifactActionRunner.execute`.
- `config/workflows/task-pipeline.yaml` (symbol: verify / review fast-route transitions): Review can be skipped on the dormant fast branch while the proof stamp asserts completed review. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read config/workflows/task-pipeline.yaml at symbol verify / review fast-route transitions`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** high
- **confidence:** high
- **false_positive_check:** An absent optional feature is legitimate; an explicitly declared missing spec is distinct. The symlink probe reproduces ordinary symlink following, not an unproven race attack. False fast-review stamping is a latent defect, not evidence that Option B was activated.
- **proposed_repair:** Fail declared missing inputs, resolve from workdir, enforce physical boundaries and actual binding, and stamp only executed stages; keep fast routing dormant.
- **repair_owner:** proof/action owner / task 0785
- **status:** confirmed

### F-08 — Canonical capability guidance after ADR-108

- **claim_type:** process
- **conflict_type:** stale
- **pillars:** ["source","authority"]
- **artifacts:** ["docs/99_PROJECT_CONSTITUTION.md","plugins/sp/agents/expert-spur.md","plugins/sp/skills/spur-cli/references/tasks.md","packages/app/src/services/task-record.ts","plugins/sp/skills/spur-dev/references/gate-checklists.md"]
- **normative_authority:** Constitution T10/T11 owns audit policy; current task record source and docs workflow own behavior.
- **observed_reality:** expert-spur still mandates a corpus sweep after every batch; task reference says record never transitions done; gate checklist describes removed docs PASS stubs.
- **precedence_reason:** AGENTS.md Documentation/Harness-first: 00 owns decisions, 01 scope, 99 process; accepted feature/task obligations constrain implementation, while code/gates establish observed behavior.

Evidence:

- `docs/99_PROJECT_CONSTITUTION.md` (symbol: T10 / T11): Checker policy changes require one explicit audit; ordinary edits use affected-input checks. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read docs/99_PROJECT_CONSTITUTION.md at symbol T10 / T11`.
- `plugins/sp/agents/expert-spur.md` (heading: Process): Step 6 mandates routine whole-corpus checking after batch writes. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read plugins/sp/agents/expert-spur.md at heading Process`.
- `plugins/sp/skills/spur-cli/references/tasks.md` (line: 190): Reference says record never transitions to done. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read plugins/sp/skills/spur-cli/references/tasks.md at line 190`.
- `packages/app/src/services/task-record.ts` (symbol: RecordOptions.transition): PASS record-to-done auto-walks legal statuses with guarded run-link support. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read packages/app/src/services/task-record.ts at symbol RecordOptions.transition`.
- `plugins/sp/skills/spur-dev/references/gate-checklists.md` (line: 152): Checklist still claims docs PASS stubs despite measured verification. Provenance: {"source":"source-local CLI / direct source and contract inspection","freshness":"2026-09-06"}. Reproduce: `Read plugins/sp/skills/spur-dev/references/gate-checklists.md at line 152`.
- **freshness:** {"revalidated":true,"rechecked_at":"2026-09-06T18:37:37Z","anchors_stale":[]}
- **severity:** medium
- **confidence:** high
- **false_positive_check:** These are active instructions, not archived run reports. Current CLI help/source and T11 explicitly supersede them. No host adapter or external plugin installation was silently modified.
- **proposed_repair:** Repair canonical capabilities and their focused contracts through Superskill; retain scoped installer authority and report installed-version skew.
- **repair_owner:** Superskill capability owner / task 0786
- **status:** confirmed

## unresolved

- {"subject":"Live-run workflow and token-cost coverage","status":"not-certified","reason":"No new real terminal model-bearing runs; no comparable billed token/cost sample. Do not infer release readiness or savings from static graphs and unit tests."}
- {"subject":"General current-proof binding for non-verdict artifacts","status":"scope clarification in 0785","reason":"Existing writer documents digest-var presence while higher-level proof obligations require actual correspondence. Preserve the current verdict schema and resolve other artifact-kind semantics before broadening their contract."}

## coverage

- **complete:** false
- **pillars:** {"source":{"intended":"11 canonical definitions and linked runtime/capability seams","discovered":11,"scanned":11,"skipped":"unlinked source and exhaustive end-to-end execution","skipped_reasons":["All 11 action graphs scanned; deep semantic inspection concentrated on feature, wrapup, proof, resume, delivery and output seams. No fresh live model-bearing terminal runs."]},"tasks":{"intended":31,"discovered":31,"scanned":31,"skipped":26,"skipped_reasons":["31 metadata records inspected and bodies retrieved; only five selected task bodies deeply compared. No claim of re-verifying all completed tasks."]},"features":{"intended":4,"discovered":4,"scanned":4,"skipped":0,"skipped_reasons":[]},"authority":{"intended":"workflow-linked current contracts","discovered":9,"scanned":9,"skipped":"unrelated sections","skipped_reasons":["Section/claim-level inspection, not whole-repository documentation certification."]}}
- **reused_context:** []
- **change_cone:** Cold workflow audit at bdace0e72b74b8d65593104d0089dc65437e8c4e plus task 0781 working-tree fixes.
- **boundaries:** {"source/tasks":"F-03/F-04/F-05/F-07","source/features":"F-03/F-04/F-05","source/authority":"F-01/F-02/F-06/F-07/F-08","tasks/features":"31 roster records joined; D61 obligations compared at selected 0770/0772 seams; historical completion is not re-certification","tasks/authority":"F-03/F-05/F-06; accepted Option B closure retained","features/authority":"F-06; D9 Option B and D61 baseline retirement are consistent after delivery corrections"}
- **intentionally_not_conflicts:** ["D9 fast routes remain unreachable by default under ADR-107 Option B; no activation or speculative speed target was added.","D61 historical planning snapshot and superseded baseline amendments were not treated as live pending work.","JSON compatibility fixture is intentionally retained; retiring corpus/composition snapshots does not imply deleting it."]

## cost

- **files_inspected_exact:** null
- **claims_inspected_exact:** null
- **tokens_inspected:** null
- **tokens_skipped:** null
- **estimated_savings:** null
- **reason:** No reliable billing/file-read telemetry; no percentage savings or exhaustive coverage claimed.

## remediation

- **authorization:** User --resolve explicitly permits direct simple repairs and task creation for larger repairs; all work inline, one writer.
- **task:** 0781
- **release_ready:** false
- **items:** {"F-01":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["61154c064c86ff5fbca3b21c6f7ae4cdfd983640","5ba6452419fd0bf4ed18f9b42f6b41718f65422e","e59065ca491c4b9abfe3b8798182c99965cfc129"]},"outcome":"repaired and checked","task":"0781"},"F-02":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["a8d85817e553b0028ba142a07775ed7cd6866ed1","e671feb5e1428d708adb730d4a31c82e51fc408f","01a859a3f144ba35e84b3bc5e0aa787892ae18b8"]},"outcome":"repaired and checked","task":"0781"},"F-03":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["eab07e9bd78b3a59eb71fb96b141d3b034a4de5b","481201a578e83d74a48e4add4d366132285407d5","a8d85817e553b0028ba142a07775ed7cd6866ed1"]},"outcome":"filed; not repaired","task":"0782"},"F-04":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["eab07e9bd78b3a59eb71fb96b141d3b034a4de5b","5e70bebbcfafa20b944a57390af0d7bd0bda2e8e"]},"outcome":"filed; not repaired","task":"0783"},"F-05":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["a8d85817e553b0028ba142a07775ed7cd6866ed1","e2e20c0e0e78af0744049eee884a90a145e84d77","b9a74f0e4499728bbcfb7ac6790a4985db6694c6","451b2b2a0a9ab7ce68ada7130bc73f957458e861"]},"outcome":"filed; not repaired","task":"0784"},"F-06":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["111f9a4ef9c867b90e107de99a51c6e2603883a4","14e9c7a093df21b4717a5f260184573533e9abc7","ceafe8762570634ea3e3d99e12af91519355e1f3","61154c064c86ff5fbca3b21c6f7ae4cdfd983640"]},"outcome":"repaired and checked","task":"0781"},"F-07":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["61154c064c86ff5fbca3b21c6f7ae4cdfd983640","0544e06292d3fb28b708f2f90a595f705dc9b91d","06e3a61838b1d908be3c479c5b188206d3376bc2","3e8fd408c06019b4d8358edd7d045155f11a0ce2"]},"outcome":"filed; not repaired","task":"0785"},"F-08":{"evidence_fingerprint":{"algorithm":"git-blob-sha1","anchors":["bdeaf7d3036b06a92b6b1b41d6800c7d3895e874","75913f338667dc6d396a116f0b104ce2c6c8bc39","933fb90c8625c490421ca5482c3626ba3a837ec2","a31061b796dc400cdb150b603e2f162b162689f0","ede05a4628de7868330abde4f226ac996f15791a"]},"outcome":"filed; not repaired","task":"0786"}}
- **verification:** {"bun run spur-check":"PASS: 7461 tests / 417 files; 29978 assertions; Biome 903 files; workspace type checks; 44 recommended-pre and 2 recommended-post rules. Raw log .spur/run/0781-spur-check-final.log.","bun run build":"PASS: .spur/run/0781-build.log; existing web chunk-size advisory remains.","bun run test-cf":"PASS: 1 test / 1 file; .spur/run/0781-test-cf.log.","bun run --filter @gobing-ai/spur build:bundle":"PASS: .spur/run/0781-bundle.log.","focused action regressions":"PASS: 22 tests in command-gate/run-artifact suites.","CLI pipe and bootstrap":"PASS: 5 tests; complete delayed OS-pipe output and missing-feature exit 1.","source and bundled feature-list JSON pipes":"PASS: both parsed as 127 features.","follow-up task checks":"0782–0786 PASS structurally; 0782 has advisory gate-language warning. No follow-up implementation PASS claimed."}
- **limitations:** ["No release, publish, push, workflow YAML edit, external review request, model-bearing workflow execution or host capability installation.","Physical symlink confinement remains open in 0785 despite lexical path repair.","Full gate passes do not certify all workflow contracts; 0782–0785 are P1 and 0786 P2."]

## errors

- {"kind":"tool_failure","subject":"large CLI pipe (recovered)","message":"Initial source-local JSON pipe truncated; reproduced and repaired in F-02. Later pipe reads parse completely."}
- {"kind":"tool_failure","subject":"first spur-check attempt (recovered)","message":"New spy stubs initially missed ProcessResult fields / typed void implementations. Corrected test types; final complete gate passed."}
- {"kind":"tool_failure","subject":"discovery output limits (partial coverage)","message":"Some broad reads were truncated and optional guessed paths were absent; owning symbols were rediscovered. Unread body regions are disclosed in coverage, not counted as exhaustive review."}
- {"kind":"semantic_uncertainty","subject":"non-verdict current-proof semantics","message":"Record-var shape versus physical artifact correspondence needs artifact-kind-specific treatment in 0785; no new generalized binding format was invented."}
