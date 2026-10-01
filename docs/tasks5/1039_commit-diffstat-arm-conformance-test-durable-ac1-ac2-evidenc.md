---
schema_version: 1
name: Commit diffstat-arm conformance test (durable AC1/AC2 evidence for 1033)
status: done
template: issue
created_at: 2026-10-01T16:20:50.852Z
updated_at: "2026-10-01T18:56:12.645Z"

feature_id: D9
---

## 1039. Commit diffstat-arm conformance test (durable AC1/AC2 evidence for 1033)

### Background

**Durable-evidence follow-up to task 1033's R1 (diff-sized verify floor), filed when the original executable evidence was destroyed.** 1033's AC1/AC2 were verified with a jq conformance check over four fixtures (`/tmp/1033-e2e/{small,sensitive,large}.json`), output appended to `.spur/run/1033-e2e-evidence.log` inside the batch worktree. At batch closeout the worktree was removed and gitignored run directories with it — the executable evidence now survives only as prose quoted in `docs/tasks5/1033_pipeline-execution-efficiency-proportional-gate-diff-sized-f.md`. This is the same durability gap F93 ("Durable verification evidence: the completion gate reads the tracked task record, not a gitignored artifact") closed for verify receipts — precedent for the approach, not the owner surface.

**The contract being pinned (1033 R1, condition 5 of the verify-only dispatch arm):** the verify stage's diffstat arm decides host-inline vs. subagent dispatch from

```
files <= 3 && insertions + deletions <= 60 && sensitive == false   →  host-inline
otherwise                                                           →  unchanged floor
```

"Unchanged floor" means verify keeps whatever isolation it already has (subagent dispatch) — **more isolation, never less**. The host log line on the inline path is exact and must not drift:

```
stage verify executed inline in session <sid> (below dispatch floor: diffstat files <f> lines <n>)
```

**Surface:** test-only addition to `plugins/sp/tests/task-diffstat.test.ts` (the producer suite from 0943; producer `plugins/sp/scripts/task-diffstat.ts`). The consumer of this decision is host prose in the inline pipeline driver (see `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` around line 317) — there is no shared function to call, so the test mirrors the documented decision table and cites that anchor in a comment.

**Fixture classes to cover (from the 1033 evidence run):** small (e.g. `{files:2, insertions:30, deletions:10, sensitive:false}` → inline), sensitive (small but `sensitive:true` → floor), large (under 3 files but `insertions + deletions > 60` → floor), and missing/null diffstat fields (→ floor, defensive default). Assert the exact log template on the inline path.

**In scope:** the conformance describe block per the table above; one mutation check (temporarily break a threshold, confirm the test fails, revert) to prove it bites; quoting the test run in the task.

**Out of scope (anti-drift):** no production code changes — not `task-diffstat.ts`, not `wrapup-steps.ts`, not the driver reference, not workflow YAML; no extracting a shared decision helper (the consumer is prose; a mirror test with a source comment is the point); no new fixtures framework; don't restate the thresholds anywhere except the test and its cited anchor.

**Adjacent coverage (2026-10-01, commit fd2ab09f5)**

A doc-text parity pin landed in `plugins/sp/tests/command-flag-parity.test.ts`: it asserts the driver prose contains the arm thresholds and log-template text (fails-when wording, `<= 60`, `.sensitive == false`, `below dispatch floor:`). That pins the contract description, not implementation behavior. This task's ACs (behavioral decision-table fixtures in `plugins/sp/tests/task-diffstat.test.ts`) remain the outstanding work; implement them without duplicating the prose-parity assertions.

### Requirements

- [x] R1. Conformance test in `plugins/sp/tests/task-diffstat.test.ts` mirroring the condition-5 diffstat-arm decision table from `inline-pipeline-driver.md`: `files <= 3 && insertions + deletions <= 60 && sensitive == false` → host-inline; otherwise → unchanged floor.
- [x] R2. Four fixture classes covered: small (→ inline), sensitive (→ floor), large (→ floor), and missing/null diffstat fields (→ floor, defensive).
- [x] R3. Exact host log template pinned: `stage verify executed inline in session <sid> (below dispatch floor: diffstat files <f> lines <n>)`.

### Acceptance Criteria

