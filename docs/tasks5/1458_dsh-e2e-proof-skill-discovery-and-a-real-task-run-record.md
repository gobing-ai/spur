---
schema_version: 1
name: "dsh E2E proof: skill discovery and a real task run record"
status: done
template: feature-impl
created_at: 2026-11-26T20:35:39.278Z
updated_at: "2026-11-27T06:23:07.330Z"
feature_id: B81
priority: P2
tags:
  - dsh
  - agent
  - e2e

dependencies: ["1457"]
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1458. dsh E2E proof: skill discovery and a real task run record

### Background

Covers R10, R11. Proves the whole path on a real host: dsh discovers the sp skills Superskill installed, and a Spur task dispatched to the dsh executor completes and leaves a run record. Design: docs/design/dsh-agent-integration.md §4 and §6.

**Refine corrections (2026-11-26)**

- "dsh lists the sp-* skills" → dsh has no skill-listing CLI verb (`dsh --profile headless --help` shows only task/--json/--session-id/--permission-mode/--approval-policy/--add-dir); skills reach the model through the `skill` tool (`vendors/deepseek-harness/packages/skill/tool-skill/src/index.ts:94`) from `<agentsHome>/skills` (`vendors/deepseek-harness/packages/skill/skill-filesystem/README.md:54`) → the proof asks dsh to load one named sp skill and asserts a `tool_call` event for `skill` with that name, followed by a non-error `tool_result`, in the `--json` stream.
- `~/.agents/skills` presence → 91 `sp-*` skills are installed there now (`ls ~/.agents/skills`) → the E2E reads the real root and never writes it.
- Executor id → the executor is `deepseek` (binary `dsh`), per 1457's correction.
- Heavy-test convention → heavy suites are `*.heavy.test.ts` run by `test:heavy` (`package.json` scripts, `bunfig.heavy.toml`), e.g. `apps/cli/tests/workflow/grok-bot-notify-recipe.heavy.test.ts` → the E2E lives at `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts`.
- Sandbox → dsh writes under `$DSH_HOME` (default `~/.dsh`); a sandboxed run cannot write `~/.dsh/profiles/headless` (observed EPERM on 2026-11-26) → run the E2E outside the agent sandbox, or report it unrun.

### Requirements

- [x] R10. a dsh `--json` run loads a named `sp-*` skill from ~/.agents/skills through the `skill` tool (a `tool_call` + non-error `tool_result` in the stream)
- [x] R11. one bounded task runs through the `deepseek` executor, exits 0, leaves a Spur run record naming it, and writes a repeatable receipt (dsh version, session id, run id)

### Acceptance Criteria

- [x] AC1 — sp skills are discovered by dsh
- [x] AC2 — A real task runs through dsh and leaves a Spur run record

After this passes, decide whether dsh joins a default tier (ADR-153 moves to Accepted).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T20:36:34.278Z

- No mocked dsh. Reason: only a real binary proves the NDJSON contract.
- The model provider comes from the operator's dsh profile. Reason: Spur stores no agent API keys.

#### Q&A entry — 2026-11-26T21:29:20.276Z

#### Q&A entry — 2026-11-26 (refine --depth ready)

- Prove skill discovery with a `skill` tool_call in the `--json` stream, not with model prose. Reason: dsh has no list verb, and prose is non-deterministic.
- Run outside the agent sandbox. Reason: dsh must write `$DSH_HOME` (EPERM observed in the sandbox).

### Design

Approach: one heavy E2E, `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts`, skipped with a stated reason when `dsh` is not on PATH. Case 1 runs `dsh --profile headless --json -` in a temp git project with a prompt to load one named sp skill, and asserts the `skill` tool_call/tool_result pair. Case 2 dispatches one bounded task through `spur agent run` with the `deepseek` executor and asserts exit 0 plus a run record. The receipt goes to `.spur/run/e2e/dsh-executor-receipt.json`. Reason: AGENTS testing policy prefers E2E with a repeatable artifact.
Rejected: mocked dsh, which proves nothing about the real contract; asserting on model prose to show skill discovery, which is non-deterministic.
Invariants: the test never reads dsh credentials; the model provider comes from the operator's dsh profile; ~/.agents/skills is read-only to the test.

### Plan

