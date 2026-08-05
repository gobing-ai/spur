---
template: standard
schema_version: 1
name: "Decide and implement true inline execution for workflow-driven pipeline stages"
description: ""
status: done
type: task
profile: standard
feature_id: H82
parent_wbs: null
priority: P2
tags: []
dependencies: ["0433"]
created_at: "2026-08-04T19:04:35.799Z"
updated_at: "2026-08-05T06:14:18.545Z"
---

## 0434. Decide and implement true inline execution for workflow-driven pipeline stages

### Background
`--agent inline` is the documented default of the `/sp:dev-*` surface (ADR-041), but it is
**structurally unhonorable** for any command whose model-bearing work is a workflow `agent.run`
stage. Proven live on 2026-08-04 with a one-step probe workflow:

```
$ spur workflow run probe.yaml --vars '{"agent":"inline"}'
✗ start/agent.run (0s) · agent.run 'start' (inline) dispatch failed: 'inline' selects in-session
  execution and cannot be passed to 'spur agent run', which always starts a subprocess.
```

`agent.run` dispatches unconditionally, and `AgentService` rejects the literal `inline` with exit 2
(`packages/app/src/services/agent-service.ts`, the `raw === 'inline'` branch). So on a pipeline the
flag's default value can never be applied: either it is silently not merged into `vars.agent` (what
actually happens), or it is merged and every stage fails.

**What this task is NOT.** Task 0431/0432/0433 and the `agent.default` injection landed 2026-08-04
already fixed the *practical* consequence — an operator whose executor is unhealthy can now redirect
pipelines by changing one config key, because `spur workflow run` injects `agent` from
`.spur/config.yaml` `agent.default` instead of the hardcoded `agent: "omp"` literal every pipeline
YAML declares. That closed the blocker. This task is about the remaining *semantic* gap: the flag
still advertises a value it cannot deliver on this class of commands.

**Relationship to H82 R6.** H82's R6 scenario was amended on 2026-08-02 to settle the opposite
position — that `--agent` addressing the pipeline's stages via `vars.agent` **is** the general rule,
not a carve-out, on the reasoning that an orchestrator loop executes no prompts. That reasoning is
sound for *who* runs the stages. It does not resolve what `inline` means when the operator's answer
is "this session should run them," which is the case an operator hits when their subprocess executor
is broken or when they want the stage to see the session's context. This task revisits that
specific corner; it does not reopen R6's conclusion about the loop.

Evidence trail: `plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface`
(the one rule), `execution-workflow.md` (pipeline stages are subprocess under triggers 2/3),
`plugins/sp/tests/inline-execution-contract.test.ts` (`EXCLUDED_COMMANDS` names `dev-idea`,
`dev-wrap`, `dev-wrapall` as workflow-backed and deliberately not mode-aware).
### Requirements
- [ ] R1. **Decide first, build second.** Produce a recorded decision (ADR entry or an amendment to
      ADR-041/H82 R6) choosing exactly one of: (a) implement true in-session execution of pipeline
      stages; (b) formally declare `inline` inapplicable to workflow-driven commands and make the
      surface say so. Do not begin implementation before the decision is recorded — the two branches
      have very different blast radii.
- [ ] R2. If (a): define the control-inversion mechanism by which a workflow `agent.run` stage hands
      its prompt to the host coding-agent session and resumes with the result. The existing HITL
      pause/resume machinery (`pause: true`, persisted `__hitlAnswer`, `spur workflow continue`) is
      the closest existing seam — evaluate reusing it before inventing a second suspension path.
- [ ] R3. If (a): the mechanism must degrade honestly when no host session can own the step —
      a detached `--async` worker, a scheduled run, or any headless caller must not silently hang
      waiting for a session that will never answer (this is objective trigger 2).
- [ ] R4. If (a): `spur agent run` must keep rejecting the literal `inline` — in-session execution is
      resolved by the command/workflow layer, never by the subprocess dispatcher. The fix must not
      make `AgentService` pretend to run something in-process.
