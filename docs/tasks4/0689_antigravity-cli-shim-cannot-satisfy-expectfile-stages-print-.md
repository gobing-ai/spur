---
schema_version: 1
name: "antigravity-cli shim cannot satisfy expectFile stages: print mode auto-denies write_file without --dangerously-skip-permissions or a permissions.allow rule"
status: todo
template: issue
created_at: 2026-08-27T15:39:39.946Z
updated_at: "2026-08-27T15:40:34.370Z"
feature_id: B
---

## 0689. antigravity-cli shim cannot satisfy expectFile stages: print mode auto-denies write_file without --dangerously-skip-permissions or a permissions.allow rule

### Background
Found during 0687 verification (2026-08-27). With the sandbox patched and the agy-opus model pin
fixed, `--agent inline` on a headless surface tier-resolves to agy-opus (cheapest capable-1) and
dispatches — but the antigravity-cli shim in `@gobing-ai/ts-ai-runner`
(`packages/ai-runner/src/agents/shims.ts`, `antigravityCliShim.getPromptCommand`) invokes
`agy -p <prompt> --model <model>` with no permission affordance. In print mode agy auto-denies
`write_file` ("a tool required the "write_file" permission that headless mode cannot prompt for"),
so any workflow stage with an `expectFile` contract fails: the agent exits 0, narrates the write,
and the file never lands (run 4f55c237-e808-457d-9cdf-5fb5be128906, resolve-scope).

Repro: `agy -p "Write exactly 'probe-ok' to /tmp/agy-write-probe.txt, then stop." --model claude-opus-4-6-thinking`
→ exit 1, file absent, stderr names both remedies.
### Requirements
**R1 — Choose and implement ONE remedy** so agy dispatches can write files in print mode:
(a) add `--dangerously-skip-permissions` to the shim's print-mode args (broad; matches how other
CLI shims trust the dispatch sandbox), or (b) document a `permissions.allow` write_file rule for
`~/.gemini/antigravity-cli` settings as operator setup (targeted; per-machine). State the choice
and the security tradeoff in the task's Design.

**R2 — Regression evidence:** a workflow stage with `expectFile` driven by an agy executor writes
the file and the stage passes.

**R3 — If (a):** the change lands in ts-libs with a published version bump and Spur's dependency
updated; the shim comment must state the trust assumption. If (b): the note lands in
`sp:dogfood-testing`'s sandbox section next to the 0687 R12 affordances.
### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

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