- AC1: `cd plugins/sp && bun test tests/task-diffstat.test.ts` passes with the new cases and fails if any threshold or log wording is mutated — quote the run in the task.
- AC2: No production code changes; test-only diff.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [x] Add conformance describe block per R1-R3.
- [x] Mutation-check one threshold to confirm the test bites (then revert).
- [x] `bun run spur-check` on the change; commit.

### Root Cause

Original executable evidence disappeared with a removed worktree. The committed fixture suite restored durable evidence, but its single-file fixtures did not constrain the 3-file threshold, and it pinned a rendered mirror without the full source log template. A fresh mutation to allow 4 files passed the original suite. Real 3/4-file fixtures plus full predicate/log source assertions now detect the drift; all mutation checks fail as expected and the restored suite passes.

### Solution

Test-only conformance suite (AC2: no production changes) pinning the 1033 R1 verify dispatch-floor contract against real `runDiffstat` outputs from temp git repos.

**Change map — plugins/sp/tests/task-diffstat.test.ts**

- `belowDiffstatFloor` (plugins/sp/tests/task-diffstat.test.ts:195) — transcript of the driver-doc condition (inline-pipeline-driver.md condition-5 diffstat arm): `files <= 3 && ins+del <= 60 && !sensitive`. Hand-transcribed by design; the doc text itself stays pinned by command-flag-parity (fd2ab09f5) — no duplication.
- `belowFloorFromArtifact` (plugins/sp/tests/task-diffstat.test.ts:209) — mirrors the driver's jq read of `.spur/run/<wbs>-diffstat.json` including the defensive path: missing, unparsable, or shape-broken rows keep the floor (more isolation, never less).
- `floorLogLine` (plugins/sp/tests/task-diffstat.test.ts:231) — exact below-floor run-log template, pinned with `toBe` so wording drift fails the suite.
- New describe block (plugins/sp/tests/task-diffstat.test.ts:242), 5 tests: small-clean→inline with exact log line; 60/61 threshold boundary; sensitive→floor even when tiny; large-clean→floor even at 1 file; missing/unparsable/null-field artifact→floor.
- Imports: added `readFileSync` and `type Diffstat` (biome-organized).

**Deliberate non-change:** no producer or driver-code edits — the decision is a documented driver behavior; this suite makes that contract executable without AC2 violations.

Final re-verification adds a real-producer 3/4-file boundary at `plugins/sp/tests/task-diffstat.test.ts:267`, pins the full documented predicate and exact log in the existing small-diff test at `:243`, and covers every missing/null count in the defensive artifact test. Before this fix a 3-to-4 threshold mutation still passed; afterwards file/line-threshold and documented-log mutations each fail, and restoration passes. Task 1039 remains test-only; the adjacent numeric-count driver-contract correction belongs to 1033.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/tests/task-diffstat.test.ts:195` mirrors the documented decision; `plugins/sp/tests/task-diffstat.test.ts:243` pins its complete predicate and log; real producer fixtures cover both size boundaries. Fresh dispatch suites: 121 pass, 0 fail, exit 0. |
| R2 | MET | `plugins/sp/tests/task-diffstat.test.ts:242` drives small, sensitive, large, missing/unparsable and missing/null-count fixtures with the real producer. Fresh dispatch suites: exit 0; literal documented jq probe: 11/11 expected results. |
| R3 | MET | `plugins/sp/tests/task-diffstat.test.ts:251` pins the exact rendered log; `plugins/sp/tests/task-diffstat.test.ts:258` also pins its complete documented template. File threshold 3-to-4, line threshold 60-to-59, and documented log wording mutations each cause exit 1, restored suite exit 0 (origin: D9 final verification, `.spur/run/D9-finalverify/mutation-after.json`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/task-diffstat.test.ts:251` pins the exact rendered log; `plugins/sp/tests/task-diffstat.test.ts:258` also pins its complete documented template. File threshold 3-to-4, line threshold 60-to-59, and documented log wording mutations each cause exit 1, restored suite exit 0 (origin: D9 final verification, `.spur/run/D9-finalverify/mutation-after.json`). Files and lines mutations fail boundary assertions; log mutation fails the source-template assertion. |
| AC2 | MET | command | Task 1039 changes only `plugins/sp/tests/task-diffstat.test.ts:243`; producer code and workflow graph are untouched. The adjacent invalid-count driver-contract repair is owned and documented by task 1033. Fresh git scope assertion exit 0: original 1039 commit has exactly one non-corpus path, the test file; producer and task-pipeline have zero changes since 87721715f. Origin: D9 final verification, `.spur/run/D9-finalverify/1039-scope-audit.json`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Final inline review