- [ ] R5. If (b): make the operator surface honest — the `--agent` value set for workflow-backed
      commands becomes `<auto|name>`, the contract states plainly that pipeline stages always
      dispatch, and `agent.default` is documented as the supported redirect. Update
      `inline-execution-contract.test.ts` so the excluded/mode-aware split encodes the decision
      rather than merely tolerating it.
- [ ] R6. Either branch: resolve the surface inconsistency where `dev-run` / `dev-plan` advertise
      `--agent` default `inline` while their full-pipeline path cannot honor it. The flag table and
      the runtime behavior must agree.
- [ ] R7. Either branch: no regression in the executor-redirect path landed 2026-08-04 —
      `agent.default` must continue to reach `agent.run` stages, with caller-supplied `--vars`/
      `--agent` still winning over config, and the pipeline YAML literal remaining the last fallback.
### Acceptance Criteria
Completion conditions. Deliberately not expressed as BDD scenarios: this task's first deliverable is
a recorded decision, and its observable behavior depends on which branch that decision takes — so it
maps to no existing H82 scenario. Encoding it as one would assert coverage over H82 R6, which
settled a different question. Once R1 picks a branch, the chosen branch's behavior should be
promoted into feature-level scenarios before implementation starts.

**Done when all of the following hold:**

- A dated decision exists in `docs/00_ADR.md` (new entry, or an amendment to ADR-041 and H82 R6)
  naming the chosen branch and the reasoning, including what was given up. A decision that merely
  restates the current behavior without addressing the unhonorable-default problem does not satisfy
  this.
- The `--agent` surface and its runtime behavior agree for **every** declaring command: no command's
  flag table advertises a default value that its execution path cannot apply. Verifiable by reading
  each declaring command's table against the path it dispatches.
- `plugins/sp/tests/inline-execution-contract.test.ts` and
  `plugins/sp/tests/command-flag-parity.test.ts` encode the decision — the mode-aware / excluded
  split and the accepted value sets follow from the recorded ADR rather than from historical
  accident. Both suites pass.
- If branch (a) shipped: a workflow whose stage is marked for in-session execution completes with
  the host session having produced the stage's output, and the same workflow started with `--async`
  fails fast with a message naming the headless trigger instead of hanging.
- If branch (b) shipped: `--agent inline` is unrepresentable on workflow-backed commands, and
  attempting it produces a diagnostic naming `agent.default` as the supported redirect.
- The 2026-08-04 executor-redirect behavior still holds: a project `agent.default` reaches
  `agent.run` stages, an explicit `--vars '{"agent":…}'` overrides it, and the pipeline YAML literal
  applies only when nothing is configured. Covered by the existing tests in
  `packages/app/tests/services/workflow-service.test.ts`.
- `bun run lint` and `bun run test` are green, with the standing sandbox-only network failures
  identified as environmental rather than silently accepted.
### Q&A
**Q (R1, --auto synthesis):** Which branch should the ADR record?

**Recommendation: (b)** — declare `inline` inapplicable to workflow-driven commands and make the surface say so.

Reasoning:
1. Triggers 2/3 in the inline-default contract already mark pipeline stages as durable, timed, independently audited units — subprocess is the correct surface, not an accident.
2. The practical "broken executor / wrong default agent" pain is already fixed by `agent.default` injection into `vars.agent` (2026-08-04); operators redirect without control inversion.
3. Branch (a) is a large inversion (host session ↔ engine pause), depends on 0433's resume-with-payload path, and must fail-fast for every headless caller — high blast radius for a corner the redirect already covers.
4. Branch (b) is honest docs + flag parity + reject-with-diagnostic; small, testable, aligns EXCLUDED_COMMANDS with a real rule instead of historical accident.

What (b) gives up: an operator cannot force a pipeline stage to consume the current session's chat context. Accept that trade-off explicitly in the ADR; if a future product need appears, open a new task for (a) rather than leaving the default unhonorable.

