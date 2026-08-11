---
template: issue
schema_version: 1
name: "Prototype the idea-evaluation report template (urgency/necessity/premises/pros-cons)"
description: ""
status: done
type: issue
profile: standard
feature_id: I11
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-07-28T03:21:53.100Z"
updated_at: "2026-08-11T21:18:35.361Z"
done_forced: "true"
done_reason: "Prototype-only task: template + filled example + home recommendation written to Solution; no code changes to verify"
---

## 0361. Prototype the idea-evaluation report template (urgency/necessity/premises/pros-cons)

### Background
Wayfinder ticket for map **I1**. Type: **prototype** (`wayfinder:prototype`).

Draft the operator-facing idea-evaluation report template that discovery feeds and the taste gate presents for approve/reject. Must cover urgency (0–5), necessity (0–5), premises, pros/cons, alternatives, and an enhanced-idea statement suitable as the “real requirement” preview.
### Requirements
R1. Produce a markdown template (filled example OK) with sections: enhanced idea statement, urgency 0–5, necessity 0–5, premises, pros, cons, better alternatives (if any), recommendation (proceed / reshape / drop), approve|reject prompt.

R2. Align presentation with decision-brief norms where applicable (recommendation mandatory; stakes plain English) without inventing a second HITL SSOT.

R3. Propose where the template lives long-term (e.g. `plugins/sp/skills/spur-dev/references/idea-evaluation.md` vs brainstorm reference) — recommendation only; final ownership may be locked in 0362.

R4. Do not wire the pipeline. Prototype artifact only (in Solution or linked path under docs if needed).

R5. On close, gist to map I1 **Decisions so far**.
### Acceptance Criteria
```gherkin
Feature: Idea-evaluation report template prototype

  Scenario: Template covers required dimensions
    Given the operator-requested eval dimensions
    When prototype ticket 0361 is resolved
    Then Solution includes a template with urgency 0–5, necessity 0–5, premises, pros, cons, alternatives, enhanced idea, and approve/reject

  Scenario: Filled example exists
    Given a sample vague idea
    When the prototype is recorded
    Then Solution includes one filled example showing how scores and prose read

  Scenario: Home path recommended
    Given spur-dev and brainstorm reference trees
    When the ticket closes
    Then Solution recommends a long-term file home without implementing the pipeline wire-up
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Idea-evaluation report template prototype**

**1. Template**

The idea-evaluation report follows decision-brief norms (see `plugins/sp/skills/spur-dev/references/decision-brief.md:10`): recommendation is mandatory, stakes in plain English, and the approve/reject prompt is the terminal choice. It is rendered inline by the pipeline agent — not via `AskUserQuestion` — because the evaluation is authored prose, not a multiple-choice selection.

```markdown
# Idea Evaluation Report

## Enhanced Idea
<one-paragraph refined statement of what the idea actually requires — the "real requirement" after discovery sharpens the vague input>

## Scores

| Dimension | Score (0–5) | Rationale |
|-----------|-------------|-----------|
| **Urgency** — how soon must this ship? | <0–5> | <one sentence: what breaks or degrades without it; 0 = no time pressure, 5 = blocking users/pipeline now> |
| **Necessity** — does the product need this at all? | <0–5> | <one sentence: what gap this fills vs workaround quality; 0 = nice-to-have with easy workaround, 5 = core functionality missing> |

Score guide:
- 0 = no signal / not applicable
- 1 = minimal — workaround is fine for the foreseeable future
- 2 = low — improves quality of life, not blocking
- 3 = moderate — noticeable gap; workaround exists but costs effort
- 4 = high — significant pain point; workaround is fragile or expensive
- 5 = critical — blocking users, pipeline, or a committed deliverable

## Premises
<bulleted list of assumptions the idea rests on — things that must be true for the idea to deliver value; if any premise is false, the idea collapses or must be reshaped>

## Pros
<bulleted list of concrete benefits — what ships, what improves, what risk is reduced>

## Cons
<bulleted list of costs — complexity added, maintenance burden, scope risk, opportunity cost>

## Better Alternatives
<bulleted list of alternative approaches (if any) that could achieve a similar outcome with lower cost or risk; "None identified" if the idea is the best known approach>

## Recommendation
<proceed | reshape | drop> — <one-line rationale linking scores, premises, and pros/cons>

Stakes: <plain-English cost of proceeding vs not; reversibility; blast radius>

---

**Approve** this evaluation to continue to feature-create.
**Reject** to cancel the run (no feature created).
```

**2. Filled example**

```markdown
# Idea Evaluation Report

