---
schema_version: 1
name: "Unify CLI-surface parity SSOT + fix agy history import degradation"
status: done
template: meta
created_at: 2026-08-21T06:23:20.243Z
updated_at: "2026-08-22T02:09:39.424Z"
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
- [x] R1. Derive `EXPECTED_TIER_B_VERBS` in `apps/cli/tests/spur-cli-parity.test.ts` from the facade `SKILL.md` `## Noun routing` table (Tier B rows) instead of a hardcoded literal.
- [x] R2. Derive `TIER_B_REF_FILES` in `apps/cli/tests/spur-cli-parity.test.ts` from the routing table's `Reference` column instead of a hardcoded map.
- [x] R3. Derive `EXCLUDED_TIER_C_NOUNS` in `apps/cli/tests/spur-cli-parity.test.ts` from the `### Tier C exclusion reasons` table instead of a hardcoded list.
- [x] R4. Keep the plugins/sp parity tests (`cli-surface-parity`, `helpers/cli-surface`) deriving from the same SKILL.md surface — confirm no remaining hardcoded noun list diverges from the routing table.
- [x] R5. Investigate the `agy` history-import parse errors (366 skipped of 916): identify the unmapped record shapes, fix the agy mapper, and re-import so agy coverage reaches 0 parse errors.
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
- [x] 1. (R1–R4) In `apps/cli/tests/spur-cli-parity.test.ts`, add a local `parseTierBNouns()` / `parseTierCExclusions()` helper reading the facade SKILL.md.
- [x] 2. (R1–R4) Replace the `EXPECTED_TIER_B_VERBS` / `TIER_B_REF_FILES` / `EXCLUDED_TIER_C_NOUNS` literals with derived values; keep the verb vocabulary for the Tier B nouns.
- [x] 3. (R1–R4) Run `bun test apps/cli/tests/spur-cli-parity.test.ts` + the two plugins/sp parity suites; confirm all green with no literal noun edits.
- [x] 4. (R1–R4) Run `bun run lint && bun run check` to confirm no surface-drift / corpus regressions.
- [x] 5. (R5) Run `spur history import --source agy --dry-run --json`; read parseErrorSamples.
- [x] 6. (R5) Extend the agy mapper in `@gobing-ai/ts-llm-jsonl-importer` for the unmapped shapes; republish; `bun update` dependent workspaces.
- [x] 7. (R5) Re-import `--source agy --json` until parseErrors = 0; re-run `spur history analyze`.
### Solution
**R1–R3 — parity test derives from SKILL.md (single edit surface)**

- `apps/cli/tests/spur-cli-parity.test.ts:61` — `SKILL_MD` loads `plugins/sp/skills/spur-cli/SKILL.md` as the SSOT; all expectations derive from it at test time.
- `apps/cli/tests/spur-cli-parity.test.ts:63-125` — `tableCells`/`tableUnderHeading` parse Markdown tables; `nounsFromCell`/`refFileFromCell`/`routingRows` parse `## Noun routing` into typed rows.
- `apps/cli/tests/spur-cli-parity.test.ts:128` — `TIER_B_REF_FILES` derives Tier B noun→reference mappings from those rows.
- `apps/cli/tests/spur-cli-parity.test.ts:141` — `EXCLUDED_TIER_C_NOUNS` derives from the exclusion table's first column.
- `apps/cli/tests/spur-cli-parity.test.ts:146` — `verbsFromReference` reads each Tier B reference file's `## Verb map`; `EXPECTED_TIER_B_VERBS` at line 156 derives its noun set from `TIER_B_REF_FILES`.
- `apps/cli/tests/spur-cli-parity.test.ts:43` — `TIER_B_VERB_FLOOR` stays hardcoded (task Q&A decision) and merges with reference-derived verbs.

**R4 — plugins/sp suites verified already SKILL.md-derived (no repair)**

- `plugins/sp/tests/cli-surface-parity.test.ts:138-154` — Tier C exclusions are parsed from the facade SKILL.md; `facadeRoutingNouns()` supplies the live noun set.
- `plugins/sp/tests/helpers/cli-surface.test.ts:141` — the helper test parses the live Tier C table and verifies its reasoned entries.
- `plugins/sp/tests/surface-drift-inventory.test.ts` — no divergent Tier C pin; `nounOfReference` is a path→noun mapper, not an exclusion list.
- Verification: the exact three-suite acceptance command passes 45 tests / 0 failures.

**R5 — agy import degradation fixed in ts-libs (upstream, released 0.4.40)**

