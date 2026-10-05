---
schema_version: 1
name: Keep worktree-batch evidence references and prior-task evidence resolvable after teardown
status: done
template: feature-impl
created_at: 2026-10-05T13:36:08.395Z
updated_at: "2026-10-05T23:27:24.064Z"
feature_id: E71

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1089-verdict.json
---

## 1089. Keep worktree-batch evidence references and prior-task evidence resolvable after teardown

### Background

A `--worktree` batch runs in a fresh tree whose `.spur/run/` and `.spur/memory/evidence/` are empty — both
are untracked per-tree planes (`.gitignore:133` `/.spur/run`; `.git/info/exclude` `.spur/memory/`) — while
the invoking tree holds every earlier task's verdict. Observed in `dev-runall --feature G72 --worktree`
(worktree `spur-new-runall-g72-f14c`, landed as `600dda990`):

1. **Wrap feature preflight reports tree-local missing evidence.** Wrap run
   `a24ac55c-cbe0-4d54-b521-ef86401a348f` failed at `task-resolve` with
   `failed:preflight:done-gate L4.dogfood-missing,L4.evidence-not-recoverable,L4.scenario-unverified`
   (`plugins/sp/scripts/wrapup-steps.ts:230` `preflightFeature` → `spur feature check --strict --as done`
   with cwd = worktree). Feature check reads verdicts durable-first then scratch relative to the tree
   (`packages/app/src/services/done-transition-guard.ts:175-190` via `feature-check.ts:840`), so done task
   1078 — whose only copy is `.spur/run/1078-verdict.json` in the invoking tree — read as missing, and its
   tracked `## Testing` carries no parseable verdict → `L4.evidence-not-recoverable` (+ the scenario it
   covers → `L4.scenario-unverified`).
   **Correction (re-verified 2026-10-05):** `L4.dogfood-missing` is NOT tree-local. It reads the tracked
   `docs/dogfood/INDEX.md` (`feature-check.ts:744-770`), and `spur feature check G72 --strict --as done`
   in the invoking tree still reports it. It is a real G72 gap (the 1079 commit says so) and is out of
   scope here.
2. **Metrics degrade to `UNKNOWN`.** Same cause: `runMetrics` (`wrapup-steps.ts:482-492`) resolves
   `.spur/memory/evidence/` then `.spur/run/` under the worktree cwd and logged
   `task 1078 has no certifying verdict … recording UNKNOWN telemetry`.
3. **`done_reason` stores an absolute path.** `task-transition.ts:283-288` passes the guard's loaded
   artifact path (absolute, under the closing tree) to `reconcileDoneCloseAudit`
   (`task-transition.ts:185-187`). Task 1079 got
   `PASS artifact at /Users/robin/xprojects/spur-new-runall-g72-f14c/.spur/memory/evidence/1079-verdict.json`.
   This is corpus-wide, not one task: 35 task files carry `PASS artifact at /…`, 32 of them under
   since-removed worktree directories, and all of them commit a machine-specific home path to tracked docs.
4. **Test and smoke runs leak scratch roots into the operator's project registry.** `~/.config/spur/projects.json`
   held 56 entries on 2026-10-05; 45 are throwaway roots — 34 `$TMPDIR/spur-serve-root-*` (the `HERMETIC_ROOT`
   of `apps/server/tests/serve.test.ts:170`), 5 `spur-packaged-*`, 5 `/private/tmp/spur-*-native.*` /
   `spur-desktop-main.*` manual desktop smoke roots, plus `spur-new/apps/server`. All still exist on disk, so
   `refreshProjects` cannot prune them. The isolation fix `f00f47d42` (`tests/setup.ts:70-91` points
   `SPUR_PROJECTS_FILE` at a disposable file) works only when the preload runs, and the preload is wired from
   the root `bunfig.toml` and `apps/cli/bunfig.toml` only. `apps/server` has no `bunfig.toml`, so the
   workspace-local run AGENTS.md prescribes (`cd apps/server && bun test`) skips `tests/setup.ts`.
   Reproduced on `main` with a throwaway `HOME`: `cd apps/server && bun test` (520 pass) leaves
   `spur-serve-root-<rand>` in `$HOME/.config/spur/projects.json` and also writes
   `$HOME/.config/spur/slash_commands.json`; the same file run from the repo root (`bun test
   ./apps/server/tests/serve.test.ts`) writes neither. `cd apps/desktop && bun test` writes nothing.
   The desktop-era entries come from ad-hoc native/packaged smoke runs started outside the preload (their
   prefixes appear in no tracked script); `apps/desktop/scripts/smoke-serve.ts` is already isolated.

