---
schema_version: 1
name: "Make task creation and checking agree on valid persisted content"
status: done
template: feature-impl
created_at: 2026-09-06T20:59:14.049Z
updated_at: "2026-09-07T03:41:53.356Z"
feature_id: F21
priority: P1
dependencies: ["0786"]
---

## 0787. Make task creation and checking agree on valid persisted content

### Background

Fresh source-local CLI probes reproduced bare create and background-only batch create exiting 0 followed by task check exiting 1 with L3.requirements-empty and L3.ac-empty. Optional scaffold bodies are checked unconditionally. Feature links or any batch spec field currently imply todo. Required-section metadata is reconstructed from missing findings. Quoted names fail YAML parsing and literal backslashes can become tabs. Evidence and exact commands are in docs/plans/2026-09-06-task-creation-readiness-brainstorm.md; code premises are TaskService.create/createBatchItem, TaskCheckService.runL3, and PlanningCheckService.summarizeWithStatus.

Implements feature scenarios R1 — Capture validation follows the actual section matrix; R2 — Supplied task specifications are validated before persistence; R3 — Task input round trips and failures preserve machine output. Shared rendering, status choice, diagnostics and serialization are one reviewable correctness change; do not split individual bugs into more tasks. Schedule after the existing workflow repair batch ending at 0786.

Sizing: approximately 6–8 hours, one deterministic correctness deliverable spanning app/domain/CLI tests; medium risk, no parallel coordination. Parent effort is approximately 14–20 hours; rubric E16 D2 L2 C0 R1=21 justifies two independently verifiable deliverables with distinct deterministic versus model-assisted risk. This task stays whole under the operator's cohesion instruction; no child tasks.

### Requirements

- [x] R1. Single and batch capture creation produce truthful backlog records; project and bundled matrix selection agrees with checking for every supported template. Omitted or placeholder-only optional backlog sections do not generate scaffold-only findings, while required Background is substantive.
- [x] R2. Supplied candidates are validated before persistence against the same variant/status rules used by task check. Fully specified inputs may enter todo; partial content or a feature link alone never establishes readiness. Malformed authored AC and missing required planning bodies at todo remain failures. Batch validation failure leaves no task files or parent mutations.
- [x] R3. requiredSections is the full resolved matrix list, missingSections only the missing subset, including --as target semantics. Preserve finding codes, strict severity behavior and genuine feature/dependency diagnostics; do not weaken completion evidence.
- [x] R4. Single/batch creation round-trips allowed names and tags exactly, including embedded and enclosing quotes, backslashes, Unicode, colons and line breaks. Invalid input returns nonzero plus one parseable raw/enveloped JSON error without writes.
- [x] R5. Supply create-to-check regressions against real matrix assets and source-local CLI probes, record the explicit unsuppressed corpus audit for checker-policy changes, and update the owning CLI surface docs. No model execution, new dependency, full-corpus repair, or second matrix policy is in scope.

### Acceptance Criteria

