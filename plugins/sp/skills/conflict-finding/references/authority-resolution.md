---
name: authority-resolution
description: "Authority discovery, claim taxonomy, fallback authority matrix, precedence rules, and the ambiguity protocol for sp:conflict-finding."
see_also:
  - conflict-finding
---

# Authority resolution — subject + claim type, never a whole file

The hard problem of conflict finding is not text matching; it is deciding **which artifact is
authoritative for a given claim**. Authority is resolved for a **subject + claim type**, never for
a whole file. Two files can disagree without any conflict if they claim different kinds of things
about different subjects, and a single file can be authoritative for one claim type and merely a
projection for another.

This file is the SSOT for **Step 2 — Discover local authority** of the audit protocol. It defines
(a) how authority is discovered, (b) the claim taxonomy and fallback matrix, (c) the precedence
rules that resolve edges, and (d) the ambiguity protocol that stops rather than fabricates a
winner. It pairs with:

- [comparison-protocol.md](./comparison-protocol.md) — how subjects and claims are clustered and
  compared once authority is known.
- [finding-contract.md](./finding-contract.md) — the `status`/`conflict_type` fields a finding
  carries, including `needs-authority-decision`.
- [remediation-routing.md](./remediation-routing.md) — how a resolved authority routes a confirmed
  repair through its owner, and how ambiguous authority halts mutation.

## 1. Authority discovery

Authority is discovered in two passes, and the second pass can only override the first when the
project is **explicit** about it.

### 1.1 Entry / process pass (always first)

Read in order, before interpreting any difference:

1. `AGENTS.md` (project root or nearest ancestor) — project entry, routing, and any project-local
   override rules.
2. `docs/99_PROJECT_CONSTITUTION.md` (when present) — the process SSOT. Per the Spur documentation
   map, **lower-numbered numbered docs win on content; `99` owns process**. It may declare
   precedence boundaries, ownership, and change authority that the fallback matrix must respect.

`AGENTS.md` and the constitution declare **project-local rules**. When those rules are explicit
about a claim type, they win over the fallback matrix in §2. When they are silent or merely restate
defaults, apply the documented fallback matrix.

### 1.2 Default authority set

The default authority set is the union of these files **when present**:

| Path | Role in the model |
|------|-------------------|
| `AGENTS.md` | project entry, routing, project-local overrides |
| `docs/00_ADR.md` | structural decisions and rationale |
| `docs/01_PRD.md` | product scope and non-goals |
| `docs/03_ARCHITECTURE.md` | current architecture contract |
| `docs/04_DESIGN.md` | command/API/schema surface |
| `docs/05_FEATURES.md` | feature status projections |
| `docs/99_PROJECT_CONSTITUTION.md` | process and contribution rules |

Absent optional files are **reported without blocking the audit**. Their absence is itself an
omission candidate for the `authority` pillar, but it does not halt discovery or comparison of the
present authorities.

### 1.3 Authority is resolved for a subject + claim type

Never ask "which file wins?" in the abstract. Always ask:

```
For this SUBJECT, and this CLAIM TYPE, which artifact is normative?
```

A subject is a concrete named thing under audit — a WBS id, a feature id, a symbol, a command, a
config key, a path, a domain term, or a free-form concept the operator scoped. A claim type is one
of the eight rows of §2. The same pair of files may be ordered differently for different claim
types: `docs/01_PRD.md` is normative for product scope but only a projection for implementation
behavior.

## 2. Claim taxonomy and fallback authority matrix

The fallback matrix applies when the project declares no explicit rule. Each row names the
**normative authority** (what the claim *should* be), the **constraint / projection** artifacts
(what derives from or must not contradict it), and the **observed reality** (what currently *is*,
recorded separately).

| Claim type | Normative authority | Constraint / projection | Observed reality |
| --- | --- | --- | --- |
| Process and contribution rules | `docs/99_PROJECT_CONSTITUTION.md` | `AGENTS.md`, templates, workflows | actual harness behavior and gate output |
| Structural decision / rationale | accepted `docs/00_ADR.md` entry | architecture/design docs | source/module topology |
| Product scope and non-goals | `docs/01_PRD.md` | feature tree and roadmap | shipped surface |
| Feature goal and AC | feature file, within PRD/ADR bounds | tasks and `docs/05_FEATURES.md` | implementation and verification evidence |
| Task obligation/status | task Requirements/AC plus lifecycle verdict | feature AC and task Solution/Testing | code, tests, gate output |
| Architecture mechanism | ADR when it decides the seam; otherwise current architecture contract | `docs/03_ARCHITECTURE.md` | code dependency/topology |
| Command/API/schema surface | owning command/contract/schema source under existing ADRs | `docs/04_DESIGN.md` | registered runtime behavior and tests |
| Implementation behavior | applicable task/feature/doc obligation defines "should" | tests as executable projection | source and runtime behavior define "is" |

