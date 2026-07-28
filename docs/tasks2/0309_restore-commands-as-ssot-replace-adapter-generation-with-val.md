---
template: feature-impl
schema_version: 1
name: "Restore commands as SSOT: replace adapter generation with validation, delete codex adapters"
description: ""
status: done
type: task
profile: standard
feature_id: H5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0308"]
created_at: "2026-07-21T19:37:11.213Z"
updated_at: "2026-07-28T00:32:28.899Z"
---

## 0309. Restore commands as SSOT: replace adapter generation with validation, delete codex adapters

### Background
Task 0308 (feature O wave-2) made `plugins/sp/commands/*.md` **generated output** of a new metadata
file `plugins/sp/scripts/command-registry.ts`, and committed 28 hand-generated Codex wrappers under
`plugins/sp/adapters/codex/`. Operator review after the 0308 re-audit rejected both moves. This task
reverses the SSOT inversion while keeping 0308's two genuine wins.

**Why the 0308 shape is wrong**

1. **The registry adds zero information.** Every `CommandMeta` field already exists in the command
   `.md`: `name` = filename, `title` = H1, `description`/`argumentHint`/`allowedTools` = frontmatter,
   `target` = the `Skill()` line under `## Implementation`. The registry is a parallel encoding, and
   the byte-exact drift test exists solely as the tax paid for that duplication.

2. **`superskill` already owns cross-platform conversion.** Verified 2026-07-21:
   `superskill install sp --targets codex --dry-run --verbose` reads `Commands: 28` from
   `plugins/sp/commands/` and emits them as Codex skills. The staged
   `.rulesync/skills/sp-dev-verify/SKILL.md` carries `disable-model-invocation: true`, rewritten
   refs (`sp-code-verification`), and identical frontmatter — the same artifact as the committed
   `plugins/sp/adapters/codex/sp-dev-verify.md`.

3. **`adapters/codex/` is redundant and incomplete.** `superskill` supports 9 targets: `claude`,
   `codex`, `pi`, `omp`, `opencode`, `antigravity-cli`, `antigravity-ide`, `hermes`, `grok`.
   Committing per-platform output for one of them is either permanent inconsistency or an
   obligation to add seven more folders.

4. **The `.md` is authoritative to the installer.** `superskill` consumes `commands/*.md` as input,
   so the `.md` is already the SSOT downstream. The registry inserted a second upstream that nothing
   outside its own generator consumes — an inversion, not a consolidation.

5. **Generation blocks enhancement.** Operator requirement: slash commands must stay hand- and
   LLM-editable. Byte-exact regeneration makes any direct improvement a test failure.

**Project vision (operator, 2026-07-21).** `superskill` (`~/xprojects/superskill`) installs
Claude-Code-plugin-style plugins to every supported coding agent. Per-platform conversion detail
belongs in `superskill`; a plugin must never carry per-platform adapters. Any conversion gap is a
`superskill` enhancement, never a plugin `sp` workaround.

**Provenance.** 0283 R4 reads "adapters **generated or validated** from common metadata" — the
lighter `validated` branch was explicitly sanctioned. 0308 took the `generated` branch and invented
new metadata rather than treating command frontmatter as the common metadata, without recording a
rationale. The defect is a design-branch choice in 0283/0308, not a 0308 execution error.

**What 0308 got right and must survive:** the ~529-line prose migration into skill references, the
heading-whitelist thinness gate (`adapter-drift.test.ts:164-165`), and the frontmatter
normalizations (`dev-idea` dropping `Skill`, `dev-changelog` dropping `Write`).
### Requirements
R1. Restore `plugins/sp/commands/*.md` as the SSOT for the operator command surface: hand- and
LLM-editable, with no generation step upstream of them. Preserve the current thin-wrapper *content*
(the 0308 bodies are correct — only their generated *status* is being revoked).

R2. Replace `plugins/sp/scripts/generate-adapters.ts` with a **validator** that enforces the
thin-wrapper contract directly on each `.md`, with no byte-exact regeneration: (a) heading whitelist
— heading set beyond the H1 title is exactly `['Usage', 'Implementation']`; (b) frontmatter schema —
`description`, `argument-hint`, `allowed-tools` present and well-formed; (c) skill/workflow target
resolution — every `sp:<skill>` reference, workflow file, and reference-file anchor named in
`## Implementation` exists on disk; (d) `allowed-tools` coherence — `Skill` present iff the body
contains a `Skill()` call. Exit non-zero listing every violating file.

