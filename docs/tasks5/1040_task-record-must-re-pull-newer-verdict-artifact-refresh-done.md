---
schema_version: 1
name: task record must re-pull newer verdict artifact; refresh done_reason on re-close
status: todo
template: issue
created_at: 2026-10-01T18:14:27.154Z
updated_at: "2026-10-01T20:14:43.742Z"

feature_id: F91
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
---

## 1040. task record must re-pull newer verdict artifact; refresh done_reason on re-close

### Background

**Origin.** Filed from the active 2026-10-01 session after task 1039 encountered record-before-verdict ordering and task 1038 retained an obsolete forced-close narrative. The title preserves the original filing wording; the corrected scope below is authoritative.

**Problem 1 — UNKNOWN without an actionable diagnosis.** TaskService.record already reads the selected artifact on every invocation (packages/app/src/services/task-service.ts:1413). A subsequent readable PASS/PARTIAL/FAIL refreshes Testing (packages/app/src/services/task-service.ts:1428). Missing and malformed files still collapse to UNKNOWN (packages/app/src/services/task-record.ts:121), while RecordResult exposes no artifact state (packages/app/src/services/task-record.ts:92) and the CLI reports only section writes (apps/cli/src/commands/task.ts:1234). Record-before-verdict can therefore write an honest but unexplained UNKNOWN stub. The fix is explicit artifact-state reporting, cross-task safety and unchanged-content write avoidance, not a new reread mechanism.

**Problem 2 — obsolete close metadata.** The shared guarded transition writes done_forced/done_reason only for forced closes (packages/app/src/services/task-transition.ts:219). Task 1038 remains done with fresh literal PASS Testing, but its frontmatter still describes the old PARTIAL acceptance. The separate record --transition done path writes lifecycle hops directly (packages/app/src/services/task-service.ts:1538), so fixing only transitionTaskGuarded leaves a sibling path unreconciled.

**Read-only reproduction, 2026-10-01.** Missing and malformed reader probes both returned UNKNOWN; a record-reader probe requested 0001 but accepted a PASS tagged 9999. An unforced guarded close returned transitioned with zero audit-field writes and left the seeded done_forced=true / old forced PARTIAL fields untouched. No live task status was changed by these probes.

**Excluded.** No new public noun/verb, verdict aggregation/lint changes, task-pipeline.yaml edits, weakening of completion guards, or re-closing live task 1038 as a workaround. Shared done/feature-gate artifact identity is a separate finding owned by task 1042; this task's R4 covers the record reader.

**Refine corrections (2026-10-01, active session triage).**

- "record never re-pulls" → every invocation reads at task-service.ts:1413 and a real verdict refreshes Testing → retain this behavior; repair missing/malformed diagnostics and idempotent writes.
- "unforced close may have no artifact" → the existing done guard denies absence → preserve denial; no neutral-note branch may permit an otherwise rejected close.
- "transitionTaskGuarded covers every done write" → record has a separate auto-walk → reconcile audit fields after both successful done paths.
- Checked Requirements and plain AC bullets implied unsupported completion and escaped AC parsing → unchecked requirements and parseable task-local AC now describe unimplemented work.
- Direct documentation fixes already reconcile record ordering/preservation, record's done support, and session-review --triage. Those prose repairs are excluded from implementation.

### Requirements

- [ ] R1. Keep the existing per-invocation artifact read and real-verdict Testing refresh. Add readable/missing/malformed state and an actionable message naming the selected path and verdict-first remedy to the existing record result and human output. Missing/malformed UNKNOWN preserves authored Testing; bare Testing may receive the honest stub. An identical generated section is not rewritten; no mtime ledger or new cache is added.
- [ ] R2. Reconcile done_forced/done_reason after every successful status change to done, including task update/server guarded transitions and record --transition done. Forced closes retain the current supplied reason and true flag; unforced closes clear the prior forced flag and describe the current accepted PASS artifact. Missing artifacts remain denied by the existing guard. Same-status no-ops and failed intermediate hops write no new close metadata.
- [ ] R3. Preserve happy-path rendered Testing/Review content, authored Review ownership, checkbox semantics, lifecycle guard order, provenance link timing and best-effort audit-error reporting. Additive artifact-state/message output must not change existing fields or introduce a public verb/flag.
- [ ] R4. A record artifact explicitly identifying another WBS is unusable for the requested task: report expected/actual WBS and path, derive no PASS or checkbox flips from it, and preserve authored Testing. Artifacts omitting WBS keep the existing fallback-WBS compatibility. PARTIAL still flips only its proven MET boxes; FAIL/UNKNOWN flip none.

