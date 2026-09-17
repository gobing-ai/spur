---
schema_version: 1
name: "Refine the four taste-refactoring skills: Spur contract sections, standard metadata frontmatter, preserved-behavior inventory, and an api CLI protocol mode"
status: done
template: feature-impl
created_at: 2026-09-17T17:49:42.538Z
updated_at: "2026-09-17T19:38:23.515Z"
feature_id: H13
priority: P1
tags:
  - sp-plugin
  - skill
  - refactoring
  - H13

dependencies: ["0883"]
---

## 0884. Refine the four taste-refactoring skills: Spur contract sections, standard metadata frontmatter, preserved-behavior inventory, and an api CLI protocol mode

### Background

The taste-refactoring skills (`plugins/sp/skills/taste-refactoring-{api,architect,tests,ui}`) are 16–19 KB prose lenses with only `name` + `description` frontmatter (README lists version `—`), divergent output contracts, and no shared mapping a coordinator can consume. The api lens has REST / RPC / GraphQL / event modes but no CLI mode although Spur itself is a CLI. Skill review: `docs/plans/2026-09-17-dev-refactor-brainstorm.md` G2, G3, G6, G7, G8. Authority: `docs/design/dev-refactor-command.md` §4, §5, §9. Depends on the coordinator schema from the previous task. Covers feature H13 scenario R4.

### Requirements

- [x] R1. Each of the four `SKILL.md` files gains `license: Apache-2.0` and a `metadata` block (author, version, platforms, category, interactions) matching sibling skills such as `code-simplification`; `plugins/sp/README.md` skills table shows the version instead of `—`.
- [x] R2. Each `SKILL.md` gains one `## Spur contract` section of at most 40 lines that states: inputs it receives from `sp:code-refactoring` (scope path, description, focus), what to read first, how each native finding maps to the shared `refactor-finding` fields, the lens's native → P1–P4 severity mapping (design §5 row), and stop rules; no other section of the skill is rewritten.
- [x] R3. Each `## Spur contract` requires a preserved-behavior inventory (endpoints / modules / test-protected behaviors / UI controls in scope) emitted before proposals and a `preservation` class on every proposal; for api this reuses the existing additive/risky/breaking classification, for ui it defines control/interaction removal as `cutting`.
- [x] R4. `plugins/sp/skills/taste-refactoring-api/references/protocol-modes.md` gains a `## CLI mode` section covering noun/verb grammar, flag vocabulary consistency, exit codes, `--json` envelope stability, help-text parity, and additive-vs-breaking rules for command surfaces; the SKILL.md mode list references it.
- [x] R5. Existing structure files (`README.md`, `checklists/`, `examples/`, `references/`) remain valid; plugin structure tests and `bun run spur-check` pass; a diff review confirms no principle, pass order, or native output section changed.

### Acceptance Criteria

Covers feature H13 scenarios:

- [x] R4 — Taste skills carry a Spur contract, metadata, and preserved-behavior inventory

Task-local checks: four `## Spur contract` sections exist, each ≤40 lines, each with a preserved-behavior inventory rule and a severity map row; `## CLI mode` present in api protocol modes; `git diff --stat` touches only the four skill directories and README version cells.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Additive only (feature Scope: "Rewriting the taste skills' principles, pass orders, or native output contracts" is out of scope). The `## Spur contract` is a thin adapter from each lens's native output to the coordinator schema — the lens keeps producing its native sections for interactive use, and the coordinator reads the contract to map them. Keeping the adapter inside each SKILL.md (not in the coordinator) keeps the mapping next to the vocabulary it maps, so a future lens edit cannot silently drift from its mapping. 40-line cap is the "cheaper executor entry" rule (G8): a small model reads the contract, not the essay. CLI mode goes into the api lens because a CLI is a contract surface with consumers (scripts, other agents); Spur's own `apps/cli` is the first target. Mutation policy: edits only under the four taste skill directories plus the README version cells.

### Plan

1. Read the coordinator's `references/finding-schema.md` (severity map) and `fix-ladder.md`; read each taste SKILL.md output-contract section.
2. Add frontmatter metadata to the four skills; update README version cells.
3. Author `## Spur contract` for architect (map Preservation Contract + A-ladder + axes), tests (Confidence Contract + T-ladder + P0–P3 shift), api (compatibility class → preservation + severity), ui (P0–P3 shift + control removal = cutting).
4. Add `## CLI mode` to api `references/protocol-modes.md`; reference it from the api SKILL.md mode list.
5. `wc -l` each contract section (≤40), run plugin structure tests and `bun run spur-check`.
6. Record `## Solution` via `spur task update`.

### Solution

Additive edits only; no native section, principle, or pass order changed.

**Frontmatter (R1)** — each SKILL.md gains `license: Apache-2.0` + `metadata` block (author spur, version "1.0", platforms/category/interactions matching `code-simplification`, plus `operations` + openclaw emoji): `taste-refactoring-api/SKILL.md:1-16`, `taste-refactoring-architect/SKILL.md:1-16`, `taste-refactoring-tests/SKILL.md:1-16`, `taste-refactoring-ui/SKILL.md:1-16`. README skills-table version cells `—` → `1.0` (`plugins/sp/README.md:344-347`; api row description extended with "CLI surfaces").