Existing behavior to respect: WT-4a persist-out (`packages/app/src/services/inline-run-setup.ts:353-397`)
copies the worktree's whole `.spur/memory/evidence/` back, treating a byte-identical target as a no-op and
a divergent one as a hard conflict; scratch `<wbs>-*` evidence travels only for the batch's own tasks.

### Requirements

- [x] R1. WT-2 (create and reuse mode) stages the invoking tree's verdict artifacts into the worktree before
      the first task runs: `.spur/memory/evidence/*-verdict.json` → same path, `.spur/run/*-verdict.json` →
      same path, never overwriting a file the worktree already has. This single step fixes both symptom 1
      (preflight) and symptom 2 (metrics); neither `preflightFeature` nor `runMetrics` changes.
- [x] R2. An unforced done close records the PASS artifact path relative to the project root
      (`.spur/memory/evidence/<wbs>-verdict.json`), so `done_reason` resolves in any tree of the repository;
      a path outside the project root is recorded as-is.
- [x] R3. `spur task migrate-anchors` normalizes existing `done_reason` values of the form
      `PASS artifact at <abs>/.spur/<rest>` to `PASS artifact at .spur/<rest>` (dry-run reports them), so the
      35 existing absolute references are repaired through the CLI.
- [x] R4. `plugins/sp/skills/spur-dev/references/execution-batch.md` § WT-2 states the staging step in the
      same change (T3).
- [x] R5. Every workspace whose tests start a server runs `tests/setup.ts`: add `apps/server/bunfig.toml`
      with `preload = ["../../tests/setup.ts"]` (mirroring `apps/cli/bunfig.toml`), so a workspace-local
      `bun test` never writes the operator's `~/.config/spur/projects.json` or `slash_commands.json`.
      Manual desktop native/packaged smoke runs export `SPUR_PROJECTS_FILE` to a disposable path, stated
      where the desktop smoke procedure is documented (`docs/design/desktop-shell.md`).

### Acceptance Criteria

- [x] AC1 — Task and feature evidence remains valid without completed scratch
- [x] AC2 — Retained run inspection and artifact references survive scratch removal
- [x] AC3 — Existing lasting data is preserved before its scratch dependency is retired

The three titles are E71's scenarios verbatim (DD-09 subset rule): AC1 ↔ R1, AC2 ↔ R2 + R5 (scratch
roots must not outlive their run in the operator registry), AC3 ↔ R3.

Verification: re-run a worktree batch over a feature whose earlier task is already `done` with only a
scratch verdict in the invoking tree, and confirm (a) the wrap preflight carries no
`L4.evidence-not-recoverable`/`L4.scenario-unverified` for that task, (b) its metrics row carries the real
verdict, (c) the batch task's `done_reason` is `.spur/…`-relative and resolves after WT-4 removes the
worktree, and (d) `spur task migrate-anchors --dry-run --json` lists no remaining absolute `done_reason`, and (e) `HOME=$(mktemp -d) sh -c 'cd apps/server && bun test'`
leaves no `.config/spur/` directory under that `HOME`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-05T13:51:45.856Z

- **Q: Stage at WT-2, or make preflight/metrics read the invoking tree?** A: Stage. It is a two-line copy
  in driver prose, keeps one evidence plane per tree, and persist-out already treats byte-identical
  evidence as a no-op (`inline-run-setup.ts:393-396`), so the round trip adds no new conflict class
  (a task re-verified in the batch diverges from the invoking copy today as well). Reading the invoking
  tree would need the scripts to learn the invoking root and name it in every finding.
