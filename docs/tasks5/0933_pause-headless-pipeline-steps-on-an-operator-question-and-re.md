---
schema_version: 1
name: Pause headless pipeline steps on an operator question and resume with the answer
status: done
template: feature-impl
created_at: 2026-09-23T06:52:00.966Z
updated_at: "2026-09-24T21:24:25.466Z"
feature_id: H1

priority: P2
estimate_hours: 6
dependencies: ["0931", "0932"]
---

## 0933. Pause headless pipeline steps on an operator question and resume with the answer

### Background

Covers H1 Slice B: R26, R27 (the re-dispatch half), R29 and R30. It replaces 0142 R7.x.

Today a headless `agent.run` step cannot ask anything. It either guesses or fails. `execution-batch.md:887-891` and `plugins/sp/agents/super-planner.md:277` defer this until "the workspace module + inbox module + `spur agent` team mode". Those modules shipped and were then retired (ADR-116, G64), so that blocker is obsolete.

The pieces this task composes already exist:
- `hitl.input` emits `workflow.hitl.ask` with the prompt (`packages/app/src/workflow/actions/hitl-input.ts:34-40`).
- `pause: true` states and skip-enter resume are used by `approve` (`config/workflows/task-pipeline.yaml:455-468`).
- `file.read.into-var` is at `packages/app/src/workflow/actions/file-read-into-var.ts`.
- A counter-file bound pattern exists: `.spur/run/<wbs>-test-fix-attempt` (`task-pipeline.yaml` test-fix).
- The implement stage has `session: reuse` (`:225-236`).
- 0932 adds `spur workflow continue --answer-text`.

The blocker: the implement `agent.run` has `requireDiff: true` (`task-pipeline.yaml:241`; `packages/app/src/workflow/actions/agent-run.ts:921-940`). An agent that stops to ask a question produces no diff, so the step fails as an "empty implement". The action needs a declared escalation escape.

Rubric: E2 D2 L1 C1 R1 = 7. Kept as one task because the action option, the YAML states and the driver/report contract only make sense together.

### Requirements

- [x] R1. Add an `agent.run` option `escalationFile: <path>`. The file is deleted before dispatch (the same freshness rule as `expectFile`, 0751 R3). After an exit-0 run, a non-empty file means the step escalated: the result is `ok: true` with `data.escalated = true`, and `requireDiff` is skipped for that attempt only. Without the option, behavior is unchanged.
- [x] R2. Pipeline, implement stage only:
  - `implement` declares `escalationFile: .spur/run/${vars.wbs}-question.md`;
  - new `escalate` state: `pause: true`; onEnter increments `.spur/run/<wbs>-escalation-count`, then `file.read.into-var` puts the question into `escalationQuestion`, then `hitl.input` uses `prompt: ${vars.escalationQuestion}`;
  - transitions out of `implement`, in declaration order:
    1. question present and count ≥ `maxEscalations` (var, default `"2"`) → `failed`, with the unanswered question appended to `.spur/run/<wbs>-report.txt`;
    2. question present → `escalate`;
    3. otherwise the existing `→ test`;
  - `escalate → implement` when `__hitlInput` is non-empty; otherwise `escalate → failed`.
- [x] R3. Re-dispatch with the answer. Before the agent runs, implement's first onEnter action does one of two things:
  - if a question file and a non-empty `__hitlInput` both exist, append `## Q<n>` (the question) and `## A<n>` (the answer) to `.spur/run/<wbs>-escalation.md`, then remove the question file (removing the question file is what disarms the `implement → escalate` edge);
  - otherwise do nothing.
  The implement input becomes `/sp:dev-run --mode implement ${vars.wbs} --auto --escalation-file .spur/run/${vars.wbs}-escalation.md`.
- [x] R4. Escalation contract, in `sp:code-implementation` SKILL.md plus `dev-run.md --mode implement`:
  - decide without asking when the answer follows from the task's frozen Design / Requirements / Q&A, the project and global instructions, or the codebase;
  - escalate only when a requirement or design ambiguity would change scope, correctness or authorization;
  - to escalate, write one concise question with options and a recommendation to the escalation file, and exit 0 without further edits;
  - read `--escalation-file` if it exists and treat its answers as binding.
- [x] R5. The batch and the inline driver:
  - in `execution-batch.md` the per-task outcome gains `paused`. A paused run is never auto-answered, including under `--auto`. The batch report lists the run ID, the question (from `spur workflow progress <run> --json` or the question file) and `spur workflow continue <run-id> --answer-text "<answer>"`. `paused` is non-`done` for the failure policy, so its dependents are blocked;
  - `inline-pipeline-driver.md`: in host-session mode, ask the operator in the session instead of pausing, with the same 2-escalation bound.
