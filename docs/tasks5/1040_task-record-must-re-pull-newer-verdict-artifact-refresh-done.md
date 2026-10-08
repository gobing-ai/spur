---
schema_version: 1
name: task record must re-pull newer verdict artifact; refresh done_reason on re-close
status: done
template: issue
created_at: 2026-10-01T18:14:27.154Z
updated_at: "2026-10-08T15:51:32.781Z"

feature_id: F91
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1040-verdict.json
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

- [x] R1. Keep the existing per-invocation artifact read and real-verdict Testing refresh. Add readable/missing/malformed state and an actionable message naming the selected path and verdict-first remedy to the existing record result and human output. Missing/malformed UNKNOWN preserves authored Testing; bare Testing may receive the honest stub. An identical generated section is not rewritten; no mtime ledger or new cache is added.
- [x] R2. Reconcile done_forced/done_reason after every successful status change to done, including task update/server guarded transitions and record --transition done. Forced closes retain the current supplied reason and true flag; unforced closes clear the prior forced flag and describe the current accepted PASS artifact. Missing artifacts remain denied by the existing guard. Same-status no-ops and failed intermediate hops write no new close metadata.
- [x] R3. Preserve happy-path rendered Testing/Review content, authored Review ownership, checkbox semantics, lifecycle guard order, provenance link timing and best-effort audit-error reporting. Additive artifact-state/message output must not change existing fields or introduce a public verb/flag.
- [x] R4. A record artifact explicitly identifying another WBS is unusable for the requested task: report expected/actual WBS and path, derive no PASS or checkbox flips from it, and preserve authored Testing. Artifacts omitting WBS keep the existing fallback-WBS compatibility. PARTIAL still flips only its proven MET boxes; FAIL/UNKNOWN flip none.

### Acceptance Criteria

- [x] AC1 — Record reports unavailable evidence and refreshes after a real verdict arrives (req: R1)
  Given a scratch task with bare Testing and no artifact, or a malformed artifact
  When record runs, then a readable verdict is written and record runs again
  Then the first result names the artifact state/path and verdict-first remedy
  And the second Testing contains the current verdict; a third unchanged record performs no section rewrite
  Verify in packages/app/tests/services/task-record.test.ts and a scratch source-CLI JSON/human probe.

- [x] AC2 — Both unforced close paths replace stale forced-close metadata (req: R2)
  Given a scratch task seeded with an earlier forced flag/reason and a current accepted PASS
  When it reaches done through guarded task update or record --transition done
  Then the forced flag is cleared and the reason describes the current accepted close
  And forced overrides preserve their current supplied reason; no-op, missing-artifact denial and failed-hop cases do not reconcile metadata
  Verify in packages/app/tests/services/task-transition.test.ts and packages/app/tests/services/task-record.test.ts.

- [x] AC3 — Record rejects foreign-task evidence without changing valid ownership rules (req: R3, R4)
  Given a readable artifact explicitly tagged for a different WBS, plus authored Testing/Review
  When record reads it for the requested task
  Then the result names the mismatch and no foreign requirement box is checked
  And authored content is preserved; matching and omitted-WBS artifacts retain existing valid behavior
  Verify in packages/app/tests/services/task-record.test.ts.

- [x] AC4 — Existing record and transition behavior remains green (req: R1, R2, R3, R4)
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

- [x] 1. Reproduce missing/malformed diagnostics, record-reader foreign identity and stale forced metadata with scratch fixtures. Confirm readable re-record already refreshes Testing; retain it as the control.
- [x] 2. Add artifact state/message and explicit-WBS safety in task-record.ts; wire them through TaskService.record and the existing CLI output. Preserve UNKNOWN/authored-Testing and Review ownership.
- [x] 3. Avoid unchanged generated section rewrites. Extend the existing record tests for missing, malformed, matching, omitted and foreign WBS, changed/unchanged re-record and checkbox parity.
- [x] 4. Implement one internal close-audit reconciliation routine and invoke it after both successful done write paths. Reuse the existing frontmatter writer; preserve guard order, missing-artifact denial, provenance timing and audit-error reporting.
- [x] 5. Extend both record and transition suites for forced/unforced fresh/stale metadata, no-op and failed-hop cases. Run scratch CLI probes for JSON/human state messages and both close paths.
- [x] 6. Update the owning design satellite for actual output changes, run targeted suites and bun run spur-check, then verify/record this task with its verdict written first. Do not commit or remediate live 1038 metadata as a shortcut.

### Root Cause

The record reader collapses read/parse failures into the same UNKNOWN value (packages/app/src/services/task-record.ts:121), and RecordResult/CLI human output do not expose why (packages/app/src/services/task-record.ts:92; apps/cli/src/commands/task.ts:1234). This makes record-before-verdict opaque. It is not a missing reread: TaskService.record reads every invocation at packages/app/src/services/task-service.ts:1413 and refreshes real-verdict Testing at packages/app/src/services/task-service.ts:1428.

