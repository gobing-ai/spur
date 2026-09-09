---
name: doc-evolve
description: "Evolve docs/00-05 + AGENTS.md per docs/99_PROJECT_CONSTITUTION.md: drift audits, same-commit sync checks, frontmatter-contract verification, lesson-append. Triggers: \"doc evolve\", \"doc drift\", \"sync docs\", \"drift audit\", \"are the docs stale\", \"append a lesson\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.1"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - reviewer
    - inversion
  operations:
    - customize
    - drift-audit
    - sync-check
    - contract-verify
    - lesson-append
  openclaw:
    emoji: "📐"
---

# Spur Doc-Evolve

`sp:doc-evolve` keeps the **key documents** honest: `docs/00_ADR`, `01_PRD`, `02_ROADMAP`,
`03_ARCHITECTURE`, `04_DESIGN`, `05_FEATURES`, the `99_PROJECT_CONSTITUTION`, and the root
`AGENTS.md`. It is a **constitution-native** driver — every operation enforces a rule that already
lives in `docs/99_PROJECT_CONSTITUTION.md`, and every proposed edit cites the section it enforces.
It is *not* a generic doc generator and it does not invent process: the constitution is the law;
this skill applies it.

**Read `docs/99_PROJECT_CONSTITUTION.md` first.** It is the single source of truth for *how* these
files are maintained (authority §2, doc map §4.1, frontmatter contracts §4.3, sync triggers §5,
per-file edit rules §6, the audit §7, lesson routing §8). This skill is a runbook for executing §5/§7/§8;
when the two disagree, the constitution wins and this skill is the bug.

## Operations

| Operation | What it does | Constitution authority | Deterministic helper |
| --------- | ------------ | ---------------------- | -------------------- |
| **drift-audit** | Reality (code/shipped) vs. what a key file says, and cross-doc contradictions | §7 | `rg` the real CLI/config surface; diff vs `04`/`AGENTS.md`/`00` |
| **sync-check** | Did a change touch the docs its trigger obligates in the same commit? | §5 (applicable triggers) | git diff of code/config vs. the matching doc edit |
| **contract-verify** | Each doc's frontmatter matches its §4.1 row; `updated_at` is plausible | §4.3 | parse frontmatter; compare `owns`/`authority` vs §4.1; `git log` recency |
| **lesson-append** | Record a useful lesson in existing project context; deduplicate; propose governance changes separately | §8 | format-check the line; `rg` for an equivalent before adding |

No thin `dev-docs` command wrapper exists (`dev-operations.md §7`). Invoke this skill directly for
an audit or a lesson, or reach it via `/sp:dev-plan`'s docs step and `/sp:spur-init`'s `customize`.

## Operating principle (R2): detect deterministically, judge with the LLM

Split every operation into a **deterministic detection** half and a **judgment** half:

- **Detection** is `rg` / `git` / `spur` CLI / frontmatter parsing — it finds candidate drift
  mechanically and is the part that must not hallucinate (a missed surface or a phantom finding
  both erode trust). Prefer a command that lists facts over prose that asserts them.
- **Judgment** is the LLM deciding whether a candidate is real drift, which doc is authoritative,
  and what the minimal repair is. This is where the skill earns its keep.

Never assert "the docs are in sync" from reading alone — run the detection commands and show their
output. A zero-finding audit must be backed by the commands that produced zero.

## customize

**Purpose:** Customize a freshly-initialized Spur project's doc templates to match the
project's actual stack and scope. Invoked by `sp:spur-init` after scaffolding.

**Procedure:**
1. Read the project's `package.json`, `tsconfig.json`, `biome.json`, and any existing config.
2. Read each doc in `docs/00`–`05` for any remaining template markers.
3. For **`AGENTS.md`**, use the **`{kebab-case}`** token scheme only (task 0242). Do **not** use
   `{{ MUSTACHE }}` for AGENTS:
   - `{project-name}` / `{project-description}` — already filled by `spur init` when scaffolding a
     fresh file; do not leave these braces after customize.
   - Project-specific body slots (`## Stack & layout`, build commands, conventions) use HTML
     comments + human stubs in the **bundled AGENTS seed** (spur init template) — replace those
     stubs with stack/layout and lint/test/build commands detected from the project manifests.
