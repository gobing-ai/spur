---
template: meta
schema_version: 1
name: "E1 batch waste: unreachable tier-fallback, precheck spurBin, fix-hop scope"
description: "Forensics on the E1 batch: a pinned executor silently opts a run out of the tier-fallback ladder 0407 already shipped, the size precheck is not passed $spurBin, the test-fix hop pays full agent dispatches for one anchored finding, and the partial-work handoff never names the dead agent's transcript."
status: todo
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-08T11:43:02.381Z"
updated_at: "2026-08-08T12:40:41.883Z"
---

## 0482. E1 batch waste: unreachable tier-fallback, precheck spurBin, fix-hop scope

### Background
Feature E1 (History data plane) was implemented through `sp-dev-runall --feature E1 --auto --next`,
6 tasks (0465/0467/0474/0469/0470/0471). The first four ran cleanly through the pipeline
(`agent=omp` default, implement 5–25 min each). The last two (0470 `--source all` fan-out + daily,
0471 history.* events + launchd) together consumed several hours of wall-clock across two days
(2026-08-07 21:00Z → 2026-08-08 11:38Z main session; ~15 h wall-clock, 4 compactions) and required
manual completion of both tasks after pipeline agent steps died.

The trigger was a config change: `.spur/config.yaml` `agent.default` was switched from `omp` (Claude)
to `omp-zai-volc` (GLM-5.2, hard 5-hour rolling quota), and the 0470 implement agent burned 25 min
(volc) then 37 min (zai) before dying with `AccountQuotaExceeded` / `Usage limit reached for 5 hour`.

**The trigger is not the defect.** A first pass read this as "the pipeline is quota-unaware; add a
`spur agent doctor` preflight gate". Re-derived against the tree, that framing is wrong twice: the
doctor cannot see a GLM quota at all (`DoctorRunner` resolves provider keys from
`${PROVIDER}_API_KEY` env vars; omp keeps its keys elsewhere, so the row degrades to
`status: usable · auth: no · model: unknown` — exactly what run `87e05e98` logged one second before
launching the 25-minute agent), and a preflight could not have prevented the dominant burn anyway,
because that run *consumed* the quota mid-flight rather than starting against an exhausted one.

The real defect is that the recovery mechanism already exists and the pipeline cannot reach it. Task
0407 shipped automatic tier fallback; the `implement` stage declares
`{ tier: 'capable-1', trigger: 'resource-exhaustion' }`; `classifyObjectiveFailure` already matches
the 429/quota text GLM emitted. None of it fires, because escalation is bounded by
`maxEscalations = currentStage?.policy.fallback.length ?? 0` and a stage is attached **only** when
resolution runs through `resolveAgentAuto`. Every pipeline `agent.run` pins a concrete executor, so
`currentStage` is always `undefined` and the loop breaks immediately. Pinning an executor silently
opts a run out of recovery — and 0407's own regression test dispatches with
`{ agent: 'auto', stage: 'implement' }`, the one resolution mode production never uses, so it passes
with the path severed. See § Design for the full chain with line anchors.

Three further findings from the same batch: the size precheck is invoked without `--spur-bin`
(0471 failed to launch twice); the `test-fix` hop spent two full `/sp:dev-fixall` dispatches — 8m50s,
then a 30-minute timeout kill — on one rule violation the gate had already localized to a file:line;
and the partial-work handoff never names the agent session directory that holds the dead agent's
transcript, which is what forced the manual resume to re-derive the fan-out output contract across
~15 `migrate-stubs.test.ts` and ~14 `history.test.ts` runs.

