---
schema_version: 1
name: Revalidate PR head throughout review wait polling
status: done
template: feature-impl
created_at: 2026-10-10T07:29:52.346Z
updated_at: "2026-10-10T19:24:38.906Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1161-verdict.json
---

## 1161. Revalidate PR head throughout review wait polling

### Background

PR wait captures HEAD once and can return CLEAN for an old commit after another push advances the PR Evidence: `plugins/sp/scripts/pr-reviewing.ts:715`; `plugins/sp/scripts/pr-reviewing.ts:720`; `plugins/sp/scripts/pr-reviewing.ts:734`. Review a71c confirmed this using existing injected runner with two polls, a PR head advance after pending poll one, and old-head clean review on poll two. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- cmdWait at pr-reviewing.ts:706 reads pr once, checks requireExpectedHead once, then filters every subsequent poll against the captured pr.headRefOid. Existing --head is already mandatory and mismatch uses FAIL/exit2.
- requireExpectedHead alone is insufficient if a different PR appears on the branch with the same head. Pin the initial PR number as well as the operator's existing head and revalidate before returning FOUND/CLEAN/TIMEOUT.
- The injected command runner already supports deterministic fixture responses; no live GitHub push/comment or new polling seam/flag is needed. A successful final recheck certifies the observed snapshot, not future immutability after return.

### Requirements

- [x] R1. Refresh and validate the expected PR head during polling and immediately before accepting terminal review output, failing on head movement
- [x] R2. Stable-head clean, findings and timeout outcomes retain their documented status and exit codes
- [x] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given a pending review followed by a push advancing the expected PR head
  When the next poll receives a delayed clean review for the old head
  Then wait fails for head movement instead of returning CLEAN

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given a stable PR head with a matching clean review
  When the existing supported operation executes
  Then Stable-head clean, findings and timeout outcomes retain their documented status and exit codes
```
```gherkin
Scenario: AC3 — A push during evidence fetch cannot win the terminal race (req: R1, R3)
  Given a poll starts on the expected head and receives matching old-head findings or a clean review
  When the PR head advances before the terminal recheck
  Then wait writes FAIL and exits 2 without FOUND or CLEAN
  And a missing or switched PR fails through the same existing error channel
