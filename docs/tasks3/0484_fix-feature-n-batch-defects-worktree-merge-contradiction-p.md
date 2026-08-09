---
template: meta
schema_version: 1
name: "Fix Feature N batch defects: worktree merge contradiction, phantom async handle, worktree tool resolution, lifecycle help"
description: ""
status: done
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0483"]
ac_numbering: task-local
created_at: "2026-08-08T22:56:42.831Z"
updated_at: "2026-08-09T01:38:49.674Z"
---

## 0484. Fix Feature N batch defects: worktree merge contradiction, phantom async handle, worktree tool resolution, lifecycle help

### Background
Post-mortem of the Feature N batch (OMP orchestrator session `019fe243`, ~6.0 h span, tasks
0472/0473/0476 via `/sp:dev-runall --feature N --auto --next --worktree --wrap`). The batch
succeeded — all three tasks reached `done` and the branch `sp/runall-feature-n-a801` FF-merged onto
`main` — but roughly half the wall clock went to friction rather than work.

Four delta bottlenecks are owned here. After verification each one changed shape, and two of the
four turned out to be the *opposite* of the original diagnosis:

1. The 148-minute merge park was not a missing auto-merge rule. The rule exists (WT-4) and predates
   the run; it is contradicted by Auto-Decision Principle #6, and the orchestrator obeyed the more
   conservative of two live specs (R1).
2. `--async` is not broken — it was demonstrated working in the main tree during this review. The
   real defect is that a *failed* async spawn is structurally undetectable and reports a phantom run
   id, which produces exactly the observed symptom of polling a run that never started (R2).
3. The worktree edit-tool failure belongs to the host agent, not this repo, but it is the same class
   as a trap `execution-batch.md` already documents for the `spur` binary (R3).
4. The lifecycle sequence and `SPUR_PROVENANCE_OVERRIDE=1` are already documented in skill docs; only
   `spur task update --help` lacks a pointer (R4).

**Evidence limitation.** Session `019fe243` ran inside the worktree
`../spur-new-runall-feature-n-a801`, which was removed on merge, taking its `.spur/run/` logs with
it. Nothing under `.spur/` matches `019fe243` today. Unlike task 0483 — whose claims were checked
against surviving JSONL — the timing and tool-count figures below could not be re-derived from
primary logs and are carried forward from the original analysis. Claims that *were* independently
verified against the committed tree, the CLI, and live execution are marked as such in Notes.

Topic filter: Feature N session only. Overlap with task 0483 is tracked in Notes; note that 0483's
refinement narrowed its R3 to the `### Review` write contract, which changes what remains deduped.
### Requirements
- [x] R1. **Resolve the WT-4 vs Auto-Decision-Principle-#6 contradiction** — two specs give opposite
  orders for the same moment. `execution-batch.md` WT-4 says that on a full-batch PASS the runner
  FF-merges the worktree branch, removes the worktree, and runs `git branch -d`. Auto-Decision
  Principle #6 (`cross-cutting.md:425-427`) says "Branch deletion … and any `--merge` / `--force`
  action pauses regardless of `--auto`. Irreversible is irreversible." WT-4's success path performs
  *both* named actions, so an agent reading both cannot proceed without picking a winner — the
  Feature N orchestrator picked #6 and parked 148 min. Pick one and make the other cite it.
  **Recommended:** carve an explicit exception into Principle #6 for the WT-4 success path, because
  that sequence is non-destructive *by construction* — `git merge --ff-only` refuses rather than
  rewriting history, and `git branch -d` (lowercase) refuses to delete an unmerged branch. Neither
  can lose work, which is the property #6 exists to protect. Target: zero parked merges on a fully
  passing `--worktree --auto` batch, with the decision recorded in one place and cross-referenced
  from the other.
- [x] R2. **Make a failed `--async` spawn detectable instead of reporting a phantom run** —
  `spawnAsyncWorkflowWorker` (`apps/cli/src/commands/workflow.ts:46-63`) runs
  `nohup <cmd> </dev/null >/dev/null 2>&1 &` through `NodeProcessExecutor` with
  `rejectOnError: false`. The trailing `&` makes `/bin/sh` exit 0 whether or not the child survived,
  all output is discarded, and `rejectOnError: false` suppresses the rest — so the `catch` at
  `:246-261` can never fire. The command then prints `status: 'started'` plus a run id (`:262-266`)
  for a workflow that may never have begun, and a caller polling `spur workflow trace <run-id>`
  waits forever on a run row that does not exist. Fix: confirm the run actually registered (or that
  the worker is alive) before reporting `started`, and fail fast with the sync-fallback hint when it
  did not. Target: `--async` either yields a traceable run id or exits non-zero with a clear reason —
  never a phantom handle.
