---
template: brainstorm
schema_version: 1
name: "Decide skill ownership for dev-next router"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dev-next"]
dependencies: []
created_at: "2026-07-17T00:54:25.959Z"
updated_at: "2026-07-17T00:56:10.601Z"
---

## 0271. Decide skill ownership for dev-next router

### Background
**Type:** `wayfinder:grilling` · **Feature:** N

**Question:** Where does `/sp:dev-next` **logic** live so it stays a thin command wrapper per `plugins/sp/README.md` ("commands are pass-through routers"), while remaining testable and maintainable?

**Options:**

| Option | Sketch | Pros | Cons |
| --- | --- | --- | --- |
| A. New skill `sp:next-router` (or `sp:dev-next`) | Command → Skill only | Clear owner; isolated tests | Another skill in the catalog |
| B. Extend `sp:spur-dev` + `dev-operations.md` | New operation on spine | Lifecycle knowledge co-located | Spine grows; coupling risk |
| C. Command-only (all logic in `dev-next.md`) | No skill | Fewest files | Violates pass-through design; hard to reuse |

**Locked constraints:**
- Commands remain pass-through routers
- Router **dispatches** existing commands; does not reimplement pipeline
- Non-Claude platforms need a documented manual protocol

**Out of this ticket:** Routing table content (0270), flag names (0272), implementation.
### Requirements
- [ ] R1. Pick A, B, or C (or a hybrid with explicit file list) with written rationale against the README "pass-through routers" principle.
- [ ] R2. Name exact files to add/edit for a later implementation task (command path, skill path, tests path, README row).
- [ ] R3. State how structural tests (`plugins/sp/tests/…`) will assert the new surface exists.
- [ ] R4. State how non-Claude platforms run the same protocol.
- [ ] R5. Record decision in `### Solution` + feature N Decisions so far on done.
### Acceptance Criteria
```gherkin
@core
Scenario: Ownership decision is implementation-ready
  Given 0271 Solution
  When an implementer opens the listed files
  Then they know exactly where routing logic and the thin command live
  And the choice does not violate pass-through command design
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan
1. Re-read README design principle + 2–3 peer command→skill pairs (dogfood, run, unit).
2. Score A/B/C against coupling, testability, catalog size.
3. Recommend default: **A (new skill)** unless spine co-location wins on evidence.
4. Write Solution with file list + test plan pointer.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Peer patterns: `dev-dogfood.md` → `dogfood-testing`; `dev-run.md` → `spur-dev` / `code-implementation`
- Blocks: 0272 (CLI docs need owner names)
- Parallel with: 0270
### History
