---
name: source-driven-development
description: "Verify framework / API / library facts against primary sources before generating code, and separate \"the API exists\" from \"I used it correctly under its contract.\" The single sp owner of source-first verification. Triggers: \"check the docs first\", \"verify this API\", \"source-first\", \"is this the real signature\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - verify-source
  openclaw:
    emoji: "📚"
see_also:
  - sp:code-implementation
  - sp:doubt-driven-development
  - sp:code-verification
---

# source-driven-development — the source-first verification competency

Do not generate code from memory of an API. Before you call a framework function, pass an option, or
rely on a library behavior, **verify it against the primary source** — the official docs for the
pinned version, the type signature, the actual source. Memory is a cache that goes stale silently;
the primary source is the contract.

This skill is the **single sp owner** of source-first verification. Where sp workflows previously
delegated fact-checking to an external `cc:anti-hallucination` skill, that procedure now lives here,
in sp's own vocabulary — one authority, no duplicated procedure. Other sp skills (e.g. `brainstorm`)
delegate verification to `sp:source-driven-development`; they do not restate the protocol.

## The two questions (do not conflate them)

Every use of an external API answers **two** independent questions. Confusing them is the core error:

1. **Does the API exist?** — Is `foo.bar(x)` a real function with that signature in this version?
   A hallucinated method compiles in your head and fails at runtime.
2. **Am I using it correctly under its contract?** — Even a real API has preconditions, ordering
   rules, error modes, and edge cases. "It exists" does not mean "I called it right."

Source-first verification must satisfy **both**. A confirmed-existing API used against its contract
is still a bug.

## When to use

- Before generating code against a framework / library / API you are not certain of **for the pinned
  version** — signatures, option names, return shapes, error behavior.
- When behavior is **version-specific** and you are recalling it from memory (state the version).
- When a build/runtime error suggests the API does not behave as you assumed.
- Reconciling a claim about an external system before it becomes load-bearing in a design.

Do **not** use this skill for:

- **Your own code's correctness** — that is `sp:code-verification` (requirements/AC) and `sp:code-review`.
- **Stress-testing a design decision** — that is `sp:doubt-driven-development` (artifact vs contract).
- **Well-known, version-stable stdlib** you can state with HIGH confidence — verification has a cost;
  spend it where being wrong is likely and expensive.

## The process

### Step 1 — Classify your confidence before you write

| Level | Meaning | Action |
|---|---|---|
| **HIGH** | Verified against the pinned version's docs/source **this session** | Generate; cite the source inline |
| **MEDIUM** | Recalled from a prior session; plausibly stale | Verify before relying on it |
| **LOW** | Memory only, no source in hand | Stop — verify first; never present as fact |

If you cannot honestly claim HIGH for a version-specific behavior, you are at MEDIUM or LOW — verify.

### Step 2 — Go to the primary source, in priority order

1. The **type signature / source** in the installed, pinned dependency (the ground truth for *this* build).
2. The **official docs for the pinned version** (not the latest — the version in the lockfile).
3. Authoritative references when docs are thin.
4. Memory — **LOW only**, and never as the final authority.

State the **version** inline whenever behavior is version-specific.

### Step 3 — Verify both questions

- **Existence:** the signature matches — name, arity, parameter names, return type.
- **Contract:** preconditions, call ordering, error/exception modes, null/empty edge cases, and any
  documented caveats are accounted for in how you call it.

### Step 4 — Cite, then generate

Generate the code and **cite the source** (doc URL + date, or `pkg@version` + the file/symbol) at the
point of use or in the task's notes. A claim about external behavior without a citation is
unverified — flag it as such rather than presenting it as fact.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I've used this API a hundred times — I know the signature." | APIs change across versions and your memory is a silent cache. Verify against the *pinned* version; recall is MEDIUM at best. |
| "It compiled, so I used it right." | Compiling proves existence and types, not contract. Ordering, preconditions, and error modes are not checked by the compiler. |
| "The latest docs say so." | You ship against the *pinned* version, not latest. Read the docs for the version in the lockfile. |
| "Close enough — I'll fix it if it breaks." | Guessing at an external contract moves the cost to runtime/production. Verify before generating; it is cheaper here. |
| "Verifying every call is too slow." | Verify what you are *not sure of*, at the confidence level you honestly hold. HIGH needs no re-check; LOW always does. |

## Red Flags

- Generating version-specific code you would rate MEDIUM or LOW confidence, without opening a source.
- Presenting an API claim as fact with no citation (doc + date, or `pkg@version` + symbol).
- Treating "it exists" as proof it is used correctly (the two questions collapsed into one).
- Reading the *latest* docs for a dependency pinned to an older version.
- Recalling behavior "from memory" for a security-, money-, or data-integrity-sensitive call.
- Duplicating this protocol inside another skill instead of delegating to `sp:source-driven-development`.

## Verification

- [ ] Every version-specific external behavior relied on was checked against the pinned version's source/docs **this session**.
- [ ] Both questions answered — the API exists **and** is called within its contract.
- [ ] Claims about external behavior carry a citation (source + date, or `pkg@version` + symbol); unverifiable ones are flagged, not asserted.
- [ ] Confidence is stated honestly (HIGH/MEDIUM/LOW); nothing at LOW was presented as fact.

## See also

- **`sp:code-implementation`** — consumes this discipline before generating code against an external API.
- **`sp:doubt-driven-development`** — stress-tests *your* artifact vs its contract; this skill verifies *external* facts vs their source.
- **`sp:code-verification`** — verifies your finished code against requirements/AC (a different authority than source-first).
