---
template: review
schema_version: 1
name: "Verify-fidelity and dogfood findings from 0282 re-audit"
description: ""
status: backlog
type: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-07-19T07:12:34.189Z"
updated_at: "2026-07-19T07:13:16.940Z"
---

## 0299. Verify-fidelity and dogfood findings from 0282 re-audit

### Background
#### Review Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P2 | `plugins/sp/skills/code-verification/SKILL.md:60` | Verify fidelity: a verify run can mark objective rows MET from file-level citations whose line anchors resolve to other tickets' content (0282 was certified `done` citing `evidence:134`, which is 0281 telemetry text). | Add a line-anchor verification rule to Step 4/5: every `file:line` citation in the Testing table must be re-read at the cited lines and confirmed to name the requirement's subject (not merely exist) before a MET row is written. |
| P2 | `plugins/sp/skills/code-verification/SKILL.md` (Step 13) | `--force --next` on an already-terminal (`done`) task can never fire the transition, but the R9 note lives only in `dev-verify.md:124`; the verify report line doesn't state the no-op. | Surface the no-transition outcome in the verify skill's Step 13 report line (e.g. `--next: no-op — task already terminal`) rather than relying on the CLI print alone. |
| P3 | `plugins/sp/skills/code-verification/SKILL.md` (Step 12) | Fix-pass writes to `.spur/run/**` artifacts are gitignored, so a `--fix all` verify pass can mutate deliverables invisibly to `git status` and to drift guards. | Document in Step 12 that fix-pass writes under `.spur/run/` are invisible to git; require the Testing write-back to name the exact artifact+lines touched so the mutation is discoverable from the tracked task file. |
| P3 | dogfood run 20260718T235651 | Aggregate cache% 46% (<50% floor), step 1 at 27% (<40%): dogfood Phase-1 loads ~35k chars of scaffolding (SKILL.md + report-template + monitor-ledger + command doc) fresh each run. | Candidate for prompt trimming / cache-stable ordering of dogfood Phase-1 loads. Trend-only; no per-step telemetry exists to bill against. |

Source: `docs/dogfood/2026-07-18-sp-dev-verify-0282-auto-next-force-focus-all-fix-all-dogfood.md` (run `20260718T235651-dev-verify-0282`, verdict PARTIAL, validator `ok`).
### Requirements

<!-- R-numbered fix requirements derived from the findings. Fill after triage/refinement. -->

### Acceptance Criteria

<!-- Checks that prove the findings were addressed. Keep empty until the review task becomes executable work. -->

### Q&A

<!-- Clarifications, false positives, accepted risk, and triage decisions. -->

### Design

<!-- Fix approach and tradeoffs if the findings require design judgment. -->

### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       |      |         |                |
| P2       |      |         |                |

### References

<!-- Links to source review, dogfood report, PR/diff, related tasks, or external references. -->

### History