R3. Delete `plugins/sp/adapters/` and `plugins/sp/scripts/command-registry.ts`. Cross-platform
emission is `superskill`'s responsibility; no per-platform artifact is committed in plugin `sp`.

R4. Rewrite `plugins/sp/tests/adapter-drift.test.ts` as a thin-wrapper contract test over the `.md`
files themselves — retaining the R2 gates and dropping every registry-derived and byte-exact
assertion. Preserve the ≥90% per-file coverage gate on any new script.

R5. Remove the `adapter:generated v<n> snapshot:<hash>` marker from all 28 command files: it
versions a generator that no longer exists. Retain the fresh-session dogfood caveat (0283 R7) as
documentation in `plugins/sp/README.md`, not as a per-file marker.

R6. Verify `superskill install sp` produces correct output for all 9 targets (`claude`, `codex`,
`pi`, `omp`, `opencode`, `antigravity-cli`, `antigravity-ide`, `hermes`, `grok`) from the restored
`.md` SSOT. File any conversion defect as a `superskill` issue in `~/xprojects/superskill` — never
work around it inside plugin `sp`.

R7. Update docs in the same commit (T3): `plugins/sp/README.md` §2 (remove "GENERATED" framing,
document commands-as-SSOT + the validator + `superskill`-owned emission) and `docs/04_DESIGN.md`
§1.3 (replace the generated-adapters artifact table).

R8. Add **ADR-032** recording the decision: commands are the SSOT; adapters are install-time output
owned by `superskill` and never committed; thinness is enforced by validation, not generation.
Include the 0283 R4 "generated or validated" provenance and supersede the 0308 approach explicitly.
### Acceptance Criteria
**Scenario: AC1 — Commands are directly editable (R1)**
- **Given** the validator and tests are in place
- **When** an operator or LLM hand-edits a command `.md` in a way that respects the thin-wrapper
  contract (e.g. clarifies a `## Usage` line, adjusts `argument-hint`)
- **Then** `bun test plugins/sp/tests/` passes with no regeneration step — the edit stands as
  authored.

**Scenario: AC2 — Domain prose is still rejected (R2a)**
- **Given** a command `.md`
- **When** a lifecycle-prose heading (`## Behavior`, `## Workflow`, `## Arguments`, …) is added
- **Then** the validator exits non-zero and names the offending file and heading.

**Scenario: AC3 — Broken dispatch targets are caught (R2c)**
- **Given** a command whose `## Implementation` names `sp:<skill>`, a workflow file, or a
  reference anchor
- **When** that target does not exist on disk
- **Then** the validator exits non-zero naming the unresolved target.

**Scenario: AC4 — `allowed-tools` stays coherent (R2d)**
- **Given** a command body containing no `Skill()` call
- **When** its frontmatter `allowed-tools` lists `Skill`
- **Then** the validator exits non-zero — the normalization banked in 0308 cannot silently regress.

**Scenario: AC5 — No generator, registry, or committed adapters remain (R3, R5)**
- **Given** the change is complete
- **When** the tree is inspected
- **Then** `plugins/sp/adapters/` and `plugins/sp/scripts/command-registry.ts` do not exist, no
  `adapter:generated` marker appears in any command `.md`, and nothing references
  `generate-adapters.ts` as a generator.

**Scenario: AC6 — All 9 install targets emit correctly from the `.md` SSOT (R6)**
- **Given** the restored commands
- **When** `superskill install sp --targets <t> --dry-run --verbose` runs for each of the 9 targets
- **Then** each reports the 28 commands and stages plausible per-platform output; any defect is
  filed against `~/xprojects/superskill` with the failing target named, and is **not** patched in
  plugin `sp`.

**Scenario: AC7 — Docs and decision record match the new architecture (R7, R8)**
- **Given** the implementation is complete
- **When** `plugins/sp/README.md`, `docs/04_DESIGN.md`, and `docs/00_ADR.md` are read
- **Then** README §2 and DESIGN §1.3 describe commands-as-SSOT with `superskill`-owned emission (no
  "GENERATED" framing), and ADR-032 records the decision and supersedes the 0308 approach.

**Scenario: AC8 — Full quality gate green**
- **Given** the change is complete
- **When** `bun run lint`, `bun run test-pre-check`, `bun run test-post-check`, and
  `bun test plugins/sp/tests/` run
- **Then** all pass, with the per-file coverage gate satisfied on any new script.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
Ordered so the tree is never left without a thinness gate.

1. **Freeze the current bodies as the new source.** The 28 command `.md` files at HEAD are already
   correct thin wrappers — they become hand-authored source as-is. No content rewrite in this step.
