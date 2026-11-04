---
schema_version: 1
name: sp skill guidance and docs for semantic-first search with rg fallback
status: done
template: feature-impl
created_at: 2026-11-03T16:50:38.254Z
updated_at: "2026-11-03T22:07:49.065Z"
feature_id: A34
priority: P3
tags:
  - search
  - skills
  - docs

dependencies: ["1286"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1288-verdict.json
---

## 1288. sp skill guidance and docs for semantic-first search with rg fallback

### Background

Feature A34 guidance and docs. Covers R10, R11. The four sp skills that locate workspace context should prefer semantic search when zg is available and keep rg for exact lookups; Spur docs point to zg (`zg install`) for agent integrations instead of registering them. Depends on 1286 (the `spur self search` verb must exist before guidance cites it). Design: docs/design/hybrid-search.md §4 Skills (ADR-147).

### Requirements

- [x] R10. sp skills prefer semantic search with rg fallback.
- [x] R11. Agent integrations stay owned by zg.

### Acceptance Criteria

- [x] AC1 — sp skills prefer semantic search with rg fallback
- [x] AC2 — Agent integrations stay owned by zg

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-03T17:16:20.292Z

- Q: Which skills? A: exactly `sp:reverse-engineering`, `sp:issue-finding`, `sp:conflict-finding`, `sp:wayfinder`. Others stay unchanged.
- Q: Which semantic entry point do skills cite? A: zg MCP tool (`zvec_grep_search`) when the host exposes it, else `spur self search --mode fuzzy --json`; literal/exhaustive lookups and zg-absent → `rg`.
- Q: Hooks or auto-calls? A: no — guidance text only; plugin standalone contract untouched.
- Q: Who registers agent integrations? A: zg (`zg install`); Spur docs only point to it.

### Design

Edits (text only):
- `plugins/sp/skills/{reverse-engineering,issue-finding,conflict-finding,wayfinder}/SKILL.md`: add one short "Search routing" block (≤ 6 lines, same wording in all four): concept / cross-file / "how does X work" → semantic first (zg MCP tool, or `spur self search "<q>" --mode fuzzy --json`) when available; literal, symbol, regex or exhaustive occurrence lists → `rg`; zg absent or `skipped` reason in the response → `rg`. Place it where each skill already describes discovery/search; do not restructure.
- `README.md` "Optional backends and services" table (~line 243): add a `zg` row — purpose "semantic search for `spur self search` / Board Search", install `bun add -g @zvec/zvec-grep`, index `zg index --embedding local/potion-code-16m-v2`, "optional; exact search works without it".
- `docs/help/how_to_use_spur_for_daily_software_development.md` §Prerequisites (line ~38): one optional bullet for zg with the same two commands and a note that `zg install` (zg-owned) wires agent integrations.
- `docs/help/cmd_init.md`: note the `.zvec-grep/` gitignore entry and readiness line (coordinate wording with 1289).
- `docs/design/hybrid-search.md`: flip `status: proposed` → `implemented` only after 1285–1287 and 1289 are done (else leave proposed and note it in Solution).

Rejected: hooks auto-calling zg; running `zg install` from Spur; rewriting skill structure.
Invariants: no code in `plugins/sp` changes; superskill regenerates adapters — never hand-edit generated per-platform files.

### Plan

1. Edit the four SKILL.md files with the identical routing block.
2. Update README optional-backends row, daily-dev prerequisites, cmd_init note.
3. `superskill skill validate plugins/sp/skills/<name>` for each of the four (check `superskill skill --help` for the exact leaf); `bun run plugin-smoke`.
4. `rg -n "spur self search" plugins/sp/skills README.md docs/help` as the repeatable artifact proving coverage.
5. `bun run spur-check`.

### Solution

Text-only edits, no code in `plugins/sp`:

- **Identical routing block in all four skills** (same wording, ≤6 lines, placed where each skill already describes discovery/search; structure untouched):
  - `plugins/sp/skills/reverse-engineering/SKILL.md:144` — after the Phase 2 Index numbered list, before Phase 3.
  - `plugins/sp/skills/issue-finding/SKILL.md:370` — after the Required Permissions table, before Platform Notes.
  - `plugins/sp/skills/conflict-finding/SKILL.md:237` — after the Required Permissions table, before Platform Notes.
  - `plugins/sp/skills/wayfinder/SKILL.md:145` — after the ticket-type resolution table (research/fact-finding context), same indent level.
- **README.md:253** — new `zg` row in "Optional backends and services": optional install (`bun add -g @zvec/zvec-grep`), index command (`zg index --embedding local/potion-code-16m-v2`), purpose (semantic search for `spur self search` / Board Search), `zg install` (zg-owned) wires agent integrations, exact search works without it. Package name verified against the local install (`bun pm ls -g` → `@zvec/zvec-grep@0.2.2`).
- **docs/help/how_to_use_spur_for_daily_software_development.md** §Prerequisites — one optional zg bullet with the same two commands and the `zg install` ownership note.
- **docs/help/cmd_init.md** — "zg readiness" note under What It Creates: init appends `.zvec-grep/` to `.gitignore` when absent and prints an informational readiness line; probe failure → `index: 'unknown'`, exit code unchanged. Wording coordinated with task 1289's design (which implements the init behavior).
- **docs/design/hybrid-search.md** — `status: proposed` left as-is per design ("flip only after 1285–1287 and 1289 are done"; 1289 still pending); to be flipped by 1289 or at batch wrap.

Rejected alternatives kept per task Q&A: no hooks, no auto-calls, no generated-adapter edits.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R10 | MET | plugins/sp/skills/reverse-engineering/SKILL.md:144, plugins/sp/skills/issue-finding/SKILL.md:370, plugins/sp/skills/conflict-finding/SKILL.md:237, plugins/sp/skills/wayfinder/SKILL.md:145 identical Search-routing block; budget test plugins/sp/tests/skill-structure.test.ts:937 |
| R11 | MET | README.md:253 zg-owned install note; docs/help/how_to_use_spur_for_daily_software_development.md:42 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R10 — sp skills prefer semantic search with rg fallback | MET | test | plugins/sp/tests/skill-structure.test.ts:937; skill-structure suite 95 pass / 0 fail (2026-11-03) |
| R11 — Agent integrations stay owned by zg | MET | command | rg -n "zg install" README.md docs/help → README.md:253 and docs/help/how_to_use_spur_for_daily_software_development.md:42 (2026-11-03) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | none | — |
| P2 | none | — |
| P3 | none | — |
| P4 | pre-existing, out of scope: `superskill skill validate` wayfinder `_links` broken body link `(<WBS> <title>)(path)` — reproduced on the base tree via `git stash` (plugins/sp/skills/wayfinder/SKILL.md template placeholder), unchanged by this task | accepted (pre-existing template-placeholder warning, not introduced or worsened by 1288; recorded for future wayfinder template cleanup) |

Residual risk: none material — text-only change; `docs/help/cmd_init.md` describes init behavior delivered by task 1289 later in this batch (design-coordinated wording, both land in the same merge).

Confidence: HIGH

Verdict: PASS

### References

- Feature: docs/features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md (R10, R11)
- Design: docs/design/hybrid-search.md §4 Skills; ADR-147
- Depends on: 1286
- Targets: plugins/sp/skills/{reverse-engineering,issue-finding,conflict-finding,wayfinder}/SKILL.md, README.md:243, docs/help/how_to_use_spur_for_daily_software_development.md:38, docs/help/cmd_init.md

### History

- 2026-11-03T17:06:32.825Z feature_id Q → A34 (system)
- 2026-11-03T19:36:59.972Z todo → wip (system)
- 2026-11-03T19:56:54.198Z wip → testing (system)
- 2026-11-03T19:56:54.199Z testing → done (system)
- 2026-11-03T19:57:12.908Z done → testing (system)
- 2026-11-03T20:19:39.830Z testing → done (system)

