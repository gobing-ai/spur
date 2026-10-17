---
schema_version: 1
name: Consolidate package.json scripts and script folders onto the action vocabulary
status: todo
template: feature-impl
created_at: 2026-10-17T04:04:39.233Z
updated_at: "2026-10-17T04:18:01.124Z"
feature_id: A92
priority: P2
tags:
  - scripts
  - package-json
estimate_hours: 5

dependencies: ["1224"]
---

## 1226. Consolidate package.json scripts and script folders onto the action vocabulary

### Background

Feature A92 (docs/design/sdlc-actions.md §2 layers, §3.5). spur-new's package.json has exact duplicates (spur-check-new = spur-check, spur-check-new:full = spur-check:full, check:full = check), two entry styles (`bun scripts/commands/x.ts` vs scripts/spur-dev.ts dispatcher), and zero-caller scripts (surface-drift-inventory.ts, validate-flag-contracts.ts). Covers R1, R7, R8.

**Refine corrections (2026-10-16)**
- Satellite said 9 package.json scripts call `bun scripts/commands/<x>.ts` directly → `rg -c` counts 13 lines (package.json) → R5 covers all of them.
- References to the removed names span live docs and history (ADR text, dated reports/plans/inventory) → only live references move (AGENTS.md, plugins/sp skills/references, docs/design, config/rules/quality/coverage-gate.yaml comment, tests: apps/cli/tests/commands/task/check.test.ts, plugins/sp/tests/feature-verification-scope.test.ts, scripts/commands/coverage-certification.test.ts:475); dated reports/plans and ADR history stay verbatim.
- Folding `:full` into `-- --verbose`: with the bun preset, rules-post = `bun run test-post-check`, and `bun run <script> --verbose` appends the flag to the script's last command (the rule run), matching today's `:full` bodies → valid.

### Requirements

- [ ] R1. docs/design/sdlc-actions.md §3.5 carries a table classifying every root package.json script as binding (reserved action under bun preset), composition, or repo tool.
- [ ] R2. `spur-check-new` (package.json:93), `spur-check-new:full` (package.json:101) and `check:full` (package.json:99) are removed; every live reference moves in the same change (dated reports/plans and ADR history excepted).
- [ ] R3. `test-pre-check:full` / `test-post-check:full` are removed; their callers (`spur-check:full`, coverage-certification.test.ts:475, coverage-gate.yaml comment) use `test-pre-check --verbose` / `test-post-check --verbose`.
- [ ] R4. spur-new's .spur/config.yaml declares `builder.preset: bun` plus custom actions `test-repo-wide`, `plugin-smoke`, `corpus-check`, `eval` bound to the existing scripts.
- [ ] R5. Every package.json entry that runs `bun scripts/commands/<x>.ts` directly is routed through `bun scripts/spur-dev.ts <command>`; the spur-dev.ts header table records each command's layer (L1 build/package, L2 test runner, L3 repo contract checks, L4 dev/eval).
- [ ] R6. scripts/commands/surface-drift-inventory.ts and validate-flag-contracts.ts each get a registered caller or are deleted with their tests and live references.
- [ ] R7. The sp-script-placement rule and a reachability scan (every file under scripts/commands, plugins/sp/scripts/hooks, plugins/sp/lib has a runtime/package/hook caller or is a colocated test) report zero findings.

Out of scope: moving files between folders; renaming bun scripts to action names; superskill/knowledge-kit changes; spur-check-feature composition redesign (satellite §5 open question).

### Acceptance Criteria

- [ ] AC1 — The SDLC action vocabulary and common script layers are documented
- [ ] AC2 — Root package.json scripts map to the action vocabulary
- [ ] AC3 — Script folders follow the placement contract with no dead entries

Requirement map: AC1 → R1; AC2 → R2, R3, R4, R5; AC3 → R6, R7. Verification: `rg -n 'spur-check-new|check:full' --glob '!docs/{reports,plans,inventory}/**' --glob '!docs/00_ADR.md'` returns nothing; sp-script-placement reports zero findings; full gates green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:55.916Z

- No folder reshuffle: layers are recorded, not encoded in paths.
- Tests stay colocated beside scripts/commands modules (spur-new convention).
- Bun script names are kept (the bun preset depends on them, as do superskill and knowledge-kit).

#### Q&A entry — 2026-10-17T04:16:47.232Z

- No folder reshuffle: layers are recorded, not encoded in paths (closed).
- Tests stay colocated beside scripts/commands modules (closed: spur-new convention).
- Bun script names are kept (closed: the bun preset depends on them).
- History documents keep removed names verbatim (closed 2026-10-16).

### Design

WHAT: make spur-new's own script surface match the vocabulary with no duplicate or dead entries.
WHERE: package.json, .spur/config.yaml, scripts/spur-dev.ts, scripts/commands/*, docs/design/sdlc-actions.md §3.5, AGENTS.md, live plugin references listed in the correction block.

Decisions: keep bun script names (the bun preset binds to them; satellite §3.1); `:full` variants become `--verbose` passthrough; layer recorded in the spur-dev.ts header, not paths; tests stay colocated.

Zero-caller disposition rule: register when the script backs a documented contract still in force (check docs/design references); otherwise delete. Record the decision per file in the correction block.

Anti-patterns: no folder moves; no new package.json scripts beyond routing changes; do not edit dated reports/plans or ADR history text; do not touch `.github/workflows/` (needs explicit operator request) — if CI calls a removed name, stop and surface it.

Assumes from 1224: engine defaults already route through actions, so removed names have no engine caller. Leaves for 1227: plugin prose referencing removed names that 1227 rewrites to `spur self exec`.

### Plan

0. Precondition: `rg -n 'spur-check-new|check:full|pre-check:full|post-check:full' .github/` — any hit stops the task for an operator decision (workflow edits need explicit request).
1. Build the classification table and record it in satellite §3.5 (R1).
2. Remove duplicates and :full variants; move live references (R2, R3).
3. Add the dogfood builder block to .spur/config.yaml (R4).
4. Route direct script calls through spur-dev.ts and add the layer header table (R5).
5. Resolve the two zero-caller scripts (R6); run `spur rule run` for sp-script-placement and the reachability scan (R7).
6. `bun run spur-check` and `bun run spur-check-feature`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