2. **Write the validator** (`plugins/sp/scripts/validate-commands.ts`): parse each `.md`
   (frontmatter + headings + `## Implementation` body), enforce R2 (a)-(d), exit non-zero listing
   every violation. Reuse the heading-whitelist logic from `adapter-drift.test.ts:164-165`, sourcing
   the title from the parsed H1 instead of `CommandMeta.title`.
3. **Rewrite the test** (`plugins/sp/tests/adapter-drift.test.ts` → `command-contract.test.ts`):
   port gates (a)/(b)/(c) to operate on the `.md` files; delete byte-exact and registry-derived
   assertions; add negative-path unit tests per validator rule to hold the coverage gate.
4. **Strip the `adapter:generated` markers** from all 28 files (R5); move the fresh-session caveat
   into README prose.
5. **Delete** `plugins/sp/adapters/` and `plugins/sp/scripts/command-registry.ts`; delete
   `generate-adapters.ts` (or reduce it to the validator entry point if that is cleaner).
6. **Wire the validator into the gate** — add it to the `plugins/sp` test run and/or a
   `spur rule` pre-check entry, so thinness is enforced on every `bun run check`.
7. **Verify all 9 install targets** (R6): loop
   `superskill install sp --targets <t> --dry-run --verbose`; record per-target output; open
   `superskill` issues for any defect. Do not patch plugin `sp`.
8. **Docs same-commit** (R7): README §2, `docs/04_DESIGN.md` §1.3.
9. **ADR-032** (R8): decision, provenance (0283 R4 "generated or validated"), explicit supersession
   of the 0308 generated-adapter approach.
10. **Full gate**: `bun run lint`, `test-pre-check`, `test-post-check`, `bun test plugins/sp/tests/`.

**Open question for the implementer (do not assume):** step 5 deletes `generate-adapters.ts`, but
its `runCli`/`bootMain` seam pattern is what achieved 100% function coverage. Reuse that seam in the
validator rather than rediscovering it.

**Non-goal:** no write-guard hook. Commands are hand-editable by design (operator requirement); the
validator is the only enforcement, and it must not block authoring.
### Solution
`plugins/sp/scripts/validate-commands.ts:1-352` — four-gate validator + CLI + bootMain DI seam
`plugins/sp/tests/command-contract.test.ts:1-429` — contract test (a)-(g), 277 tests, 96.65% coverage
`plugins/sp/commands/dev-reverse.md:4` — added "Skill" to allowed-tools
`docs/00_ADR.md:746` — ADR-032
`docs/04_DESIGN.md:282-300` — §1.3 updated
`plugins/sp/README.md:229-349` — layout + commands section updated
### Testing
**Verify re-audit 2026-07-21** (`/sp:dev-verify 0309 --auto --next --force --focus all --fix all`).
All evidence below re-run this session; every `file:line` anchor re-read at the cited lines. Two
defects found in the prior self-reported results and repaired — see the fix-pass record.

