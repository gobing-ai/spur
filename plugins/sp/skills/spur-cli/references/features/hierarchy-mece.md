---
name: feature-hierarchy-mece
description: >-
  Explicit rules for creating new feature nodes or extending existing ones —
  MECE roots, cautious root creation, reparent vs merge, depth limits.
  Consumed by spur feature authoring, /sp:dev-plan, /sp:dev-idea, and
  /sp:dev-feature-change.
see_also:
  - spur-cli
  - feature-verbs
  - feature-roadmap-priority
  - product-planning
---

# Feature hierarchy: MECE roots and extension rules

This is the **normative checklist** before `spur feature create` or any restructure
(`/sp:dev-feature-change`, `spur feature move`). CLI enforces ID shape (DD-14) and
≤9 children; **judgment** here keeps the tree neat for humans and agents.

## Goals of a good tree

| Goal | Meaning |
| --- | --- |
| **MECE at each sibling set** | Mutually Exclusive, Collectively Exhaustive *for the parent’s Goal* — siblings don’t overlap, and together they cover the parent without a “misc” catch-all as a peer of real capabilities. |
| **Sparse roots** | Top-level letters (A, B, …) are **product capabilities or roadmap themes**, not every workstream. Prefer a child under an existing root over a new letter. |
| **Stable IDs** | Never hand-edit IDs. Use `spur feature create --parent` and `spur feature move`. |
| **Tasks hang on leaves (or near-leaves)** | Implementation work is `spur task` with `feature_id`; features stay *why / what-done-looks-like*. |

---

## Decision procedure: new work arrives

Run **in order**. Stop at the first yes.

```text
1. Does an existing feature Goal already own this outcome?
     YES → extend that node (Scope / AC / tasks). Do NOT create a sibling root.
2. Is this a deliverable slice of an existing capability?
     YES → spur feature create "…" --parent <existing-id>
3. Is this a UX/API/schema slice of an existing board or module feature?
     YES → child (or grandchild) of that feature — never a new root letter.
4. Is this only a technical package/endpoint/folder rename?
     YES → prose in Notes / Architecture docs — NOT a feature node.
5. Is this a new product capability or roadmap theme with no home?
     YES → new root (letter) — only after the root gate below passes.
```

**Default bias:** extend or reparent under an existing node. New roots are the exception.

---

## Root gate (new top-level letter)

A new root is allowed only if **all** hold:

1. **Capability, not project.** Names a durable product surface or theme (e.g. Planning, Rules), not a sprint slogan or one PR.
2. **No parent fits.** No existing root’s Goal can absorb it without lying about Scope.
3. **MECE with peers.** It does not restate an existing root under a synonym (e.g. “Agent execution” vs “Agent integration” need *distinct* Goals, not two roots for “agents”).
4. **Expected children.** You can name ≥1 real child slice or a clear multi-release arc; one-off work is a **task** or a **child**, not a root.
5. **Operator confirm** when unsure — prefer AskUserQuestion / decision brief over inventing a letter.

If any check fails → **child of best parent** or **task under existing feature**.

---

## MECE rules (siblings under one parent)

| Rule | Do | Don’t |
| --- | --- | --- |
| **Mutually exclusive** | Sibling Goals partition the parent; overlap goes to one sibling or a shared parent Note. | Two siblings that both “own” the same board tab, CLI noun, or event stream. |
| **Collectively exhaustive** | Parent Scope is covered by children **or** parent-level AC/tasks when no further split is needed. | Parent with one child that is a full copy of the parent Goal. |
| **Same grain** | Siblings at one level are comparable slices (all “CLI surfaces”, all “board modules”). | Mixing “foundation epic”, “one CSS tweak”, and “whole platform” as siblings. |
| **No synonym roots** | One capability → one root; clarify with rename, not a second letter. | `Observability` + `Observabilities board` + `System Events redesign` as three roots. |
| **Done children stay** | Keep `done`/`cancelled` nodes for history; don’t promote their UX polish to new roots. | Spawning a new root for “table redesign of X” when X already has a feature. |

**Smell test:** If two root Goals can be true in the same sentence without “and also”, they may be the same capability.

---

## Extend vs create vs reparent vs merge

| Move | When | How |
| --- | --- | --- |
| **Extend in place** | Scope/AC grows; same Goal | Edit sections; add tasks with `--feature <id>` |
| **Create child** | New deliverable under clear parent | `spur feature create "…" --parent <id>` |
| **Reparent / move** | Node lives under wrong parent; Goal still valid | `spur feature move <id> --parent <new>` (cascade rename) |
| **Rename-only** | Goal OK; title misleading | Prefer `update --field name` if supported, or document + move only if ID depth must change |
| **Merge (absorb)** | Two nodes share one Goal; bodies should be one | Prefer: move children under survivor → fold Scope/AC into survivor → cancel or archive source. **Not** a casual `move`. Use mapping + `/sp:dev-feature-change` when batching. |
| **Archive** | Capability retired | `cancelled` or leave `done`; do not delete history |

---

## Depth and width limits

