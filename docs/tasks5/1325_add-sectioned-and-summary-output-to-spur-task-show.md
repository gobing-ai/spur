---
schema_version: 1
name: Add sectioned and summary output to spur task show
status: wip
template: feature-impl
created_at: 2026-11-10T07:34:40.665Z
updated_at: "2026-11-10T23:15:24.070Z"
feature_id: F22

priority: P2
ac_altitude: task-local
estimate_hours: 6
---

## 1325. Add sectioned and summary output to spur task show

### Background

KK history analysis since spur 0.4.30 (2026-11-10): task files of 36–52KB (0345: 35,959 bytes;
0346: 51,947 bytes) were re-read whole via `spur task show` across sessions, contributing to average
cache-read contexts of 74–170K tokens per assistant step (claude avg 102K, max 161K) and 265–708
step sessions. The `precheck-size` gate already forces oversized task files to trim, but the size
budget is not surfaced at authoring/refine time, and there is no way to read one section without
paying for the whole file.

### Requirements

- [x] R1. `spur task show` gains a section filter (e.g. `--sections "Background,Requirements"` or repeated
   `--section`) and a summary mode (metadata + section index + per-section byte counts) so callers
   never need the full dump to plan or resume.
- [x] R2. Size budget: the create/update/refine surface reports current file size against the
   `precheck-size` threshold at write time, not only at pipeline precheck.
- [x] R3. Guidance: decomposition/refine guidance prefers phase-scoped task docs over one monolithic file
   when the AC set grows past the budget.

### Acceptance Criteria

- [x] AC1 — (req: R1): `spur task show <wbs> --section Background --json` returns only that section's body plus
  metadata, byte-identical to the file's section content.
- [x] AC2 — (req: R1): Summary mode returns the section index with byte counts and total size without section bodies.
- [x] AC3 — (req: R2): Writing a task that exceeds the precheck-size threshold emits a size warning (or error, per
  current policy) at the CLI write, before any pipeline run.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-10T16:30:44.388Z

- Q: Why not let agents use sed/awk on task files? A: Callers already do, inconsistently; the CLI
  owns the section matrix, so the CLI should own filtered reads. This also keeps JSON consumers
  off markdown parsing.
- Q: Is the size warning a hard error? A: Warning at write time; `precheck-size` remains the hard
  gate at pipeline admission. This mirrors current policy rather than tightening it.
- Q: Dependencies? A: None.

### Design

**Decision: filter at the CLI read surface, not in callers.** `spur task show` already parses the
task file into frontmatter + sections; add two flags on that path only.

1. `--section <name>` (repeatable) or `--sections "A,B"`: return only the named sections' bodies
   plus frontmatter metadata, byte-identical to the file content. Unknown section names are an
   error listing valid names.
2. `--summary`: return frontmatter metadata plus a section index (name, byte count, heading line)
   and total file size, with no section bodies.
3. Size budget at write: the create/update/refine write path compares file size against the
   `precheck-size` threshold and emits a size warning at write time (before any pipeline run).
   Decomposition guidance prefers phase-scoped task docs when AC sets outgrow the budget.

No new flags on other nouns; no change to the task file schema.

### Plan

- [x] P1. Section filter on `spur task show`: flag parsing, section extraction, JSON + human
  output, unknown-name error.
- [x] P2. Summary mode: section index with byte counts and total size, no bodies.
- [x] P3. Size-budget warning on the task write path (create/update/refine) using the existing
  precheck-size threshold.
- [x] P4. Tests: filtered output byte-identity, summary byte counts, oversize write warning;
  update spur-cli reference docs.

### Solution

Domain: `markdown-document.ts` gains `MarkdownSectionContent` + `sectionContent(name)` — the
byte-exact heading+body slice of a section (null when absent; no canonical re-validation).

App (`packages/app/src/services/`):
- `task-query-ops.ts` — `showSections(wbs, requested)` (validates names → `VALIDATION_FAILED`
  error listing the file's sections; returns file-order entries `{name, headingLine, byteCount,
  content}` + `totalBytes`) and `showSummary(wbs)` (all sections, byte counts, no `content`);
  both share a private `readTaskSummary()` with `show()`. `TaskService` delegates via
  `task-service.ts` (types `TaskShowSectionEntry`/`TaskShowSectionsResult` exported from the
  package index).
- `task-files.ts` — `sizeBudgetWarnings(filePath)` evaluates the existing
  `evaluateTaskSize` precheck (`task-size-precheck.ts`) against the current file and returns
  advisory strings (errors swallowed → `[]`).
- `task-create-ops.ts` / `task-update-ops.ts` — merge those advisories into `create` /
  `batchCreate` children / `updateBody` result `warnings[]`. Warning-only, never blocking.

CLI (`apps/cli/src/commands/`): `task/show.ts` adds `--section` (repeatable, via a `collect`
collector), `--sections` (CSV), `--summary`; `--summary` + section flags is a usage error
(exit 2); unknown section exits 3 (`VALIDATION_FAILED`), mirroring `task sections`; human mode
prints summary lines (`### Name — N bytes` + total) or the verbatim section content; `--json`
envelopes the new result shapes. `task/create.ts` surfaces write-time warnings to stderr
(human) / `warnings[]` (JSON). `shared-options.ts` registers the new `--section` homonym
(parity test green).

