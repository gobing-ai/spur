---
template: issue
schema_version: 1
name: "Fix H6 dogfood defects: hook spawn overhead, pipeline agent.run timeouts, and verdict AC parser/linkage traps"
description: ""
status: done
type: issue
profile: standard
feature_id: H7
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-07-31T04:24:04.544Z"
updated_at: "2026-08-01T04:13:41.758Z"
---

## 0398. Fix H6 dogfood defects: hook spawn overhead, pipeline agent.run timeouts, and verdict AC parser/linkage traps

### Background

The H6 batch (`/skill:sp-dev-runall --feature H6 --auto`, 6 tasks driven by `omp` under a Pi
session) completed PASS but burned ~20h wall-clock and required four manual timeout recoveries.
Two post-mortems were produced:

- `/tmp/findissue-H6-report.md` — `/skill:sp-dev-find-issue` output (Pi session + omp session
  `019fb512-71c5-7000-89f2-1bd28a14ad53`).
- `docs/dogfood/2026-07-31-sp-dev-runall-H6-dogfood.md` — dogfood report, findings P1–P4.

This task consolidates every actionable defect from both into one fix. It is a **defect task, not
a feature increment** — no new surface, only repairs to the hook path, the pipeline timeout
budget, and the verdict/AC linkage contract.

#### Re-measurement changed the diagnosis

The two reports were written from estimates. Re-measuring the same evidence before writing this
task **overturned two of their conclusions and found a larger defect neither reported**:

| Claim in the reports                               | Measured reality                                                                                                       | Verdict                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| "1347 hook spawns _this session_"                  | `.spur/context/token-ledger.jsonl` holds 1353 lines spanning **2026-07-13 → 2026-07-31** (18 days), not one session    | **Overstated ~18×**                                       |
| "331 `session_start` this session (331× expected)" | 332 total over 18 days; **39** on 2026-07-30/31 (the H6 window)                                                        | Real but far smaller                                      |
| "`write` 542 / `read` 322 → PostToolUse storm"     | On 2026-07-30/31: **7 writes, 15 reads**. PostToolUse barely fired during H6                                           | **Not supported** — fix 1b dropped                        |
| "~200–500 ms per hook spawn"                       | `superskill hook run sp context-post-tool` = **1.22–1.53 s**; `bun -e ''` = **1.41–2.00 s**; `node -e ''` = **0.02 s** | **Understated ~4×**; cost is bun cold start, not dispatch |
| (not reported)                                     | `task-write-guard` shells out to `spur task resolve` = **2.40 s**, on **every** Write/Edit regardless of path          | **New P1**                                                |

The reports framed Issue 1 as _too many spawns_. It is actually _each spawn is enormous_, and the
worst offender — a ~3.7 s tax on every single `Write`/`Edit` tool call — was missed by both.

#### Where the time actually went

`spur task resolve` (2.40 s) + `superskill hook run` startup (~1.3 s) ≈ **3.7 s per Write/Edit**,
paid by every agent on every file mutation in any repo with the sp plugin installed — including
each nested `agent.run` subprocess inside the pipeline. Against 542 recorded writes that is
~33 min of pure guard latency across the ledger's lifetime, and it compounds inside pipeline
steps that are already fighting a hard timeout wall.

The ~20 h itself is still dominated by the four `agent.run` timeouts (~80 min of discarded work
plus manual recovery) and by operator-idle gaps between resumptions — not by hook latency. Hook
latency is the defect that makes every future session slower; the timeouts are the defect that
made this one fail.

#### Update 2026-07-31 — RC-3 reproduced, and its blast radius measured

A `/sp:dev-verifyall --feature H6 --fix all` pass run after this task was authored **reproduced the
R7 contradiction live** on task 0396, and hit the case with no escape at all (a feature scenario
that cannot be `[doc-only]`-tagged). It also measured the consequence on the shipped corpus: **23 of
48 declared task scenarios carried no verdict AC row**, one verdict had an empty
`acceptanceCriteria` array, and every gate in the chain still passed. R7 is therefore not a
theoretical contract wart — it silently degrades verification evidence, and the gates do not
notice. Details in `### Root Cause` RC-3; artifacts in `### References`.

### Requirements

Eight requirements in three clusters. R1 gates R2/R3; the clusters are otherwise independent and
can land in any order.

R1. **Re-baseline hook latency outside the agent sandbox.** Every timing in `### Background` was measured inside the Claude Code Bash sandbox, where syscall filtering may inflate process startup. Before changing any hook code, re-run on a bare shell (no agent, no sandbox) and record the medians in `### Root Cause`: `bun -e ''`, `node -e ''`, `spur task resolve <task-file> --strict --json`, and `superskill hook run sp task-write-guard` fed a `Write` payload. Then apply this decision rule in writing — if bare-shell `bun -e ''` is under 150 ms the cold-start figure is a sandbox artifact and R2 stands on spawn-count grounds alone (drop any runtime-swap framing and say so); if it stays above 500 ms the cold-start tax is real and R2 is urgent.

R2. **`task-write-guard` must not spawn `spur task resolve` for paths that cannot be task files.** `runSpTaskWriteGuard` currently delegates _every_ `Write`/`Edit` with a non-empty `file_path` straight to a 2.4 s `spawnSync` (`hook-run.ts:143` → `resolveSpurTaskOwnership`, `hook-run.ts:101-113`). Editing `src/foo.ts`, `package.json`, or a scratch file pays the same toll as editing a real task file. Add a cheap in-process prefilter **before** the spawn: allow immediately unless the path could plausibly be a task-corpus file. Ownership semantics must not change — `spur task resolve` stays the sole authority for any path that survives the prefilter, and the guard stays fail-open. **Cross-repo:** this code lives in `~/xprojects/superskill`, not in this monorepo; see `### Design` for the split and the sequencing constraint.

R3. **`session_start` must be idempotent per real host session.** `recordSessionStart` (`plugins/sp/hooks/context-session-start.ts:37-60`) unconditionally mints a new `session-YYYY-MM-DD-HHMM` id and appends `session_start`, so every nested `agent.run` subprocess that fires `SessionStart` registers as a fresh session and clobbers the `.spur/context/.session.json` pointer that `context-post-tool` reads. Ledger evidence: 332 `session_start` against 157 `session_end` (a 2:1 imbalance no real session pattern produces), 298 distinct session ids, and 39 `session_start` on 2026-07-30/31 for a handful of actual sessions. A nested run must reuse the ancestor session id; a genuinely new host session must still open a new one.

R4. **Raise `stepTimeoutMs` to match the observed agentic-step ceiling.** `config/workflows/task-pipeline.yaml:52` sets `stepTimeoutMs: "600000"` (10 min), consumed by `test` (:122), `review` (:138), and `verify` (:166). Three of the four H6 timeouts were `test` steps hitting exactly this wall. The `implement` step already carries a 30 min budget (`implementTimeoutMs`, :58) precisely because 600 s failed 100% of the time across bugs 742/744/746/748 — the same evidence now exists for `test`. Raise to 1800000 and carry an equivalent honesty comment: this is headroom, not a licence to let steps run unbounded, and if 30 min also proves insufficient the correct response is to STOP and record it rather than raise again without sign-off. Apply to **both** copies (`config/workflows/` and `apps/cli/config/workflows/`) — they already differ, so patch the var in each rather than copying one over the other.

