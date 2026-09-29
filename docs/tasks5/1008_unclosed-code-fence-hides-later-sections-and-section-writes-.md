---
schema_version: 1
name: Unclosed code fence hides later sections and section writes silently drop them
status: done
template: feature-impl
created_at: 2026-09-29T07:03:58.072Z
updated_at: "2026-09-29T17:50:30.791Z"
feature_id: F91

estimate_hours: 4
ac_altitude: task-local
---

## 1008. Unclosed code fence hides later sections and section writes silently drop them

### Background

Found by the A9 session review (2026-09-29). The A9 feature file (`docs/features/A9_*.md`) was written by the idea pipeline with an Acceptance Criteria ```` ```gherkin ```` fence that was never closed (line 40). `findHeadings` in `packages/domain/src/planning/markdown-document.ts:102` toggles on ```` ``` ```` lines, so every heading after an unclosed fence is invisible:

- `feature check A9` reported 0 errors, while `hasSection('Tasks')` was false.
- `feature refresh` silently skipped A9's roster (`feature-service.ts:374` `continue`), which failed `packages/app/tests/services/feature-service.test.ts` R3 dogfood (line 471).
- `feature update A9 --section "Acceptance Criteria"` treated the section as running to EOF and **deleted `## Tasks`, `## Notes`, `## History`**. The CLI then refused to write `Tasks` ("does not contain section"), so the repair needed a raw append.

Already fixed in session (not in scope): the A9 fence was closed and its tail restored; the roster was refreshed. Where the idea pipeline dropped the closing fence is unconfirmed (hypothesis: the AC writer emitted an unterminated block).

### Requirements