- [x] R3. **Generalise the worktree tool-resolution trap** — `execution-batch.md` already warns that
  `spur` on PATH resolves to the published bundle rather than the worktree checkout ("`spur` on PATH
  is not this checkout"). The Feature N session hit the same class of failure with the host agent's
  file-edit tool, which reportedly resolved main-repo paths while cwd was the worktree, forcing 19
  `perl -i` workarounds. Extend that existing section to state the general rule — inside a
  `--worktree` batch, verify that *every* path-resolving tool (CLI on PATH, host-agent edit/hash
  tools) is acting on the worktree before relying on it — and name the `perl -i` / `write` fallback.
  The underlying edit-tool defect is in the host agent, not this repo; file it upstream separately.
  See Notes for what is and is not verifiable from this repo.
- [x] R4. **Surface the lifecycle sequence and provenance override in `spur task update --help`** —
  narrowed after verification: both facts *are* already documented in skill docs
  (`gate-checklists.md:28` for `backlog → todo → wip → testing → done` and its `:124-130` three-layer
  `testing → done` gate table; `done-housekeeping.md:108` for the exact
  `SPUR_PROVENANCE_OVERRIDE=1 spur task update <wbs> done --force-done --reason "…"` invocation;
  `spur-cli/references/tasks.md:96-102` for valid statuses). What is genuinely missing is any pointer
  in `spur task update --help`, which is where an operator hitting a GuardDeniedError looks first.
  Add a short Lifecycle note there pointing at the gate checklist. Do not restate the gate layers in
  help text — point to the existing owner.
### Acceptance Criteria
```gherkin
Feature: Feature N batch bottlenecks — verified delta fixes

  Scenario: R1 the merge contradiction is resolved in one place
    Given execution-batch.md WT-4 and Auto-Decision Principle #6
    When both are read together for a fully-passing --worktree --auto batch
    Then exactly one of them states whether the FF-merge proceeds without pausing
    And the other cites that decision rather than restating an opposite rule

  Scenario: R1 a fully passing worktree batch does not park
    Given a --worktree --auto batch where every task PASSes and the base ref has not moved
    When the batch completes
    Then the branch is FF-merged, the worktree removed, and the branch deleted with `git branch -d`
    And the orchestrator does not pause for a merge decision

  Scenario: R1 the destructive cases still pause
    Given a batch that failed, halted, or whose base ref moved so FF is impossible
    When the terminal action is reached
    Then the worktree and branch are retained per WT-5
    And no non-fast-forward merge or forced branch deletion happens under --auto

  Scenario: R2 a failed async spawn fails loudly
    Given `spur workflow run --async` where the detached worker cannot start
    When the command returns
    Then it exits non-zero with the spawn failure and a synchronous-fallback hint
    And it does not print a run id that `spur workflow trace` cannot resolve

  Scenario: R2 a successful async spawn stays traceable
    Given `spur workflow run --async` where the worker starts normally
    When the reported run id is passed to `spur workflow trace`
    Then the run is found and its state is reported

  Scenario: R3 the worktree tool-resolution trap is stated generally
    Given the "spur on PATH is not this checkout" section of execution-batch.md
    When an agent reads it before a --worktree batch
    Then it warns that host-agent file-edit tools may resolve main-repo paths too
    And it names the perl -i / write fallback for that case

  Scenario: R4 the lifecycle gate is discoverable from --help
    Given an operator denied by the provenance guard on `testing → done`
    When they run `spur task update --help`
    Then the help points to the lifecycle sequence and the recorded provenance override
```
### Q&A
- Q: Why is R1 no longer "add an auto-merge rule"?
  - A: Because the rule already exists and predates the run. `execution-batch.md` WT-4 mandates the
    FF-merge, worktree removal, and `git branch -d`; `dev-runall.md` advertises "FF-merge on success,
    retain on failure" in its flag table. Both landed 2026-08-07/08, before the Feature N batch. The
    orchestrator parked because Auto-Decision Principle #6 tells it that branch deletion and any
    `--merge` action pause regardless of `--auto` — a direct contradiction. Adding the rule a third
    time changes nothing; resolving the conflict does.

- Q: Is auto-merging safe, given Principle #6 exists to prevent irreversible damage?
  - A: Yes, for this specific sequence, and that is why the exception is defensible rather than a
    weakening. `git merge --ff-only` refuses when the base ref has moved instead of rewriting
    anything, and `git branch -d` refuses to delete an unmerged branch. Both fail closed. Principle
    #6's other named cases — force-push, `git branch -D`, schema migration — can destroy work; this
    one cannot. WT-5 retention on failure, halt, or non-FF stays exactly as written.

- Q: Was `--async` actually broken?
  - A: No. It was tested live in the main tree during this review: `--async --dry-run` on
    `task-pipeline.yaml` returned a run id, spawned a detached worker, registered the run, and
    `spur workflow trace` resolved it to a terminal state. The draft's fallback option — mark it
    unsupported in `--help` — would have removed a working feature on the strength of one bad run.

- Q: Then what caused the reported hang?
  - A: The reporting path, not the feature. `spawnAsyncWorkflowWorker` uses a trailing `&`,
    `>/dev/null 2>&1`, and `rejectOnError: false`, so a spawn failure is invisible on all three
    channels; the sync-fallback `catch` is unreachable and the command prints `status: 'started'`
    with a run id regardless. A caller then polls a run that never existed. Whether the Feature N
    spawn died from the sandbox or from `resolveSpurBin()` picking the stale published bundle inside
    the worktree cannot be determined now — the log is gone — but either produces this signature, and
    the fix turns an unbounded hang into an immediate error in both cases.

- Q: Why did R4 shrink so much?
  - A: Because the claim that the lifecycle sequence and `SPUR_PROVENANCE_OVERRIDE` are undocumented
    is false. Both are in the skill docs — `gate-checklists.md:28` and `:102-130`,
    `done-housekeeping.md:108`, `spur-cli/references/tasks.md:96-102`. Only `spur task update --help`
    lacks a pointer, and that is where someone hitting a GuardDeniedError looks first. Adding a
    pointer is the fix; copying the gate layers into help text would create a fourth place to drift.

- Q: Why is R3 weaker than the other three?
  - A: Because its subject is not in this repo. The host agent's edit-tool path resolution cannot be
    inspected or tested here, and the session log that recorded the 19 `perl -i` calls went away with
    the worktree. Rather than encode an unverifiable claim about another tool's internals, R3 widens
    a warning this repo already owns for the same failure class and leaves the upstream bug report as
    a separate action.

- Q: What happened to B3 in the dedup list?
  - A: It lost its owner. 0483's refinement narrowed its review requirement to the `### Review` write
    contract in `functional-review/SKILL.md`; B3 is about the *verify* agent's answer-file output, a
    different surface. It is flagged in Notes as unassigned pending a decision — either widen 0483 or
    adopt it here — rather than being quietly dropped or quietly absorbed.

- Q: What is the honest expected saving?
  - A: Lower confidence than 0483's, because the primary logs are gone and the timings could not be
    re-derived. R1 is the large one — if the 148-minute park is representative, resolving the
    contradiction removes it entirely from every fully-passing `--worktree --auto` batch. R2 converts
    an unbounded hang into an immediate error rather than saving a fixed amount. R3 and R4 are
    minutes each and mostly prevent rediscovery.
### Design
All paths resolved against the working tree. The original draft targeted
`plugins/sp/skills/sp-dev-runall/SKILL.md`, which does not exist — `/sp:dev-runall` is a *command*
(`plugins/sp/commands/dev-runall.md`) that routes to `sp:super-planner` and
`spur-dev/references/execution-batch.md`. There is no `sp-`-prefixed skill directory in this repo.

#### R1 — the merge contradiction

Both sides are already committed and both predate the run:

- `execution-batch.md` §WT-4 "Success path (R4)": "When the batch completes with **no failed task**,
  fast-forward-merge the worktree branch onto the base ref, then remove the worktree and delete the
  branch", with `git merge --ff-only "$BRANCH"`, `git worktree remove`, `git branch -d "$BRANCH"`.
  Landed 2026-08-07 20:09 (`27ec074c`), refined 2026-08-08 00:24 (`e3e124fc`).
- `cross-cutting.md` §Auto-Decision Principles #6: "**Irreversible action → surface to human.**
  Branch deletion, force-push, schema migration, `spur feature update <id> cancelled`, and any
  `--merge` / `--force` action pauses regardless of `--auto`. Irreversible is irreversible."
- `dev-runall.md`'s flag table states the WT-4 side as the user-facing contract: "`--worktree` — Run
  the batch in an isolated git worktree; FF-merge on success, retain on failure."

The Feature N run began after both landed, so this is not a missing rule and adding the rule again
cannot fix it. The orchestrator faced two live instructions and chose the conservative one.

**Why the exception is the right resolution.** Principle #6 protects against losing work. WT-4's
sequence cannot lose work: `git merge --ff-only` refuses when the base ref has moved (falling through
to WT-5 retention, which the spec already requires), and `git branch -d` — lowercase — refuses to
delete a branch that is not fully merged. Both are refuse-on-risk operations, unlike the
`git branch -D` / force-push / schema-migration cases #6 names. Write the carve-out in
`cross-cutting.md` (the owner of the principles) and have WT-4 cite it, so the two files can never
drift back into contradiction.

**Do not weaken WT-5.** Failure, halt, HITL pause, and non-FF base-ref movement must still retain the
worktree and branch. The exception applies only to the all-PASS + FF-possible path.

#### R2 — phantom async handle

`apps/cli/src/commands/workflow.ts:46-63`:

```
args: ['-c', `nohup ${line} </dev/null >/dev/null 2>&1 &`],
rejectOnError: false,
```

Three independent mechanisms each hide a spawn failure: the trailing `&` makes `/bin/sh` exit 0
regardless of the child's fate; `>/dev/null 2>&1` discards the child's diagnostics; and
`rejectOnError: false` stops `NodeProcessExecutor` from throwing. The `catch` at `:246-261` — the
only sync-fallback path, which prints "(async spawn failed, ran sync)" — is therefore unreachable in
practice. Control always reaches `:262-266`, which prints `status: 'started'` and the run id.

Verified live during this review: in the main tree the mechanism works end to end — a `--async
--dry-run` run of `task-pipeline.yaml` returned a run id, registered, and `spur workflow trace`
resolved it through to a terminal state. So the draft's "`--async` does not return a usable handle"
is wrong as a general claim, and "mark `--async` unsupported in `--help`" would remove a working
feature. What is real is that when the spawn *does* fail, nothing reports it.

**Worktree aggravator (unproven but coherent).** Inside a worktree, `resolveSpurBin()` may resolve to
the published `~/node_modules` bundle rather than the checkout — a trap `execution-batch.md` already
documents in its "`spur` on PATH is not this checkout" section. A stale bundle failing on a newer
workflow schema would produce exactly this signature: instant child death, discarded output, phantom
run id, caller polling forever. Fixing R2 converts that from an unbounded hang into an immediate,
readable error, whether or not this was the specific trigger.

#### R3 — worktree tool-resolution trap

The host-agent `edit`/`hashline` defect is out of this repo and could not be verified here (the
session log is gone; see Notes). Treat the upstream filing as a separate, non-blocking action. What
*is* actionable in-repo is that `execution-batch.md` already documents this exact failure class for
one tool (`spur` on PATH) and stops there. Generalising that section costs a paragraph and covers the
next tool that resolves against the wrong root. Keep the guidance behavioural — "verify the tool is
acting on the worktree, fall back to `perl -i` or `write`" — rather than encoding a claim about a
specific agent's internals that this repo cannot test.

#### R4 — help-text pointer

`spur task update --help` currently lists `--force-done`, `--reason`, and the positional `status`
argument with no mention of the transition order or of the provenance guard that denies
`testing → done` when no pipeline run is recorded. The facts already exist elsewhere:
`gate-checklists.md:28` (sequence), `:102-130` (the done gate and its three layers, including the
provenance guard and its recorded-bypass remediation), `done-housekeeping.md:108` (the exact override
invocation), `spur-cli/references/tasks.md:96-102` (valid statuses). Add a pointer, not a copy —
duplicating the gate layers into help text creates a fourth place to drift.
### Plan
Plan items carry no `R<n>.` prefix: `task-size-precheck` matches `R_ITEM_RE` document-wide while
scoping the Plan count to the Plan section, so prefixed plan items double-count as requirements and
trip `maxImplementReqs`. Requirement mapping is in trailing parens.

- [x] Carve the WT-4 success-path exception into Auto-Decision Principle #6 in `cross-cutting.md` and have `execution-batch.md` WT-4 cite it, leaving WT-5 retention untouched (R1)
- [x] Make a failed async spawn observable in `apps/cli/src/commands/workflow.ts` and fail fast instead of printing a phantom run id (R2)
- [x] Widen the "`spur` on PATH is not this checkout" section of `execution-batch.md` to cover host-agent file-edit tools and name the `perl -i` / `write` fallback (R3)
- [x] Add a Lifecycle pointer to `spur task update --help` referencing the gate checklist and the recorded provenance override (R4)
### Solution
**R1 — resolve the merge contradiction.** `execution-batch.md` §WT-4 mandated an unattended FF-merge + worktree removal + `git branch -d` on a fully-passing `--worktree --auto` batch, while Auto-Decision Principle #6 paused any merge/branch-deletion action regardless of `--auto` — two live specs giving opposite orders, so the Feature N orchestrator parked 148 min. Resolved in one owner:
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:429-438` — carved an explicit exception into Principle #6 for the WT-4 success path, scoped to the all-PASS + FF-possible case. It is safe by construction: `git merge --ff-only` and `git branch -d` (lowercase) both refuse rather than risk losing work. WT-5 retention (failure/halt/non-FF) is untouched.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:479-484` — WT-4 now cites the Principle #6 exception rather than leaving the two specs contradictory.

**R2 — phantom async handle.** `spawnAsyncWorkflowWorker` combined a trailing `&`, `>/dev/null 2>&1`, and `rejectOnError: false`, so a dead-on-arrival worker was invisible on all three channels and the launcher printed `status: 'started'` with a run id that `spur workflow trace` could never resolve. `--async` itself works; the reporting path did not.
- `apps/cli/src/commands/workflow.ts:65-84` — added `waitForRunRegistration(service, runId, timeoutMs, pollMs)`, polling `trace(runId)` until the run row exists (exported for direct testing).
- `apps/cli/src/commands/workflow.ts:265-278` — the `--async` branch now confirms registration before reporting `started`; on timeout it exits non-zero with a synchronous-fallback hint and prints no phantom run id. The sync-fallback `catch` remains for synchronous spawn throws.
- `apps/cli/tests/commands/workflow.test.ts` — added `waitForRunRegistration` unit tests (register / never-register); updated the 6 in-process `--async` tests to seed a run row (the in-process detached child cannot register into the parent DB), preserving flag-forwarding and started-message coverage.

**R3 — worktree tool-resolution trap.** The host-agent edit-tool path-resolution defect is out of this repo (filed upstream separately). The in-repo fix widens the existing warning:
- `plugins/sp/skills/spur-dev/references/execution-batch.md:419-425` — the "`spur` on PATH is not this checkout" section now states the general rule that every path-resolving tool (CLI on PATH, host-agent edit/hash tools) must be verified against the worktree before use, and names the `perl -i` / `write` fallback.

**R4 — lifecycle help pointer.** The lifecycle sequence and `SPUR_PROVENANCE_OVERRIDE=1` bypass were already documented in skill docs; only `spur task update --help` lacked a pointer where a GuardDeniedError is first seen:
- `apps/cli/src/commands/task.ts:258-267` — added an `addHelpText` Lifecycle note to the `update` subcommand pointing at the lifecycle sequence and the recorded provenance override, and referencing the gate checklist rather than restating the gate layers.

**Verification.** `bunx tsc -p apps/cli` clean; `biome check` clean on all three TS files; `apps/cli/tests/commands/workflow.test.ts` 94 pass; `workflow.test.ts` + `task.test.ts` 237 pass; full `apps/cli/tests` 673 pass (two transient subprocess flakes observed once, stable on re-run). Real `spur workflow run --async --dry-run` returned a run id that `spur workflow trace` resolved; `spur task update --help` prints the Lifecycle note.
### Testing
**Verdict: PASS** — independently re-verified 2026-08-09 (`--force --focus all --fix all`). Every
anchor below was re-read at the cited lines this run; repo-relative paths throughout so the L4
anchor checker can resolve them.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — resolve the WT-4 / Principle #6 contradiction | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:429-438` — the carve-out lives in Principle #6 (the owner), scoped to the all-PASS + FF-possible path and justified by fail-closed semantics of `git merge --ff-only` / `git branch -d`. `plugins/sp/skills/spur-dev/references/execution-batch.md:479-484` — WT-4 **cites** it instead of restating an opposite rule. WT-5 retention (`:488`) untouched. |
| R2 — no phantom async handle | MET | `apps/cli/src/commands/workflow.ts:73-90` (`waitForRunRegistration`) + `:294-310` (fail-fast branch). **Improved this run** — see the R2 hardening note. Tests: `apps/cli/tests/commands/workflow.test.ts` **97 pass / 0 fail**. |
| R3 — generalise the worktree tool-resolution trap | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:419-425` — "**General rule — every path-resolving tool, not just `spur`**" names host-agent file-edit and hash/`hashline` tools, requires verifying the tool acts on the worktree, and names the `perl -i` / `write` fallback. |
| R4 — lifecycle pointer in `spur task update --help` | MET | `apps/cli/src/commands/task.ts:258-267` (`addHelpText`). Live this run: `spur task update --help` prints the Lifecycle note with the `backlog → todo → wip → testing → done` sequence, the guard explanation, the `SPUR_PROVENANCE_OVERRIDE=1 … --force-done --reason "…"` invocation, and the gate-checklist pointer — a pointer, not a copy. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 the merge contradiction is resolved in one place | MET | static | Principle #6 owns the single carve-out; WT-4 cites it. Neither restates an opposing rule. |
| R1 a fully passing worktree batch does not park | MET | static | Carve-out states the WT-4 success sequence "does **not** pause". |
| R1 the destructive cases still pause | MET | static | Exception scoped to all-PASS + FF-possible; branch `-D`, force-push, schema migration, other `--merge`/`--force` still pause. WT-5 retention preserved. |
| R2 a failed async spawn fails loudly | MET | test | **New CLI-level coverage this run** (the gap that let the JSON leak ship): text mode → exit 1, message contains `async spawn failed` and `omit --async`, and asserts the run id is **absent**; `--json` → `status:"failed"`, `reason`, `hint`, and **no `runId` property**. Mutation-verified: re-adding `runId` to the JSON payload fails the guard (96 pass / 1 fail); removing it → 97 pass. |
| R2 a successful async spawn stays traceable | MET | command | Live this run: `spur workflow run .spur/workflows/task-pipeline.yaml --async --run-id 49474C97-6C87-4DEC-A0CF-FEEE91BB2747 --dry-run` reported `Started async run`, exit 0; `spur workflow trace <id> --json` resolved the run through `precheck` to a terminal phase with an `outputArtifact` path. |
| R3 the worktree tool-resolution trap is stated generally | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:419-425` re-read — general rule + `perl -i` / `write` fallback present. |
| R4 the lifecycle gate is discoverable from --help | MET | command | Live `spur task update --help` output pasted-verified this run. |

**R2 hardening applied this run (`--fix all`).** The original implementation closed the phantom
handle on the human-readable path but **not** on `--json`, which still emitted
`{ runId, status: 'failed', … }`. A machine caller reading `.runId` without checking `.status` would
poll exactly the phantom run R2 exists to eliminate, so AC "does not print a run id that
`spur workflow trace` cannot resolve" was satisfied in one mode only. Two changes:

- `apps/cli/src/commands/workflow.ts:294-310` — `runId` removed from **both** failure payloads; the
  synchronous-fallback `hint` is now carried in the JSON payload too, not just the text message.
- `apps/cli/src/commands/workflow.ts:65-76` — the registration budget is now
  `SPUR_ASYNC_REGISTER_TIMEOUT_MS` (default 5000, invalid/non-positive falls back rather than
  disabling the check). This closes the residual risk this task's own `## Review` recorded — a
  legitimately slow worker on a loaded host being misreported as failed — and lets the new tests
  drive the failure branch without paying a 5s wait each.

Root cause of the miss: the failure branch had **no CLI-level test** — only `waitForRunRegistration`
was unit-tested, and it cannot observe what the command prints. That gap is now closed by the two
tests above.

**Gates run this turn**

- `bun run lint` — clean (biome + typecheck 7/7 exit 0)
- `bun test apps/cli/tests/commands/workflow.test.ts` — **97 pass / 0 fail** (94 prior + 3 new)
- `bun test apps/cli/tests/` — **672 pass / 4 fail**; the 4 are the pre-existing sandbox
  port-binding denials in `spur projects CLI command` (port/registry suites), unrelated to this task
- `spur task check 0484 --strict-core` — **PASS**, 0 stale anchors
- R2 mutation check — phantom `runId` restored → 1 fail; removed → 97 pass

Coverage: N/A for the documentation surfaces (R1, R3); the R2/R4 code paths are covered by the
`apps/cli` suite above.

**Shippable: N/A** — no feature context (`feature_id` is null). See Notes for the open decision on
linking this task to a feature.

**--next: no-op** — task already terminal (`done`); no `testing → done` transition can fire.
### Review
**Disposition:** APPROVE — all four requirements implemented and verified; no P1-P3 findings.

| Pri | Finding | Disposition |
|-----|---------|-------------|
| P1 | None | N/A |
| P2 | None | N/A |
| P3 | None | N/A |
| P4 | R1 carve-out is the single exception to Principle #6; scoped to the all-PASS + FF-possible path so no destructive case is weakened | Accepted — cross-referenced from WT-4; WT-5 retention and branch `-D`/force-push pauses untouched |
| P4 | R2 registration check adds a bounded 5s wait; a slow-but-valid worker could theoretically exceed it and false-fail | Accepted — 5s is ample for local worker registration; a false-fail exits non-zero with a sync-fallback hint rather than hanging on a phantom handle |
| P4 | R3 guidance is behavioural and cannot be unit-tested, since the host-agent edit-tool defect is out of this repo | Accepted — documented as a separate upstream action; the in-repo paragraph widens an existing warning |
| P4 | R4 help pointer references the gate-checklist owner rather than restating the gate layers | Accepted — avoids a fourth place to drift |

**Residual risk:** The R2 registration wait is a fixed 5s; on heavily loaded CI a legitimately slow worker start could be misreported as failed. The failure is loud (non-zero + hint), so an operator can re-run synchronously — an acceptable trade versus an unbounded phantom-handle hang.
### References
Edit targets (all verified present):

- R1: `plugins/sp/skills/spur-dev/references/cross-cutting.md` §Auto-Decision Principles #6 (the
  owner — write the carve-out here); `plugins/sp/skills/spur-dev/references/execution-batch.md` §WT-4
  (cite it). Leave §WT-5 unchanged.