R5. **Document the timeout-recovery runbook.** Force-done with provenance override is the de-facto recovery for a killed `agent.run` — used for all six H6 tasks — but it exists only as tribal knowledge and it bypasses the verify FSM. Add a section to `plugins/sp/skills/spur-dev/references/done-housekeeping.md` covering: recognising a timeout (`.spur/run/<runId>-<step>-partial.md`, `exited with code 3`), establishing green manually (`bun run lint` + `bun test`), the exact override invocation (`SPUR_PROVENANCE_OVERRIDE=1 spur task update <wbs> done --force-done --reason "…"`), the mandatory `spur task verdict <wbs> --from-answer` follow-up, and the honesty rule that the recorded reason must name the timeout and the manual evidence.

R6. **`normalizeEvidenceType` must accept documentation aliases and stop dropping rows silently.** `packages/app/src/services/task-verdict.ts:187-196` returns `null` for anything outside its six literals, and the caller (:169) then skips the row with no diagnostic — the operator authored `doc`, saw an empty AC list with no explanation, and had to read the parser source to learn the vocabulary. Map `doc` / `docs` / `documentation` → `static-ref`, and surface unrecognised values instead of discarding them in silence.

R7. **Bracket tags must not break scenario-to-AC matching.** `requiresExecutableEvidence` (`task-verdict.ts:212-219`) demotes a `MET` row to `PARTIAL` unless the id carries `[doc-only]` / `[docs-only]` / `[non-behavior]` / `[advisory]` / `[non-core]` — so a documentation scenario _must_ be tagged to keep `MET` with static evidence. But `rowMatchesScenario` (`packages/app/src/services/feature-check.ts:640-648`) compares via `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:30-38`), which strips only a leading `R\d+` prefix — a bracket tag survives normalization and the id no longer equals the scenario title. The two rules are in direct contradiction: tag the row and lose the linkage, or keep the linkage and lose `MET`. That contradiction is what forced test/command evidence onto pure-documentation scenarios and blocked `spur feature advance H6 --to done --strict` until every AC was rewritten. Strip bracket tags in the matching path so a tagged row matches its untagged scenario title. The tag must remain visible in the authored id (`requiresExecutableEvidence` reads it) — the fix belongs in matching, not in authoring.

R8. **Document the linkage contract.** Add a section to `plugins/sp/skills/spur-dev/references/ac-style-guide.md` stating, with a worked example: the four accepted id forms (exact title, `Scenario: <title>`, the `AC-N` alias, or any of these plus a bracket tag), the evidence-type vocabulary including the R6 aliases, which tags exempt a row from executable evidence, and that `spur feature advance --strict` requires a `done` task with a `PASS` verdict carrying a `MET` row matching the scenario.

### Acceptance Criteria

Scenario-to-requirement map: baseline→R1 · guard-skip/deny/fail-open→R2 · session→R3 ·
timeout→R4 · runbook→R5 · evidence-alias→R6 · tag-matching→R7 · contract→R8 · gate→all.

```gherkin
Feature: H6 dogfood defect repairs

  Scenario: Hook latency baseline is recorded from a bare shell
    Given the four R1 commands are run on a bare shell with no agent harness and no sandbox
    When three consecutive timings of each are collected
    Then the median wall time of each is written into Root Cause with the shell and host named
    And the R1 decision rule is applied in writing, stating whether the bun cold-start cost is
        real or a sandbox artifact

  Scenario: Write-guard skips the ownership spawn for non-corpus paths
    Given a PreToolUse payload for Write whose file_path cannot be a task file
    When the sp task-write-guard runs
    Then the decision is allow
    And spur task resolve is never spawned

  Scenario: Write-guard still denies raw writes to a real task file
    Given a PreToolUse payload for Write targeting an existing task-corpus file
    When the sp task-write-guard runs
    Then spur task resolve is consulted
    And the decision is deny carrying the edit-through-the-spur-CLI reason

  Scenario: Write-guard fails open when ownership cannot be determined
    Given a PreToolUse payload whose path survives the prefilter
    And spur task resolve errors, times out, or is absent from PATH
    When the sp task-write-guard runs
    Then the decision is allow

  Scenario: A nested agent subprocess reuses the ancestor session id
    Given .spur/context/.session.json names an active session
    When SessionStart fires again from a nested agent.run subprocess of that session
    Then no additional session_start line is appended to token-ledger.jsonl
    And .spur/context/.session.json still names the original session id

  Scenario: A genuinely new host session still opens a new session
    Given no active session is recorded for the current host session
    When SessionStart fires
    Then exactly one session_start line is appended
    And .spur/context/.session.json names the new session id

  Scenario: The pipeline test step gets a thirty minute budget
    Given both copies of task-pipeline.yaml
    When stepTimeoutMs is read from each
    Then both resolve to 1800000
    And spur workflow validate passes against both copies

  Scenario: The timeout-recovery runbook is discoverable from done-housekeeping
    Given an operator whose agent.run step was killed at the timeout wall
    When they open plugins/sp/skills/spur-dev/references/done-housekeeping.md
    Then they find the partial-handoff recognition signal, the manual green-gate commands, the
        exact force-done invocation with provenance override, the required verdict follow-up,
        and the recorded-reason honesty rule

  Scenario: Documentation evidence types parse instead of vanishing
    Given a verify-answer AC table whose evidence-type cell reads doc
    When spur task verdict is run with --from-answer
    Then the row appears in the verdict artifact with evidenceType static-ref
    And no row is discarded without a diagnostic naming the unrecognised value

  Scenario: A bracket-tagged AC row matches its untagged scenario title
    Given a feature scenario titled "R3 — Batch report names every skipped task"
    And a done task whose PASS verdict carries a MET row with id
        "[doc-only] R3 — Batch report names every skipped task"
    When spur feature check runs with --strict
    Then the scenario is verified
    And spur feature advance to done with --strict is not blocked by it

  Scenario: Tagging still exempts a row from executable evidence
    Given a MET verdict row tagged doc-only whose evidenceType is static-ref
    When the executable-evidence rule is applied
    Then the row status remains MET
    And an untagged MET row with static-ref evidence is still demoted to PARTIAL

  Scenario: The linkage contract is written down
    Given an operator authoring a verify-answer AC table for a documentation scenario
    When they read plugins/sp/skills/spur-dev/references/ac-style-guide.md
    Then they find the four accepted id forms, the evidence-type vocabulary including the new
        aliases, the tags that exempt a row from executable evidence, and the strict-advance
        precondition, with a worked example

  Scenario: No regression in the existing gate suites
    Given the full repository verification gate
    When lint, test, and build are run
    Then all three pass with no skipped tests introduced to reach green
```

### Q&A

**Q: Why one task instead of eight?**
The operator asked for a single consolidated fix task from the two H6 post-mortems. The three
clusters are independent enough to split later if the batch driver wants finer granularity, but
they share one root document set and one verification pass. Split only if cluster A's cross-repo
sequencing turns out to block the others.

**Q: R2 lives in another repository — is that in scope?**
Yes, deliberately. It is the largest measured win and dropping it would leave the headline defect
unfixed. It is flagged in `### Requirements` and `### Design` so the implementer knows the diff
lands in `~/xprojects/superskill` and that verification requires a rebuild + re-link, not just a
green test. If the operator wants the superskill change tracked separately, split R2 out — the
rest of this task stands on its own.

