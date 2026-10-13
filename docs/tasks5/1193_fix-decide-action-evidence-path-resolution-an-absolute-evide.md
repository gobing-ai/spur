---
schema_version: 1
name: "Fix decide action evidence path resolution: an absolute evidence path is joined with the workdir"
status: wip
template: standard
created_at: 2026-10-13T17:44:16.262Z
updated_at: "2026-10-13T19:32:17.580Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 2
feature_id: P1
---

## 1193. Fix decide action evidence path resolution: an absolute evidence path is joined with the workdir

### Background

`DecideActionRunner` resolves every `evidence` entry with `join(workdir, path)` before the file is read. On POSIX, `join` does not treat an absolute segment as a reset: `join('/tmp/decide-workdir', '/var/evidence/task.md')` is `/tmp/decide-workdir/var/evidence/task.md`. The file at the declared absolute path is never opened.

Both live call sites do this:

- Inline (deprecated, still executed): `packages/app/src/workflow/actions/decide.ts:193-194`, then `runDecide` reads those paths in `packages/app/src/workflow/decide.ts:123-128`.
- Catalog (the form shipped workflows use): `packages/app/src/workflow/actions/decide.ts:428-431`, then `readDecisionEvidence` (`packages/app/src/decision/decision-evidence-input.ts:13-16`), whose contract is that paths arrive already resolved.

`readDecisionEvidence` throws when any declared file is unreadable, and the catalog runner catches that and writes the degraded fallback row (`reason: 'error'`) without calling the maker. One bad path fails the whole evidence list.

Shipped workflows pass an absolute path today. `config/workflows/task-pipeline.yaml:469-481` runs `spur task path $wbs --json` and stores `.path // .filePath` in `taskSpecPath`. `spur task path 1193 --json` returns `filePath` `/Users/robin/xprojects/spur-new/docs/tasks5/1193_fix-decide-action-evidence-path-resolution-an-absolute-evide.md` and no `path` field, so the stored value is absolute. That var is an evidence entry at:

- `task-triage` — `config/workflows/task-pipeline.yaml:670-672`
- `review-failure-class` — `config/workflows/task-pipeline.yaml:813-815`

`failure-class` (`config/workflows/task-pipeline.yaml:715-716`) lists only `.spur/run/${vars.wbs}-test-gate.findings`, which stays relative and is not this bug. With the workflow workdir at the project root, the absolute task file is joined into a path that does not exist, the evidence read throws, and `task-triage` / `review-failure-class` degrade to their catalog fallback instead of seeing the task spec.

Relative evidence is already correct and must stay correct. `join('/tmp/decide-workdir', 'notes.md')` is `/tmp/decide-workdir/notes.md`. `join('.', 'notes.md')` is `notes.md`. `resolve('.', 'notes.md')` is the process cwd plus `notes.md` (`/Users/robin/xprojects/spur-new/notes.md` in this checkout). The CLI `spur decision run` path (`apps/cli/src/commands/decision.ts:188-191`) uses `resolve(context.cwd, file)`, which keeps an absolute path and is not this bug. `resultFile` is a separate `join(workdir, options.resultFile)` at `decide.ts:196`, `:270`, and `:350`.

**Refine corrections (2026-10-13)**

- Title-only capture, no call site → `join(workdir, path)` at `packages/app/src/workflow/actions/decide.ts:194` and `:430`; POSIX join of `/tmp/decide-workdir` and `/var/evidence/task.md` is `/tmp/decide-workdir/var/evidence/task.md` → spec names both call sites and keeps the relative `join` branch.
- Implied "the workflow passes a relative task spec" → `spur task path --json` returns absolute `filePath`, and `task-pipeline.yaml:477` stores that value in `taskSpecPath`, which `task-triage` and `review-failure-class` pass as evidence → the runner accepts that absolute path; the YAML entries stay as they are.

**Refine corrections (2026-10-13, ready re-audit)**

