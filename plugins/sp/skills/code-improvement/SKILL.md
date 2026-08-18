---
name: code-improvement
description: "Surface architectural friction and propose deepening opportunities — refactors that turn shallow, tightly-coupled modules into deep, testable, AI-navigable ones. Triggers: \"improve architecture\", \"find refactoring opportunities\", \"shallow module\", \"hard to test\", \"reduce coupling\", \"deepen modules\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - reviewer
    - pipeline
  modes:
    - review
  openclaw:
    emoji: "🏗️"
see_also:
  - sp:code-verification
  - sp:functional-review
  - sp:spur-dev
---

# Spur Code Improvement

The **architecture and structural depth** counterweight to `sp:code-verification`'s SECUA review.
Where code-verification asks "is the code correct/secure/efficient?", code-improvement asks "is the
architecture deep, testable, and navigable — or is it a pile of shallow pass-through modules held
together by tight coupling?"

## When to Use

**Trigger keywords:** improve architecture, refactor, shallow module, tightly coupled, untestable,
AI-navigable, deepening, consolidate modules, reduce coupling, architectural friction, hard to
test, pass-through module.

Load this skill when:

- Surfacing architectural friction and deepening opportunities as ranked candidates.
- Running the architecture dimension of a multi-dimensional review (`/sp:dev-review --focus architecture`).
- Auditing a module or package for structural debt before a refactor.
- Producing an advisory (non-blocking) deepening report to accompany a SECUA review.

Do **not** use this skill for:

- Requirements traceability (use `sp:functional-review`).
- SECUA quality review (use `sp:code-verification`).
- Implementing the refactor (use `sp:code-implementation` — this skill *surfaces*, it does not ship).

## Key Distinctions

| Skill | Question it answers |
|-------|---------------------|
| **`sp:code-improvement`** | Is the architecture deep / testable / navigable? (structural depth) |
| **`sp:functional-review`** | Are all task requirements implemented? (requirements completeness) |
| **`sp:code-verification`** | Is the code correct, secure, efficient, usable? (SECUA quality) |

A complete `/sp:dev-review --focus all` runs all three. This skill owns the **architecture**
dimension; the others are out of scope here.

## Cross-cutting rules (inherited from sp:spur-dev)