**Q: Should `spur` and `superskill` startup themselves be optimised?**
Not here. R1 will say whether the ~1.2–2.4 s figures survive outside the sandbox. If they do, that
is a bundling/startup investigation across both CLIs and deserves its own task with profiling
evidence — not a speculative fix appended to this one.

**Q: Is the `[doc-only]` tag vocabulary itself right?**
Out of scope. R7 removes the contradiction between the two existing rules; whether the five tags
should be three, or a frontmatter field instead of an id substring, is a separate design question.
Do not redesign the tag surface while fixing the matcher.

**Q: What about replacing `omp` as the pipeline executor?**
Deferred, and recorded as rejected in `### Design`. R4 raises the budget first; if steps still hit
the 30 min wall, that is the data that would justify an ADR on executor choice. Raising the
timeout twice without that data is the thing the existing `implementTimeoutMs` comment explicitly
warns against.

**Q: The source reports disagree with this task's numbers. Which is authoritative?**
This task. The report figures were estimates written during the run; every number here was
re-measured against the same artifacts before the task was authored, and the deltas are tabulated
in `### Background`. The reports remain useful for narrative and for the timeout timeline, which
this task does not dispute.

### Design

#### Repository split — read this before starting

R2 is the largest single win and it is **not in this repo**:

| Requirement              | Repo                     | Path                                                                                  |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| R2 write-guard prefilter | `~/xprojects/superskill` | `apps/cli/src/commands/hook-run.ts:101-154`                                           |
| R3 session idempotency   | this monorepo            | `plugins/sp/hooks/context-session-start.ts`                                           |
| R4 timeout               | this monorepo            | `config/workflows/task-pipeline.yaml`, `apps/cli/config/workflows/task-pipeline.yaml` |
| R5, R8 docs              | this monorepo            | `plugins/sp/skills/spur-dev/references/`                                              |
| R6, R7 parser/matching   | this monorepo            | `packages/app/src/services/`, `packages/domain/src/bdd/`                              |

Land the in-repo work first; it is self-contained and gate-verifiable here. R2 lands in the
superskill repo and only takes effect after `superskill` is rebuilt and re-linked — verify it by
re-running the R1 write-guard timing, not by reading the diff.

#### Note on `plugins/sp/hooks/*.ts` vs. the installed hook path

`hooks.json` wires every hook to `superskill hook run sp <id>`, and superskill's dispatcher table
(`hook-run.ts:422-423`) resolves `sp/context-post-tool` and `sp/context-session-start` to
**runners implemented inside superskill**, not to the `.ts` files in `plugins/sp/hooks/`. Confirm
which copy actually executes before editing for R3 — a fix applied only to the plugin file may be
dead code at runtime. If the logic is genuinely duplicated across the two repos, say so in
`### Root Cause`; deduplicating it is a follow-up, not this task.

#### R2 prefilter shape

Keep it dumb and in-process. `spur task resolve` remains the only ownership authority; the
prefilter's sole job is to answer "could this path possibly be a task file?" without a subprocess.
A path-segment check against the task-corpus folder convention (`docs/tasks`, `docs/tasks2`,
`docs/tasks3`, … plus a `tasks/` flat layout) plus a `.md` extension check covers the corpus this
harness actually creates. Two constraints:

- **Fail toward the spawn.** When the prefilter is unsure, spawn and let `resolve` decide. A false
  skip silently disables the write guard; a false spawn only costs latency.
- **No new config surface.** Do not add a settings key for the folder list — the convention is
  already fixed by `defaultVerdictRunDir` (`feature-check.ts:629-637`), which encodes the same
  `docs/tasks\d*` / flat-`tasks` layout pair. Reuse that shape.

#### R3 idempotency signal

Preference order:

1. **Ancestor-session env var** — if the pipeline's `agent.run` spawn already propagates a session
   marker to the child environment, read it and skip. Cleanest; no state, no races. Check what
   `agent.run` actually exports before assuming.
2. **`.session.json` recency gate** — if no env marker exists, treat an existing `.session.json`
   whose `started` is within a short window as the active session and reuse its id.

Option 2 is a heuristic and will occasionally merge two genuinely distinct back-to-back sessions.
That is acceptable — the ledger is an advisory token-accounting aid, not an audit log — but mark
it with a `ponytail:` comment naming the ceiling if option 2 is what ships. Keep the fail-open
contract: any error path exits 0 silently.

#### R7 matching fix location

Strip bracket tags in the **matching** path, not in `normalizeTitle` itself — `normalizeTitle` is
shared by `checkAcCoverage` (`packages/domain/src/bdd/coverage.ts`) and by task-side coverage
(`task-check.ts:951`), and changing it moves behavior for callers this task did not audit. Confirm
whether those callers _want_ the same tag-stripping (they probably do — the same `[doc-only]` id
flows through coverage matching) and, if so, fix it once in the shared helper and note the
widened blast radius in `### Solution`. One guard in the shared function beats a guard in every
caller; just verify the callers first.

#### Rejected

- **Tighten the `PostToolUse` matcher / drop `Read`** (findissue fix 1b). The ledger shows 7 writes
  and 15 reads across the entire H6 window — PostToolUse was not the cost. Dropping `Read` would
  degrade the token ledger to fix a problem that is not there.
- **Match scenarios on a generated id instead of the title** (dogfood P3 suggestion). That is a
  breaking change to the traceability key, and `ac-style-guide.md` already declares the title the
  identity key. R7 removes the actual contradiction without touching the contract.
- **Replace `omp` as the default pipeline executor** (findissue 2e). Strategic, not a defect fix.
  Worth an ADR once R4's raised budget has produced data on whether the timeouts were `omp`
  spawn latency or genuine step length. Out of scope here.
- **Swapping hook shebangs to `node`.** The hooks use `Bun.stdin.text()` and `import.meta.main`,
  and the runtime path actually executing them is superskill's own bundle — a shebang change is
  both insufficient and aimed at the wrong process. Revisit only if R1 proves bun cold start is
  real outside the sandbox, and then as a superskill-side decision.

### Plan

Ordered. Cluster A gates on step 1; clusters B and C are independent — run them in any order, or
in parallel if fanning out.

#### Step 0 — Baseline (blocks everything in cluster A)

- [ ] Run the four R1 command groups on a bare shell (no agent, no sandbox); record medians.
- [ ] Apply the R1 decision rule in writing; paste the numbers into `### Root Cause`.
- [ ] Confirm whether `superskill hook run sp context-session-start` executes superskill's own
      runner or `plugins/sp/hooks/context-session-start.ts`. This decides where R3 lands.

#### Cluster B — pipeline timeouts (smallest diff, land first)

- [ ] `config/workflows/task-pipeline.yaml:52` — `stepTimeoutMs: "600000"` → `"1800000"`; extend the
      comment above it with the H6 evidence (3 of 4 timeouts were `test` at the 600 s wall) and the
      STOP-don't-raise-again rule mirroring the `implementTimeoutMs` comment at :53-57.
- [ ] Apply the same change to `apps/cli/config/workflows/task-pipeline.yaml`. The two copies
      already differ — patch the var in place, do not overwrite one with the other.
- [ ] `spur workflow validate task-pipeline.yaml` against both copies.
- [ ] Append the recovery runbook section to
      `plugins/sp/skills/spur-dev/references/done-housekeeping.md` (R5). Content list is in R5;
      keep it to one `##` section, matching the existing `F1`–`F5` house style.

#### Cluster C — verdict parser and linkage

- [ ] `packages/app/src/services/task-verdict.ts:187-196` — add `doc` / `docs` / `documentation`
      → `static-ref` to `normalizeEvidenceType`.
