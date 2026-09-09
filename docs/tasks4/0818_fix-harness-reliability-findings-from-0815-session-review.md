---
schema_version: 1
name: Fix harness reliability findings from 0815 session review
status: todo
template: issue
created_at: 2026-09-09T20:10:01.996Z
updated_at: "2026-09-09T20:10:40.211Z"

---

## 0818. Fix harness reliability findings from 0815 session review

### Background

Session review of the 0815 pipeline run (8ab8448a) + standalone re-audit surfaced four actionable harness defects. Evidence is fresh from that session. Already resolved elsewhere and EXCLUDED: the run-artifact pointer-file mis-invocation was driver error (corrected in-session); 0817 R1 owns the main-repo CLI-test cwd-hermeticity fix (this task's R2 is the distinct worktree variant); importer_schema drift is environmental with a known remedy (spur migrate per checkout), not a code defect.

1. **omp executor auth failure had no preflight.** wrapup-pipeline doc-sync with agent=omp failed mid-run: `403 This authentication method does not have sufficient permissions to call Inference Providers`. The run died at the step instead of being rerouted before dispatch. Recovery required an operator-visible retry with a tier-resolved executor (pi-dsv4-flash-volc, elected coder per spur agent doctor).
2. **Worktree .spur/config.yaml leaks into CLI tests via cwd discovery** (0815 review advisory). A gitignored worktree-local config is picked up by resolveConfigLayers when tests omit cwd; 0817 R1 fixed the main-repo case only.
3. **Verify-answer status vocabulary reached children only by trial.** The first verify dispatch wrote "PASS" into per-row Status cells; verify-answer-lint (correctly) halted on 12 invalid rows. The driver's dispatch template does not carry the MET/PARTIAL/UNMET vocabulary.
4. **run.artifact accepted a pointer file as taskFile.** Passing .spur/run/0815-taskpath.txt (whose CONTENT is the task path) hashed the pointer and produced a misleading stale-proofDigest refusal; the error named a digest mismatch, not the wrong input file. The engine should reject a taskFile that is not a task corpus file.

### Requirements

**R1 — Executor preflight before workflow agent.run dispatch.** Before a workflow `agent.run` step dispatches, the engine consults the agent-doctor health surface (or an equivalent cached probe) for the resolved executor; an unusable/unauthenticated executor fails fast at run start (or tier-substitutes with a named warning per 0687 R3), never mid-run after earlier steps landed. The omp-403 wrap failure (run 60f855f1) is the reproduction.

**R2 — Worktree config leak closed.** The cwd-discovery fallback in `packages/config/src/loader.ts` (project layer join, :171) must not pick up a gitignored `.spur/config.yaml` from a *worktree* root when a test omits cwd; a regression check fails when it does. Distinct from 0817 R1 (main-repo case); coordinate with that hermeticity machinery.

**R3 — Dispatch template carries the answer-file vocabulary.** The inline driver's verify/review dispatch template (plugins/sp skill references) embeds the exact status vocabularies (Req/AC rows: MET|PARTIAL|UNMET|N/A; top line: Verdict: PASS|PARTIAL|FAIL; evidence types incl. executable-evidence rule for ACs) so a fresh child cannot invent "PASS" row statuses.

**R4 — run.artifact validates taskFile is a task corpus file.** The proof-input read path refuses (with an error naming the offending path and the expected shape) when options.taskFile does not resolve to a task file under the configured tasks folders, instead of hashing whatever it was given.

### Acceptance Criteria

- [ ] AC1 (R1) — a workflow agent.run against a deliberately broken executor fails at run start (or substitutes with warning), never after earlier steps landed; test green
- [ ] AC2 (R2) — a CLI test running inside a worktree with a gitignored .spur/config.yaml does not observe it; regression check green
- [ ] AC3 (R3) — a fresh verify dispatch using the template produces a lint-clean answer file on first attempt (verify-answer-lint exit 0 without a repair pass)
- [ ] AC4 (R4) — run.artifact with taskFile pointing at a non-task file refuses with an error naming the path; test green

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