- **Q: Rewrite `done_reason` at persist-out (original R2)?** A: No. The defect is that the close stores an
  absolute path at all; a relative path fixes every surface (worktree, plain run, other clones) at the
  single write site, and the rewrite pass would only cover future worktree batches.
- **Q: Stage only frozen-plan members?** A: No. `feature check` evaluates every done task linked to the
  feature, not just the batch's plan, and a frozen-plan filter would miss them. Verdict files are small;
  copying all `*-verdict.json` is the simpler correct scope. Receipts and other evidence are not staged,
  so persist-out's identity classification is unaffected.
- **Q: Fix `L4.dogfood-missing` here?** A: No — it is corpus-real (tracked `docs/dogfood/INDEX.md`), owned
  by G72's own done gate.

#### Q&A entry — 2026-10-05T14:00:56.462Z

- **Q: Fix `L4.dogfood-missing` here?** A: No — it is corpus-real (tracked `docs/dogfood/INDEX.md`), owned
  by G72's own done gate.
- **Q: Isolate the registry inside `serve.test.ts` instead of adding a bunfig?** A: No. The leak class is
  "a workspace-local run skips the shared preload"; it also leaks `slash_commands.json`, which serve.test
  does not own. One `bunfig.toml` (the 0699 R3 precedent in `apps/cli`) closes every file in the workspace.
- **Q: Does this belong in an E71 task?** A: It shares the defect class — scratch run roots outliving their
  run in durable operator state — and the fix is one config file plus a doc line, below a task's floor.
- **Q: Clean the 45 existing leftovers here?** A: No. `~/.config/spur/projects.json` is operator state
  outside the repository; the operator prunes it once by hand (or `spur projects remove`), not the task.

### Design

**Staging (R1).** In § WT-2, after `git worktree add` / adoption and before `bun install`:

```bash
for d in .spur/memory/evidence .spur/run; do
  mkdir -p "$WT/$d"
  for f in "$d"/*-verdict.json; do [ -f "$f" ] && cp -n "$f" "$WT/$d/"; done
done
```

`cp -n` never clobbers worktree-owned evidence (reuse mode). No script or service change; the plain
(non-worktree) path is untouched.

**Relative done reason (R2).** `packages/app/src/services/task-transition.ts:283-288`: derive the project
root as `dirname(dirname(deps.runDir))` (the tree that owns `.spur/run`, same derivation
`done-transition-guard.ts:179` uses for the evidence dir), and pass
`relative(root, doneArtifactPath)` when the artifact lies under it, else the absolute path.
`reconcileDoneCloseAudit` stays unchanged.

**Backfill (R3).** `spur task migrate-anchors` already owns "evidence anchors → repo-relative"; extend it
with one rule over the `done_reason` frontmatter: `/^(unforced close; PASS artifact at )\/.*?\/(\.spur\/.*)$/`
→ `$1$2`. Writes go through its existing task-write path and dry-run report. No new noun/verb/flag.

**Registry hermeticity (R5).** New `apps/server/bunfig.toml`:

```toml
# Workspace-local test config: tests/setup.ts isolates SPUR_PROJECTS_FILE and global config;
# without it `cd apps/server && bun test` writes the operator's ~/.config/spur. Coverage thresholds stay
# enforced by the root bunfig (bun run test).
[test]
preload = ["../../tests/setup.ts"]
```

Desktop manual smoke guidance in `docs/design/desktop-shell.md` gains one line: export
`SPUR_PROJECTS_FILE="$(mktemp -d)/projects.json"` before launching a native or packaged build on a scratch root.

**Constraints.** No new public CLI surface. Per-tree lifecycle DB rows still do not travel. Plain runs keep
today's `UNKNOWN`-for-absent-evidence behavior.

### Plan