- [ ] Same file, caller at :164-172 — stop discarding unparseable rows silently; surface the
      unrecognised evidence-type value. Match how the service already reports parse problems; do
      not introduce a raw `console.*` if a logger is in scope.
- [ ] Audit the three `normalizeTitle` call sites (`feature-check.ts:640-648`,
      `packages/domain/src/bdd/coverage.ts`, `task-check.ts:951`) and decide shared-helper vs.
      matching-path-only per `### Design`. Implement the tag strip.
- [ ] Unit tests: `[doc-only] R3 — <title>` matches scenario `R3 — <title>`; untagged `static-ref`
      MET still demotes to PARTIAL; tagged `static-ref` MET stays MET; `doc` parses to
      `static-ref`; an unrecognised value produces a diagnostic rather than a silent drop.
- [ ] Append the linkage-contract section to
      `plugins/sp/skills/spur-dev/references/ac-style-guide.md` (R8), next to the existing
      "Scenario-title stability" section.

#### Cluster A — hook latency

- [ ] R3 session idempotency, in whichever copy step 0 identified. Tests alongside
      `plugins/sp/hooks/context-hooks.test.ts`: nested fire appends nothing and preserves the id;
      fresh fire appends exactly one line.
- [ ] R2 in `~/xprojects/superskill`: prefilter in `runSpTaskWriteGuard` before the
      `resolveTaskOwnership` call at `hook-run.ts:143`. Tests in that repo alongside the existing
      write-guard tests — cover skip-without-spawn, deny-on-real-task-file, and fail-open.
- [ ] Rebuild and re-link `superskill`, then re-run the R1 write-guard timing to prove the tax is
      gone. A passing unit test is not evidence for R2; the timing is.

#### Close-out

- [ ] `bun run autofix && bun run spur-check`
- [ ] `bun run lint` · `bun run test` · `bun run test-cf` · `bun run build`. Establish the
      environmental baseline first — as of 2026-07-31 the sandbox yields 4104 pass / 24 fail (all
      port-bind / `ps` denials) and `test-cf` cannot run at all. Real regressions are ADDITIONAL
      failures; bucket the `^error:` line above each `(fail)` to triage.
- [x] Append a correction note to `docs/dogfood/2026-07-31-sp-dev-runall-H6-dogfood.md` — **done
      2026-07-31** (§7). Note that path is gitignored (`.gitignore:170`), so the committed record
      of those corrections is this task's `### Background` / `### Root Cause`, not the report.
- [ ] Add an AC-coverage assertion so the RC-3 shortfall cannot recur silently: a task whose
      verdict omits declared scenarios should be visible at `spur task check` or verifyall time
      rather than passing on requirement rows alone. Scope this with R6/R7 — it is the same defect
      surface, and the 0395 empty-`acceptanceCriteria` PASS is the case to regression-test.
- [ ] `spur task verdict 0398 --from-answer`; then `spur task check 0398`.

### Root Cause

Three independent root causes. Confidence is stated per cause; the timing figures carry the
sandbox caveat until R1 clears it.

#### RC-1 — The write guard buys a 2.4 s subprocess on every file mutation (HIGH, new)

`runSpTaskWriteGuard` (`~/xprojects/superskill/apps/cli/src/commands/hook-run.ts:121-154`) allows
early only on three conditions: `SPUR_WRITE_GUARD=off` (:126), unparseable payload (:132), and a
tool other than `Write`/`Edit` or an empty path (:136-139). Every other call reaches
`resolveTaskOwnership` at :143, which `spawnSync`s `spur task resolve --strict --json`
(:101-113, 8 s timeout).

Measured (sandbox, medians of 3):

| Command                                     | Wall        |
| ------------------------------------------- | ----------- |
| `spur task resolve … --strict --json`       | **2.40 s**  |
| `superskill hook run sp context-post-tool`  | **1.22 s**  |
| `superskill --version`                      | 1.35 s      |
| `bun plugins/sp/hooks/context-post-tool.ts` | 1.22 s      |
| `bun -e ''`                                 | 1.41–2.00 s |
| `node -e ''`                                | **0.02 s**  |

Two readings follow. First, the guard's own dispatch is not the cost — `bun -e ''` alone accounts
for essentially all of `superskill hook run`'s 1.22 s (user CPU was 0.06–0.14 s against 1.2 s wall;
the process is not computing, it is starting). Second, and independent of whether that cold start
is a sandbox artifact, the guard performs **one wholly avoidable subprocess spawn per Write/Edit**
for paths that could never be task files. Editing `src/foo.ts` consults the task corpus. That is
the defect; the cold-start figure only sets its price.

Combined per Write/Edit: ~3.7 s. Neither source report identified this path.

#### RC-2 — `SessionStart` has no idempotency guard (HIGH)

`recordSessionStart` (`plugins/sp/hooks/context-session-start.ts:37-60`) mints
`session-<date>-<HHMM>` from the wall clock and writes `.session.json` + a `session_start` line
with no check for an in-flight session. Any nested process that fires `SessionStart` — which every
pipeline `agent.run` subprocess does — registers as a new session and overwrites the pointer file
that `context-post-tool` reads.

Ledger evidence (`.spur/context/token-ledger.jsonl`, 1353 lines, 2026-07-13 → 2026-07-31):

|                                              | Count  |
| -------------------------------------------- | ------ |
| `session_start`                              | 332    |
| `session_end`                                | 157    |
| distinct session ids                         | 298    |
| `session_start` on 2026-07-30/31 (H6 window) | 39     |
| `read` + `write` on 2026-07-30/31            | 15 + 7 |

The 2:1 start:end ratio is the signature: nested starts fire, nested ends do not pair with them.
Note the last row — PostToolUse recorded 22 events across the entire H6 window. The findissue
report's "542 writes / 322 reads" are 18-day totals; there was no PostToolUse storm during H6, and
the proposed matcher-tightening fix would have optimised a non-problem while degrading the ledger.

#### RC-3 — Two verdict rules contradict each other on tagged AC rows (HIGH)

For a documentation scenario the operator must satisfy both of these, and cannot:

- `requiresExecutableEvidence` (`packages/app/src/services/task-verdict.ts:212-219`) demotes a
  `MET` row to `PARTIAL` unless the **id contains** `[doc-only]`, `[docs-only]`, `[non-behavior]`,
  `[advisory]`, or `[non-core]`. So the tag must be in the id.
- `rowMatchesScenario` (`packages/app/src/services/feature-check.ts:640-648`) matches via
  `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:30-38`), which lowercases, collapses
  whitespace, strips quotes, and strips a leading `R\d+` prefix — **but not bracket tags**. Its
  `Scenario:` strip is anchored (`/^Scenario:\s*/i`), so `[doc-only] Scenario: X` fails that path
  too. So the tag must not be in the id.

Tag it and `isScenarioVerified` (:570-585) never finds a matching row → `L4.scenario-unverified` →
`spur feature advance H6 --to done --strict` blocked. Untag it and the row drops to `PARTIAL` →
also unverified. The only escape is fabricating test/command evidence for a documentation
scenario, which is what H6 ended up doing across three regeneration cycles.

Compounding it: `normalizeEvidenceType` (`task-verdict.ts:187-196`) returns `null` for `doc`, and
the caller (:169) drops the row on a `null` with no diagnostic. The operator saw zero AC entries
and no error, and had to read the parser source to learn the vocabulary.