Diagnosis disproved the task's "unmapped record shapes" hypothesis: all failures were JSON parse failures from unrecoverable torn tails and foreign fragments interleaved by the producer.

- `@gobing-ai/ts-llm-jsonl-importer` `packages/llm-jsonl-importer/src/types.ts` line 59 — additive per-source `corruptLinePolicy?: 'error' | 'skip'`; line 127 adds `ImportResult.skippedCorruptLines` without entering `parseErrors`.
- `@gobing-ai/ts-llm-jsonl-importer` `packages/llm-jsonl-importer/src/importer.ts` line 165 — the line loop applies the policy and counts skipped corrupt lines; line 408 keeps the default error policy for every other source.
- `@gobing-ai/ts-llm-jsonl-importer` `packages/llm-jsonl-importer/src/sources.ts` line 193 — only `agy` opts into `corruptLinePolicy: 'skip'`.
- `@gobing-ai/ts-llm-jsonl-importer` `packages/llm-jsonl-importer/tests/importer.test.ts` line 911 — tests cover both agy skip behavior and the unchanged default error behavior; the current full importer suite passes 241 tests / 0 failures.

The fix shipped in `@gobing-ai/ts-libs-v0.4.40`; Spur now resolves `0.4.41`. A source-local full import on 2026-08-21 completed with 682 files, `parseErrors: 0`, `validationErrors: 0`, status `ok`, and importer provenance `0.4.41`.
### Root Cause
<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

**RC1 — CLI-surface SSOT fragmentation.** The noun→reference map was hand-copied into ≥4 test files, so one SKILL.md change broke tests in waves. Fixed by deriving the maps from SKILL.md itself: `apps/cli/tests/spur-cli-parity.test.ts:77-167`.