1. Failure list first, in the owning test files: (a) `task-transition` unforced close under a temp project
   root records `PASS artifact at .spur/memory/evidence/<wbs>-verdict.json`; (b) `migrate-anchors` rewrites
   a worktree-absolute `done_reason` and leaves a non-`.spur` reason untouched; (c)
   `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` asserts § WT-2 carries the
   no-clobber verdict staging step.
   (d) failure first for R5: `HOME=$(mktemp -d) sh -c 'cd apps/server && bun test'` creates
   `.config/spur/projects.json` under that `HOME` today.
2. R5: add `apps/server/bunfig.toml`; re-run (d) and confirm no `.config/spur/`; add the desktop-shell smoke line.
   R2 in `task-transition.ts`; R3 in the `migrate-anchors` service.
3. R1 + R4: § WT-2 staging text in `plugins/sp/skills/spur-dev/references/execution-batch.md`; regenerate the
   bundled copy (`bun run --filter @gobing-ai/spur build:bundle`).
4. Run `spur task migrate-anchors --dry-run --json`, review the 35 rewrites, then apply; commit the corpus
   change separately from the code change.
5. Gates: `bun run spur-check`; `bun run plugin-smoke`.
6. E2E receipt: the Verification run under Acceptance Criteria; record the worktree marker, merge commit,
   the wrap preflight/metrics output and the resulting `done_reason`.

### Solution

Change-map: one `file:line` per row. `ad895ed51` carries the 36 repaired corpus files and is not
re-listed here (its rewrite is exercised by the `migrate-anchors` row below).

| Change (`file:line`) | What changed |
| --- | --- |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:747` | WT-2 gains the "Evidence staging before the first task (create and reuse mode)" subsection — the requirement R1 statement, placed inside WT-2 for R4 |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:767` | the staging loop itself: both untracked planes copied with `cp -n` so a worktree-owned verdict is never clobbered |
| `packages/app/src/services/task-transition.ts:212` | `projectRelativeArtifactPath` — project-root-relative artifact path with POSIX separators, absolute when the artifact lies outside the root (R2) |
| `packages/app/src/services/task-transition.ts:315` | the unforced close-audit call site now records the relative form instead of the guard's absolute path (R2) |
| `packages/app/src/services/anchor-qualifier.ts:125` | `normalizeDoneReason` — the single rewrite rule over an absolute `done_reason` artifact reference (R3) |
| `packages/app/src/services/anchor-qualifier.ts:380` | the per-file application through the frontmatter writer, skipped when the section write already reported the file unwritable (R3) |
| `apps/cli/src/commands/task.ts:1029` | `spur task migrate-anchors` wires the frontmatter writer so the rewrite lands through the existing `PlanningWriteService.updateFrontmatter` path (R3) |
| `apps/cli/src/commands/task.ts:1064` | the dry-run / apply report gains its done-reason section, so R3's rewrites are reviewable before they are written |
| `tests/setup.ts:89` | the shared preload isolates the global slash-command catalog beside the isolated project registry (R5) |
| `apps/server/bunfig.toml:7` | the server workspace preloads `tests/setup.ts`, so a workspace-local run reaches the shared isolation (R5) |
| `apps/server/tests/workspace-test-isolation.test.ts:34` | the pin asserts both isolated env names are present in the preload (R5) |
| `docs/design/desktop-shell.md:93` | the manual native/packaged smoke procedure documents the disposable `SPUR_PROJECTS_FILE` (R5) |
| `packages/app/tests/services/task-transition.test.ts:351` | the R2 assertions: scratch plane, durable evidence plane, forced-close rationale verbatim, foreign path as-is |
| `packages/app/tests/services/anchor-qualifier.test.ts:244` | the R3 assertions: rewrite, idempotency, untouched operator prose, dry-run reporting, and the unwritable-file skip |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:56` | the R1/R4 pin: staging present, both planes, `cp -n`, no-clobber, and placement between WT-2 and WT-3 |

No speculative abstraction was added: the two new helpers are single-purpose functions on the
existing write paths, the CLI surface is unchanged (`migrate-anchors` keeps its flags), and no
service was introduced or moved.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:747` — WT-2 "Evidence staging before the first task (create and reuse mode)" stages both untracked planes with cp -n; re-read this run; placement pin `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` re-run green this run (47 pass / 0 fail) |
| R2 | MET | `packages/app/src/services/task-transition.ts:212` projectRelativeArtifactPath (POSIX separators, absolute outside root) and `:315` close-audit call site, both re-read this run; `packages/app/tests/services/task-transition.test.ts` + anchor-qualifier re-run green this run (48 pass / 0 fail across both files); this task's own frontmatter `docs/tasks5/1089_keep-worktree-batch-evidence-references-and-prior-task-evide.md:11` records the relative form |
| R3 | MET | `packages/app/src/services/anchor-qualifier.ts:110-127` normalizeDoneReason + CLI wiring `apps/cli/src/commands/task.ts:1029` / dry-run report `:1064`, re-read this run; `spur task migrate-anchors --dry-run --json` re-run this run: filesScanned 635, reasons [] (0 remaining); corpus repair commit ad895ed51 confirmed (36 task files) |
| R4 | MET | Same-commit WT-2 staging statement at `plugins/sp/skills/spur-dev/references/execution-batch.md:747-767` re-read this run; wt2 < staging < wt3 placement pinned by the contract test re-run green this run (47 pass) |
| R5 | MET | `apps/server/bunfig.toml:7` preloads ../../tests/setup.ts and `tests/setup.ts:71-84` isolates both SPUR_PROJECTS_FILE and SPUR_SLASH_COMMANDS_FILE (re-read this run); AC step (e) re-executed this run: HOME=$(mktemp -d) cd apps/server && bun test → 521 pass / 0 fail, find $HOME/.config → 0 files; pin `apps/server/tests/workspace-test-isolation.test.ts:34` green; smoke override documented `docs/design/desktop-shell.md:93` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Task and feature evidence remains valid without completed scratch | MET | test | Staging contract + placement pin re-run green this run (`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`, 47 pass / 0 fail); batch A/B staging/metrics receipts from the original run @spur-run `.spur/run/1089-verdict.json` line 1 |
| AC2 — Retained run inspection and artifact references survive scratch removal | MET | command | R2 relative done_reason proven by this task's own close (`docs/tasks5/1089_keep-worktree-batch-evidence-references-and-prior-task-evide.md:11`); temp-HOME workspace run re-executed this run: 521 pass / 0 fail, zero files under $HOME/.config |
| AC3 — Existing lasting data is preserved before its scratch dependency is retired | MET | command | `spur task migrate-anchors --dry-run --json` re-run this run → reasons [] (0 remaining absolute done_reason); 36-file repair commit ad895ed51 in scope |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1089 (pass 2)

