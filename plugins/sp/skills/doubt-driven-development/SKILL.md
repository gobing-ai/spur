---
name: doubt-driven-development
description: "In-flight adversarial review of a non-trivial decision before you commit it: extract the artifact + contract, hand them (not your reasoning) to a fresh-context skeptic, reconcile findings, stop at 3 cycles. Triggers: \"doubt this\", \"stress-test this decision\", \"adversarial check before I commit\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - doubt
  openclaw:
    emoji: "🕵️"
see_also:
  - sp:parallel-execution
  - sp:code-verification
  - sp:source-driven-development
---

# doubt-driven-development — the in-flight adversarial-review competency

Catch a wrong decision **while you can still change it cheaply** — before the code is written, the
migration is run, or the design is locked. You state a claim, strip it to its artifact and its
contract, and hand *only those* to a fresh-context skeptic whose job is to find where the artifact
violates the contract. The skeptic never sees your reasoning, so it cannot be talked into agreeing.

This is a **technique** skill: it stress-tests a decision mid-flight. It is **not** the post-hoc
gate — `sp:code-verification` verifies finished work against requirements, and `sp:code-review`
reviews a completed diff. Doubt runs *earlier and cheaper*: on a plan, an interface, a schema, a
tricky algorithm, before you invest in building it.

## When to use

- A non-trivial decision is about to be committed: an API/interface shape, a schema, a state
  machine, a concurrency approach, a migration plan, a security boundary.
- You feel the pull of "this is probably right" on something whose cost-of-wrong is high.
- Review flagged a design concern and you want an independent adversary before reworking.

Do **not** use this skill for:

- **Trivial or reversible choices** — a variable name, a local refactor. Doubt has a cost; spend it
  where being wrong is expensive.
- **Finished-work verification** — that is `sp:code-verification` (requirements) / `sp:code-review`
  (diff). Doubt is pre-commit, not the completion gate.
- **Fact-checking an external claim** — that is `sp:source-driven-development` (verify against
  primary sources). Doubt tests *your* artifact against *its* contract, not the world.

## The five-step loop

### 1. CLAIM — state what you are about to commit

One sentence: the decision and why you believe it is right. This is *your* view — it does **not**
travel to the skeptic. Writing it down makes the next step honest.

### 2. EXTRACT — artifact + contract, strip the reasoning

Reduce the claim to two things the skeptic can check independently:

- **Artifact** — the concrete thing under judgment: the interface signature, the schema DDL, the
  pseudocode, the plan steps. No commentary.
- **Contract** — the invariants it must satisfy: the requirements, the edge cases, the performance
  or safety bounds, the AC it will be verified against later.

**Strip your reasoning.** The skeptic must not receive *why* you think it works — only *what* it is
and *what it must do*. Reasoning is what smuggles your blind spot into the reviewer.

### 3. DOUBT — hand artifact + contract (NOT the claim) to a fresh-context skeptic

Dispatch an adversarial reviewer whose sole instruction is: *find where this artifact violates this
contract; assume it is wrong until proven otherwise.* Pass **only** the artifact and the contract.
Use `sp:parallel-execution` (the adversarial-verification-panel pattern) or a single
`spur agent run` with a fresh context — the point is a reviewer that shares none of your framing.

**Never pre-judge the reviewer.** No "don't worry about X", no "this part is fine", no pre-rated
severity. A steered skeptic is theater. (See `sp:parallel-execution` — never pre-judge the reviewer.)

Optional: offer a **cross-model** skeptic (a different model than the author) when the decision is
high-stakes — a different model has different blind spots.

### 4. RECONCILE — classify every finding

For each thing the skeptic raised, classify it — do not argue with it reflexively:

| Class | Meaning | Action |
|---|---|---|
| **Contract-misread** | The skeptic misunderstood an invariant | Tighten the contract wording; the artifact stands |
| **Actionable** | A real violation of the contract | Fix the artifact before committing |
| **Trade-off** | A cost you knowingly accept | Record the decision + why; do not silently drop it |
| **Noise** | Out of scope / not tied to the contract | Discard, with a one-line reason |

A finding you cannot classify is **actionable** until proven otherwise — the benefit of the doubt
goes to the doubt.

### 5. STOP — bounded at 3 cycles

If RECONCILE produced fixes, you may re-run DOUBT on the changed artifact — but **at most 3 cycles
total**. Beyond three, the loop is no longer finding defects; it is manufacturing them. Stop, record
the residual trade-offs, and commit. Endless doubting is its own failure mode (see Red Flags).

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I already reviewed it myself — a second pass is redundant." | Self-review shares your blind spot. A fresh-context skeptic exists precisely to see what you cannot. |
| "I'll give the reviewer my reasoning so it understands." | Your reasoning is the vector for your blind spot. Pass artifact + contract only; reasoning steers the skeptic to agree. |
| "The skeptic is being pedantic — I'll just overrule it." | Reflexive overrule defeats the loop. Classify the finding (misread / actionable / trade-off / noise); overrule only with a recorded reason. |
| "This decision is basically right, doubt is overkill." | "Basically right" on a high-cost-of-wrong decision is exactly what doubt is for. Cheap now beats a rewrite later. |
| "One more cycle and it'll be perfect." | Past 3 cycles you are inventing problems, not finding them. Record residual trade-offs and commit. |

## Red Flags

- Passing your **reasoning** (not just artifact + contract) to the skeptic — the review is now contaminated.
- Pre-judging the reviewer ("this part is fine", pre-rated severity, "don't flag X").
- Overruling every finding without classifying it — the loop became a rubber stamp for your original claim.
- **Doubt theater**: running the loop but having already decided to ship unchanged regardless of findings.
- Exceeding 3 cycles — endless doubting that manufactures defects instead of finding them.
- Using doubt as a substitute for the post-hoc gates (`sp:code-verification` / `sp:code-review`) rather than as the earlier, cheaper pass.

## Verification

Before you commit the decision, confirm — with evidence, not assertion:

- [ ] The skeptic received the **artifact + contract only**; your reasoning was withheld (state it).
- [ ] Every finding is classified (contract-misread / actionable / trade-off / noise) with a one-line disposition.
- [ ] Every **actionable** finding is fixed in the artifact, or explicitly deferred with a recorded reason.
- [ ] Every **trade-off** is recorded (not silently dropped) — it survives into the task's design/decision notes.
- [ ] The loop stopped at ≤ 3 cycles; residual trade-offs are named.
- [ ] This was a *pre-commit* pass — the post-hoc gate (`sp:code-verification` / `sp:code-review`) still runs on the finished work.

## See also

- **`sp:parallel-execution`** — the adversarial-verification-panel / fresh-context subagent mechanics doubt dispatches through.
- **`sp:code-verification`** — the post-hoc requirements/AC gate; doubt is the earlier, cheaper, pre-commit counterpart.
- **`sp:source-driven-development`** — when the doubt is about an external fact (an API contract), verify it against primary sources there.
