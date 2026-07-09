---
template: feature-impl
schema_version: 1
name: "migrate reverse-engineering skill and dev-reverse command from rd3 to sp"
description: "Port the rd3 reverse-engineering skill into the sp plugin. Migrate three files (SKILL.md, commands/dev-reverse.md, agents/openai.yaml) with the structural invariants applied: no rd3 references (R20), no cross-skill sp: refs to non-existent skills (R16b), and all wording normalized to sp vocabulary. Update README.md command index and directory layout as part of the same commit."
status: backlog
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0227"]
created_at: "2026-07-08T23:45:00.000Z"
updated_at: "2026-07-08T23:45:00.000Z"
---

## 0231. migrate reverse-engineering skill and dev-reverse command from rd3 to sp

### Background

The reverse-engineering skill in `plugins/rd3/skills/reverse-engineering/` is the only rd3 skill that closes a genuine gap in sp: no current sp skill covers codebase reverse engineering, HLD generation, audit-style readout, or onboarding documentation reconstructed from source. Other rd3 skills are **abandoned** — explicitly out of scope for porting; they are not candidates at any tier and their names should not appear in the sp plugin.

**Source files (all under `/Users/robin/projects/cc-agents/plugins/rd3/`):**

1. `plugins/rd3/commands/dev-reverse.md` — thin wrapper command. `allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob"]`. Args: `[<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>]`.
2. `plugins/rd3/skills/reverse-engineering/SKILL.md` — frontmatter: name `reverse-engineering`, version `1.1.0`, license `Apache-2.0`, tags `[analysis-core, reverse-engineering, hld, audit, codebase-analysis, architecture, design]`, metadata platforms `claude-code,codex,openclaw,opencode,antigravity,pi`, pipeline steps `orient, index, classify, trace, synthesize, audit`, `see_also: [rd3:quick-grep, rd3:knowledge-extraction, rd3:anti-hallucination, rd3:indexed-context]`. Body: 3 orthogonal controls (Mode/Focus/Format), Evidence Rules, Diagram Rules, Indexed Context Integration, Severity Definitions.
3. `plugins/rd3/skills/reverse-engineering/agents/openai.yaml` — flat YAML agent spec (name `reverse-engineering`, version `1.1.0`, icon `🔍`, category `debugging`).

**Target: `plugins/sp/skills/reverse-engineering/`** (does not exist — confirmed via glob).

**Constraints** (from `plugins/sp/tests/skill-structure.test.ts`):

- **R20** — No `rd3` substring, no `vendors/`, no `cc-agents/plugins/rd3` path allowed in any shipped plugin file. The current rd3 source contains `rd3:` references in five places (SKILL.md `see_also` block, command file delegation directives, command file platform notes, command file Additional Resources section). All must be removed or rewritten in sp vocabulary.
- **R16b** — Any `sp:<name>` reference must name an existing skill or agent. The `see_also` block in the rd3 source references `rd3:anti-hallucination`, which could naively map to `sp:anti-hallucination` — but **that skill does not exist in sp**. The brain plugin uses `sp:source-driven-development` as its source-first verification facade (per `source-driven-development/SKILL.md:29-32`). Mapping `rd3:anti-hallucination` → `sp:source-driven-development` is the truthful sp-vocabulary equivalent.
- **R16d** — Retired skill/agent names must not be referenced. Reverse-engineering does not collide with any retired name; safe.
- **R16c** — Relative markdown links must resolve. The current rd3 source has no intra-skill links to map; safe.

**Audit net recommendation (rationale for absorbing):** the sp plugin's existing skill roster (per `plugins/sp/README.md:248-267`) has no codebase-analysis or HLD-generation skill. `sp:code-improvement` is the architecture-depth review, but it presupposes a codebase the agent already knows. `sp:dogfood-testing` covers executable end-to-end verification, not static structural reconstruction. The reverse-engineering skill fills a genuine gap and aligns with the spirit of "Keep simplicity is the key" only because the migration is a copy-with-prefix-update — no new logic is being invented.

