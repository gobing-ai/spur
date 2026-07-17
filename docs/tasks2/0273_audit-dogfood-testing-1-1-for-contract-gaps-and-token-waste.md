---
template: brainstorm
schema_version: 1
name: "Audit dogfood-testing@1.1 for contract gaps and token waste"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:dogfood"]
dependencies: []
created_at: "2026-07-17T00:54:28.899Z"
updated_at: "2026-07-17T00:56:16.176Z"
---

## 0273. Audit dogfood-testing@1.1 for contract gaps and token waste

### Background
**Type:** `wayfinder:research` · **Feature:** N

**Question:** What are the concrete **contract-compliance gaps** and **token-waste patterns** in `sp:dogfood-testing@1.1` when used as meta-tooling to refine Spur, with evidence for each finding?

**Success metric (locked):** Contract compliance + token efficiency — not golden suite first, not report cosmetics first.

**Protocol surface to audit:**
- Skill: `plugins/sp/skills/dogfood-testing/SKILL.md` (@1.1)
- Refs: `references/report-template.md`, `references/monitor-ledger.md`
- Command: `plugins/sp/commands/dev-dogfood.md`
- Evidence: `docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md` (~48k tokens, ~26% cache, pipeline-driving testee, provenance friction, doc drift)
- Historical dogfood-born tasks: `0120`, `0122`, `0125`, `0127`, `0128`, `0159`

**Research methods:**
1. Extract every MUST from the protocol
2. Score the 2026-07-16 report against the checklist
3. Extract token/cache rows; identify re-fetch and low-cache steps
4. Note meta-use friction for dogfooding `sp` itself
5. Produce prioritized findings table (P1–P3) with file anchors

**Out of this ticket:** Choosing the v1.2 work package cut line (→ 0274); implementing fixes.
### Requirements
- [ ] R1. Checklist of protocol MUSTs (dual-write, finalize-or-abort, Cost honesty, footer, six sections, pipeline-driving refuse, fix discipline).
- [ ] R2. Evidence table: each gap → severity → evidence (file:line or report section) → suggested fix class (skill prose / structural test / helper script / none).
- [ ] R3. Token waste patterns with estimated impact (re-read skill refs, re-derive steps, large implement steps under dogfood, low cache% on check).
- [ ] R4. Meta-use friction list specific to refining spur (pipeline-driving testees, Skill() vs omp path, command snapshot staleness).
- [ ] R5. Explicit non-findings (what already works well — preserve).
- [ ] R6. Solution is the audit report body (not a vague summary).
### Acceptance Criteria
```gherkin
@core
Scenario: Audit is actionable
  Given 0273 Solution
  When 0274 authors a v1.2 work package from it
  Then every proposed work item maps to at least one evidence-backed finding
  And preserve-list prevents breaking working contract pieces
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan
1. Read SKILL + both references; extract MUST checklist.
2. Score the 2026-07-16 dogfood report against the checklist.
3. Mine prior dogfood-derived tasks for recurring themes.
4. Write findings table + token patterns + preserve-list into Solution.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Protocol: plugins/sp/skills/dogfood-testing/
- Evidence: docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md
- Blocks: 0274
- Parallel with: 0270, 0271
### History
