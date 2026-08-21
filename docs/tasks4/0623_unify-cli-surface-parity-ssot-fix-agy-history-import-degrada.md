---
schema_version: 1
name: "Unify CLI-surface parity SSOT + fix agy history import degradation"
status: backlog
template: meta
created_at: 2026-08-21T06:23:20.243Z
updated_at: "2026-08-21T06:34:06.860Z"
priority: P1
---

## 0623. Unify CLI-surface parity SSOT + fix agy history import degradation

### Background
Post-fixall forensics (2026-08-21, spur-new) found a structural fragility and a data-plane
degradation. The sp-dev-fixall that reconciled the `self` noun CLI-surface change took ~58 min;
the dominant cost was a 3-wave "whack-a-mole": each targeted probe passed, then the next sibling
parity test file surfaced a stale hardcoded noun→reference map.

Root cause: the CLI noun/verb/flag surface is pinned in multiple independent test files, each
with its own hand-written map:

- `plugins/sp/tests/cli-surface-parity.test.ts` — `REFERENCE_LAYOUT` (noun → reference file/heading/format)
- `plugins/sp/tests/helpers/cli-surface.test.ts` — Tier C exclusion pin (`['history','migrate','projects','help']`)
- `apps/cli/tests/spur-cli-parity.test.ts` — `EXPECTED_TIER_B_VERBS`, `TIER_B_REF_FILES`, `EXCLUDED_TIER_C_NOUNS`, plus an in-process `cliProgram` tree
- `plugins/sp/tests/surface-drift-inventory.test.ts` — `nounOfReference(...)` filename assertions

These are not coupled to a single source of truth, so a surface change surfaces N sequential
failures instead of one. The apps/cli and plugins/sp suites cannot share a module directly
(`plugins/sp` is not a workspace member — see the header comment in spur-cli-parity.test.ts), so
the map must be derived from the one file both already read: the facade `SKILL.md` routing table.

Secondary finding: `spur history import --source all` reported source `agy` degraded — 550 records
imported, 366 skipped with parse errors. The agy importer's mapper does not cover some record
shapes, so a portion of agy conversations is absent from the data plane.
### Requirements
- [ ] R1. Derive `EXPECTED_TIER_B_VERBS` in `apps/cli/tests/spur-cli-parity.test.ts` from the facade `SKILL.md` `## Noun routing` table (Tier B rows) instead of a hardcoded literal.
- [ ] R2. Derive `TIER_B_REF_FILES` in `apps/cli/tests/spur-cli-parity.test.ts` from the routing table's `Reference` column instead of a hardcoded map.
- [ ] R3. Derive `EXCLUDED_TIER_C_NOUNS` in `apps/cli/tests/spur-cli-parity.test.ts` from the `### Tier C exclusion reasons` table instead of a hardcoded list.
- [ ] R4. Keep the plugins/sp parity tests (`cli-surface-parity`, `helpers/cli-surface`) deriving from the same SKILL.md surface — confirm no remaining hardcoded noun list diverges from the routing table.
- [ ] R5. Investigate the `agy` history-import parse errors (366 skipped of 916): identify the unmapped record shapes, fix the agy mapper, and re-import so agy coverage reaches 0 parse errors.
### Acceptance Criteria
```gherkin
Scenario: surface change is a single edit
  Given the facade SKILL.md routing table lists a Tier B noun `X` with reference `X.md`
  When `apps/cli/tests/spur-cli-parity.test.ts` runs
  Then `X` is in its `EXPECTED_TIER_B_VERBS` and `TIER_B_REF_FILES` without editing the test
  And `spur task check --corpus` and `bun run check` pass

Scenario: Tier C exclusions track the exclusion table
  Given SKILL.md `### Tier C exclusion reasons` lists nouns `history`, `projects`, `help`
  When `apps/cli/tests/spur-cli-parity.test.ts` runs
  Then `EXCLUDED_TIER_C_NOUNS` equals exactly that set without editing the test

Scenario: parity suites agree on the surface
  Given a clean surface change applied only to SKILL.md and the live CLI
  When `bun test apps/cli/tests/spur-cli-parity.test.ts plugins/sp/tests/cli-surface-parity.test.ts plugins/sp/tests/helpers/cli-surface.test.ts` runs
  Then all parity tests pass with zero hardcoded noun-map edits

