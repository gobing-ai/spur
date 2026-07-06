---
name: decision-brief
description: "Extracted format: the HITL decision-brief shape used wherever the pipeline asks the operator to choose — brainstorm clarification, dev-refine questions, and the decomposition pre-batch quiz. One SSOT so every human-facing choice reads the same way."
see_also:
  - spur-dev
  - brainstorm
  - spec-decomposition
---

# Decision-Brief Format (HITL SSOT)

When the pipeline surfaces a choice to the operator, present it as a **decision brief**, not a bare
question. The brief respects the operator's time: it leads with the question and a recommendation, so
a busy reader can approve in one glance or dive into the options if they disagree. This is the single
source of truth — `brainstorm` (clarify), `dev-refine` (questions), and the `spec-decomposition`
pre-batch quiz all render their prompts in this shape; they link here rather than restating it.

## The shape

Every decision brief carries, in order:

1. **One-line question.** The decision in a single sentence. No preamble.
2. **Stakes, in plain English.** Why it matters and what a wrong pick costs — reversibility, blast
   radius, who is affected. One or two sentences, no jargon.
3. **A recommendation — always.** State which option you would pick and why, in one line. "It
   depends" is not an answer; if it depends, name what it depends on. The operator can override, but
   they should never have to guess what you think.
4. **Options with a completeness score.** For each option, a `0–100` completeness score (how fully it
   solves the stated problem). When options differ **in kind** (not in degree) a single score
   misleads — replace it with a one-line **kind-note** describing the axis of difference instead.
5. **Pros / cons per option.** The two or three that actually move the decision — not an exhaustive list.
6. **Dual effort labels where effort differs.** Label human effort and AI effort separately
   (e.g. `human: 5 min review · AI: 2 min`) **only when they diverge**. If effort is comparable,
   omit — the label exists to surface where the human cost and the agent cost pull apart.

## Template

```
Q: <one-line question>
Stakes: <plain-English cost of a wrong pick; reversibility / blast radius>
Recommendation: <the option you'd pick> — <one-line why>

Option A — <name>   [completeness: 85]   [human: 5 min · AI: 2 min]
  + <pro that moves the decision>
  − <con that moves the decision>
Option B — <name>   [kind-note: optimizes for X over Y, not "more/less complete"]
  + <pro>
  − <con>
```

## Rules

- **Recommendation is mandatory.** A brief that lists options without a recommendation offloads the
  decision the agent was asked to help with. Pick one; defend it in a line.
- **Score, or kind-note — never a false score.** Do not assign a completeness number to options that
  differ in kind; a `70 vs 72` on incommensurable options is noise. Use the kind-note.
- **Effort labels only where they diverge.** Adding `human: 2 min · AI: 2 min` everywhere is clutter;
  the signal is the *divergence* (a change that is cheap for the AI but expensive for the human to
  review, or vice-versa).
- **Plain English in the stakes.** The operator may not share the agent's context; state the cost in
  terms they can weigh without reading the code.

## Where it is applied

| Site | Prompt | How the brief is used |
|---|---|---|
| `brainstorm` (dev-brainstorm Phase 1) | clarify ambiguous input | Each `AskUserQuestion` is framed as a decision brief — recommendation + option scores. |
| `dev-refine` | targeted Q&A on gaps | Each refinement question presents the options as a brief so the operator picks with stakes visible. |
| `spec-decomposition` pre-batch quiz | approve the task breakdown | The granularity / dependency quiz is a decision brief: recommended breakdown + the trade-off of each alternative slicing. |
