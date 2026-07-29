---
name: task-l3-guard-cheatsheet
description: First-write formats for task lifecycle transitions, Solution citations, Review findings, verdict artifacts, and canonical sections.
see_also:
  - spur-cli
  - task-section-editing
---

# Task L3 guard cheat sheet

Read this before writing `Solution`, `Testing`, or `Review`. The owning implementations are
`.spur/workflows/task-lifecycle.yaml`, `hasPopulatedPriorityTable()` in
`packages/app/src/services/task-check.ts`, the verdict normalizers in
`packages/app/src/services/task-record.ts`, and `TASK_CANONICAL_SECTIONS` in
`packages/domain/src/planning/markdown-document.ts`.

## Lifecycle graph

```text
backlog → todo → wip → testing → done
            ↕       ↕
          blocked ←→

done → wip
backlog|todo|wip|testing|blocked → cancelled
```

- `wip → testing` runs `spur task check <wbs>`.
- `testing → done` runs `spur task check <wbs> --strict-core`, followed by the PASS-verdict gate.
- Invalid: `todo → testing`, `todo → done`, and `wip → done`.
- Normal path: `backlog → todo → wip → testing → done`.

## Solution: `file:line`

The body needs at least one real citation with a filename or repository-relative path:

```markdown
| Change | Evidence |
| --- | --- |
| Preserve activity during roster failure | `apps/web/src/modules/teams/SupervisorTab.tsx:218` |
```

- Correct: `SupervisorTab.tsx:218`, `apps/web/src/modules/teams/SupervisorTab.tsx:218`.
- Wrong: `:218`, `line 218`, or a filename with no line.
- Re-read after formatting so the anchor is current.

## Review: populated P1–P4 table

`hasPopulatedPriorityTable()` requires a markdown row containing an exact `P1`, `P2`, `P3`, or
`P4` cell plus non-placeholder content:

```markdown
| Priority | Finding | File:Line | Disposition |
| --- | --- | --- | --- |
| P2 | Missing null guard | `src/foo.ts:42` | Fixed |
```

Prose-only reviews and rows containing only empty/placeholder cells do not pass.

## Verdict artifact

`.spur/run/<wbs>-verdict.json` uses arrays of normalized records:

```json
{
  "wbs": "0379",
  "verdict": "PASS",
  "requirements": [
    { "id": "R1", "status": "MET", "evidence": "plugins/sp/skills/code-testing/SKILL.md:55" }
  ],
  "acceptanceCriteria": [
    {
      "id": "AC-1",
      "status": "MET",
      "evidenceType": "test",
      "evidence": "bun test plugins/sp/tests: exit 0"
    }
  ],
  "checks": [
    { "name": "lint-clean", "status": "pass", "evidence": "bun run lint: exit 0" }
  ],
  "source": "spur-task-verdict"
}
```

- `requirements[]`: `{ id, status, evidence }`.
- `acceptanceCriteria[]`: `{ id, status, evidenceType, evidence }`.
- `checks[]`: `{ name, status, evidence }`.
- `verdict`: `PASS`, `PARTIAL`, `FAIL`, or `UNKNOWN`.
- Use `spur task verdict`/`spur task record` when a verify answer exists.

## Canonical section names

`Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`,
`Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes`.

`Verdict` is not a section. `Root Cause` is valid only for variants/statuses whose section matrix
allows it. Use `spur task sections <wbs> list --json` before adding an optional section.
