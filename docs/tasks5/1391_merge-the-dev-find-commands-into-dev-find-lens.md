---
schema_version: 1
name: Merge the dev-find-* commands into dev-find <lens>
status: done
template: feature-impl
created_at: 2026-11-18T05:29:31.773Z
updated_at: "2026-11-18T20:39:08.852Z"
feature_id: H84
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 3

done_forced: "false"
done_reason: unforced close
---

## 1391. Merge the dev-find-* commands into dev-find <lens>

### Background

`dev-find-conflict` (→ `sp:conflict-finding`), `dev-find-issue` (→ `sp:history-anatomy`), `dev-find-next` (→ `sp:next-feature`) and `dev-find-way` (→ `sp:wayfinder`) each pass `$ARGUMENTS` to one skill.

**Refine corrections (2026-11-17)**
- "differ only by the skill they dispatch" → their argument contracts are disjoint, and `--mode` is a homonym: `--mode <adaptive|full>` for conflict and `--mode <daily|ad-hoc>` for issue. `dev-find-way` also owns command-level worktree isolation (`dev-find-way.md:76-80`), not just a skill call. → `dev-find <lens> …` passes the remaining arguments verbatim to the lens skill, which keeps validating its own flags. The lens table carries the `way` worktree preamble. The argument-hint lists flags per lens.
- Auto-invocation relies on each command's `description` trigger phrases → the merged description must carry the union of the four trigger sets, or agents stop finding the lenses.
- The feature's out-of-scope line excludes "merging commands whose contracts differ beyond batch scope" → this merge is allowed only as a pure routing shell. Per-lens contracts stay owned by their skills, unchanged.

### Requirements

- [x] R1. Add `plugins/sp/commands/dev-find.md` with a required `<conflict|issue|next|way>` lens, mapping to `sp:conflict-finding`, `sp:history-anatomy`, `sp:next-feature` and `sp:wayfinder`. The remaining args pass verbatim. An unknown or missing lens prints the lens table and stops.
- [x] R2. The `way` lens keeps `dev-find-way`'s worktree lifecycle and `--wrap` behavior exactly. The other lenses dispatch inline as before.
- [x] R3. The description carries the union of the four trigger-phrase sets. The argument-hint groups flags by lens, and the `dev-operations.md` row matches it for `command-flag-parity`.
- [x] R4. The four old files become one-release redirects that name `dev-find <lens>` and dispatch identically.
- [x] R5. Update AGENTS.md routing, `plugins/sp/README.md`, init templates and prose references. The parity suites and `bun run plugin-smoke` pass.

### Acceptance Criteria

- [x] AC1 — One dev-find command routes by lens (req: R1, R2, R3)
- [x] AC2 — Former command names redirect for one release (req: R4, R5)

Test layer: plugin parity suites over the real command files.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:55:08.006Z

- **Unify `--mode` across lenses?** Closed: no. Args pass verbatim and each skill validates its own.
- **Keep `dev-find-way` separate because of its worktree contract?** Closed: merged, with the preamble moved into the `way` lens row unchanged.

### Design

**WHAT.**

| Lens | Skill | Preamble |
| --- | --- | --- |
| conflict | `sp:conflict-finding` | none |
| issue | `sp:history-anatomy` | none |
| next | `sp:next-feature` | none |
| way | `sp:wayfinder` | worktree lifecycle from `dev-find-way.md` (moved verbatim) |

Dispatch: `Skill(skill="<lens skill>", args="<ARGUMENTS minus lens>")`.

**WHY.** One command entry with a routing table. Flag validation stays in the skills, which already own it, so the `--mode` homonym is harmless: each lens skill sees only its own args.

**WHERE.** `plugins/sp/commands/dev-find.md` (new), `dev-find-{conflict,issue,next,way}.md` (redirects), `plugins/sp/skills/spur-dev/references/dev-operations.md`, AGENTS.md, `config/templates/AGENTS.md` and `plugins/sp/README.md`.

**Anti-patterns.** Don't unify the lens flags. Don't drop the `way` worktree preamble. Don't edit the four skills.

### Plan

- [ ] Step 1 (test first, R1/R3): add `command-flag-parity` and `help-docs-parity` cases for `dev-find`.
- [ ] Step 2 (R1/R2/R3): write `dev-find.md` with the lens table and the moved `way` preamble.
- [ ] Step 3 (R4): write the redirects.
- [ ] Step 4 (R5): migrate docs and prose.
- [ ] Step 5: run the plugin parity tests, `bun run plugin-smoke`, then `bun run spur-check`.

### Solution