1. Requires 1457.
2. Write `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts`, modelled on `grok-bot-notify-recipe.heavy.test.ts`, skipping with a stated reason when `dsh` is not on PATH.
3. Skill discovery: in a temp git project, run `dsh --profile headless --json -` asking it to load one named sp skill; assert the `skill` tool_call naming it, a non-error tool_result, and exit 0.
4. Dispatch one bounded task to the `deepseek` executor and assert exit 0 plus a Spur run record that names it.
5. Write the receipt JSON (dsh version, session id, run id) to `.spur/run/e2e/dsh-executor-receipt.json`.
6. Run `bun run test:heavy` outside the agent sandbox, then record the decision on dsh tier membership and ADR-153 acceptance.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts` | 1-215 | The two-leg E2E (R10/R11): leg 1 runs `dsh --profile headless --json --permission-mode workspace-write --approval-policy never -- <prompt>` in a temp git project and asserts a `tool_call` with `tool: skill` + `input.name`, its paired non-error `tool_result`, and `final.reason.kind === completed`; leg 2 runs `spur agent run … --agent deepseek --json` there and asserts exit 0, `resolved.executor === deepseek`, and the durable `.spur/memory/runs/<runId>.md` record headed with the executor and run id |
| `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts` | 51-76 | Temp project fixture: the `deepseek` executor config (with the `executionCapabilities` attestation dispatch requires) is written per run, so the E2E never mutates the repo's own config; the two `SPUR_SKIP_*_CONFIG` switches the suite preload sets are dropped for the child so that project layer is actually read |
| `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts` | 150-215 | Receipt at `.spur/run/e2e/dsh-executor-receipt.json`: dsh version, skill name/status, session id, Spur run id, executor, run-record path — the repeatable artifact the task asks for |
| `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts` | 128-135 | Skip conditions stay explicit (no `dsh` on PATH, no `sp-*` skill installed) and state their reason in the run output, so a skip never reads as a pass |
| `docs/00_ADR.md` | 3052-3082 | ADR-153 moves Proposed → Accepted with the 1458 acceptance evidence, and records the tier decision: the shipped `deepseek` executor stays `disabled` and tier-less, because joining a default rung is an operator cost/quality opt-in for their own dsh profile |
| `docs/design/dsh-agent-integration.md` | 1-7 | Design status → accepted, matching the ADR |

Tier-membership decision (task Plan step 6): **dsh does not join a default tier.** The wrap is proven
(R10/R11 pass), but the shipped global config is a user-owned seed: promoting `deepseek` into a rung
would dispatch a user's work to a model their dsh profile may not provision. Enabling it is a
documented one-line opt-in (`disabled: false` plus `executionCapabilities`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R10 | MET | `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts:154-170` asserts `tool_call` `tool: skill` + paired completed `tool_result` + exit 0; last green run's receipt `.spur/run/e2e/dsh-executor-receipt.json` (capturedAt 2026-11-27T05:50:16Z, skill `sp-brainstorm` completed) and its dsh session `~/.dsh/sessions/…/session-3cfd3b91-81fa-4494-b3c0-f0f7843432e8` exist (inspected this run). Re-run this session is sandbox-blocked: dsh EPERM rewriting `~/.dsh/profiles/headless/cordis.yml`; task Plan step 6 requires running outside the agent sandbox |
| R11 | MET | `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts:177-215` asserts `spur agent run --agent deepseek` exit 0, `resolved.executor === 'deepseek'`, `.spur/memory/runs/<runId>.md` record; receipt carries dshVersion 0.2.2-rc.1, sessionId, runId bdb9cb0f-…, executor deepseek |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts:154-170` + receipt `.spur/run/e2e/dsh-executor-receipt.json` (green outside sandbox 2026-11-27T05:50Z; in-sandbox re-run blocked by EPERM on `~/.dsh`) |
| AC2 | MET | test | `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts:177-215` + same receipt (runId, executor deepseek, runRecord path) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

# Review — task 1458 (dsh E2E proof)

| Req | Status | Evidence |
| --- | --- | --- |
| R10 | MET | `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts:150-176` runs a real `dsh 0.2.2-rc.1` `--json` turn asking for the `sp-brainstorm` skill and asserts three things from the NDJSON stream: a `tool_call` with `tool: skill` and `input.name === 'sp-brainstorm'`, its paired `tool_result` with `status: completed`, and `final.reason.kind === 'completed'` under exit 0. Receipt records `skill: {name: sp-brainstorm, status: completed}` (`.spur/run/e2e/dsh-executor-receipt.json`) |
| R11 | MET | Same test `:177-203`: `spur agent run … --agent deepseek --json` in a temp project exits 0 with `resolved.executor === 'deepseek'`, and the durable record `.spur/memory/runs/<runId>.md` is headed `spur agent run <runId> — deepseek — started …`; the receipt carries `dshVersion: 0.2.2-rc.1`, `sessionId`, `runId`, `executor: deepseek` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts:150-176` — real dsh `skill` tool_call + completed tool_result for `sp-brainstorm` (green: 8.8 s, receipt `.spur/run/e2e/dsh-executor-receipt.json`) |
| AC2 | MET | test+command | `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts:177-203` — exit 0, `resolved.executor = deepseek`, run record `.spur/memory/runs/<runId>.md` naming the executor; re-run after the env fix: 1 pass / 0 fail |

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| P3 | Leg 2 proves the executor path with a one-word prompt, not a repository task; the "bounded task" is bounded to a conversational reply, so it does not exercise fs write or a commit inside a worktree (which is exactly where `--add-dir <git-common-dir>` was deferred). | Accepted: R11 asks for one bounded task through the executor plus a run record; tool use is already covered by leg 1 (`skill` tool + `read` tool calls in the same stream). If a dsh stage must commit from a worktree, the deferred `--add-dir` follow-up is the owner (1456 Design). |
| P3 | The E2E depends on the operator's dsh profile holding a usable model provider and on `~/.agents/skills` carrying `sp-*` skills; both are skip preconditions, so an unprovisioned host records a skip (with its reason) rather than a failure. | Accepted and stated in the test (`:128-135`); the task's Q&A already ruled out mocking dsh. |
| P4 | The pipeline's `gate` state reused the light receipt for this tree (`quality gate DEFERRED`), so the per-task evidence is light-tier; the full pass belongs to the feature-scoped run. | Recorded for the batch close: the full `spur-check` runs once on the integrated tree before landing. |

Tier decision recorded in `docs/00_ADR.md:3052-3082`: ADR-153 → Accepted, `deepseek` stays
`disabled` with no tier (operator opt-in).

Verdict: PASS

**Residual closure (2026-11-27):** the P4 `--add-dir` deferral is closed as not needed — executors never commit; worktree commits are driver-owned (`plugins/sp/skills/spur-dev/references/execution-worktree.md:381-396`). See the Q&A entry of 2026-11-27.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-26T21:03:52.262Z feature_id U → B81 (system)
- 2026-11-27T05:03:08.380Z todo → wip (system)
- 2026-11-27T05:03:53.489Z wip → testing (system)
- 2026-11-27T05:03:55.396Z testing → done (system)

