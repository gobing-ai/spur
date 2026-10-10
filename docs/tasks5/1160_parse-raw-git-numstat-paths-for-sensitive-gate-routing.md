---
schema_version: 1
name: Parse raw Git numstat paths for sensitive gate routing
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:47.892Z
updated_at: "2026-10-10T07:29:52.004Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
---

## 1160. Parse raw Git numstat paths for sensitive gate routing

### Background

Git C-quoted non-ASCII hook paths are classified literally and bypass sensitive path routing under default core.quotepath Evidence: `plugins/sp/scripts/task-diffstat.ts:193`; `plugins/sp/scripts/task-diffstat.ts:202`; `plugins/sp/scripts/task-diffstat.ts:216`. Review a71c confirmed this using temporary real Git repository with core.quotepath=true and tracked plugins/sp/hooks/保護.ts; result sensitive:false. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Consume git diff --numstat -z and parse its NUL filename and rename records while preserving raw paths for classification
- [ ] R2. ASCII, binary and ordinary rename counts remain correct and every sensitive old or new path selects the safety lane
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given non-ASCII hook and SQL paths and a rename into a sensitive directory in a real Git fixture
  When runDiffstat classifies the changes
  Then the raw paths are retained and sensitive is true

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given existing ASCII, binary and rename fixtures
  When the existing supported operation executes
  Then ASCII, binary and ordinary rename counts remain correct and every sensitive old or new path selects the safety lane
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Consume git diff --numstat -z and parse its NUL filename and rename records while preserving raw paths for classification Chosen direction follows the existing local seams. Reject disabling quotepath alone because tabs and newlines still need a lossless record format. Targets: plugins/sp/scripts/task-diffstat.ts; plugins/sp/scripts/task-diffstat.mjs (generated); plugins/sp/tests/task-diffstat.test.ts. Out of scope: threshold changes or gate policy relaxation.

### Plan

1. Add a failing regression for AC1 using temporary real Git repository with core.quotepath=true and tracked plugins/sp/hooks/保護.ts; result sensitive:false.
2. Implement the chosen direction in plugins/sp/scripts/task-diffstat.ts; plugins/sp/scripts/task-diffstat.mjs (generated); plugins/sp/tests/task-diffstat.test.ts.
3. Run tests/task-diffstat.test.ts from its workspace and confirm AC1 plus existing happy paths; run the project gate.

Regenerate the installed twin via the supported Superskill script converter and test source/installed parity.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`plugins/sp/scripts/task-diffstat.ts:193`; `plugins/sp/scripts/task-diffstat.ts:202`; `plugins/sp/scripts/task-diffstat.ts:216`

### History

- 2026-10-10T07:29:52.004Z backlog → todo (system)