| File | Lines | What/Why |
| --- | --- | --- |
| `plugins/sp/commands/dev-find.md` | 1-95 | R1/R2/R3: new routing shell — required `<conflict\|issue\|next\|way>` lens, a lens→skill table, args forwarded verbatim minus the lens, unknown/missing lens prints the table and stops without dispatching; the `way` worktree preamble moved verbatim (`execution-batch.md` § Worktree isolation, one-ticket-per-session, `--wrap` before WT-3b); description carries the union of all four trigger sets so agents still find the lenses; the hint groups flags per lens and the Argument Flags table covers every positional and flag. |
| `plugins/sp/commands/dev-find-{conflict,issue,next,way}.md` | banner + `Redirect dispatch` bullet | R4: one-release redirects — each announces the deprecation, names `/sp:dev-find <lens>`, and dispatches it with the lens prepended and every other argument passed through. Their own flag tables stay (they forward exactly those flags), which keeps hint↔row parity and the glossary declarer lists honest during the overlap. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | 89-90 | R3: numbered row `12b find` whose flag cell mirrors the hint; row `12a find-way` marks the redirect. |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | `--pillar`, `--recompute`, `--resolve` entries; declarer lists for `--scope`, `--tasks`, `--task`, `--output`, `--worktree` | The three lens-only flags now have canonical entries (they became shared when `dev-find` declared them); the five declarer lists gained `dev-find`. |
| `plugins/sp/references/roles.md` | 65 | `dev-find` maps to `planner`: it is a routing shell, and two of its four lenses (wayfinder, next-feature) already sit in that role; the four redirect files keep their own rows. |
| `plugins/sp/README.md` | 103, 146-149 | R5: `dev-find` documented with its four lenses; the four redirect rows restored by file name (R43 indexes shipped files) and labelled as redirects. |
| `plugins/sp/skills/**` (20 files), `docs/help/**`, `docs/design/*` | — | R5: prose migration to the lens spelling — conflict-finding, issue-finding, wayfinder, brainstorm, next-feature, `spur-dev` references and the help pages now say `/sp:dev-find <lens>`. |
| `config/templates/AGENTS.md` | 170 | R5: the long-tail list names `find (lenses: conflict, issue, next, way)`. |
| `plugins/sp/tests/command-flag-parity.test.ts` | new block | R1/R2/R3/R4 coverage: four lenses mapped to their skills, unknown-lens stop, the moved `way` preamble present in both files, twelve trigger phrases, and each redirect naming plus dispatching its lens. |
| `plugins/sp/tests/{skill-structure,runtime-requires}.test.ts`, `scripts/commands/command-contract.test.ts` | counts | 44 command files / 90 entities / 71 `cli:spur,local-fs`; R51 asserts the merged spelling; the C1/C2 real-tree gate reports 0 violations. |

Public-surface probe: no new CLI/HTTP route. One command added (`dev-find`), four become redirects, the four lens skills and their flags are untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 `dev-find` with a required lens, four skills, verbatim args, unknown/missing lens stops | MET | static-ref: `plugins/sp/commands/dev-find.md:5` (hint), `:50-60` (usage + lens table), `:64-78` (dispatch per lens + the stop rule); test: `plugins/sp/tests/command-flag-parity.test.ts` § 1391 R1 |
| R2 the `way` lens keeps the worktree lifecycle and `--wrap` behavior verbatim | MET | static-ref: `plugins/sp/commands/dev-find.md:75-78` (three moved lines), still present in `dev-find-way.md:78-80`; test: `command-flag-parity` § 1391 R2 asserts both files |
| R3 description trigger union, hint grouped by lens, `dev-operations.md` row matches | MET | static-ref: `dev-find.md:2` (twelve trigger phrases), `:5` (`conflict:`/`issue:`/`next:`/`way:` groups), `dev-operations.md:90` (row 12b, flag cell = hint); test: `command-flag-parity` § 1391 R3 + R8 hint↔row parity for `dev-find` |
| R4 four old files are one-release redirects naming `dev-find <lens>` and dispatching identically | MET | static-ref: `dev-find-{conflict,issue,next,way}.md` banner + `Redirect dispatch` bullet (`/sp:dev-find <lens> $ARGUMENTS`); test: `command-flag-parity` § 1391 R4 |
| R5 AGENTS.md routing, README, templates, prose; parity suites + plugin-smoke | MET | static-ref: `plugins/sp/README.md:103,146-149`, `config/templates/AGENTS.md:170`, 20 prose files (skills/help/design); test: `plugins/sp` + `scripts/commands` 1,766 pass, `bun run plugin-smoke` PASS, `flag-contract-parity` real-tree 0 violations |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 one `dev-find` command routes by lens (R1, R2, R3) | MET | test | `command-flag-parity` § 1391 R1/R2/R3; `dev-operations.md` row 12b parity |
| AC2 former names redirect for one release (R4, R5) | MET | test | `command-flag-parity` § 1391 R4; `scripts/commands` heading/frontmatter/thin-wrapper over 44 commands; README R43 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of run a7b9971d — verdict tables (merged fragments, backfill bare only).

| Req | Status | Evidence |
| --- | --- | --- |
| R1 `dev-find` lens router; verbatim args; unknown lens stops | MET | static-ref: `plugins/sp/commands/dev-find.md:5,50-60,64-78`; test: `command-flag-parity` § 1391 R1 |
| R2 `way` lens keeps worktree lifecycle + `--wrap` verbatim | MET | static-ref: `plugins/sp/commands/dev-find.md:75-78`, `dev-find-way.md:78-80`; test: § 1391 R2 |
| R3 trigger union, lens-grouped hint, matching ops row | MET | static-ref: `dev-find.md:2,5`, `dev-operations.md:90`; test: § 1391 R3 + R8 parity |
| R4 four one-release redirects naming the lens | MET | static-ref: `dev-find-{conflict,issue,next,way}.md` banner + dispatch bullet; test: § 1391 R4 |
| R5 prose migration + parity + plugin-smoke | MET | static-ref: `plugins/sp/README.md:103,146-149`, `config/templates/AGENTS.md:170`, 20 prose files; test: 1766 pass, plugin-smoke PASS, real-tree 0 violations |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 one command routes by lens | MET | test | `command-flag-parity` § 1391 R1/R2/R3; ops row 12b parity |
| AC2 former names redirect for one release | MET | test | § 1391 R4; `scripts/commands` contract over 44 commands; README R43 |

P3 accepted: `--mode` stays a per-lens homonym (documented, never unified — each skill validates its own args). P3 accepted by task instruction: the conflict-finding skill's finding-envelope example keeps `"command": "dev-find-conflict"` because editing the four lens skills is an explicit anti-pattern. P4: README lists both the merged command and the four redirect files (R43 indexes shipped files). No P1/P2.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T20:28:01.237Z todo → wip (system)
- 2026-11-18T20:39:07.001Z wip → testing (system)
- 2026-11-18T20:39:08.847Z testing → done (system)

