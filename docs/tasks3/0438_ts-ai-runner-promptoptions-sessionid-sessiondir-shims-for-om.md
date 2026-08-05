---
template: feature-impl
schema_version: 1
name: "ts-ai-runner: PromptOptions sessionId/sessionDir + shims for omp/pi/claude/codex/agy/grok"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P0
tags: ["ts-libs", "ai-runner", "h83", "p0"]
dependencies: []
created_at: "2026-08-05T19:00:59.270Z"
updated_at: "2026-08-05T19:08:25.212Z"
---

## 0438. ts-ai-runner: PromptOptions sessionId/sessionDir + shims for omp/pi/claude/codex/agy/grok

### Background

PromptOptions only has continue?:boolean. Shims map continue to bare -c/--continue/resume --last, which collides with host sessions. omp supports -r and --session-dir; matrix agents need explicit flags. Work in ~/xprojects/ts-libs with bun link into spur-new.

### Requirements
R1. Extend PromptOptions with optional sessionId and sessionDir (names final in design).
R2. omp + pi: --session-dir when set; -r <sessionId> when resume; do not use global -c when sessionId/sessionDir present; avoid --no-session when affinity open is requested.
R3. claude: map resume/session isolation to Claude Code CLI flags (research current CLI; document if only --continue exists).
R4. codex: avoid bare resume --last against global store when sessionDir isolation possible; else no-resume/fresh with documented degrade.
R5. agy (antigravity-cli): --continue vs isolation; prefer isolated dir or fresh when no resume-by-id.
R6. grok: -c vs isolation; same degrade rules.
R7. Export a small capability helper or shim metadata: supportsResumeById, supportsSessionDir per agent.
R8. Unit tests per shim argv matrix; bun link @gobing-ai/ts-ai-runner into spur-new for dogfood.
R9. Do not require npm publish; monorepo uses bun link.
### Acceptance Criteria
```gherkin
@core
Scenario: R4 (cancelled) — Agent matrix shimsp, claude, codex, agy, grok, pi
  Given PromptOptions with sessionId and/or sessionDir
  When getPromptCommand runs for omp, pi, claude, codex, agy, grok
  Then argv never uses unscoped global continue when sessionDir is set
  And omp/pi use -r and --session-dir when provided
  And tests lock the argv contract
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: facade extension in ts-ai-runner AgentShim/PromptOptions.
WHY: spur cannot pin run-scoped sessions without shim support.
WHERE: ~/xprojects/ts-libs/packages/ai-runner (or equivalent path).
LINK: bun link from ts-libs; spur-new bun link @gobing-ai/ts-ai-runner.
### Plan
- [ ] Research each agent CLI resume/session flags
- [ ] Extend PromptOptions + shims + tests
- [ ] bun link into spur-new
- [ ] Smoke argv for six agents
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H83

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-05T19:08:25.212Z todo → cancelled (system)
