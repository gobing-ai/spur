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
| drift-audit | §7 | the 8-item §7 checklist run, each backed by a command; report lists deltas (or the zero-delta commands) |
| sync-check | §5 (T1–T8) | every changed surface mapped to its trigger; the obligated doc confirmed edited in the same change |
| contract-verify | §4.3 (+ §4.1) | each doc's frontmatter `owns`/`authority` matches its §4.1 row; `updated_at` plausible |
| lesson-append | §8 | a dedup'd, correctly-formatted dated line in the right per-file section |

## drift-audit — §7 checklist → detection commands

| §7 item | Detection (deterministic) | Authoritative doc |
| ------- | ------------------------- | ----------------- |
| Real CLI surface vs docs | `rg -n "\.command\('" apps/cli/src/commands/` vs `rg -n '^#### \`spur ' docs/04_DESIGN.md` | `04` + `AGENTS.md` surface, `00` committed-surface |
| `05` ✅/🔶 spot-check; no ⏳ quietly shipped | `rg -n '✅\|🔶\|⏳\|💤' docs/05_FEATURES.md`, then check each against code | `05` |
| Every shipped surface has a `01` scope row | surface set (above) vs `rg` of `01` scope table | `01` |
| `02` phase bullets name real things | read `02` current-phase bullets; grep each name in code/docs | `02` |
| `03` modules vs real tree | `fd -t d -d 2 . apps packages` vs `03` module list | `03` |
| `04` covers every command/flag/config/schema | the verb/flag/config set vs `04` | `04` |
| `AGENTS.md` doc map == §4.1 | diff the two tables | `AGENTS.md` (§4.4) |
| frontmatter matches §4.1 + `updated_at` plausible | see contract-verify | each doc (§4.3) |

**Judgment:** is a candidate real drift (vs. an intentional, documented exception)? Which doc is
authoritative? What is the *minimal* repair (a one-line dated amendment beats a rewrite)?

## sync-check — T1–T8 → obligations

Read the change (diff or finished task); for each changed path classify the trigger and confirm the
obligated doc was touched in the same change. The high-frequency miss is **T3** (a CLI/config/schema
change without the matching `04` + `AGENTS.md` edit) — check it first. (T1–T8 listed in the SKILL.md
table; this reference is the detection recipe, not a restatement of the triggers.)

```bash
# Surface changed in this diff?
git diff --name-only | rg 'apps/cli/src/commands/|packages/.*/schema|config/'
# Was 04 / AGENTS.md touched in the same diff?
git diff --name-only | rg 'docs/04_DESIGN.md|^AGENTS.md'
# Both non-empty → likely synced; surface-changed-but-no-04 → T3 drift.
```

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

```
- [YYYY-MM-DD] <project>: <lesson — what went wrong / what to do instead>
```

1. Identify the per-file `### Lessons for <doc>` section (or the cross-cutting one).
2. `rg` that section for an equivalent lesson — if found, **bump its date**, don't duplicate.
3. Append the formatted line. If the lesson restates an existing §6 rule, it's already law — skip.
4. If it has recurred, **promote** it to a §6 rule / §5 trigger and remove from §8 (the only
   sanctioned deletion).

## Drift-report shape

```
## Drift report — <date>

Checks run: <n> (§7 items)  ·  Findings: <m>

| # | Doc | Reality says | Doc says | Authority | Trigger | Repair |
|---|-----|--------------|----------|-----------|---------|--------|
| 1 | 04_DESIGN | `spur foo` exists (apps/cli/.../foo.ts) | absent | 04 (T3) | — | add the §6.4 command block |

Zero-finding checks: <list the §7 items that returned no delta, with the command used>
```

A zero-finding audit is only credible if it shows the commands that produced zero — never assert
"in sync" from reading alone (the skill's anti-hallucination posture, R2).