The guarded close writes audit fields only inside its forced branch (packages/app/src/services/task-transition.ts:219). Record's separate final done hop goes directly through the lifecycle writer (packages/app/src/services/task-service.ts:1538). Consequently an earlier forced narrative survives a later unforced close through either path.

A read-only in-memory probe confirmed an unforced close returned transitioned, made zero audit-field writes and retained seeded forced/PARTIAL metadata. Task 1038's current CLI metadata supplies the real tracked example. Reader probes also confirmed missing/malformed both yield UNKNOWN and a foreign explicit WBS survives record parsing. Shared done-guard identity rejection is task 1042, outside this task's writer/diagnostic scope.

### Solution

**R1/R4 — classified verdict read (task-record.ts).** `RecordResult` gains additive `verdictState`/`verdictMessage` (`packages/app/src/services/task-record.ts:109,113`). New `ClassifiedVerdict` + `readVerdictClassified()` (`packages/app/src/services/task-record.ts:151-253`) returns `readable` (schema-valid, rows usable), `missing` (unreadable/empty file, or explicit foreign `wbs`), or `malformed` (bad JSON / non-object root / invalid structure), each with a verdict-first remedy naming the selected path and `spur task verify <wbs>`. Identity is checked on the RAW JSON (`'wbs' in record`, `packages/app/src/services/task-record.ts:224`) BEFORE `parseVerifyVerdict`, because the schema defaults an omitted `wbs` to `''` — omitted-WBS artifacts keep fallback compatibility, explicit mismatches report `expected wbs '<x>', actual <json>`. Legacy `readVerdict`/`parseVerdict` untouched; the UNKNOWN stub for non-readable artifacts is shared (`unknownStub`, `packages/app/src/services/task-record.ts:251`).

**R1 — record wiring (task-service.ts).** record() classifies once (`packages/app/src/services/task-service.ts:1413-1417`), copies state/message onto the result (`:1424-1426`), skips identical-content Testing/Review rewrites via trimmed compare before `updateSection` (`:1448-1453`, `:1466-1471`), gates the Requirements/AC checkbox flip on `classified.state === 'readable'` (`:1488`) so missing/malformed/foreign evidence (UNKNOWN stub) flips nothing, and keeps the authored-Testing gate (`:1436`) and scenario-key guard order intact.

**R2 — one close-audit reconciliation routine (task-transition.ts).** `reconcileDoneCloseAudit()` (`packages/app/src/services/task-transition.ts:160-193`) is the single policy invoked only after a successful done write: forced → keep supplied reason + `done_forced: 'true'`; unforced → clear the stale flag (`done_forced: 'false'`) and write `done_reason` describing the accepted PASS artifact (path named, nothing fabricated). Best-effort: returns the error string, never throws. `transitionTaskGuarded` captures the done-gate artifact path (`:237,241`) and reconciles after `updateStatus` (`:281-289`); failures surface on a new additive `closeAuditError` union field (`:103`, `:294-295`) — separate from `forced` so a present `forced` still means "operator override". `TaskService.record` reconciles after the auto-walk done hop (`packages/app/src/services/task-service.ts:1554-1562`) and the single-hop done fallback (`:1578-1584`); no-op (`current === target`), denied, and failed-hop paths return/throw before any reconcile.

**CLI (apps/cli/src/commands/task.ts).** Record human output adds one verdict-first `ⓘ` line when a message exists (`apps/cli/src/commands/task.ts:1247-1249`); `--json` is unchanged (envelope auto-serializes the new fields). The done-transition human output adds a best-effort warning for unforced close-audit failures (`apps/cli/src/commands/task.ts:676-683`), mirroring the existing forced `auditError` channel. No new verb/flag.