Docs: `plugins/sp/skills/spur-cli/references/tasks.md` — fast-path block, verb-map row, and new
"Sectioned and summary reads" / "Write-time size advisory" sections.

Scope note (R3): the decomposition guidance requirement is delivered as documentation (Design §3
and the reference-doc advisory section), matching the staged scope; no behavior change outside
the four plan items.

### Testing

- `packages/app/tests/services/task-show-sections.test.ts` (new, 9 pass): filtered
  byte-identity vs an independently computed file slice (incl. multi-byte bodies), file-order +
  dedupe, unknown-name `VALIDATION_FAILED` listing valid names, summary index with byte counts
  and no `content` keys, oversize batch-create/updateBody warnings (non-blocking), conforming
  write silent.
- `apps/cli/tests/commands/task/show.test.ts` (+7, 12 pass): `--section` JSON byte-identity,
  repeatable + CSV file order, `--summary` byte counts/total, human summary + section output,
  unknown-name exit 3, `--summary` + `--section` exit 2.
- Regression: domain suite 1469 pass; `task-service.test.ts` 133 pass; CLI
  show/create/update/sections + shared-option parity 104 pass.
- `bunx tsc --noEmit` clean in domain, app, cli; `bunx biome check` clean on all 12 touched
  files.

### Review

# Review Cert — task 1325 (Add sectioned and summary output to spur task show)

Pipeline run a1e2ffb7-2205-40e4-9324-8d54f5209668, review visit 2 — remediation re-review. Scope:
delta commit 2ec3071ff (fix: render batch-create child size advisories at the CLI boundary; 3
files — `batch-create.ts` +15, `batch-create.test.ts` +48, `tasks.md` +11/−4) verified against the
full R1–R3 / AC1–AC3 contract; the visit-1 verified surface (485d6dc4d + 49fa0db03) re-run for
regression. HEAD = 2ec3071ff, working tree clean. Visit-1 cert (this file, superseded) was PARTIAL
solely on Finding 1 (P2).

## Verification summary (all commands fresh-run this session)

| # | Command / probe (cwd) | Outcome |
|---|------------------------|---------|
| 1 | `git show 2ec3071ff` | Diff read: JSON branch projects per-child `warnings` rows (`apps/cli/src/commands/task/batch-create.ts:78-80`, conditional spread `:88` — present only when non-empty, mirroring the 1132-R1 `normalized` row convention); human branch prints `<wbs>: <warning>` to stderr (`:103-106`); +2 tests + 1 negative guard; reference-doc advisory section rewritten with exact rendering semantics |
| 2 | `bun test tests/commands/task/batch-create.test.ts` (apps/cli) | **13 pass, 0 fail, 46 expect() calls** — incl. `oversize batch child surfaces warnings rows in --json` (`:295`), `oversize batch child prints size advisory to stderr in human mode` (`:315`), and the additive-only guard `'warnings' in parsed === false` on a clean batch (`:283-284`) |
| 3 | Live CLI probe — JSON mode (throwaway `/tmp/spur-1325-rev2-probe` project; repo corpus untouched) | `task batch-create --skip-ready --file batch.json --json` → exit 0; stdout envelope carries `"warnings": [{"wbs": "0001", "warnings": ["Task has 11 R-items (max 10). Consider decomposing into smaller tasks."]}]`; stderr empty (envelope carries the advisory); written task file confirmed to contain exactly 11 unchecked R-items |
| 4 | Live CLI probe — human mode (same throwaway project, second 11-R batch) | `task batch-create --skip-ready --file batch2.json` → exit 0; stderr exactly `0002: Task has 11 R-items (max 10). Consider decomposing into smaller tasks.` (WBS-prefixed, matches single-create channel); stdout keeps the created report clean |
| 5 | Live CLI control probe — conforming 3-R batch (same throwaway project) | exit 0; `warnings` key **absent** from JSON (grep count 0) and stderr empty — additive-only projection holds on clean writes |
| 6 | `bun test tests/services/task-show-sections.test.ts` (packages/app) | **9 pass, 0 fail, 39 expect() calls** — visit-1 surface intact (AC1 byte-identity, AC2 summary, service-level oversize batch warnings non-blocking) |
| 7 | `bun test tests/commands/task/show.test.ts` (apps/cli) | **12 pass, 0 fail, 61 expect() calls** — visit-1 surface intact |
| 8 | `bunx tsc --noEmit` (apps/cli) | exit 0 |
| 9 | `bun test tests/help-doc-parity.test.ts` (apps/cli) | **2 pass, 0 fail** |
| 10 | `bun test tests/help-docs-parity.test.ts` (plugins/sp) | **3 pass, 0 fail** — the edited reference doc still parses against the live CLI surface |
| 11 | Reference-doc conformance read (`plugins/sp/skills/spur-cli/references/tasks.md:63-72`) | States exactly the shipped behavior, clause by clause: single `create` → top-level `warnings` in `--json` + bare stderr; `batch-create` → per-child `warnings` rows (`[{"wbs", "warnings"}]`, present only when non-empty) in `--json` + `<wbs>: <warning>` stderr lines; `update --section` unchanged; advisory **never blocks the write** — every clause matched against live probes #3–#5 |