### Requirements

<!-- R-numbered list derived from the linked feature or refined task scope. -->

R1. `plugins/sp/skills/reverse-engineering/SKILL.md` MUST be a verbatim port of `plugins/rd3/skills/reverse-engineering/SKILL.md` with these mechanical prefix updates applied:
- `rd3:reverse-engineering` (the skill's own heading on line 33 of source) → `sp:reverse-engineering`.
- The `see_also` frontmatter block (lines 31-34 of source) contains four rd3 skill references. Three of them (`rd3:quick-grep`, `rd3:knowledge-extraction`, `rd3:indexed-context`) name rd3 skills that are not in sp and have no sp equivalent — drop those three entries. The fourth (`rd3:anti-hallucination`) maps cleanly to `sp:source-driven-development` (the sp facade for source-first verification per `source-driven-development/SKILL.md:29-32`); rename it and keep one entry. Net: `see_also` becomes `[sp:source-driven-development]`.
- Body text referencing `rd3:` skills in the Do-NOT-use list (lines 51-54 of source) and the Additional Resources section (lines 380-383): rewrite each callout to point to its sp equivalent where one exists, drop callouts that point to rd3 skills with no sp equivalent. Concrete mapping: `rd3:code-implement-common` → `sp:code-implementation`; `rd3:sys-debugging` → `sp:sys-debugging`; `rd3:tdd-workflow` → `sp:spur-tdd`; `rd3:quick-grep` (in the Do-NOT-use list and the Additional Resources list) — drop both callouts (no sp equivalent, see Q2). After all edits, the Additional Resources list at lines 378-381 collapses to one entry: `- **Claim verification**: \`sp:source-driven-development\``.
- Title heading line 33 (`# rd3:reverse-engineering — Codebase Reverse Engineering`) → `# sp:reverse-engineering — Codebase Reverse Engineering`.
- Codebase-analysis logic, Mode/Focus/Format tables, Phase workflow, Evidence Rules, Diagram Rules, Indexed Context Integration, Severity Definitions — all preserved verbatim (R20 only forbids `rd3` substrings; logic is independent).

R2. `plugins/sp/commands/dev-reverse.md` MUST be a verbatim port of `plugins/rd3/commands/dev-reverse.md` with these updates:
- `allowed-tools` frontmatter: add `Bash` (rd3 source omits `Bash` but sp commands that delegate to a skill use Bash for the spur CLI fallback per `README.md:301`; consistency with `dev-brainstorm.md`, `dev-plan.md`).
- Quick Start examples: `/rd3:dev-reverse` → `/sp:dev-reverse`.
- All `rd3:reverse-engineering` skill references → `sp:reverse-engineering`.
- Platform Notes section: rewrite the delegation example from `Skill("rd3:reverse-engineering")` to `Skill(skill="sp:reverse-engineering", args="$ARGUMENTS")`. For non-Claude platforms, reference the sp plugin's coordination model (Codex/OpenClaw/OpenCode/Antigravity/Pi read skills from the plugin's installed location).
- Backward Compatibility table (lines 67-72 of source): preserve verbatim — the legacy `--focus` semantics are CLI-facing, not plugin-facing.

R3. `plugins/sp/skills/reverse-engineering/agents/openai.yaml` MUST be a verbatim port of `plugins/rd3/skills/reverse-engineering/agents/openai.yaml` with these updates:
- `description` (line 2 of source): no `rd3` substring; rewrite the second sentence to drop the implicit rd3 vocabulary. Preserve the depth-mode enumeration and the "depth/focus/format" three-control framing.
- Tags (lines 7-13 of source): preserve verbatim — they describe what the agent does, not where it lives.