| Constraint | Guidance |
| --- | --- |
| **DD-14** | Letter root; one digit per level; ≤9 children per parent (`feature check` L3). |
| **Prefer depth ≤ 3** | Root → capability slice → delivery slice (e.g. `F` → `F8` → `F81`). Deeper only when each level has a distinct Goal. |
| **Prefer width ≤ 7** at a level | If you need 8–9 siblings, split themes or introduce an intermediate group feature. |
| **Group tags ≠ hierarchy** | `tags: [group]` marks a theme container; still use real parents for deliverables. Don’t invent roots only to “hold tags”. |

---

## Naming

- **Root:** short capability noun/phrase (`Planning`, `Rules`, `History`).
- **Child:** verb-able outcome under parent (`Feature management CLI`, `Task Kanban web parity`).
- **Avoid:** implementation nouns alone (`packages/app`, `drizzle migration`) unless the product *is* that infrastructure.
- **Avoid:** duplicate “agent / observability / plugin” stems across roots without a written boundary in each Goal.

---

## Positive and negative examples (Spur monorepo)

| Pattern | Example | Verdict |
| --- | --- | --- |
| Board module + UX slice as child | `F8` Features board → `F81` detail action group | **Good** — same product surface, finer grain |
| Restructure tooling under Feature CLI | `F3` Feature management CLI → `F31` restructure kit | **Good** — not a new root letter (was root `S`, moved) |
| Runtime vs plugin harness | `B` Agent execution (`spur agent`) vs `I` sp plugin (`plugins/sp`) | **Keep separate** — B owns runner/process/session/executor behavior; I owns skills, commands, subagents, hooks, and orchestration guidance. H is frozen history. |
| Observability UX as sibling roots | `J` board + `K` System Events table redesign + `L` payload enrichment | **Reparent K,L under J** — not body-merge; not peer roots (audit 0356) |
| Plugin epics as new letters | Historical `N` dev-next UX and `O` token architecture | **Historical move under H is retained; new plugin work goes under I** — do not extend frozen H |
| Workflow observability as board root | `P` workflow run observability as peer of `D` Workflows | **Reparent under D** — object is `spur workflow run`, not board J |
| Planning validation as root | `Q` AC-verifiable gates as peer of `F` Planning | **Reparent under F** |
| Status feedback as root | `R` feature status loop as peer of `F` | **Reparent under F** (corpus status is planning) |
| CLI backbone vs board product | `G` Collaboration (message/team CLI) vs `M` Teams board | **Keep both** — different surfaces; do not merge |
| One-off polish as root | New letter for “fix button loading” | **Bad** — task under existing feature |
| Done plugin epic as root | `I1` sp plugin hands-off ready (`done`) | **Good after reparent** — completed delivery under durable plugin root I |

### Audit 0356 snapshot (A–R dispositions)

Authoritative seed for restructure mapping lives in task 0356 Solution and
`docs/plans/feature-tree-restructure-map.md` (when written). Summary:

| Disposition | Roots |
| --- | --- |
| **keep** | A B C D E F G H I J M |
| **reparent-under:J** | K L |
| **reparent-under:H** | N O |
| **reparent-under:D** | P |
| **reparent-under:F** | Q (→F9; only free F digit) |
| **reparent-under:F8** | R (→F82; F full at 8/9 children — cannot place both Q and R under F) |
| **merge-into** | *(none)* |

**Rejected merges:** B∪H (name-only overlap); J∪K body-merge (use reparent for K/L).

**Ownership amendment (2026-08-11):** audit 0356 is a historical snapshot. The current active
boundary is B = runtime agent execution, I = `sp` plugin harness, H = frozen mixed history. The
applied map is `docs/plans/2026-08-11-sp-plugin-feature-tree-restructure-map.md`; do not place new
work under H.

---

## Checklist: before `spur feature create`

- [ ] Searched `spur feature list` / INDEX for an existing owner Goal.
- [ ] Chose **parent id** (or passed root gate with operator confirm).
- [ ] Sibling set stays MECE at that parent.
- [ ] Name is capability/outcome, not a package path.
- [ ] Will attach tasks with `--feature <new-id>` (or parent if intentionally epic-only).
- [ ] After create: `spur feature refresh --feature <new-id>` if INDEX must update; `spur feature check <new-id>`.

## Checklist: before restructure / `/sp:dev-feature-change`

- [ ] Mapping file lists disposition per node (`keep` / `reparent-under` / `merge-into` / `rename-only` / `archive`).
- [ ] False merges rejected (name overlap ≠ one Goal).
- [ ] Apply via CLI (`spur feature move`, `spur task update --feature`), not raw ID edits.
- [ ] Dry-run reviewed; doc rewrites limited to agreed surface (e.g. root `docs/*.md`).
- [ ] `spur feature refresh --all` + `spur feature check --json` after apply.

---

## Where this is enforced

| Layer | Role |
| --- | --- |
| **This reference** | Agent/human judgment — MECE, root gate, merge vs reparent |
| **`spur feature create/move/check`** | Deterministic DD-14, children limit, lifecycle |
| **`/sp:dev-plan` / `/sp:dev-idea`** | Must run the decision procedure before allocate |
| **`/sp:dev-feature-change`** | Batch restructure against a mapping; must not invent roots |

Agents authoring features **must load this file** (via `sp:spur-cli` features references) before creating a root or proposing merges.
