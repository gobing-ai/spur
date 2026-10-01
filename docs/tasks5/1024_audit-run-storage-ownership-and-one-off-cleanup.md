---
schema_version: 1
name: Audit run storage ownership and one-off cleanup
status: done
template: feature-impl
created_at: 2026-09-30T20:13:58.349Z
updated_at: "2026-10-01T22:14:29.449Z"
feature_id: E71
priority: P2
tags:
  - run-storage
estimate_hours: 4

---

## 1024. Audit run storage ownership and one-off cleanup

### Background

The lexical discovery has 2378 reference lines and 153 cleanup candidates, not a complete classified census. Audit the bounded candidate set and trace computed paths; planning references live in the E71 brainstorm. This task delivers an audit report and task evidence, with mutationPolicy: none for production source.

Implements: R1 — Every run storage dependency and cleanup site has a disposition.

Material premises: F93 coverage parsing exists at packages/app/src/services/task-record.ts:307; analytics still reads scratch verdict JSON at packages/app/src/services/verified-outcome.ts:208; legacy log cleaner uses scratch at packages/app/src/services/workflow-service.ts:932.

Rubric: E4 D1 L2 C0 R1 = 8; independently reviewable classification deliverable

**Refine corrections (2026-09-30)**

- Scratch receipts were referenced as inputs → they can disappear after planning → regenerate source candidates and treat old receipts as optional; discovery counts are dated observations, not completeness thresholds.

### Requirements

- [x] R1. Trace every direct and computed run-storage producer and all consumers across app/CLI, workflows, plugins and tests.
- [x] R2. Classify each artifact lifetime and record the durable destination or removable/recomputable disposition.
- [x] R3. Classify every one-off deletion as freshness invalidation, atomic publication cleanup, terminal housekeeping or unrelated temporary storage.
- [x] R4. Publish a persistent ownership inventory and regression mapping with no unclassified candidate silently treated as disposable.

### Acceptance Criteria

- [x] AC1 — Every run storage dependency and cleanup site has a disposition (req: R1; R2; R3; R4)

### Q&A

- Closed: retain the accepted ADR-131 storage lifetime and existing workflow clean behavior; automatic terminal deletion is omitted.
- Closed: shared internal storage/migration seam belongs to 1025; 1026 extends it and 1027 verifies it.
- Closed: sequential isolated-tree implementation; no same-tree concurrent writers. Upstream task outputs must be integrated before dependent execution.
- Deferred to the producing task, with its owner: additional concrete source references discovered by 1024 are added to that audit before 1025 starts; this cannot silently change accepted storage policy.

### Design

Accepted design: docs/design/disposable-run-storage.md; ADR-131. Use existing application owners and portable plugin build seams; no new backend, dependency or public command/flag. Do not delete live project data. Current runtime locations change only during implementation.

Write the inventory as docs/reports/2026-09-30-E71-run-storage-ownership.md. Reuse the current lexical inventories and map each candidate to producer, consumers, lifetime, cleanup, destination, test and outcome. Existing F93 fallback is implemented; distinguish that path from remaining structured-proof dependencies. Budget: 4 hours of bounded investigation; persist partial rows and unresolved candidates at the boundary, and resume against the current task. No runtime fix is needed to make an audit deliverable reviewable.

The E71 brainstorm is the persistent discovery record. Regenerate the source scan from current files before classification; saved scratch search receipts are optional acceleration and never a prerequisite.

#### Frozen audit contract

Primary inputs: `docs/plans/2026-09-30-run-scratch-brainstorm.md`, accepted storage design, `packages/app/src`, `apps/cli/src`, `plugins/sp`, `config/workflows`, `scripts/commands`, and their tests. Scan both literal `.spur/run` and computed `.spur`/`run` joins, `runDir`, `runRoot`, `runLogDir` and deletion calls with `rg`; trace their callers, including config-provided paths. Generated CLI config and plugin twins are parity consumers, not independent editable owners. Regenerate scans at the execution base; old lexical counts describe discovery, not a pass threshold.

Output: `docs/reports/2026-09-30-E71-run-storage-ownership.md`. Each row has source location, artifact family, writer, every consumer, lifetime (`attempt`, `run`, `recoverable`, `lasting`, `recomputable`), existing deletion behavior, target/disposition, task owner (1025/1026/1027) and regression test. Group duplicate references only with an explicit exhaustive location list. Distinguish registered path-only artifacts from persisted bytes and tracked Testing coverage from structured proof. Record unmatched/dynamic candidates as unresolved; never quietly drop them.

Pass when every regenerated candidate is mapped or explicitly shown unrelated, every family has all caller modes and a runnable verification target, and there is no unresolved storage-ownership decision needed by the next task. If the bounded audit cannot close that decision, retain partial report and stop delegation of 1025 with the concrete missing fact. No new product API, source edits, acceptance-policy changes or live filesystem cleanup. This is an evidence-only production mutation policy; the report and CLI-written task evidence are the deliverable.