- [x] R1. `MarkdownDocument` exposes whether the body ends inside an open fence (for example `unclosedFenceLine(): number | null`, the 1-based line of the opening fence). The heading scan is unchanged.
- [x] R2. `spur task check` and `spur feature check` report an unclosed fence as an **error** finding (code `UNCLOSED_CODE_FENCE`, with the line). `--fix` does not auto-close it (the intended end is ambiguous).
- [x] R3. Every section writer (`task update --section`, `feature update --section`, and `replaceSection`/`replaceMarkerRegion` callers through the planning write service) refuses to write when either (a) the new section body has an odd count of ```` ``` ```` fence lines, or (b) the serialized result would have fewer top-level sections than the input. The command exits non-zero with a message naming the fence line or the dropped sections, and writes nothing.
- [x] R4. `feature refresh` reports features skipped because of a missing Tasks region in its JSON (`skipped: [{id, reason}]`) instead of skipping them silently. This is an observable-output change only, with no new flag.

### Acceptance Criteria

- [x] AC1 — Checks flag an unclosed code fence as an error (req: R1, R2)
- [x] AC2 — Section writes never drop later sections (req: R3)
- [x] AC3 — Refresh reports features it could not populate (req: R4)

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

Single chokepoints per concern; no per-caller guards.

- **R1** `packages/domain/src/planning/markdown-document.ts:131` — module helper `findUnclosedFenceLine()` (toggle-scan like `findHeadings`, returns 1-based line of a still-open fence); captured at parse time (`packages/domain/src/planning/markdown-document.ts:258`, re-based past the frontmatter block) and exposed via `unclosedFenceLine()` (`packages/domain/src/planning/markdown-document.ts:377`).
- **R2** `packages/config/src/finding-codes.ts:105` adds `L2.unclosed-code-fence`; `packages/app/src/services/planning-check-base.ts:235` `runL2()` pushes an **error** finding with the fence line before the matrix-entry guard — one push covers `task check` (2 call sites) and `feature check` (1). The finding is not in the `structuralFindings` catalog, so `--fix` can never auto-close the fence.
- **R3** Guard `assertFenceBalance()` (`packages/domain/src/planning/markdown-document.ts:394`) inside `MarkdownDocument.replaceSection()` and `replaceMarkerRegion()` — throws (write aborted, serialize unchanged) when the document itself has an unclosed fence or the new body leaves one open. Every section writer routes through these two (write-service `applyMutation`, QA append, task/feature update), so no caller was touched. Scope boundary: `replacePreamble` is not guarded (out of R3's listed writers).
- **R4** `FeatureService.refresh()` returns `skipped: Array<{ id, reason }>` (`packages/app/src/services/feature-service.ts:356`; skip sites `:384` missing-tasks-section, `:390` no-tasks-marker-region) instead of skipping silently; `feature refresh` adds `skipped` to the JSON envelope and prints `Skipped <id> (<reason>)` lines (before the summary line) on the human path (`apps/cli/src/commands/feature.ts:392`).

- **Review fixes (post-review, P2-1 + P2-2):** R3b implemented literally — `assertFenceBalance` (packages/domain/src/planning/markdown-document.ts:406) now also refuses writes when the parse dropped duplicate top-level sections (`_duplicateSectionNames` recorded at parse), naming the dropped sections; the guard runs in both `replaceSection` and `replaceMarkerRegion` before any mutation. The existing domain test codifying write-heals-duplicates was reworked to the refusal contract, and the batch-create parent fixture (apps/cli/tests/commands/task.test.ts:1297) was fixed to fill the template's existing `### Plan` instead of inserting a duplicate. Design satellite finding-code counts refreshed to 63 codes / L2×6 (docs/design/configuration-contracts.md:49).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/domain/src/planning/markdown-document.ts:131 `findUnclosedFenceLine()` toggle-scan (same ``` toggle semantics as `findHeadings`); captured at parse time :258-262 with frontmatter re-base (`bodyUnclosedFenceLine + frontmatterBlock newlines`); exposed via `unclosedFenceLine(): number |
| R2 | MET | packages/config/src/finding-codes.ts:20 (`'L2.unclosed-code-fence'` in ALL_FINDING_CODES) + :105 (`L2_UNCLOSED_CODE_FENCE` map entry); packages/app/src/services/planning-check-base.ts:231-239 pushes finding severity `error` with `Unclosed code fence at line ${fenceLine}` before the `if (!entry) return` guard — one push covers `task check` (task-check.ts:570, :640) and `feature check` (feature-check.ts:250). `--fix` cannot auto-close: finding is not in `structuralFindings` (structural-repair.ts:126 is the only fix source, planning-check-base.ts:297); CLI test task.test.ts:922 asserts the fence survives `--fix`. Note: code spelled `L2.unclosed-code-fence` per the registry's `L<layer>.<kebab>` convention (unknown codes fail config validation); the requirement's `UNCLOSED_CODE_FENCE` is the conceptual name, mapping documented in the task Solution section. |
| R3 | MET | packages/domain/src/planning/markdown-document.ts:398-421 `assertFenceBalance()`: (a) new body leaving a fence open refused :414-420 (odd fence count ≡ unclosed fence; message names `opening at body line N`); (b) write refused when the serialized result would have fewer top-level sections than the input — document-level unclosed fence hiding later sections :399-405 and duplicate top-level sections dropped by parse dedup :406-413 (message names the dropped sections). Guard runs pre-mutation in `replaceSection` :479 and `replaceMarkerRegion` :576 — the chokepoint every section writer routes through (planning-write-service.ts:551, :578, :590, :596; task-service.ts:392, :394, :1771, :1803; feature-service.ts:388, :1101). Command exits non-zero with the thrown message via apps/cli/src/index.ts:224-231 (`output.error` + return 1); tests prove byte-identical serialize after refusal (markdown-document.test.ts:963-1006, R3b refusal :885, :1014). |
| R4 | MET | packages/app/src/services/feature-service.ts:356 signature returns `skipped: Array<{id, reason}>`; skip sites :384 `missing-tasks-section`, :390 `no-tasks-marker-region`; returned :399. CLI: apps/cli/src/commands/feature.ts:386 `skipped` in the JSON envelope; :392-394 human path prints `Skipped <id> (<reason>)` before the summary line. No new flag or verb in the diff (observable-output change only). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | planning-check-base.ts:231-239 emits `L2.unclosed-code-fence` severity=error with the fence line, driven by R1's `doc.unclosedFenceLine()` (:377), covering task check (task-check.ts:570, :640) + feature check (feature-check.ts:250); CLI tests apps/cli/tests/commands/task.test.ts:922 and feature.test.ts:413 assert exit 1 + error finding + `/line \d+/` message (recorded pass under the gate run). |
| AC2 | MET | test | markdown-document.ts:398-421 guard throws before any mutation in `replaceSection` :479 / `replaceMarkerRegion` :576; all writers route through these two methods; domain tests prove refusal + byte-identical serialize for body-fence, doc-fence, and duplicate-section cases (markdown-document.test.ts:963, :970, :977, :1014). |
| AC3 | MET | test | feature-service.ts:377/:384/:390/:399 reports skips with `{id, reason}`; feature.ts:386/:392-394 surfaces them in JSON and human output; test feature-service.test.ts:333 asserts `skipped` contains `{id: 'A', reason: 'missing-tasks-section'}` while healthy sibling A1 is absent (recorded pass under the gate run). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS with 2 P2s to resolve before done** (no P0/P1 blockers). Full review: `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt`.