**Reproduced 2026-07-31** during the `/sp:dev-verifyall --feature H6 --fix all` pass that followed
this task's authoring — RC-3 is no longer an inference from code reading. Authoring two ADR-backed
scenarios on task 0396 with the honest `static-ref` evidence type demoted both to `PARTIAL` via
`applyAcceptanceCriteriaEvidenceRule`, dropping 0396's verdict from PASS to PARTIAL. The documented
escape (`[doc-only]`) was **unavailable for one of them**: "The CLI-to-skill coupling is recorded as
a decision" is itself an H6 feature scenario
(`docs/features/H6_sp-plugin-role-rescope-*.md:132`), so tagging it would have broken
`rowMatchesScenario` and failed the shippable gate. Both branches of the contradiction were hit in
a single row. The only way through was re-typing the evidence as `command`, citing the `grep` that
verifies the ADR text — which works only because ADR content happens to be greppable. A scenario
whose evidence is genuinely static (a design rationale, a diagram, a prose contract) has no escape
at all.

**Consequence measured on the H6 corpus.** Because the contradiction forces evidence rewriting, the
H6 force-done recovery authored only the AC rows needed to clear `spur feature check` — which
requires one matching MET row per _feature_ scenario, not per _task_ scenario. Result: **23 of 48
declared task scenarios (52%) had no verdict AC row at all**, and `0395-verdict.json` carried an
empty `acceptanceCriteria` array while still reading PASS on requirement rows alone. Nothing in the
gate chain flagged this — `spur task check` passed on all nine, and `spur feature check H6 --strict`
passed. The verifyall pass restored 48/48 with command/test evidence. Any fix to R6/R7 must keep
per-task AC coverage observable, or the same silent shortfall recurs on the next force-done batch.

#### Not a root cause

The ~20 h wall-clock is **not** explained by hook latency. Four `agent.run` timeouts discarded
~80 min of work and forced manual recovery; the rest is operator-idle time between resumptions of
an unattended overnight batch. RC-1 and RC-2 are steady-state taxes on every future session, worth
fixing on their own merits — but do not expect R2/R3 to move a 20 h batch to 2 h. R4 is the
requirement that addresses the wall-clock.

### Solution

**6 of 8 requirements implemented. R1 and R2 are blocked by the execution environment, not by the
work** — see "Not implemented" below. Nothing was partially landed: each requirement below is
complete with tests.

#### R4 — pipeline timeout budget

- `config/workflows/task-pipeline.yaml:52` and `apps/cli/config/workflows/task-pipeline.yaml:43` —
  `stepTimeoutMs` `"600000"` → `"1800000"`, each patched in place (the two copies differ; neither
  was overwritten with the other). Comment records the H6 evidence (3 of 4 timeouts were `test`
  steps at the 600 s wall) and carries the same STOP-don't-raise-again rule as `implementTimeoutMs`.
- Consumed by `test` (:122), `review` (:138), `verify` (:166). `spur workflow validate` passes on
  both copies.

#### R5 — timeout-recovery runbook

- `plugins/sp/skills/spur-dev/references/done-housekeeping.md` — new `## F6 - Recovering from a
pipeline agent.run timeout`, placed before the terminal-gate checklist and matching the F1-F5
  house style. Five numbered steps: recognise (`*-partial.md`, `exited with code 3`), establish
  green by hand, finish the abandoned sections (incl. the L3 `review-priority-table` gate), the
  exact `SPUR_PROVENANCE_OVERRIDE=1 … --force-done --reason` invocation, and the mandatory
  `spur task verdict --from-answer` follow-up. Closes with an invariant.

#### R6 — evidence-type vocabulary + no silent drops

- `packages/app/src/services/task-verdict.ts:187-207` — `normalizeEvidenceType` maps
  `doc` / `docs` / `documentation` → `static-ref` alongside the existing `static` alias.
- `:138-186` — `extractAcceptanceCriteria` now returns `{ rows, dropped }`; an unparseable row is
  recorded with its id and the offending value instead of vanishing.
- `:43-46` + `:222-240` — `deriveVerdict` threads `dropped` into `extractChecks`, which emits an
  `ac-row-dropped` check (status `fail`) naming every dropped row and listing the accepted
  vocabulary. Reuses the existing `checks[]` diagnostic channel (where `evidence-rule-pass` /
  `evidence-rule-failed` already live) rather than adding a parallel warnings surface.

#### R7 — bracket tags must not break scenario matching

Root-cause fix in the **shared** helper, not per-caller. All three `normalizeTitle` consumers were
audited first and all three want the same behavior: `feature-check.ts` (scenario verification),
`coverage.ts` `checkAcCoverage` (feature↔task AC subset rule), and `packages/domain/src/bdd/scaffold.ts:46` (generated stub
names — stripping a tag out of a test name is an improvement).

- `packages/domain/src/bdd/coverage.ts` — new `stripScenarioPrefixes` helper, applied at the head of
  `normalizeTitle`. Strips leading bracket tags, a `Scenario:` prefix, and the `R{n}` prefix in a
  fixed-point loop, so the three can appear in any order and any repetition.
- `packages/app/src/services/feature-check.ts:639-659` — `rowMatchesScenario` strips tags on the
  **alias** path too (that path never went through `normalizeTitle`, so `[doc-only] AC-3` would
  otherwise still fail to match `AC-3`).

The evidence rule is deliberately untouched: `requiresExecutableEvidence` still reads the tag from
the id, so tagging still exempts a row. Both halves of the contradiction now hold at once.

#### R3 — SessionStart idempotency

- `plugins/sp/hooks/context-session-start.ts:35-94` — new `resolveActiveSession(dir, now)` and
  `SESSION_REUSE_IDLE_MS` (4 h). `recordSessionStart` early-returns the in-flight session id and
  writes nothing — no ledger row, no pointer rewrite.
- Design option 1 (ancestor-session env var) was investigated and is **unavailable**: nothing in
  `agent.run` / ts-ai-runner propagates a session id into the child environment, and the hook runs
  as a short-lived subprocess whose own pid says nothing about the agent's. Fell back to the
  documented option 2 (recency gate), marked with a `ponytail:` comment naming the ceiling (two
  genuinely distinct sessions inside the window merge) and the upgrade path.
- Fail-open contract preserved: every failure path in `resolveActiveSession` returns null, which
  mints a new session exactly as before.

#### R8 — linkage contract documented

- `plugins/sp/skills/spur-dev/references/ac-style-guide.md` — new `## Verdict AC ↔ feature scenario
linkage` section next to "Scenario-title stability". Covers the table shape, the full evidence-type
  vocabulary incl. the R6 aliases, the four accepted id forms plus bracket tags, the five
  exempting tags with a worked `[doc-only]` example, the three `--strict` advance preconditions, and
  an explicit warning to cover every declared scenario rather than the gate's minimum.

#### A pre-existing test encoded the bug

`plugins/sp/hooks/context-hooks.test.ts:91` was named _"is idempotent across two starts — appends a
second event"_ and asserted that two `SessionStart` fires produce two `session_start` rows. That is
RC-2 written down as intended behavior — the defect shipped with test cover, which is why it
survived. Rewritten to assert one row per session, with a comment recording what it used to claim
and why that was wrong.

#### R1 — baseline re-measured; the cold-start framing was wrong, R2's premise partly with it