### 2.1 Reading the matrix

- **Normative authority** is the source of truth for what *should* be true about the claim. A
  difference between a projection and its authority is a **stale projection**; a difference between
  two normative authorities for the same subject+claim type is a candidate **contradiction**.
- **Constraint / projection** artifacts derive from, or must stay within, the authority. They are
  judged *against* their authority, not as independent truth.
- **Observed reality** is never merged into the normative column. Code/tests/runtime output are
  recorded as what *is*, and the gap between "should" (normative) and "is" (observed) is the
  conflict surface — but the two are always reported separately (see §5).

## 3. Precedence rules

These five rules resolve an authority edge once the claim type is known. Every precedence
decision in a finding must cite the project rule or documented fallback that justifies it
(requirement R3).

### Rule 1 — Lower-numbered docs do not globally beat everything

A lower-numbered numbered document (e.g. `docs/00_ADR.md` vs `docs/04_DESIGN.md`) does **not**
automatically win every argument. The constitution's documented precedence applies **only within
its stated boundary** (typically "lower number wins on content; `99` owns process"). Outside that
boundary the fallback matrix (§2) decides by claim type. Do not map "lower number ⇒ more
authoritative" as a global ranking.

### Rule 2 — Code is authoritative for what happens, not what should happen

Source and runtime behavior define the **observed reality** ("is"). They are authoritative for
*what currently happens*. They are **not** automatically authoritative for *what should happen*:
that is defined by the applicable obligation (task/feature/doc), per the `Implementation behavior`
row. A gap where code diverges from its obligation is a conflict candidate; it is not resolved by
"code wins."

### Rule 3 — A todo feature/task differing from code is planned work, not stale code

When a feature/task is still `todo` (or its lifecycle/supersession metadata does not say otherwise)
and the code does not yet reflect it, the difference is **planned work**, not stale code or a
contradiction. The project intends to ship it later. Treat it as stale only when the lifecycle or
supersession metadata indicates the obligation was abandoned, superseded, or already-resolved.
This is the classic false-positive guard: distinguishing "not yet implemented" from "implemented
differently."

### Rule 4 — Accepted ADRs beat derived projections; superseded ADRs are historical

An **accepted** `docs/00_ADR.md` entry is normative for the structural decision and architecture
mechanism it decides, and beats derived architecture/design projections that contradict it. A
**superseded** ADR is historical evidence, not current authority: it documents what was decided
and later replaced, and must not be treated as governing. When auditing, check supersession
metadata before asserting that an older ADR contradicts current code or docs.

### Rule 5 — Incomparable authorities ⇒ needs-authority-decision

If two authorities for the same subject+claim type are **incomparable** (no project rule and no
fallback row orders them; neither supersedes the other within a stated boundary), the finding
status is `needs-authority-decision`. **No repair is proposed as settled fact.** See §4. This rule
is the anti-pattern boundary: never force a winner through a global ranking detached from claim
type and local process rules.

## 4. Ambiguity protocol

### 4.1 What counts as ambiguous

Authority is ambiguous — and must stop rather than fabricate — in three cases:

| Case | Meaning |
|------|---------|
| **Missing** | No normative authority exists for the subject+claim type (e.g. no ADR decides a seam, no PRD line covers a scope question), and no fallback row supplies one |
| **Incomparable** | Two authorities exist but no rule or fallback row orders them (Rule 5) |
| **Genuinely ambiguous** | An authority is self-contradictory, underspecified, or its boundary cannot be determined from the artifacts |

### 4.2 What ambiguity means for a finding

- The finding's `status` is `needs-authority-decision` (per [finding-contract.md](./finding-contract.md)).
- It is an **unresolved HITL item**: it surfaces for the operator to decide, and is never silently
  resolved by a heuristic or global ranking.
- `proposed_repair` is left as **none / pending decision** — the skill must not propose a repair as
  settled fact when authority is unresolved.
- The finding still records the candidate authorities, the claim paraphrase, and the evidence for
  both sides, so the operator has everything needed to decide. Uncertainty is preserved, not erased.
