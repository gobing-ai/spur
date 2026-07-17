---
template: brainstorm
schema_version: 1
name: "Specify /sp:dev-next CLI surface, flags, and stop conditions"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dev-next"]
dependencies: ["0270", "0271"]
created_at: "2026-07-17T00:54:27.284Z"
updated_at: "2026-07-17T00:56:13.363Z"
---

## 0272. Specify /sp:dev-next CLI surface, flags, and stop conditions

### Background
**Type:** `wayfinder:grilling` · **Feature:** N

**Question:** What is the operator-facing contract for `/sp:dev-next` — argument-hint, flags, defaults, stop messaging, and README one-liner — ready to paste into `plugins/sp/commands/dev-next.md`?

**Locked defaults (discovery):**
- Positional: task WBS preferred; feature ID optional rollup
- Default: execute recommended dispatch; chain on clean success; stop on gates/ambiguity
- Must support: `--dry-run`, `--once`
- Must not confuse operators with the existing `--next` **flag** on refine/run/verify (different noun: this is a **command** named `dev-next`)

**Naming collision:** Document both clearly so agents do not confuse "run next chain link" with "status router entry".

**Depends on:** 0270 (routing table), 0271 (ownership / Implementation Skill line).
### Requirements
- [ ] R1. Full `argument-hint` string and Arguments table (every flag, default, semantics).
- [ ] R2. Deterministic resolution order: parse args → resolve target task → collect signals → table lookup → dry-run print OR dispatch → chain/stop.
- [ ] R3. Exact operator-facing messages for: no target, ambiguous multi-candidate, guard stop, dry-run plan, successful chain handoff.
- [ ] R4. Interaction with `--auto` (if any): does next forward `--auto` into dispatched commands? Recommendation: yes when chaining into refine/run/verify.
- [ ] R5. Interaction with `--agent`: pipeline vs inline rules per cross-cutting.md (document which applies to dispatched children).
- [ ] R6. README command-index one-liner draft.
- [ ] R7. Out-of-scope for v1 flags listed explicitly.
- [ ] R8. Solution is paste-ready command skeleton sections (When to use / Arguments / Behavior / Implementation / See Also).
### Acceptance Criteria
```gherkin
@core
Scenario: Command doc skeleton is complete
  Given 0272 Solution
  When copied into plugins/sp/commands/dev-next.md with skill wiring filled
  Then argument-hint, flags, stop messages, and Implementation Skill() line are all present
  And naming collision with --next flag is documented
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan
1. Wait until 0270 + 0271 Solutions exist (or work from drafts if both claimed sequentially).
2. Author command markdown skeleton in Solution.
3. Align flag names with existing /sp:dev-* conventions (--auto, --agent, --dry-run).
4. Note any need for a future `spur task next-hint --json` helper as fog/follow-up, not v1 requirement unless ownership demands it.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Dependencies: 0270, 0271
- Downstream: implementation task(s) graduated after this resolves
### History