- **Traceability (R1–R4):** implemented as specified. R1 scan + frontmatter re-base verified correct (incl. CRLF/no-trailing-newline edges); R2 error finding fires before the matrix-entry guard (fail-closed), one push covering all 3 check call sites, and `--fix` structurally cannot touch fences (finding not in `structuralFindings`; `applyStructuralRepairs` is a raw-string transform whose scan toggles fences); R3 guard throws before any mutation, serialize byte-identical, correct single chokepoint in `replaceSection`/`replaceMarkerRegion`; R4 `skipped` with the two specified reasons in JSON + human output.
- **SECUA:** no security/efficiency defects; error messages actionable; bundles mirror sources with no drift.
- **Architecture:** chokepoints correct — domain owns parse/serialize invariants, shared check base for the finding, service returns data / CLI formats; no per-caller duplication, no leaky abstractions.

Findings:
- **P2-1** — doc drift: `docs/design/configuration-contracts.md:49` documents the finding registry as "62 codes: L1×2, L2×5 …"; now 63 / L2×6. Satellite not updated despite the task's own design note. Trivial fix.
- **P2-2** — task-doc literal R3(b) ("serialized result would have fewer top-level sections than the input") implemented as the unclosed-fence proxy; covers the motivating corruption, but duplicate-section files still lose the dup bytes on section writes (parse dedupes, serialize drops) with a warning (planning-write-service.ts:482) instead of the specified refusal. Decision: implement the literal count guard or record the refinement deviation.
- **P3-1** — fence opening inside the Tasks body is skipped as `no-tasks-marker-region` (mislabel; feature-service.ts:390).
- **P3-2** — `L2.unclosed-code-fence` not in `REQUIRED_FINDING_CODES` → suppressible via `tasks.severity` (default error per R2; confirm intent).
- **P3-3** — task CLI test leaves corrupted fixture in shared corpus (feature test cleans up; task.test.ts:922-945).
- **P3-4** — feature-side `--fix` never auto-closes not directly tested (shared engine, low risk).
- **P3-5** — server refresh handler still drops `skipped` silently (out of R4's CLI scope; conscious deferral).

Residual risk: low. Recommend resolving P2-1 (doc counts) and making an explicit call on P2-2 before task done.


Findings table:

| Priority | Finding | Status | Evidence |
| --- | --- | --- | --- |
| P2 | Design satellite finding-code counts stale ("62 codes / L2×5") | Resolved | docs/design/configuration-contracts.md:49 refreshed to 63 codes / L2×6, verified against finding-codes.ts |
| P2 | Literal R3(b) section-count refusal missing — duplicate-section writes dropped bytes with a warning | Resolved | packages/domain/src/planning/markdown-document.ts:406 refuses naming dropped sections; refusal tests in packages/domain/tests/planning/markdown-document.test.ts |
| P3 | Fence opening inside Tasks body skipped as `no-tasks-marker-region` (mislabel) | Recorded — out of scope | packages/app/src/services/feature-service.ts:390 |
| P3 | `L2.unclosed-code-fence` suppressible via `tasks.severity` (default error confirmed; not in REQUIRED_FINDING_CODES) | Recorded — accepted behavior | packages/app/src/services/planning-check-base.ts |
| P3 | Task CLI test leaves corrupted fixture in shared corpus (feature test cleans up) | Recorded — out of scope | apps/cli/tests/commands/task.test.ts:922 |
| P3 | Feature-side `--fix` never auto-closes not directly tested (shared engine) | Recorded — out of scope | packages/app/src/services/structural-repair.ts:126 |
| P3 | Server refresh handler drops `skipped` silently (R4 is CLI-scope) | Recorded — deferred | packages/app/src/services/feature-service.ts:356 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-29T07:04:49.890Z backlog → todo (system)
- 2026-09-29T15:57:22.888Z todo → wip (system)
- 2026-09-29T17:46:24.761Z wip → testing (system)
- 2026-09-29T17:50:30.791Z testing → done (system)