Re-measured 2026-07-31 after the upstream releases. Still inside the agent sandbox (re-probed:
`touch ~/xprojects/superskill/.probe` → `Operation not permitted`, `listen 127.0.0.1` → `EPERM`), so
R1's literal "bare shell" condition is **still unmet**. But the decisive comparison no longer needs
one, because both runtimes were measured under identical conditions:

| Command                                       | Wall (n=3 avg) |
| --------------------------------------------- | -------------- |
| `bun -e ''`                                   | **2.29 s**     |
| `node -e ''`                                  | **0.02 s**     |
| `superskill --version`                        | 2.36 s         |
| `spur task resolve <task>.md --strict --json` | 2.39 s         |

`node` is ~115× faster than `bun` **in the same sandbox**, so the cost is not a uniform per-spawn
sandbox tax — it is bun-specific. Applying R1's decision rule (">500 ms → the cold-start tax is
real"): **real, at 2.29 s.** Every `superskill` and `spur` invocation is ~97% runtime startup;
`superskill`'s own code contributes ~0.07 s and `spur task resolve`'s ~0.10 s.

Residual caveat: sandbox amplification cannot be ruled out for bun specifically, only for spawning
in general. The comparison is sound; the absolute 2.29 s may not reproduce on a bare shell.

#### R2 — shipped upstream in superskill 0.3.10, verified here; **the predicted saving was wrong**

`couldBeTaskCorpusPath` is present in the installed bundle
(installed bundle `dist/index.js`, lines 103087-103091) and is called before the
ownership spawn at lines 103107-103109, matching the design exactly. `resolveSpurTaskOwnership` still
spawns (now `await`ed via an executor) for paths that survive it.

**Functional check** — correct in both directions:

- corpus path → `permissionDecision:"deny"` with the spur-CLI reason, exit 0
- non-corpus path → empty output, exit 0

**Timing check (n=5 each, very low variance):**

| Path                                      | Wall                                          |
| ----------------------------------------- | --------------------------------------------- |
| `SPUR_WRITE_GUARD=off` — pure hook floor  | 2.37 s                                        |
| non-corpus — prefilter skips the spawn    | **2.36 s** (indistinguishable from the floor) |
| corpus — still spawns `spur task resolve` | 2.48 s                                        |

The prefilter works perfectly: a skipped path costs exactly the floor. **But the saving is ~0.12 s,
not the ~2.4 s this task predicted.** The 3.7 s figure in `### Background` was derived by _adding_
two independently-measured cold starts (1.3 s + 2.4 s). That addition was wrong: a child process
spawned from an already-running process does not pay a second full cold start here — the measured
marginal cost of the `spur task resolve` spawn is 0.12 s, not 2.39 s.

**Correcting the headline claim of this task:** per-mutation hook cost went from ~2.48 s to ~2.36 s
(≈5%), not from ~3.7 s to ~1.3 s (≈65%). The dominant cost is the hook process's own bun startup
(2.37 s), which the prefilter cannot touch and which no change in either repo addresses. R2 was
still worth doing — it removes a genuinely pointless subprocess and is now free — but it was not the
large win this task claimed, and RC-1's "≈3.7 s per file mutation" should be read as an
over-estimate.

The real lever on hook latency is the 2.29 s bun startup, i.e. runtime choice or a resident hook
process. That is a new, separate problem; do not reopen this task for it.

#### R3 — upgraded to the exact ancestor signal (ts-ai-runner 0.4.15)

The wall-clock heuristic is no longer the primary path. `@gobing-ai/ts-ai-runner@0.4.15` publishes
`AGENT_RUN_ID_ENV = 'SPUR_RUN_ID'` and `AiRunner` forwards it into the agent subprocess whenever the
caller supplies a correlation. Verified that Spur always does: the pipeline's agent.run action
(`packages/app/src/workflow/actions/agent-run.ts:148-152`) and `spur agent run`
(`packages/app/src/services/agent-service.ts:661`) both pass `{ runId, executionId, actionId }`.
execa's `extendEnv` default propagates it transitively, so every descendant of a run — including the
hook subprocesses the host fires inside it — inherits it.

`resolveActiveSession` (`plugins/sp/hooks/context-session-start.ts`) now resolves in precedence
order:

1. **`SPUR_RUN_ID` present** → definitively a descendant of an agent run. Reuse the recorded session
   with **no time bound**. A pipeline step legitimately runs for the full `implementTimeoutMs`
   (30 min) and batches run for hours, so any wall-clock window would eventually split a run that is
   provably still in flight. This is the path the H6 defect actually took.
2. **No marker** → the `SESSION_REUSE_IDLE_MS` window, unchanged.

The signature is now `resolveActiveSession(dir, now, env = process.env)`, and `recordSessionStart`
threads its own `env` through, so the marker is injectable rather than read from the ambient
process.

**`SESSION_REUSE_IDLE_MS` was kept, deviating from this task's Plan**, which called its deletion the
acceptance signal. Reason: the marker is only set on _correlated_ paths. Deleting the fallback would
regress every nesting path that arrives without a correlation (a host spawning its own helpers, or
an `agent.run` invoked without one) straight back to the original bug, and the set of hosts —
Claude Code, Codex, pi, omp, Gemini, OpenCode, Antigravity — is not enumerable from here. The
constant's doc comment now scopes it explicitly as a residual backstop and states the condition for
deleting it: once every nesting path is known to carry a correlation.

The env var name is a string literal, not an import: this hook is self-contained by design (tasks
0232/0246) and runs both standalone and from Superskill's bundled runner, so it must not depend on
the workspace module graph. The literal is a published contract on the ts-ai-runner side.

#### Addendum — R1's conclusion refined after direct testing (2026-08-01)

The R1 entry above concluded "the cold-start tax is real, at 2.29 s" from the bun-vs-node
differential. A follow-up experiment shows that was **overstated**, and also confirms the
explanation R2 offered for its own small saving. Four chains, n=3 each:

| Chain                      | Wall                                           |
| -------------------------- | ---------------------------------------------- |
| shell → `node -e ''`       | 0.03 s                                         |
| shell → `bun -e ''`        | 2.29 s                                         |
| `node` → spawn `bun -e ''` | 2.31 s (fresh bun exec pays full price)        |
| `bun` → spawn `bun -e ''`  | 2.31 s **total** — the inner bun costs ≈0.01 s |

Two conclusions, both now tested rather than inferred:

1. **The penalty attaches to exec'ing the `bun` binary, and warms per process tree.** A bun exec'd
   by an already-running bun is essentially free; one exec'd by `node`, or from the shell, pays the
   full ~2.28 s. This _confirms_ the explanation offered for R2's 0.12 s marginal spawn cost — the
   hook pays the cold exec, and the `spur task resolve` child it spawns does not. That explanation
   was previously an untested inference; it is now measured.
2. **Whether the ~2.28 s survives outside the sandbox is UNVERIFIED.** `node` execs in 0.03 s in the
   same sandbox, so this is not a uniform exec tax — but a binary-specific penalty is exactly the
   shape a sandbox signature/validation check would produce, and typical unsandboxed bun startup is
   an order of magnitude smaller. R1's decision rule was applied to a number that may be a sandbox
   artifact after all.

**Corrected R1 verdict:** the tax is real _in this environment_ and is bun-binary-specific; the
claim that it is real _generally_ is not established and should not be cited as such. The one
measurement that does transfer is the marginal one: the spawn R2 avoids costs 0.12 s here, and
would cost less on a box where bun execs quickly — so R2's absolute saving is a ceiling, not a
floor. This does not change any requirement's status; it narrows what R1's number licenses.