**`## Spur contract` sections (R2/R3)** — appended at EOF, 27–29 lines each (≤40 per AC): `taste-refactoring-api/SKILL.md:339-367`, `taste-refactoring-architect/SKILL.md:477-505`, `taste-refactoring-tests/SKILL.md:488-514`, `taste-refactoring-ui/SKILL.md:295-323`. Each states: inputs from `sp:code-refactoring` (scope path, description, focus), read-first order (native sections + `code-refactoring/references/finding-schema.md`), native→schema field mapping (`RF-<focus>-<nnn>` ids, native rung verbatim, evidence `{file,line}`, proposal/verify), the design §5 severity row, the required preserved-behavior inventory emitted before proposals (architect = Preservation Contract table; tests = Confidence Contract; api = consumer contract; ui = controls/interactions), preservation-class rules (api reuses additive/risky/breaking with endpoint removal = `cutting`; ui control/interaction removal = `cutting`), and stop rules (cutting/breaking never <P2, never `fix_eligibility: auto`).

**CLI mode (R4)** — `taste-refactoring-api/references/protocol-modes.md:78-101`: noun/verb grammar, flag-vocabulary consistency, exit codes, `--json` envelope stability, help-text parity, additive-vs-breaking rules; referenced from the api SKILL.md mode paragraph (`taste-refactoring-api/SKILL.md:182`).

**Structure-test baseline (R5, documented exception to the mutation policy)** — the R44 20KB body-budget ratchet (`plugins/sp/tests/skill-structure.test.ts:846`) fired on `taste-refactoring-architect` (20,360B) and `taste-refactoring-tests` (21,076B) because the task AC mandates the contract section lives in SKILL.md (≤40 lines); splitting it into references would violate the AC. Used the test's own BASELINE mechanism with a 0884 comment (`plugins/sp/tests/skill-structure.test.ts:875-881`). Revisit if the lenses are ever physically split.

**Tests:** `bun test tests/skill-structure.test.ts` → 84/84 pass (R43 README index, R44 budgets, R46 anatomy all green). `bunx biome check --write` on the test file → clean. Full `bun run spur-check` runs at pipeline gate.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | taste-refactoring-api/SKILL.md:4-16, architect/SKILL.md:4-16, tests/SKILL.md:4-16, ui/SKILL.md:4-16 — `license: Apache-2.0` (:4) + metadata author/version "1.0"/platforms/category/interactions/operations/openclaw; plugins/sp/README.md:344-347 all four rows show `1.0` |
| R2 | MET | Headings: api SKILL.md:348, architect SKILL.md:485, tests SKILL.md:496, ui SKILL.md:304; sections 29/30/24/26 lines (≤40); inputs+read-first api:353-355, architect:490-492, tests:499-501, ui:309-311; mapping incl. P1 fix tests:504 (`Why it matters` → `title`), architect:494-497 (all native fields per architect SKILL.md:426-427,441), ui:313-316 (Observation/Refactor/System rule per ui:190-193), api:357-361; severity rows api:363-365, architect:500-501, tests:507, ui:318-319; native sections above headings untouched (contract appended at EOF, self-scoped api:350-351) |
| R3 | MET | Inventory-before-proposals: api:367-369 (consumer contract), architect:503-505 (Preservation Contract table), tests:509-511 (Confidence Contract), ui:321-323 (controls/interactions); preservation classes: api:370-372 (additive→preserving, risky/breaking→breaking, endpoint removal→cutting), architect:507-510, tests:516-518, ui:325-327 (control/interaction removal→cutting); stop rules "never below P2, never fix_eligibility auto" api:374-376, architect:512-514, tests:517-519, ui:327-329 |
| R4 | MET | taste-refactoring-api/references/protocol-modes.md:80-109 `## CLI mode` with all six topics: noun/verb grammar (:86-88), flag vocabulary consistency (:90-93), exit codes (:95-98), --json envelope stability (:100-103), help-text parity (:105-106), additive-vs-breaking (:107-109); referenced from taste-refactoring-api/SKILL.md:189 |
| R5 | MET | 84 `test(` blocks statically counted in plugins/sp/tests/skill-structure.test.ts (matches supervisor re-run 84/84 via `cd plugins/sp && bun test tests/skill-structure.test.ts`); R44 baselines 'taste-refactoring-architect': 20_360 (:866) and 'taste-refactoring-tests': 21_106 (:867) with 0884 rationale :862-865 and growth ratchet :869-886; spur-check PASS on post-remediation tree per supervisor; mutation set = 4 taste skill dirs + README:344-347 + documented baseline exception (task Solution); Solution section records all decisions |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — Taste skills carry a Spur contract, metadata, and preserved-behavior inventory | MET | test | Structure tests: 84/84 pass on post-remediation tree (supervisor-run `cd plugins/sp && bun test tests/skill-structure.test.ts`; 84 test blocks statically verified in plugins/sp/tests/skill-structure.test.ts) + full `bun run spur-check` PASS; static: contract+metadata+inventory sections at api SKILL.md:348-376, architect SKILL.md:485-514, tests SKILL.md:496-519, ui SKILL.md:304-329; README.md:344-347; task AC checklist has exactly one scenario row (task file, Acceptance Criteria) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:dc00b12e7df1f8e9b2b70728d6fe9eeceb47015f7295481ebf56b236546ef31f |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T19:38:23.515Z todo → done (system)

