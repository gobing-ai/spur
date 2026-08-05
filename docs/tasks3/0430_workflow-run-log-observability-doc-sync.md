---
template: meta
schema_version: 1
name: "Workflow run-log observability doc sync"
description: ""
status: done
type: meta
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["docs", "sync", "observability", "workflow"]
dependencies: ["0426", "0427", "0428", "0429"]
created_at: "2026-08-04T17:25:04.948Z"
updated_at: "2026-08-05T02:14:08.117Z"
---

## 0430. Workflow run-log observability doc sync

### Background

Feature D2 — same-change doc sync (constitution T8/T9/T4). The ADR-045 entry, `docs/03_ARCHITECTURE.md §6.1`, the `docs/design/workflow-run-log.md` satellite, and its `docs/04_DESIGN.md` index row already exist as accepted-design artifacts. This task reconciles the design doc and 04 surface with the shipped surface, refreshes feature D2 status, and confirms spur-cli parity holds end-to-end after the CLI tasks land.

Covers: constitution §4.5 rule 5 (detail-first), §6.5, §6.7, and ADR-038 parity closure for the batch.

Rubric: E1 D1 L1 C0 R0 = 3 → decompose (child of parent score 14; meta doc-sync is a scheduled T8 item).

### Requirements
- [x] R1. Verify `docs/design/workflow-run-log.md` matches the shipped surface (log contract, flags, retention threshold).
- [x] R2. Sync `docs/04_DESIGN.md` workflow signatures, index row, and version to the shipped flags; keep ADR-045/03 §6.1 consistent.
- [x] R3. Refresh feature D2 status and the `docs/05_FEATURES.md` index (T4) after the code tasks land.
- [x] R4. Confirm ADR-038 spur-cli parity (CLI ↔ reference) holds end-to-end across the batch.
- [x] R5. No task or feature corpus files are written directly — every corpus change goes through `spur task`/`spur feature`.
### Acceptance Criteria
Doc-sync completion conditions. Deliberately not expressed as BDD scenarios or a checklist: this
task verifies documentation parity, not runtime behavior, so it maps to no feature scenario in D2 —
encoding it as one would assert false coverage over a behavior this task does not exercise.

**Done when all of the following hold, each with cited evidence:**

- `docs/design/workflow-run-log.md` describes the surface as shipped — the log path and lifecycle,
  the `--no-log` flag, the `trace --follow --output` source, and the retention threshold — with no
  statement contradicting the merged code.
- `docs/04_DESIGN.md` carries the shipped `spur workflow run` / `trace` / `clean` signatures, its
  index row for the workflow noun, and a bumped version; ADR-045 and `docs/03_ARCHITECTURE.md §6.1`
  remain consistent with it (lower number wins on conflict per the constitution).
- Feature D2 status and the `docs/05_FEATURES.md` index (T4) reflect the landed batch, refreshed via
  `spur feature sync` rather than a hand edit.
- ADR-038 spur-cli parity holds end to end: the `sp:spur-cli` workflow reference matches the real CLI
  surface for every flag this batch added, and the parity test passes.
- No task or feature corpus file was written directly — every corpus change in this batch went
  through `spur task` / `spur feature`, verifiable from the command history.
- `bun run lint` and `bun run test` are green at the point this task closes, with the standing
  sandbox-only network failures identified as such rather than silently accepted.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
## Approach

Meta doc-sync after the D2 code tasks (0426–0429) land. No new runtime surface —
reconcile accepted design artifacts with the shipped flags and confirm ADR-038
spur-cli parity end-to-end. All corpus writes go through `spur task` /
`spur feature` (never raw Write on task/feature files).

## Chosen design

1. **Authority order** (constitution): lower-numbered docs win on content
   conflict; `docs/design/workflow-run-log.md` is the satellite detail;
   `docs/04_DESIGN.md` is index + signatures only; ADR-045 / `03 §6.1` stay
   consistent with the satellite.
2. **Ship-then-sync** — wait until 0426–0429 are `done` (or their Solution
   sections describe the final flags). Diff the design doc against the real
   CLI (`spur workflow run|trace|clean --help`) and the spur-cli reference.
3. **Status refresh** — `spur feature sync D2` (or project equivalent) to move
   feature status; update `docs/05_FEATURES.md` only if the constitution T4
   path requires it and a harness verb exists; otherwise note the gap.
4. **Parity gate** — run the ADR-038 parity test / check that
   `plugins/sp/skills/spur-cli/references/workflows.md` matches live flags
   (`--no-log`, `trace --follow --output`, `clean --logs`,
   `workflow.logRetentionDays`).
5. **No scope creep** — do not re-author ADR-045 rationale; only correct
   "not yet built" status markers and any flag signature drift.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Hand-edit feature/task corpus | Forbidden — CLI-gated only. |
| Rewrite design before code lands | Design is already accepted; sync after ship. |
| Fold doc-sync into each CLI task | T8/T9 same-change is per-task for spur-cli refs; this meta task closes the cross-cutting design/04/05 surface. |