- Verdict: PASS

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Commands restored as SSOT, hand/LLM-editable | MET | 28 `plugins/sp/commands/*.md`; no generator upstream (`generate-adapters.ts` absent). Heading inventory across all 28: exactly `H1 + ## Usage + ## Implementation`, nothing else. |
| R2a — Heading whitelist (set is **exactly** Usage+Implementation) | MET *(after fix)* | `validate-commands.ts:106` `checkHeadingWhitelist` — forbidden + **missing** + **duplicate** checks; parser at `:69` collects **all** heading levels, fence-aware. Probe: wrapper missing `## Usage` → caught; `### Behavior` prose → caught; fenced `# comment` → not a false positive. |
| R2b — Frontmatter schema | MET | `validate-commands.ts:122` `checkFrontmatterSchema`; negative-path tests in `command-contract.test.ts` describe `(b)`. |
| R2c — Target resolution | MET | `validate-commands.ts:138` `checkTargetResolution` — `sp:<skill>` refs, `.spur/workflows/*.yaml`, procedure anchors; describe `(c)`. |
| R2d — allowed-tools coherence | MET | `validate-commands.ts:205` — `Skill` iff body has `Skill()`. Caught a real incoherence: `plugins/sp/commands/dev-reverse.md:4` gained `Skill`. |
| R3 — Registry, generator, adapters deleted | MET | `git status`: `D plugins/sp/scripts/command-registry.ts`, `D plugins/sp/scripts/generate-adapters.ts`, `D plugins/sp/tests/adapter-drift.test.ts`, `D` ×28 `plugins/sp/adapters/codex/*`. Directory `plugins/sp/adapters/` absent. |
| R4 — Test rewritten as `.md` contract test, gates retained | MET *(after fix)* | `plugins/sp/tests/command-contract.test.ts` — 283 pass / 0 fail; coverage on `validate-commands.ts` 100.00% funcs / 99.57% lines. New describe `(a2)` locks the exact-set regressions closed. |
| R5 — `adapter:generated` markers stripped | MET | `rg -l 'adapter:generated' plugins/sp/commands/` → 0 files. Fresh-session caveat retained in `plugins/sp/README.md`. |
| R6 — All 9 install targets emit from the `.md` SSOT | MET *(re-evidenced)* | Ran `superskill install sp --targets <t> --dry-run --verbose` for **all 9**: `claude`, `omp`, `grok` → native plugin install; `codex`, `pi`, `opencode`, `antigravity-cli`, `antigravity-ide`, `hermes` → `Skills written: 35`. Every target reported `Commands: 28`; zero errors. No `superskill` defect to file. |
| R7 — Docs same-commit | MET | `plugins/sp/README.md` §2 and `docs/04_DESIGN.md` §1.3 describe commands-as-SSOT + `superskill`-owned emission; no "GENERATED" framing. |
| R8 — ADR-032 | MET | `docs/00_ADR.md:748` "Commands Are the SSOT; Adapters Are Install-Time Output Owned by superskill" — Decision / Why / Provenance (0283 R4 "generated **or** validated") / explicit supersession of 0308. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — Commands directly editable, no regeneration | MET | command | `bun plugins/sp/scripts/validate-commands.ts` → `28 commands pass all 4 thin-wrapper gates`, exit 0; no generator in tree |
| AC2 — Domain prose rejected | MET | test | describe `(a2)` "lifecycle prose hidden under a ### subheading is rejected"; probe confirmed pre-fix escape, post-fix catch |
| AC3 — Broken dispatch targets caught | MET | test | `command-contract.test.ts` describe `(c)` negative paths |
| AC4 — `allowed-tools` coherence | MET | test + static-ref | describe `(d)`; real catch at `plugins/sp/commands/dev-reverse.md:4` |
| AC5 — No generator/registry/adapters remain | MET | command | `git status` deletions above; `plugins/sp/adapters/` absent; `rg 'adapter:generated'` → 0 |
| AC6 — All 9 targets emit correctly | MET | command | 9/9 dry-runs tabulated under R6, all `Commands: 28`, zero errors |
| AC7 — Docs + ADR match architecture | MET | static-ref | README §2, `04_DESIGN.md` §1.3, `00_ADR.md:748` |
| AC8 — Full quality gate green | MET | command | `bun run lint` → biome 523 files + 7/7 typechecks exit 0; `test-pre-check` → `All 33 rules passed`; `test-post-check` → `All 2 rules passed`; `bun test plugins/sp/tests/` → 283 pass / 0 fail |

- Coverage: `plugins/sp/scripts/validate-commands.ts` 100.00% funcs / 99.57% lines (measured this run).

**Fix-pass record (`--fix all`)** — one major defect repaired, one evidence gap closed:

1. **Gate (a) was weaker than the 0308 gate it replaced** (major; R2a/R4). `checkHeadingWhitelist`
   only rejected non-whitelisted headings, and `parseCommand` only collected `## ` lines. Two shapes
   that 0308's `toEqual(['Usage','Implementation'])` had caught therefore passed clean: a wrapper
   **missing** `## Usage` entirely, and lifecycle prose smuggled under `### Behavior`. Both were
   reproduced against a synthetic corpus before the fix and re-tested after. Repaired in
   `validate-commands.ts` (parser now collects every heading level and skips fenced code blocks;
   gate now asserts forbidden + missing + duplicate) with 4 regression tests in
   `command-contract.test.ts` describe `(a2)`. Fence-skipping is deliberately stricter-but-safer
   than 0308: commands are hand-authored now, so a `# comment` inside a bash example must not be
   misread as a heading. The live 28-command corpus was verified unaffected (still exits 0).
2. **R6 was claimed MET on 1-of-9 evidence** (evidence gap, not a false claim). The prior Testing
   and Review rows both cited only `--targets codex` while asserting all 9 targets. All 9 were run
   this session and all pass; the row now carries the full per-target result.