- R2: `apps/cli/src/commands/workflow.ts:46-63` (`spawnAsyncWorkflowWorker`) and `:225-266` (the
  `--async` branch, unreachable `catch`, and the `status: 'started'` report).
- R3: `plugins/sp/skills/spur-dev/references/execution-batch.md` §"`spur` on PATH is not this
  checkout".
- R4: `spur task update --help` (`apps/cli/src/commands/task.ts`, the `update` subcommand
  definition).

Read-only contracts consulted (do not edit here):

- `plugins/sp/commands/dev-runall.md` — `--worktree` flag contract: "FF-merge on success, retain on
  failure"; `--wrap`, `--next`, `--auto` semantics.
- `config/workflows/wrapup-pipeline.yaml:48,152-161,235-259` — `merge` defaults to `"false"`, and the
  `branch-cleanup` HITL is reached only when `merge=true`; with the default it routes straight to
  `done`. Checked and ruled out as the source of the 148-min park.
- `plugins/sp/skills/spur-dev/references/gate-checklists.md:28,102-130` — lifecycle sequence and the
  three `testing → done` gate layers.
- `plugins/sp/skills/spur-dev/references/done-housekeeping.md:108` — the provenance-override invocation.
- `plugins/sp/skills/spur-cli/references/tasks.md:96-102` — valid statuses.
- `plugins/sp/scripts/task-size-precheck.ts:95,105` — the R-item/Plan-item counting asymmetry.