Operator may override before implement by amending the ADR to (a); then follow the Plan's (a) checklist after 0433 is done.
### Design
**The structural obstacle.** `spur workflow run` is a CLI process. The coding-agent session that
typed the command is its parent, not its child. A workflow `agent.run` stage therefore has no
in-process route back to that session — which is exactly why `inline` is resolved at the command
wrapper layer today and never reaches `AgentService`. Any branch (a) implementation must invert that
relationship, not add a flag.

**Sketch of branch (a), for costing — not a commitment.** Reuse the existing suspension seam rather
than inventing a second one:

1. A stage declares in-session eligibility (a field on `agent.run`, or a reserved `vars.agent` value
   the action layer interprets — not a value forwarded to `AgentService`).
2. On entering such a stage the run persists the resolved prompt and pauses, exactly as a
   `hitl.confirm` gate does today.
3. The host session reads the pending prompt, executes it in-session, and writes the result back
   through a CLI verb, which resumes the run.
4. Resumption continues the FSM with the stage's output recorded as if a subprocess had produced it.

That is a control inversion over the HITL pause machinery, and it inherits that machinery's known
weakness: task 0433 documents that a paused gate cannot currently be answered from a headless
session because `spur workflow continue` has no `--answer` path. **0433 is therefore a prerequisite
for branch (a)** — the resume-with-payload path it needs is the same path 0433 must build. Sequence
0433 first, or fold this into it.

**Why branch (b) may be the right answer.** The four objective triggers in
`cross-cutting.md#inline-default-execution-surface` already justify subprocess dispatch for pipeline
stages on their own terms: a pipeline stage is a durable, auditable, independently-timed unit
(triggers 2 and 3). If those triggers are genuinely always satisfied for pipeline stages, then
`inline` is not merely unimplemented there — it is semantically wrong, and the honest fix is to make
it unrepresentable rather than to build machinery that contradicts the contract. The decision in R1
turns on whether an operator ever legitimately wants a pipeline stage to run in-session; the
strongest case for "yes" is a broken subprocess executor, which the `agent.default` redirect landed
on 2026-08-04 already addresses without any inversion.

**Do not** resolve this by making `AgentService` accept `inline` and shell out to the host session —
that reintroduces a subprocess under a name that promises the opposite.
### Plan
- [ ] **R1 decision (blocking).** Record a dated ADR entry (new, or amendment to ADR-041 / H82 R6) choosing exactly one branch:
  - **(a)** true in-session execution of pipeline `agent.run` stages, or
  - **(b)** `inline` unrepresentable on workflow-driven commands; surface + tests tell the truth.
  Do not implement until the ADR lands. Recommended lean under this refine: **(b)** — see Q&A.
- [ ] If **(b)** (recommended path):
  - [ ] Enumerate every workflow-backed command (`dev-idea`, `dev-wrap`, `dev-wrapall`, full `dev-run` pipeline path, `dev-runall`, and any other EXCLUDED / Skill→workflow wrappers).
  - [ ] Flag tables / arg-hints: drop `inline` from the accepted set for those commands (`--agent <auto|name>` only); document that stages always dispatch and `agent.default` is the redirect.
  - [ ] Runtime: reject `--agent inline` on those paths with a diagnostic naming `agent.default` (and optionally `--agent <name>` / `--agent auto`).
  - [ ] Update `plugins/sp/tests/inline-execution-contract.test.ts` so EXCLUDED/mode-aware split and accepted values encode the ADR.
  - [ ] Update `plugins/sp/tests/command-flag-parity.test.ts` accepted sets accordingly.
  - [ ] Cross-cutting / flag glossary / ADR-041 amendment: one sentence that pipeline stages never honor `inline`.
