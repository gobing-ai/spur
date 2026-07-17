---
template: brainstorm
schema_version: 1
name: "Lock dogfood hardening v1.2 work package from audit"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dogfood"]
dependencies: ["0273"]
created_at: "2026-07-17T00:54:30.293Z"
updated_at: "2026-07-17T00:56:19.284Z"
---

## 0274. Lock dogfood hardening v1.2 work package from audit

### Background
**Type:** `wayfinder:grilling` · **Feature:** N

**Question:** Given the 0273 audit, what is the **first shippable dogfood hardening package** (protocol bump target, concrete file changes, acceptance checks, and explicit deferrals)?

**Locked goal:** Contract compliance + token efficiency. Golden suite, dashboards, smarter auto-fix IQ are **not** the primary slice unless the audit proves they are prerequisites.

**Expected output shape** (graduate into 1–3 implementation tasks without further grilling):
- Protocol version target (e.g. `@1.2`)
- Must-fix list vs nice-to-have
- Structural tests under `plugins/sp/tests/`
- Token-conservation rule changes (skill prose and/or ledger)
- Success metrics (dual-artifact always; cache% trend; finalize-or-abort checklist)
- Deferred items → feature N fog or Out of scope

**Depends on:** 0273 audit Solution.
### Requirements
- [ ] R1. Ordered implementation backlog (3–8 items) each with: owner file(s), effort band (S/M/L), maps-to audit finding ID.
- [ ] R2. Protocol version decision + changelog bullets for dogfood-testing.
- [ ] R3. Structural/regression tests named (even if not written yet).
- [ ] R4. Explicit deferrals with reason (golden suite, Cost meter integration, auto-fix IQ, …).
- [ ] R5. Definition of done for the package (how we know hardening shipped).
- [ ] R6. Graduate fog: any newly sharp implementation questions become follow-up task titles in Plan (do not create them in this session unless operator asks — wayfinder: one ticket per session when *resolving*; charting already created tickets).
### Acceptance Criteria
```gherkin
@core
Scenario: Work package is implementation-ready
  Given 0274 Solution
  When /sp:dev-plan or batch-create is run from the package
  Then each implementation task has clear R-items and file targets
  And deferred items are not smuggled into v1.2 scope
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan
1. Read 0273 Solution findings ranked by severity × effort.
2. Cut v1.2 package at compliance + token first.
3. Write backlog + DoD + deferrals into Solution.
4. Update feature N Decisions so far + graduate fog bullets as needed.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Dependency: 0273
- Downstream: implementation tasks for dogfood-testing / dev-dogfood
### History
