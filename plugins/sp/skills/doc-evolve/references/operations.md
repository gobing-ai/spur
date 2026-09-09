---
name: doc-evolve-operations
description: The doc-evolve mini-spec — each operation's detection commands, constitution-section mapping, and the drift-report shape.
see_also:
  - doc-evolve
---

# doc-evolve — operations mini-spec

The skill's contract. Each operation = a **detection** half (deterministic, must not hallucinate)
+ a **judgment** half (LLM). Every operation maps to the `docs/99_PROJECT_CONSTITUTION.md` section
it enforces; the skill never invents process.

## §-mapping (the authority table)

| Operation | Authority § | What "done" means |
| --------- | ----------- | ----------------- |
| drift-audit | §7 | the affected §7 checks run, each backed by a command; report lists deltas (or the zero-delta commands) |
| sync-check | §5 (applicable §5 triggers) | every changed surface mapped to its trigger; the obligated doc confirmed edited in the same change |
| contract-verify | §4.3 (+ §4.1) | each doc's frontmatter `owns`/`authority` matches its §4.1 row; `updated_at` plausible |
| lesson-append | §8 | a deduplicated lesson in existing learning/context storage, never appended to 99 |

## drift-audit — §7 checklist → detection commands

| §7 item | Detection (deterministic) | Authoritative doc |
| ------- | ------------------------- | ----------------- |
| Real CLI surface vs docs | Compare source-local help/registrations with owning `docs/design/` contracts | `04` satellites |
| Feature state matches evidence | Read the feature tool's generated index, then inspect affected acceptance evidence | `05` / feature records |
| Every shipped surface has a `01` scope row | surface set (above) vs `rg` of `01` scope table | `01` |
| `02` phase bullets name real things | read `02` current-phase bullets; grep each name in code/docs | `02` |
| `03` modules vs real tree | `rg --files apps packages` vs `03` module map | `03` |
| `04` covers every command/flag/config/schema | the verb/flag/config set vs `04` | `04` |
| `AGENTS.md` doc map == §4.1 | diff the two tables | `AGENTS.md` (§4.4) |
| frontmatter matches §4.1 + `updated_at` plausible | see contract-verify | each doc (§4.3) |

**Judgment:** is a candidate real drift (vs. an intentional, documented exception)? Which doc is
authoritative? What is the *minimal* repair (preserve decision history and condense only editorial noise under §6.1)?

## sync-check — applicable §5 triggers → obligations

Read the diff and the live constitution §5. Map changed facts to their owning document and
check that contract, not merely whether a filename appears in the diff. Unchanged index pointers
and entry guidance need no edits. T7 additionally requires the governance reason and existing
operator authorization under §6.8; include affected templates.

## contract-verify — §4.3

```bash
# Each key doc's frontmatter block
for d in docs/0*_*.md docs/99_*.md; do rg -n '^(owns|authority|edit_rules|updated_at):' "$d"; done
# updated_at recency vs last commit that touched the doc
git log -1 --format='%ci' -- docs/04_DESIGN.md
```

Compare `owns`/`authority` against the §4.1 row (verbatim in meaning; §4.1 wins on mismatch).
`edit_rules` must be a pointer to a §6 subsection, never restated prose.

## lesson-append — §8

1. Resolve the existing learning/context destination from the project's conventions.
2. Search for an equivalent lesson; skip duplicates and routine completion receipts.
3. Record the useful lesson with evidence outside the constitution.
4. Propose any governance correction separately; recurrence does not authorize a §6.8 edit.

## Drift-report shape

```
## Drift report — <date>

Checks run: <n> (§7 items)  ·  Findings: <m>

| # | Doc | Reality says | Doc says | Authority | Trigger | Repair |
|---|-----|--------------|----------|-----------|---------|--------|
| 1 | 04_DESIGN | Changed command contract | Satellite describes old behavior | 04 | T3 | update its owning satellite under §6.5 |

Zero-finding checks: <list the §7 items that returned no delta, with the command used>
```

A zero-finding audit is only credible if it shows the commands that produced zero — never assert
"in sync" from reading alone (the skill's anti-hallucination posture, R2).