4. Keep portable harness sections aligned with the bundled AGENTS seed (H2 set + Harness tool
   routing Need keys — see `apps/cli/tests/fixtures/agents-md-portable-contract.ts`).

**Done when:** no residual `{project-name}` / `{project-description}` in AGENTS.md; stack/build
stubs filled or deliberately documented; `bun run lint` passes where applicable.

## drift-audit (§7)

Walk the §7 checklist. Each item pairs a detection command with the doc it validates:

```bash
# Real CLI surface vs. owning non-UI contracts
rg -n "\.command\('" apps/cli/src/commands/        # the true verb list
rg -n '^#### `spur ' docs/design/             # documented commands
# → diff the two sets; a verb in code but not in 04 is T3 drift.

# 05 status rows vs. reality
cat docs/features/INDEX.md                         # generated feature states
# → spot-check each ✅/🔶 against code; confirm no ⏳ quietly shipped.

# 02 phase bullets name real things (no dead names)
# 03 module descriptions vs. the real tree
rg --files apps packages                       # real modules
# Frontmatter contracts (see contract-verify) + updated_at recency
git log -1 --format='%ci' -- docs/04_DESIGN.md     # last touch vs. recent surface changes
```

**Repair protocol (§7):** fix the authoritative statement first, then affected detail/index/entry
files. Preserve ADR numbers, original titles/dates and decision history; editorial condensation
follows §6.1, while actual reversals need a superseding decision. Record findings in a task/report.
Routine lessons go to existing learning/context storage (§8); no automatic constitution edits.

Output a **drift report**: per finding, `{ doc, what code says, what the doc says, authority, repair
}`. A clean report lists the checks run and that each returned no delta.

## sync-check (§5)

Read the live constitution §5; it owns the trigger table. Classify each changed fact, identify
its owner, and inspect the diff to confirm required synchronization. Update an index or AGENTS.md
only when its own facts changed. A satellite edit with an unchanged index pointer is synchronized.

T1 applies only to real architectural choices passing §6.1. Feature approvals, task completion,
bugfixes restoring an existing contract and verification receipts do not justify ADR entries.
T7 applies only to operator-authorized governance corrections under §6.8; a routine doc edit or
lesson does not justify touching the constitution. Portable changes include in-scope init templates.

## contract-verify (§4.3)

For each key doc, confirm its YAML frontmatter is the instantiated §4.1 row:

- `owns` / `authority` match the §4.1 table **verbatim in meaning** (on mismatch, §4.1 wins).
- `edit_rules` points to the owning §6 subsection (a pointer, never restated prose).
- `updated_at` is not older than a change it should reflect (cross-check `git log`).

This is mostly mechanical (parse + compare); the judgment is only "is this `updated_at` plausibly
stale given recent commits?"

## lesson-append (§8)

Read constitution §8 for the existing project's destination. Record a useful, deduplicated
lesson in existing learning/context storage or a dated report, with evidence. Do not append
lessons to the constitution. Do not create a second learning ledger when one already exists.

A recurring lesson may justify proposing a document-governance correction; apply it only within
operator-authorized §6.8 scope. Task receipts remain in task records. Fresh project templates
contain neither inherited lessons nor fabricated decisions/status claims.

## What this skill is NOT

- **Not a doc generator** — it doesn't author new prose from nothing; it audits, syncs, and repairs
  against the constitution.
- **Not the authority** — it never overrides `00`/`01`/§2; on any conflict the authoritative doc
  wins and the skill defers.
- **Not a generic doc tool** — this is constitution-native (every operation cites a §). Behaviors
  without constitution backing are intentionally absent.

## References

| Reference | Covers |
| --------- | ------ |
| [references/operations.md](references/operations.md) | The mini-spec: each operation's detection commands, the §-mapping table, and the drift-report shape |

## See also

- **`docs/99_PROJECT_CONSTITUTION.md`** — the law this skill enforces. Always the tiebreaker.
- **`dev-operations.md §7`** — the `docs` operation entry (no thin command wrapper; invoke this skill directly).
