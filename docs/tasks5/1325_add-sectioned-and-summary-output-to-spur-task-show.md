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

- [ ] R1. `spur task show` gains a section filter (e.g. `--sections "Background,Requirements"` or repeated
   `--section`) and a summary mode (metadata + section index + per-section byte counts) so callers
   never need the full dump to plan or resume.
- [ ] R2. Size budget: the create/update/refine surface reports current file size against the
   `precheck-size` threshold at write time, not only at pipeline precheck.
- [ ] R3. Guidance: decomposition/refine guidance prefers phase-scoped task docs over one monolithic file
   when the AC set grows past the budget.

### Acceptance Criteria

- [ ] AC1 — (req: R1): `spur task show <wbs> --section Background --json` returns only that section's body plus
  metadata, byte-identical to the file's section content.
- [ ] AC2 — (req: R1): Summary mode returns the section index with byte counts and total size without section bodies.
- [ ] AC3 — (req: R2): Writing a task that exceeds the precheck-size threshold emits a size warning (or error, per
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

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:03.319Z backlog → todo (system)
- 2026-11-10T23:15:24.070Z todo → wip (system)

