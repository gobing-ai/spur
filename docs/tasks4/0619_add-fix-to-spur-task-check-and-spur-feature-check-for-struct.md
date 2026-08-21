---
schema_version: 1
name: "Add --fix to spur task check and spur feature check for structural repairs"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.582Z
updated_at: "2026-08-21T20:14:18.716Z"
feature_id: A3
priority: P1
dependencies: ["0613", "0618"]
---

## 0619. Add --fix to spur task check and spur feature check for structural repairs

### Background

`spur task check` and `spur feature check` report structural findings — missing, mis-levelled, or
mis-ordered section headings, and R-items written without the checkbox marker — but every repair is
manual today, which is why the corpus accumulates them and why `spur task check --corpus` has a
baseline of known errors.

The repair scope has a hard ceiling that must be designed in rather than discovered: there is
deliberately no section-delete verb, so `--fix` can add and reshape headings but cannot remove an
off-variant section. And a section body is content the check has no authority to author — repairing
"Design is empty" by writing a Design would be the tool inventing spec.

Both verbs share one repair engine; splitting this into two tasks would duplicate the engine's design
review for the sake of two call sites.

Rubric: E3 D1 L2 C2 R3 = 11 → decompose.

### Requirements

- [x] R1. Implement a structural repair engine limited to heading presence, heading level, section order, and R-item checkbox form, which never authors section content.
- [x] R2. Add `--fix` to `spur task check`, repairing structural findings in place and reporting the repairs per file.
- [x] R3. Add `--fix` to `spur feature check` with the same contract, leaving acceptance-criteria content findings untouched and still reported.
- [x] R4. Leave a file byte-identical when it has no structural findings, and never remove an off-variant section, since there is deliberately no section-delete verb.
- [x] R5. Guarantee that re-running the check without `--fix` reports no remaining structural findings, and update the two `docs/help/cmd_*.md` pages plus `docs/04_DESIGN.md`.

### Acceptance Criteria

```gherkin
@core
Scenario: R10 — spur task check --fix repairs structural task defects only
  Given a task file with structural findings such as a missing, mis-levelled, or mis-ordered section heading
  When the check is run with --fix
  Then the structural findings are repaired in place and the repairs are reported per file
  And findings that would require authoring content are left untouched and still reported
  And re-running the check without --fix reports no remaining structural findings

@core
Scenario: R11 — spur feature check --fix repairs structural feature defects only
  Given a feature file with structural findings in its section layout
  When the check is run with --fix
  Then the structural findings are repaired in place and the repairs are reported per file
  And acceptance-criteria content findings are left untouched and still reported
  And re-running the check without --fix reports no remaining structural findings

@edge
Scenario: R15 — --fix is a no-op on a corpus file with nothing structural to repair
  Given a task or feature file whose only findings are content-level
  When the check is run with --fix
  Then the file is left byte-identical
  And the content findings are reported exactly as they are without --fix
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**One engine, two call sites.** The structural vocabulary — heading presence, level, order,
list-marker form — is identical for tasks and features; only the section matrix that defines the
expected layout differs, and both verbs already resolve theirs. Two engines would be two places for
the same repair to be wrong.

**Structural means layout, never content.** The engine repairs the shape a check can derive from the
section matrix. It never fills an empty section, never rewrites prose, and never touches acceptance
criteria bodies. A tool that authors spec content produces work that looks reviewed and is not.

**Off-variant sections cannot be repaired, and that is stated up front.** There is no section-delete
verb by design. `--fix` reports an off-variant section and leaves it; pretending otherwise would put
the engine in the position of deleting operator-written content to satisfy a matrix.

**Byte-identical on a no-op is the trust property.** A `--fix` that reformats a file it had nothing to
repair produces diff noise that makes operators stop trusting it, which is worse than not having it.

**Heading levels are the highest-risk repair.** Feature sections are `##` and task sections are `###`,
and a same-level heading inside a section body is silently lost on a `--section` write. The level
repair must move a heading to the correct depth without colliding with that write path.

### Plan

- [x] Read the task and feature check implementations and the section matrix to enumerate which findings are structurally repairable
- [x] Implement the shared repair engine for heading presence, level, order, and R-item checkbox form (R1)
- [x] Wire `--fix` into `spur task check` with per-file repair reporting (R2)
- [x] Wire `--fix` into `spur feature check` with the same contract (R3)
- [x] Enforce the no-op byte-identity and the off-variant non-removal rules (R4)
- [x] Add tests: each repairable finding, the content-only no-op, the off-variant case, and the re-check-clean property (R5)
- [x] Update the two `cmd_*.md` pages, `docs/04_DESIGN.md`, and the `sp:spur-cli` references (R5)
- [x] Run `bun run lint`, `bun run test`, and `bun run corpus-check`

### Solution
One structural repair engine, two call sites (task 0619, ADR-051 consent row 3):

