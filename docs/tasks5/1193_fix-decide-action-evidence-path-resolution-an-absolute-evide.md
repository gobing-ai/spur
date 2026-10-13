---
schema_version: 1
name: "Fix decide action evidence path resolution: an absolute evidence path is joined with the workdir"
status: todo
template: standard
created_at: 2026-10-13T17:44:16.262Z
updated_at: "2026-10-13T17:59:00.393Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 2
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

### Requirements

- [ ] R1. On both the catalog and the inline decide runners, an absolute `evidence` entry is read at that path. A file that exists only at `join(workdir, absolutePath)` does not satisfy the read.
- [ ] R2. A relative `evidence` entry is still `join(workdir, entry)`. When `workdir` is `.`, the read path is the relative entry (`notes.md`), not `resolve('.', entry)`.
- [ ] R3. A mixed evidence list is read in declaration order. The catalog runner passes the redacted bodies to `decisionService.decide` as `instructions`, joined with `\n\n`. The inline runner passes the same bodies, in order, as `runDecide`'s `state.evidence`. One unreadable entry still fails the whole list and degrades the catalog row to `reason: 'error'`.
- [ ] R4. `resultFile` is still written with `join(workdir, resultFile)`. A relative result path under workdir `.` stays the relative key the existing tests write (`.spur/run/x-recovery.decision.json`, `out/lane.decision.json`).

Out of scope: changing `resultFile` resolution, confining evidence under the workdir, editing `readDecisionEvidence` or `runDecide`, editing `config/workflows/task-pipeline.yaml`, exporting a new path helper, and making `spur decision run` match the workflow runner. The CLI already uses `resolve(cwd, file)`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An absolute evidence path is read as given (req: R1)
  Given a decide workdir `/tmp/decide-workdir` and a fake filesystem that contains `/var/evidence/task.md` with body `absolute body` and does not contain `/tmp/decide-workdir/var/evidence/task.md`
  When the catalog runner executes evidence `['/var/evidence/task.md']` and the inline runner executes the same evidence list
  Then each runner reads `absolute body` and returns the maker value (`retry`), and neither degrades because the joined absolute key is missing

Scenario: AC2 — A relative evidence path stays workdir-joined (req: R2)
  Given a catalog decide whose workdir is `.` and whose fake filesystem contains the key `notes.md` with body `relative body`
  When the runner executes evidence `['notes.md']`
  Then `decisionService.decide` receives instructions `relative body`
  And a second case with workdir `/tmp/decide-workdir` and evidence `['notes.md']` reads the key `/tmp/decide-workdir/notes.md`

Scenario: AC3 — A mixed evidence list keeps order and the existing failure rule (req: R3)
  Given workdir `/tmp/decide-workdir`, absolute body `absolute body` at `/var/evidence/task.md`, and relative body `relative body` at `/tmp/decide-workdir/notes.md`
  When the catalog runner executes evidence `['/var/evidence/task.md', 'notes.md']`
  Then `instructions` is `absolute body\n\nrelative body`
  And the inline runner's maker receives `state.evidence` `['absolute body', 'relative body']`
  And when the absolute file is absent, the catalog runner writes the fallback row with `reason: 'error'` and does not call `decide`

Scenario: AC4 — resultFile resolution is unchanged (req: R4)
  Given the existing inline and catalog decide tests that write a relative resultFile
  When those tests run against workdir `.` and workdir `/tmp/decide-workdir`
  Then the write keys remain `.spur/run/x-recovery.decision.json` and `out/lane.decision.json`
