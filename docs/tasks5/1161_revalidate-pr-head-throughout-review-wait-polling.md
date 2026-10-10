---
schema_version: 1
name: Revalidate PR head throughout review wait polling
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:52.346Z
updated_at: "2026-10-10T16:31:45.086Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 1161. Revalidate PR head throughout review wait polling

### Background

PR wait captures HEAD once and can return CLEAN for an old commit after another push advances the PR Evidence: `plugins/sp/scripts/pr-reviewing.ts:715`; `plugins/sp/scripts/pr-reviewing.ts:720`; `plugins/sp/scripts/pr-reviewing.ts:734`. Review a71c confirmed this using existing injected runner with two polls, a PR head advance after pending poll one, and old-head clean review on poll two. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- cmdWait at pr-reviewing.ts:706 reads pr once, checks requireExpectedHead once, then filters every subsequent poll against the captured pr.headRefOid. Existing --head is already mandatory and mismatch uses FAIL/exit2.
- requireExpectedHead alone is insufficient if a different PR appears on the branch with the same head. Pin the initial PR number as well as the operator's existing head and revalidate before returning FOUND/CLEAN/TIMEOUT.
- The injected command runner already supports deterministic fixture responses; no live GitHub push/comment or new polling seam/flag is needed. A successful final recheck certifies the observed snapshot, not future immutability after return.

### Requirements

- [ ] R1. Refresh and validate the expected PR head during polling and immediately before accepting terminal review output, failing on head movement
- [ ] R2. Stable-head clean, findings and timeout outcomes retain their documented status and exit codes
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

