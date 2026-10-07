---
schema_version: 1
name: Auto-repair task-check anchor warnings via task migrate-anchors in the driver recovery path
status: done
template: feature-impl
created_at: 2026-10-07T07:29:49.499Z
updated_at: "2026-10-07T20:04:54.320Z"
feature_id: H15

priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1109-verdict.json
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

- [x] R1. `spur task migrate-anchors` gains `--wbs <wbs>` scoping the pass to that one task file (frontmatter `done_reason` included). Without `--wbs`, behavior is unchanged. This is a public flag (operator consent recorded in Q&A).
- [x] R2. In scoped mode only unique qualifications are written; ambiguous hits are reported in the JSON output and left untouched. An unknown wbs fails nonzero with an actionable message.
- [x] R3. `config/workflows/task-pipeline.yaml` runs `$spurBin task migrate-anchors --wbs $wbs --json` in the implement stage immediately after the `$formatCmd` step (`:352`), i.e. before the `test` stage's proof capture. The step is non-fatal (`; exit 0`) — the done gate still reports anything left.
- [x] R4. `inline-pipeline-driver.md` § done-probe (`:775` area) names the YAML step as the anchor-repair owner in one line; no recipe is restated in `execution-batch.md`.
- [x] R5. Scope guard: the repair never touches another task file, never changes line numbers, and never addresses `L4.anchor-subject-mismatch` or line drift.

### Acceptance Criteria

- [x] AC1 — Unique basename anchors in a task's Solution are qualified before the done gate without touching other tasks (req: R1, R2, R3, R4, R5)

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

Scoped the existing anchor qualifier and ran it from the pipeline, instead of adding a second repair path.

| File:line | Change |
| --- | --- |
| `apps/cli/src/commands/task.ts:1009-1040` | `spur task migrate-anchors` gains `--wbs <wbs>`; the wbs is resolved through the task locator, an unknown wbs exits 1 with an actionable message and writes nothing, and the resolved path is the only scan input |
| `packages/app/src/services/anchor-qualifier.ts:83-93` | `AnchorQualifyOptions.files` — the exact task files to scan; absent keeps the corpus-wide behavior byte-for-byte |
| `packages/app/src/services/anchor-qualifier.ts:326-345` | `qualifyAnchors` honours `files` (`scopedFiles`) and skips the folder walk when it is set, so a scoped pass cannot even read an unrelated task file |
| `config/workflows/task-pipeline.yaml:362-372` | The implement stage runs `$spurBin task migrate-anchors --wbs $wbs --json ; exit 0` after the format step and before `test`'s proof capture; non-fatal so the done gate still reports what the scoped pass cannot fix |
| `packages/app/tests/workflow/pipeline-action-budget.test.ts:24-29` | Ratchet 51 → 52 with the change record comment naming 1109 R3 |
| `plugins/sp/tests/skill-structure.test.ts:769-775` | Asserts the repair step exists inside the implement block and after the format step |
| `apps/cli/tests/commands/task.test.ts:3654-3750` | Failure cases first: a scoped apply rewrites only the named fixture and leaves a sibling's basename anchor untouched; an ambiguous basename is reported and left untouched; an unknown wbs exits 1 |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:785-795` | Done-probe names the YAML step as the anchor-repair owner; the driver does not hand-patch anchors |
| `plugins/sp/skills/spur-cli/references/tasks/verbs.md:259-278` | `--wbs` documented on the verb page (plus the `tasks.md` row) |
| `docs/help/cmd_task.md:473-486`, `docs/help2/task.md:228-238` | Both help trees carry the flag, required by the help-docs parity gates |
| `docs/design/planning-record-contracts.md:45-46` | The CLI design satellite's command table records the scoped flag |