R4. README.md at `plugins/sp/README.md` MUST be updated in the same commit as the file ports, covering three changes (none are the migration's primary deliverable, but all are routine collateral):
- Command count (currently `README.md:212` says `23 slash-command definitions`, `README.md:288` says **24 commands**, `README.md:366` says **23 slash commands** — three different claims, none matching the actual 25 file count): reconcile to reflect the actual count after `dev-reverse.md` is added (= 26). Prefer one canonical line (line 288) and update the others to match, since 288 is the prose description closest to "live state".
- Version (currently `README.md:13` says `0.3.1`, but `plugins/sp/plugin.json` says `0.3.3`): reconcile to `0.3.3` (plugin.json is the source of truth per `.claude-plugin/marketplace.json`).
- Command index (lines 85-148): add `dev-reverse` row in the appropriate category. Reverse-engineering is analysis/onboarding, not lifecycle-step. Add to a new "Codebase analysis" subsection or fold into "Lifecycle — operations and hygiene" — choose the smallest placement that doesn't reorganize the index structure (the index is grouped by spur noun, and dev-reverse is closest in shape to `dev-arch`).
- Directory layout tree (lines 165-218): add `reverse-engineering` to the skills block. Add `agents/openai.yaml` under it. Preserve existing formatting (the tree uses `├── ... # comment` with column alignment).
- Skill registry table (lines 248-267): add a row for `reverse-engineering` with version, domain, and reference file list.
- Agents section (lines 306-330): the existing agents table lists only `expert-spur` and `super-coder`. The openai.yaml from `skills/reverse-engineering/agents/openai.yaml` is NOT a top-level agent under `plugins/sp/agents/` — confirm this is intentional. Per `README.md:278`, "Some skills (`brainstorm`, `daily-summary`) carry `agents/openai.yaml` for multi-model dispatch." So the openai.yaml is a sub-agent of the skill, not a top-level plugin agent. No update needed to the agents section.

R5. R20 MUST pass after the migration. The contract: `bun test plugins/sp/tests/skill-structure.test.ts` MUST report 0 failures, and the `R20` test specifically MUST emit no offenders.

R6. R16b MUST pass after the migration. The contract: same command as R5, R16b test specifically MUST emit no offenders. This requires that every `sp:<name>` reference in the three ported files names an existing skill or agent.

R7. Lint and typecheck gates MUST pass (`bun run lint` from repo root). The contract: biome check + per-workspace typecheck all exit 0.

R8. The full test suite MUST remain green when the migration is complete. The contract: `bun test ./apps/cli ./apps/server ./apps/web ./packages ./plugins` continues to pass with no new failures. No test is skipped, marked `.skip`, or commented out to go green.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

#### AC-1: SKILL.md exists at the sp target location

- **Given** the migration has been run
- **When** the file tree is inspected
- **Then** `plugins/sp/skills/reverse-engineering/SKILL.md` exists
- **And** it is non-empty (>= 5 KB body, indicating real content vs an empty stub)
- **And** its frontmatter `name:` field is `reverse-engineering`

#### AC-2: SKILL.md contains zero `rd3` substrings (R20)

- **Given** the migrated SKILL.md
- **When** `rg "\brd3\b" plugins/sp/skills/reverse-engineering/` is run
- **Then** zero matches are emitted

#### AC-3: SKILL.md `see_also` resolves to existing sp skills (R16b)

- **Given** the migrated SKILL.md frontmatter
- **When** the `see_also` entries are inspected
- **Then** every entry matches `\bsp:[a-z][a-z0-9-]+\b`
- **And** every sp: skill named in `see_also` exists under `plugins/sp/skills/`
- **And** the entry for `anti-hallucination` is replaced with `sp:source-driven-development` (or another existing sp equivalent)

#### AC-4: SKILL.md preserves the three-control model

- **Given** the migrated SKILL.md body
- **When** the section headings are inspected
- **Then** the file contains all of: "Mode: Analysis Depth", "Focus: Analysis Lens", "Format: Output Encoding" (the three-orthogonal-control table set)
- **And** the file contains all six Phase headings ("Orient", "Index", "Classify", "Trace", "Synthesize", "Audit")
- **And** the file contains the "Evidence Rules", "Diagram Rules", "Indexed Context Integration" sections

#### AC-5: dev-reverse.md command exists at the sp target location

- **Given** the migration has been run
- **When** the commands directory is inspected
- **Then** `plugins/sp/commands/dev-reverse.md` exists
- **And** the file count under `plugins/sp/commands/` is 26 (was 25)
- **And** the file's `allowed-tools` frontmatter includes `Bash` (for CLI delegation parity with sibling commands)

#### AC-6: dev-reverse.md contains zero `rd3` substrings (R20)

- **Given** the migrated dev-reverse.md
- **When** `rg "\brd3\b" plugins/sp/commands/dev-reverse.md` is run
- **Then** zero matches are emitted

#### AC-7: openai.yaml agent exists at the sp target location

- **Given** the migration has been run
- **When** the skill directory is inspected
- **Then** `plugins/sp/skills/reverse-engineering/agents/openai.yaml` exists
- **And** its `name:` field is `reverse-engineering`
- **And** no `rd3` substring appears in any field

#### AC-8: structural invariant tests pass

- **Given** the three files have been migrated
- **When** `bun test plugins/sp/tests/skill-structure.test.ts` is run
- **Then** all tests pass (38 tests / 247 expect() calls in current baseline; count may increase if new invariants are added, but must not decrease)
- **And** specifically the R20 test emits zero offenders
- **And** specifically the R16b test emits zero offenders

#### AC-9: lint + typecheck + full test suite pass

- **Given** the migration is complete
- **When** `bun run lint` is run
- **Then** exit code is 0
- **And** per-workspace `tsc --noEmit` exits 0
- **When** `bun test ./apps/cli ./apps/server ./apps/web ./packages ./plugins` is run
- **Then** exit code is 0
- **And** no test is skipped, marked `.skip`, or commented out to go green

#### AC-10: README.md reconciliations are in the same commit

- **Given** the migration is complete
- **When** `git log -1 --name-only` (or the equivalent) is inspected
- **Then** the commit's file list includes all three ported files plus `plugins/sp/README.md`
- **And** README.md no longer claims `version: "0.3.1"` (it should read `0.3.3` to match `plugins/sp/plugin.json`)
- **And** README.md's command count (whichever line is canonical) matches the actual `commands/` count of 26 after the migration
- **And** README.md's directory layout tree includes the new `reverse-engineering` skill block
- **And** README.md's skill registry table (lines 248-267) includes a row for `reverse-engineering`

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

**Q1: Why migrate the openai.yaml sub-agent at all? It is an internal dispatch artifact.**

A: It is not a top-level agent (those live under `plugins/sp/agents/*.md` per the agents section in README.md). The `agents/openai.yaml` is a multi-model-dispatch sub-agent of the skill itself, per the existing pattern (`brainstorm/agents/openai.yaml`, `daily-summary/agents/openai.yaml`). The R20 invariant covers all shipped plugin files including YAML — porting it preserves the skill's runtime shape and avoids a regression in multi-model dispatch when the skill is consumed cross-platform.

**Q2: Why drop `rd3:quick-grep`, `rd3:knowledge-extraction`, `rd3:indexed-context` from `see_also` rather than naively prefix-update them to `sp:quick-grep` etc.?**

A: R16b requires every `sp:<name>` reference to name a skill that actually exists in the plugin. The sp plugin has no `quick-grep`, `knowledge-extraction`, or `indexed-context` skill (verified by `ls plugins/sp/skills/`). Naive prefix-update would produce dangling references that fail the structural gate. The faithful approach: drop entries that don't have an sp equivalent, and add a one-line note that `sp:source-driven-development` is the sp skill for source-first verification (replacing `rd3:anti-hallucination`). The other three do not have sp equivalents and the rd3 skills that house them are abandoned — they are not future absorption candidates.

**Q3: Should the README command count be reconciled to 24, 25, or 26?**

A: The actual count after migration will be 26 (current 25 + `dev-reverse`). The README currently has three different counts (`README.md:212` says 23, `:288` says 24, `:366` says 23) — all stale. The smallest, most truthful fix: update line 288 to 26 (the canonical prose description) and update lines 212 + 366 to match. This is a one-commit collateral update; future drift will be caught by the R23-style ignore-rule checks if added, or by manual review.

**Q4: Why a separate `agents/openai.yaml` instead of promoting it to `plugins/sp/agents/reverse-engineering.md`?**

A: Top-level plugin agents are subject to `super-coder` style composition — they own a delegation surface and `tools: [Read, Grep, Glob, Bash, Skill]`. Sub-skill agents (the `agents/openai.yaml` files under `skills/<name>/agents/`) are flat YAML specs consumed by the skill's own runtime; they are not first-class agents in the plugin's agent table. Porting the openai.yaml preserves the skill's existing dispatch behavior across platforms (Codex, OpenClaw, OpenCode, Antigravity, pi consume the YAML; Claude Code consumes the .md). Promoting it would alter runtime shape and is out of scope for a fidelity migration.

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

**Approach: copy-with-prefix-update + R20/R16b scrub. Mechanical, no new logic.**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Port strategy | Copy the three rd3 files byte-for-byte, then apply mechanical renames | Avoids re-authoring an audit-tool skill; lowest risk of regression |
| SKILL.md `see_also` | Drop `quick-grep`, `knowledge-extraction`, `indexed-context`; map `anti-hallucination` → `source-driven-development` | R16b requires `sp:` refs to resolve; truthful mapping preserves sp vocabulary |
| dev-reverse.md delegation text | Update `Skill("rd3:reverse-engineering")` → `Skill(skill="sp:reverse-engineering", args="$ARGUMENTS")` | Matches the delegation pattern used in sibling commands like `dev-brainstorm.md` |
| README.md version reconciliation | `0.3.1` → `0.3.3` (matches `plugins/sp/plugin.json`) | plugin.json is the source of truth |
| README.md command count | Update all three locations (`:212`, `:288`, `:366`) to `26` | Avoids future drift complaints; smallest simultaneous fix |
| README.md directory layout | Add `reverse-engineering/` block with SKILL.md and agents/openai.yaml | Preserves the tree's existing format |
| README.md skill registry | Add row for `reverse-engineering` with version `1.1.0`, domain "Codebase analysis / HLD generation / audit" | New row keeps the table authoritative |
| No agent promotion | Keep `agents/openai.yaml` as a sub-skill agent (not promoted to `plugins/sp/agents/`) | Preserves runtime shape across platforms |

**Impacted surfaces (4 files, one commit):**

1. `plugins/sp/skills/reverse-engineering/SKILL.md` — new file (port + scrub).
2. `plugins/sp/skills/reverse-engineering/agents/openai.yaml` — new file (port + scrub).
3. `plugins/sp/commands/dev-reverse.md` — new file (port + scrub).
4. `plugins/sp/README.md` — in-place edit (command count, version, command index, directory layout, skill registry table).

**No engine code changes. No test changes.** The structural invariant test suite (`plugins/sp/tests/skill-structure.test.ts`) already covers R13, R16a-d, R20, R21 and validates the migration automatically.

**Tradeoffs:**

- *Risk of stale `rd3:` content surviving the migration* — mitigated by the explicit R20 gate (`grep` for `\brd3\b` in shipped files) which is a structural test, not just a one-time manual check.
- *Risk of dangling `sp:` references* — mitigated by R16b which runs as part of the structural test suite.
- *No behavior verification* — the port is byte-for-byte where logic is concerned; behavior preservation is trivial since only prefixes change.
- *README.md collateral* — three location reconciliations in one file. Acceptable per AGENTS.md's "same commit" sync rule.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

- [ ] **P1**: Read `plugins/rd3/skills/reverse-engineering/SKILL.md` once more to confirm latest content. Create `plugins/sp/skills/reverse-engineering/` directory.
- [ ] **P2**: Copy `SKILL.md` to `plugins/sp/skills/reverse-engineering/SKILL.md`. Apply prefix updates: title heading `rd3:` → `sp:`, `see_also` block rewrite (4 entries → 1 entry), body `rd3:` references in Do-NOT-use list (4 entries → sp equivalents or drops), Additional Resources block (rewrite to sp vocabulary or drop).
- [ ] **P3**: Create `plugins/sp/skills/reverse-engineering/agents/`. Copy `openai.yaml`. Apply prefix updates: drop any `rd3` substring in description; tags unchanged.
- [ ] **P4**: Copy `commands/dev-reverse.md` to `plugins/sp/commands/dev-reverse.md`. Apply prefix updates: add `Bash` to `allowed-tools`, all `rd3:` references → `sp:`, Quick Start `/rd3:dev-reverse` → `/sp:dev-reverse`, Platform Notes rewrite.
- [ ] **P5**: Update `plugins/sp/README.md`: version (`:13`), command count (`:212`, `:288`, `:366`), command index (add `dev-reverse` row), directory layout tree (add `reverse-engineering/` block + openai.yaml), skill registry table (add row).
- [ ] **P6**: Run `rg "\brd3\b" plugins/sp/` — verify zero matches.
- [ ] **P7**: Run `rg "\bsp:[a-z][a-z0-9-]+\b" plugins/sp/skills/reverse-engineering/ plugins/sp/commands/dev-reverse.md` — manually inspect each match to confirm R16b compliance.
- [ ] **P8**: Run `bun test plugins/sp/tests/skill-structure.test.ts` — verify all 38 tests pass (R20, R16b clean).
- [ ] **P9**: Run `bun run lint` from repo root — verify clean.
- [ ] **P10**: Run `bun test ./apps/cli ./apps/server ./apps/web ./packages ./plugins` — verify no regressions.
- [ ] **P11**: Write Solution + Testing sections, transition `wip → testing → done`.
- [ ] **P12**: Commit with message declaring the migration + the README reconciliation in the same commit (per docs/99_PROJECT_CONSTITUTION.md sync rule).

### Solution

_Filled during implementation. Each step below cites file:line for traceability. **P1 — file ports executed** at `plugins/sp/skills/reverse-engineering/SKILL.md:1`, `plugins/sp/skills/reverse-engineering/agents/openai.yaml:1`, `plugins/sp/commands/dev-reverse.md:1`, with the README reconciliation at `plugins/sp/README.md:13`.


### Testing

<!-- Coverage: N/A for documentation-only tasks; otherwise, line + branch coverage percentages. -->

_Filled during implementation._

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: H1 (spur-dev umbrella skill)
- Source skill: `/Users/robin/projects/cc-agents/plugins/rd3/skills/reverse-engineering/SKILL.md`
- Source command: `/Users/robin/projects/cc-agents/plugins/rd3/commands/dev-reverse.md`
- Source agent: `/Users/robin/projects/cc-agents/plugins/rd3/skills/reverse-engineering/agents/openai.yaml`
- sp plugin structural invariants: `plugins/sp/tests/skill-structure.test.ts` (R20, R16b relevant)
- sp plugin README: `plugins/sp/README.md`
- Super-reviewer (existing sp subagent with `openai.yaml` pattern precedent): `plugins/sp/skills/brainstorm/agents/openai.yaml`
- Task 0227 (introduced three-dimensional review; found super-reviewer.md's `sp:anti-hallucination` is a latent dangling reference the current R16b doesn't catch): `docs/tasks2/0227_enhance-the-review-capability-in-plugin-sp.md`