Scope: tagged task implementation plus the final D9 fixes. Dimensions: functional, security, efficiency, correctness, usability, architecture. Fresh focused commands pass (65 application tests, 151 plugin tests, 121 dispatch tests).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | functional | `plugins/sp/tests/task-diffstat.test.ts:195` mirrors the documented decision; `plugins/sp/tests/task-diffstat.test.ts:243` pins its complete predicate and log; real producer fixtures cover both size boundaries. Fresh dispatch suites: 121 pass, 0 fail, exit 0. | All numbered requirements trace to fresh executable evidence; no open completeness finding. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/tests/task-diffstat.test.ts:195` mirrors the documented decision; `plugins/sp/tests/task-diffstat.test.ts:243` pins its complete predicate and log; real producer fixtures cover both size boundaries. Fresh dispatch suites: 121 pass, 0 fail, exit 0. |
| R2 | MET | `plugins/sp/tests/task-diffstat.test.ts:242` drives small, sensitive, large, missing/unparsable and missing/null-count fixtures with the real producer. Fresh dispatch suites: exit 0; literal documented jq probe: 11/11 expected results. |
| R3 | MET | `plugins/sp/tests/task-diffstat.test.ts:251` pins the exact rendered log; `plugins/sp/tests/task-diffstat.test.ts:258` also pins its complete documented template. File threshold 3-to-4, line threshold 60-to-59, and documented log wording mutations each cause exit 1, restored suite exit 0 (origin: D9 final verification, `.spur/run/D9-finalverify/mutation-after.json`). |

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | security, efficiency, correctness, usability | `plugins/sp/tests/task-diffstat.test.ts:195` mirrors the documented decision; `plugins/sp/tests/task-diffstat.test.ts:243` pins its complete predicate and log; real producer fixtures cover both size boundaries. Fresh dispatch suites: 121 pass, 0 fail, exit 0. | No open P1-P3 finding: fail-closed parsing, bounded work, diagnostic clarity and regression behavior reviewed. |

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | architecture | `plugins/sp/tests/task-diffstat.test.ts:195` mirrors the documented decision; `plugins/sp/tests/task-diffstat.test.ts:243` pins its complete predicate and log; real producer fixtures cover both size boundaries. Fresh dispatch suites: 121 pass, 0 fail, exit 0. | Shared service and existing script boundaries remain intact; standalone generated twins and real-fixture test seams need no structural change. |

#### Retained review and resolved follow-ups

**Evidence**

- Diffstat: one test file, test-only (AC2 holds by inspection; `git diff --stat` names no production path).
- The suite drives the real producer (`runDiffstat`) over temp git repos. Fixture arithmetic is validated against actual counts — the suite itself caught a first-pass off-by-one (rewrite diffs count +N−1: ins+del totals, not written-line counts), which is the point of behavioral fixtures.
- Mutation check: threshold 60→59 in the transcribed condition → exactly the boundary test fails (13 pass, 1 fail); reverted → green. The suite bites.
- Layering: doc-text parity stays owned by command-flag-parity.test.ts (fd2ab09f5); this suite owns decision semantics. The Background don't-duplicate guard is honored.

| Priority | Finding | Resolution |
|----------|---------|------------|
| P3 | The transcribed condition and log template are in-test mirrors: doc-text drift alone cannot fail this suite; catching drift requires both pins (doc-parity + semantics) to survive together. | Resolved in final re-verification: the suite now pins the full documented predicate and log template directly, and adds the 3/4-file boundary. All three fresh mutations fail as expected; production code stays unchanged. |
| P4 | Boundary fixtures depend on rewrite-of-1-line-base arithmetic (+N−1); future fixture edits may miscount as the first pass did. | Mitigated inline with comments naming the totals (59 written → exactly 60 changed; 60 written → 61). |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-01T16:59:44.007Z todo → wip (system)
- 2026-10-01T17:12:48.140Z wip → testing (system)
- 2026-10-01T17:12:57.307Z testing → done (system)