Scenario: agy import is clean
  Given `spur history import --source agy --json`
  When it completes
  Then `parseErrors` is 0 and all agy files import
```
### Q&A
- Q: Why derive from SKILL.md instead of a shared TS module?
  A: `plugins/sp` is not a workspace member (root `workspaces.packages` = `apps/*` + `packages/*`), so `apps/cli` cannot import a helper from `plugins/sp` on clean CI. SKILL.md is the one surface file both suites already read by path, so it is the natural SSOT.

- Q: Doesn't deriving the maps add a parser to the test?
  A: Yes, ~20 lines local to `apps/cli/tests/spur-cli-parity.test.ts`, mirroring `plugins/sp/tests/helpers/cli-surface.ts`. The parser is small and stable; the payoff is that a noun change breaks once (SKILL.md must be updated) instead of N test files.

- Q: What about `REFERENCE_LAYOUT` in cli-surface-parity.test.ts — should it derive too?
  A: No. It maps noun → (file, heading, format) — structural metadata, not surface data. `facadeRoutingNouns()` already derives the noun set from SKILL.md; only the file/heading/format is static. Keep it hardcoded.

- Q: How much time does this save?
  A: The fixall lost ~30–40 min to 3 discovery waves. With the derived maps + the new sweep step, a surface change costs one SKILL.md edit + one `rg` sweep — roughly 5–10 min, a 4–6× improvement.

- Q: Is the agy fix in scope for the same task?
  A: Yes, but it is separable (R5). It touches the ts-libs importer, not the repo test files. If R5 proves large, split it into its own task.

- Q: Why keep the verb vocabulary hardcoded even as the noun set derives?
  A: The routing table lists nouns, not per-noun verb catalogs. Verb sets live in the reference files (e.g. `tasks.md`), which the parity test already reads. Deriving verbs from reference files is a further step; this task derives noun set + reference mapping + Tier C exclusions, which is what the whack-a-mole actually needed.
### Design
**Fix 2 (R1–R4): single source of truth for the noun surface.**

Evidence from the fixall (2026-08-21, spur-new session `01a02287-0311-7e8d-a158-fcd678f791d8`):

- Wave 1: `plugins/sp/tests/cli-surface-parity.test.ts` — 5 failures (`facade noun routing`, 3× per-noun `init/status/serve` `documented-not-on-CLI`, `AGENTS.md nouns`). Fixed by updating SKILL.md routing + AGENTS.md + `REFERENCE_LAYOUT`.
- Wave 2: `bun test plugins/sp/tests` → 2 new failures (`skill-structure.test.ts` R3 duplicate-catalog, `helpers/cli-surface.test.ts` R1 Tier C pin). The Tier C pin had a hardcoded 4-noun list.
- Wave 3: `bun test apps/cli/tests/spur-cli-parity.test.ts ...` → 1 new failure (`SKILL.md routing table links Tier B noun references`), whose `TIER_B_REF_FILES`/`EXPECTED_TIER_B_VERBS` hardcoded `init/status/serve`.

Each wave required a suite probe + a fresh edit loop (~10–15 min each). The map is duplicated in at
least 4 test files, none importing a shared constant.

Fix: in `apps/cli/tests/spur-cli-parity.test.ts`, parse the facade `SKILL.md` directly (it already
`readFileSync`'s it for the routing-links test):

- Tier B nouns + verbs ← `## Noun routing` table rows where the Tier cell is `Tier B` (split the
  Noun cell on `/`; verbs are the noun's own documented verb list — the existing
  `EXPECTED_TIER_B_VERBS` values for agent/message/team/self stay as the verb vocabulary, but the
  noun set and reference-file mapping come from the table).
- `TIER_B_REF_FILES` ← the row's `Reference` cell (`references/<file>.md` → `<file>.md`).
- `EXCLUDED_TIER_C_NOUNS` ← the `### Tier C exclusion reasons` table's first column.

Workspace-boundary note: `plugins/sp` is not a workspace member, so the parse helper cannot be
shared by import; a small local parser (~20 lines) in the apps/cli test is acceptable and mirrors
`plugins/sp/tests/helpers/cli-surface.ts`. The plugins/sp suite already derives from the routing
table via `facadeRoutingNouns()`; `REFERENCE_LAYOUT` (file+heading+format) is a stable structural
map and may stay hardcoded — only noun/verb/flag *data* must come from SKILL.md.

**Fix 3 (R5): agy import degradation.**

Evidence: `spur history import --source all --json` (2026-08-21) → `agy: status=degraded,
files=632, messages=550, parseErrors=366`. 366 records of 916 failed to parse.

Fix: reproduce with `spur history import --source agy --dry-run --json`, inspect the
`parseErrorSamples` in the sidecar, identify the unmapped record shapes (likely newer message
envelope variants), extend the agy mapper in the ts-libs importer
(`@gobing-ai/ts-llm-jsonl-importer`), republish, then `spur history import --source agy --json`
until parseErrors = 0.
### Plan
- [ ] 1. (R1–R4) In `apps/cli/tests/spur-cli-parity.test.ts`, add a local `parseTierBNouns()` / `parseTierCExclusions()` helper reading the facade SKILL.md.
- [ ] 2. (R1–R4) Replace the `EXPECTED_TIER_B_VERBS` / `TIER_B_REF_FILES` / `EXCLUDED_TIER_C_NOUNS` literals with derived values; keep the verb vocabulary for the Tier B nouns.
- [ ] 3. (R1–R4) Run `bun test apps/cli/tests/spur-cli-parity.test.ts` + the two plugins/sp parity suites; confirm all green with no literal noun edits.
- [ ] 4. (R1–R4) Run `bun run lint && bun run check` to confirm no surface-drift / corpus regressions.
- [ ] 5. (R5) Run `spur history import --source agy --dry-run --json`; read parseErrorSamples.
- [ ] 6. (R5) Extend the agy mapper in `@gobing-ai/ts-llm-jsonl-importer` for the unmapped shapes; republish; `bun update` dependent workspaces.
- [ ] 7. (R5) Re-import `--source agy --json` until parseErrors = 0; re-run `spur history analyze`.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Fixall session: `/Users/robin/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-21T04-14-28-625Z_01a02287-0311-7e8d-a158-fcd678f791d8.jsonl` (pi, 04:14–05:12 UTC fixall window)
- Forensics artifact: `.spur/reports/history/2026-08-21/analyze-38efcab3.json`
- Facade SSOT: `plugins/sp/skills/spur-cli/SKILL.md` (`## Noun routing`, `### Tier C exclusion reasons`)
- Parity tests: `plugins/sp/tests/cli-surface-parity.test.ts`, `plugins/sp/tests/helpers/cli-surface.test.ts`, `apps/cli/tests/spur-cli-parity.test.ts`, `plugins/sp/tests/surface-drift-inventory.test.ts`
- Fixall reference (Fix 1 landed): `plugins/sp/skills/spur-dev/references/dev-operations.md` §10 step 3
- Importer (R5): `@gobing-ai/ts-llm-jsonl-importer` (agy mapper)
- Import provenance: `apps/cli/src/index.ts` · importer `0.4.39`
### History
### Notes

- **RC1 — Fragmented CLI-surface SSOT.** The noun→reference map is hand-copied into ≥4 test files. Forensic evidence: 3 sequential discovery waves in one fixall, each surfaced by a full-suite probe after the previous targeted fix passed. Estimated waste: ~30–40 min of the ~58 min fixall.
- **RC2 — Discovery-by-gate instead of sweep-by-`rg`.** The fixall ran the full suite (52 s) to find the initial 5 failures, then each sibling probe (2× plugins/sp ~9.7 s, apps/cli) revealed one more pinned file. An upfront `rg -l "<old-noun>|<old-ref>.md" apps/*/tests plugins/sp/tests plugins/sp/skills docs` would have produced the complete edit set in one pass. Mitigation already landed: `dev-operations.md` §10 fixall step 3 (surface-change sweep).
- **RC3 — agy importer coverage gap.** `agy` degraded: 366/916 records unparseable. Root cause unverified (needs dry-run sample inspection); likely unmapped envelope variants in the agy mapper.