**Scope:** `c7840e2fa..HEAD` on `sp/run-1089-9e8af77d` — 13 source/doc/test files (b6107a373, 68bf13242, 54abbe0d9) plus the 37-file corpus migration (ad895ed51). This pass re-reads the full diff after the remediation hop; pass 1 covered b6107a373 + 68bf13242 + ad895ed51 only.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `path.relative` yields `\` on Windows, so the recorded `done_reason` would have violated R2's `.spur/…` form and escaped the R3 normalization rule. Raised in pass 1 and corrected in 68bf13242; the assertion pins the POSIX form and would go red on the windows-latest leg of `test-win.yml`. Closed. | `packages/app/src/services/task-transition.ts:213-222`, `packages/app/tests/services/task-transition.test.ts:322-334`| RESOLVED (68bf13242) |
| 2 | P4 (advisory) | correctness | The two global-config leaks a workspace-local run could reach were not closed together: pass 1 shipped `SPUR_PROJECTS_FILE` isolation and the verify stage caught the surviving `slash_commands.json` write. 54abbe0d9 now isolates both through one preload and pins both names, so the class is closed at its single owner. | `tests/setup.ts:71-84`, `apps/server/tests/workspace-test-isolation.test.ts:34-37`| RESOLVED (54abbe0d9) |
| 3 | P4 (advisory) | architecture | The qualification pass owns two rules (body anchors and the `done_reason` frontmatter rule) while its module name and CLI verb stay anchor-scoped. The module header states the widening; acceptable at two rules, rename when a third arrives. | `packages/app/src/services/anchor-qualifier.ts:16-22`| ACCEPTED |
| 4 | P4 (advisory) | correctness | `normalizeDoneReason` requires the literal `unforced close; ` prefix, so the same absolute shape under a different prefix (a future close-audit writer) would not be repaired. Deliberate per Design: operator prose must never be rewritten. `spur task migrate-anchors --dry-run --json` reporting `reasons: 0` is the only detector. | `packages/app/src/services/anchor-qualifier.ts:110-127`| ACCEPTED |
| 5 | P4 (advisory) | testability | R1's staging step is prose plus a static `SPEC` string pin; a driver that silently omits the loop fails no automated check. R4 asked for the doc statement, and the A/B receipts in `## Testing` are the compensating control. | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:51-64`| ACCEPTED |