Topic filter: full taxonomy (no `--topic`, no `--category` restriction), all severities.
### Requirements
- [ ] **R1.** **Make the existing tier-fallback ladder reachable from a pinned executor.** The
      `implement` stage already declares `{ tier: 'capable-1', trigger: 'resource-exhaustion' }`
      (`packages/domain/src/stage-registry/schema.ts:774-781`) and `classifyObjectiveFailure`
      (`agent-service.ts:1339-1352`) already matches the `429 … quota` text the GLM death emitted.
      The ladder never fires because `executeRun` computes
      `maxEscalations = currentStage?.policy.fallback.length ?? 0` (`agent-service.ts:586`) and
      `currentStage` is set **only** when resolution came through `resolveAgentAuto` → stage. Every
      pipeline `agent.run` pins a concrete executor (`agent: ${vars.implementAgent}` →
      `resolveExecutorSelector(…, 'explicit')`), and `agent-run.ts:123` rewrites even `inline` into
      `agentConfig.default` — another concrete name. So `currentStage` is always `undefined` and the
      loop breaks at `agent-service.ts:755`. Fix: when the initial pick came from `explicit`/`default`
      but a stage resolves from the prompt phase, consult that stage's `model_policy.fallback` for the
      escalation ladder (the *pin* chooses the starting executor; it must not disable escalation).
      Measurable: a pinned `--agent omp-zai-volc` implement dispatch that exits non-zero with a 429
      quota body escalates to the next eligible tier instead of terminating the run. **Do not** rebuild
      this as a new preflight gate — see R5 and the Q&A on why preflight cannot see the wall.

- [ ] **R2.** **Pass `$spurBin` to the size precheck.** `plugins/sp/scripts/task-size-precheck.ts`
      already resolves `--spur-bin` and `SPUR_BIN` (lines 45, 53-55); the defect is entirely in
      `config/workflows/task-pipeline.yaml:149`, which invokes the script with neither, while the
      doctor step (`:114`), the feature-sync step (`:133`) and `feature-sync-bounded.ts` (`:336`) in
      the same file all use `$spurBin`. Add `--spur-bin "$spurBin"` and add a guard that fails if a
      `bun plugins/sp/scripts/…` step in a shipped workflow shells `spur` without it (an assertion in
      the existing pipeline-YAML test is sufficient; no new rule unless it recurs). Measurable: the
      precheck reports PASS under `env -i PATH=/usr/bin:/bin` and no run fails with
      `could not fetch task <wbs> via spur`.

- [ ] **R3.** **Scope the `test-fix` hop to the failing gate finding.** Run `8becd695` spent two
      `/sp:dev-fixall` dispatches — 8m50s, then a full 30m00s `stepTimeoutMs` wall that killed the run
      (log line 4783) — on a **single** rule violation the gate had already reported with an exact
      anchor: `raw-sql-only-in-domain … packages/app/src/services/history-service.ts:360`. ~39 min of
      agent wall-clock for one file:line, independent of any quota. The `test-fix` state passes an
      unscoped `/sp:dev-fixall` input; pass the captured gate output (or its finding lines) so the fix
      agent starts at the anchor instead of re-deriving the failure. Measurable: a single-finding gate
      failure resolves in one dispatch whose input names the failing file:line.

- [ ] **R4.** **Make the partial-work handoff resumable.** `*implement-partial.md` records the
      invocation, a `git diff --stat`, a stderr tail, and `completed requirements (heuristic): unknown`
      — nothing about what the dead agent decided. The transcript that *does* hold it already exists at
      `.spur/run/<runId>/agent-sessions/<executor>/` (plus `<runId>-agent-session.json` when latched)
      and the artifact never names it. Emit an explicit `## resume context` block pointing at the
      session dir and any latched session file. Measurable: the handoff names a path that resolves to
      the dead agent's transcript. This is the actionable half of RC3 — the rest (re-derived output
      contract) is downstream of R1.

- [ ] **R5.** **Correct the quota framing; land it in the `--agent` SSOT, not a ninth restatement.**
      Two corrections: (a) "`omp`/Claude has no hard quota" is **false** — Claude enforces its own
      5-hour rolling limits; the durable guidance is that *every* executor can exhaust and the pipeline
      must survive exhaustion (R1), not that some executor is safe to pin. (b) `spur agent doctor`
      cannot today report a GLM quota (see Q&A / R1 note), so no doc may instruct an operator to read
      quota state from it. Write the corrected paragraph **into the single anchor task 0480 R1
      designates** (`plugins/sp/skills/spur-dev/references/cross-cutting.md` § Inline-default execution
      surface); do not add prose to `execution-workflow.md` / `flag-glossary.md` / `dev-operations.md`,
      which 0480 is collapsing. Measurable: one file states executor-exhaustion guidance; a grep for
      "no hard quota" returns nothing.