Verification performed during refinement:

- `spur workflow run .spur/workflows/task-pipeline.yaml --async --run-id <uuid> --dry-run` returned a
  run id, registered the run, and `spur workflow trace <run-id>` resolved it through `precheck` to a
  terminal state — `--async` works in the main tree.
- `git log` timeline: base ref `a801891d` (08-08 09:47 PDT); Feature N commits `763f6b17`,
  `39f17a65`, `3beb61b4`, `fc35388e` (11:22–12:44 PDT) sit linearly on `main`, so the FF-merge
  succeeded and FF was possible.
- WT-4 provenance: `27ec074c` (2026-08-07 20:09), `e3e124fc` (2026-08-08 00:24) — both predate the run.
- `spur task update --help` inspected: no lifecycle or provenance mention.

Original evidence (carried forward, not re-derivable — worktree and its logs removed):

- Feature N orchestrator session: OMP `019fe243` (~6.0 h span, 337 bash calls, 7 compactions).
- Feature N tasks: 0472 (corpus-check fog gate), 0473 (feature check learns wayfinder maps), 0476
  (skip DD-09 subset check for map-parented tasks) — all done, FF-merged to main.
- R1 timing: 148-min gap 19:46→22:14 UTC; worktree `../spur-new-runall-feature-n-a801` on branch
  `sp/runall-feature-n-a801`.
