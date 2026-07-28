---
name: idea-evaluation
description: >-
  Template SSOT for the post-discovery idea-evaluation report used by idea-pipeline's
  idea-eval taste gate. Brainstorm fills an instance at .spur/run/idea-eval-report.md.
see_also:
  - spur-dev
  - brainstorm
  - decision-brief
---

# Idea Evaluation Report Template

The idea-evaluation report is the operator-facing artifact between **discovery** and
**feature-create** on `/sp:dev-idea`. It follows [decision-brief](decision-brief.md) norms:
recommendation is mandatory, stakes in plain English, and approve/reject is the terminal choice.

**Authorship:** `sp:brainstorm` (discovery) fills a concrete instance to
`.spur/run/idea-eval-report.md`. The pipeline `idea-eval` state is HITL-only — it does not
re-author the report.

**Sidecar rule:** The enhanced idea does **not** overwrite `vars.idea`. Feature-create reads both
the original idea and this report.

## Template

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

## Pipeline contract

| Item | Value |
|------|--------|
| Filled instance path | `.spur/run/idea-eval-report.md` |
| Template home | this file |
| HITL state | `idea-eval` in `idea-pipeline.yaml` |
| Approve | continue → `feature-create` |
| Reject / cancel | → `cancelled` (no feature) |
| `--auto` | still pauses unless `idea_approved=true` / `--idea-approved` |
