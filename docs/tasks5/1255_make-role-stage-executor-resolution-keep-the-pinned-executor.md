---
schema_version: 1
name: Make role-stage executor resolution keep the pinned executor's agent
status: todo
template: issue
created_at: 2026-10-18T19:33:16.740Z
updated_at: "2026-10-18T19:33:35.447Z"

---

## 1255. Make role-stage executor resolution keep the pinned executor's agent

### Background

The D66 batch on 2026-10-18 hit four distinct executor-resolution failures, all in the hop between a stage's declared role and its executor:

- run `379d95ff`: `--agent auto` resolved role `coder` to `agy-gemini`, which is enabled but has no `executionCapabilities`; the 0706 R5 preflight refused dispatch. The config documents `auto` as "role -> tier -> cheapest USABLE executor", so an unattested executor should not be usable.
- run `1ae85188`: the `remediate` action (`role: coder`, `session: reuse`) dispatched `agent=pi` with `model=claude-opus-5-5-medium` (from the pinned `agy-opus-5.5`) — pi exited "Model not found".
- run `db097057`: the same hop dispatched `agent=codex` with `model=volc/deepseek-v4-1-flash-261017` (from the pinned `pi-dsv4.1-flash-volc`) — codex read it as `provider: openai`.
- run `e398b8b9`: `implementAgent=codex-sol` (`model: gpt-6.1-sol`) resolved through pi, which refused the id as ambiguous across seven authenticated providers.

Evidence anchors: `.spur/spur.db` `action_runs` (node/kind/status/result_json) for those run ids, and `.spur/memory/runs/<run>/artifacts/<run>-*-partial.md` `## resolved invocation` blocks. An explicit `--agent X` run works; only role-bearing or `implementAgent`-only stages cross-wire.

### Requirements

- [ ] R1. A role-resolved stage either keeps the pinned executor's agent and model together, or drops both; it never pairs one source's agent with another's model.
- [ ] R2. Executor usability for `agent: auto` and for role tiers includes capability attestation: an executor whose required axes are unattested is skipped, not dispatched and refused.
- [ ] R3. A bare model id that is ambiguous across providers is resolved (qualified) or rejected before dispatch, with the candidates named.
- [ ] R4. A regression test covers each of the four observed pairings (antigravity model + pi, volc model + codex, bare ambiguous gpt id via pi, unattested auto resolution) and asserts either a correct dispatch or a single actionable error.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

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