- R3 evidence: 19 `perl -i` invocations replacing `edit` tool calls in the Feature N worktree.

Sibling task (H1 batch): `docs/tasks3/0483_fix-h1-pipeline-contract-defects-implement-scope-agent-pin-r.md`.
Its 2026-08-08 refinement narrowed the review requirement, which changes the dedup mapping — see Notes.
### History
- 2026-08-08T23:42:21.472Z backlog → todo (system)
- 2026-08-09T01:17:47.452Z todo → wip (system)
- 2026-08-09T01:17:47.978Z wip → testing (system)
- 2026-08-09T01:18:05.447Z testing → done (system)
### Notes
Root-cause analyses for the Feature N batch (session `019fe243`; meta template — analyses live in
Notes). Revised after checking every claim against the committed tree, the live CLI, and git history.
Corrections are marked, and each item states whether it was independently verified.

**Evidence limitation (applies to all timing figures below).** The session ran inside
`../spur-new-runall-feature-n-a801`, removed on merge; nothing under `.spur/` matches `019fe243`
today. The wall-clock and tool-count numbers are carried from the original analysis and could **not**
be re-derived from primary logs, unlike task 0483's. Structural claims about the repo were verified
and are marked accordingly.

- **B2 — the 148-minute merge park (R1). VERIFIED as a spec contradiction, not a missing rule.**
  The original draft proposed adding an auto-merge-on-success rule. That rule already exists:
  `execution-batch.md` §WT-4 mandates `git merge --ff-only` + `git worktree remove` +
  `git branch -d` on a no-failed-task batch, and `dev-runall.md` advertises "FF-merge on success,
  retain on failure" in its flag table. Both landed before the run (`27ec074c` 2026-08-07 20:09;
  `e3e124fc` 2026-08-08 00:24). Against them stands Auto-Decision Principle #6
  (`cross-cutting.md`): "Branch deletion … and any `--merge` / `--force` action pauses regardless of
  `--auto`." WT-4's success path performs a merge *and* a branch deletion — the two actions #6 names
  — so the specs directly contradict each other and the orchestrator obeyed the stricter one.
  **Timeline check (verified):** base ref `a801891d` 08-08 09:47 PDT; the Feature N commits
  `763f6b17`/`39f17a65`/`3beb61b4`/`fc35388e` carry author times 11:22–12:44 PDT and sit linearly on
  `main`, confirming the FF-merge did eventually succeed and that FF was possible throughout. The
  reported 19:46→22:14 gap is UTC (12:46→15:14 PDT), i.e. the window between the last task finishing
  and the merge the agent declined to perform unattended.