### Acceptance Criteria
```gherkin
Feature: E1-batch-performance — reachable escalation, PATH-independent precheck, scoped fix hop

  Scenario: R1 — a pinned executor still escalates on resource exhaustion
    Given the implement step pins a concrete executor (not the literal `auto`)
    And the prompt resolves to the `implement` stage whose model_policy declares a
      resource-exhaustion fallback
    When the dispatch exits non-zero with a 429 quota body
    Then the run escalates to the next eligible tier and re-dispatches
    And the escalation is reported naming the failed executor, the signal, and the target tier
    And the run does not terminate at `failed` with only a partial-work artifact

  Scenario: R2 — the size precheck resolves spur regardless of shell PATH
    Given a workflow shell whose environment has no user PATH (bare `spur` unresolvable)
    When the size precheck runs
    Then the pipeline passes `--spur-bin "$spurBin"` to the script
    And the precheck reports PASS rather than `could not fetch task <wbs> via spur`

  Scenario: R3 — a single gate finding costs one fix dispatch
    Given the quality gate fails with exactly one finding carrying a file:line anchor
    When the test-fix hop dispatches its fix agent
    Then the agent input names that finding's file:line
    And the gate goes green within one dispatch rather than consuming the step timeout

  Scenario: R4 — a dead agent's handoff points at its transcript
    Given an agent.run step fails and writes a partial-work artifact
    When an operator opens that artifact to resume
    Then it contains a resume-context block naming the agent session directory
    And that path resolves to the dead agent's transcript

  Scenario: R5 — executor-exhaustion guidance exists once and is true
    Given the `--agent` execution-surface SSOT anchor
    When an operator selects a default executor for a batch run
    Then the anchor states that any executor can exhaust and that the pipeline escalates
    And no document claims an executor has no hard quota
    And no document instructs reading quota state from `spur agent doctor`
```
### Q&A
**Q: Why is the quota wall the dominant cost?**
A: `.spur/config.yaml` `agent.default` was `omp-zai-volc` (GLM-5.2, hard 5-hour rolling quota).
Run `87e05e98` implement burned 25m21s and died `429 AccountQuotaExceeded`; run `91e82cca` burned
37m18s and died `429 Usage limit reached for 5 hour`. Both left `*implement-partial.md`; both
required manual completion. ~62 min of agent wall-clock on 0470 alone, plus hours of operator resume.

**Q: Why didn't the pipeline recover automatically? (revised — this is the real finding)**
A: It has the machinery and cannot reach it. Task 0407 shipped automatic tier fallback, and the
`implement` stage declares `{ tier: 'capable-1', trigger: 'resource-exhaustion' }`. But
`maxEscalations` is derived from the resolved **stage** (`agent-service.ts:586`), and a stage is only
attached when resolution goes through `resolveAgentAuto`. The pipeline always pins a concrete
executor, so `currentStage` is `undefined`, `maxEscalations` is 0, and the loop breaks immediately at
`:755`. `inline` does not help — `agent-run.ts:123` rewrites it to `agentConfig.default`, another
concrete name. Only the literal `auto` reaches stage routing, and no pipeline passes it.

**Q: Then why did the original R1 propose a `spur agent doctor` preflight?**
A: Because the doctor row *looks* authoritative. It is not, for two reasons. (1) `DoctorRunner`
resolves provider keys from `${PROVIDER}_API_KEY` env vars (`doctor-runner.ts:207-209`); omp keeps
them in its own config, so `OmpModelProbe` never runs and the row degrades to
`status: usable · auth: no · model: unknown · detail: API key not found for provider 'volc'` —
precisely what run `87e05e98` logged one second before launching a 25-minute agent. Note the row said
**usable** despite `auth: no`. (2) Even a working probe only catches an *already*-exhausted quota;
`87e05e98` exhausted it mid-run. Preflight would have saved attempts 2 and 3 (seconds and minutes),
not the dominant 25-minute burn.