### Acceptance Criteria

- [ ] AC1 — Record reports unavailable evidence and refreshes after a real verdict arrives (req: R1)
  Given a scratch task with bare Testing and no artifact, or a malformed artifact
  When record runs, then a readable verdict is written and record runs again
  Then the first result names the artifact state/path and verdict-first remedy
  And the second Testing contains the current verdict; a third unchanged record performs no section rewrite
  Verify in packages/app/tests/services/task-record.test.ts and a scratch source-CLI JSON/human probe.

- [ ] AC2 — Both unforced close paths replace stale forced-close metadata (req: R2)
  Given a scratch task seeded with an earlier forced flag/reason and a current accepted PASS
  When it reaches done through guarded task update or record --transition done
  Then the forced flag is cleared and the reason describes the current accepted close
  And forced overrides preserve their current supplied reason; no-op, missing-artifact denial and failed-hop cases do not reconcile metadata
  Verify in packages/app/tests/services/task-transition.test.ts and packages/app/tests/services/task-record.test.ts.

- [ ] AC3 — Record rejects foreign-task evidence without changing valid ownership rules (req: R3, R4)
  Given a readable artifact explicitly tagged for a different WBS, plus authored Testing/Review
  When record reads it for the requested task
  Then the result names the mismatch and no foreign requirement box is checked
  And authored content is preserved; matching and omitted-WBS artifacts retain existing valid behavior
  Verify in packages/app/tests/services/task-record.test.ts.

- [ ] AC4 — Existing record and transition behavior remains green (req: R1, R2, R3, R4)
  Given the targeted service/CLI suites and the root lint, coverage and rule configuration
  When the extended targeted suites and bun run spur-check run
  Then all applicable checks pass with no weakened gate, parser or baseline

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-01T18:19:31.483Z

- 2026-10-01 (enrichment): Re-parented F96 → **F91**. Rationale: F96's Scope is a deterministic residual scanner (`.spur/run/<wbs>-residuals.json`) and its In-list excludes record/verdict changes; F91 owns "corpus gates tell the truth about evidence," which both defects are.
- 2026-10-01 (enrichment): Freshness via always-read + content-diff (no mtime ledger, no new hash infra). Malformed artifacts surface a distinct message but still leave the stub — the stub is honest ("unreadable"), silence is not.
- 2026-10-01 (enrichment): Drift guard — implementer must NOT modify verdict linting, transition gates, `status` mode JSON, or `task-pipeline.yaml`, and must NOT add public `spur` nouns/verbs (consent rule). If those look necessary, stop and re-scope with the operator.

#### Q&A entry — 2026-10-01T20:14:43.742Z

- 2026-10-01 session triage: per-invocation reads and readable Testing refresh already exist; preserve them. Fix explicit artifact diagnostics and unchanged-content rewrites.
- Missing verdicts remain denied on unforced done; no metadata fallback may weaken that guard.
- Audit reconciliation covers both guarded transitions and record's done auto-walk. Preserve same-status no-ops, provenance timing and authored Review.
- Task-local AC below the F91 ship-contract altitude is intentional. Existing task 1040 owns record identity/diagnostics and close metadata; new task 1042 owns shared guard/feature identity. Their task-transition.ts edits must be serialized.

### Design

**WHAT / WHY.** Repair record diagnostics and close-audit truth at the existing service seams. Per-invocation reading and Testing refresh already work; preserve them.

**WHERE.** packages/app/src/services/task-record.ts owns artifact parsing and RecordResult; packages/app/src/services/task-service.ts composes record and its done auto-walk; packages/app/src/services/task-transition.ts owns guarded closes; apps/cli/src/commands/task.ts formats human output. Use the existing PlanningWriteService frontmatter mutation path for clearing a stale flag; if deletion is unavailable, add only the narrow internal capability in that existing service. Never bypass corpus writes with raw file rewriting. Update the owning planning-workflow design contract when the actual output behavior changes.

**Frozen result names.** Add verdictState with readable | missing | malformed and an optional verdictMessage naming the path/remedy. An explicit foreign WBS is unusable and reported as missing with a mismatch message. Keep existing RecordResult fields. Missing WBS retains fallback compatibility.

**R1/R4 algorithm.** Read every call as today. Classify read/parse outcome and validate explicit WBS before any evidence-driven section/checkbox write. Preserve the current UNKNOWN/authored-Testing rule. Compare generated section content before updating it; no cache or mtime bookkeeping. Review remains bare/record-authored fallback only. CLI JSON carries the service fields; human output adds the state/remedy without a new flag.