### Testing

43 tests added across 4 files over the task's life. Suite **4104 → 4147 pass**, failure set
byte-identical to the pre-task baseline throughout.

#### Gate output (2026-07-31, against ts-libs 0.4.15 + superskill 0.3.10)

```
bun run lint          → exit 0 (biome clean; all 6 workspaces typecheck exit 0)
bun run build         → exit 0
bun run test          → 4147 pass / 24 fail / 4171 across 242 files
bun test plugins/sp   → 484 pass / 0 fail   (465 → 477 → 484 across the task)
spur workflow validate config/workflows/task-pipeline.yaml          → workflow valid
spur workflow validate apps/cli/config/workflows/task-pipeline.yaml → workflow valid
```

**The 24 failures are environmental, not regressions.** Identical test names and suites before and
after every change in this task: `spur projects CLI` (4), `startServer` (3), `createServerContext`
(1), `healthModule` (3), `rpc client` (2), `project-start` (7), `ProjectRegistry` (4). All are
port-bind / `ps` denials under the agent sandbox — re-probed this session (`listen 127.0.0.1` →
`EPERM`). The 2 `expect()` failures inside `serve.test.ts` are downstream of the same denial (those
tests bind literal ports 4000/5000/5001/5556, so the shutdown-ordering array never fills). Delta
attributable to this task: **+43 pass, +0 fail**. `bun run test-cf` still cannot run in-sandbox
(`EPERM` on `listen` in the Vitest pool) and was not run.

#### R3 exact-signal — `plugins/sp/hooks/context-hooks.test.ts` (+7, 38 pass in file)

Marker set → session reused even at 10× the idle window (proves the time bound is bypassed, not
merely satisfied). Marker absent → the same ancient session is retired by the window (proves the
fallback still works and the first test is not vacuous). Marker set with `started` missing or
unparseable → still reused. Empty and whitespace-only marker values → treated as absent and fall
through to the window. Marker set with no pointer file → still null, so the marker can never
fabricate a session. Plus a contract pin asserting the literal equals `SPUR_RUN_ID`, which fails
loudly if ts-ai-runner ever renames it.

#### R3 original — same file (12 tests)

End-to-end via real hook subprocesses: three consecutive `SessionStart` fires append exactly one
`session_start` and leave `.session.json` naming the original id; a fire after the pointer is
removed opens a new session; `start → stop → start` yields 2 starts / 1 end. Unit coverage of
`resolveActiveSession`: recent reuse, past-window null, clock-skew null, five malformed-pointer
shapes, missing pointer. Every null path mints a new session, preserving the fail-open contract.

#### R7 — `packages/domain/tests/bdd/coverage.test.ts` (7) + `feature-check.test.ts` (8)

Tag stripping at the shared helper across all four orderings and all five tag spellings, a mid-title
`[bracket]` left intact, and a tag-only title terminating rather than looping. End-to-end through
the real `FeatureCheckService`: seven tagged id forms verify the untagged scenario with zero
`L4.scenario-unverified`, plus an over-match guard proving `[doc-only] beta` still does _not_ verify
scenario `alpha`.

#### R6 — `packages/app/tests/services/task-verdict.test.ts` (9)

Five evidence-type aliases normalize to `static-ref` at MET; `vibes` emits an `ac-row-dropped` check
naming the row, the value, and the vocabulary; an unrecognised status is reported the same way; a
clean table emits no such check; an _untagged_ `static-ref` MET row is still demoted to PARTIAL,
proving the evidence rule survived R7.

#### R2 — verified by measurement, upstream

Owned by superskill 0.3.10; its suite (43 pass in `hook-run.test.ts`, 778 vs 765 baseline) ran there
during authoring. Verified _here_ by behavior (deny/allow both correct) and by timing (n=5 per path,
floor 2.37 s / skip 2.36 s / spawn 2.48 s). See `### Solution` — the timing also **falsified this
task's predicted saving**, which is recorded rather than quietly dropped.

#### Not covered

R1 has no test: it is a measurement, and its literal bare-shell precondition remains unmet inside
the sandbox. The `node` vs `bun` differential recorded in `### Solution` answers its decision rule
without one.

### Review

Self-review across the whole task, re-run after the ts-libs 0.4.15 / superskill 0.3.10 releases
closed the two upstream blockers. Dimensions: functional traceability, SECUA, architecture.

| Priority | Finding                                                                                                                                                                                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | **This task's headline cost claim was wrong and is now measured.** `### Background` and RC-1 assert ~3.7 s per file mutation, derived by adding two independently-measured cold starts (1.3 s + 2.4 s). Measured reality with the fix installed: floor 2.37 s, prefilter-skip 2.36 s, spawn path 2.48 s — the avoided spawn is worth **0.12 s, not 2.4 s**. The real saving is ≈5%, not ≈65%. | **Corrected in `### Solution`, not quietly dropped.** R2 remains correct work (a pointless subprocess is gone) but was mis-sized. The dominant cost is the hook's own 2.29 s bun startup, which nothing in either repo addresses. Flagged as a new, separate problem — deliberately not reopened here.                                                                                                                                     |
| P1       | **R1's literal precondition is still unmet.** No bare shell available; the sandbox persists (re-probed this session).                                                                                                                                                                                                                                                                         | **Answered by a different route, stated as such.** `node -e ''` at 0.02 s vs `bun -e ''` at 2.29 s _in the same sandbox_ shows the cost is bun-specific rather than a uniform spawn tax, which is what R1's decision rule needed. Residual: sandbox amplification of bun specifically cannot be excluded.                                                                                                                                  |
| P2       | **R3 keeps `SESSION_REUSE_IDLE_MS`, deviating from this task's own Plan**, which named its deletion the acceptance signal.                                                                                                                                                                                                                                                                    | **Deliberate, justified in `### Solution`.** The marker only exists on correlated paths; deleting the fallback regresses every uncorrelated nesting path to the original bug, across a host set (Claude Code, Codex, pi, omp, Gemini, OpenCode, Antigravity) not enumerable from here. The constant is now scoped in-source as a residual backstop with an explicit deletion condition. Reviewer should confirm they accept the deviation. |
| P2       | **A pre-existing test encoded the defect.** `plugins/sp/hooks/context-hooks.test.ts:91` asserted two `SessionStart` fires produce two `session_start` rows, under the name "is idempotent".                                                                                                                                                                                                   | **Fixed**, with a comment recording the superseded claim. Lesson worth keeping: a test asserting _current_ behavior is not a test asserting _intended_ behavior.                                                                                                                                                                                                                                                                           |
| P3       | **`context-session-stop` remains the unfixed symmetric half.** A nested `SessionEnd` still appends `session_end` and deletes `.session.json`, retiring a session its parent is still using — and it now has an exact signal available to prevent exactly that.                                                                                                                                | **Out of scope, flagged for follow-up.** R3's text and AC are start-scoped. Cheaper to fix now than before (the same `SPUR_RUN_ID` check applies), which strengthens the case for a follow-up task rather than silently widening this one.                                                                                                                                                                                                 |
| P3       | Ordering bug found during implementation: the first `stripScenarioPrefixes` did not strip the `R{n}` prefix, so `R3 — [doc-only] Foo` kept its tag.                                                                                                                                                                                                                                           | **Fixed** by folding the R-prefix into the same fixed-point loop; regression test added.                                                                                                                                                                                                                                                                                                                                                   |
| P3       | Session ids are minute-granular, so two sessions opened in the same minute share an id.                                                                                                                                                                                                                                                                                                       | **Pre-existing, out of scope.** Noted in a test comment so it is not mistaken for R3 fallout.                                                                                                                                                                                                                                                                                                                                              |
| P4       | `normalizeTitle` is shared by three consumers; changing it widened blast radius beyond `feature-check`.                                                                                                                                                                                                                                                                                       | **Audited before landing.** All three want the behavior; `bun test packages/domain packages/app` shows zero BDD/coverage/verdict/feature-check failures.                                                                                                                                                                                                                                                                                   |
| P4       | R6 could have added a `warnings[]` field to the verdict artifact.                                                                                                                                                                                                                                                                                                                             | **Avoided** — reused the existing `checks[]` channel. No schema change, no new consumer contract.                                                                                                                                                                                                                                                                                                                                          |
| P4       | R3's env var name is a string literal rather than an import from ts-ai-runner.                                                                                                                                                                                                                                                                                                                | **Intentional**, and pinned by a test asserting it equals `SPUR_RUN_ID`. The hook is self-contained by design (0232/0246) and must not depend on the workspace module graph; the test converts an invisible coupling into a loud one.                                                                                                                                                                                                      |

