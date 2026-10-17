---
schema_version: 1
name: Point sp plugin gate guidance at spur self exec
status: todo
template: feature-impl
created_at: 2026-10-17T04:04:39.233Z
updated_at: "2026-10-17T04:16:48.944Z"
feature_id: A92
priority: P2
tags:
  - plugin
  - docs
estimate_hours: 2

dependencies: ["1223", "1226"]
---

## 1227. Point sp plugin gate guidance at spur self exec

### Background

Feature A92 (docs/design/sdlc-actions.md §3.4 plugin row). About 22 sp plugin markdown files instruct agents to run `bun run spur-check`, `bun run lint` or `bun run gate`. Covers R10.

**Refine corrections (2026-10-16)**
- Said ~22 plugin files → `rg -l 'bun run (spur-check|lint|gate)\b' plugins/sp` returns 25 → requirements cover the full list from that query, not a fixed count.
- Assumed `superskill install sp --dry-run` exists → confirmed (`superskill install --help`: `--dry-run`).

### Requirements

- [ ] R1. Every hit of `rg -l 'bun run (spur-check|lint|gate)\b' plugins/sp` (25 files at refine time) instructs `spur self exec check|lint|check-feature|autofix` instead, except where R2 applies.
- [ ] R2. Bun-specific prose remains only where it documents spur-new's own development setup, and such lines name it as spur-new-specific.
- [ ] R3. A pin in plugins/sp/tests/skill-structure.test.ts fails on `bun run (spur-check|lint|gate)` in plugin markdown outside an explicit allowlist (R2 files).
- [ ] R4. `superskill install sp --dry-run` completes without errors after the edits.

Out of scope: AGENTS.md (spur-new's own dev doc, 1226 owns its script-name moves); dated reports; non-sp plugins.

### Acceptance Criteria

- [ ] AC1 — Plugin guidance invokes actions through spur self exec

Requirement map: AC1 → R1–R4. Test layer: plugins/sp/tests/skill-structure.test.ts scanning real plugin markdown.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:56.796Z

- Enforcement lives in the existing plugin skill-structure test, not a new config rule.

#### Q&A entry — 2026-10-17T04:16:48.749Z

- Enforcement lives in the existing plugin skill-structure test, not a new config rule (closed).
- `gate` maps to autofix + check (closed: same effect as today's gate script).

### Design

WHAT: prose migration so agents call the stack-neutral verb in any project.
WHERE: plugins/sp/{commands,skills,agents}/**/*.md from the R1 query; plugins/sp/tests/skill-structure.test.ts.

Mapping: `bun run spur-check` → `spur self exec check`; `bun run spur-check-feature` → `spur self exec check-feature`; `bun run lint` → `spur self exec lint`; `bun run gate` → `spur self exec autofix` followed by `spur self exec check` (gate = write-format + typecheck + tests today).

Anti-patterns: no new config rule (the existing skill-structure test owns plugin prose invariants); do not hand-edit generated per-platform adapters (superskill regenerates them).

Assumes from 1223: the verb and flags exist; from 1226: removed script names are gone, so prose cannot cite them.

### Plan

1. Run the R1 query and save the file list as the artifact.
2. Rewrite each instruction with the mapping; mark any R2 exception.
3. Add the R3 pin with the allowlist.
4. `superskill install sp --dry-run` (R4); `(cd plugins/sp && bun test tests/skill-structure.test.ts)`; `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
