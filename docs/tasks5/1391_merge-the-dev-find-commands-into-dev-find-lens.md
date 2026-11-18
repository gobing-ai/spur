---
schema_version: 1
name: Merge the dev-find-* commands into dev-find <lens>
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:31.773Z
updated_at: "2026-11-18T05:55:08.950Z"
feature_id: H84
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 3

---

## 1391. Merge the dev-find-* commands into dev-find <lens>

### Background

`dev-find-conflict` (→ `sp:conflict-finding`), `dev-find-issue` (→ `sp:history-anatomy`), `dev-find-next` (→ `sp:next-feature`) and `dev-find-way` (→ `sp:wayfinder`) each pass `$ARGUMENTS` to one skill.

**Refine corrections (2026-11-17)**
- "differ only by the skill they dispatch" → their argument contracts are disjoint, and `--mode` is a homonym: `--mode <adaptive|full>` for conflict and `--mode <daily|ad-hoc>` for issue. `dev-find-way` also owns command-level worktree isolation (`dev-find-way.md:76-80`), not just a skill call. → `dev-find <lens> …` passes the remaining arguments verbatim to the lens skill, which keeps validating its own flags. The lens table carries the `way` worktree preamble. The argument-hint lists flags per lens.
- Auto-invocation relies on each command's `description` trigger phrases → the merged description must carry the union of the four trigger sets, or agents stop finding the lenses.
- The feature's out-of-scope line excludes "merging commands whose contracts differ beyond batch scope" → this merge is allowed only as a pure routing shell. Per-lens contracts stay owned by their skills, unchanged.

### Requirements

- [ ] R1. Add `plugins/sp/commands/dev-find.md` with a required `<conflict|issue|next|way>` lens, mapping to `sp:conflict-finding`, `sp:history-anatomy`, `sp:next-feature` and `sp:wayfinder`. The remaining args pass verbatim. An unknown or missing lens prints the lens table and stops.
- [ ] R2. The `way` lens keeps `dev-find-way`'s worktree lifecycle and `--wrap` behavior exactly. The other lenses dispatch inline as before.
- [ ] R3. The description carries the union of the four trigger-phrase sets. The argument-hint groups flags by lens, and the `dev-operations.md` row matches it for `command-flag-parity`.
- [ ] R4. The four old files become one-release redirects that name `dev-find <lens>` and dispatch identically.
- [ ] R5. Update AGENTS.md routing, `plugins/sp/README.md`, init templates and prose references. The parity suites and `bun run plugin-smoke` pass.

### Acceptance Criteria

- [ ] AC1 — One dev-find command routes by lens (req: R1, R2, R3)
- [ ] AC2 — Former command names redirect for one release (req: R4, R5)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