`Disposition` is the residual-sweep contract: a `RESOLVED`/`FIXED`/`DONE` cell closes the row,
`DEFER(<reason>)` reclassifies a P3, and a bare P1-P3 row stays blocking.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | § WT-2 "Evidence staging before the first task (create and reuse mode)"; placement pinned inside WT-2 (47 pass). Executed this run (246 + 258 verdict files); `cp -n` no-clobber verified against a seeded divergent worktree verdict; the metrics A/B on scratch-only task 1078 flips `UNKNOWN` → `PASS`. |
| R2 | MET | `packages/app/src/services/task-transition.ts:203-222` — project-root-relative with POSIX separators, absolute outside the root; 22 pass in `packages/app/tests/services/task-transition.test.ts`. No consumer resolves `done_reason` as a path. |
| R3 | MET | `normalizeDoneReason` + per-file application (`packages/app/src/services/anchor-qualifier.ts:110-127, 369-389`), CLI report/JSON wiring, 26 pass; 36 files repaired through the CLI; dry-run `reasons: 0`. |
| R4 | MET | Same-commit § WT-2 statement with the `wt2 < staging < wt3` placement pin. |
| R5 | MET | `apps/server/bunfig.toml` preloads the shared setup; `tests/setup.ts` isolates both `SPUR_PROJECTS_FILE` and `SPUR_SLASH_COMMANDS_FILE`; `HOME=<temp> cd apps/server && bun test` → 521 pass / 0 fail and `find $HOME/.config` empty (it wrote `projects.json` before, then also `slash_commands.json`); the pin asserts both names; `docs/design/desktop-shell.md` § Packaging documents the manual-smoke override. |

##### AC Traceability

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 — Task and feature evidence remains valid without completed scratch | MET | Staging receipt plus the metrics A/B from byte-identical trees. |
| AC2 — Retained run inspection and artifact references survive scratch removal | MET | R2's relative `done_reason` assertions and R5's empty-`$HOME/.config` temp-`HOME` run close both halves. |
| AC3 — Existing lasting data is preserved before its scratch dependency is retired | MET | 36 absolute references repaired through `spur task migrate-anchors` as their own corpus commit; the unrelated 479 anchor rewrites deliberately not applied; dry-run `reasons: 0`. |

**Verification evidence:** `bun run spur-check` PASS at proof digest `sha256:6068dbeff…` — 10161 pass / 0 fail, lint clean, pre/post rule presets clean; targeted suites 22 + 26 + 47 + 1 pass; the temp-`HOME` workspace run 521 pass.

**Security / efficiency:** no new trust boundary; `done_reason` is provenance text derived from the run dir and written only through `PlanningWriteService.updateFrontmatter`. The added per-file work is one already-parsed frontmatter read, and no scan count changed.

**Next:** verify R1-R5 against AC1-AC3 on the fresh digest, then record.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-05T18:23:45.746Z backlog → todo (system)
- 2026-10-05T18:25:26.177Z todo → wip (system)
- 2026-10-05T18:55:36.254Z wip → testing (system)
- 2026-10-05T18:57:28.496Z testing → done (system)