**Tests.** `packages/app/tests/services/task-transition.test.ts:284-322` (unforced reconcile, forced retention, no-op writes nothing, audit-failure reporting; harness gained `fieldValues` + `showStatus`); `packages/app/tests/services/task-record.test.ts:1862-2158` (missing/malformed/foreign/matching/omitted-WBS states, authored preservation, identical re-record no-rewrite, stale-metadata clearing on unforced re-close, denied-hop and no-op write-nothing pins). One pre-existing 0936 pin updated in place: its second record is byte-identical, so `reviewWritten` is now `false` by R1 (`packages/app/tests/services/task-record.test.ts:1287-1290`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-record.ts:191` readVerdictClassified returns readable/missing/malformed state; verdictState and verdictMessage at `packages/app/src/services/task-record.ts:127-134`; wired at `packages/app/src/services/task-service.ts:1475-1476`; CLI output `apps/cli/src/commands/task.ts:1358-1359` |
| R2 | MET | `packages/app/src/services/task-transition.ts:173-197` reconcileDoneCloseAudit, called at `packages/app/src/services/task-transition.ts:311`; record --transition done reconciles at `packages/app/src/services/task-service.ts:1637` and `packages/app/src/services/task-service.ts:1663` |
| R3 | MET | UNKNOWN keeps authored Testing at `packages/app/src/services/task-service.ts:1485`; identical-content skip at `packages/app/src/services/task-service.ts:1498` and `packages/app/src/services/task-service.ts:1516`; fresh 164 pass / 0 fail |
| R4 | MET | `packages/app/src/services/task-record.ts:244` wbs identity check reports expected/actual WBS and path; checkbox flips only for readable artifacts at `packages/app/src/services/task-service.ts:1555-1557` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/task-record.test.ts:2419`, `packages/app/tests/services/task-record.test.ts:2439`, `packages/app/tests/services/task-record.test.ts:2575` |
| AC2 | MET | test | `packages/app/tests/services/task-transition.test.ts:302-341`; record transition cases `packages/app/tests/services/task-record.test.ts:2604-2709` |
| AC3 | MET | test | `packages/app/tests/services/task-record.test.ts:2468`, `packages/app/tests/services/task-record.test.ts:2520`, `packages/app/tests/services/task-record.test.ts:2555` |
| AC4 | MET | test | fresh 2026-10-08 task-record + task-transition 164 pass / 0 fail; packages/app 4189 pass with the only 3 failures in out-of-scope DecisionService (`packages/app/tests/decision/decision-events.test.ts:283`, reproduced at HEAD) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1040

**Scope:** working-tree diff vs HEAD (base 48edb0c99) — 7 files: `packages/app/src/services/task-record.ts`, `task-service.ts`, `task-transition.ts`, `apps/cli/src/commands/task.ts`, `tests/services/task-record.test.ts`, `tests/services/task-transition.test.ts`, this task file (662+/43−).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS (no P1/P2 findings; 1×P3, 3×P4 advisory)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Disposition | Location |
|---|----------|-----------|---------|-------------|----------|
| 1 | P3 (minor) | usability | record's done auto-walk discards the error string returned by `reconcileDoneCloseAudit` — a failed close-audit write on the record path is silent, while the identical failure through `transitionTaskGuarded` is reported (`closeAuditError` result field + CLI warning). Reporting parity with the design's "best-effort, reported" audit behavior needs one additive `RecordResult` field or CLI line. | FIXED — additive `RecordResult.closeAuditError` (`packages/app/src/services/task-record.ts:96-101`), captured at `packages/app/src/services/task-service.ts:1558,1580` (both done shapes), CLI warning parity at `apps/cli/src/commands/task.ts:1246-1252`, pinned by record test (j); targeted suites 130 pass / 0 fail. | `packages/app/src/services/task-service.ts:1558,1580` vs `apps/cli/src/commands/task.ts:676-683` |
| 2 | P4 (advisory) | architecture | `readVerdict` is now production-orphaned (its only caller, `TaskService.record`, switched to `readVerdictClassified`) but remains exported; it still silently collapses missing/malformed/foreign artifacts to UNKNOWN with no identity check — a future importer can regress the exact bug 1040 fixed. Delete the export or re-express it via the classified reader. | ACCEPTED | `packages/app/src/services/task-record.ts:141-149`; `packages/app/src/index.ts:687` |
| 3 | P4 (advisory) | correctness | record resolves the verdict artifact from scratch `.spur/run/<wbs>-verdict.json` only, while the done gate prefers the durable evidence plane first; an unforced close via record can therefore cite a different artifact path in `done_reason` than a guarded `task update` close of the same task. Pre-existing read divergence (1040 did not change which file record reads), now materialized in audit metadata. | ACCEPTED | `packages/app/src/services/task-service.ts:1416-1420`; `packages/app/src/services/done-transition-guard.ts:179-199` |
| 4 | P4 (advisory) | correctness | forced close without `--reason` leaves a stale `done_reason` (possibly an earlier "unforced close; PASS artifact …" text) beside a fresh `done_forced: "true"` — mixed audit signal. Faithful preservation of the pre-existing conditional-write behavior; the flag remains the authoritative override signal. | ACCEPTED | `packages/app/src/services/task-transition.ts:175-182` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `readVerdictClassified` + additive `verdictState`/`verdictMessage` (`packages/app/src/services/task-record.ts:151-253`); identical-content Testing/Review skip via trimmed compare (`packages/app/src/services/task-service.ts:1446-1473`); verdict-first CLI line (`apps/cli/src/commands/task.ts:1246-1249`); authored-Testing UNKNOWN gate untouched (`task-service.ts:1435`); tests a/b/f |
| R2 | MET | one `reconcileDoneCloseAudit` policy (`packages/app/src/services/task-transition.ts:170-193`) invoked only after successful done writes on both paths (guarded: `task-transition.ts:281-295`; record auto-walk both shapes: `task-service.ts:1556-1563,1578-1584`); forced retention + unforced clearing + no-op/failed-hop non-reconcile pinned by the transition suite and record tests g/h/i |
| R3 | MET | renders, authored-Review gate, guard order and provenance-link timing untouched (diff edits none of those regions); no new public verb/flag (CLI diff is output-only); server transition response shape unchanged (`apps/server/src/modules/task/handlers.ts:100-107`); `GuardedTransitionResult.result` narrowed `Awaited<ReturnType<TaskService['updateStatus']>>` → `WriteResult` is the same type (updateStatus already returns `WriteResult`) |
| R4 | MET | raw-JSON identity check before schema parse, so omitted-`wbs` fallback survives while explicit foreign/empty `wbs` fails closed (`packages/app/src/services/task-record.ts:221-240`); checkbox flip gated on `state === 'readable'` (`task-service.ts:1487-1497`); foreign → missing + expected/actual/path, zero flips, authored preserved (test c); PARTIAL flips only proven MET boxes via unchanged `flipVerifiedCheckboxes` |

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | test a (missing → state + remedy, stub written), b (malformed → authored preserved), f (identical re-record skips rewrite); targeted suites re-run this review: 129 pass / 0 fail (318 expect calls) |
| AC2 | MET | transition suite: unforced clears stale flag + names PASS artifact, forced retains supplied reason/true flag, same-status no-op writes nothing, audit failure reported via `closeAuditError`; record tests g (stale cleared), h (denied hop writes nothing), i (no-op byte-identical) |
| AC3 | MET | test c: mismatch message names expected/actual WBS + path; no foreign box checked; authored Testing/Review preserved; matching (d) and omitted-WBS (e) keep valid behavior |
| AC4 | MET | targeted suites green on re-run; `bun run spur-check` PASS at the implementation gate (not re-run per stage contract); tsc clean reported in Testing section and consistent with the type-narrowing compile |

##### Drift guard (verified, not edited)

- `git status --short` shows exactly the 7 expected files: `done-transition-guard.ts`, verdict lint/aggregation, `status` JSON mode and `task-pipeline.yaml` are untouched.
- No new public noun/verb/flag: the CLI diff adds output lines only; the server `task.transition` contract is unchanged.
- Unforced `done_reason` is truthful by construction: `evaluateDoneTransition` denies missing/unusable/non-PASS before any status write, so reconcile only ever describes an accepted PASS artifact (`packages/app/src/services/done-transition-guard.ts:316-404`).

##### Residual risk

- Already-done tasks with stale forced metadata (e.g. 1038) are repaired only by a future active done write; same-status no-ops intentionally never reconcile (R2), so reopening (done → wip) and re-closing remains the designed remediation.
- `done_forced: "false"` sentinel accumulates on every newly closed task (`updateField` cannot delete); harmless under the domain schema's string→boolean coercion (`packages/domain/src/planning/schema.ts:314`), mildly noisy in raw YAML.
- P3 #1 leaves a narrow silent-failure window for close-audit writes on the record path only; status correctness is unaffected (audit writes are best-effort by contract).

**Disposition:** approve-with-notes — P3 #1 (record-path audit-failure reporting parity) should be picked up before merge or in an immediate follow-up; P4 #2–#4 are advisory and can ride the next touching commit.


### References

- Session evidence: 1039 gate denial (`[WARN] L4` UNKNOWN stub) and 1038 stale frontmatter — filed from the 2026-10-01 active session review (`--triage`).
- Commits: `1a398cf02`, `68285698a` (1039 pipeline), `87721715f` (1038 remediation whose re-close exposed Problem 2).
- Tasks: 1039 (failure transcript), 1038 (stale-close example, `docs/tasks5/1038_guard-quality-gate-recheck-against-empty-qualitygatecmd-vacu.md:11`).
- Feature: F91 (corpus gate integrity — evidence truth in the task corpus); initially misfiled under F96, re-parented during enrichment.
- Anchors: `packages/app/src/services/task-record.ts:39-74,111-135,238` · `task-transition.ts:24,80,219-229` · `task-service.ts:817-835` · `apps/cli/src/commands/task.ts:460` · `packages/app/src/services/done-transition-guard.ts:29`.

### History

- 2026-10-01T22:02:44.974Z todo → wip (system)
- 2026-10-02T00:10:10.310Z wip → testing (system)
- 2026-10-02T00:10:29.495Z testing → done (system)