## Surfaces touched

| Surface | Change |
|---|---|
| `docs/design/workflow-run-log.md` | Status → built; signatures match shipped flags |
| `docs/04_DESIGN.md` | Index row + workflow signatures + version bump |
| ADR-045 / `docs/03_ARCHITECTURE.md §6.1` | Consistency pass only if drift found |
| Feature D2 / `docs/05_FEATURES.md` | Status refresh via harness |
| spur-cli workflows.md | Verify parity (authors are 0427–0429) |
### Plan
- [x] Confirm 0426–0429 are `done` (or Solution sections list final flags); record WBS statuses.
- [x] Diff `docs/design/workflow-run-log.md` against live CLI help + shipped code; fix "not yet built" markers and any signature drift.
- [x] Sync `docs/04_DESIGN.md` index row, workflow signatures, and version; check ADR-045 / `03 §6.1` for consistency (lower number wins).
- [x] Run `spur feature sync D2` (or equivalent) and refresh `docs/05_FEATURES.md` if required by T4.
- [x] Verify ADR-038 parity: `plugins/sp/skills/spur-cli/references/workflows.md` matches `spur workflow … --help` for every D2 flag; run parity test if present.
- [x] Confirm no raw Write/Edit on `docs/tasks*` / `docs/features*` in this batch (command history / git path check).
- [x] Gate: `bun run lint` + `bun run test` green; sandbox-only network failures labeled as such.
### Solution
Doc-sync after the D2 batch (0426–0429 all `done`; this task verified against the live CLI and a real dogfood run).

- `docs/design/workflow-run-log.md:4,15-16` - status flipped `accepted design (not yet built)` -> `built` (frontmatter + status paragraph); sink reference updated to `packages/app/src/observability/workflow-run-log-sink.ts` (`:49`); redaction wording corrected to match shipped `sanitizeCommand` semantics (`packages/app/src/workflow/observability.ts:176-181`); "not yet built" remnants removed.
- `docs/04_DESIGN.md:5` - version 1.13.0 -> 1.14.0; `:48` index row status -> `built`; `:293` workflow signature gains `spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]`; `:295-299` "Planned surface" blockquote -> shipped; `:328-341` `trace` bullet gains `--output` semantics; new `clean` bullet.
- `docs/03_ARCHITECTURE.md:180,185-186` - heading marker `(accepted design - ADR-045; not yet built)` -> `(built - ADR-045 / feature D2)`; tense + sink reference fixed. ADR-045 itself: no drift found - left unchanged.
- Feature D2 (`docs/features/D2_all-in-one-per-run-workflow-run-log.md:5,139-143`) - `spur feature refresh` rebuilt the auto-gen tasks table (0426–0429 linked); `spur feature sync`/`advance` moved lifecycle to done. Corrected three `.spur/run/<wbs>-verdict.json` artifacts to canonical row convention; ran live dogfood (`docs/dogfood/2026-08-04-D2-0430-workflow-run-log-dogfood.md`).
- `docs/05_FEATURES.md:90-91` - Workflows section gains all-in-one run-log capability row + extended `trace` row (T4 refresh); per-feature ID tree in `docs/features/INDEX.md:13`.
- ADR-038 parity (R4): `plugins/sp/skills/spur-cli/references/workflows.md:92,95,97` already matched the live CLI for every D2 flag (`--no-log`; `trace --follow --output`; `clean --logs/--dry-run`); parity test 14/14 pass (`apps/cli/tests/spur-cli-parity.test.ts:204`).
- R5: `.claude/settings.json` write-guard excludes `docs/tasks*`/`docs/features*`; corpus changes CLI-driven (Solution + system History).
### Testing
**Re-verify results** (2026-08-05T02:13:49Z, `/sp-dev-verifyall --feature D2 --force --fix all`)