- "Source fix not yet implemented" → commit `eb57f0a40` (`fix(decide): resolve absolute evidence and resultFile paths…`, task 1193) already routes both evidence maps and all three `resultFile` sites through a file-private `resolveWorkdirPath(workdir, path)` (`packages/app/src/workflow/actions/decide.ts:39-43`; call sites `:210`, `:212`, `:287`, `:370`, `:452`) → task re-scoped to the remaining regression coverage plus verify; no further source change.
- Frozen name `resolveEvidencePath` (beside `isDecidableType`, `node:path` `isAbsolute`) → as-built is `resolveWorkdirPath` near the top of the file using `isAbsolutePath` + `normalizeSeparators` from `@gobing-ai/ts-runtime` → Design re-pointed at the as-built name; on POSIX `normalizeSeparators` only rewrites `\` to `/`, so the absolute branch is unchanged for every path the pipeline produces.
- "resultFile stays `join` (out of scope)" → `eb57f0a40` also passes an absolute `resultFile` through, pinned by `decide-catalog.test.ts` "an absolute resultFile is written as-is too"; relative keys unchanged → R4/AC4 restated to the as-built contract.
- "Catalog coverage missing" → `decide-catalog.test.ts` now covers absolute evidence, relative evidence under `/repo/worktree`, absolute `resultFile`, and the unreadable-evidence fallback; 30/30 pass in `decide.test.ts` + `decide-catalog.test.ts` → remaining gaps are the **inline** runner (no absolute-evidence or ordering test in `decide.test.ts`), the workdir-`.` relative case, and the mixed-list order case.
- "`feature_id` stays unset" → frontmatter carries `feature_id: P1` (P1 is `verifying`) → claim corrected; refine does not write `feature_id`, the edge is the operator's call. `ac_altitude: task-local` keeps the AC valid either way.

### Requirements

- [ ] R1. On both the catalog and the inline decide runners, an absolute `evidence` entry is read at that path. A file that exists only at `join(workdir, absolutePath)` does not satisfy the read. (Source: done in `eb57f0a40`; catalog test exists; inline test missing.)
- [ ] R2. A relative `evidence` entry is still `join(workdir, entry)`. When `workdir` is `.`, the read path is the relative entry (`notes.md`), not `resolve('.', entry)`.
- [ ] R3. A mixed evidence list is read in declaration order. The catalog runner passes the redacted bodies to `decisionService.decide` as `instructions`, joined with `\n\n`. The inline runner passes the same bodies, in order, as `runDecide`'s `state.evidence`. One unreadable entry still fails the whole list and degrades the catalog row to `reason: 'error'`.
- [ ] R4. `resultFile` follows the same rule: absolute is written as given, relative is `join(workdir, resultFile)`. Relative keys under workdir `.` stay `.spur/run/x-recovery.decision.json` and `out/lane.decision.json`.

Out of scope: any further change to `packages/app/src/workflow/actions/decide.ts` beyond what a failing new test proves necessary; confining evidence under the workdir; editing `readDecisionEvidence` or `runDecide`; editing `config/workflows/task-pipeline.yaml`; exporting a path helper; changing `apps/cli/src/commands/decision.ts` (already `resolve(cwd, file)`).

### Acceptance Criteria

```gherkin
Scenario: AC1 — An absolute evidence path is read as given (req: R1)
  Given a decide workdir `/tmp/decide-workdir` and a fake filesystem that contains `/var/evidence/task.md` with body `absolute body` and does not contain `/tmp/decide-workdir/var/evidence/task.md`
  When the inline runner executes evidence `['/var/evidence/task.md']` (catalog half already pinned by `decide-catalog.test.ts` "absolute evidence path is read as-is")
  Then the inline maker receives `state.evidence` `['absolute body']`, returns `retry`, and the row is not degraded

Scenario: AC2 — A relative evidence path stays workdir-joined (req: R2)
  Given a catalog decide whose workdir is `.` and whose fake filesystem contains the key `notes.md` with body `relative body`
  When the runner executes evidence `['notes.md']`
  Then `decisionService.decide` receives instructions `relative body`
  And the existing `/repo/worktree` relative case stays green

Scenario: AC3 — A mixed evidence list keeps order and the existing failure rule (req: R3)
  Given workdir `/tmp/decide-workdir`, `absolute body` at `/var/evidence/task.md`, and `relative body` at `/tmp/decide-workdir/notes.md`
  When the catalog runner executes evidence `['/var/evidence/task.md', 'notes.md']`
  Then `instructions` is `absolute body\n\nrelative body`
  And the inline runner's maker receives `state.evidence` `['absolute body', 'relative body']`
  And when the absolute file is absent, the catalog runner writes the fallback row with `reason: 'error'` and does not call `decide`

Scenario: AC4 — resultFile follows the absolute/relative rule (req: R4)
  Given the existing inline and catalog decide tests that write a relative resultFile, and the catalog test that writes `/abs/out/lane.decision.json`
  When the decide test files run
  Then relative write keys remain `.spur/run/x-recovery.decision.json` and `out/lane.decision.json`, and the absolute key is written exactly as given
