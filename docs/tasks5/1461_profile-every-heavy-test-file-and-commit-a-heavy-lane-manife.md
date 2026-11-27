---
schema_version: 1
name: Profile every heavy test file and commit a heavy lane manifest with a drift guard
status: todo
template: feature-impl
created_at: 2026-11-27T07:07:41.707Z
updated_at: "2026-11-27T07:08:38.073Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

dependencies: ["1459"]
---

## 1461. Profile every heavy test file and commit a heavy lane manifest with a drift guard

### Background

Feature H162 (design docs/design/heavy-suite-lanes.md §3.1, §3.3-3.4). test:heavy (package.json:86) runs ~196-277s per feature-verify pass as two serial run-tests calls. A sandboxed per-file pass on 2026-11-26 showed each Board-building browser file spending ~15s before Chromium launch (Chromium cannot launch in the agent sandbox), so browser timings must come from an unsandboxed host run. Extends the config/test-lanes.json manifest that H161 task 1459 introduces. Covers R1, R2.

### Requirements

- [ ] R1. A profiling run executes every `.heavy.test.` file on its own under bunfig.heavy.toml, then the unchanged `bun run test:heavy` once, and writes .spur/run/heavy-profile.json with per-file wall time, test count, pass/fail/skip, and Board-build time (from buildBoardToTemp timing), plus the end-to-end baseline and host core count. It must run on a host where Chromium launches; a sandboxed run is labelled as such and is not the baseline.
- [ ] R2. config/test-lanes.json gains a `heavy` section: every `.heavy.test.` file, repo-relative and sorted, with `lane: concurrent|serial` and `shares` (browser, board-build, ports, gate-lock, sqlite, cli-spawn, timing-sensitive). fleet-e2e-batch-perf and quality-gate-lock are serial; files asserting wall-time ratios or interval overlap are serial.
- [ ] R3. A repo-wide test fails, naming the file, when a `.heavy.test.` file is missing from the heavy section or the section names a missing file.

### Acceptance Criteria

- [ ] R1 — A per-file heavy profile and end-to-end baseline are recorded as a receipt
- [ ] R2 — Every heavy file is classified concurrent-safe or serial in a committed manifest guarded against drift

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: extend the H161 manifest with a heavy section (one lane SSOT, one drift-guard pattern) and record the profile as a gitignored receipt cited from task evidence. Rejected: a second manifest file (two lane SSOTs) and tag comments in test files. Invariants: classification is static and reviewable; any doubt classifies serial; the profile never edits tests. Execution budget: one unsandboxed full profile (~5 min); persist the receipt before classifying.

### Plan

1. Write the classification failure modes first (a file that sets timing assertions, a file that shares a fixed port, a new heavy file added without a manifest row).
2. Add the profiling mode and run it unsandboxed; persist .spur/run/heavy-profile.json.
3. Classify each file into the heavy section.
4. Add the repo-wide drift test.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