- [ ] If **(a)** (only if ADR chooses it — after 0433 lands):
  - [ ] Spec control inversion: stage marks in-session eligibility → persist prompt → pause → host session executes → CLI write-back → resume (reuse HITL pause seam; **0433 `--answer`/payload resume is prerequisite**).
  - [ ] Fail-fast when no host session can own the step (`--async`, scheduled, headless) — trigger 2.
  - [ ] Keep `AgentService` rejecting literal `inline` (R4).
  - [ ] Tests: host-session completion path + async fail-fast path.
- [ ] Either branch: re-verify executor-redirect invariants (2026-08-04) — `agent.default` → stages; caller `--vars`/`--agent` wins; YAML literal last. Existing `workflow-service` tests must stay green.
- [ ] Gate: `bun run lint` + `plugins/sp` contract tests + app workflow-service tests green.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:429` |
| `apps/cli/src/commands/workflow.ts:436` |
| `apps/cli/src/commands/workflow.ts:464` |
| `apps/cli/src/commands/workflow.ts:473` |
| `apps/cli/src/commands/workflow.ts:479` |
| `apps/cli/tests/commands/workflow.test.ts:284` |
| `packages/app/src/services/workflow-service.ts:416` |
| `packages/app/src/services/workflow-service.ts:442` |
| `packages/app/src/services/workflow-service.ts:452` |
| `packages/app/src/services/workflow-service.ts:476` |
| `packages/app/src/services/workflow-service.ts:490` |
| `packages/app/src/services/workflow-service.ts:497` |
| `packages/app/src/services/workflow-service.ts:500` |
| `packages/app/src/services/workflow-service.ts:646` |
| `packages/app/src/services/workflow-service.ts:653` |
| `packages/app/src/services/workflow-service.ts:655` |
| `packages/app/src/services/workflow-service.ts:667` |
| `packages/app/src/services/workflow-service.ts:675` |
| `packages/app/src/services/workflow-service.ts:683` |
| `packages/app/tests/services/workflow-service.test.ts:283` |
| `packages/app/tests/services/workflow-service.test.ts:795` |
| `plugins/sp/tests/inline-execution-contract.test.ts:115` |
| `plugins/sp/tests/inline-execution-contract.test.ts:119` |
| `plugins/sp/tests/inline-execution-contract.test.ts:125` |
| `plugins/sp/tests/inline-execution-contract.test.ts:136` |
| `plugins/sp/tests/inline-execution-contract.test.ts:50` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 (decide first) | MET | ADR-046 appended to `docs/00_ADR.md` (2026-08-04) choosing branch (b), naming what is given up and the reasoning (pipeline stages are durable/auditable/timed units; the practical pain is closed by `agent.default` injection). |
| R2-R4 (branch a) | N/A | Branch (b) chosen; no in-session control inversion built, `AgentService` still rejects literal `inline`. |
| R5 (surface honest) | MET | `dev-plan` and `dev-runall` carry `--agent <auto\|name>` with default `agent.default`; bodies state stages always dispatch and `inline` is not acceptable (ADR-046). `inline-execution-contract.test.ts` gains a `WORKFLOW_DRIVEN_AGENT_COMMANDS` set and an ADR-046 test. |
| R6 (surface/runtime agree) | MET | `dev-run` keeps `inline` (implement mode) but its flag-table default + body make the full-mode restriction explicit: full mode never merges `inline` into `vars.agent`; explicit `--agent inline` on the full path surfaces a diagnostic naming `agent.default`. dev-operations.md rows 6/13 + Inputs prose updated. |
| R7 (executor-redirect no regression) | MET | Existing workflow-service tests for `agent.default` reaching `agent.run` stages still pass (68 tests). Caller `--vars`/`--agent` still win over config; YAML literal last fallback unchanged. |
| R8 (ADR same-change docs) | MET | `cross-cutting.md`, `flag-glossary.md`, `dev-operations.md`, and ADR-046 updated same-change. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-05T05:53:23.270Z todo → wip (system)
- 2026-08-05T06:14:18.075Z wip → testing (system)
- 2026-08-05T06:14:18.545Z testing → done (system)
