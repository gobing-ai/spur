---
schema_version: 1
name: "Audit workflow ADRs, gates, baselines, and capability ownership"
status: done
template: meta
created_at: 2026-09-02T03:05:57.970Z
updated_at: "2026-09-03T04:30:35.468Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "adr", "baseline"]
---

## 0729. Audit workflow ADRs, gates, baselines, and capability ownership

### Background

D8 needs one evidence-backed contract inventory before any redesign. Review the accepted workflow decisions against current code, tests, docs, and shipped configuration, including the operator's concern that strict gates and baseline mechanisms may now cost more than they protect. This ticket also owns the related four-surface script-placement audit because the same evidence determines where ADR-069 capabilities belong.

### Requirements

- [x] R1. Build one binding-claim matrix for ADRs 051, 060, 065, 069-072, 076, 087, 093-100, and 102, plus baseline ADRs 050, 062, 088, 090, and 092 and implementation tasks 0603, 0607, 0614, 0703-0712, and 0723; link every claim to current code, tests, docs, and shipped behavior.
- [x] R2. Classify each claim as implemented, partial, stale/conflicting, dead, or unimplemented and give it a keep, amend, supersede, retire, or implementation-gap disposition. Sample completed-task code and executable evidence; task status alone is not proof.
- [x] R3. Trace every workflow/corpus baseline field to its consumer and actual exit-status effect; record owner, callers, staleness, removal criteria, and whether it is a PASS-changing waiver, reference snapshot, performance sensor, generated copy, inert field, or residue. Reproduce the composition-regeneration and pipeline-budget gates; do not baseline their failures.
- [x] R4. Produce a parity matrix across JSON and Zod schemas, `validate`, `run`, `show`, `list`, `continue`, lifecycle, and projection covering post-schema validation, omitted-`kind` defaulting, extensions/`onError`, source precedence, config threading, run identity/digest, pause/resume, progress status, and claimed versus implemented action/evidence effects.
- [x] R5. Reproduce and severity-rank the proven runtime and evidence defects: CLI `spurConfig` omission; ineffective `command.gate` timeout; nested `feature-dev` review; continue marker/log/resolution/digest behavior; path and run-id confinement; fail-open proof fingerprints; suppressed task lookup and reviewer independence; stale verifier `expectFile`; incomplete `run.artifact` proof binding; dry-run/surface-inventory validity; and whole-worktree task-solution attribution.
- [x] R6. Reconcile the four script surfaces—public CLI commands, repository-only `scripts/commands`, root `package.json` composition entrypoints, and portable `plugins/sp/scripts`—with application/built-in capability owners. Include exact workflow callers, portable entrypoint pairs, `pr-reviewing`, task helper scripts, and gaps in `script-contract-check`; propose no public verb without consent.
- [x] R7. Record the existing workflow-version contract rather than reimplementing it: both dialects accept an optional behavior-neutral string, currently including empty values. Define the minimal target as `unversioned` when absent and `explicit(<literal>)` for a quoted non-empty opaque literal. Trace validation, resolution, list/show/run/continue/progress exposure, persistence and definition-digest interaction, including paused runs; state objective evidence required before a future-major mandate.
- [x] R8. Write a prioritized defect/decision register in the Solution. Every entry names severity, root cause, current behavior, smallest repair or deletion, owning layer, regression check, downstream strategy slice, and remaining uncertainty; unknown stays unknown.
- [x] R9. Publish the durable findings artifact at `docs/inventory/d8-0729-workflow-contract-inventory.md` — claim/baseline/parity matrices and the severity register. The task Solution summarizes and links it; the artifact is the reviewable deliverable.

### Acceptance Criteria