CLI-gated section writes: see
[spur-dev/cross-cutting.md](../spur-dev/references/cross-cutting.md). Universal honesty gate: see
[Verification Before Completion](../spur-dev/references/cross-cutting.md#verification-before-completion).

---

## Improvement Lenses

Five signals indicate a shallow or tightly-coupled module. Each defines a symptom, a diagnostic,
and the deepening direction. Full definitions and examples in
[references/deepening-signals.md](references/deepening-signals.md).

| # | Signal | Symptom | Deepening direction |
|---|--------|---------|--------------------|
| 1 | **Shallow module** | A module whose interface is as complex as its implementation | Collapse it into its caller or give it a real body |
| 2 | **Tight coupling** | Two modules that must change together | Introduce a seam (interface, event, or DTO) |
| 3 | **Wrong seam** | Abstraction boundary in the wrong place | Move responsibility across the seam |
| 4 | **Weak locality** | Related logic scattered across modules | Co-locate by responsibility |
| 5 | **Poor test surface** | Logic that can only be tested through a large stack | Extract a pure function or inject a boundary |

---

## Severity

| Severity | Blocking? | Description |
|----------|-----------|-------------|
| **blocker** | yes — must fix before merge | The architecture cannot support the current or next change without a structural fix. Examples: circular dependency, module with no test surface, a seam that leaks domain types across a boundary. |
| **major** | yes (in pipeline context) | Significant friction: a shallow module duplicated 3+ ways, tight coupling that forces coordinated changes across packages, a wrong seam that blocks a planned feature. |
| **minor** | advisory | Local friction: a module slightly too shallow, coupling that's awkward but not coordinated. |
| **advisory** | advisory | Deepening opportunity: the code works and is testable, but would be cleaner with a deeper module. Always non-blocking. |

**Under the pipeline** (`/sp:dev-review` in a task run), `blocker` and `major` block the
`approve(HITL)` gate. `minor` and `advisory` are recorded but do not block. **Standalone** reviews
are advisory-only — the operator decides what to act on.

---

## Workflow

### Step 1 — Establish scope

```bash
spur task show <wbs> --json    # for a pipeline run
# OR a path glob for standalone:
# scope = 'src/api/' | 'packages/domain/' | 'plugins/sp/'
```

For a pipeline run, derive the diff scope the same way `sp:code-verification` Step 3 does (the
task's last commit → changed `*.ts/*.tsx/*.js/*.jsx`). For standalone, the `path` argument is the
scope.

### Step 2 — Explore (read the map)

Build a module-level map of the scope:

- List the modules (files / directories) in scope.
- For each, read its exports and immediate callers (use LSP `references` / `definition` where
  available; fall back to `grep` + `read`).
- Identify the module's **interface** (exported surface) and its **implementation** (non-exported
  body). A module is shallow when the interface is as complex as the implementation.

### Step 3 — Apply the five lenses

For each module in scope, check each of the five improvement signals:

1. **Shallow module?** Is the exported surface as complex as the body? (interface-to-impl ratio
   ≈ 1:1)
2. **Tight coupling?** Does this module change in lockstep with another? (grep for co-changed
   symbols, shared mutable state, deep relative imports)
3. **Wrong seam?** Is the abstraction boundary in the wrong place? (domain types leaking across a
   transport seam, a service importing a DAO directly instead of through a repository, etc.)
4. **Weak locality?** Is related logic scattered? (a single responsibility spread across N files)
5. **Poor test surface?** Can the core logic be tested without standing up a large stack? (no pure
   extraction, no injectable boundary)

For each signal hit, record a **candidate** using the Candidate Format below.

### Step 4 — Present candidates

Emit the ranked candidate list. Do **not** implement — this skill surfaces, it does not ship. The
operator (or `sp:code-implementation`) decides what to act on.

### Step 5 — Grilling (optional, `--auto` skips)

For each `blocker`/`major` candidate, state the single hardest *challenge* to the deepening
proposal ("what breaks if we do this?") and the single hardest *defense*. If the defense cannot
answer the challenge, downgrade the severity or drop the candidate. Three cycles max; stop sooner
if satisfied.

---

## Candidate Format

Each candidate is a structured finding:

```markdown
### C{n} — {signal name} in `{module}`

- **Severity:** blocker | major | minor | advisory
- **Signal:** shallow module | tight coupling | wrong seam | weak locality | poor test surface
- **Location:** `path/to/module.ts:42`
- **Symptom:** <1-2 sentences — what's wrong, concretely>
- **Evidence:** <file:line anchors showing the signal>
- **Deepening proposal:** <the structural change that would fix it>
- **Challenge:** <the hardest objection to the proposal>
- **Defense:** <the answer to the challenge, or "none — downgrade">
- **Affected files:** <list of files the refactor would touch>
```

---

## Context Inputs

- **`CONTEXT.md`** (if present in the repo root or a package) — domain vocabulary. Use its terms
  in symptom descriptions to keep candidates readable for the team.
- **`docs/adr/`** (if present) — architectural decisions. A candidate that contradicts an ADR
  must cite the ADR and propose superseding it (do not silently diverge — same rule as the docs
  constitution).
- **Neither present?** Proceed without them; the five signals are self-contained.

---

## Multi-dimensional review integration

When invoked as the `--focus architecture` dimension of `/sp:dev-review`:

- The scope is the task's diff (pipeline) or the `path` arg (standalone).
- `blocker`/`major` candidates block the `approve(HITL)` gate alongside any SECUA blockers from
  `sp:code-verification`.
- The candidate list is returned as a **review fragment**; the review coordinator
  (`sp:super-reviewer` under `/sp:dev-review`) merges it into the combined `## Review` section —
  it is never written by `record`, which backfills `## Review` only when the section is bare
  (fallback-only, F92 0593 R1).
- This skill does **not** write to the task file directly — the coordinator (or the operator) does.

Standalone, the skill emits the candidate list as advisory output; the operator acts on it.

---

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works, so the architecture is fine." | Working code can still be shallow or tightly coupled. This skill judges *depth*, not correctness. |
| "We can refactor that later." | "Later" is how structural debt compounds. A `blocker` says *now*; `advisory` says *later*. |
| "It's just a small wrapper." | A small wrapper IS the shallow module. Collapse it or give it a real body. |
| "The coupling is necessary for performance." | Cite the measurement. Unmeasured "necessity" is rationalization. |
| "I don't see how to deepen this." | If the proposal has no defense after Grilling, drop the candidate — don't pad the report. |

---

## Gotchas

1. **Surface, don't ship.** This skill produces candidates. Implementation is `sp:code-implementation`.
2. **Advisory by default standalone.** Only under the pipeline do `blocker`/`major` block.
3. **ADR awareness.** A candidate that contradicts an ADR proposes superseding it — never silently
   diverge (mirrors the docs constitution's binding rule).
4. **No file:line, no candidate.** Every candidate's `Evidence` field must cite specific anchors.
5. **Grilling is a filter, not a ritual.** Three cycles max; if the defense fails, drop or downgrade.

---

## Platform Notes

### Claude Code

Invoke via `Skill(skill="sp:code-improvement", args="<path|wbs>")`. LSP `references` /
`definition` are available for the Explore step.

### Codex / OpenClaw / OpenCode / Antigravity

Run `spur` CLI via Bash; `grep` + `read` for the Explore step if no LSP. The skill is the SSOT;
execute the workflow steps inline.