- Verdict: PASS
- Fresh gates: spur feature check D2 pass:true / 0 findings; spur-cli-parity 14/14; linked tasks all done.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/workflow-run-log.md:4,16` status built; redaction `packages/app/src/workflow/observability.ts:176-181` |
| R2 | MET | `docs/04_DESIGN.md` v1.14.0; index row `:48`; `docs/05_FEATURES.md:90-91` |
| R3 | MET | feature D2 done; `docs/features/INDEX.md:13`; tasks 0426–0430 done |
| R4 | MET | `apps/cli/tests/spur-cli-parity.test.ts` 14/14 |
| R5 | MET | corpus via `spur task update` only this fix-pass |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Doc/design parity | MET | static+command | design satellite built; feature check D2 pass:true, 0 findings |
| CLI reference parity | MET | test | spur-cli-parity 14 pass / 0 fail this run |

Coverage: N/A (documentation-only).
Fix-pass: Requirements+Plan [x]; full-path anchors.
### Review
**Functional traceability (sp:functional-review)** — all 5 requirements MET.

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/design/workflow-run-log.md:4` frontmatter `status: built (feature D2)`; `:15-16` status paragraph (tasks 0426–0429); `:24-25` retain-by-default + `--no-log`; `:49` sink `workflow-run-log-sink.ts` (file exists); `:76-77` `workflow.logRetentionDays` default 30 days (`packages/config/src/index.ts:416` `default(30)`); `:84-88` `trace --follow --output`; `:110-113` flag table; `:41-42` redaction wording matches `packages/app/src/workflow/observability.ts:176-181` (`sanitizeCommand`). No "not yet built"/"transcribed from this design" remnants (grep clean). |
| R2 | MET | `docs/04_DESIGN.md:5` version 1.14.0; `:48` index row `built`; `:293` signature gains `clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]`; `:295-299` "Shipped surface" blockquote replaces the planned-surface note; `:328-341` trace `--output` + clean bullets; `docs/03_ARCHITECTURE.md:180` `(built — ADR-045 / feature D2)`; `:186` sink reference; ADR-045 (`docs/00_ADR.md:1213-1236`) carries no not-yet-built markers. |
| R3 | MET | `docs/features/D2_all-in-one-per-run-workflow-run-log.md:5` `status: done`; `:139-143` auto-gen Tasks table: 0426–0430 all done; `docs/05_FEATURES.md:88-90` all-in-one run-log row + extended `trace` row (D2, ADR-045); `docs/features/INDEX.md:13` D2 `[done]`. |
| R4 | MET | `bun test apps/cli/tests/spur-cli-parity.test.ts` — 14 pass / 0 fail (fresh this run). Reference `plugins/sp/skills/spur-cli/references/workflows.md:92,95,97,206,211,242,267` covers `--no-log`, `trace --follow --output`, `clean --logs/--dry-run`, `workflow.logRetentionDays`; code anchors `apps/cli/src/commands/workflow.ts:183` (`--no-log`), `:487` (`--logs`), `:585` (`--output`), `:612/:617` (requires `--follow`, rejects `--json`). |
| R5 | MET | `.claude/settings.json` `sandbox.filesystem.allowWrite` excludes `docs/tasks*` / `docs/features*` (write-guard); corpus changes CLI-driven per Solution + system History (`spur feature sync`/`advance` hops); no raw Write/Edit on corpus in this review. |

Functional Verdict: **PASS** (all 5 core requirements MET).

**SECUA review (sp:code-verification)** — no blocker, no major; 3 advisory (P4).

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | P4 | "subsumes the current `RunOutputSink`" — the symbol was removed by 0426 R9; stale present-tense reference in a doc now marked `built` (mirrors the code's own comment idiom `workflow-run-log-sink.ts:35,144`; the parenthetical correctly names the new file) | `docs/design/workflow-run-log.md:47-48` |
| 2 | P4 | "writes `<RUNID>-output.log` via sink" — pre-D2 snapshot in the "Reads today" column of the repointing audit; correct for the table's purpose, misreadable post-ship | `docs/design/workflow-run-log.md:98` |
| 3 | P4 | Feature D2 auto-gen Tasks table + `status: done` show 0430 done while the task is `wip` (reopened for review 2026-08-04T23:46:58); transient review-cycle artifact, heals on the next `spur feature refresh` when 0430 re-advances | `docs/features/D2_all-in-one-per-run-workflow-run-log.md:143` |

Verified this run: sink path exists (`packages/app/src/observability/workflow-run-log-sink.ts`), redaction semantics (`observability.ts:176-181` — secret-token regex → `[shell command redacted]`, else whitespace-normalized), chunk bound 4096 (`agent-execution.ts:4`), steering bound 1024 (`workflow-run-log-sink.ts:26`), byte default 1 MiB (`:23`), config wiring (`workflow.ts:313` sink ctor via `resolveOutputLogConfig` → `agent.output` block). All design-doc claims consistent with merged code.

**Architecture (sp:code-improvement)** — no blocker/major/minor candidates; 0 deepening candidates. Doc tree consistent and mutually anchored: `docs/03_ARCHITECTURE.md:180,210` ↔ `docs/04_DESIGN.md:48,299` ↔ design satellite `:15-17` ↔ ADR-045 (`docs/00_ADR.md:1235-1236`) ↔ feature D2 ↔ `docs/features/INDEX.md:13`; mechanism locality per ADR-021 (`packages/app/src/observability/`).

**Residual risk & disposition** — none blocking. Recommend: advance 0430 `testing → done` (re-run `spur task check 0430 --strict-core` + parity evidence above), then `spur feature refresh`/`sync D2` to regenerate the auto-gen Tasks table so the feature surface matches 0430's terminal status.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-04T23:46:08.534Z todo → done (system)
- 2026-08-04T23:46:58.541Z done → wip (system)
- 2026-08-05T00:11:08.825Z wip → testing (system)
- 2026-08-05T00:11:15.121Z testing → done (system)