- `packages/app/src/services/structural-repair.ts` (new) — `structuralFindings(raw, domain)` and `applyStructuralRepairs(raw, domain, entry)` over the raw body (frontmatter split + code-fence-aware heading scan). Repairs are limited to: (1) **heading level** — rewrite a canonical section name at the wrong depth to the domain level (`###` task / `##` feature); (2) **heading presence** — insert a bare heading (never content) for each matrix-required section missing at the correct level, placed at canonical rank; (3) **section order** — reorder present canonical sections to the domain order, only when every present at-level section is canonical (an off-variant section is never removed and blocks reordering); (4) **R-item checkbox form** — add the `[ ] ` marker to R-numbered requirement lines inside the Requirements section. Pure string transform: a file with nothing structural returns `{ changed: false, content }` byte-identical. Exports `StructuralRepair`, `RepairResult`.
- `packages/config/src/finding-codes.ts` — new codes `L2.heading-level`, `L2.section-order`, `L3.requirements-checkbox` (registered in `ALL_FINDING_CODES` + `FINDING_CODES`).
- `packages/domain/src/planning/markdown-document.ts` — `TASK_CANONICAL_SECTIONS` order corrected: `Root Cause` before `Solution` (matches the `issue` template and corpus convention; no test/doc asserted the old order).
- `packages/app/src/services/planning-check-base.ts` — `runL2` gains a `raw` param and merges `structuralFindings(raw, docKind)` (so a plain check reports the same shapes `--fix` repairs — R5).
- `packages/app/src/services/task-check.ts` + `feature-check.ts` — `check()` gains `fix?: boolean`: applies the repair before validation, writes the file when changed, returns `repairs` on the result.
- `apps/cli/src/commands/task.ts` + `feature.ts` — `--fix` option (rejected with `--corpus`), passed through to `check({ fix })`, `[FIX] kind section: detail` rendered per repaired file.
- Tests — `packages/app/tests/services/structural-repair.test.ts` (11 engine tests), `apps/cli/tests/commands/task.test.ts` (`check --fix` CLI test).
- Baseline + anchors — 296 `config/corpus-baseline.json` entries for pre-existing structural warnings (reason: "pre-existing structural debt — repair with `spur task check --fix`"); line-shift anchor citations repointed in tasks 0532/0561/0591/0592/0622.
- Docs (same commit) — `docs/help/cmd_task.md` / `cmd_feature.md` `--fix` rows; `docs/04_DESIGN.md` check rows list `--fix`; `sp:spur-cli` `references/tasks.md` + `features.md` flag columns.

**Change map (`file:line`):**

| Change |
|--------|
| `packages/app/src/services/structural-repair.ts:1` |
| `packages/config/src/finding-codes.ts:18` |
| `packages/domain/src/planning/markdown-document.ts:32` |
| `packages/app/src/services/planning-check-base.ts:148` |
| `packages/app/src/services/task-check.ts:38` |
| `packages/app/src/services/feature-check.ts:47` |
| `apps/cli/src/commands/task.ts:1041` |
| `apps/cli/src/commands/feature.ts:334` |
| `packages/app/tests/services/structural-repair.test.ts:1` |
| `apps/cli/tests/commands/task.test.ts:3178` |
| `config/corpus-baseline.json:1` |
| `docs/04_DESIGN.md:1468` |
### Testing
**Pipeline verify results**

- Verdict: UNKNOWN (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| — | — | No requirements recorded; verify verdict UNKNOWN |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS** — inline review (functional traceability + SECUA), session inline-20260821-123204-0619.

| Priority | Area | Finding | Evidence |
|---|---|---|---|
| P4 | Verify | One repair engine, two call sites — task and feature share `structural-repair.ts`; only the domain (heading level `###` vs `##`, canonical order) differs. | `packages/app/src/services/structural-repair.ts` |
| P4 | Verify | Repair is a pure string transform; no-op returns the input byte-identical; content is never authored (inserted sections are bare headings). | `applyStructuralRepairs` no-op + missing-section paths; engine tests |
| P4 | Verify | Off-variant/forbidden sections are never removed and block reordering (R4). | "never removes an off-variant section" engine test |
| P4 | Risk | New structural finding codes fire on pre-existing corpus debt (265 tasks with non-checkbox R-items, 37 with `##`-level headings, 13 out-of-order) — baselined (296 entries) so `corpus-check` stays 0 new/0 stale; operator can clear them with `--fix` (entries then go stale and are pruned). | `config/corpus-baseline.json` + `bun run corpus-check` |
| P4 | Risk | `TASK_CANONICAL_SECTIONS` order corrected: `Root Cause` before `Solution` to match the `issue` template (the corpus convention) — no test/doc asserted the old order. | `packages/domain/src/planning/markdown-document.ts:32-44` |
| P4 | Verify | Line-shift anchor fallout from the `check()` fix block repointed in tasks 0532/0561/0591/0592/0622 (source + test citations). | `bun run corpus-check` 0 new / 0 stale |
| P4 | Risk | `--fix` on the whole active folder rewrites many legacy files (headings/order/checkboxes) — deliberate; the per-file report surfaces every change. | `apps/cli/src/commands/task.ts` `--fix` |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T20:12:52.011Z todo → wip (system)
- 2026-08-21T20:12:52.641Z wip → testing (system)
- 2026-08-21T20:14:18.716Z testing → done (system)