- [x] R6. Remove the stale out-of-scope text:
  - `execution-batch.md` § "Still out of scope" (`:887-891`);
  - `super-planner.md:277`;
  - replace both with a one-line pointer to the escalation contract.

### Acceptance Criteria

- [x] AC1 — R26 A headless step can pause its run with an operator question (req: R1, R2)
  Given a task pipeline step running as a subprocess executor
  When its agent writes a question artifact under the step's escalation contract
  Then the run pauses at an input gate instead of failing or guessing
  And the question text is visible through spur workflow trace and spur workflow progress
  Verify with (a) an `agent-run.ts` unit test: an exit-0 run with a non-empty escalationFile and zero diff returns `ok` + `escalated` and skips requireDiff; an empty or absent file still fails requireDiff; and (b) a pipeline integration test (fake agent writes the question) asserting status `paused`, current state `escalate`, and the question present in the `workflow.hitl.ask` trace event and progress output.

- [x] AC2 — R27 The operator's free-text answer resumes the paused step (req: R3)
  Given a run paused at an input gate with a pending question
  When the operator runs spur workflow continue <run-id> --answer-text "<answer>"
  Then the answer is injected into the gate's input variable before guards re-evaluate
  And the escalating step is re-dispatched with the question and the answer in its input
  Verify with the same integration fixture: after `continue --answer-text`, the run re-enters `implement`, `.spur/run/<wbs>-escalation.md` holds Q1/A1, the question file is gone, and the recorded agent input contains `--escalation-file .spur/run/<wbs>-escalation.md`.

- [x] AC3 — R29 Routine decisions are auto-answered and escalation is bounded (req: R2, R4)
  Given a step agent facing a decision inside the task's frozen Design and the global instructions
  When it runs under the escalation contract
  Then it decides without escalating
  And a step escalates at most twice before the pipeline routes to failed with the unanswered question recorded
  Verify with the integration fixture escalating three times (third → `failed`, question in `<wbs>-report.txt`), and a plugin contract test asserting that the code-implementation SKILL.md escalation section states the decide-first rule and the question format.

- [x] AC4 — R30 An unattended batch surfaces an escalation at the batch boundary (req: R5, R6)
  Given /sp:dev-runall running with --auto
  When a task pipeline pauses on an escalated question
  Then the batch never auto-answers it
  And the batch report lists the paused run, the question, and the exact continue command
  And the inline pipeline driver asks the same question in the host session instead of pausing a subprocess
  Verify with plugin contract tests over execution-batch.md (the `paused` outcome, report fields, the never-auto-answer rule), inline-pipeline-driver.md (the in-session ask + bound) and super-planner.md, plus a grep that the "workspace module + inbox module" deferral text is gone.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T06:57:45.633Z

- **Channel (closed 2026-09-22, operator).** Workflow pause + `hitl.input` + `continue --answer-text` (0932). Rejected: the steering control channel (proposed only) and `spur message` agent-to-agent Q&A, because both need a live peer and the paused-run path is durable.
- **Stages (closed).** Implement only. Review and verify are observe-only verdict producers, where a question is a finding, not a pause. Test-fix repairs against a gate log. Extend `escalationFile` to other stages only when a run shows a real need.
- **Bound (closed).** Default 2 per task run, through the `maxEscalations` var. Beyond that the task spec is under-specified and needs refinement, not more Q&A.
- **Answer delivery (closed).** Use a file referenced by path in the slash-command input, not inline answer text. ADR-043 keeps agent.run inputs pure slash commands, and arbitrary operator text in argv is an injection and quoting hazard.
- **Headless default (closed, verified).** `DefaultHitlResponder` answers input with `inputDefault`, default `''` (`apps/cli/src/workflow/hitl/default-responder.ts:26`, `:39-40`). This cannot auto-resume the run, for three reasons:
  - a `pause: true` state stops after onEnter whatever the responder returned;
  - guards re-evaluate only on `continue`;
  - 0932 makes a headless continue of an input gate require a non-empty `--answer-text`.
  An empty interactive answer takes the fallback `escalate → failed` edge, so it never loops.

### Design

