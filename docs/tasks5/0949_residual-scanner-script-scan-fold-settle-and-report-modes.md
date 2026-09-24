---
schema_version: 1
name: "Residual scanner script: scan, fold, settle and report modes"
status: todo
template: feature-impl
created_at: 2026-09-24T18:59:37.116Z
updated_at: "2026-09-24T18:59:37.124Z"
feature_id: F96
priority: P2
tags:
  - residual-sweep
  - plugin-script
estimate_hours: 5

---

## 0949. Residual scanner script: scan, fold, settle and report modes

### Background

Feature F96 makes task leftovers verification evidence so refine → run → wrap needs no manual "anything remained?" prompt. This task builds the deterministic engine every other F96 task calls. It adds no pipeline wiring; that is the next task.

Premises (verified 2026-09-24):
- Review findings live in `### Review` tables with a `Priority` column whose position varies: `| Priority | Dimension | Location | Finding |` (plugins/sp/skills/code-verification/SKILL.md:311) versus `| # | Priority | Dimension | Finding | Location |` in reviewer-written tasks. Priority cells are `P3`, `P3 (minor)`, `P4 (advisory)`, etc. SECUA review requires the table even when empty (plugins/sp/skills/code-verification/references/secu-review.md:92).
- The verdict artifact `.spur/run/<wbs>-verdict.json` carries a `checks[]` array of `{name, status, evidence}` rows (plugins/sp/skills/code-verification/references/verdict-schema.md:33); additive rows are documented from verdict-schema.md:130.
- `<wbs>-test-gate.findings` holds unique `file.ext:line` anchors, code-unit sorted, capped at 20 (plugins/sp/scripts/quality-gate.ts:10); the test-fix hop reads it into `gateFindings` (config/workflows/task-pipeline.yaml:366).
- Plugin scripts that ship standalone are registered as `contract: standard` with an `.mjs` twin in config/plugin-scripts.json:73-75 and converted by `build:scripts` (package.json:61) via `superskill script convert sp <file>.ts`; script-contract-check.ts enforces twin freshness (plugins/sp/scripts/script-contract-check.ts:7).
- Existing scripts take `--spur-bin` for the CLI (plugins/sp/scripts/verify-answer-lint.ts:27) and guard `main()` with `import.meta.main` (plugins/sp/scripts/verify-answer-lint.ts:547); tests live in plugins/sp/tests/ (e.g. plugins/sp/tests/quality-gate.test.ts).
- Follow-up creation must not dispatch a model: `spur task create` supports `--feature`, `--skip-ready` and a 300 s dedup guard when `--feature` is set (`spur task create --help`).
- Prior art: a post-PASS residual-sweep pipeline state (task 0596) was deleted by ADR-076 for adding a model query (docs/design/planning-workflow-contracts.md:60); this scanner is model-free.

### Requirements