## Enhanced Idea
Add a post-discovery taste gate to `/sp:dev-idea` that presents an idea-evaluation report (urgency, necessity, premises, pros/cons) before creating the feature — giving the operator an explicit approve/reject checkpoint after the brainstorm refines the vague input into a concrete requirement.

## Scores

| Dimension | Score (0–5) | Rationale |
|-----------|-------------|-----------|
| **Urgency** | 3 | Not blocking users today; discovery still runs and features get created. But every feature created from a half-baked idea wastes a decompose + batch-create cycle that must be manually cancelled. |
| **Necessity** | 4 | The idea pipeline's "discovery → feature-create" path has no checkpoint where an operator can say "this isn't worth pursuing." That gap means ideas are never rejected early; they accumulate as abandoned features. The design-approval gate proves the pattern works for taste decisions. |

## Premises
- Operators will actually read and act on the report (not auto-approve everything)
- Discovery produces enough signal (enhanced idea, design summary) to make the evaluation meaningful
- The taste-gate pattern from design-approval transfers cleanly (same HITL pause semantics)
- A 0–5 integer scale is sufficient; no need for weighted composite scoring

## Pros
- Explicit early-kill point: reject before any feature/task corpus pollution
- Aligns with design-approval precedent — operators already understand taste gates
- Enhanced idea becomes the canonical "real requirement" for feature-create/AC
- Surfacing premises forces the agent to articulate assumptions, improving discovery quality

## Cons
- Adds one more HITL pause to the pipeline (longer wall-clock time for interactive runs)
- Template maintenance: another reference file to keep aligned with decision-brief norms
- Risk of operator fatigue if every idea triggers a report (mitigated: only fires on `/sp:dev-idea`, not `/sp:dev-plan`)

## Better Alternatives
- None identified. The closest alternative is always-auto-approve, which defeats the purpose.

## Recommendation
**Proceed** — necessity 4 + urgency 3 justifies the investment. The pattern is proven (design-approval), the implementation scope is bounded (one new pipeline state + template), and the downside (one extra pause) is acceptable for the safety it provides.

Stakes: Proceeding adds ~1 day of implementation work and a permanent pipeline state. Not proceeding means ideas continue to flow into features without operator vetting. Fully reversible (remove the state + template).

---

**Approve** this evaluation to continue to feature-create.
**Reject** to cancel the run (no feature created).
```

**3. Recommended long-term file home**

Recommendation: `plugins/sp/skills/spur-dev/references/idea-evaluation.md`

Rationale: The template is consumed by the idea-pipeline agent at the `idea-eval` state — that agent is orchestrated by `sp:spur-dev`, making the `spur-dev/references/` directory the natural home (alongside `decision-brief.md` which it follows). It should NOT live under `brainstorm/` because brainstorm owns discovery, not the evaluation gate. Final ownership may be confirmed in 0362 (agent contract).
### Testing
**Mode:** prototype / wayfinder (no runtime code). Re-verified 2026-07-28 under `/sp:dev-verifyall --feature I1 --auto --force --focus all --fix all`.

**Coverage:** N/A (documentation-only change; no runtime code path added).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 Template with all required dimensions | MET | Solution §1 template includes Enhanced Idea, Scores (urgency/necessity 0–5), Premises, Pros, Cons, Better Alternatives, Recommendation (proceed\|reshape\|drop), Approve/Reject; score guide 0–5 defined |
| R2 Decision-brief norms alignment | MET | Solution cites `decision-brief.md:10`; recommendation mandatory; stakes plain English; no second HITL SSOT |
| R3 Long-term home recommended | MET | Solution recommends `plugins/sp/skills/spur-dev/references/idea-evaluation.md` (ownership deferred to 0362, which confirmed) |
| R4 No pipeline wire-up | MET | No idea-pipeline.yaml / command edits from this ticket; prototype in Solution only |
| R5 Map I1 gist | MET | I1 Decisions so far includes 0361 one-liner (fixed this verify pass under `--fix all`) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Template covers required dimensions | MET | static | Template body in Solution; keywords urgency/necessity/premises/pros/cons/alternative/recommend/approve/reject/enhanced all present |
| Scenario: Filled example exists | MET | static | Solution §2 filled example for post-discovery taste gate idea |
| Scenario: Home path recommended | MET | static | Recommended path `plugins/sp/skills/spur-dev/references/idea-evaluation.md` |

**Design conformance:** N/A (prototype issue).

**SECUA:** N/A — markdown prototype only.

**Fix pass (`--fix all`):** R5 was UNMET; map gist written on I1 this pass.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-28T03:32:56.471Z todo → wip (system)
- 2026-07-28T03:34:13.527Z wip → testing (system)
- 2026-07-28T03:34:20.450Z testing → done (system)