```gherkin
Feature: Consistent task creation and default implementation readiness

  @core
  Scenario: R1 — Capture validation follows the actual section matrix
    Given a supported task variant and a bare capture with a valid background
    When creation and current-status checking run with the same project or bundled matrix
    Then optional unfilled planning sections do not cause scaffold-only errors or warnings
    And the task remains backlog and requiredSections lists every resolved required section even when all are present

  @core
  Scenario: R2 — Supplied task specifications are validated before persistence
    Given a single or batch candidate with supplied planning content
    When the shared creation path evaluates the candidate for its intended status
    Then malformed authored content and missing required content are reported before commit
    And a complete valid specification can enter todo while incomplete capture cannot claim implementation readiness

  @core
  Scenario: R3 — Task input round trips and failures preserve machine output
    Given task names or tags containing quotes backslashes colons Unicode or allowed line breaks
    When single or batch creation runs with raw JSON or envelope output
    Then successful show output preserves the original strings exactly
    And invalid input exits nonzero with one parseable error result and no created files
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Read docs/design/task-creation-readiness.md (ADR-109, approved design, not yet shipped). No new dependency, public noun/verb, readiness scoring framework, or implementation during creation. Tests and owning documentation ship with this task. Preserve unrelated edits and use source-local CLI provenance for dogfood.

WHAT/WHY: repair the deterministic producer/consumer contract once so single create, batch create and HTTP create share it. Keep creator and checker on the existing matrix. Status reflects supplied validated content; a feature link is traceability only. A bare title is a legitimate capture Background, not fabricated Requirements or AC. Preserve optional future-stage scaffold compatibility; suppress only absent/placeholder optional backlog planning sections. Authored invalid content remains checked at every status. Make required content validation matrix-aware for Background/AC/Design/Plan and preserve Requirements' established todo contract without hard-coding another status matrix.

WHERE: packages/app/src/services/task-service.ts (create/createBatchItem, shared candidate rendering), task-check.ts (check/runL3/runL4), planning-check-base.ts (matrix metadata); packages/domain/src/planning/markdown-document.ts and task-skeleton.ts only for reusable rendering/serialization; apps/cli/src/commands/task.ts for structured errors and shared configuration; apps/server/src/context.ts and modules/task/handlers.ts only where deterministic wiring needs parity. Use existing tests in each workspace.

FROZEN CONTRACT: no new public flags in this task. Keep existing create/batch return fields, variant defaults and dedupe/WBS lock semantics. requiredSections comes directly from the selected variant/status entry, including --as; missingSections is independently derived from document presence. Reuse TaskCheckService's content policy for a candidate document before allocation commit, factoring its read/parse boundary only as needed; never invoke a second full CLI or persist a temporary candidate into the real corpus just to check it. Batch candidates are all validated before writes or parent wiring; retain existing rollback handling for later I/O failures.

SERIALIZATION: use the already-installed YAML serializer with a frontmatter object rather than double-quoted interpolation in create and createBatchItem. Do not naively use escapeYamlValue as an exact-string writer: it preserves enclosing quotes and does not fully escape line breaks. Names/tags must round-trip as data; restrict title line breaks only if the live schema explicitly rejects them, not through silent normalization. Keep CLI usage/dedupe/collision exits; generic create failure under --json uses the existing writeJsonError/toEnvelopeJson conventions.

VALIDATION: empty optional backlog bodies are allowed, substantive Background remains required; todo required planning bodies cannot be placeholders. Real missing-feature warnings remain visible; never auto-link a feature or raise all tasks to todo to pass. Completed Solution/Testing/Review rules remain unchanged. Cover standard, feature-impl, issue, review, meta and brainstorm using actual matrix loading.

HANDOFF: the second F21 task consumes this deterministic candidate validation and existing WBS/path output; it owns --skip-ready and model orchestration. This task must be independently usable before that default changes. Dependencies[] identifies 0786; the dependent task is 0788. No unresolved design decisions; incidental implementation names remain local, no new public API.

VERIFY: focused failing regressions for bare/linked/partial/complete create-to-check, exact string round-trips and raw/envelope failures; HTTP no-agent regression; all required project gates. Because checker policy changes, run bun run corpus-check once, retain unsuppressed output, and distinguish historical findings from new regressions without baselines.

### Plan

- [x] 1. Reproduce the current single/batch failures and add focused regressions using real matrix assets (R1–R4).
- [x] 2. Repair shared candidate rendering, exact YAML serialization and JSON error paths; validate before write and preserve locking/rollback (R2, R4).
- [x] 3. Align matrix-aware content checks, status derivation and required/missing metadata; exercise all variants and HTTP caller behavior (R1–R3).
- [x] 4. Run targeted tests from their workspaces, source-local CLI probes and the explicit unsuppressed corpus audit; classify findings without suppression (R5).
- [ ] 5. Update docs/04_DESIGN.md and its task-readiness satellite, run doc-evolve sync-check and required project gates; leave the deterministic seam documented for the next task (R5).

Item 5 stays open deliberately and is NOT flipped, but only one of its four legs is still outstanding.
Done: the doc half — `docs/04_DESIGN.md:1725-1727` (`writeCreateJsonError` surface), `:1776`/`:1786`
(create / batch-create JSON error inventory rows) and `:2047` (the `design/task-creation-readiness.md`
satellite indexed as shipped). Done: the `doc-evolve` sync-check, run this session and clean — T3 is
satisfied by `docs/04_DESIGN.md` in commit 272451a8d and by `docs/design/task-creation-readiness.md`
in 2ea0fc518, T1 by `docs/00_ADR.md` (ADR-109) in 2ea0fc518, T4 by the `[verifying]` F21 row in
`docs/features/INDEX.md`, and T5 is correctly still open while the feature is not `done`. Done: the
deterministic seam is documented for the next task — `checkContentPolicy` as the single
creation/checking policy boundary, consumed by 0788. Done: lint (Biome over 917 files) and all seven
workspace typechecks PASS; the full suite is 7627 pass / 4 fail with all four failures in
`scripts/commands/eval-pipeline.test.ts` from one sandbox `git worktree add` write-policy denial
unrelated to F21.

Outstanding: the rule-preset gates. `spur rule run --preset recommended-pre-check --fail-on warning`
exits 1 with "SQLite database is busy; another Spur process is holding the lock." on seven attempts
across the run. `.spur/spur.db` is ~4.8 GB with live `-shm`/`-wal` siblings; `ps` is denied by the
sandbox and force-unlocking a database that size is outside authorized scope. The box stays
unchecked rather than flipped on an unrun gate.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:1011` |
| `apps/cli/src/commands/task.ts:1019` |
| `apps/cli/src/commands/task.ts:1348` |
| `apps/cli/src/commands/task.ts:137` |
| `apps/cli/src/commands/task.ts:192` |
| `apps/cli/src/commands/task.ts:195` |
| `apps/cli/src/commands/task.ts:196` |
| `apps/cli/src/commands/task.ts:205` |
| `apps/cli/src/commands/task.ts:21` |
| `apps/cli/src/commands/task.ts:303` |
| `apps/cli/src/commands/task.ts:312` |
| `apps/cli/tests/commands/task.test.ts:13` |
| `apps/cli/tests/commands/task.test.ts:2875` |
| `apps/server/tests/context.test.ts:420` |
| `apps/server/tests/context.test.ts:425` |
| `packages/app/src/index.ts:453` |
| `packages/app/src/services/planning-check-base.ts:295` |
| `packages/app/src/services/planning-check-base.ts:345` |
| `packages/app/src/services/planning-check-base.ts:356` |
| `packages/app/src/services/task-check.ts:577` |
| `packages/app/src/services/task-check.ts:583` |
| `packages/app/src/services/task-check.ts:637` |
| `packages/app/src/services/task-check.ts:650` |
| `packages/app/src/services/task-check.ts:660` |
| `packages/app/src/services/task-check.ts:850` |
| `packages/app/src/services/task-check.ts:852` |
| `packages/app/src/services/task-service.ts:137` |
| `packages/app/src/services/task-service.ts:1475` |
| `packages/app/src/services/task-service.ts:1514` |
| `packages/app/src/services/task-service.ts:1593` |
| `packages/app/src/services/task-service.ts:1595` |
| `packages/app/src/services/task-service.ts:1597` |
| `packages/app/src/services/task-service.ts:1603` |
| `packages/app/src/services/task-service.ts:20` |
| `packages/app/src/services/task-service.ts:31` |
| `packages/app/src/services/task-service.ts:33` |
| `packages/app/src/services/task-service.ts:534` |
| `packages/app/src/services/task-service.ts:719` |
| `packages/app/src/services/task-service.ts:733` |
| `packages/app/src/services/task-service.ts:751` |
| `packages/app/tests/services/task-check.test.ts:2582` |
| `packages/app/tests/services/task-check.test.ts:2606` |
| `packages/app/tests/services/task-check.test.ts:3730` |
| `packages/app/tests/services/task-service.test.ts:1117` |
| `packages/app/tests/services/task-service.test.ts:16` |
| `packages/app/tests/services/task-service.test.ts:219` |
| `packages/app/tests/services/task-service.test.ts:228` |
| `packages/app/tests/services/task-service.test.ts:285` |
| `packages/app/tests/services/task-service.test.ts:401` |
| `packages/app/tests/services/task-service.test.ts:529` |
| `packages/app/tests/services/task-service.test.ts:809` |
| `packages/app/tests/services/task-service.test.ts:819` |
| `packages/app/tests/services/task-service.test.ts:9` |
| `packages/domain/src/planning/task-skeleton.ts:145` |
| `packages/domain/src/planning/task-skeleton.ts:18` |
| `packages/domain/tests/planning/task-skeleton.test.ts:193` |
| `packages/domain/tests/planning/task-skeleton.test.ts:2` |
| `packages/domain/tests/planning/task-skeleton.test.ts:9` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Matrix drives L3 substance checks, so unfilled optional backlog sections raise nothing: `packages/app/src/services/task-check.ts:648-651` builds `requiredAtStatus = new Set(entry?.required ?? [])` and gates the placeholder-Requirements finding on `requiredAtStatus.has('Requirements')`; `packages/app/src/services/task-check.ts:850-853` applies the same gate inside the `['Testing','Solution']` scaffold loop (`if (!requiredAtStatus.has(sectionName)) continue;`). The resolved matrix is the single source: `config/tasks/section-matrix.yaml:26-28` (`todo.required: [Background, Acceptance Criteria, Design, Plan]`, with Requirements/Solution/Testing optional) and `:39-41` (`done.required: [Solution, Testing, Review]`). Required Background stays substantive — the variant template body is appended only when the caller supplied neither background nor a feature link (`packages/app/src/services/task-service.ts:595-604`). Tests re-run this turn: `packages/app/tests/services/task-check.test.ts:2582` ('R3 (F21 0787): placeholder-only Requirements is tolerated where the matrix does not require it') and `packages/app/tests/services/task-service.test.ts:856` ('a batch item with no explicit background keeps the variant template Background body (F21 0787 batch/create parity)') — `cd packages/app && bun test tests/services/task-readiness.test.ts tests/services/task-service.test.ts tests/services/task-check.test.ts` → 300 pass / 0 fail |
| R2 | MET | Validation strictly precedes persistence on both paths. Single: `packages/app/src/services/task-service.ts:723` resolves the candidate shape, `:730` calls `validateCandidateOrThrow`, and only `:734` reaches `this.writeService.createAllocated(...)` — so a rejected candidate allocates no WBS and writes no file. The validator renders a probe document and runs the real content checker at the candidate's intended status (`packages/app/src/services/task-service.ts:688-690`, probe WBS constant at `:178`), which is why a complete specification may enter `todo` while a partial capture cannot: status derivation runs an explicit todo-eligibility probe at `:625-638` (`buildTaskSkeleton` + `checkCandidateContent(probe, CANDIDATE_PROBE_WBS, 'todo')`). Batch is all-or-nothing before any write: `packages/app/src/services/task-service.ts:1480-1500` resolves every item's shape, validates each (`:1497`), and throws `TaskCandidateInvalidError` (`:1500`) — the batch write at `:1599` is never reached, so no task files and no parent mutations survive a rejection. Tests: `apps/cli/tests/commands/task.test.ts:2957` ('create exits 1 with candidate-invalid JSON carrying findings (F21 0787 R4)') and `:3017` ('batch-create exits 1 with candidate-invalid JSON carrying findings') — `cd apps/cli && bun test tests/commands/task.test.ts` → 177 pass / 0 fail this turn |
| R3 | MET | `requiredSections` is the full resolved obligation list, not a finding-derived subset: `packages/app/src/services/planning-check-base.ts:295` adds the optional `requiredList?: readonly string[]` parameter, and `:345-375` branches on it — when the caller supplies the resolved matrix list, `requiredSections` becomes that whole list while `missingSections` is derived from the deduped L2 "Missing required" findings; when omitted, the legacy finding-derived path is preserved unchanged, so existing callers keep their codes and severities. `--as` target semantics are honored because the caller resolves the matrix at the *target* status: `packages/app/src/services/task-check.ts:541` (`const effectiveStatus = options?.asStatus ?? status;`), `:546` (`resolveMatrixEntry(variant, effectiveStatus)`), and `:568-577` passes `entry?.required` into the summarizer. Finding codes and strict severity behavior are untouched — the R1 unsuppressible essential/required-error rule still sits above this branch at `packages/app/src/services/planning-check-base.ts:340-344` |
| R4 | MET | Frontmatter round-trips exactly because hand-interpolation was replaced by a real YAML emitter: `packages/domain/src/planning/task-skeleton.ts:145-158` — `serializeTaskFrontmatter` calls `stringifyYaml(data, { lineWidth: 0 })`, and its docstring records the defect it closes (quotes, backslashes, colons broke `name: "${title}"`). Failure emits exactly one parseable machine result and no files: `apps/cli/src/commands/task.ts:145-176` (`writeCreateJsonError`) writes `{ok:false,error:{code,message,…}}` to stdout for raw `--json`, collapses to `INTERNAL_ERROR` + `details.cliCode` when enveloped, and falls back to stderr prose otherwise. Tests re-run this turn: `apps/cli/tests/commands/task.test.ts:2957` (raw `--json` findings), `:2975` ('create --json --json-envelope emits an apiErrorSchema envelope with cliCode + findings'), `:3001` ('create exits 1 with human-readable error on TaskCandidateInvalidError without --json'), `:3017` (batch-create) |
| R5 | MET | Real-matrix regressions exist in all three workspaces and were re-executed from inside their workspaces this run: `packages/app/tests/services/task-check.test.ts`, `packages/app/tests/services/task-service.test.ts` (300 pass with `task-readiness.test.ts`), `apps/cli/tests/commands/task.test.ts` (177 pass), plus the duplicate-WBS corpus probe `apps/cli/tests/commands/task.test.ts:2831` ('check detects duplicate WBS prefixes across files (0416 R6)') backed by `apps/cli/src/commands/task.ts:1454-1463`. The explicit unsuppressed corpus audit for the checker-policy change is recorded verbatim in this task's Implementation Notes ("Corpus audit (unsuppressed, R5): `task check` over the full corpus → 289 PASS / 10 FAIL, exit 1 … 0 L1/L2/L3 errors … No finding class originates from this change"). Owning CLI surface docs are synced and diff-accurate: `docs/04_DESIGN.md:1725-1727` documents `writeCreateJsonError` against `apps/cli/src/commands/task.ts:145-176`; `docs/04_DESIGN.md:1776` and `:1786` carry the create / batch-create JSON error-branch inventory rows; `docs/04_DESIGN.md:2047` indexes the `design/task-creation-readiness.md` satellite as shipped for F21 tasks 0787–0788. Scope exclusions hold: no model execution, no dependency, no second matrix policy — the change adds one optional parameter to the existing summarizer rather than a parallel checker |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Capture validation follows the actual section matrix | MET | test | Optional unfilled planning sections produce no scaffold-only finding: `packages/app/tests/services/task-check.test.ts:2582` passes against the real `config/tasks/section-matrix.yaml:26-28`, and the gates that make it true are `packages/app/src/services/task-check.ts:648-651` and `:850-853`. `requiredSections` lists every resolved required section even when all are present — `packages/app/src/services/planning-check-base.ts:345-375` supplies the full list rather than the finding-derived subset, fed from `packages/app/src/services/task-check.ts:568-577` |
| R2 — Supplied task specifications are validated before persistence | MET | test | Malformed/missing required content is reported before commit: `packages/app/src/services/task-service.ts:730` validates before `:734` writes (single) and `:1497-1500` rejects the whole batch before `:1599` writes (batch); `apps/cli/tests/commands/task.test.ts:2957` and `:3017` assert exit 1 with findings and no created files. A complete specification may enter `todo` while a capture cannot: the todo-eligibility probe at `packages/app/src/services/task-service.ts:625-638` runs the real checker at `todo` and demotes when it fails |
| R3 — Task input round trips and failures preserve machine output | MET | test | Exact round-trip through the YAML emitter at `packages/domain/src/planning/task-skeleton.ts:145-158`; one parseable error result on failure from `apps/cli/src/commands/task.ts:145-176`, asserted for raw JSON (`apps/cli/tests/commands/task.test.ts:2957`), envelope (`:2975`), non-JSON prose (`:3001`) and batch (`:3017`) — all four re-run green this turn |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review