```

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

### Design

**WHAT.** A file-private `resolveEvidencePath(workdir, evidencePath)` in `packages/app/src/workflow/actions/decide.ts`, next to `isDecidableType` (`decide.ts:481`). It returns `evidencePath` when `isAbsolute(evidencePath)` is true, and `join(workdir, evidencePath)` otherwise. Both evidence maps call it: the inline map at `decide.ts:193-194` and the catalog map at `decide.ts:428-431`.

**WHY.** `taskSpecPath` is the absolute `filePath` from `spur task path --json`. Joining it onto the workflow workdir makes `task-triage` and `review-failure-class` fail the evidence read and degrade to the catalog fallback. Relative entries, including workdir `.`, already match the tests and must keep `join` semantics. `path.resolve(workdir, entry)` is the wrong relative branch: `resolve('.', 'notes.md')` is cwd-absolute.

**WHERE.**

- `packages/app/src/workflow/actions/decide.ts` — import `isAbsolute` from `node:path` beside the existing `join` import (`decide.ts:1`). Add `resolveEvidencePath`. Replace the two `options.evidence.map((path) => join(workdir, path))` expressions. Rewrite the comment at `decide.ts:188-189` so it states the split: evidence uses `resolveEvidencePath`; `resultFile` stays `join(workdir, options.resultFile)` at `:196`, `:270`, and `:350`.
- `packages/app/tests/workflow/actions/decide-catalog.test.ts` — catalog behavior.
- `packages/app/tests/workflow/actions/decide.test.ts` — inline behavior.

**Frozen names.** Function `resolveEvidencePath`. It is not exported from `decide.ts` and not re-exported from `packages/app/src/index.ts`. No new flag, schema field, workflow var, or YAML key. `evidence` and `resultFile` keep their current option names.

**Algorithm.** For each evidence string, in order: absolute → use the string unchanged (no `normalize`, no workdir prefix); relative → `join(workdir, entry)`, which already normalizes `.` and `..`. Pass the resulting list to the existing reader. Catalog: `readDecisionEvidence`, then `instructions = bodies.join('\n\n')`. Inline: the list is the `evidence` option of `runDecide`, which redacts each file into `state.evidence`. Do not resolve twice.

**Anti-patterns.**

- Do not implement the relative branch with `path.resolve`. That changes workdir `.` from `notes.md` to a cwd-absolute path.
- Do not change the three `resultFile` `join` sites. Existing tests pin the relative write keys.
- Do not reject an absolute path that sits outside the workdir. `readProofInputContents` confines `taskFile` (`packages/app/src/workflow/proof-input-fingerprint.ts:174-177`). Decide evidence does not, and this task does not add that policy.
- Do not skip a single unreadable entry. One throw still degrades the catalog row.
- Do not relativize `taskSpecPath` in `task-pipeline.yaml`, and do not edit `apps/cli/src/commands/decision.ts`.
- Do not add a public helper or a second copy of the branch at the call sites.

**Tests.** Extend the local `fakeFs` / service fakes already in the two test files. Catalog `decide` records its input argument. Inline `fakeMaker.choice` records its state argument. Plain ASCII bodies shorter than `DECIDE_EVIDENCE_MAX_CHARS` (2000, `packages/app/src/workflow/decide.ts:35`) pass through `redactAndBound` unchanged, so the assertions compare the file bodies directly. No new fixture directory and no network.

**Concurrency.** Surveyed 2026-10-13: worktrees are `/Users/robin/xprojects/spur-new` (`main` at `4cbbcc033`), `spur-base-cc` and `spur-new-verify` (detached `5715de2e8`), and `spur-tools` (`chore/tool-pins-and-verification-sync`). The only `wip` task is 1189 (deprecated task-status vocabulary). Its task file does not mention `decide.ts`. No other task owns this join.

**Handoff.** None. `dependencies[]` stays empty. Feature P1 (`verifying`) owns the catalog adoption that shipped these evidence lists, and linking 1193 with `spur task update --feature P1` would reopen P1 to `active`. The reference stays in References. `ac_altitude: task-local` and `ac_numbering: task-local` because these scenarios are regression checks, not P1 ship scenarios.

### Plan

1. Add the isAbsolute guard at both join sites (decide.ts:194 inline, :430 catalog).
2. Write the regression test first: absolute evidence path readable, relative path still workdir-relative, missing file still degrades to the declared fallback.
3. Re-run the task-pipeline triage against a task with an absolute taskSpecPath and inspect the decision_logs row.
4. Confirm no new error class or public surface is introduced.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/workflow/actions/decide.ts:1` — `join` import; add `isAbsolute` here.
- `packages/app/src/workflow/actions/decide.ts:188-196` — inline evidence join and the `resultFile` join to leave in place.
- `packages/app/src/workflow/actions/decide.ts:270` — inline `resultFile` write.
- `packages/app/src/workflow/actions/decide.ts:350` — catalog `resultFile` write.
- `packages/app/src/workflow/actions/decide.ts:428-431` — catalog evidence join.
- `packages/app/src/workflow/actions/decide.ts:481` — file-private `isDecidableType`; `resolveEvidencePath` sits beside it.
- `packages/app/src/workflow/decide.ts:35` — `DECIDE_EVIDENCE_MAX_CHARS` is 2000.
- `packages/app/src/workflow/decide.ts:123-128` — inline reader; paths are already final.
- `packages/app/src/decision/decision-evidence-input.ts:13-16` — catalog reader; paths are already final.
- `packages/app/src/workflow/proof-input-fingerprint.ts:174-177` — spec confinement this task does not copy.
- `apps/cli/src/commands/decision.ts:188-191` — CLI `resolve(cwd, file)`, already absolute-safe.
- `config/workflows/task-pipeline.yaml:477` — `taskSpecPath` from `spur task path --json`.
- `config/workflows/task-pipeline.yaml:670-672` — `task-triage` evidence, including `${vars.taskSpecPath}`.
- `config/workflows/task-pipeline.yaml:715-716` — `failure-class` evidence, relative only.
- `config/workflows/task-pipeline.yaml:813-815` — `review-failure-class` evidence, including `${vars.taskSpecPath}`.
- `packages/app/src/workflow/actions/agent-run.ts:332` — existing `isAbsolute(path) ? path : join(cwd, path)` pattern. Copy the branch, not a shared helper.
- ADR-125 and tasks 0941 / 1094 — decide action and catalog-reference form. Feature P1 is `verifying` and is not linked (see Q&A).
- Concurrency 2026-10-13: wip 1189 does not touch `decide.ts`. Worktrees: `spur-new` `main`, `spur-base-cc`, `spur-new-verify`, `spur-tools`.

### History

- 2026-10-13T17:51:05.359Z backlog → todo (system)