- **B4 — edit tool broken in the worktree (R3). NOT VERIFIABLE from this repo.** The claim is that
  the host agent's `edit`/`hashline` tool resolved main-repo paths while cwd was the worktree,
  forcing 19 `perl -i` workarounds. That defect lives in the host agent's implementation; this repo
  contains neither the tool nor, any longer, the session log that recorded the 19 calls. Recorded as
  reported, not as confirmed. What *is* verified is that `execution-batch.md` already documents the
  same failure class for the `spur` binary ("`spur` on PATH is not this checkout"), which is why R3
  generalises that existing section rather than asserting anything about the agent's internals.

- **B5 — `--async` workflow failure (R2). CORRECTED — the flag works; failure reporting does not.**
  The draft asserted `--async` "does not return a usable handle (hangs / no polling result)" and
  proposed fixing it or marking it unsupported in `--help`. Tested live during this review in the
  main tree: `spur workflow run .spur/workflows/task-pipeline.yaml --async --dry-run` returned a run
  id, spawned a detached worker, registered the run, and `spur workflow trace <run-id>` resolved it
  through precheck to a terminal state. Marking the flag unsupported would remove a working feature.
  The genuine defect is narrower and worse: `spawnAsyncWorkflowWorker`
  (`apps/cli/src/commands/workflow.ts:46-63`) combines a trailing `&`, `>/dev/null 2>&1`, and
  `rejectOnError: false`, so a spawn that fails is invisible on all three channels. The sync-fallback
  `catch` at `:246-261` is consequently unreachable, and `:262-266` reports `status: 'started'` with
  a run id for a run that never began — a caller polling `spur workflow trace` then waits forever.
  That is precisely the reported symptom, reached by a different route than the draft supposed.