**Verdict: PARTIAL** — gate green (.spur/run/0787-test-gate.log: 7472 pass / 0 fail across 417 files; post-check rules pass), R1–R4 functionally delivered with real evidence, but one MUST-FIX correctness divergence between single and batch capture must land before verify, and one spec-reading needs adjudication.

Scope reviewed: full uncommitted diff (11 files, +767/−172), task spec R1–R5 + AC, feature F21 R1–R8, shipped matrix (`config/tasks/section-matrix.yaml`), templates (`config/templates/task/*.md`), gate log.

**Priority findings (done-gate summary):**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | — | — | No open P1–P3 findings; re-review verdict PASS, verify verdict PASS. Full historical detail lives in the sibling sections below (Findings, Prior-finding resolution, New findings). |

### Findings

| # | Sev | Dimension | Finding | Evidence | MUST-FIX |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 | Correctness (R1) | Batch items silently drop template-seeded Background content that single create keeps. `resolveCandidateShape` appends the variant template's own Background body only when `input.background === undefined` (`task-service.ts:596-603`), but `batchCreate` passes `background: item.background ?? ''` (`task-service.ts:1488`) — never `undefined`. A `template: review` batch item without a background loses `review.md`'s Review-Findings input table (its template Background), while `create --template review` keeps it: the two capture paths disagree per supported template, contradicting the in-code intent comment. One-token fix: pass `item.background` through so `undefined` survives. | `packages/app/src/services/task-service.ts:598`, `:1488`; `config/templates/task/review.md` | **YES** |
| 2 | P2 | Correctness (R2 spec-tension) | Placeholder-only Requirements at `todo` no longer fails. Design says "preserve Requirements' established todo contract"; the implementation gates `L3_REQUIREMENTS_EMPTY` on `requiredAtStatus` (`task-check.ts:650`) and the shipped matrix lists Requirements as todo-**optional** (`config/tasks/section-matrix.yaml` `standard.todo`), so the pre-0787 (0339) gate is gone for todo tasks. The rewritten test records this as R1 supersession (`task-check.test.ts:2582-2586`), but no Q&A/design decision is recorded. Adjudicate: if matrix-aware is intended, record the decision; if the old contract stands, add Requirements to `todo.required` in the canonical matrix (config change, not code). | `packages/app/src/services/task-check.ts:650,660-666`; `config/tasks/section-matrix.yaml`; `packages/app/tests/services/task-check.test.ts:2582` | adjudicate |
| 3 | P2 | Testing (R4/VERIFY) | No automated CLI regression for the new machine-error surface: `writeCreateJsonError` raw/enveloped emission, `candidate-invalid` exit 1 with findings, and the JSON-mode dup-WBS push (`task.ts:1348`) have zero tests in `apps/cli/tests/commands/task.test.ts` (only the pre-existing non-JSON dup test at `:2875`, which now passes for the right reason thanks to the fix — previously masked by created tasks failing their own check). VERIFY requires "raw/envelope failures" regressions; current evidence is manual probes (temp corpus removed) plus service-level `TaskCandidateInvalidError` tests. Add a CLI-level test before the verify stage. | `apps/cli/src/commands/task.ts:146-181`, `:307-312`, `:1014-1019`, `:1348`; `apps/cli/tests/commands/task.test.ts` (not in diff) | before verify |
| 4 | P3 | Efficiency | Auto-status candidates run the identical L1–L3 policy twice (todo-eligibility probe `task-service.ts:638` + final validate `:690`) and construct a fresh `TaskCheckService` per call (`:658-661`). Negligible next to fs I/O; acceptable — note only. | `packages/app/src/services/task-service.ts:638,658-661,690` | no |
| 5 | P4 | Usability | `Error: ` prefix-strip + non-JSON stderr fallback duplicated between `writeCreateJsonError` (`task.ts:33-47`) and `writeJsonError` (`envelope.ts:113-119`). Fine at two call-site families; delegate if a third appears. | `apps/cli/src/commands/task.ts:33-47`; `packages/app/src/output/envelope.ts:113-119` | no |
| 6 | P4 | Architecture | `summarizeWithStatus` is now 7 positional params (`requiredList` last, `planning-check-base.ts:295`); callers pass positional `undefined`s (`task-check.ts:568-577`). Documented dual-path (legacy finding-derived vs supplied list) is transitional; switch to an options object only if it grows again. | `packages/app/src/services/planning-check-base.ts:295,357-368` | no |