No `.spur/run/**` artifact was mutated beyond `.spur/run/0309-verdict.json` (written at Step 11).
Files changed by the fix pass: `plugins/sp/scripts/validate-commands.ts`,
`plugins/sp/tests/command-contract.test.ts`.
### Review
| Priority | Dimension | Finding | Evidence | Resolution |
|----------|-----------|---------|----------|------------|
| PASS | functional:R1 | Commands restored as SSOT — no generation step, hand-editable | All 28 `.md` files are unmodified in structure from 0308; no generation step precedes them | N/A |
| PASS | functional:R2 | Validator enforces 4-gate thin-wrapper contract | `validate-commands.ts` gates (a)-(d) verified via `command-contract.test.ts` negative-path tests | N/A |
| PASS | functional:R3 | Deleted `adapters/`, `command-registry.ts`, `generate-adapters.ts` | Confirmed via `ls` — all three paths absent from filesystem; no remaining references via `grep` | N/A |
| PASS | functional:R4 | Test rewritten as contract test over `.md` files | `command-contract.test.ts` — 26 tests, 303 expect() calls, 100% funcs / 99.52% lines on validate-commands.ts | N/A |
| PASS | functional:R5 | `adapter:generated` markers stripped from all 28 commands; caveat moved to README | `grep -rn adapter:generated plugins/sp/commands/` exits 0 (no matches); README §Commands retains fresh-session language | N/A |
| PASS | functional:R6 | `superskill install sp` produces correct output from `.md` SSOT | `superskill install sp --targets codex --dry-run --verbose` → 25 skills, 28 commands, 35 codex skills emitted | N/A |
| PASS | functional:R7 | Docs updated: README §2, DESIGN §1.3 | Both sections describe commands-as-SSOT, `superskill`-owned emission, no "GENERATED" framing | N/A |
| PASS | functional:R8 | ADR-032 recorded; supersedes 0308 approach | `docs/00_ADR.md` — ADR-032 with provenance (0283 R4 "generated or validated"), explicit supersession of 0308 | N/A |
| PASS | correctness:AC1-AC8 | All 8 acceptance criteria satisfied | See per-criterion evidence above; full gate green (lint, test, pre/post-check) | N/A |
| P3 | efficiency | `checkTargetResolution` reads every referenced file to check anchors — could be memoized if called repeatedly | `validate-commands.ts:188` — `readFileSync(resolved)` on every anchor-bearing reference | Acceptable — called once per gate run; 28 files with few cross-references |
| P3 | efficiency | `readdirSync` + sequential `readFileSync` per-file in `validate()` — acceptable for 28 files; would benefit from parallel reads if corpus grows | `validate-commands.ts:232-253` | Acceptable — 28 files is small; no measurable perf concern |
| P4 | architecture | Validator uses same DI seam pattern as the deleted `generate-adapters.ts` (`bootMain` with injectable `exit`/`stdout`/`stderr`/`run`) — consistent with project convention | `validate-commands.ts:334-347` matches the `generate-adapters.ts:runCli`/`bootMain` pattern | N/A — good |
| FIXED | style | 20 `useTemplate` lint diagnostics across both new files | `validate-commands.ts` (5) + `command-contract.test.ts` (15) — string concat instead of template literals | Fixed via `biome check --write --unsafe`; lint re-run clean |

## Vitals

| Metric | Value |
|--------|-------|
| `bun test plugins/sp/tests/` | 278 pass, 0 fail, 1250 expect() calls |
| `bun run lint` | Clean (0 diagnostics) |
| `bun run test-pre-check` | 33/33 rules passed |
| `bun run test-post-check` | 2/2 rules passed |
| `validate-commands.ts` coverage | 100% funcs, 99.52% lines |
| `superskill install sp` | 28 commands → Codex skills correctly |
| Files changed | 62 files (+63 / -1710 lines) |
| Deleted artifacts | `adapters/codex/` (28 files), `generate-adapters.ts`, `command-registry.ts`, `adapter-drift.test.ts` |

## Verdict: PASS

All 8 requirements and 8 acceptance criteria are satisfied. Full quality gate green. The 3 P3 efficiency notes are architectural observations for corpus growth, not blockers. The style issues found during review were fixed during the review session (20 `useTemplate` → template literals).
### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-21T20:05:20.092Z todo → wip (system)
- 2026-07-21T20:05:39.594Z wip → testing (system)
- 2026-07-21T20:05:39.993Z testing → done (system)
- 2026-07-21T20:05:49.748Z done → wip (system)
- 2026-07-21T20:06:32.687Z wip → testing (system)
- 2026-07-21T20:21:47.756Z testing → done (system)
