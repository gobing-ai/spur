---
schema_version: 1
name: Unclosed code fence hides later sections and section writes silently drop them
status: todo
template: feature-impl
created_at: 2026-09-29T07:03:58.072Z
updated_at: "2026-09-29T07:04:49.890Z"
feature_id: F91

estimate_hours: 4
---

## 1008. Unclosed code fence hides later sections and section writes silently drop them

### Background

Found by the A9 session review (2026-09-29). The A9 feature file (`docs/features/A9_*.md`) was written by the idea pipeline with an Acceptance Criteria ```` ```gherkin ```` fence that was never closed (line 40). `findHeadings` in `packages/domain/src/planning/markdown-document.ts:102` toggles on ```` ``` ```` lines, so every heading after an unclosed fence is invisible:

- `feature check A9` reported 0 errors, while `hasSection('Tasks')` was false.
- `feature refresh` silently skipped A9's roster (`feature-service.ts:374` `continue`), which failed `packages/app/tests/services/feature-service.test.ts` R3 dogfood (line 471).
- `feature update A9 --section "Acceptance Criteria"` treated the section as running to EOF and **deleted `## Tasks`, `## Notes`, `## History`**. The CLI then refused to write `Tasks` ("does not contain section"), so the repair needed a raw append.

Already fixed in session (not in scope): the A9 fence was closed and its tail restored; the roster was refreshed. Where the idea pipeline dropped the closing fence is unconfirmed (hypothesis: the AC writer emitted an unterminated block).

### Requirements

- [ ] R1. `MarkdownDocument` exposes whether the body ends inside an open fence (for example `unclosedFenceLine(): number | null`, the 1-based line of the opening fence). The heading scan is unchanged.
- [ ] R2. `spur task check` and `spur feature check` report an unclosed fence as an **error** finding (code `UNCLOSED_CODE_FENCE`, with the line). `--fix` does not auto-close it (the intended end is ambiguous).
- [ ] R3. Every section writer (`task update --section`, `feature update --section`, and `replaceSection`/`replaceMarkerRegion` callers through the planning write service) refuses to write when either (a) the new section body has an odd count of ```` ``` ```` fence lines, or (b) the serialized result would have fewer top-level sections than the input. The command exits non-zero with a message naming the fence line or the dropped sections, and writes nothing.
- [ ] R4. `feature refresh` reports features skipped because of a missing Tasks region in its JSON (`skipped: [{id, reason}]`) instead of skipping them silently. This is an observable-output change only, with no new flag.

### Acceptance Criteria

- [ ] AC1 — Checks flag an unclosed code fence as an error (req: R1, R2)
- [ ] AC2 — Section writes never drop later sections (req: R3)
- [ ] AC3 — Refresh reports features it could not populate (req: R4)

Task-local observability: domain unit tests for R1/R3 (an unclosed-fence body and a body that drops sections are both rejected, and no file changes); CLI tests for `task check`/`feature check` on a fixture with an unclosed fence (error present); a `feature-service` refresh test with a malformed feature showing it in `skipped`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**What.** Fail closed on unbalanced fences at both the checker and the writer, so a malformed corpus file can no longer pass the gate or lose sections.

**Where.** `packages/domain/src/planning/markdown-document.ts` (R1, R3b guard at serialize or replace time), the check path in `packages/app` for task and feature checks (R2), the planning write service used by `task update` / `feature update --section` (R3a), and `packages/app/src/services/feature-service.ts:365-385` (R4). Tests live next to each (`packages/domain/tests`, `packages/app/tests/services`, `apps/cli/tests/commands`).

**Anti-patterns.** Do not change `findHeadings` semantics: fenced headings must stay ignored. Do not auto-close fences. Add no new CLI flag or verb (R4 is output-only; if the JSON shape change needs consent under the public-surface rule, stop and ask). Update the owning design satellite if the feature check finding catalog is documented there.

**Out of scope.** Finding which idea-pipeline stage emitted the unterminated fence. If R3 lands, that writer fails loudly and the next occurrence names it.

### Plan

1. Domain: add R1 plus unit tests (balanced, unclosed, nested ```` ```` ```` language tags).
2. Domain/write service: R3 guards plus tests proving no bytes are written on rejection.
3. Checks: add the R2 finding to the task and feature checkers, with a CLI fixture test.
4. Refresh: add R4 `skipped` output with a test.
5. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-29T07:04:49.890Z backlog → todo (system)