#### Residual risk

- **Hook latency is still ~2.37 s per fire**, essentially all bun startup. R2 removed the avoidable
  subprocess; it did not and cannot address the floor. Any future work on hook cost must target the
  runtime or a resident process, not the guard logic.
- **`context-session-stop` asymmetry** — nested teardown can still retire a live session.
- **Idle-window merging** — now confined to uncorrelated paths; ceiling marked in code.
- **Absolute timings are sandbox-measured.** Relative and differential claims hold; absolutes may not
  reproduce on a bare shell.

#### Verification honesty

`bun run test-cf` was **not** run — it cannot execute in this sandbox (`EPERM` on `listen`). The 24
`bun run test` failures are environmental and identical before/after; the delta attributable to this
task is +43 pass, +0 fail. No test was skipped, `.skip`-ed, or suppressed to reach green, and no
`biome-ignore` was added. One formatting-only lint failure was introduced by the new tests and fixed
with `bun run format`, not by relaxing the rule.

### References

#### Source post-mortems

- `/tmp/findissue-H6-report.md` — `/skill:sp-dev-find-issue` output, 2026-07-31. Issue 1 (hooks),
  Issue 2 (execution time). Numbers superseded by `### Background`.
- `docs/dogfood/2026-07-31-sp-dev-runall-H6-dogfood.md` — dogfood report, findings P1–P4.
- omp session `019fb512-71c5-7000-89f2-1bd28a14ad53` — 473 events, 38 timeout/exit-code-3 mentions.

#### Evidence artifacts

- `.spur/context/token-ledger.jsonl` — 1353 lines, 2026-07-13 → 2026-07-31. Event counts in
  `### Root Cause`.
- `.spur/run/*-{implement,test,verify}-partial.md` — timeout handoff files; 0391 test, 0395 test,
  0396 implement, 0392 worker subagent.
- `.spur/run/{0390..0397}-verify-answer.txt` + `<wbs>-verdict.json` — regenerated 2026-07-31 by the
  verifyall pass; AC coverage 23/48 → 48/48. The RC-3 reproduction is in `0396-verify-answer.txt`
  (the two ADR rows and their forced `command` evidence type).
- `docs/dogfood/2026-07-31-sp-dev-runall-H6-dogfood.md` §7 — post-hoc correction note. **Gitignored**
  (`.gitignore:170`), so this task file is the committed record of those corrections.

#### Verifyall pass (2026-07-31, `--feature H6 --auto --next --force --focus all --fix all`)

- Batch verdict PASS (9 PASS / 0 PARTIAL / 0 FAIL) via `spur task verifyall-aggregate`; shippable
  PASS under `spur feature check H6 --strict`.
- RC-3 reproduced live — see `### Root Cause`.
- Incidental finding, not in scope for this task: task 0395's R1/R2 state verb counts (agent 8,
  message 5, team 7) that count commander's generated `help`. The real catalogs are 7/4/6, which is
  what the references and `spur-cli-parity.test.ts` document. Implementation correct, requirement
  text stale; recorded in `0395-verify-answer.txt` rather than silently matched.
- Environmental baseline at time of writing: `bun run test` 4104 pass / 24 fail, all sandbox
  port-bind / `ps` denials (`bun run test-cf` cannot run in-sandbox at all). Relevant to R1 — the
  same sandbox that inflates these also produced this task's timing figures.

#### Code sites (this monorepo)

- `plugins/sp/hooks/context-session-start.ts:37-60` — `recordSessionStart`, no idempotency guard.
- `plugins/sp/hooks/hooks.json` — PreToolUse `Write|Edit`, PostToolUse `Bash|Grep|Glob|Read|Write|Edit`.
- `packages/app/src/services/task-verdict.ts:164-172` — silent row drop on null normalization.
- `packages/app/src/services/task-verdict.ts:187-196` — `normalizeEvidenceType`.
- `packages/app/src/services/task-verdict.ts:198-219` — `applyAcceptanceCriteriaEvidenceRule`,
  `requiresExecutableEvidence`.
- `packages/app/src/services/feature-check.ts:564-585` — `isScenarioVerified`.
- `packages/app/src/services/feature-check.ts:639-648` — `rowMatchesScenario`.
- `packages/app/src/services/feature-check.ts:629-637` — `defaultVerdictRunDir`, the existing
  `docs/tasks\d*` / flat-`tasks` layout convention to reuse for R2's prefilter.
- `packages/domain/src/bdd/coverage.ts:30-38` — `normalizeTitle`.
- `packages/app/src/services/task-check.ts:951` — third `normalizeTitle` consumer.
- `config/workflows/task-pipeline.yaml:49-58` — `stepTimeoutMs` / `implementTimeoutMs` and the
  bug-742/744/746/748 precedent comment.
- `config/workflows/task-pipeline.yaml:122,138,166` — the three steps on `stepTimeoutMs`.
- `apps/cli/config/workflows/task-pipeline.yaml` — second copy; differs from the first.

#### Code sites (`~/xprojects/superskill`)

- `apps/cli/src/commands/hook-run.ts:101-113` — `resolveSpurTaskOwnership`, the 2.4 s spawn.
- `apps/cli/src/commands/hook-run.ts:121-154` — `runSpTaskWriteGuard`, the missing prefilter.
- `apps/cli/src/commands/hook-run.ts:422-423` — dispatcher table proving `sp/context-post-tool` and
  `sp/context-session-start` resolve to superskill-internal runners.

#### Docs to update

- `plugins/sp/skills/spur-dev/references/done-housekeeping.md` — R5 runbook; house style `F1`–`F5`.
- `plugins/sp/skills/spur-dev/references/ac-style-guide.md` — R8 contract; place near
  "Scenario-title stability" (:65).
- `docs/dogfood/2026-07-31-sp-dev-runall-H6-dogfood.md` — close-out correction note.

### History

- 2026-07-31T05:19:10.875Z backlog → todo (system)
- 2026-07-31T05:19:13.379Z todo → wip (system)
- 2026-08-01T04:07:45.866Z wip → testing (system)
- 2026-08-01T04:08:03.169Z testing → done (system)