- **Action (`packages/app/src/workflow/actions/agent-run.ts`):**
  - add `'escalationFile'` to `ContractName` (`:43`);
  - parse it next to `expectFile`, and delete it pre-dispatch the same way (0751 R3);
  - post-exit, before the `requireDiff` block (`:921`): `if (ok && escalationFile && (await nonEmpty(resolve(cwd, escalationFile))))`, then return success with `data.escalated = true` and `data.escalationFile`, and skip `requireDiff` plus the 0487 scope guard for this attempt;
  - document the option in the header TSDoc (`:110-135`);
  - add the option to the workflow action schema wherever `expectFile` is declared (grep for `expectFile` in the schema/contract files and mirror it).
- **YAML (`config/workflows/task-pipeline.yaml`, then `build:bundle` to regenerate `apps/cli/config/`):**
  - vars: `maxEscalations: "2"`, `escalationQuestion: ""`;
  - `precheck` onEnter: add a best-effort shell `rm -f .spur/run/$wbs-question.md .spur/run/$wbs-escalation.md .spur/run/$wbs-escalation-count; exit 0`, so a new run never inherits a prior run's questions, answers or count. A resume skips `precheck`, so an answered run keeps its history.
  - `implement` onEnter, new first action:
    ```
    - kind: shell
      options:
        command: >-
          Q=".spur/run/$wbs-question.md"; E=".spur/run/$wbs-escalation.md";
          if [ -s "$Q" ] && [ -n "$__hitlInput" ]; then n=$(cat ".spur/run/$wbs-escalation-count" 2>/dev/null || echo 1);
          { printf '## Q%s\n\n' "$n"; cat "$Q"; printf '\n## A%s\n\n%s\n\n' "$n" "$__hitlInput"; } >> "$E"; rm -f "$Q"; fi; exit 0
    ```
  - the agent.run input gains `--escalation-file .spur/run/${vars.wbs}-escalation.md`, plus `escalationFile: .spur/run/${vars.wbs}-question.md`.
  - `escalate` state (after `implement`, `pause: true`), onEnter:
    1. a shell step that increments `.spur/run/$wbs-escalation-count` (test-fix counter pattern);
    2. `file.read.into-var {path: .spur/run/${vars.wbs}-question.md, var: escalationQuestion}`;
    3. `hitl.input {prompt: "Task ${vars.wbs} asks: ${vars.escalationQuestion}"}`.
  - transitions:
    - `implement → failed`, shell guard: `test -s .spur/run/$wbs-question.md && [ "$(cat .spur/run/$wbs-escalation-count 2>/dev/null || echo 0)" -ge "$maxEscalations" ]`, with a preceding report append in the same guard command (`… && { echo "Unanswered escalation: $(cat …)" >> .spur/run/$wbs-report.txt; true; }`);
    - `implement → escalate`, guard `test -s .spur/run/$wbs-question.md`;
    - both are placed **before** the existing `implement → test` `always` edge;
    - `escalate → implement`, guard `test -n "$__hitlInput"`, then the fallback `escalate → failed` (`always`, with a report line saying the answer was empty) so an empty interactive answer never wedges the run.
  - Note: the implement onEnter `command.gate` wip transition and the format step still run after an escalated agent.run. Both are idempotent, so leave them.
- **Parity.** `plugins/sp/tests/inline-pipeline-parity-check.test.ts` must stay green. Add the `escalate` state to whatever state inventory it checks, and describe the host-session equivalent in `inline-pipeline-driver.md`: ask in session, append the Q/A to the same escalation file, re-dispatch implement, bound 2.
- **Skill/command docs:**
  - `plugins/sp/skills/code-implementation/SKILL.md`: new "Escalation contract" section (R4);
  - `plugins/sp/commands/dev-run.md`: `--escalation-file <path>` row for `--mode implement` only;
  - `execution-batch.md`: `paused` in the outcome vocabulary, Step 3 inspect branch, Step 5 report fields, and delete § Still out of scope;
  - `super-planner.md`: the outcome vocabulary line (`:265`) plus the out-of-scope bullet.
- **Tests:**
  - `packages/app/tests/workflow/actions/agent-run.test.ts` (or the existing agent-run test file): escalation cases;
  - a pipeline integration test in `plugins/sp/tests/` or `packages/app/tests/workflow/`, using the existing fake-executor harness that `task-pipeline-resilience.test.ts` uses: pause → continue `--answer-text` (through `WorkflowService.continuePaused({answerText})` from 0932) → re-dispatch → third escalation fails;
  - plugin contract asserts for the docs.
- **Invariants.**
  - A pipeline with no question file behaves byte-for-byte as today.
  - `requireDiff` is still enforced on the re-dispatched attempt.
  - Answers never enter argv.
  - The batch never answers on the operator's behalf.