- **B7 — lifecycle sequence + provenance override (R4). CORRECTED — documented, but not in `--help`.**
  The draft said both were "not discoverable in CLI `--help` or skill docs". The skill-doc half is
  false: `gate-checklists.md:28` gives `backlog → todo → wip → testing → done`, `:102-130` documents
  the `testing → done` gate and all three of its layers including the provenance guard and its
  recorded bypass, `done-housekeeping.md:108` gives the exact `SPUR_PROVENANCE_OVERRIDE=1 … --force-done
  --reason "…"` invocation, and `spur-cli/references/tasks.md:96-102` lists the valid statuses.
  Verified absent from `spur task update --help`, which is where an operator hitting a
  GuardDeniedError looks first. R4 shrank to adding that pointer.

**Recurring theme across B2, B4-adjacent, and B7 — and shared with task 0483.** In three of four
cases the correct behaviour was already written down and was not found or not followed at the moment
it mattered. More prose is therefore a remedy with a demonstrated failure rate here. R1 resolves a
contradiction rather than adding a rule; R2 changes code; R4 adds a pointer at the point of failure
rather than restating the content. Only R3 adds guidance, and only by widening a paragraph that
already exists.

**Dedup against task 0483 — REVISED, one item now unowned.** 0483 was refined on 2026-08-08 and its
requirements were retargeted; the old mapping no longer holds:

- B1 (executor credential/quota failures) — still covered. 0483 RC3 owns the `--agent`/`implementAgent`
  pin that produced the 403s, and the commented-out-default half was already fixed by `a801891d`.
- B6 (Review P1–P4 table gate format) — still covered, and is now precisely 0483 R3.
- B3 (verify agent writes prose instead of the required tables) — **RESOLVED 2026-08-09: already
  owned by task 0478 R2, no new owner needed.** The concern was that the *verify* answer-file surface
  had lost its owner when 0483's refinement narrowed R3 to the `### Review` write contract. Checked
  directly: `plugins/sp/skills/code-verification/SKILL.md:265-296` carries an **Answer-File Schema
  Contract (R2 / 0478)** that mandates the exact `| Req | Status | Evidence |` and
  `| AC | Status | Evidence Type | Evidence |` headers, with explicit MUST NOT clauses for the
  `| R# |`-only and `Severity`-between-columns variants, and notes the parser is tolerant only as
  defense-in-depth while the authoring contract stays canonical. Task 0478 is `done`. So the two
  write contracts are separately owned — `### Review` by 0483 R3 (`functional-review/SKILL.md`), the
  verify answer file by 0478 R2 (`code-verification/SKILL.md`) — and neither 0483 nor 0484 needs
  widening. Recorded here rather than left open, since the original note asked for exactly this
  decision.

**Open decision — this task has no `feature_id`.** `spur task check 0484` warns
`Missing feature_id … (one direction, DD-07)`; its three sibling post-mortem tasks (0480, 0482,
0483) are all linked to **H1**. Linking 0484 to H1 is *not* automatically correct: `feature check`
applies the DD-09 subset rule, so its four scenarios would have to appear in H1's Acceptance
Criteria or they surface as new findings against a feature already carrying uncovered scenarios.
Left unlinked deliberately, to be settled as part of the H1/H shippability pass rather than
resolved by a reflex `--feature H1`.

**Sizing note.** Plan items are written without an `R<n>.` prefix on purpose: `task-size-precheck`
matches `R_ITEM_RE` document-wide while scoping the Plan count to the Plan section, so `R#.`-prefixed
plan items double-count as requirements. This task previously reported 8 R-items against a max of 5
and could not have entered the pipeline.

What worked well (preserve): productive coding time was ~36 min across 5 worktree sessions; the
`perl -i` fallback was reliable once identified; the manual verify-lifecycle recovery succeeded on the
first attempt once the answer-file format was known; and the FF-merge, when finally run, was clean.