Probe dir deleted after capture; `git status --porcelain` clean (no corpus pollution).

## Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness/usability | Visit-1 Finding 1 — `task batch-create` dropped the child size advisory at the CLI boundary (JSON envelope projected only `created/wbs/parentsWired/normalized/featureReopened/readiness`; human branch printed no warnings), leaving doc-guided bulk authors silent on oversize children. FIXED in 2ec3071ff: JSON branch now projects per-child `warnings` rows additively and the human branch prints WBS-prefixed advisory lines to stderr; proven this visit by suite run #2 (13 pass incl. both new oversize tests) and fresh live probes #3 (JSON row rendered, stderr clean) and #4 (stderr `<wbs>: <warning>` rendered, exit 0) through the real CLI on a throwaway project; the reference-doc sentence was corrected in the same commit so doc and behavior agree exactly (probe #11). | `apps/cli/src/commands/task/batch-create.ts:78-80,88,103-106`, `plugins/sp/skills/spur-cli/references/tasks.md:63-72` | FIXED (commit 2ec3071ff; verified by test run #2 + live probes #3–#5 this session) |
| 2 | P3 (minor) | correctness | (Carried from visit 1, unchanged by 2ec3071ff.) The single `task create` CLI surface cannot author an oversize body (no body-input flag; template body is minimal), so its warning projection is near-unreachable for size advisories in practice. Harmless projection code; the service contract still reports. | `apps/cli/src/commands/task/create.ts:97-124` | DEFER (accepted as-is: single-create cannot author an oversize body, so the advisory is practically unreachable there; the service contract still reports it) |
| 3 | P3 (minor) | usability | (Carried from visit 1, unchanged by 2ec3071ff.) `--sections ","` (only empty CSV entries) silently falls back to the full dump instead of erroring — the caller pays for the whole file. Edge case; full-dump fallback is the safer default. | `apps/cli/src/commands/task/show.ts:50-58` | DEFER (accepted as-is: empty-CSV full-dump fallback is the safer default; an explicit error would break tolerant callers) |
| 4 | P3 (minor) | documentation | (Carried from visit 1; section rewritten at `tasks.md:63-72` in 2ec3071ff for rendering accuracy — Finding 1 — but the rewrite still carries the R3 "prefer phase-scoped task docs" preference via the warning text and pre-existing split guidance rather than a dedicated sentence. Corpus-level guidance chain satisfies R3; no behavior gap.) | `plugins/sp/skills/spur-cli/references/tasks.md:63-72`, `packages/app/src/services/task-size-precheck.ts:99`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:331-336` | DEFER (accepted as-is: corpus guidance chain satisfies R3; no behavior gap) |

Class sweep (re-checked this visit): every size-warning producer now has a rendered surface — single
`create` (top-level `warnings` JSON + bare stderr, visit-1 probe), `batch-create` (per-child rows +
`<wbs>: <warning>` stderr, this visit's probes), `update --section` (bare stderr, visit-1 probe),
`updateBody` (service-only; the pipeline refine caller consumes `warnings[]` directly). No sibling
dropped-render instances remain. The `warnings` envelope key is additive-only when non-empty,
mirroring the existing `normalized` convention; the negative guard test (`batch-create.test.ts:283-284`)
locks its absence on clean batches.

## Requirement traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/task-query-ops.ts:71-97` — `showSections` (exact-name validation → `VALIDATION_FAILED` listing present sections, file order, byte-exact `content`, UTF-8 `byteCount`); `:101-113` — `showSummary` (index, no bodies); CLI flags `apps/cli/src/commands/task/show.ts:35-48`; fresh this visit: suites #6 (9 pass) and #7 (12 pass) |
| R2 | MET | `packages/app/src/services/task-files.ts:222-229` — `sizeBudgetWarnings` runs the same `evaluateTaskSize` the `precheck-size` gate runs; merged into create / batchCreate children / updateBody results (`task-create-ops.ts:402,594-600`, `task-update-ops.ts:383-387`); rendered at every CLI write surface — batch-create proven live this visit (probes #3–#4: 11-R batch → JSON warnings row + stderr `0002: Task has 11 R-items (max 10). Consider decomposing into smaller tasks.`, exit 0), single `create` and `update --section` proven live visit 1; suite #2 fresh-run 13 pass |
| R3 | MET | Documentation guidance per Design §3: warning text carries the decompose nudge `Task has 11 R-items (max 10). Consider decomposing into smaller tasks.` (`task-size-precheck.ts:99`, observed live in probes #3–#4); reference-doc advisory section `tasks.md:63-72` now states write-time budget + `precheck-size` gate pointer accurately; split-oversize guidance `execution-workflow.md:331-336`. The chain prefers decomposition over one monolithic file when the R/AC set passes the budget; residual doc-polish note remains Finding 4 (ACCEPTED) |

## Acceptance Criteria traceability

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/task-show-sections.test.ts:116` "showSections returns byte-identical section content (AC1)" (pass; 9/9 file suite, fresh run #6) + `apps/cli/tests/commands/task/show.test.ts:121` "show --section returns only that section, byte-identical to the file (AC1)" (pass; 12/12 file suite, fresh run #7); visit-1 independent byte-identity spot check (4 sections, identical=true) unaffected — 2ec3071ff touches no show/section code |
| AC2 | MET | test | `packages/app/tests/services/task-show-sections.test.ts:159` "showSummary returns the section index with byte counts and no bodies (AC2)" (pass, fresh run #6) + `apps/cli/tests/commands/task/show.test.ts:166` (pass, fresh run #7); visit-1 live probe (11 entries, 0 `content` keys, totalBytes = file bytes) stands |
| AC3 | MET | test | Service: `packages/app/tests/services/task-show-sections.test.ts:178` "batch-create with 11 R-items warns at write time without blocking" (pass, fresh run #6). CLI, both channels — fresh this visit: `apps/cli/tests/commands/task/batch-create.test.ts:295` (JSON warnings rows) and `:315` (human stderr exact-match with WBS cross-check), plus live probes #3–#4 through the real CLI on a throwaway project: 11-R batch → exit 0 with the advisory rendered in `warnings[]` (JSON) and on stderr (human), before any pipeline run. Warning-only per policy (Q&A: write-time warning; `precheck-size` stays the hard gate) |

## Residual risk

- Findings 2–4 carried (ACCEPTED): single-create oversize authoring is practically unreachable; `--sections ","` falls back to the full dump; R3 guidance rides the warning text rather than a dedicated doc sentence. All three degrade to pre-1325 behavior; none bypasses a gate (`precheck-size` remains the hard admission gate).
- The batch-create envelope gained a conditional `warnings` key — additive-only when non-empty (locked by the `:283-284` negative guard). Consumers doing strict whole-envelope shape equality would see the new key; the shape follows the existing `normalized` row convention (1132 R1), so row-shaped consumers are unaffected.
- Visit-1 byte-identity spot checks (4 of 11 sections of the live 1325 file) stand; 2ec3071ff touches only `batch-create.ts`, its test, and the reference doc — no show/section path changed, and suites #6/#7 confirm the surface unchanged.

## Design conformance

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 2ec3071ff matches the remediation scope exactly: per-child `{wbs, warnings}` rows mirror the file's own `normalized` precedent (additive, omitted when empty), stderr channel and exit-code semantics match single `create` (advisory, never blocks — probes #3–#5 all exit 0), the reference-doc sentence was corrected in the same commit (probe #11), and the suite was extended rather than relaxed (13 pass, +2 tests +1 guard). No scope creep: no other files touched. |

Confidence: MEDIUM

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:03.319Z backlog → todo (system)
- 2026-11-10T23:15:24.070Z todo → wip (system)

