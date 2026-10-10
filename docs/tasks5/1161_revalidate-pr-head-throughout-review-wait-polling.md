---
schema_version: 1
name: Revalidate PR head throughout review wait polling
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:52.346Z
updated_at: "2026-10-10T07:31:03.212Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 1161. Revalidate PR head throughout review wait polling

### Background

PR wait captures HEAD once and can return CLEAN for an old commit after another push advances the PR Evidence: `plugins/sp/scripts/pr-reviewing.ts:715`; `plugins/sp/scripts/pr-reviewing.ts:720`; `plugins/sp/scripts/pr-reviewing.ts:734`. Review a71c confirmed this using existing injected runner with two polls, a PR head advance after pending poll one, and old-head clean review on poll two. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

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

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Refresh and validate the expected PR head during polling and immediately before accepting terminal review output, failing on head movement Chosen direction follows the existing local seams. Reject trusting the initial head check or relying only on downstream collect checks. Targets: plugins/sp/scripts/pr-reviewing.ts; generated pr-reviewing.mjs; plugins/sp/tests/pr-reviewing.test.ts. Out of scope: posting comments, pushing branches, changing public wait flags.

### Plan

1. Add a failing regression for AC1 using existing injected runner with two polls, a PR head advance after pending poll one, and old-head clean review on poll two.
2. Implement the chosen direction in plugins/sp/scripts/pr-reviewing.ts; generated pr-reviewing.mjs; plugins/sp/tests/pr-reviewing.test.ts.
3. Run tests/pr-reviewing.test.ts from its workspace and confirm AC1 plus existing happy paths; run the project gate.

Regenerate the installed twin through the supported converter; test head movement before FOUND as well as CLEAN.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`plugins/sp/scripts/pr-reviewing.ts:715`; `plugins/sp/scripts/pr-reviewing.ts:720`; `plugins/sp/scripts/pr-reviewing.ts:734`

### History

- 2026-10-10T07:29:56.494Z backlog → todo (system)

