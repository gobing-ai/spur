---
schema_version: 1
name: Settle D63 0917 inline-run evidence debt and close the feature
status: todo
template: feature-impl
created_at: 2026-09-23T22:33:55.639Z
updated_at: "2026-09-23T22:43:30.112Z"
feature_id: D63

ac_altitude: task-local
---

## 0935. Settle D63 0917 inline-run evidence debt and close the feature

### Background

Filed by the 2026-09-23 session review (--triage) after D63 round 3 (task 0921) landed on main as 5227e2f39. Excluded as already resolved this session: promotion-gate baseline vocabulary fix (scripts/commands/workflow-promotion.ts:304-330,611-627), D63 feature-check traceability repairs (feature check D63 → 0 findings), composition-contract/economy doc sync, and worktree/branch cleanup. v2 (same day, operator request): widened to carry every open item from the session review — 0917 evidence debt (R1–R2), registration-baseline policy (R3), feature close (R4), origin/main push sync (R5), stale sibling directory removal (R6), and the P4/P3 record-keeping residues from 0921's Review (R7). Deadline-gated work (R1–R2) takes precedence; the sequencing constraints for R5 and R6 live in their requirement lines.

### Requirements

- [ ] R1. Produce at least three real terminal inline history-anatomy runs (attributable DB rows, not estimated) through the 0914 bridge before the frozen 2026-10-06 deadline, and record their measured citations (agent.run actions/run, ms/run) as the post-adoption cohort evidence 0917 lacked.
- [ ] R2. Re-evaluate 0917's INSUFFICIENT_EVIDENCE close against the new cohort and record the inline-run decision: confirm the scope-normalization promotion stands with the smallest bounded experiment named, or propose the one bounded speed candidate with predeclared primary metric, threshold, reliability floor, exclusions, sample requirement, owner and deadline. An observability improvement is not a measured speed improvement.
- [ ] R3. Decide and record the candidate-registration policy follow-up from 0921's Review P3: whether future registrations must pin `delta.baselineAgentRunCount` (registry validator rule or documented convention in workflow-execution-economy.md §5). Do not re-open the resolved history-anatomy-scope-inline candidate.
- [ ] R4. When R1–R2 are recorded, close feature D63 through the wrap process (task done → feature sync/transition plus final owning-doc sync). Do not claim speed gains the evidence does not show.
- [ ] R5. Sync origin/main: after representative gates pass, push the accumulated local commits (83 ahead as of 2026-09-23) so the branch is no longer ahead; obtain explicit operator confirmation immediately before the push (external action).
- [ ] R6. Remove the three stale sibling worktree directories in ~/xprojects — `spur-new-run-0850-5f6382`, `spur-new-runall-g65-ac87`, `spur-new-runall-h13-604b08` — only after verifying none contains unmerged work (no commits absent from main; not registered in `git worktree list`).
- [ ] R7. Carry the 0921 Review record-keeping findings to closure: strengthen the promotion test's degenerate baseline==live assertion to pin exact phrasing (P4), and re-verify workflow-execution-economy.md §5.2 drift-refusal text matches the implemented guard (P3, drift-guard coupling is intentional and stays).

### Acceptance Criteria

- [ ] AC1 — At least three attributable real inline runs exist with measured citations (actions/run, ms/run) recorded as post-adoption cohort evidence, dated on or before 2026-10-06. (req: R1)
- [ ] AC2 — 0917's close carries a recorded decision: INSUFFICIENT_EVIDENCE stands with a named bounded experiment, or one predeclared speed candidate enters evaluation through the existing process. (req: R2)
- [ ] AC3 — Registration-baseline policy decision recorded in the owning design: require pinned `baselineAgentRunCount` for new candidates, or an explicit documented convention. (req: R3)
- [ ] AC4 — Feature D63 transitioned per the wrap process with owning docs synced, or a dated deferral recorded. (req: R4)
- [ ] AC5 — origin/main contains every local commit: `git status` on main clean and ahead-count 0 after push. (req: R5)
- [ ] AC6 — The three stale directories are gone from ~/xprojects with a recorded unmerged-work check showing zero missing commits. (req: R6)
- [ ] AC7 — workflow-promotion.test.ts pins exact phrasing for both baseline==live and baseline<live outcomes; promotion suite green. (req: R7)
- [ ] AC8 — §5.2 drift-refusal documentation verified against implementation behavior and corrected if drifted. (req: R7)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- docs/tasks5/0917_* — frozen 2026-10-06 decision date, ≥3 real terminal inline runs target, INSUFFICIENT_EVIDENCE close (:23-40).
- scripts/commands/workflow-promotion.ts:304-330 (baseline rule), :611-627 (drift guard); scripts/commands/workflow-promotion.test.ts (degenerate baseline==live case).
- docs/design/workflow-execution-economy.md §5.1-5.2 (baseline semantics + drift-refusal contract).
- docs/tasks5/0921_complete-measured-workflow-migration-and-catalogue-reconcili.md — Review table P3/P4 records; Solution §R3/R4.
- config/workflow-candidates.json — resolved candidate history-anatomy-scope-inline; retirements[] for planning-pipeline; do not re-open either.
- plugins/sp/skills/spur-dev references — inline-run bridge (0914) execution context.

### History

- 2026-09-23T22:40:27.217Z backlog → todo (system)