```

Test observability: all four scenarios are observed in `packages/app/tests/workflow/actions/decide.test.ts` (inline, via `fakeMaker` recording its state argument) and `packages/app/tests/workflow/actions/decide-catalog.test.ts` (catalog, via the fake `decide` recording its input). Both fakes sit below the path-resolution seam, so they observe the real resolved keys.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T17:50:48.922Z

**Closed 2026-10-13 — resolver shape.** Relative evidence stays `join(workdir, entry)`. Absolute evidence is returned unchanged. `path.resolve` was rejected for the relative branch because `resolve('.', 'notes.md')` is cwd-absolute and `join('.', 'notes.md')` is `notes.md`.

**Closed 2026-10-13 — resultFile stays on join.** The three write sites (`decide.ts:196`, `:270`, `:350`) and the existing tests pin relative keys. An absolute `resultFile` is not produced by `task-pipeline.yaml`.

**Closed 2026-10-13 — no workdir confinement.** Proof-fingerprint confinement is a different seam. Decide evidence keeps accepting the absolute task path `spur task path` returns, and this task does not add a new rejection.

**Closed 2026-10-13 — feature edge.** `feature_id` stays unset. P1 is `verifying`; `spur task update --feature P1` would reopen it to `active`. AC altitude is `task-local` with `ac_numbering: task-local`.

**Closed 2026-10-13 — both runners, no new export.** The inline map and the catalog map both call `resolveEvidencePath`. The function is file-private, same visibility as `isDecidableType`.

#### Q&A entry — 2026-10-13 (ready re-audit)

**Closed — re-scope after landed fix.** `eb57f0a40` shipped the source fix with a different shape than the frozen design (`resolveWorkdirPath`, ts-runtime path helpers, `resultFile` included). Accepted as-built: it matches the `file-read` / `agent-run` convention and its tests pass. Remaining scope is inline/order/workdir-`.` regression coverage and verify.

**Superseded — "resultFile stays on join".** The landed commit made `resultFile` absolute-aware with a test; reverting would regress a pinned behavior for no benefit.

**Superseded — "feature_id stays unset".** Frontmatter has `feature_id: P1`. Linking is the operator's decision; refine does not write it.

### Design

**WHAT.** The source fix is shipped (`eb57f0a40`). This task closes the regression gaps around it and verifies. File-private `resolveWorkdirPath(workdir, path)` at `packages/app/src/workflow/actions/decide.ts:39-43` returns `normalizeSeparators(path)` when `isAbsolutePath(path)` (both from `@gobing-ai/ts-runtime`), else `join(workdir, path)`. It is used by the inline evidence map (`:210`), inline `resultFile` (`:212`, `:287`), catalog `resultFile` (`:370`) and catalog evidence map (`:452`).

**WHY.** `taskSpecPath` is the absolute `filePath` from `spur task path --json` (`config/workflows/task-pipeline.yaml:477`), passed as evidence by `task-triage` and `review-failure-class`. Before `eb57f0a40` the join made it unreadable and both decisions degraded with `reason: error`. The catalog runner is pinned by tests; the inline runner (deprecated but still executed) and the ordering/workdir-`.` contract are not, so a regression there would ship silently.

**WHERE.**

- `packages/app/tests/workflow/actions/decide.test.ts` — inline AC1 and the inline half of AC3. Extend `fakeMaker` so `choice` records its state argument.
- `packages/app/tests/workflow/actions/decide-catalog.test.ts` — AC2 (workdir `.`) and the catalog half of AC3, beside the 1193 tests the fix commit added. The fake `decide` records its input argument.
- `packages/app/src/workflow/actions/decide.ts` — read-only unless a new test fails; then fix inside `resolveWorkdirPath` only.

**Frozen names.** `resolveWorkdirPath` (file-private, not exported, not re-exported from `packages/app/src/index.ts`). No new flag, schema field, workflow var or YAML key. No new API.

**Algorithm.** Per entry, in order: absolute → `normalizeSeparators(entry)` (POSIX no-op for `/`-paths); relative → `join(workdir, entry)`, which keeps `notes.md` under workdir `.`. Catalog: `readDecisionEvidence` then `bodies.join('\n\n')`. Inline: list goes to `runDecide`'s `evidence`, which redacts into `state.evidence`. Bodies shorter than `DECIDE_EVIDENCE_MAX_CHARS` (2000, `packages/app/src/workflow/decide.ts:35`) pass through `redactAndBound` unchanged, so assertions compare raw bodies.

**Anti-patterns.**

- Do not switch the relative branch to `path.resolve` — workdir `.` would become cwd-absolute.
- Do not add workdir confinement (`proof-input-fingerprint.ts:174-177` is a different seam).
- Do not skip a single unreadable entry; one throw still degrades the catalog row.
- Do not relativize `taskSpecPath` in `task-pipeline.yaml` or touch `apps/cli/src/commands/decision.ts`.
- Do not duplicate the branch at call sites or export the helper.
- Do not rewrite the existing 1193 catalog tests; add beside them.

**Concurrency.** Re-surveyed 2026-10-13: only worktree is `/Users/robin/xprojects/spur-new` (`main` at `eb57f0a40`); no `wip` tasks. Sibling 1195 touches `ts-decision-clef` and `decision-service.test.ts`, not `decide*.test.ts`. 1194 is a cancelled duplicate of this task.

**Handoff.** None; `dependencies[]` empty. `feature_id: P1` is present in frontmatter (P1 `verifying`); refine leaves the edge to the operator.

### Plan

1. Precondition: `(cd packages/app && bun test tests/workflow/actions/decide.test.ts tests/workflow/actions/decide-catalog.test.ts)` is green at `eb57f0a40` (30/30 at refine time).
2. AC1 + inline AC3: in `decide.test.ts`, make `fakeMaker.choice` record state; add an absolute-evidence case and a mixed-order case against workdir `/tmp/decide-workdir`.
3. AC2 + catalog AC3: in `decide-catalog.test.ts`, add a workdir-`.` relative case and a mixed-order case asserting `instructions`; reuse the existing unreadable-evidence fallback test for the failure half.
4. AC4: confirm existing relative-key assertions and the absolute-`resultFile` test still pass; no new test unless one is missing.
5. If any new test fails, fix only inside `resolveWorkdirPath`; otherwise no source edit.
6. Run `bun run spur-check`; record the commands and counts for verify.

### Solution

**Scope.** Task 1193's source fix already landed in `eb57f0a40`; this implement stage adds regression coverage only, no source change.

**Change map (one file:line anchor per row).**

- `packages/app/tests/workflow/actions/decide.test.ts:159` — inline AC1: with workdir `/tmp/decide-workdir` and a fake fs holding only `/var/evidence/task.md` (`absolute body`), the maker receives `state.evidence` `['absolute body']` and the row stays `accepted`/not degraded; this file also adds the inline half of AC3 (mixed `['/var/evidence/task.md', 'notes.md']` reaches the maker as `['absolute body', 'relative body']`), and `fakeMaker` now records the `state.evidence` it receives below the path-resolution seam.
- `packages/app/tests/workflow/actions/decide-catalog.test.ts:237` — AC2: workdir `.` with fake fs key `notes.md` (`relative body`) gives `decisionService.decide` instructions `relative body`, proving the relative branch keeps node `join` rather than `resolve('.', …)`; this file also adds the catalog half of AC3 (`instructions` is `absolute body\n\nrelative body` for `['/var/evidence/task.md', 'notes.md']`), and `fakeService` now records the resolved input it receives.
- `packages/app/src/workflow/actions/decide.ts:39` — no source change: `resolveWorkdirPath` from `eb57f0a40` already routes both evidence maps and all three resultFile sites; the new tests pass against it unchanged.

**AC4.** No new test needed: the existing relative-key assertions (`.spur/run/x-recovery.decision.json`, `out/lane.decision.json`) and the existing absolute-`resultFile` case (`/abs/out/lane.decision.json` written as-is) already pin the absolute/relative write rule.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `eb57f0a40` — landed source fix and catalog tests for this task.
- `packages/app/src/workflow/actions/decide.ts:39-43` — `resolveWorkdirPath`; call sites `:210`, `:212`, `:287`, `:370`, `:452`.
- `packages/app/src/workflow/decide.ts:35` — `DECIDE_EVIDENCE_MAX_CHARS` is 2000.
- `packages/app/src/decision/decision-evidence-input.ts:13-16` — catalog reader; paths arrive resolved.
- `packages/app/tests/workflow/actions/decide.test.ts` — inline tests (target for AC1/AC3).
- `packages/app/tests/workflow/actions/decide-catalog.test.ts` — catalog tests incl. the three 1193 cases.
- `packages/app/src/workflow/proof-input-fingerprint.ts:174-177` — confinement this task does not copy.
- `apps/cli/src/commands/decision.ts:188-191` — CLI `resolve(cwd, file)`, already absolute-safe.
- `config/workflows/task-pipeline.yaml:477`, `:670-672`, `:813-815` — `taskSpecPath` and its evidence uses.
- ADR-125; tasks 0941 / 1094; 1194 (cancelled duplicate). Feature P1 (`verifying`).

### History

- 2026-10-13T17:51:05.359Z backlog → todo (system)
- 2026-10-13T19:32:17.580Z todo → wip (system)