**Q: Why did 0471 fail to launch twice?**
A: `config/workflows/task-pipeline.yaml:149` invokes `task-size-precheck.ts` without `--spur-bin`,
so the script falls back to bare `spur`, which `/bin/sh -c` cannot resolve without the user's
`~/.bun/bin` on PATH. Confirmed in runs `81e9f378` and `6b4da564`. The **script is not the bug** — it
already honors `--spur-bin` and `SPUR_BIN` (lines 45, 53-55), and three sibling steps in the same YAML
already pass `$spurBin`. One-line fix in the YAML.

**Q: What did the original write-up miss entirely?**
A: The `test-fix` hop. In run `8becd695`, one rule violation with an exact anchor
(`raw-sql-only-in-domain … history-service.ts:360`) cost two `/sp:dev-fixall` dispatches — 8m50s, then
a 30m00s `stepTimeoutMs` wall that failed the run. ~39 min for one file:line, with no quota involved.
That is a second independent sink in the same batch and is now R3.

**Q: Why the 14–15× test re-runs in the main session?**
A: Manual completion re-derived the fan-out output contract the dead implement agent left
half-specified. Mostly downstream of R1 — but not entirely. The handoff artifact records a diff-stat,
an invocation and `completed requirements (heuristic): unknown`, and never names the agent session
directory that holds the transcript. That pointer is one line (R4) and is the cheap half of the fix.

**Q: Is a hook/guard the right fix, or guidance?**
A: Code, mostly. R1 and R3 are behavior, R2 is a one-line wiring fix, R4 is an artifact field, R5 is
documentation that must land in 0480's SSOT anchor rather than becoming a ninth restatement. No new
constraint rule is warranted; R2's regression guard belongs in the existing pipeline-YAML test.

**Q: Isn't the simplest fix to set `agent.default` back to `omp`?**
A: It ends this incident and teaches the wrong lesson. Claude enforces its own 5-hour rolling limits,
so "omp has no hard quota" is false; pinning it converts a recoverable failure into a rarer,
unhandled one. The durable fix is that exhaustion is survivable (R1). Switching the config in the
meantime is fine as an operational choice — it is not this task's deliverable.

**Q: What is the expected savings?**
A: R1 converts each quota death from "~30 min burned + manual resume (1–3 h operator time)" into an
automatic tier hop. R3 removes a ~39 min sink per single-finding gate failure. R2 removes two failed
launches and, more importantly, the operator's `SPUR_BIN` workaround. R4 removes most of the
resume-without-context re-derivation.
### Design
**Root-cause chain (verified against the tree and the run artifacts, 2026-08-08).**

```
.spur/config.yaml agent.default: omp-zai-volc   (GLM-5.2, 5-hour rolling quota)
  → workflow-service.ts:484 injects it as vars.agent
    → task-pipeline.yaml:169  agent: ${vars.implementAgent}   (a CONCRETE executor name)
      → agent-run.ts:181      flags.agent = <name>            (`inline` also → concrete, :123)
        → agent-service.ts:849 resolveExecutorSelector(…, 'explicit')  → result carries NO stage
          → agent-service.ts:586 maxEscalations = currentStage?.policy.fallback.length ?? 0  → 0
            → agent-service.ts:755 break  → run terminates at `failed`, partial work on disk
```

The mechanism that should have absorbed the quota death was built and shipped by task 0407 and is
declared for exactly this trigger (`stage-registry/schema.ts:774-781`,
`{ tier: 'capable-1', trigger: 'resource-exhaustion' }`). It is unreachable from production because
the pipeline pins its executor, and 0407's own proof
(`packages/app/tests/services/agent-service.test.ts:2094`) dispatches with
`{ agent: 'auto', stage: 'implement' }` — the single resolution mode the pipeline never uses. 0407 R7
required that the test fail if the escalation path were severed; it passes with the path severed for
the production dispatch mode.

**Why a preflight quota gate is the wrong rung (the original R1).** Two independent reasons:

1. *It cannot see the wall.* `DoctorRunner.resolveApiKey` reads `${PROVIDER_UPPERCASE}_API_KEY` from
   the environment (`ts-libs/packages/ai-runner/src/doctor-runner.ts:207-209`). No `VOLC_API_KEY` /
   `ZAI_API_KEY` is set on this box — omp holds provider keys in `~/.omp/agent/models.yml`. So
   `OmpModelProbe` never runs and the doctor row is exactly what run `87e05e98` logged:
   `status: usable · auth: no · model: unknown · detail: API key not found for provider 'volc'`.
   A gate on today's doctor output gates on `unknown` forever. Making it work first requires teaching
   `DoctorRunner` to read the agent's own credential store — a cross-package change with a real secret
   surface, well beyond "fail the precheck".
2. *Even working, it would not have prevented the dominant cost.* Run `87e05e98` **consumed** the
   quota during its own 25 minutes; the quota was healthy at launch. Only a mid-run reaction — R1's
   escalation — recovers that class. Preflight only catches attempts 2 and 3, i.e. the cheap ones.

**Tradeoff on R1's scope.** Two implementations reach the same behavior:

| Option | Change | Cost |
| --- | --- | --- |
| A. Let a pinned pick still consult the stage ladder | `resolveAgent`/`executeRun`: attach the phase-resolved stage to explicit/default resolutions for fallback purposes only | Small, keeps the "pin so a broken box can't capture the run" rationale in `task-pipeline.yaml:57-59` intact |
| B. Dispatch implement with the literal `auto` | vars change + stop injecting `agent.default` over it | One line, but discards the pin rationale and makes the starting executor implicit |

**A is the recommendation** — the pin decides where a run *starts*; it was never meant to decide
whether a run may *recover*. B is the fallback if A's blast radius proves larger than expected.