- [ ] R1. Add `plugins/sp/scripts/residual-scan.ts` with CLI `residual-scan.ts <scan|fold|settle|report> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]`, importing only `node:*`/`bun:*` builtins and relative paths, and exporting pure functions for each category parser, `classify`, `foldVerdict` and `renderReport`.
- [ ] R2. `scan` writes `.spur/run/<wbs>-residuals.json` (schema in the F96 design doc) with categories `review-finding` (any Review table with a Priority column; priority `^P[1-4]`; finding not `none`/`—`), `diff-marker` (TODO/FIXME/XXX/HACK on lines added since `.spur/run/<wbs>-base.sha`, including untracked files, excluding `docs/tasks*/`, `docs/features/`, `.spur/` and lines containing `residual-scan:allow`), `unchecked-box` (`- [ ]` lines in the task file) and `staging-residue` (`<tmp-dir>/<wbs>-*`, default `/tmp`). A missing base file sets `scanned.diff-marker=false` instead of guessing.
- [ ] R3. Classification: P1–P3 findings, diff markers and unchecked boxes are `blocking`; P4 is `advisory`; staging residue is `housekeeping`. An entry `{id, reason}` with a non-empty reason in `.spur/run/<wbs>-residual-deferrals.json` reclassifies a matching P3 finding or diff marker as `deferrable`; it never affects P1/P2 findings or unchecked boxes. Item id = `<category>:<first 8 hex of sha256(location + normalized text)>`.
- [ ] R4. `fold` reads `<wbs>-verdict.json` and the scan, replaces any existing `residual-sweep` check with one whose status is `fail` when blocking > 0 (otherwise `pass`) and whose evidence lists counts plus blocking and deferrable ids, downgrades verdict `PASS` to `PARTIAL` when blocking > 0, leaves `PARTIAL`/`FAIL` unchanged, and merges blocking `file:line` anchors into `<wbs>-test-gate.findings` (unique, sorted, cap 20). Idempotent.
- [ ] R5. `settle` is idempotent. When deferrables exist and `followUp` is unset, it creates one task via `<spur-bin> task create "Residuals from <wbs>" --feature <task feature_id> --skip-ready --json`, writes its Background (source task, each deferred item, location and reason) through `task update --section Background --from-file`, and stores `followUp` in the residuals file. It deletes only regular files matching `<tmp-dir>/<wbs>-*` and exits 0 with a printed re-run command on failure.
- [ ] R6. `report` is a no-op (exit 0) unless the verdict has a failing `residual-sweep` check. In that case it writes `.spur/run/<wbs>-residual-report.md` (each blocking item with location, text and the attempt count from `<wbs>-test-fix-attempt`) and prints `Recovery: fix the items in .spur/run/<wbs>-residual-report.md, then /sp:dev-run <wbs>`.
- [ ] R7. Register the script as `standard` with a `residual-scan.mjs` twin in config/plugin-scripts.json, add its convert step to `build:scripts`, generate the twin, and document the `residual-sweep` check row in verdict-schema.md.

### Acceptance Criteria

- [ ] AC1 — Deterministic residual scan classifies task leftovers (req: R1, R2, R3)

Task-only checks: fold, settle and report behaviour (R4–R6) are proven by unit tests with a stub spur-bin; the twin passes script-contract-check (R7).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Contract owner: `docs/design/task-residual-sweep.md` (§Scanner, §Artifact). Follow it verbatim; any deviation updates that doc in the same commit.

Decisions:
- One script, four modes, pure functions plus a thin `main(argv, env)`. This mirrors wrapup-steps.ts (plugins/sp/scripts/wrapup-steps.ts:453) for testability. No class hierarchy.
- The diff source is `git diff --unified=0 <base>` (working tree vs base, covering committed and uncommitted changes) plus `git ls-files --others --exclude-standard` for untracked files, whose full content counts as added. Parse `+` lines, not `+++`, and track new-file line numbers from hunk headers.
- Review parsing: split `### Review` (up to the next `### `) into markdown tables; locate the `Priority`/`Finding`/`Location` columns by header name. Take the location from the Location column, else the first backticked `path:line` in the finding. Normalize `path:12-18` to `path:12` for anchors.
- Task file and feature id come from `<spur-bin> task show <wbs> --json` (`filePath`, `content`, `frontmatter.feature_id`), never a folder guess. The spur-bin resolution mirrors wrapup-steps `spurCommand` (plugins/sp/scripts/wrapup-steps.ts:67).
- The scan writes only under `.spur/run/`. It is observe-only (ADR-071) and safe inside the verify stage after the digest bracket.
- Anti-patterns: no model calls, no `spur task update` outside `settle`, no rm of directories, no deletion outside `<tmp-dir>/<wbs>-*`.

### Plan

- [ ] Write failing tests in `plugins/sp/tests/residual-scan.test.ts`: review tables (both column orders, `none` rows, P1–P4 labels with suffixes), diff markers (added vs pre-existing lines, untracked file, excluded paths, allow pragma, missing base), unchecked boxes, classification and deferral rules (P1/P2 immune), stable ids, fold (PASS→PARTIAL, idempotent, findings merge/cap), settle (stub spur-bin script recording argv; idempotent; tmp cleanup scoped via `--tmp-dir`), report (no-op vs written file).
- [ ] Implement `plugins/sp/scripts/residual-scan.ts` to green.
- [ ] Register in config/plugin-scripts.json, extend `build:scripts`, run `superskill script convert sp residual-scan.ts`, and confirm `bun plugins/sp/scripts/script-contract-check.ts` passes.
- [ ] Document the `residual-sweep` check row in plugins/sp/skills/code-verification/references/verdict-schema.md.
- [ ] Run `(cd plugins/sp && bun test tests/residual-scan.test.ts)`, then `bun run plugin-smoke` and `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
