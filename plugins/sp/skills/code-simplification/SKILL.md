---
name: code-simplification
description: "Simplify code for clarity without changing behavior. Use when refactoring for readability or reducing complexity."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - simplify
  openclaw:
    emoji: "🧹"
see_also:
  - sp:code-review
  - sp:code-implementation
  - sp:spur-tdd
---

# code-simplification — the simplification competency

Reduce complexity while preserving **exact** behavior. The goal is not fewer lines — it is code a
new reader understands faster. Every simplification must pass one test: *would a teammate understand
this version quicker than the original, and produce the same output for every input?* If either
answer is no, don't make the change.

This is a **technique** skill: it guides edits to source, it does not write task sections. When the
simplification lands inside a task, the `## Solution` change-map and status transitions stay with the
spine and `sp:code-implementation` — this skill owns *how to simplify well*.

## When to use

- A feature works and tests pass, but the implementation reads heavier than it needs to.
- Review flagged readability or complexity (`sp:code-review` → this skill for the fix).
- Deep nesting, long functions, unclear names, or duplicated logic in code you just touched.
- Consolidating related logic that drifted apart under time pressure.

Do **not** use this skill for:

- **Already-clean code** — simplifying for its own sake is churn, not improvement.
- **Code you don't yet understand** — comprehend first (see Step 1); you cannot preserve behavior
  you can't describe.
- **Hot paths where the simpler form is measurably slower** — clarity does not outrank a real,
  measured performance requirement.
- **Throwaway code about to be rewritten** — simplifying code you're deleting wastes effort.

## Five principles

1. **Preserve behavior exactly.** Only how the code reads changes — never inputs, outputs, side
   effects, error behavior, ordering, or edge cases. Unsure a change is behavior-preserving? Don't
   make it. If a "simplification" needs a test edited to pass, you changed behavior — revert.
2. **Follow project conventions.** Read `AGENTS.md` / `CLAUDE.md` and match neighboring code: import
   style, declaration form, naming, error handling, type-annotation depth. Simplification that
   breaks codebase consistency is churn, not simplification.
3. **Prefer clarity over cleverness.** Explicit beats compact when the compact form needs a mental
   pause to parse. A one-line nested ternary is not simpler than a five-line `if` chain.
4. **Maintain balance.** Over-simplification is a real failure mode: don't inline a helper that gave
   a concept a name, don't merge two clear functions into one tangled one, don't strip an abstraction
   that earns its keep for testability or a second caller, and don't optimize for line count.
5. **Scope to what changed** (R3 — surgical changes). Default to recently-modified code. No drive-by
   refactors of unrelated code unless the operator widens the scope; unscoped edits create noisy
   diffs and regressions in code you never meant to touch.

## The process

### Step 1 — Understand before touching (Chesterton's Fence)

Before changing or removing anything, know why it exists. Answer these; if you can't, read more
context first — you are not ready to simplify:

- What is this code's single responsibility? What calls it, and what does it call?
- What are its edge cases and error paths? Which tests pin the expected behavior?
- Why might it be shaped this way — a performance constraint, a platform quirk, a historical reason?
  Check `git blame` / `git log` for the original context.

### Step 2 — Identify opportunities

Each pattern below is a concrete signal, not a vague smell. Match against the target code.

**Structural complexity**

| Pattern | Signal | Move |
|---------|--------|------|
| Deep nesting (3+ levels) | Control flow hard to follow | Guard clauses / extracted helpers |
| Long function (50+ lines) | Multiple responsibilities | Split into focused, named functions |
| Nested ternaries | Needs a mental stack to parse | `if`/`else`, `switch`, or a lookup map |
| Boolean-flag params (`fn(true, false)`) | Opaque call sites | Options object or separate functions |
| Repeated conditional | Same check in many places | Extract a well-named predicate |

**Naming & readability**

| Pattern | Signal | Move |
|---------|--------|------|
| Generic names (`data`, `result`, `tmp`) | No intent conveyed | Rename for content (`userProfile`) |
| Misleading name | `get*` that also mutates | Rename to the real behavior |
| Comment restating the code | `// increment counter` over `count++` | Delete it |
| Comment carrying intent | `// retry: the API is flaky under load` | Keep it — the code can't say why |