**Rationale.** The unscoped pass rewrites every task file — 119 files modified on 2026-10-07 — so the pipeline could not use it as an automatic repair. Scoping by the resolver's own file identity, rather than by a filename pattern, is what makes the flag safe and keeps the corpus-wide path unchanged. Placement in the implement stage, before `test` captures the proof digest, is what makes the rewrite harmless to the proof chain; `--dry-run` smoke shows the pass reads exactly one file and reports four qualifications for a task that needs them. The scoped pass deliberately does not repair line drift or `L4.anchor-subject-mismatch`, which need the implementer to re-anchor.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `grep -n '--wbs <wbs>' apps/cli/src/commands/task.ts` → the option is declared on `migrate-anchors` (`apps/cli/src/commands/task.ts:1012`); the wbs resolves through the task locator (`apps/cli/src/commands/task.ts:1021-1040`) and the pass receives that single path (`packages/app/src/services/anchor-qualifier.ts:341-345`). Unscoped behavior unchanged: the two pre-existing `migrate-anchors` tests pass unmodified and a real unscoped `--dry-run --json` reports 676 files / 119 would-be modifications, the same as before this change |
| R2 | MET | `bun test apps/cli/tests/commands/task.test.ts --test-name-pattern migrate-anchors` → 4 pass / 0 fail, including the sibling-untouched case and the ambiguous case (`ambiguous.length === 1`, `qualified.length === 0`, file byte-identical). Real-corpus failure case: `task migrate-anchors --wbs 9999 --json` → exit 1, stdout empty, stderr `Task 9999 not found — \`spur task migrate-anchors --wbs\` scopes an existing task file…` |
| R3 | MET | `grep -n 'migrate-anchors --wbs' config/workflows/task-pipeline.yaml` → `362` (comment) and `372` (command), inside the implement state after `command: "$formatCmd ; exit 0"` and before `- id: test`; assertion at `plugins/sp/tests/skill-structure.test.ts:769-775` passes (91 pass / 0 fail); the generated copy carries it at `apps/cli/config/workflows/task-pipeline.yaml:372` after `bun run build:bundle` (exit 0). The step is non-fatal (`; exit 0`) |
| R4 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:788` names the YAML step as the anchor-repair owner in one paragraph; `git diff --name-only` shows `plugins/sp/skills/spur-dev/references/execution-batch.md` untouched |
| R5 | MET | The real-corpus scoped dry-run `task migrate-anchors --wbs 0026 --dry-run --json` reports `qualified: 4` for `0026_redesign_spur_init_from_config_tree_and_drop_bare_recommended_preset.md` alone (recorded in `.spur/run/1109-proofdigest.txt:1`) — exactly one file read, no other task in the report; the flag's construction passes the resolved path as the only scan input, and no line-number or subject-mismatch logic was changed (`git diff` touches only the option, the scan input, the report echo, the YAML step, and docs) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `bun test apps/cli/tests/commands/task.test.ts --test-name-pattern migrate-anchors` → 4 pass / 0 fail (`apps/cli/tests/commands/task.test.ts:3658`, `apps/cli/tests/commands/task.test.ts:3715`); `(cd plugins/sp && bun test tests/skill-structure.test.ts)` → 91 pass / 0 fail (`plugins/sp/tests/skill-structure.test.ts:769-775`); `(cd packages/app && bun test tests/services/anchor-qualifier.test.ts)` → 26 pass / 0 fail; full gate `bun run spur-check` → 10372 pass / 0 fail across 606 files in 603.58s (`plugins/sp/scripts/quality-gate.ts:1`, log `.spur/run/1109-test-gate.log`) |
| R3 — Unique basename anchors in a task's Solution are qualified before the done gate without touching other tasks | MET | command | Same command set plus the real-corpus scoped dry-run on `0026` (one file, 4 qualified) and the sibling-untouched fixture assertion in `apps/cli/tests/commands/task.test.ts:3697-3706` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — CLI/service/YAML/docs surface; 3-dimensional review executed in-session by the inline driver (reviewer independence not achievable on the host-inline path, recorded as P4).

**Requirement traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/commands/task.ts:1009-1040` (`--wbs` via the task locator) + `packages/app/src/services/anchor-qualifier.ts:83-93`, `:326-345` (exact-file scan); unscoped tests and a real unscoped dry-run unchanged |
| R2 | MET | Ambiguous fixture left byte-identical and reported; unknown wbs exits 1 with an actionable message and empty stdout |
| R3 | MET | `config/workflows/task-pipeline.yaml:362-372` after the format step and before `test`, `; exit 0`, asserted at `plugins/sp/tests/skill-structure.test.ts:769-775` |
| R4 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:785-795` names the YAML step as owner; `execution-batch.md` untouched |
| R5 | MET | Scoping is structural (single resolved path); no line-number logic touched; line drift and `L4.anchor-subject-mismatch` explicitly out of scope |

**Findings**

| P | Finding | Disposition |
| --- | --- | --- |
| P3 | Both help trees and the `spur-cli` verb reference needed the new flag (`docs/help{,2}` parity gates) | fixed in-flight |
| P3 | New YAML action crossed the 1007 ratchet (51 → 52) | fixed in-flight with the change record comment |
| P4 | The gate crossed `qualityGateMaxFixAttempts` on all-flake failures before the green run | recorded bound deviation with isolation evidence |
| P4 | Pre-existing: `fileReports[].wbs` reports the basename, not the WBS | accepted, out of scope |
| P4 | In-session review | accepted |

No P1/P2 findings. Residual risk: the YAML step applies to the next run that resolves the updated definition.

### References

- Feature: H15
- `apps/cli/src/commands/task.ts:1008-1050`, `packages/app/src/services/anchor-qualifier.ts:282`
- `packages/app/src/services/task-check.ts:1520-1560` (`L4.anchor-unresolved` severity)
- `packages/app/src/workflow/proof-input-fingerprint.ts:335` (digest sections)
- `config/workflows/task-pipeline.yaml:352` (format step)
- Prior work: 0583 (migrate-anchors), 1089 R3 (done_reason rewrite)

### History

- 2026-10-07T07:34:13.876Z backlog → todo (system)
- 2026-10-07T19:15:41.703Z todo → wip (system)
- 2026-10-07T20:04:22.994Z wip → testing (system)
- 2026-10-07T20:04:54.308Z testing → done (system)

### Notes

Verify `task migrate-anchors --help` before writing the recipe (do not invent flags; the 0583 reference owns semantics). Session repair maps to reuse as test fixtures: 1099's basename→repo-relative map (`workflow-service.ts:2046/2179/2182` → `packages/app/src/workflow/...`, `decision-hitl-responder.ts:455-500/76-78` → `packages/app/src/services/...`) — documented in the 1099 checkpoint (`.spur/memory/sessions/1099-checkpoint.md`).