- **Coordination.** Depends on 0932 (answerText) and 0931 (shared edits to execution-batch.md and super-planner.md; rebase after it).
- **Budget.** About 6 h. Mutation policy: code.
- **Out of scope.** Escalation from review/verify/test-fix; the steering channel; `spur message` Q&A; auto-answering.

### Plan

1. Rebase onto 0931 and 0932.
2. Write failing tests for the agent-run escalation cases. Implement `escalationFile`, then run the agent-run tests.
3. Write the failing pipeline integration test: pause, trace/progress question, `continue --answer-text`, re-dispatch input, third escalation → `failed`. Edit `task-pipeline.yaml` and run `bun run --filter @gobing-ai/spur build:bundle`.
4. Docs: the code-implementation escalation contract, the dev-run flag row, execution-batch `paused` + report + stale-section removal, inline driver parity, and super-planner. Add the plugin contract asserts and keep the parity test green.
5. Run `bun run spur-check` and `bun run plugin-smoke`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/workflow/actions/agent-run.ts:1103` |
| `packages/app/src/workflow/actions/agent-run.ts:125` |
| `packages/app/src/workflow/actions/agent-run.ts:43` |
| `packages/app/src/workflow/actions/agent-run.ts:516` |
| `packages/app/src/workflow/actions/agent-run.ts:615` |
| `packages/app/src/workflow/actions/agent-run.ts:891` |
| `packages/app/src/workflow/actions/agent-run.ts:906` |
| `packages/app/src/workflow/actions/agent-run.ts:969` |
| `packages/app/src/workflow/observability.ts:170` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:3` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:923` |
| `packages/app/tests/workflow/composition-baseline.test.ts:44` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:47` |
| `plugins/sp/tests/skill-structure.test.ts:767` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:19` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:27` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:35` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:385` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `agent.run` escalationFile option: exit-0 + non-empty question file ⇒ success with `data.escalated=true`; requireDiff (incl. 0487 scope guard) and expectFile skipped for that attempt; question file deleted before dispatch (0751 R3 freshness). agent-run.ts:613-632 (pre-dispatch delete mirroring the expectFile block), :892-902 (exit-0 detection), :906/:969 (expectFile/requireDiff skip), :1106 (`resultData.escalated = true`); tests agent-run.test.ts:980 (stale file deleted pre-dispatch), :1002 (undeletable stale ⇒ pre-dispatch failure), :914-928 (escalated ok), :939-950 (requireDiff skip) - test + static-ref |
| R2 | MET | `escalate` state: bounded counter (maxEscalations default 2), question surfaced via hitl.input; ask at bound with no answer ⇒ `failed` with the unanswered question appended to the task report; bound edge ordered before the question edge. task-pipeline.yaml:145 (maxEscalations="2"), :330-345 (counter → file.read.into-var escalationQuestion → hitl.input), :713-719 (implement→failed thin bound guard + failed onEnter conditional appending "## Escalation bound reached" + question text to `.spur/run/<wbs>-report.txt`); resilience tests :393-410 (state shape), :413-434 (edge order bound < question < always), :464-486 (bound routing, report.txt content, ordinary-failure no-op) - test + static-ref |
| R3 | MET | Resume: escalate→implement on non-empty answer; implement's first onEnter action appends `## Q<n>`/`## A<n>` to `.spur/run/<wbs>-escalation.md`, removes the question file, re-dispatches with `--escalation-file`; escalate→failed on empty answer. task-pipeline.yaml:250-257 (append + `rm -f` question), :271 (input flag), :284 (agent.run `escalationFile: <wbs>-question.md`), :747-748 (`test -n "$__hitlInput"` / `test -z "$__hitlInput"`); resilience tests :437-450 (thin-guard placement), :489-507 (first-entry no-op; resume-entry `## Q1`/`## A1` transcript + question consumed) - test + static-ref |
| R4 | MET | Implement agent contract: decide without asking; escalate only on scope/correctness/authorization ambiguity; write one question and exit 0; transcript answers binding; flag documented on --mode implement. code-implementation/SKILL.md:55-63 ("Escalation contract (task 0933, implement step only)"); dev-run.md:44-48 (`--escalation-file` row, pause/answer semantics); task-pipeline.yaml:268-271 (pipeline passes the flag through) - static-ref |
| R5 | MET | Inline driver honors escalationFile (escalated ⇒ skip requireDiff that attempt) and asks in-session at hitl.input (host-session exception, same 2-ask bound); batch report marks task `paused` (never done) with resume command `spur workflow continue <run> --answer-text "<answer>"`; anchors resolve. inline-pipeline-driver.md:245-253; execution-batch.md:217-219 (`continue --answer-text`), :416-421 (paused non-terminal + resume named); super-planner.md links execution-batch.md#step-3--the-driver-loop-r3-r4 (R16c-checked); skill-structure tests 89/89 (incl. R41 pinned input with --escalation-file) - test + static-ref |
| R6 | MET | Observability: escalation keeps the step in the composed stage set and the observability contract union; no JSON-schema change. agent-run.ts:21 (option plumbing), observability.ts:170-171 (`escalationFile` added to the contract union, no schema field); composition-baseline (implement:onEnter:1) green; `workflow validate --json` ok:true on the bundled definition - test + static-ref |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Headless implement needing a decision pauses the run: agent writes its question and exits 0; step succeeds with `data.escalated=true` (requireDiff/expectFile skipped that attempt); run enters `escalate` and pauses at hitl.input surfacing the question; stale question files cannot pause a later run. agent-run.test.ts:914-950, :980-1000 (freshness); task-pipeline.yaml:284, :321-328 (escalate-enter `test -s` question), :330-345; resilience tests :393-410. Command: cd packages/app && bun test tests/workflow/actions/agent-run.test.ts → 161 pass / 0 fail; full `bun run spur-check` → 8924 pass / 0 fail / 508 files |
| AC2 | MET | test | `spur workflow continue --answer-text "<answer>"` → escalate→implement guard passes on non-empty answer; implement onEnter appends `## Q1`/`## A1` to the transcript, consumes the question file, re-dispatches with `--escalation-file .spur/run/<wbs>-escalation.md`; implement agent treats answers as binding (R4 contract). resilience tests :489-507 (format + consumption + flag), :437-450; task-pipeline.yaml:250-257, :271, :747; code-implementation SKILL.md:55-63. `spur workflow continue --answer-text` itself landed in 0932 (verified PASS there) |
| AC3 | MET | test | Ask loop bounded (maxEscalations=2): at bound with a pending question implement routes to `failed` and the unanswered question lands in the task report; a third ask cannot loop; empty answer at escalate also routes to `failed`. resilience tests :464-486 (bound+fresh question ⇒ failed; bound without question ⇒ not; report.txt carries question text; ordinary failure no-op), :413-434 (edge order); task-pipeline.yaml:713-719, :752; agent-run freshness test blocks stale-question false pausing. Command: cd plugins/sp && bun test tests/task-pipeline-resilience.test.ts → 17 pass / 0 fail |
| AC4 | MET | test | Batch boundary: runner surfaces the paused question, accepts the answer via `spur workflow continue --answer-text`, resumes, and reports the task `paused` (non-terminal, never done) with the resume command until finished; docs (SKILL.md, dev-run.md, execution-batch.md, super-planner.md, driver) describe the flow with resolvable anchors; parity agrees across both reference sets. execution-batch.md:217-219, :416-421, :990 (WT-5 retain); dev-run.md:44-48; driver :245-253. Commands: bun run plugins/sp/scripts/inline-pipeline-parity-check.ts → "ok (11 actions, 4 guards agree across 10 workflows and both reference sets)"; cd plugins/sp && bun test tests/skill-structure.test.ts → 89 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature `docs/features/H1_spur-dev-skill.md` R26, R27, R29 and R30 (these supersede 0142 R7.x).
- `packages/app/src/workflow/actions/agent-run.ts:43`, `:110-135`, `:921-960`; `packages/app/src/workflow/actions/hitl-input.ts`; `packages/app/src/workflow/actions/file-read-into-var.ts`.
- `config/workflows/task-pipeline.yaml`:
  - `implement` `:211-285`;
  - `test-fix` counter `:343-390`;
  - `approve` pause `:455-468`.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:887-891`; `plugins/sp/agents/super-planner.md:265`, `:277`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `plugins/sp/skills/code-implementation/SKILL.md`; `plugins/sp/commands/dev-run.md`.
- ADR-043 (pure slash inputs), ADR-116 (retired workspace, inbox and teams).
- Depends on 0931 and 0932.

### History

- 2026-09-23T06:58:40.383Z backlog → todo (system)
- 2026-09-24T20:01:45.255Z todo → wip (system)
- 2026-09-24T21:23:53.818Z wip → testing (system)
- 2026-09-24T21:24:25.466Z testing → done (system)

