---
schema_version: 1
name: Auto-repair task-check anchor warnings via task migrate-anchors in the driver recovery path
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:49.499Z
updated_at: "2026-10-07T16:17:18.858Z"
feature_id: H15

priority: P2
estimate_hours: 4
---

## 1109. Auto-repair task-check anchor warnings via task migrate-anchors in the driver recovery path

### Background

Driver-level task checks fail on L4 anchor-format WARNs (bare basenames instead of repo-relative `path:line` in Solution). Session batch: 1097 and 1099 both needed hand-written sed repair loops at check time; the repair is deterministic and already productized as `spur task migrate-anchors <wbs>` (0583 R1–R3). The driver contract just never invokes it — the operator notices the WARN, writes the map by hand, re-checks.

**Refine corrections (2026-10-07)**

- `spur task migrate-anchors` takes **no `<wbs>` argument**; its only options are `--dry-run`, `--json`, `--json-envelope` (`apps/cli/src/commands/task.ts:1008-1050` → `anchorQualify`, `packages/app/src/services/anchor-qualifier.ts:282`). It runs **corpus-wide** and also rewrites `done_reason` frontmatter (1089 R3). A dry run on 2026-10-07 reports qualified=470, ambiguous=1736, filesModified=119 — an unscoped call inside a driver would rewrite 119 unrelated task files.
- It only qualifies basename anchors to repo-relative paths. It cannot fix **line drift** (the 1097 case was `test.ts:99→:126`) or `L4.anchor-subject-mismatch`.
- The finding class is `L4.anchor-unresolved` — an **error** at the `--as done` completion gate and a warning elsewhere (`packages/app/src/services/task-check.ts:1520-1560`), not an "L4 anchor-format WARN".
- `execution-batch.md` step 3.3b (`:314`) is the next-router recovery hop (`batch-preflight --recovery`); it is the wrong placement.
- Proof safety: the proof digest folds only Background/Requirements/AC/Design/Plan plus wbs/name/feature_id/dependencies frontmatter (`packages/app/src/workflow/proof-input-fingerprint.ts:335`). Running the repair **before** the `test` stage's `proof.fingerprint` capture makes any rewrite safe regardless of section.
- The 1099 checkpoint fixture is gone; tests use synthetic fixtures.

### Requirements

- [ ] R1. `spur task migrate-anchors` gains `--wbs <wbs>` scoping the pass to that one task file (frontmatter `done_reason` included). Without `--wbs`, behavior is unchanged. This is a public flag (operator consent recorded in Q&A).
- [ ] R2. In scoped mode only unique qualifications are written; ambiguous hits are reported in the JSON output and left untouched. An unknown wbs fails nonzero with an actionable message.
- [ ] R3. `config/workflows/task-pipeline.yaml` runs `$spurBin task migrate-anchors --wbs $wbs --json` in the implement stage immediately after the `$formatCmd` step (`:352`), i.e. before the `test` stage's proof capture. The step is non-fatal (`; exit 0`) — the done gate still reports anything left.
- [ ] R4. `inline-pipeline-driver.md` § done-probe (`:775` area) names the YAML step as the anchor-repair owner in one line; no recipe is restated in `execution-batch.md`.
- [ ] R5. Scope guard: the repair never touches another task file, never changes line numbers, and never addresses `L4.anchor-subject-mismatch` or line drift.

### Acceptance Criteria

- [ ] AC1 — Unique basename anchors in a task's Solution are qualified before the done gate without touching other tasks (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:15:19.736Z

