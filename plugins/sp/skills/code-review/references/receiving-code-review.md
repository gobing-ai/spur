# Receiving Code Review

A behavioral guardrail for the **reviewee** — the agent whose code is under review. The review
specialist (`sp:super-reviewer`) and the review skills (`sp:code-verification`,
`sp:functional-review`, `sp:code-improvement`) produce findings; this reference governs how the
reviewee *receives* and acts on them.

## The Contract

When review findings arrive:

1. **Verify before implementing.** Each finding is a claim, not an order. Re-read the cited
   `file:line` and confirm the finding is real before acting. A finding that misreads the code is
   rejected with evidence, not silently ignored.
2. **Technical rigor over performative agreement.** Do not agree with a finding just because a
   reviewer said it. Do not disagree just because it's your code. Judge on the evidence.
3. **Blind implementation is a failure mode.** Implementing every suggestion verbatim, without
   assessing correctness, is as bad as ignoring the review. You are responsible for the merged
   code, not the reviewer.
4. **Challenge unclear findings.** If a finding lacks `file:line` evidence or the reasoning is
   vague, ask for clarification — do not guess what the reviewer meant.
5. **Push back once, then comply.** If a finding looks wrong (security theater, misread code,
   conflicts with a stated goal), say so with evidence — once. If the reviewer confirms, comply;
   their context may exceed yours.

## Decision Table

| Finding quality | Reviewee action |
|-----------------|-----------------|
| Specific (`file:line`, clear reasoning) | Verify the code → implement the fix |
| Specific but wrong (misreads code) | Reject with evidence citing the actual code |
| Vague (no `file:line`, no reasoning) | Ask for clarification; do not guess |
| Correct but low-value (advisory) | Acknowledge; implement only if cheap or if it blocks |
| Conflicts with a stated goal | Push back once with the goal conflict; comply if confirmed |

## Anti-Patterns

- **Agreeing reflexively:** "Good catch — I'll fix that" without re-reading the code. The finding
  might misread the control flow.
- **Implementing verbatim:** Copy-pasting the reviewer's suggested code without understanding it.
  The reviewer doesn't have the full context; their suggestion might break an invariant.
- **Silent rejection:** Disagreeing with a finding but not saying so, letting the review "pass"
  without resolution. Either implement or reject with evidence — no silent drops.
- **Escalation theater:** "I'll let the operator decide" for a finding that's clearly wrong. Reject
  it with evidence; save the operator's attention for genuine judgment calls.

## When you are the reviewee under the pipeline

Under `task-pipeline.yaml`, the `review` step's findings are written to the task's `## Review`
section. As the reviewee (the implementer agent):

1. Read the `## Review` section via `spur task show <wbs> --json`.
2. For each finding, apply the Decision Table.
3. Implement the accepted fixes; reject the wrong ones with evidence in the commit message or the
   task's `## Solution` section.
4. Do **not** edit the `## Review` section directly — it is the reviewer's record. Your response
   goes in the implementation and the `## Solution` section.

## Relationship to `sp:code-verification`'s Common Rationalizations

`sp:code-verification`'s Common Rationalizations table governs the *reviewer's* honesty —
rationalizations a reviewer uses to soften a finding. This reference governs the *reviewee's*
honesty — rationalizations a reviewee uses to dismiss a finding. Both must be resisted.

| Reviewer rationalization (code-verification) | Reviewee rationalization (this reference) |
|----------------------------------------------|------------------------------------------|
| "The code looks fine to me." | "The reviewer doesn't know my codebase." |
| "I'll skip that dimension." | "That's advisory — I'll skip it." |
| "PARTIAL is close enough." | "The finding is nitpicky — I'll ignore it." |
| "The implementer said it works." | "The reviewer is wrong — I'll silently ignore it." |