- Low confidence never disappears: ambiguous/missing authority is reported as an unresolved item,
  not promoted to a definitive conflict and not dropped.

### 4.3 Remediation consequence

Per [remediation-routing.md](./remediation-routing.md), ambiguous authority means **stop for an
operator decision; do not mutate either side**. The operator decides which authority governs (or
that an authority needs to be created/updated through its owner surface), and only then can a
confirmed repair proceed. See §6 for owner surfaces.

## 5. Normative authority vs observed reality

Every finding records **normative authority** and **observed reality** as separate fields, never
merged:

| Field | What it holds | Example |
|-------|---------------|---------|
| `normative_authority` | The claim as the governing artifact states it ("should") | PRD §3: "no background sync" |
| `observed_reality` | The claim as source/runtime/tests currently show it ("is") | `src/sync.ts` implements background sync |

Keeping them separate is what makes a stale-projection finding legible: the projection says one
thing, the authority another, the code a third — and collapsing them hides the direction of drift.
The conflict surface is the **gap** between normative and observed, not either value alone.

## 6. Owner routing for a resolved authority

Once authority is resolved (not ambiguous), a confirmed repair routes through the owning surface.
This table mirrors [remediation-routing.md](./remediation-routing.md) and ties each owner to the
authority it governs:

| Owner | Repair route | Governs (claim types) |
|-------|--------------|----------------------|
| Task/feature corpus | `sp:spur-cli` / `spur task` / `spur feature`; never direct file writes | Task obligation/status, feature goal and AC |
| Numbered docs and AGENTS projections | `sp:doc-evolve`; authority first, derived projections second | Process rules, structural decision, product scope, architecture, command surface |
| Source/tests | create/use a Spur task and route through `sp:spur-dev` / build competencies | Implementation behavior, architecture mechanism |
| Command/skill capability source | Superskill command/skill lifecycle in the owning plugin source | Command/API/schema surface |
| Ambiguous authority | **stop** for an operator decision; do not mutate either side | (all, when unresolved) |

Never edit a derived projection before its authority. The authority column of §2 is always the
owner surface's source of truth; a projection is brought into line with it, not the reverse.

## 7. Worked examples

### Example A — task AC vs code (planned work vs contradiction)

- Subject: `0486` · Claim type: `Task obligation/status`
- Task `status: todo`, AC not yet implemented in code.
- Rule 3 applies: the difference is **planned work**, not a contradiction.
- Normative: task AC states the obligation. Observed: code lacks the feature.
- Verdict: no conflict (or an informational note), not a `stale`/`contradiction` finding.

### Example B — PRD non-goal vs shipped surface

- Subject: "background sync" · Claim type: `Product scope and non-goals`
- PRD §3: "no background sync" (normative). `src/sync.ts` implements it (observed).
- Rule 2 applies: code is authoritative for *what happens*, PRD for *what should happen*.
- Normative ≠ observed ⇒ gap is a conflict candidate; PRD is the authority, so this is a
  **contradiction** (shipped surface outside scope) unless a later ADR superseded the non-goal.

### Example C — two ADRs, one superseded

- Subject: "sync seam" · Claim type: `Architecture mechanism`
- `docs/00_ADR.md`: ADR-014 decides X; ADR-021 supersedes ADR-014 and decides Y.
- Rule 4 applies: ADR-021 is current authority; ADR-014 is historical evidence.
- Code implementing X is **stale** against the current authority (ADR-021 → Y), not a contradiction
  with ADR-014.

### Example D — incomparable authorities

- Subject: "command surface" · Claim type: `Command/API/schema surface`
- Owning command source and `docs/04_DESIGN.md` disagree, and no ADR/rule orders them, and they are
  not related as authority↔projection.
- Rule 5 applies: **incomparable** ⇒ `needs-authority-decision`, unresolved HITL item, no proposed
  repair, no fabricated winner.

## 8. Related

- Skill entry: [../SKILL.md](../SKILL.md)
- Comparison and clustering: [comparison-protocol.md](./comparison-protocol.md)
- Finding/status schema: [finding-contract.md](./finding-contract.md)
- Owner routing and HITL: [remediation-routing.md](./remediation-routing.md)
- Process authority: `sp:doc-evolve` · Corpus ownership: `sp:spur-cli` · Lifecycle: `sp:spur-dev` ·
  Verification: `sp:code-verification`