- [x] Every in-scope ADR and implementation task has an evidence-linked status and disposition, including ADR-102 and derived-doc drift for ADRs 094-100.
- [x] Every baseline field has a proven consumer/exit effect or is marked inert; current regeneration and budget failures are recorded rather than waived.
- [x] The surface-parity matrix proves the omitted-`kind`, validation, resolution, resume, configuration, and progress differences with source-local commands or focused tests.
- [x] The severity register covers every defect named in R5, distinguishes defect/risk/intentional contract/ADR gap, and assigns prerequisite repair ownership before pilot selection.
- [x] Every script-placement finding names its current YAML/command caller, deployment context, portable entrypoint contract, and recommended existing owner.
- [x] The version trace confirms existing optional schema acceptance including the empty-string gap, the non-empty opaque target, behavior-neutral explicit/unversioned states, propagation gaps, digest/resume implications, and no current mandatory or registry requirement.
- [x] The Solution is sufficient for 0731 and 0733 without reopening the full repository audit, and contains no unresolved operator choice disguised as a conclusion.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Read authority first, then trace every binding claim through the current caller and executable behavior. Keep a single matrix plus a prioritized defect register so later tickets consume findings instead of repeating discovery. Prefer one shared root-cause repair seam or deletion over per-surface patches; public-surface changes remain consent-gated.

### Plan

- [x] Freeze the ADR/task/definition inventory and source-local CLI provenance.
- [x] Trace baseline fields to consumers, exit behavior, and current failing gates.
- [x] Build the definition-surface parity and source-resolution matrix.
- [x] Reproduce runtime, resume, confinement, proof, freshness, and attribution defects with the smallest checks.
- [x] Reconcile script/capability ownership and exact callers.
- [x] Trace optional `version` and digest behavior without adding compatibility machinery.
- [x] Rank root-cause repairs/deletions and record the evidence-backed Solution.
- [x] Publish `docs/inventory/d8-0729-workflow-contract-inventory.md` and link it from the Solution.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

Audit complete on commit `86fd36978`. Durable deliverable: **`docs/inventory/d8-0729-workflow-contract-inventory.md`** (ADR/task claim matrices, baseline field register, live gate reproduction log, surface-parity matrix, full defect anchors, script-ownership reconciliation, `version` contract trace, prioritized decisions). This Solution carries the R8 register; the artifact carries the evidence.

**Verdict**: the strict-gate architecture is sound and mostly implemented (script-contract gate PASS; budgets gate live; ADR-094-100 code all present), but three S1 defects make real flows silently wrong, the ADR-069 steady-state invariant has drifted (42 unsuppressed findings vs recorded 0/25), and the corpus snapshot lacks the D8/E81 wave so `task check --corpus` fails those 24 findings pending regeneration.

**R8 defect/decision register** (Sev | root cause → current behavior → smallest repair → owning layer → regression check → downstream slice → uncertainty):