```

### Q&A

- Closed: pin the existing --head and initial PR number; re-read before each poll and again after evidence fetch before every return.
- Closed: head movement fails; never rebase the wait identity or post a new request automatically.
- Closed: preserve all existing status/output/exit codes and one fixed deadline. Local scripted runner fixtures are sufficient; no real GitHub mutation is required.

### Design

**Minimal fix / frozen contract.** Change cmdWait in plugins/sp/scripts/pr-reviewing.ts only, reusing viewPr and requireExpectedHead. Capture initial pr.number/url and the required --head once. At the beginning of every poll, refresh viewPr, require the PR still exists with the same number, and call requireExpectedHead with that fresh PR. Fetch reviews/inline/comments against the pinned number and normalize with the expected head. After all evidence fetches, refresh and validate the same PR/head again immediately before any FOUND/CLEAN/TIMEOUT status or output. Never silently retarget the expected head or issue a replacement review request. A missing/malformed PR identity or changed number/head writes FAIL and exits2 through the existing error channel, with a message requesting a fresh review. Network/gh errors remain failures; do not convert them to CLEAN or pending.

**Outputs / bounds.** Preserve FOUND/CLEAN exit0, pending TIMEOUT exit3, invalid budget exit1, existing JSON/human payload and status-file vocabulary. Deadline starts once and is never reset by validation or retries; keep --since filtering, review normalization and existing sleep interval. No new public flags/API/env var or collect/status redesign. Final check cannot prevent a push after the observation; downstream collect's own head guard remains necessary.

**Tests.** Extend plugins/sp/tests/pr-reviewing.test.ts using the current injected runner and fixture PR/review files. One two-poll test returns pending for poll1, advances PR head, then exposes an old-head clean review: expect FAIL/exit2 and no CLEAN emission. Add same-poll movement during fetch before CLEAN, during fetch before FOUND, missing PR, switched PR number and failed gh-view cases. Pin status-file FAIL and error text, plus no comments/push runner commands. Stable head FOUND/CLEAN and timeout retain old shapes/exits. Use --timeout 0 for one-poll timeout and a tiny positive interval or scoped fake wait for two polls, with restoration; no real multi-minute sleep. The tests must fail if either per-poll or final revalidation is removed.

**Generated/prose.** Regenerate pr-reviewing.mjs via superskill script convert sp pr-reviewing.ts --json; source/node-twin parity and script-contract checks apply. Update plugins/sp/skills/pr-reviewing/SKILL.md Current-HEAD invariant to name per-poll and pre-return checks, and its owning PR-review design satellite if it repeats that contract. No user communication to GitHub is authorized by refinement; all fixtures remain local. 1160 touches a different plugin script and 1154 gate composition is independent.

### Plan

1. [ ] R1/R3: add two-poll and same-poll movement cases, including both delayed CLEAN and FOUND, plus missing/switched PR identity.
2. [ ] R1: reuse viewPr/requireExpectedHead for each poll and pre-terminal check; pin number/head, fail with existing FAIL/exit2.
3. [ ] R2/R3: retain stable FOUND/CLEAN, pending timeout, status-file and invalid-budget controls; assert no push/comment calls and mutation sensitivity to either check removal.
4. [ ] Run plugin pr-reviewing suite, regenerate the twin through Superskill, check source/Node parity and update owning Current-HEAD prose.
5. [ ] Run task gate, review/verify/record local evidence and commit.

### Solution

Made `wait` revalidate the pinned PR identity and expected head on every poll and again immediately before any terminal output, so a push during the wait can no longer surface an old-head review as the answer.

Change map (one anchor per row):

| file:line | What changed |
| --- | --- |
| `plugins/sp/scripts/pr-reviewing.ts:712` | `revalidateWaitTarget`: re-reads `viewPr()` and requires the same PR number, then re-runs the existing `requireExpectedHead` against the fresh PR. A vanished PR, a different PR on the branch, or a moved head writes the FAIL status and exits 2 through the existing error channel, naming the failure and asking for a fresh review. |
| `plugins/sp/scripts/pr-reviewing.ts:738` | `cmdWait` pins `number` from the initial view instead of re-reading `pr` per poll — the identity is the PR **number plus** the expected head, so a different PR appearing on the branch is a failure rather than a silent retarget. The deadline is still computed once and is never reset by validation or retries. |
| `plugins/sp/scripts/pr-reviewing.ts:742` | The top of every poll revalidates and fetches evidence against the pinned `number` using the freshly observed `headRefOid`, so a head that moved between polls ends the wait instead of being judged against the head captured at wait start. |
| `plugins/sp/scripts/pr-reviewing.ts:752` | Pre-return recheck on the FOUND path: a finding set is only reported when the identity still holds. |
| `plugins/sp/scripts/pr-reviewing.ts:758` | Pre-return recheck on the CLEAN path, and the emitted payload now names the re-read PR/head — this is the exact defect: a clean review for the previous commit used to be returned as `CLEAN` after a later push. |
| `plugins/sp/scripts/pr-reviewing.ts:768` | Pre-return recheck on the TIMEOUT path: a head that moved while the review was pending is a failure, not a pending verdict. |
| `plugins/sp/tests/pr-reviewing.test.ts:1035` | Five movement cases on the existing file-backed stub plus a stable-head control: head advances between polls; an old-head clean review exposed after the push; head advances during the evidence fetch before FOUND; the PR disappears mid-wait; the PR number switches. Each asserts FAIL/exit 2, the recorded `FAIL` status file, no CLEAN/FOUND emission, and no `pr comment`/`push` call. Mutation-checked both ways (R3): deleting the per-poll revalidation fails three cases, deleting the pre-return revalidation fails two. |
| `plugins/sp/skills/pr-reviewing/SKILL.md:112` | The Current-HEAD invariant now names both revalidation points, the PR-number pin, and the exit-2 failure, instead of only "record the returned HEAD and require … match". |
| `plugins/sp/scripts/pr-reviewing.mjs` | Regenerated twin (`superskill script convert sp pr-reviewing.ts`); `script-contract-check` PASS (23 scripts, 0 violations). The budget baseline entry for this script is unchanged and still required. |

Rationale: `wait` captured the head once and then filtered every subsequent poll against that snapshot, so the function could only ever answer about the commit it started on — the one question it must not answer after a push. Reusing the existing `viewPr`/`requireExpectedHead` pair at both boundaries is the smallest change that makes the original head pin mean what it says: the environment may move, and when it does the wait fails loud rather than reporting a stale verdict. A final check cannot prevent a push *after* it returns, so `collect` keeps its own head guard; this narrows the window rather than claiming to close it.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/pr-reviewing.ts:712` `revalidateWaitTarget` re-reads the PR and re-runs the existing `requireExpectedHead`, writing FAIL and exiting 2 with "request a fresh review" for a vanished PR, a switched number or a moved head; `:738` pins `number`; `:742` revalidates at every poll start; `:752`, `:758`, `:768` revalidate immediately before FOUND, CLEAN and TIMEOUT respectively, and the CLEAN payload names the re-read PR/head. Tests at `plugins/sp/tests/pr-reviewing.test.ts:1035` |
| R2 | MET | Stable-head behavior is asserted by the control case (CLEAN exit 0 with the same JSON shape; TIMEOUT exit 3) and by the untouched pre-existing `wait` tests; invalid budgets still exit 1; the status-file vocabulary (`FAIL`/`FOUND`/`CLEAN`/`TIMEOUT`) and the human/JSON payloads are unchanged |
| R3 | MET | Five movement cases plus the stable-head control; each failure case runs the real script over the file-backed stub and asserts FAIL/exit 2, the recorded status file, absence of `CLEAN`/`FOUND` in stdout, and no `pr comment`/`push` in the recorded call log. Mutation evidence: deleting the per-poll call fails three cases; deleting the pre-return calls fails two |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Reproducing edge case is safe (req: R1, R3) | MET | test | `cd plugins/sp && bun test tests/pr-reviewing.test.ts` — 65 pass / 0 fail; the pending-poll-1 case advances the fixture's `pr.json` head before poll 2 and asserts exit 2, `FAIL` in the status file, and no CLEAN |
| AC2 — Existing behavior remains supported (req: R2, R3) | MET | test | Same suite: the control case asserts CLEAN exit 0 with `{verdict, head, findings: []}` and TIMEOUT exit 3 on a one-poll deadline; the pre-existing FOUND/CLEAN/timeout/budget tests run unmodified |
| AC3 — A push during evidence fetch cannot win the terminal race (req: R1, R3) | MET | test | Same suite: a clean review for the old head written during the second review fetch, and findings written for the old head while the inline-comment fetch advances the head, both end in exit 2 with no CLEAN/FOUND; the PR-disappears and PR-number-switch cases fail through the same channel |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1161
**Scope:** 1161 diff (3 files: `plugins/sp/scripts/pr-reviewing.ts` + its regenerated `.mjs` twin, `plugins/sp/tests/pr-reviewing.test.ts`, `plugins/sp/skills/pr-reviewing/SKILL.md`, plus the task file)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The final recheck narrows but cannot close the race: a push after the terminal recheck returns can still invalidate the emitted CLEAN. The Design records this as a non-goal and keeps `collect`'s own head guard as the second line of defence. | `plugins/sp/scripts/pr-reviewing.ts:758` | ACCEPTED |
| 2 | P4 (advisory) | efficiency | Each poll now issues one extra `gh pr view` (and a terminal path issues two). For a `--timeout 600 --interval 30` wait that is ~21 extra view calls against ~21 review+comment fetches already made; the correctness it buys is worth the round trip. | `plugins/sp/scripts/pr-reviewing.ts:742` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `revalidateWaitTarget` (`plugins/sp/scripts/pr-reviewing.ts:712`) re-reads the PR and re-runs `requireExpectedHead`; `cmdWait` pins the number (`:738`), revalidates at the top of every poll (`:742`), and revalidates immediately before FOUND (`:752`), CLEAN (`:758`) and TIMEOUT (`:768`), all through the existing FAIL/exit-2 channel with a "request a fresh review" message. Pinned by `plugins/sp/tests/pr-reviewing.test.ts:1035` |
| R2 | MET | Stable-head FOUND/CLEAN keep exit 0, pending keeps exit 3, invalid budgets keep exit 1, and the JSON/human payload and status-file vocabulary are unchanged — asserted by the stable-head control and the untouched pre-existing wait tests (65 pass / 0 fail in the suite) |
| R3 | MET | Five movement cases (between polls, delayed old-head clean, during-fetch before FOUND, PR disappeared, PR number switched) plus a stable-head control; every failure case asserts FAIL/exit 2, the recorded status file, no CLEAN/FOUND emission and no `pr comment`/`push` call. Mutation-checked: removing the per-poll revalidation fails 3 cases, removing the pre-return revalidation fails 2 |

##### Acceptance Criteria Verification

AC1 (reproducing edge case is safe), AC2 (existing behavior remains supported) and AC3 (a push during
evidence fetch cannot win the terminal race) are each covered directly, and the third also covers the
missing/switched-PR half through the same error channel.

##### Residual Risk

See finding 1: the race is narrowed, not eliminated — `collect` remains the authority on a result
retrieved later. No security concern: the change only adds failure paths, and it never issues a push
or a comment, which the tests assert. No public flag, env var or API change.

**Next:** proceed to verify.

### References

`plugins/sp/scripts/pr-reviewing.ts:715`; `plugins/sp/scripts/pr-reviewing.ts:720`; `plugins/sp/scripts/pr-reviewing.ts:734`

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 3.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T07:29:56.494Z backlog → todo (system)
- 2026-10-10T19:17:33.450Z todo → wip (system)
- 2026-10-10T19:24:36.512Z wip → testing (system)
- 2026-10-10T19:24:38.898Z testing → done (system)

