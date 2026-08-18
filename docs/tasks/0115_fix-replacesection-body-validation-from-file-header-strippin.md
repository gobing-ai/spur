---
schema_version: 1
name: "Fix replaceSection body validation + from-file header stripping + write pipeline L2 gate"
status: done
template: standard
created_at: 2026-06-24T04:37:18.463Z
updated_at: "2026-08-18T04:42:46.848Z"
priority: P1
tags: ["planning-layer", "bugfix", "dogfood", "markdown-document", "write-pipeline"]
feature_id: H2
---

## 0115. Fix replaceSection body validation + from-file header stripping + write pipeline L2 gate

### Background

Discovered while dogfooding `/sp:dev-refine 0110` (refining task 0110's AC/Design/Plan sections). The refine operation writes section content via `spur task update <wbs> --section <name> --from-file <tmp>`. Three distinct tooling defects chained together to corrupt the task file, requiring a full file rewrite via `_write` as a nuclear workaround. The refine operation is the hot path for task preparation — every task goes through it before entering the execution pipeline. These defects waste agent time and tokens on every refine.

**Defect 1 — `--from-file` body contained same-level (`###`) sub-headings → phantom sections.** The temp files written for AC and Design sections contained `### AC1 — dev-operations.md covers all 13 dev-* operations` sub-headings. These are at `###` level — the same level as canonical section headings in task files (`HEADING_LEVELS.task = 3`, so all sections are `###`). The `findHeadings()` function in `packages/domain/src/planning/markdown-document.ts:87-110` scans for exact-level headings using `prefix = `${hashes} `` where `hashes = '###'` for tasks. It found these `### AC1 — ...` lines as separate sections, not as body text. On re-parse, `doc.sectionNames` returned phantom entries like `"AC1 — dev-operations.md covers all 13 dev-* operations"`, which L2 then flagged as "not allowed in this variant/status".

Root cause: `replaceSection()` at `markdown-document.ts:297-305` is a blind string replacement. It does `section.modifiedText = \`${section.headingLine}\n${body}\`` with zero validation of the body content. If the body contains same-level headings, they become phantom sections on next parse.

**Defect 2 — `## SectionName` in the body → visual duplicate headers.** The temp files started with `## Acceptance Criteria` (h2 level), but the task file uses `### Acceptance Criteria` (h3 level). This line isn't a `###` heading, so `findHeadings` ignores it — it's just body text. But it renders as a visible `## Acceptance Criteria` right below the `### Acceptance Criteria` heading, creating a confusing duplicate.

Root cause: the SKILL.md section-editing workflow instructions at `plugins/sp/skills/spur-dev/SKILL.md:275-284` say "Generate the new section content to a temp file" and "`spur task update <wbs> --section <name> --from-file <temp>`" — but never specify that the temp file should be body-only (no section header). An LLM naturally writes `## Acceptance Criteria\n\n- [ ] AC1...` as a complete section, including the heading.

**Defect 3 — No post-write validation in the write pipeline.** The write pipeline at `packages/app/src/services/planning-write-service.ts:303-388` validates only L1 (Zod frontmatter schema) at step 4. L2 (section-status matrix), L3 (format rules), and L4 (traceability) are NOT checked during writes — they only run in the separate `spur task check` command. So a malformed section update writes successfully, and problems are only discovered later when the agent runs `spur task check`. By then, the file is already corrupted.

**Defect 4 (minor) — `2>/dev/null` hid the actual error.** Initial CLI attempts used `2>/dev/null` to suppress stderr, which caused exit 1 to appear without diagnostic output. Removing stderr suppression revealed the actual errors. This is an agent-side mistake, not a tooling bug — but it cost a round-trip. No code fix needed; the SKILL.md should warn against suppressing stderr on CLI calls.

**Impact:** 8 rounds of tool calls where 3 would have sufficed. The extra 5 rounds were debugging self-inflicted corruption — phantom sections, duplicate headers, L2 rejections, and a nuclear file rewrite.

### Requirements
- [ ] R1. Strip leading section header from `--from-file` body before passing to `replaceSection`. If the temp file's first non-empty line is a markdown heading (`#`–`######`) whose text matches the target section name (case-insensitive), strip that line **and any immediately following blank lines** so no triple-newline gap is written. The `--section` flag already names the section; the file content must not duplicate it. Prevents the visual duplicate header (Defect 2); highest-ROI, smallest-change fix.
- [ ] R2. Strip same-level headings in `replaceSection`/`insertSection` body (self-heal, not throw). If the body contains lines at the domain's heading level (`###` for tasks, `##` for features) outside fenced code blocks, **strip them and emit a stderr warning** naming each stripped line — do not throw on the default path. These lines would otherwise become phantom sections on re-parse (Defect 1). A throw would fail the agent's write mid-pipeline and force a regenerate+retry, re-introducing the round-trip cost this task eliminates. Reserve hard-error behavior for an opt-in strict path if one is ever needed. Code-fence state must be tracked so `###` inside ``` blocks is never stripped.
- [ ] R3. Add a post-mutation phantom-section guard to the write pipeline, reusing the **single** canonical+universal section definition. Export `FEATURE_CANONICAL_SECTIONS` and `UNIVERSAL_SECTIONS` from `@gobing-ai/spur-domain` (the former is currently unexported; the latter currently lives in the app layer at `planning-check-base.ts:28`). After `applyMutation()` (step 3) and before L1 frontmatter validation (step 4), assert `doc.sectionNames ⊆ (canonical ∪ UNIVERSAL_SECTIONS)`. If a non-canonical name is present, abort the write with a clear error. This guards **all** mutation paths (including `updateBody`/`replacePreamble`, which R2 does not cover), and `planning-check-base.ts` must be refactored to consume the same exported sets — one definition, no drift (R6).
- [ ] R4. Update SKILL.md section-editing workflow to document body-only format. The instructions at `plugins/sp/skills/spur-dev/SKILL.md:275-284` must specify: (a) the temp file is body-only (no `## SectionName` header — the CLI adds the canonical `### SectionName`); (b) do not use `###` sub-headings inside section bodies — use bullet lists, tables, or `**bold text**` labels instead (the CLI now strips them, but write clean from the start); (c) never suppress stderr on `spur task update` calls. Prevents the agent-side mistakes behind Defects 1, 2, and 4.
- [ ] R5. lint green; all existing tests pass; new tests cover each fix. No test skipped or commented out to go green. In particular, the `appendHistoryLine` transition path (which calls `replaceSection('History', …)` on every status change) and the `record` render functions must continue to pass unchanged.
### Acceptance Criteria
- [ ] AC1. Given a temp file starting with `## Acceptance Criteria\n\n- [ ] AC1...` passed via `--from-file`, when `spur task update <wbs> --section "Acceptance Criteria" --from-file <tmp>` runs, then the `## Acceptance Criteria` line and its trailing blank lines are stripped, only the canonical `### Acceptance Criteria` heading appears, and there is no triple-newline gap before the first body line.
- [ ] AC2. Given a temp file starting with `### Acceptance Criteria` (same-level heading matching the section name), when `spur task update` runs, then the line is stripped by R1 (name match) and no phantom section appears on re-parse.
- [ ] AC3. Given a temp file body containing `### Sub-heading` lines that do NOT match the section name, when `spur task update` runs, then R2 strips those lines, emits a stderr warning naming each, and the write succeeds with no phantom sections on re-parse.
- [ ] AC4. Given a `replaceSection` (or `insertSection`) call whose body contains same-level heading lines outside fenced code blocks, when the call executes, then the offending lines are stripped and a warning is surfaced — the write succeeds and never silently creates phantom sections, and never throws on the default path.
- [ ] AC5. Given a `replaceSection` body containing a `###` line **inside** a fenced code block, when the call executes, then the line is preserved verbatim (code-fence state tracked) — no stripping, no warning.
- [ ] AC6. Given a mutation that would leave a non-canonical section name in the document (via any path, including `updateBody`), when the write pipeline runs, then the R3 post-mutation guard aborts the write with a clear error before atomic write — the file is never written in a corrupted state.
- [ ] AC7. Given the refactor, when both `PlanningCheckService.runL2` and the write pipeline's R3 guard reference the canonical and universal section sets, then they import the **same** exported `TASK_CANONICAL_SECTIONS` / `FEATURE_CANONICAL_SECTIONS` / `UNIVERSAL_SECTIONS` from `@gobing-ai/spur-domain` — no second inline definition exists.
- [ ] AC8. Given the SKILL.md section-editing workflow, when an agent reads it, then it clearly states: (a) temp files are body-only (no section header); (b) no `###` sub-headings inside section bodies; (c) never suppress stderr on CLI calls.
- [ ] AC9. Given the `appendHistoryLine` transition path and the `record` render functions (`renderTesting`, `renderReview`, `renderSolutionFromDiff`), when R2 and R3 are active, then they pass unchanged — these use `**bold**` and markdown tables, not `###` headings, and History bullets are not headings.
- [ ] AC10. Given the repo, when `bun run lint` runs, then it exits 0; and when `bun run test` runs, then all tests pass (existing + new) with no test skipped, `.skip`'d, or commented out.
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**R1 — Strip leading section header from `--from-file` body.**

File: `packages/app/src/services/task-service.ts`, method `updateSection` (lines 322-327).

Current code reads the file and passes raw content directly to `writeService.updateSection`. Change: before the write call, strip a leading heading line matching the section name. Match the first non-empty line against `/^#{1,6}\s+(.+?)\s*$/`; if the captured name equals `sectionName` (case-insensitive, trimmed), remove that line **and any immediately following blank lines** (regex `^#{1,6}\s+<name>\s*\n+`) so the body that reaches `replaceSection` starts at the first real content line — no leading-blank churn. If the first non-empty line is a heading but does NOT match the section name, leave it for R2 to handle.

The strip lives in `task-service.ts` (service layer), not `planning-write-service.ts` (write pipeline), because: (a) the write pipeline is domain-agnostic and doesn't know the section name until `replaceSection`; (b) `task-service.ts` is where section name and file content converge; (c) it keeps the pipeline focused on locking, mutation, validation, serialization.

**R2 — Strip same-level headings in `replaceSection`/`insertSection` body (self-heal).**

File: `packages/domain/src/planning/markdown-document.ts`, methods `replaceSection` (297-305) and `insertSection` (312-332).

Decision: **strip + warn, not throw.** `replaceSection` is on the hot path — `appendHistoryLine` (`planning-write-service.ts:419-423`) calls it on every status transition, and the refine workflow calls it for every section edit. A throw fails the agent's write mid-pipeline and forces a regenerate+retry, re-introducing exactly the round-trip cost 0115 kills. Stripping self-heals: the malformed `###` line is removed, a stderr diagnostic names it, and the write succeeds with no phantom section.

Add a private helper `stripSameLevelHeadings(body: string): { cleaned: string; stripped: string[] }` that reuses `findHeadings`' code-fence-aware scan: iterate lines, track ``` toggle state, drop lines matching `prefix = '#'.repeat(HEADING_LEVELS[this._domain]) + ' '` when not in a code block, collect them in `stripped`. Call it at the top of `replaceSection` AND inside `insertSection` (both paths can receive bodies with same-level headings). When `stripped.length > 0`, emit one `console.warn` per stripped line (or a single aggregated warning) explaining they were removed to avoid phantom sections. The check MUST skip `###` lines inside fenced code blocks (code content, not headings) — same toggle logic as `findHeadings`.

Why strip and not throw: throwing forces the caller to fix content, but the caller here is an LLM mid-pipeline that will retry-and-fail, not a human. Stripping plus a loud warning gives self-healing without silent data loss (the warning surfaces what changed). If a strict mode is ever wanted, it can layer a throw on top — out of scope here.

**R3 — Post-mutation phantom-section guard, single source of truth.**

Files: `packages/domain/src/planning/markdown-document.ts` (exports), `packages/app/src/services/planning-check-base.ts` (refactor to consume), `packages/app/src/services/planning-write-service.ts` (new guard).

Current state: `TASK_CANONICAL_SECTIONS` is exported from domain; `FEATURE_CANONICAL_SECTIONS` is module-private; `UNIVERSAL_SECTIONS` (`History`/`References`/`Notes`) lives in the **app** layer at `planning-check-base.ts:28`. The "reuse domain sets" decision requires consolidating these:

1. In `markdown-document.ts`: `export` `FEATURE_CANONICAL_SECTIONS`, and add+export `UNIVERSAL_SECTIONS = ['History', 'References', 'Notes'] as const` (move the definition here from the app layer — domain owns the section vocabulary).
2. In `planning-check-base.ts`: delete the local `UNIVERSAL_SECTIONS` and import it from `@gobing-ai/spur-domain`. Behavior of `runL2`'s closed-world check is unchanged — same set, one definition.
3. In `planning-write-service.ts` `runSteps`: after `applyMutation(doc, mutation)` (line 320) and before L1 frontmatter validation (line 322), compute `allowed = new Set([...canonicalFor(domain), ...UNIVERSAL_SECTIONS])` and assert every `doc.sectionNames` member is in it. On violation, throw `Write would introduce non-canonical section(s): [names]. These come from same-level headings in a section body — strip them or use bullet lists.` Abort here gives zero partial writes (existing lock + atomic-write guarantee).

This narrows R3 from the original "inline 3-line re-implementation" (Option A) to "reuse the one exported definition." It catches phantoms from any mutation path — including `updateBody`/`replacePreamble`, which R2's `replaceSection`-level strip does not cover. With R2 stripping same-level headings at the domain layer, a section-write can no longer introduce a phantom; R3's residual value is the defense-in-depth guard for the other paths and a single, drift-proof definition (R6). The full L2 matrix check (required/forbidden/gate) stays in `spur task check` — the write pipeline guards only structural corruption, not status-matrix compliance.

**R4 — SKILL.md documentation update.**

File: `plugins/sp/skills/spur-dev/SKILL.md`, "Section-editing workflow" (lines 275-284). After step 3, add a flat "Body-only format" note (no `###` sub-heading — bold or bullets):

- **Body-only:** the temp file is the section body only — no `## SectionName` heading. The CLI adds the canonical heading (`### SectionName` for tasks). If the temp file starts with a heading matching the section name the CLI strips it; write body-only from the start regardless.
- **No same-level sub-headings:** never use `###` sub-headings inside a section body (e.g. `### AC1 — …`). They sit at the canonical section level and would become phantom sections; the CLI now strips them with a warning, but write clean. Use bullet lists, tables, or `**bold**` labels.
- **Never suppress stderr:** run `spur task update` without `2>/dev/null`. Stderr carries the diagnostic (including the new strip warnings); suppressing it causes silent exit-1 failures that waste round-trips.

Also update "Check before write" (292-296): after writing, run `spur task check <wbs>` to confirm the write introduced no structural issues.

**Invariants:**
- `record` render functions (`renderTesting`/`renderReview`/`renderSolutionFromDiff`, `task-record.ts:150-246`) use `**bold**` + tables, never `###` — R2/R3 must not alter their output. Verify with existing record tests.
- `appendHistoryLine` (`planning-write-service.ts:419-423`) calls `replaceSection('History', …)` on every transition; History bodies are bullets, not headings — R2 strip must be a no-op for them, R3 guard must pass (`History` ∈ UNIVERSAL_SECTIONS).
- `insertSection` (upsert path) is protected by R2 — bodies passed there can also carry same-level headings.
- Code-fence state is tracked in R2's scan exactly as in `findHeadings`, so `###` inside ``` blocks is preserved.
- R3 is additive: L1 frontmatter validation (step 4) and lifecycle transition (step 5) are unchanged; R3 inserts between step 3 and step 4.
- One section-vocabulary definition: after R3, `UNIVERSAL_SECTIONS` and the canonical lists exist only in `@gobing-ai/spur-domain`; the app layer imports them.
### Plan
1. Export the section vocabulary from domain: in `packages/domain/src/planning/markdown-document.ts`, add `export` to `FEATURE_CANONICAL_SECTIONS` and add+export `UNIVERSAL_SECTIONS = ['History', 'References', 'Notes'] as const`. Run `bun test packages/domain` to confirm no break.
2. Refactor `packages/app/src/services/planning-check-base.ts` to import `UNIVERSAL_SECTIONS` from `@gobing-ai/spur-domain` and delete the local definition (line 28). Run `bun test packages/app` to confirm `runL2` closed-world behavior is unchanged.
3. Write unit tests in `packages/domain/tests/planning/markdown-document.test.ts` for R2: (a) `replaceSection` strips a `### Sub-heading` body line and the section re-parses with no phantom; (b) it does NOT strip `###` inside a fenced code block; (c) it does NOT alter body with only `**bold**` / table content (record-function pattern); (d) `insertSection` (upsert path) also strips; (e) a stripped line is surfaced (warning/returned list). Run to verify red.
4. Implement R2 in `markdown-document.ts`: add `stripSameLevelHeadings` (code-fence-aware), call it in `replaceSection` and `insertSection`, emit stderr warning per stripped line. Run `bun test packages/domain` to verify green.
5. Write unit tests in `packages/app/tests/services/task-service.test.ts` for R1: (a) `updateSection` strips a leading `## Acceptance Criteria` header + trailing blank lines (no triple newline); (b) strips `### Acceptance Criteria` (same-level, name match); (c) does NOT strip a heading that doesn't match the section name; (d) leaves a `###` inside a code fence untouched. Run to verify red.
6. Implement R1 in `task-service.ts` `updateSection`: add header-stripping between file read and `writeService.updateSection`. Run to verify green.
7. Write unit tests in `packages/app/tests/services/planning-write-service.test.ts` for R3: (a) a mutation leaving a non-canonical section name aborts the write before atomic write; (b) a valid section update does not abort; (c) `record` render-function bodies do not abort; (d) the guard imports the domain-exported sets (no inline list). Run to verify red.
8. Implement R3 in `planning-write-service.ts` `runSteps`: import canonical + `UNIVERSAL_SECTIONS` from domain, add the phantom-section assertion after `applyMutation` (line 320) and before L1 validation (line 322). Run to verify green.
9. Implement R4 in `plugins/sp/skills/spur-dev/SKILL.md`: body-only format note, no-`###`-subheadings rule, never-suppress-stderr warning, and the check-after-write line.
10. Run `bun run lint` — verify clean (Biome + per-workspace tsc --noEmit).
11. Run `bun run test` — verify all tests pass (existing + new), no skips; confirm record and transition/history tests still green.
12. Run `bun run build` — verify all workspaces build.
13. Smoke test: create a temp task, write a section via `--from-file` with a `## SectionName` header AND stray `### Sub` lines; confirm the CLI strips both, emits warnings on stderr, the write succeeds, and `spur task check` reports no phantom sections.
### Solution

Implemented R1–R4. Change-map:

| Change (`file:line`) | What / why |
|----------------------|------------|
| `packages/domain/src/planning/markdown-document.ts:51-67` | R3: `export` `FEATURE_CANONICAL_SECTIONS` + new exported `UNIVERSAL_SECTIONS` — domain owns the section vocabulary (single source of truth). |
| `packages/domain/src/planning/markdown-document.ts:311-323` | R2: `replaceSection` now strips same-level headings via `stripSameLevelHeadings` and guarantees a trailing newline so the next heading stays at line-start. |
| `packages/domain/src/planning/markdown-document.ts:325-360` | R2: new `stripSameLevelHeadings` helper — code-fence-aware scan, drops `###`/`##` body lines, `console.warn` per stripped line. |
| `packages/app/src/services/task-service.ts:127-145` | R1: new `stripLeadingSectionHeader` helper — removes a leading heading matching the section name (any level) + trailing blanks. |
| `packages/app/src/services/task-service.ts:340-346` | R1: `updateSection` strips the leading header before handing the body to the write service. |
| `packages/app/src/services/planning-write-service.ts:17-25` | R3: import canonical + `UNIVERSAL_SECTIONS` from domain. |
| `packages/app/src/services/planning-write-service.ts:328-338` | R3: step 3.5 phantom-section guard — abort before atomic write if a non-canonical section name is present. |
| `packages/app/src/services/planning-write-service.ts:395-417` | R3: `assertNoPhantomSections` helper. |
| `packages/app/src/services/planning-check-base.ts:18-26` | R3: import `UNIVERSAL_SECTIONS` from domain, drop the local definition (one definition, no drift). |
| `plugins/sp/skills/spur-dev/SKILL.md:283-300` | R4: body-only format rules (no header, no `###` sub-headings, never suppress stderr) + check-after-write note. |

Tests: `markdown-document.test.ts` (R2, 6 cases incl. code-fence + feature domain), `task-service.test.ts` (R1, 3 cases), `planning-write-service.test.ts` (R3, 4 cases + corrected feature fixture title `# A:` per real format).

Verification: `bun run lint` clean (Biome + 7 workspaces tsc); `bun run test` 1753 pass / 0 fail; `bun run test-cf` 1 pass; `bun run build` all workspaces; live smoke test confirmed R1 strips `## Background`, R2 strips stray `### Sub` with stderr warning, no phantom sections on re-parse.

### Testing
**Verify verdict: PASS** (`/sp:dev-verify 0115 --auto --fix all`, 2026-06-24)

Per-requirement traceability:

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/task-service.ts:138` `stripLeadingSectionHeader` + `:345` wired into `updateSection`; tests `packages/app/tests/services/task-service.test.ts:543` (h2 strip, h3 same-level, non-match survives) |
| R2 | MET | `packages/domain/src/planning/markdown-document.ts:357` `stripSameLevelHeadings` (code-fence-aware) + `:268` `strippedHeadings` getter; tests `packages/domain/tests/planning/markdown-document.test.ts:528` (strip, code-fence preserve, bold/table no-op, insertSection, feature `##` domain) |
| R3 | MET (fixed during verify) | `packages/app/src/services/planning-write-service.ts:428` `assertNoNewPhantomSections` + `:434` `phantomSections`, single domain vocabulary; tests `packages/app/tests/services/planning-write-service.test.ts:247` (new-phantom reject, pre-existing tolerate, R2+R3 chain) |
| R4 | MET | `SKILL.md:286` body-only format block (no header, no `###`, never suppress stderr) + check-after-write note |
| R5 | MET | full gate green below; no test skipped/`.skip`/commented |

Gate results:

| Gate | Result |
|------|--------|
| `bun run lint` | PASS — Biome 362 files + 7 workspaces tsc |
| `bun run test` | PASS — 1756 pass / 0 fail |
| `bun run test-cf` | PASS — 1/1 |
| `bun run build` | PASS — 3 workspaces |
| `rule run --preset recommended-pre-check --fail-on warning` | PASS — 22/22 |

Coverage: domain `markdown-document.ts` ≈96% func / ≈99% line. R1/R2/R3 suites: 124 tests pass.
### Review

**SECU review** (`/sp:dev-verify 0115 --fix all`) — verdict PASS, one P1 fixed during this pass.

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 (FIXED) | Correctness | `planning-write-service.ts` R3 guard | **Backward-compat regression:** the original `assertNoPhantomSections` aborted on ANY non-canonical section, including ones a PRIOR write had already planted. ~15 live corpus tasks (0034, 0038, 0072–0075, 0085, 0088, 0090, 0092–0093, 0097–0098, 0100–0101, 0105) carry `###` sub-headings in Testing/Review bodies from earlier rd3 verify runs; a benign `spur task update` on any of them threw, making them un-editable through the CLI. **Fix:** snapshot pre-existing phantoms before `applyMutation`, abort only on NEWLY-introduced ones (`assertNoNewPhantomSections`). Pre-existing corruption is now tolerated by the write path and left for `spur task check` to surface — the cleanup surface, not the write guard. |
| P3 | Correctness | `task-service.ts:139` | R1 regex capture group `(\s*)` (`match[1]`) is unused — `match[0].length` already covers leading whitespace. Harmless dead capture; not worth a change. |
| P4 | Correctness | `markdown-document.ts:357` | `_strippedHeadings` accumulates across multiple `replaceSection` calls on one long-lived doc. In the pipeline (one fresh doc per `runSteps`) this is correct; only a hypothetical multi-edit reused instance would over-report. No action. |
| P4 | Security | `task-service.ts:139`, `markdown-document.ts:357` | Regexes are linear (lazy `(.+?)` with deterministic boundary; `startsWith` scan) — no ReDoS. Input is an agent-authored temp file, not external/untrusted. Clean. |

Note (scope honesty): R3's "newly-introduced phantom" branch is, in normal operation, unreachable — R2 strips same-level headings on section writes upstream, and `replacePreamble` doesn't recompute `sectionNames` in-process. R3's live value is therefore (a) tolerant defense-in-depth and (b) a guard for any future mutation path that adds a section directly. The unit test asserts both branches of the guard function directly rather than faking an unreachable service path.

### History
- 2026-06-24T05:40:30.716Z todo → wip (system)
- 2026-06-24T06:16:41.202Z wip → testing (system)
- 2026-06-24T06:50:02.978Z testing → done (system)
