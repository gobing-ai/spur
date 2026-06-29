---
schema_version: 1
name: "Enhance sp:dev-review with architecture/deep-review capability"
description: ""
status: todo
type: review
template: review
profile: standard
feature_id: H3
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-29T00:28:36.096Z"
updated_at: 2026-06-29T00:29:36.724Z
---

## 0149. Enhance sp:dev-review with architecture/deep-review capability

### Background
Migration review found that `/sp:dev-review` now covers the core SECU path through
`sp:code-verification`, but it did not preserve the old `rd3:dev-review` architecture/deepening
capability backed by `rd3:code-improvement`.

Current state:

- `plugins/sp/commands/dev-review.md` accepts a task WBS and delegates to
  `sp:code-verification` review mode.
- `plugins/sp/skills/code-verification` covers Security, Efficiency, Correctness, and Usability.
- The old rd3 command supported a fifth `architecture` focus and delegated that slice to
  `rd3:code-improvement`.
- `plugins/sp/skills/` has no equivalent `code-improvement` or architecture-review skill.

This is not a blocker for normal review, but it is a capability gap for making
`sp:dev-review` a powerful review and issue-fixing tool. Architecture review should not be
silently blended into SECU; it needs its own procedure and output contract.

#### Review Findings

The code-review findings this task must address — logged here as **input** (what was found
in the reviewed PR/commit/diff). Fix in priority order (P1 → P2 → …); re-review after.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `plugins/sp/commands/dev-review.md` | The `sp` review surface lacks the old rd3 `architecture` focus and has no delegated architecture/deepening reviewer. | Add an architecture/deep-review capability, either by creating an `sp:code-improvement` skill or by adding a clearly separated architecture-review mode behind `sp:dev-review`. |
| P2 | `plugins/sp/skills/code-verification/references/secu-review.md` | SECU is intentionally limited to S/E/C/U; forcing architectural deepening into it would blur quality review with refactor discovery. | Keep SECU source review separate from architecture/deepening review; define how findings merge in the task `## Review` section. |
| P3 | `plugins/sp/skills/spur-dev/references/dev-operations.md` | The operation map documents only SECU review, so users cannot discover architecture-focused review from the `sp` command surface. | Update the operation contract and examples after the architecture-review behavior is designed. |
### Plan
- [ ] Decide the surface: either `--focus architecture` on `/sp:dev-review`, a separate `--depth <survey|deep>` modifier, or a distinct command/skill entry if mixing it into review creates too much ambiguity.
- [ ] Port or rewrite the useful parts of `rd3:code-improvement`: deletion test, shallow-module detection, locality/leverage framing, ADR-aware constraints, and survey vs deep modes.
- [ ] Define how architecture findings are written to `## Review` alongside SECU findings without weakening the P1-P4/L3 checker expectations.
- [ ] Keep `--auto` behavior explicit: under auto, run survey mode and skip grilling loops; deep mode can propose a follow-up task rather than starting an interactive design session.
- [ ] Update `plugins/sp/commands/dev-review.md`, `plugins/sp/skills/code-verification` or the new skill, and `plugins/sp/skills/spur-dev/references/dev-operations.md` in the same change.
- [ ] Dogfood on a non-trivial task or package path and verify the output finds actionable architecture candidates, not generic refactor advice.
### Review
Post-implementation reflection — filled after the first fix round.

| Sev | Area | Finding | Resolution |
| --- | ---- | ------- | ---------- |
| P1 | - | None identified at task creation. | - |
| P2 | Review capability | `sp:dev-review` lacks an architecture/deepening review path equivalent to old `rd3:dev-review --focus architecture`. | Track and implement through this task. |
| P3 | Command discoverability | The current operation contract advertises only SECU review. | Update command/operation docs when the architecture-review surface is selected. |
| P4 | - | None identified at task creation. | - |
### References
- `plugins/sp/commands/dev-review.md`
- `plugins/sp/skills/code-verification/SKILL.md`
- `plugins/sp/skills/code-verification/references/secu-review.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/commands/dev-review.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/code-review-common/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/code-improvement/SKILL.md`
- `docs/features/H3_prompt-skill-moves.md`
### History