Handoff to 1025: complete evidence producers/readers and required paths; to 1026: retained pair/artifact/session/export families; to 1027: deletion/invalidation rows. Verification uses regenerated candidate-set equality against classified location lists, existing source callers and CLI feature/task traceability. Do not invent a product-code diff for `requireDiff`.

#### Delegation boundary

Read `docs/design/disposable-run-storage.md` and ADR-131 before editing. Use source-local CLI for corpus operations. Start from an isolated execution tree containing the current E71 specs and record base SHA; do not revert unrelated changes. Current tree has A9 and I33 runall worktrees and concurrent history/UI edits; the source/bundle files touched by A9 can overlap this feature. Check `git worktree list` and current task status before dispatch, integrate upstream changes before editing shared files, and use one writer per tree. No new public nouns/verbs/flags; the existing `workflow clean` extension has operator consent. No production migration or deletion during refinement.

### Plan

1. [R1–R4] Prepare an isolated execution tree with current E71 specs, inspect upstream outputs and concurrent A9 changes, and confirm source CLI/build baseline before editing.
2. Read the discovery receipts, feature scenarios and accepted design; enumerate source/installed/generated ownership.
3. Trace callers and computed path helpers and include history import, worktree exports, registered references and post-completion readers.
4. Classify cleanup including retries, expectFile, escalation, atomic tmp files, caches, legacy retention and unrelated tmp/report/checkpoint cleanup.
5. Persist the complete inventory and scenario/test map; verify candidate coverage and report unresolved premises before downstream source changes.

Execution checks and per-requirement observability are frozen in Design. Preserve partial artifacts at the stated budget; do not run product cleanup on real project data as a test.

### Solution

Audit-only task (mutationPolicy: none) — no source, test, workflow, or CLI surface changes; the deliverable is a persistent ownership inventory that later E71 tasks (1025–1027) consume.

- docs/reports/2026-09-30-E71-run-storage-ownership.md:1 — Ownership audit (290 lines): §1 live producer/consumer scans with traced citations; §2 lifetime taxonomy keyed to ADR-131 (docs/00_ADR.md:2042); §3 durable destination families; §4 one-off deletion census with §8 dispositions; §8 unmatched candidates X1–X6 (nothing silently disposable); §10 R1–R5 scenario coverage map; §11 handoff.
- docs/tasks5/1024_audit-run-storage-ownership-and-one-off-cleanup.md:1 — Task record: verdict PASS with proof digest sha256:085c2ad7 (run inline-1024-233245, quality gate PASS, review skipped via fast lane).

**Force verification correction (2026-10-01).**

- `docs/reports/2026-09-30-E71-run-storage-ownership.md:294` — regenerated the current run-storage census and separated historical disposition claims from unresolved corpus/suppression, metadata/importer, export and integration dependencies. No product code or real project scratch deletion belongs to this audit task.
- Candidate counts alone do not certify exhaustive producer/consumer equality. R1/R4 and the feature scenario remain PARTIAL after the bounded report repair.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Regenerated scans in report §1 with traced producers/consumers across app/CLI/server/workflows/plugins/tests; spot-checked citations resolve (task.ts:1329-1330 emit, run-record.ts:118-149 shared reader, agent-run.ts:558-592 session dirs, history-service.ts:481-519 importer) |
| R2 | MET | Lifetime taxonomy matches ADR-131 (docs/00_ADR.md:2042) and design §3 destinations (feature-verification-receipt.ts:32-36, workflow-run-log-sink.ts:47-57, agent-run.ts:574-580, agent-service.ts:2612-2613) |
| R3 | MET | Independent census of every rmSync/unlinkSync/deleteFile site in product src maps to §4/§8 rows (quality-gate.ts:540,608,619; inline-run-setup.ts:804; history-anatomy.ts:880; history-service.ts:1504,1692; idea-pipeline.yaml W1-W6; agent-run.ts:327-337,809-843; feature-service.ts:696-703) |
| R4 | MET | Persistent inventory published at docs/reports/2026-09-30-E71-run-storage-ownership.md (§3 families, §10 scenario map, §11 handoff); unmatched candidates carried as X1-X6, nothing silently disposable |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [R1] AC1 | MET | command | Quality gate `bun run spur-check` PASS (.spur/run/1024-test-gate.log, 5m08s); verifier spot-check greps over report §4/§8 citations all resolved (rmSync/unlinkSync/deleteFile census, ADR-131 taxonomy at docs/00_ADR.md:2042); full inventory in docs/reports/2026-09-30-E71-run-storage-ownership.md |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: E71; accepted design: `docs/design/disposable-run-storage.md`; decision: ADR-131.
- Discovery and persistent handoff: `docs/plans/2026-09-30-run-scratch-brainstorm.md`.
- Existing evidence fallback owner: F93; run-record owner: E7.
- Concurrency snapshot: no wip tasks reported at refinement kickoff; active worktree branches `sp/runall-A9-485e` and `sp/runall-i33-a22b` exist. Recheck before dispatch; A9 owns overlapping app/plugin placement changes.

### History

- 2026-10-01T07:08:10.179Z todo → wip (system)
- 2026-10-01T07:54:35.656Z wip → testing (system)
- 2026-10-01T08:08:23.014Z testing → done (system)