**RC3 — agy importer degradation.** Verified cause: NOT unmapped record shapes. 789 of 89,818 lines (0.88%, max 3/file) fail `JSON.parse` — 392 torn tails (truncated final-line writes) + 397 foreign fragments (HTML/prose interleaved by the Antigravity producer), 0 valid-JSON-non-object lines. All unrecoverable by any mapper. Fixed upstream: per-source `corruptLinePolicy: 'skip'` on the agy source definition (ts-libs `packages/llm-jsonl-importer/src/sources.ts`, agy entry), counting skips in `ImportResult.skippedCorruptLines` without entering `parseErrors`, so degraded classification (`packages/app/src/services/history-service.ts:605`) is untouched.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/spur-cli-parity.test.ts:120-162` parses Tier B rows from `SKILL_MD`; `EXPECTED_TIER_B_VERBS` derives its noun set from those rows and each routed reference. |
| R2 | MET | `apps/cli/tests/spur-cli-parity.test.ts:128` derives `TIER_B_REF_FILES` from each Tier B routing row's Reference column. |
| R3 | MET | `apps/cli/tests/spur-cli-parity.test.ts:141` derives `EXCLUDED_TIER_C_NOUNS` from the Tier C exclusion table's first column. |
| R4 | MET | `plugins/sp/tests/cli-surface-parity.test.ts` derives the facade noun set through `facadeRoutingNouns`; the helper suite parses the same SKILL.md surface and the exact three-suite command passes 45 tests / 0 failures / 256 assertions. |
| R5 | MET | `@gobing-ai/ts-llm-jsonl-importer` scopes `corruptLinePolicy: 'skip'` to agy in `sources.ts`; its importer tests cover agy skip plus unchanged default-error behavior in the 241-test package suite. Source-local full import resolved importer 0.4.41 and returned 682 files, `parseErrors: 0`, `validationErrors: 0`, status `ok`; the fix shipped in 0.4.40. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: surface change is a single edit | MET | command | `bun run spur-check` passes 6,117 tests / 0 failures with 99.04% line and 99.19% function coverage; `bun run corpus-check` passes with 0 new / 0 stale findings. |
| Scenario: Tier C exclusions track the exclusion table | MET | test | `apps/cli/tests/spur-cli-parity.test.ts:141` derives the exact current set from SKILL.md; its parity assertions pass. |
| Scenario: parity suites agree on the surface | MET | test | `bun test apps/cli/tests/spur-cli-parity.test.ts plugins/sp/tests/cli-surface-parity.test.ts plugins/sp/tests/helpers/cli-surface.test.ts` passes 45 tests / 0 failures / 256 assertions. |
| Scenario: agy import is clean | MET | command | `bun run apps/cli/src/index.ts history import --source agy --mode full --json` via the source-local binary and importer 0.4.41 returns 682 files, `parseErrors: 0`, `validationErrors: 0`, status `ok`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Scope:** Task 0623 intended changes and evidence only: `AGENTS.md` coverage wording,
`apps/cli/tests/spur-cli-parity.test.ts`, `bunfig.toml`, the 0623 task-corpus evidence, and
the external `@gobing-ai/ts-llm-jsonl-importer@0.4.40` release. Concurrent E8/0624 changes
under `packages/app`, `packages/domain`, and `config/corpus-baseline.json` are excluded from
the implementation review; the corpus baseline is mentioned only as shared-gate evidence.

**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture

**Verdict:** PASS

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | usability / observability (advisory, out of scope) | `apps/cli/src/commands/history.ts:123-126` | The upstream importer’s `src/types.ts` line 136 counts skipped corrupt lines separately, but the 0623 evidence only exposes `parseErrors: 0` and the fan-out result. A future history-data-plane task should surface `skippedCorruptLines` so “clean” cannot be read as lossless. This is not a 0623 AC blocker and no concurrent app code was reviewed or changed. |
| P4 | security | 0623 intended scope | No P1–P2 security finding: the local parser reads repository-controlled Markdown, performs no evaluation or shell interpolation, and the corrupt-line policy is scoped to the named agy source. |
| P4 | efficiency | `apps/cli/tests/spur-cli-parity.test.ts:5-8` | Removing duplicate in-process Commander registration leaves live CLI capture to the plugin subprocess suite and keeps this suite focused on the SKILL/reference contract; no new runtime cost was introduced. |
| P4 | architecture | `apps/cli/tests/spur-cli-parity.test.ts:51-162`; `plugins/sp/tests/cli-surface-parity.test.ts:141-154` | The two suites intentionally parse the same `SKILL.md` by path because `plugins/sp` is not a workspace package. `REFERENCE_LAYOUT` remains a structural metadata map as approved by the task design; no blocker or major seam issue found. |

**Functional Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/tests/spur-cli-parity.test.ts:118-162` parses Tier B routing rows and derives `EXPECTED_TIER_B_VERBS` from routed nouns plus reference verb maps; the hardcoded floor is the explicit Q&A exception. |
| R2 | MET | `apps/cli/tests/spur-cli-parity.test.ts:127-138` derives `TIER_B_REF_FILES` from the routing table Reference cell and fails on an unparseable Tier B row. |
| R3 | MET | `apps/cli/tests/spur-cli-parity.test.ts:140-143` derives `EXCLUDED_TIER_C_NOUNS` from the `### Tier C exclusion reasons` table. |
| R4 | MET | `plugins/sp/tests/cli-surface-parity.test.ts:141-154` derives facade nouns from `SKILL.md`; `plugins/sp/tests/helpers/cli-surface.test.ts:141-147` parses and validates the same live Tier C table. The recorded three-suite command passes 45 tests / 0 failures. |
| R5 | MET | @gobing-ai/ts-llm-jsonl-importer \`src/types.ts\` lines 59-71, 126-138 — defines the source-scoped skip policy and counter; @gobing-ai/ts-llm-jsonl-importer \`src/importer.ts\` lines 160-169 — applies it; @gobing-ai/ts-llm-jsonl-importer \`src/sources.ts\` lines 193-206 — scopes it to agy; importer tests at @gobing-ai/ts-llm-jsonl-importer \`tests/importer.test.ts\` lines 911-939 cover skip and default-error behavior. The source-local full import recorded 682 files, `parseErrors: 0`, `validationErrors: 0`, status `ok`, provenance `0.4.41`; the agy corrupt-line fix is from `0.4.40`. |

**Acceptance-Criteria Cross-check**

| AC | Status | Evidence |
| --- | --- | --- |
| Scenario: surface change is a single edit | MET | `apps/cli/tests/spur-cli-parity.test.ts:127-162`; recorded parity and `spur-check` evidence passed, and fresh `bun run corpus-check` exited 0 with 0 new / 0 stale findings. |
| Scenario: Tier C exclusions track the exclusion table | MET | `apps/cli/tests/spur-cli-parity.test.ts:140-143` plus the exact-set assertion in the recorded parity run. |
| Scenario: parity suites agree on the surface | MET | `bun test apps/cli/tests/spur-cli-parity.test.ts plugins/sp/tests/cli-surface-parity.test.ts plugins/sp/tests/helpers/cli-surface.test.ts` — 45 passed, 0 failed, 256 assertions. |
| Scenario: agy import is clean | MET | Source-local `bun run apps/cli/src/index.ts history import --source agy --mode full --json` — current importer `0.4.41`, status `ok`, `parseErrors: 0`, `validationErrors: 0`; the policy under test was introduced in `0.4.40`. |

**Design Conformance**

| Claim | Status | Evidence |
| --- | --- | --- |
| R1–R4 derive the CLI surface from the facade SSOT | DONE | `apps/cli/tests/spur-cli-parity.test.ts:61-162` and the existing plugin parser at `plugins/sp/tests/cli-surface-parity.test.ts:141-154`. |
| R5 fixes agy degradation in the importer | CHANGED, documented | The written design expected mapper shape additions; the Solution records the verified alternative: unrecoverable corrupt JSON lines handled by the agy-only skip policy in importer `0.4.40`. |
| Coverage harness documents the preload exclusion | DONE | `bunfig.toml:18-27` and `AGENTS.md:367-372` agree on `tests/setup.ts` as a test-harness exclusion. |

**SECUA / Architecture Summary**

Security, efficiency, usability, and architecture are clean for the intended scope. The local
Markdown parser is bounded and fails loudly on missing headings or malformed Tier B routing rows;
the plugin helper independently validates Tier C reasons and duplicates. The two prior evidence
findings are closed: References now distinguishes current importer 0.4.41 from the 0.4.40 fix
release, and Notes records the verified producer-corruption diagnosis. The corpus check currently
passes (`errors 2278 observed, 764 baselined, 0 new, 0 stale; warnings 2423 observed, 1146
baselined, 0 new, 0 stale`); its four two-sided E8 baseline entries are shared integration hygiene,
not 0623 implementation.

**Next:** no in-scope action remains. Keep the skipped-line visibility item as a separate
history-data-plane follow-up unless the operator expands 0623 scope.
### References
- Fixall session: `/Users/robin/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-21T04-14-28-625Z_01a02287-0311-7e8d-a158-fcd678f791d8.jsonl` (pi, 04:14–05:12 UTC fixall window)
- Forensics artifact: `.spur/reports/history/2026-08-21/analyze-38efcab3.json`
- Facade SSOT: `plugins/sp/skills/spur-cli/SKILL.md` (`## Noun routing`, `### Tier C exclusion reasons`)
- Parity tests: `plugins/sp/tests/cli-surface-parity.test.ts`, `plugins/sp/tests/helpers/cli-surface.test.ts`, `apps/cli/tests/spur-cli-parity.test.ts`, `plugins/sp/tests/surface-drift-inventory.test.ts`
- Fixall reference (Fix 1 landed): `plugins/sp/skills/spur-dev/references/dev-operations.md` §10 step 3
- Importer (R5): `@gobing-ai/ts-llm-jsonl-importer` (agy corrupt-line policy)
- Import provenance: `apps/cli/src/index.ts` · importer `0.4.41` (agy corrupt-line policy introduced in `0.4.40`)
### History
- 2026-08-21T23:54:17.377Z backlog → todo (system)
- 2026-08-22T00:22:27.181Z todo → wip (system)
- 2026-08-22T00:28:08.034Z wip → testing (system)
- 2026-08-22T00:28:21.751Z testing → done (system)
### Notes
- **RC1 — Fragmented CLI-surface SSOT.** The noun→reference map was hand-copied into ≥4 test files. Forensic evidence: 3 sequential discovery waves in one fixall, each surfaced by a full-suite probe after the previous targeted fix passed. Estimated waste: ~30–40 min of the ~58 min fixall.
- **RC2 — Discovery-by-gate instead of sweep-by-`rg`.** The fixall ran the full suite (52 s) to find the initial 5 failures, then each sibling probe (2× plugins/sp ~9.7 s, apps/cli) revealed one more pinned file. An upfront `rg -l "<old-noun>|<old-ref>.md" apps/*/tests plugins/sp/tests plugins/sp/skills docs` would have produced the complete edit set in one pass. Mitigation already landed: `dev-operations.md` §10 fixall step 3 (surface-change sweep).
- **RC3 — agy producer corruption, not mapper coverage.** Diagnosis found 789 of 89,818 JSONL lines (0.88%) were unrecoverable: 392 torn tails and 397 foreign HTML/prose fragments, with zero valid-JSON non-object records. Importer `0.4.40` applies `corruptLinePolicy: 'skip'` only to agy, counts the skipped lines separately, and preserves the default error policy for every other source.