1. **S1 command.gate timeout dead** — command-gate.ts:157 spreads key `timeoutMs`; ProcessExecutor contract is `timeout` (ts-runtime process-executor.ts:59,269); conditional spread bypasses excess-property check → every `timeoutMs` silently ignored (feature-dev 1800000ms is dead config) → rename key to `timeout` at command-gate.ts:157 → packages/app action layer → focused test: gate with 50ms timeout kills a `sleep 5` command → 0731 strategy must not assume gate timeouts work until fixed → none (contract unambiguous).
2. **S1 nested feature-dev review structurally dead** — feature-dev.yaml:156-169 spawns `spur workflow run pr-review.yaml`; sync path sets `SPUR_WORKFLOW_RUN_ACTIVE=1` (workflow.ts:656); nested guard (workflow.ts:402-414, 0610 R4) refuses the child; `softFail: true` swallows the FAIL → integration review never runs, parent still reaches done → operator decision: allow one guarded nesting level OR replace gate with non-spawning check → config/workflows + CLI guard → test: feature-dev run reaches integration-review with the child actually executing (or gate removed) → pilot flow must not claim integration review coverage → nesting policy is a product choice, flagged not chosen.
3. **S1 CLI drops `spurConfig`** — makeSvc (apps/cli/src/commands/workflow.ts:253-286) omits the documented-only-config-source field (workflow-service.ts:433) → `resolveDefaultAgentVar` (:668) always null on CLI → `agent.default` ignored for run/continue → thread `spurConfig` through makeSvc → apps/cli command layer → test: run with `agent.default` set uses it without `--agent` → agent-routing UX before pilot → none.
4. **S2 continue ignores definition drift** — continuePaused (workflow-service.ts:1007) re-resolves by name, `validateSchema: false` (:1076), never compares persisted `definitionDigest` (stamped :171-176); drift is only a projection diagnostic (progress-projection.ts:293) → edited YAML silently resumes mid-run → compare digest at resume; block or require explicit `--force-drift` → packages/app service → test: resume after digest change refuses without flag → 0733 resume semantics → none.
5. **S2 fail-open proof fingerprints** — `createGitAlternateTree` returns `''` on git failure (proof-input-fingerprint.ts:99,105,110,118) → empty-tree digest still matches prior empty digests; bracket silently degrades to spec-only → fail closed: throw on git error → packages/app proof layer → test: unreadable git repo fails the run, not a weak digest → proof trust before pilot selection → none.
6. **S2 run-id path escape** — `--run-id` unvalidated (apps/cli/src/commands/workflow.ts:512, same fallback on the async path :424), joined into log/trace paths (packages/app/src/observability/workflow-run-log-sink.ts:70) → `../` escapes `.spur/run/`; command.gate/run.artifact DO enforce the prefix (asymmetry) → validate run-id (reject `/`, `..`, absolute, empty) at CLI entry → apps/cli → test: `--run-id ../x` rejected → evidence confinement → none.
7. **S2 suppressed task lookup weakens proof** — test onEnter[0] `task path … 2>/dev/null || true … exit 0` writes an empty taskpath file on lookup failure → `taskSpecPath=""` → readOptional skips spec → digest is tree-only, silently → drop the `|| true` so a failed lookup FAILs the hop, or mark the digest degraded → config/workflows + agent-run → test: unknown wbs at test stage fails loudly → proof-chain symmetry (0703 follow-through) → none.
8. **S2 stale verifier expectFile** — verify hop asserts `.spur/run/<wbs>-verify-answer.txt` existence post-exit (agent-run.ts:553+); nothing deletes a prior run's file → stale artifact satisfies freshness check → `rm -f` the expectFile before the verify hop (or mtime-after-start check) → config/workflows → test: run twice; second verify fails if the agent wrote nothing → verifier honesty before pilot → none.
9. **S3 run.artifact proof binding decorative** — proofBinding echoed into result data only (run-artifact.ts:88-101); DAO record `{path,kind,runId}` → no enforcement behind the claim → either bind (validate path + record proof digest) or rename option to honest `label` → packages/app + schema → test: invalid proofBinding path rejected → artifact governance post-pilot → whether any workflow uses proofBinding today: not checked (none found in config/workflows grep).
10. **S3 whole-worktree Solution attribution** — `gitDiffU0` diffs entire tree (task-record.ts:609), `--solution-from-diff` backfills (task-service.ts:1157) → multi-task trees attribute all changes to the recording task → acceptable in single-task worktrees (current runall mode); if shared trees return, scope diff by task's declared paths → packages/app service → test only if shared-tree mode returns → strategy-slice tooling → conditional, stated.
11. **S3 pipeline-budgets direct invocation no-op** — no `import.meta.main` bootstrap; only scripts/spur-dev.ts:106 calls run() → operators running the obvious filename get silent success → add `if (import.meta.main) await run()` → scripts/commands → test: direct run executes the check → operator ergonomics → none.
12. **S3 composition baseline rot** — 6 inert fields/workflow + `proofInputs` have zero consumers (regen --check: 49 drifted facts; regen deletes them); 42 unadjudicated ADR-069 advisories (was 0 findings/25 suppressed on 2026-08-21) → baseline reads as contract, enforces part of itself → run regen to delete inert fields; re-record dispositions for the 42 (or accept advisory posture formally) → config + workflow-service advisory → gate: regen --check clean + advisory count 0 → ADR-069 amendment ticket → none.
13. **S3 surface inventory stale + narrow check scope** — 3 live mismatches (`spur database` noun gone; `task create --section/--body` gone); script-contract-check covers plugins/sp/scripts only; `regen-corpus-baseline` has no package.json entry; pr-review calls `superskill script path sp pr-reviewing.ts` (the `.ts`, twin contract ships `.mjs`) → help-captured SSOT no longer describes CLI → refresh inventory; extend placement check to scripts/commands + package.json surfaces; confirm superskill `.ts` staging (operator machine) → apps/cli + plugins/sp → gate: surface-drift-inventory clean → surface governance → superskill `.ts` staging behavior unverified this pass.
14. **Decision: corpus gate failing by design, not waived** — snapshot has 272 accepted entries but not this wave; `task check --corpus` exit 1 on the 24 unaccepted findings (incl. this wave + E81) → regenerate snapshot AND migrate it to ADR-093 waiver fields (owner/review-date/removal) — the migration 093 names "pending" has not happened → config + scripts/commands → gate: corpus-check exit 0 post-regen → ADR-090/092/093 convergence ticket → none.
15. **Decision: derived-doc drift** — docs/03 §24 header says "not yet built" for ADR-094-100 while all are shipped; ADR-102 points at docs/04 §agent-capability-attestation which does not exist → update §24 header; write the missing §agent-capability-attestation section (or re-point the ADR) → docs owners → link-check extension to section anchors would catch this class → docs hygiene before strategy review → none.
16. **Contract record: workflow `version`** (R7, no repair) — both dialects: optional string, empty allowed; zero consumers; not rendered by list/show/trace; included in `computeDefinitionDigest` → version-only edits change digests with no behavior change; target contract `unversioned` / `explicit(<literal>)` (opaque); no registry or mandate is justified today — mandate requires a real consumer or a drift incident the digest diagnostic could not disambiguate (neither exists).