**Redundancy**

| Pattern | Signal | Move |
|---------|--------|------|
| Duplicated logic | Same shape in 2+ places | Extract one shared function |
| Dead code | Unreachable branch, unused var, commented block | Remove after confirming it's dead |
| Pass-through wrapper | Adds indirection, no value | Inline it; call the target directly |
| Over-engineered pattern | Factory-for-a-factory, one-strategy strategy | Replace with the direct approach |

A couple of stack-native examples (the discipline is stack-agnostic; these happen to be `bun:test` TS):

```typescript
// nested conditionals → guard clauses (same behavior, shallower)
function process(data: Input) {
  if (data == null) throw new TypeError('data is null');
  if (!isValid(data)) throw new ValidationError('invalid data');
  return doWork(data);
}

// manual accumulation → intent-revealing builtin
const activeUsers = users.filter((u) => u.isActive);

// redundant boolean round-trip
function isValid(input: string): boolean {
  return input.length > 0 && input.length < 100;
}
```

### Step 3 — Apply incrementally

One simplification at a time. After each: run the **narrowest** test that covers it (`bun test <file>`
or the stack's equivalent). Passes → keep or continue; fails → revert that one change and reconsider.
Never batch untested simplifications — if something breaks you must know which change caused it.

**Separate refactoring from feature work.** A change that simplifies *and* adds behavior is two
changes; split them. **Rule of 500:** a refactor touching 500+ lines wants a codemod / AST transform,
not hand edits — manual work at that scale is error-prone and unreviewable.

### Step 4 — Verify the result

Step back and judge the whole diff, not each edit:

- Is the result genuinely easier to understand, or just shorter?
- Did you introduce a pattern inconsistent with the codebase?
- Is the diff clean and reviewable, with nothing unrelated mixed in?

If the "simplified" version is harder to follow or review, revert it. Not every attempt succeeds, and
a failed simplification honestly reverted beats a clever one shipped.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works, don't touch it." | Working code that's hard to read is hard to fix when it breaks. The cost lands on every future change, not today. |
| "Fewer lines is always simpler." | Comprehension speed is the metric, not line count. A dense one-liner can be the harder version. |
| "I'll simplify this unrelated code too while I'm here." | Unscoped edits create noisy diffs and regressions in code you didn't mean to change. Stay in scope (R3). |
| "The original author must have had a reason." | Maybe — check `git blame` (Chesterton's Fence). But accumulated complexity often has no reason; it's residue of iteration under pressure. |
| "This abstraction might be useful later." | Speculative abstraction is complexity without a caller (R2). Remove it; re-add when a second use actually arrives. |
| "I'll refactor while I add this feature." | Mixed diffs are harder to review, revert, and read in history. Two changes, two commits. |
| "The types make it self-documenting." | Types document structure, not intent. A well-named function says *why* a signature can't. |

## Red Flags

- A simplification that required editing a test to pass — you changed behavior, not form.
- The "simplified" code is longer or harder to follow than the original.
- Renaming to your taste instead of the project's conventions.
- Removing error handling because it "makes the code cleaner."
- Simplifying code whose purpose you can't state in one sentence.
- Many simplifications batched into one large, un-testable commit.
- Refactoring outside the task's scope without being asked.

## Verification

After a simplification pass, confirm — with evidence, not assertion:

- [ ] All existing tests pass **without modification** (paste the command + result).
- [ ] Build succeeds; lint/format clean (no style regressions).
- [ ] Each simplification is an incremental, reviewable change; the diff has nothing unrelated.
- [ ] The result follows project conventions (`AGENTS.md` / `CLAUDE.md`).
- [ ] No error handling was removed or weakened; no dead code left behind (unused imports, dead branches).
- [ ] A reviewer (`sp:code-review`) would call the change a net improvement.

## See also

- **`sp:code-review`** — review the simplified diff; the review that flagged complexity hands the fix here.
- **`sp:code-implementation`** — the implement step that produced the code being simplified.
- **`sp:spur-tdd`** — the tests that pin behavior are the safety net that makes simplification safe.