### Functional traceability (R1–R5)

- **R1 — met.** L3 placeholder rules gated on the effective status's required set (`task-check.ts:645-666`); status granted by the checker's own todo-eligibility probe (`task-service.ts:628-640`); bare and feature-linked captures land at backlog and check clean (`task-service.test.ts:219,239`); `requiredSections` reports the full obligation set even when all present (`task-check.test.ts:3762`). Capture-line Background keeps required-Background substantive (`task-service.ts:585-587`).
- **R2 — met** (finding #1 aside). Candidates validated BEFORE WBS allocation/lock (`task-service.ts:723-730`); batch resolves+validates every item up-front, invalid ⇒ `TaskCandidateInvalidError` with zero files and no parent mutation (`task-service.ts:1481-1502`; `task-service.test.ts:856`); complete spec ⇒ todo, requirements-only ⇒ backlog (`task-service.test.ts:819`); explicit-status candidates validated as that status; I/O rollback retained.
- **R3 — met.** `requiredSections` = full resolved matrix entry incl. `--as` (`task-check.ts:543-577`: `effectiveStatus = asStatus ?? status`, entry resolved with it, `entry?.required` forwarded); `missingSections` the deduped missing subset (`planning-check-base.ts:357-368`); finding codes/severities preserved; callers omitting the list keep legacy behavior (`planning-check-base.ts:368-375`).
- **R4 — met.** Frontmatter serialized from the OBJECT via `serializeTaskFrontmatter` (`task-skeleton.ts:155-158`, shared yaml emitter with `MarkdownDocument.parse`); quotes/backslashes/colons/Unicode/newlines round-trip (`task-skeleton.test.ts:198,214`; `task-service.test.ts:247`); ONE parseable raw/enveloped JSON error on stdout, exit 1/2/3 semantics kept (`task.ts:146-181,307-312,1014-1019`); invalid input rejected pre-lock ⇒ no writes. Hand-interpolation removed from both create paths; `escapeYamlValue` not used as a writer. Probe-WBS `0000` claim verified: wbs reaches only L1 message text and L4 (excluded from policy).
- **R5 — met for this stage.** Real-matrix regressions across app/domain; corpus audit recorded unsuppressed (289 PASS / 10 FAIL, all pre-existing done-status L4 integrity findings; 0 from this change) in Implementation Notes; CLI surface docs + doc-evolve remain plan item 5 (open, deferred — must not be lost by wrap).

### SECUA / architecture depth

Security: YAML via the shared emitter (no injection surface), findings carried inside the JSON envelope, validation moved to the create trust boundary — improved. Correctness: batch atomicity, rollback, empty/placeholder sections, special chars all covered by focused tests. Architecture: deepens the seams — one frontmatter writer in domain (reader/writer cannot drift), `checkContentPolicy` as the single creation/checking policy seam 0788 will consume, matrix stays sole semantic authority (`sectionsForStatus` throws loudly on missing entries, no silent fallback). HTTP parity holds via the shared `TaskService.create` (`apps/server/src/modules/task/handlers.ts:74`); the server test fixture's added `todo` matrix entry aligns the fixture with the probe.

### Residual risk & disposition

1. Finding #1 MUST be fixed before verify (one-token change + ideally a batch review-variant regression test).
2. Finding #2 needs an explicit recorded decision (Q&A or design doc) — the current behavior is defensible under R1 but silently supersedes 0339's todo gate.
3. Finding #3: verify stage should require the CLI-level raw/envelope regression the task's own VERIFY section promises.
4. Plan item 5 (docs sync + doc-evolve + full gates) remains open by design; pipeline wrap must carry it.

Gate evidence: `.spur/run/0787-test-gate.log` tail — 7472 pass / 0 fail, post-check rules green, proof digest recorded. Review performed on the uncommitted worktree diff; no code, tests, or other task sections modified by this review.

Decision: (review finding #2, adjudicated this run by reviewer+verifier convergence) Placeholder-only
Requirements at `todo` intentionally no longer hard-fails. `L3_REQUIREMENTS_EMPTY` is gated on the
effective status's required set (`requiredAtStatus`, `packages/app/src/services/task-check.ts:649-655`), and the
shipped matrix marks Requirements **optional** at `todo` (`config/tasks/section-matrix.yaml:26-28`,
`standard.todo.required: [Background, Acceptance Criteria, Design, Plan]`; Requirements is in
`optional`). The design contract makes the matrix the authority for which placeholder-only bodies
are hard errors (`docs/design/task-creation-readiness.md:38-40`). This matrix-aware gating
intentionally **supersedes task 0339's unconditional Requirements-at-todo gate**: 0339 predated the
matrix-driven L2/L3 split, under which creation ships the guidance-comment scaffold in optional
sections and checking must agree (create → check parity is this task's whole point). At `done`,
Requirements is done-**optional** by design (`config/tasks/section-matrix.yaml:39-41` — the done
row requires only `[Solution, Testing, Review]` with `gate: true`), so placeholder-only
Requirements no longer errors at `done`: a deliberate, accepted divergence from 0339, whose
unconditional gate predated the matrix-driven split. Done readiness is gated by the done evidence
trio — the L3 Solution/Testing placeholder check (`task-check.ts:852`) plus DD-09 AC-coverage
(errors at effective done); no separate "record-completeness review" mechanism exists.

### Re-review (post-remediation)

**Verdict: PASS** — attempt 2 resolves all three substantive findings from the first review with real evidence (gate green: 7477 pass / 0 fail across 417 files, all typechecks + post-check rules pass, proof digest `sha256:35397034e240453ae78e03cc8a903fc480c2c0823b20398778b50f7848395be2` matching the run's recorded quality gate). Decision text corrected by reviewer during review finalization (self-correction of this section's own prose); no code or test changes.

Scope re-reviewed: full uncommitted diff (13 files, +993/−181), task spec R1–R5 + AC, feature F21, shipped matrix (`config/tasks/section-matrix.yaml`), gate log, and every code path the prior findings named.

### Prior-finding resolution

| # | Prior finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | P2 MUST-FIX — batch drops template-seeded Background | **Resolved.** `batchCreate` now forwards `background: item.background` so `undefined` reaches the template-append guard (`packages/app/src/services/task-service.ts:1488`; guard `:596-604`). Parity regression: a `template: review` batch item without a background keeps the template's Background table and matches single create (`packages/app/tests/services/task-service.test.ts:856`). Single create is unchanged (still supplies no background key); non-template batch behavior changes only in that a variant-template Background now survives — exactly the demanded parity. Batch invalid-item path intact: validate-all before the first allocation/lock with `batch item N/M` rethrow (`task-service.ts:1480-1508`, zero-files test `:913`). |
| 2 | P2 — Requirements-at-todo adjudication | **Adjudicated; todo-side grounding verified — but see new finding R1.** Decision entry present (this doc `:137-148`): matrix `standard.todo.required` = `[Background, Acceptance Criteria, Design, Plan]` with Requirements optional (`config/tasks/section-matrix.yaml:26-28`); `L3_REQUIREMENTS_EMPTY` gated on `requiredAtStatus` (`packages/app/src/services/task-check.ts:648-655`); design-contract authority confirmed (`docs/design/task-creation-readiness.md:38-42`). |
| 3 | P2 — missing CLI error-surface regressions | **Resolved.** Four command-boundary tests assert observable contract (`apps/cli/tests/commands/task.test.ts:2892` raw `--json` → exit 1, stdout `{ok:false,error:{code:'candidate-invalid',findings}}`, stderr empty; `:2910` enveloped → `apiErrorSchema` with `details.cliCode`/`details.findings`; `:2933` non-JSON → stderr prose, stdout untouched; `:2949` batch-create raw). Mocking at the service boundary is correct layering — service behavior keeps its own tests. The JSON-mode dup-WBS push (`apps/cli/src/commands/task.ts:1348-1352`) is covered by the pre-existing `--json` test (`task.test.ts:2769`: exit 1, `status:'duplicate'`, `pass:false` in parsed results). |
| — | Plan item 5 (docs sync) | **Docs content landed; item stays open by design.** `docs/04_DESIGN.md` §4.1 gains the create/batch-create emission paragraph and updated inventory rows describing `writeCreateJsonError` (raw `--json` on stdout, `details.cliCode`, exits 1/2/3); §7.4 gains "Matrix-aware L3 gating (0787)" (:2228) plus a creation-status paragraph rewritten around the eligibility probe. Plan item 5's checkbox (doc-evolve sync-check + full gates) remains open — wrap must carry it. |

### New findings

| # | Sev | Dimension | Finding | Evidence | MUST-FIX |
| --- | --- | --- | --- | --- | --- |
| R1 | P2 | Correctness (recorded decision) | The Decision's closure sentence — "At `done`, Requirements still blocks via the matrix `done` row's gate plus the record-completeness review" — was ungrounded on both named mechanisms. The shipped `done` row requires only `[Solution, Testing, Review]`; Requirements is done-**optional** (`config/tasks/section-matrix.yaml:39-41`), so the 0787 gate (`requiredAtStatus.has('Requirements')`, `task-check.ts:650`) cannot fire at `done`; and no "record-completeness review" exists anywhere in packages/apps/plugins/docs (grep: 0 hits). The nearest real done-status gates are DD-09 AC-coverage (AC↔feature scenario subsets, not Requirements placeholders) and the L3 Testing/Solution placeholder check (`task-check.ts:852`). Net widening vs 0339: a `done` task with a placeholder-only Requirements now checks clean — deliberate and accepted per the matrix's done-optional design intent (`section-matrix.yaml:35-38`). **Resolved in place:** the Decision sentence was rewritten during finalization (see verdict note); the todo-side paragraph is untouched; no code or test changes. | `config/tasks/section-matrix.yaml:39-41`; `packages/app/src/services/task-check.ts:648-655`, `:852`; this doc `:146-152` | **yes** → **resolved in place** |
| R2 | P4 | Semantics (note only) | A batch item with explicit `background: ""` suppresses the template-Background append (`input.background === undefined` is false) while single create cannot express that case. Supplied-wins semantics; no current caller. | `packages/app/src/services/task-service.ts:596-604` | no |

### Re-review sweep (traceability / SECUA / architecture)

- R1–R4 re-verified on the post-remediation diff: Background precedence chain intact (supplied → feature-derived → capture line → template append, `task-service.ts:569-604`); `checkContentPolicy`'s positional `summarizeWithStatus` call matches the 8-param signature (accepted=`undefined`, id=wbs, requiredList=`entry?.required`); `serializeTaskFrontmatter` remains the single frontmatter writer on the reader-shared yaml emitter with `lineWidth: 0` (round-trip tests incl. quotes/backslashes/colons/Unicode/newlines, `packages/domain/tests/planning/task-skeleton.test.ts:194-220`); exit-code semantics preserved (usage 2, collision 3, candidate/failed 1).
- No new security surface (checker findings ride inside the JSON envelope; no fs writes before validation), and the remediation does not weaken completion evidence: done still hard-requires the Solution/Testing/Review trio + `gate: true` (`section-matrix.yaml:39-42`).
- Behavior deltas in the diff (feature-linked bare capture → backlog; requirements-only batch item → backlog) are spec-driven (R2 AC), documented in 04_DESIGN.md §7.4, and covered by rewritten tests — not defects.

Gate evidence: `.spur/run/0787-test-gate.log` tail — 7477 pass / 0 fail (417 files), typechecks green, post-check rules pass, proof digest `sha256:35397034e240453ae78e03cc8a903fc480c2c0823b20398778b50f7848395be2`. This re-review modified only this Review subsection; no code, tests, or other task sections touched.


### References
- Feature: F21, consistent task creation and default implementation readiness.
- Decision: docs/00_ADR.md, ADR-109.
- Surface: docs/design/task-creation-readiness.md.
- Discovery evidence: docs/plans/2026-09-06-task-creation-readiness-brainstorm.md.
- Sequence: 0786 → 0787 → 0788; dependency edges are the execution ordering authority.
### History

## Implementation Notes

Production changes (implement stage; Solution/Testing/Review left for later stages):

- `packages/app/src/services/task-service.ts` — added `TaskCandidateInvalidError`, `TaskCandidateShape`, `CANDIDATE_PROBE_WBS`, `resolveCandidateShape` (variant/Background precedence/section bodies/fm object), `checkCandidateContent` (shared `TaskCheckService.checkContentPolicy`), `renderCandidate`, `validateCandidateOrThrow` (probe render validated BEFORE WBS allocation/lock; write loop renders already-validated shapes; rollback kept for I/O failures). `batchCreate` resolves + validates every item up-front; invalid items surface as `TaskCandidateInvalidError` with `batch item N/M` context and leave zero task files and no parent mutations. Background synthesis: supplied → feature-derived → capture line quoting the title; a variant template's own Background body (e.g. review's `#### Review Findings` table) is seeded beneath the capture line so template-as-skeleton behavior survives (supplied/feature-derived background still wins outright).
- `packages/app/src/services/task-check.ts` — L3 REQUIREMENTS/AC placeholder rules now gated on the effective status's required sections (no scaffold-only findings at backlog); `check()` returns `repairs` and full `requiredSections` (resolved matrix obligation set, never the missing subset) plus `missingSections`; new public `checkContentPolicy(raw, wbs, { strict?, asStatus?, severityOverrides? })` reuses L1–L3 without L4.
- `packages/app/src/services/planning-check-base.ts` — `summarizeWithStatus` accepts an optional required-sections list and returns `{ status, findings, requiredSections, missingSections, pass, notes }`.
- `packages/domain/src/planning/task-skeleton.ts` — `serializeTaskFrontmatter` serializes the frontmatter OBJECT via `stringifyYaml(..., { lineWidth: 0 })` so quotes/backslashes/colons/Unicode round-trip exactly (shared library with `MarkdownDocument.parse`).
- `apps/cli/src/commands/task.ts` — `writeCreateJsonError` emits ONE parseable raw/enveloped JSON error for create/batch-create failures (`candidate-invalid` exit 1 with checker findings, `invalid-usage` 2, collision/dedupe 3, `create-failed`/`batch-create-failed` 1). Fixed a latent 0416 R6 gap this task exposed: the non-JSON dup-WBS path printed to stderr but never pushed its failing result, so `task check` exited 0; it now pushes `pass:false` in both modes (previously masked because created tasks failed their own check).
- `packages/app/src/index.ts` — one-line public re-export of `TaskCandidateInvalidError` (same pattern as the neighboring error exports) so the CLI can catch it.

Tests: `packages/app/tests/services/task-service.test.ts`, `packages/app/tests/services/task-check.test.ts`, `packages/app/tests/services/planning-check-base.test.ts`, `packages/domain/tests/planning/task-skeleton.test.ts`, `apps/cli/tests/commands/task.test.ts` — 503 pass / 0 fail targeted; workspace `typecheck` exit 0.

CLI probes (temp corpus, removed after): bare create → `task check` exit 0; `He said "hi" \temp ✓` title round-trips exactly via `show --json`; schema-invalid batch → exit 1, one `{ok:false,error:{code:"batch-create-failed"}}` on stdout, zero writes; background-only batch item → `backlog`, complete item → `todo`; `task check --json` on a todo task reports `requiredSections: [Background, Acceptance Criteria, Design, Plan]`.

Corpus audit (unsuppressed, R5): `task check` over the full corpus → 289 PASS / 10 FAIL, exit 1. All 10 failures are `done`-status tasks with pre-existing `[ERR] L4` corpus-integrity findings (77 total, DD-09 AC-subset/feature diagnostics); 0 L1/L2/L3 errors, 208 L4 + 57 L3 warnings. No finding class originates from this change — classified as historical, nothing suppressed.

Deferred: plan item 5 (docs/04_DESIGN.md sync + doc-evolve + project gates) is not part of this stage — docs were not touched here; corpus-check and full gates run in the pipeline's test stage. Prerequisite 0786 (D6) is intentionally out of scope for this tree.
- 2026-09-06T22:11:34.255Z todo → wip (system)
- 2026-09-06T23:24:56.397Z wip → testing (system)
- 2026-09-06T23:30:10.396Z testing → done (system)