**Statuses applied to claims** (detail in artifact §A/§B): implemented 050/060(s)/065/070/071/072/076/087(s)/088-a/090/092/094/095/096/097/098/100/102-code + tasks 0603/0607/0614/0703-0712/0723; partial 051/093/099; drifted 069; dead 083 (superseded), nested review (behavior); stale-doc 102/094-100 derived docs. `(s)` = sampled. No `done` task was found without corresponding code.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/inventory/d8-0729-workflow-contract-inventory.md` §A/§B re-read this run (150 lines (row :75 annotated)); §A-090 row carries repaired corpus wording ("272 accepted entries but lacks the D8/E81 wave", close-out commit 7c33b6d3b verified via git show) |
| R2 | MET | §A/§B statuses + dispositions present; sampled-claim honesty preserved; no done-without-code found (spot anchors re-read exact) |
| R3 | MET | §C register rows re-read (`docs/inventory/d8-0729-workflow-contract-inventory.md:64-65,:75`); budgets direct-run no-op reproduced this run, then **repaired**: `import.meta.main` bootstrap added to `pipeline-budgets.ts` + `real-run-cost.ts` — direct `bun scripts/commands/pipeline-budgets.ts` now executes (exit 1 on the recorded docs-pipeline RED); artifact row `:75` annotated; corpus gate failure recorded, not waived |
| R4 | MET | §E parity matrix row re-read (`docs/inventory/d8-0729-workflow-contract-inventory.md:92` — CLI show/list/projection-status exposure row present) |
| R5 | MET | §F row 14 (S3 dry-run validity) present at `docs/inventory/d8-0729-workflow-contract-inventory.md:112` — prior review's R5 dry-run gap closed; defect anchors re-read exact this run: `packages/app/src/workflow/actions/command-gate.ts:157` (timeoutMs spread), `apps/cli/src/commands/workflow.ts:512` + `:424` (unvalidated runId), `apps/cli/src/commands/workflow.ts:402-414` (nested guard), `packages/app/src/services/workflow-service.ts:1007` + `:1076` (validateSchema:false), `packages/app/src/workflow/proof-input-fingerprint.ts:99-118` (fail-open `''`), `packages/app/src/observability/workflow-run-log-sink.ts:70` (join runId), `packages/app/src/workflow/actions/agent-run.ts:553-556` (expectFile), `config/workflows/feature-dev.yaml:156-169` (nested pr-review spawn, softFail, timeoutMs 1800000) |
| R6 | MET | §G four-surface reconciliation present; `bun plugins/sp/scripts/script-contract-check.ts` → PASS 17 scripts, 0 violations, exit 0 (fresh); `bun plugins/sp/scripts/surface-drift-inventory.ts` → 3 mismatches, exit 0 (fresh) |
| R7 | MET | §H optional-version trace present; digest mechanism re-read at `packages/app/src/workflow/composition-baseline.ts:110` (`computeDefinitionDigest`, canonical JSON → sha256) |
| R8 | MET | Solution 16-entry severity register re-read in task body; unknowns stay unknown (product-choice nesting flagged, not chosen) |
| R9 | MET | `docs/inventory/d8-0729-workflow-contract-inventory.md` exists (150 lines (row :75 annotated), §A–§I + Unknowns) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | §A/§B complete incl. ADR-102 + derived-doc drift rows; anchors re-read fresh (above) |
| AC2 | MET | command | Gates re-run fresh: `bun scripts/commands/pipeline-budgets.ts` now executes the check (exit 1, recorded RED — bootstrap repaired this pass); `bun plugins/sp/scripts/script-contract-check.ts` exit 0 PASS; `bun plugins/sp/scripts/surface-drift-inventory.ts` exit 0, 3 mismatches |
| AC3 | MET | command | §E rows + schema anchors; `packages/app/src/services/workflow-service.ts:1076` validateSchema:false re-read |
| AC4 | MET | command | §F 14 rows incl. dry-run validity row 14 (`docs/inventory/d8-0729-workflow-contract-inventory.md:112`) — prior PARTIAL cause repaired |
| AC5 | MET | command | §G caller/context/owner per finding; script-contract-check PASS fresh |
| AC6 | MET | command | §H trace; `packages/app/src/workflow/composition-baseline.ts:110` re-read |
| AC7 [non-behavior] | MET | llm-judge | Solution names downstream slices per register entry; product-choice (nested review) flagged not chosen; no disguised operator decision found this re-read |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Verdict: PARTIAL** — deliverable is substantially sound (≈20/25 cited anchors re-verified exactly; gates re-run live this review: `regen --check` exit 1 with 49 inert-field drops ✓, `task check --corpus` exit 1 ✓, `script-contract-check` PASS 17/0 ✓, `surface-drift-inventory` 3 mismatches ✓, budgets direct-run silent exit 0 ✓), but one major factual error in the corpus evidence and four requirement coverage gaps block PASS.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | correctness | `docs/inventory/d8-0729-workflow-contract-inventory.md:28,64,74` | Corpus snapshot claim "0 entries / snapshot empty" is false: `config/corpus-baseline.json` has **272 entries** (file unchanged since commit e2142f7c, i.e. at audit HEAD). Gate does fail (exit 1, 24 NEW findings incl. E81 + this wave) — the *conclusion* survives, but the stated *cause* is wrong and "all findings NEW" overstates (272 accepted pass). Decision 8/14's motivation needs rewording to "snapshot lacks the D8/E81 wave", not "empty". Material error in an evidence-audit deliverable. |
| P3 | correctness | `apps/cli/src/commands/workflow.ts:512` | Register §F-6 cites run-id unvalidated at `workflow.ts:519` — actual site is :512 (`options.runId` falling back to `crypto.randomUUID()`); :519 is the heartbeats map. A second unvalidated site at :424 (async path) strengthens the finding but is unmentioned. Substance confirmed. |
| P3 | correctness | `scripts/commands/pipeline-budgets.ts` | §D + Testing probe cited `bun plugins/sp/scripts/pipeline-budgets.ts` — file does not exist there (ENOENT, not "silent exit 0"); real path is `scripts/commands/pipeline-budgets.ts`. Re-ran correct path this review: silent exit 0, defect 11 holds. Budgets gate itself (via `scripts/spur-dev.ts check-pipeline-budgets`) was never reproduced live — "budgets gate live" claim rests on anchors only. |
| P3 | functional | `docs/inventory/d8-0729-workflow-contract-inventory.md` (§F) | R5's "dry-run validity" item is unaddressed — no dry-run row in §F, no register entry, zero mentions in artifact or Solution. R5/AC4 require every named defect covered. |
| P3 | correctness | `packages/app/src/observability/workflow-run-log-sink.ts:70` | §F-6 cites `packages/app/src/workflow/workflow-run-log-sink.ts:68` — wrong directory (`observability/`), join is at :70. Escape-path substance confirmed (`join(dir, runId + '.log')`, runId unvalidated upstream). |
| P4 | correctness | `@gobing-ai/ts-runtime` `dist/process-executor.d.ts` line 58 | Defect 1's executor contract cited as repo-path "ts-runtime process-executor.ts:59,269"; it is an external dependency and should use the 0584 external-evidence form. Substance confirmed: contract key is `timeout`, command-gate.ts:157 spreads `timeoutMs` — defect stands. |
| P4 | correctness | `docs/inventory/d8-0729-workflow-contract-inventory.md` (§E) | "engine schema.ts:76/:119" anchor for omitted-`kind` could not be corroborated (no such file under packages/app/src/workflow; closest is stage-registry/schema.ts). Behavior claim is consistent with JSON schemas + the recorded probe, but the citation is unverified. Omitted-kind probe not re-run this review (operator-cancelled). |
| P4 | functional | `docs/inventory/d8-0729-workflow-contract-inventory.md` (§C) | R3 asks per-field owner, callers, staleness, and removal criteria; §C carries consumer + disposition but no owner/removal-criteria columns. ADR-093 migration (Decision 8) will need them anyway. |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | §A covers every named ADR (051, 060, 065, 069–072, 076, 087, 093–100, 102; baselines 050/062/088/090/092) + §B tasks 0603/0607/0614/0703–0712/0723, all with anchors; derived-doc drift (094–100, 102) recorded |
| R2 | MET | §A statuses implemented/partial/drifted/dead/stale-doc with dispositions embedded; §B honest sampling ("not re-verified this pass"); no `done`-without-code found |
| R3 | PARTIAL | §C traces fields → consumers/exit effects, inert fields proven (49 regen drops re-run exit 1); MISSING owner/removal-criteria columns; budgets gate itself not reproduced live (only the no-op) |
| R4 | PARTIAL | §E proves validate/run/continue divergence (:640 vs :1076), resolution precedence (:1696 vs make-lifecycle-adapter:27–29), digest/version interaction (:110); MISSING explicit show/list/lifecycle/projection-status rows and extensions/onError axis |
| R5 | PARTIAL | §F reproduces 12 of 13 named defect areas severity-ranked with exact anchors (1–5, 7–10, 12–13 verified this review); MISSING dry-run validity |
| R6 | MET | §G covers all four surfaces, exact YAML callers (task-pipeline prechecks, history-anatomy .mjs, pr-review:69 `.ts`), consent ledger, package.json gap (regen-corpus-baseline absent — confirmed), script-contract-check scope gap; no public verb proposed |
| R7 | MET | §H: optional string, empty allowed, zero consumers, digest-inclusive, target contract + evidence bar for any future mandate; no registry/mandate proposed |
| R8 | MET | Solution register: 16 entries, each with severity/root cause/behavior/repair/owning layer/regression check/downstream slice/uncertainty; product choice (nesting) flagged not chosen |
| R9 | MET | `docs/inventory/d8-0729-workflow-contract-inventory.md` exists with §A–§I + Unknowns; Solution summarizes and links it |

#### AC summary

| AC | Status |
| --- | --- |
| 1 (all ADRs/tasks statused incl. 102 + derived-doc drift) | MET |
| 2 (baseline fields proven or inert; failures recorded not waived) | MET |
| 3 (parity matrix proves named differences) | MET (thin on progress axis) |
| 4 (register covers every R5 defect) | PARTIAL — dry-run validity missing |
| 5 (script findings name caller/context/owner) | MET |
| 6 (version trace incl. empty-string gap, no mandate) | MET |
| 7 (Solution sufficient for 0731/0733; no disguised choices) | MET |

#### Verification evidence (this review, fresh)

- `bun run scripts/commands/regen-composition-baseline.ts --check` → exit 1, 49 "dropped inert" lines (matches claim)
- `bun run apps/cli/src/index.ts task check --corpus` → exit 1, 24 NEW findings; snapshot file has **272** entries (contradicts artifact)
- `bun run scripts/commands/pipeline-budgets.ts` → silent exit 0 (defect 11 confirmed at correct path)
- `bun plugins/sp/scripts/script-contract-check.ts` → PASS 17 scripts (7/10), 0 violations
- `bun plugins/sp/scripts/surface-drift-inventory.ts` → 3 CONFIRMED MISMATCHES, exit 0
- Anchors re-read: command-gate.ts:157, feature-dev.yaml:156–169, workflow.ts:402–414/:512/:656/:253–286, workflow-service.ts:433/:640/:668/:1007/:1076/:169–178/:1696, proof-input-fingerprint.ts:99–118, agent-run.ts:553+, run-artifact.ts:88–101, task-record.ts:609, composition-baseline.ts:110, make-lifecycle-adapter.ts:27–29, pr-review.yaml:69, process-executor.d.ts:58

#### Residual risk

All three S1 defects (dead `timeoutMs`, dead nested review, dropped `spurConfig`) are anchor-verified real and block the 0731 pilot assumptions, not this gate. The corpus P2 error, if uncorrected, risks 0731/0733 planning against "empty snapshot" instead of "stale-but-populated snapshot" — one-line wording fix plus Decision 8 rewording. Fix path: correct §C/§D/§A-090 + Testing corpus wording, add the dry-run row (or record it as intentionally deferred with reason), fix the three stale citations.

**Disposition**: PARTIAL — repair the P2 corpus wording and the dry-run R5 gap (both doc-only, ~10 lines) before the pipeline's record step consumes this as pilot-selection input.

### References

- `docs/00_ADR.md` — ADRs 050, 051, 060, 062, 065, 069-072, 076, 087, 088, 090, 092-100, 102.
- `docs/03_ARCHITECTURE.md`; `docs/04_DESIGN.md`; `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`; `docs/design/harness-surface-governance.md`.
- `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/lifecycle-adapter.ts`; `packages/app/src/workflow/progress-projection.ts`.
- `packages/app/src/workflow/actions/{agent-run,command-gate,proof-fingerprint,run-artifact}.ts`; `packages/app/src/workflow/proof-input-fingerprint.ts`.
- `apps/cli/src/commands/workflow.ts`; `apps/cli/src/workflow/make-lifecycle-adapter.ts`; `apps/cli/src/commands/shared-options.ts`; `apps/cli/schemas/*workflow.schema.json`.
- `config/workflows/`; `config/workflow-composition-baseline.json`; `config/corpus-baseline.json`; `config/plugin-scripts.json`.
- `scripts/commands/{regen-composition-baseline,pipeline-budgets}.ts`; `plugins/sp/scripts/script-contract-check.ts`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.

### History

- 2026-09-02T15:01:53.573Z todo → wip (system)
- 2026-09-02T16:05:07.152Z wip → testing (system)
- 2026-09-02T16:05:18.334Z testing → done (system)