**Deliberately out of scope.** Teaching `DoctorRunner` to read agent-owned credential stores;
switching `agent.default` back to `omp` (a config edit, not a fix — R5 explains why "pick the safe
executor" is not durable guidance).
### Plan
- [ ] 1. R2 first (smallest, unblocks re-running the pipeline): add `--spur-bin "$spurBin"` at
      `config/workflows/task-pipeline.yaml:149`; reproduce the failure and the fix under
      `env -i PATH=/usr/bin:/bin`.
- [ ] 2. R2 guard: assert in the pipeline-YAML test that every `bun plugins/sp/scripts/…` step which
      shells spur passes `--spur-bin`.
- [ ] 3. R1 (Design option A): attach the phase-resolved stage to `explicit`/`default` resolutions for
      fallback purposes in `packages/app/src/services/agent-service.ts`; leave the starting-executor
      pin semantics untouched.
- [ ] 4. R1 proof: extend `agent-service.test.ts` § automatic tier escalation with a **pinned**
      (`agent: '<executor-name>'`, no `stage` flag) dispatch that fails with a 429 quota body and must
      escalate. Verify by mutation that it fails when the path is severed (0407 R7, applied to the
      dispatch mode production actually uses).
- [ ] 5. R3: thread the captured quality-gate output into the `test-fix` agent input in
      `config/workflows/task-pipeline.yaml`; confirm a single-finding failure resolves in one dispatch.
- [ ] 6. R4: add the `## resume context` block (session dir + latched session file) to the partial-work
      artifact writer in `packages/app/src/workflow/actions/agent-run.ts`.
- [ ] 7. R5: write the corrected executor-exhaustion paragraph into the 0480 R1 anchor; grep that
      "no hard quota" and doctor-as-quota-source claims are absent repo-wide.
- [ ] 8. Verify: `bun run lint` + `bun run test` green; then one `bun run spur-check`.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
**Code anchors (verified 2026-08-08 against the working tree).**
- `packages/app/src/services/agent-service.ts:586` — `maxEscalations = currentStage?.policy.fallback.length ?? 0`
- `packages/app/src/services/agent-service.ts:753-757` — escalation break when `currentStage` is undefined
- `packages/app/src/services/agent-service.ts:836-849` — `explicit` path (no stage); `:860-889` `resolveAgentAuto` (stage path)
- `packages/app/src/services/agent-service.ts:1339-1352` — `classifyObjectiveFailure` 429/quota regex
- `packages/app/src/services/agent-service.ts:325-353` — doctor's warn-only `quota_exhausted` branch (exit code ignores it)
- `packages/domain/src/stage-registry/schema.ts:765-785` — `implement` stage, `resource-exhaustion → capable-1`
- `packages/app/src/workflow/actions/agent-run.ts:123` — `inline` → `agentConfig.default` (concrete name)
- `packages/app/src/services/workflow-service.ts:484, 1060-1071` — `agent.default` injected as `vars.agent`
- `packages/app/tests/services/agent-service.test.ts:2069-2104` — 0407 escalation proof, `{agent:'auto', stage:'implement'}` only
- `config/workflows/task-pipeline.yaml:149` — size precheck without `--spur-bin` (R2 defect)
- `config/workflows/task-pipeline.yaml:114, 133, 336` — sibling steps that do use `$spurBin`
- `plugins/sp/scripts/task-size-precheck.ts:45, 53-55` — `SPUR_BIN` / `--spur-bin` already supported
- `~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts:193-209` — `${PROVIDER}_API_KEY` env-only key resolution
- `~/xprojects/ts-libs/packages/ai-runner/src/model-health-probe.ts:79-84, 221` — `OMP_PROVIDERS` (zai/volc registered), `quota_exhausted`

**Run evidence.**
- `.spur/run/87e05e98-*` — 0470 implement, omp-zai-volc, 25m21s, `429 AccountQuotaExceeded`; doctor row one second before launch: `status: usable · auth: no · model: unknown · detail: API key not found for provider 'volc'`
- `.spur/run/91e82cca-*` — 0470 implement, omp-zai, 37m18s, `429 Usage limit reached for 5 hour`
- `.spur/run/8becd695-*` — 0471; implement on omp-zai (26m); gate fails with one finding (line 276); test-fix 8m50s then 30m00s timeout kill (line 4783)
- `.spur/run/81e9f378-*`, `.spur/run/6b4da564-*` — 0471 precheck FAIL, `could not fetch task 0471 via spur`
- Handoffs: `87e05e98-*implement-partial.md`, `91e82cca-*implement-partial.md`, `8becd695-*test-fix-partial.md`
- Main session: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-07T20-41-40-726Z_019fddf5-ca76-7000-bc8d-2934a9b4909d.jsonl`
- Config at run time: `.spur/config.yaml` `agent.default: omp-zai-volc` (volc/glm-5.2)
- Source: omp (High confidence — documented adapter, tool events parsed from `message.content[].toolCall`)

**Related corpus.** 0407, 0405 (escalation ladder — done) · 0478 R1, 0479 (done) · 0480 R1/R2, 0481 R2
(todo; see Notes coverage table) · commits bc452024 (size precheck, implementAgent), 3da71595 (0478),
14cc3afe (E1 done).
### History
- 2026-08-08T12:40:38.488Z backlog → todo (system)
### Notes
**RC1 — Escalation ladder unreachable from a pinned executor (dominant, S0). Re-diagnosed.**
Original framing was "quota-unaware executor; add a preflight gate". Verified against the tree, the
defect is one layer deeper and already has a mechanism. Evidence: `87e05e98` implement (volc)
00:54→01:19Z (25m21s), `429 AccountQuotaExceeded — 5-hour usage quota, reset 2026-08-08 11:22:09
+0800`; `91e82cca` implement (zai) 03:04→03:41Z (37m18s), `429 Usage limit reached for 5 hour`; third
attempt `2b9a36e9` died in 1.7s. Both left `*implement-partial.md`. `classifyObjectiveFailure`
(`agent-service.ts:1339-1352`) matches that text → `resource-exhaustion`; the `implement` stage
declares a `resource-exhaustion` → `capable-1` fallback; neither fires because `currentStage` is
`undefined` for an explicit/default pick and `maxEscalations` therefore evaluates to 0
(`agent-service.ts:586`, break at `:755`). → R1.

**RC2 — Size precheck not passed `$spurBin` (S1). Fix location corrected.**
Evidence: `81e9f378` and `6b4da564` both failed precheck with
`task-size-precheck: FAIL — could not fetch task 0471 via spur`; reproduced with a restricted PATH.
The original write-up put the fix in `task-size-precheck.ts`; the script already supports
`--spur-bin` / `SPUR_BIN` (lines 45, 53-55). The single defect is
`config/workflows/task-pipeline.yaml:149` omitting the flag, three lines after two sibling steps that
use `$spurBin` correctly (`:114`, `:133`) and one file-local precedent that already passes it
(`feature-sync-bounded.ts`, `:336`). → R2.

**RC3 — Manual-resume test-loop (S2). Half of it is actionable.**
Evidence: main session ran `migrate-stubs.test.ts` ~15× and `history.test.ts` ~14×. Original write-up
dismissed this as pure consequence. It is mostly downstream of RC1, but the handoff artifact is a
real, cheap contributor: `87e05e98-…-implement-partial.md` carries the invocation, a 34-file
`git diff --stat`, an empty stdout tail, the 429 stderr line, and
`completed requirements (heuristic): unknown` — while the transcript sits unreferenced at
`.spur/run/<runId>/agent-sessions/<executor>/`. → R4.

**RC4 — `test-fix` hop pays full agent dispatches for one anchored finding (S1). NEW — absent from the
original write-up.** Evidence: run `8becd695` (0471), gate failed with exactly one violation —
`raw-sql-only-in-domain … packages/app/src/services/history-service.ts:360` (log line 276). `test-fix`
attempt 1 dispatched `/sp:dev-fixall` for 8m50s; the gate still failed; attempt 2 ran into the
`stepTimeoutMs` 30m00s wall and failed the run (log line 4783). ~39 min of agent wall-clock for a
one-line boundary violation the gate had already localized, with no quota involved. → R3.
(The violation itself was later fixed correctly — the SQL was moved into `packages/domain`, not
exempted; the only rule exemption in the working tree is an unrelated, justified `node:fs` entry.)

**S3 — cosmetic, no requirement.** The run-log secret redactor mangles the precheck's own diagnostic:
`81e9f378` line 34 reads `ta[REDACTED]: FAIL — could not fetch task 0471 via spur`. It matched the
`sk-` API-key prefix inside "ta**sk-**size-precheck", corrupting the exact message an operator needs
to diagnose RC2. Worth a word-boundary/entropy guard in a separate task if it recurs.

**Coverage check against yesterday's tasks — nothing here is already fixed.**

| Related | Status | Relation |
| --- | --- | --- |
| 0407 / 0405 | done | Built the fallback ladder R1 must make reachable. 0407 R7's proof uses `{agent:'auto', stage:'implement'}` only — it passes with the path severed for the pinned dispatch mode production uses. |
| 0478 R1 | done | Pre-launch **size** probe in the driver session (PATH intact). Does not touch RC2, which fails inside the workflow shell. |
| 0479 | done | Verdict-artifact gate holes. Unrelated. |
| 0481 R2 | todo | Documents the `spur`-on-PATH trap and the `resolveSpurBin → vars.spurBin → $spurBin` chain. Docs side of the same mechanism as R2 — complementary, not duplicate. Cross-link; do not merge. |
| 0480 R1/R2 | todo | Collapsing `--agent` prose to one SSOT anchor. R5 **must** write into that anchor, or it becomes the ninth restatement 0480 exists to remove. Sequence R5 after 0480 R1, or land both together. |
| 0142 (tasks2) | — | Batch execution v2. No quota or executor-health coverage. |

No open or done task covers executor exhaustion recovery, the `test-fix` scoping cost, or the handoff
resume pointer.

**What worked well.** The first four E1 tasks (0465/0467/0474/0469) ran cleanly with 5–25 min
implements. The orchestration is sound; what failed is that a pinned executor silently opts a run out
of the recovery path the repo already owns.
