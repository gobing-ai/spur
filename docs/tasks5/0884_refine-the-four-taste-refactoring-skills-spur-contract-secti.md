---
schema_version: 1
name: "Refine the four taste-refactoring skills: Spur contract sections, standard metadata frontmatter, preserved-behavior inventory, and an api CLI protocol mode"
status: todo
template: feature-impl
created_at: 2026-09-17T17:49:42.538Z
updated_at: "2026-09-17T17:52:35.605Z"
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

- [ ] R1. Each of the four `SKILL.md` files gains `license: Apache-2.0` and a `metadata` block (author, version, platforms, category, interactions) matching sibling skills such as `code-simplification`; `plugins/sp/README.md` skills table shows the version instead of `—`.
- [ ] R2. Each `SKILL.md` gains one `## Spur contract` section of at most 40 lines that states: inputs it receives from `sp:code-refactoring` (scope path, description, focus), what to read first, how each native finding maps to the shared `refactor-finding` fields, the lens's native → P1–P4 severity mapping (design §5 row), and stop rules; no other section of the skill is rewritten.
- [ ] R3. Each `## Spur contract` requires a preserved-behavior inventory (endpoints / modules / test-protected behaviors / UI controls in scope) emitted before proposals and a `preservation` class on every proposal; for api this reuses the existing additive/risky/breaking classification, for ui it defines control/interaction removal as `cutting`.
- [ ] R4. `plugins/sp/skills/taste-refactoring-api/references/protocol-modes.md` gains a `## CLI mode` section covering noun/verb grammar, flag vocabulary consistency, exit codes, `--json` envelope stability, help-text parity, and additive-vs-breaking rules for command surfaces; the SKILL.md mode list references it.
- [ ] R5. Existing structure files (`README.md`, `checklists/`, `examples/`, `references/`) remain valid; plugin structure tests and `bun run spur-check` pass; a diff review confirms no principle, pass order, or native output section changed.

### Acceptance Criteria

Covers feature H13 scenarios:

- [ ] R4 — Taste skills carry a Spur contract, metadata, and preserved-behavior inventory

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