- **Q: Public `--wbs` flag or driver-only prose?** A: `--wbs` (2026-10-07 refine decision, pending the operator's public-surface consent per AGENTS.md). Driver prose would have to filter a corpus-wide dry run and could not apply a single-file rewrite. If consent is refused, close this task as won't-do; there is no safe prose-only variant.
- **Q: Where does the repair run?** A: The implement stage, after format and before the `test` proof capture — one place every execution surface passes through, and safe for the proof digest.
- **Q: What about line drift (1097)?** A: Out of scope; it needs the implementer to re-anchor, which 1110's implement rules cover.

### Design

**Approach:** scope the existing qualifier rather than add a new repair path; run it once where every surface (inline, subprocess, parallel) passes through — the YAML implement stage — before the proof capture.

**Frozen names**

- Flag: `--wbs <wbs>` on `spur task migrate-anchors` (single value).
- Service option: `wbs?: string` on `anchorQualify`'s options, resolved to one file via the task locator (`spur task path` logic — never folder globbing).
- YAML step: shell `$spurBin task migrate-anchors --wbs $wbs --json ; exit 0`, placed after `command: "$formatCmd ; exit 0"` (`task-pipeline.yaml:352`).

**Why here, not at done:** after `test` captures `proofDigest`, a rewrite in a digest section would invalidate the proof; before capture, nothing downstream has fingerprinted the file. It also means the verifier and reviewer see qualified anchors.

**Anti-patterns**

- Unscoped `migrate-anchors` in any automated path (rewrites ~119 files).
- Applying ambiguous qualifications or guessing between candidates.
- Treating line drift as an anchor-qualification problem.
- Adding recovery prose to `execution-batch.md` 3.3b.
- A second qualifier implementation in the plugin (`plugins/sp` must stay standalone; call the CLI).

**Tests (write failure cases first):** `apps/cli` command test — `--wbs` writes only the target fixture, leaves a sibling fixture with a basename anchor untouched, skips an ambiguous anchor, fails nonzero on an unknown wbs; unscoped run unchanged. `plugins/sp/tests/skill-structure.test.ts` (or the existing pipeline-definition test) asserts the step exists after the format step and before the `test` state.

**Impacted surfaces:** `apps/cli/src/commands/task.ts`, `packages/app/src/services/anchor-qualifier.ts`, `config/workflows/task-pipeline.yaml` (+ generated `apps/cli/config/`), `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, the CLI design satellite that documents `task migrate-anchors` (find with `rg -n 'migrate-anchors' docs/design`), `plugins/sp/skills/spur-cli/references/` task reference.

**Dependency handoff:** none upstream. 1110 R2 cites the rule "repo-relative anchors from first write" — this task is the safety net, not a substitute.

### Plan

1. Write the failing command tests (Design § Tests) in `apps/cli/tests/`.
2. Add `wbs` to `anchorQualify` options; resolve to one file; filter the scan.
3. Wire `--wbs` in `apps/cli/src/commands/task.ts:1008-1050`.
4. Add the YAML step after `task-pipeline.yaml:352`; add the pipeline-definition assertion.
5. Update `inline-pipeline-driver.md` done-probe line, the CLI design satellite, and the spur-cli task reference.
6. `bun link` in `apps/cli`; `bun run --filter @gobing-ai/spur build:bundle`.
7. Smoke: `spur task migrate-anchors --wbs 1109 --dry-run --json` reports only 1109's file.
8. Focused tests per workspace, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: H15
- `apps/cli/src/commands/task.ts:1008-1050`, `packages/app/src/services/anchor-qualifier.ts:282`
- `packages/app/src/services/task-check.ts:1520-1560` (`L4.anchor-unresolved` severity)
- `packages/app/src/workflow/proof-input-fingerprint.ts:335` (digest sections)
- `config/workflows/task-pipeline.yaml:352` (format step)
- Prior work: 0583 (migrate-anchors), 1089 R3 (done_reason rewrite)

### History

- 2026-10-07T07:34:13.876Z backlog → todo (system)

### Notes

Verify `task migrate-anchors --help` before writing the recipe (do not invent flags; the 0583 reference owns semantics). Session repair maps to reuse as test fixtures: 1099's basename→repo-relative map (`workflow-service.ts:2046/2179/2182` → `packages/app/src/workflow/...`, `decision-hitl-responder.ts:455-500/76-78` → `packages/app/src/services/...`) — documented in the 1099 checkpoint (`.spur/memory/sessions/1099-checkpoint.md`).