**R2 algorithm.** Use one shared internal audit reconciliation routine in an existing service file. Invoke it only after the guarded transition or record's actual final done hop succeeds; the two callers must not duplicate audit policy. Forced closes record the current explicit override; unforced closes clear the obsolete flag and summarize the accepted current artifact, without fabricating an "all requirements MET" claim. Retain the current best-effort, reported audit-error behavior. No-op done→done, denied transitions and incomplete auto-walks do not reconcile. Missing-artifact guards remain unchanged.

**Boundaries / handoff.** Do not modify done-transition-guard.ts, aggregation, verdict lint, status-mode JSON or task-pipeline.yaml in this task. Task 1042 owns explicit foreign identity rejection in the shared guard/feature reader. The two tasks overlap task-transition.ts; execute serially or in isolated trees and accommodate the other change. No dependency on an unimplemented API is assumed. Tasks 1038/1039 are reproduction examples, not implementation prerequisites.

**Rejected alternatives.** No second workflow engine, verdict reread loop, mtime/hash cache, new public command, live force-close workaround or gate suppression. The verdict-first driver order remains the valid standard contract.

### Plan

- [ ] 1. Reproduce missing/malformed diagnostics, record-reader foreign identity and stale forced metadata with scratch fixtures. Confirm readable re-record already refreshes Testing; retain it as the control.
- [ ] 2. Add artifact state/message and explicit-WBS safety in task-record.ts; wire them through TaskService.record and the existing CLI output. Preserve UNKNOWN/authored-Testing and Review ownership.
- [ ] 3. Avoid unchanged generated section rewrites. Extend the existing record tests for missing, malformed, matching, omitted and foreign WBS, changed/unchanged re-record and checkbox parity.
- [ ] 4. Implement one internal close-audit reconciliation routine and invoke it after both successful done write paths. Reuse the existing frontmatter writer; preserve guard order, missing-artifact denial, provenance timing and audit-error reporting.
- [ ] 5. Extend both record and transition suites for forced/unforced fresh/stale metadata, no-op and failed-hop cases. Run scratch CLI probes for JSON/human state messages and both close paths.
- [ ] 6. Update the owning design satellite for actual output changes, run targeted suites and bun run spur-check, then verify/record this task with its verdict written first. Do not commit or remediate live 1038 metadata as a shortcut.

### Root Cause

The record reader collapses read/parse failures into the same UNKNOWN value (packages/app/src/services/task-record.ts:121), and RecordResult/CLI human output do not expose why (packages/app/src/services/task-record.ts:92; apps/cli/src/commands/task.ts:1234). This makes record-before-verdict opaque. It is not a missing reread: TaskService.record reads every invocation at packages/app/src/services/task-service.ts:1413 and refreshes real-verdict Testing at packages/app/src/services/task-service.ts:1428.

The guarded close writes audit fields only inside its forced branch (packages/app/src/services/task-transition.ts:219). Record's separate final done hop goes directly through the lifecycle writer (packages/app/src/services/task-service.ts:1538). Consequently an earlier forced narrative survives a later unforced close through either path.

A read-only in-memory probe confirmed an unforced close returned transitioned, made zero audit-field writes and retained seeded forced/PARTIAL metadata. Task 1038's current CLI metadata supplies the real tracked example. Reader probes also confirmed missing/malformed both yield UNKNOWN and a foreign explicit WBS survives record parsing. Shared done-guard identity rejection is task 1042, outside this task's writer/diagnostic scope.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Session evidence: 1039 gate denial (`[WARN] L4` UNKNOWN stub) and 1038 stale frontmatter — filed from the 2026-10-01 active session review (`--triage`).
- Commits: `1a398cf02`, `68285698a` (1039 pipeline), `87721715f` (1038 remediation whose re-close exposed Problem 2).
- Tasks: 1039 (failure transcript), 1038 (stale-close example, `docs/tasks5/1038_guard-quality-gate-recheck-against-empty-qualitygatecmd-vacu.md:11`).
- Feature: F91 (corpus gate integrity — evidence truth in the task corpus); initially misfiled under F96, re-parented during enrichment.
- Anchors: `packages/app/src/services/task-record.ts:39-74,111-135,238` · `task-transition.ts:24,80,219-229` · `task-service.ts:817-835` · `apps/cli/src/commands/task.ts:460` · `packages/app/src/services/done-transition-guard.ts:29`.

### History
