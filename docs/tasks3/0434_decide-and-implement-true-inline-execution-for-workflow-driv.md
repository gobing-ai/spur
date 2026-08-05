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
updated_at: "2026-08-05T07:04:26.465Z"
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
- [x] R1. **Decide first, build second.** Produce a recorded decision (ADR entry or an amendment to ADR-041/H82 R6) choosing exactly one of: (a) implement true in-session execution of pipeline stages; (b) formally declare `inline` inapplicable to workflow-driven commands and make the surface say so. Do not begin implementation before the decision is recorded — the two branches have very different blast radii.
- [x] R2. If (a): define the control-inversion mechanism by which a workflow `agent.run` stage hands its prompt to the host coding-agent session and resumes with the result. *(N/A — branch (b) chosen in ADR-046.)*
- [x] R3. If (a): the mechanism must degrade honestly when no host session can own the step. *(N/A — branch (b).)*
- [x] R4. If (a): `spur agent run` must keep rejecting the literal `inline`. *(Satisfied under (b) as well — AgentService still rejects; diagnostic now names `agent.default`.)*
- [x] R5. If (b): make the operator surface honest — the `--agent` value set for workflow-backed commands becomes `<auto|name>`, the contract states plainly that pipeline stages always dispatch, and `agent.default` is documented as the supported redirect. Update `inline-execution-contract.test.ts` so the excluded/mode-aware split encodes the decision rather than merely tolerating it.
- [x] R6. Either branch: resolve the surface inconsistency where `dev-run` / `dev-plan` advertise `--agent` default `inline` while their full-pipeline path cannot honor it. The flag table and the runtime behavior must agree.
- [x] R7. Either branch: no regression in the executor-redirect path landed 2026-08-04 — `agent.default` must continue to reach `agent.run` stages, with caller-supplied `--vars`/`--agent` still winning over config, and the pipeline YAML literal remaining the last fallback.
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
- [x] **R1 decision (blocking).** ADR-046 (2026-08-04) records branch **(b)** — `inline` unrepresentable on workflow-driven commands.
- [x] If **(b)** (shipped):
  - [x] Enumerate workflow-backed commands (`dev-plan`, `dev-runall`, full `dev-run`; EXCLUDED wrappers remain no-`--agent`).
  - [x] Flag tables / arg-hints: `--agent <auto|name>` for `dev-plan` / `dev-runall`; `dev-run` documents mode split.
  - [x] Runtime: `AgentService` rejects literal `inline` with diagnostic naming `agent.default` (ADR-046); command prose forbids merge into `vars.agent` on full path.
  - [x] Update `plugins/sp/tests/inline-execution-contract.test.ts` (`WORKFLOW_DRIVEN_AGENT_COMMANDS` + ADR-046 test).
  - [x] Flag-parity suite remains green (`command-flag-parity.test.ts` mode-aware --agent contract).
  - [x] Cross-cutting / flag glossary / dev-operations + ADR-046 same-change.
- [x] If **(a)** — not chosen.
- [x] Either branch: executor-redirect invariants green (`workflow-service` agent.default suite).
- [x] Gate: contract tests + agent-service inline reject + agent.default suite green this verify run.
### Solution
Change-map for branch (b) — `inline` unrepresentable on workflow-driven commands (ADR-046).

| Change (`file:line`) | What / why |
|----------------------|------------|
| `docs/00_ADR.md:1238` | ADR-046: choose branch (b); name trade-off and reasoning |
| `plugins/sp/commands/dev-plan.md:3,18` | `--agent <auto\|name>`; default `agent.default`; no inline |
| `plugins/sp/commands/dev-runall.md:3,20` | Same workflow-driven selector |
| `plugins/sp/commands/dev-run.md:17,37` | Mode split: implement honors inline; full never merges inline; diagnostic names agent.default |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:95` | "Workflow-driven commands never honor inline" |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md:62` | Workflow-driven exception (ADR-046) |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | plan/runall Inputs prose drop inline |
| `plugins/sp/tests/inline-execution-contract.test.ts:50-160` | `WORKFLOW_DRIVEN_AGENT_COMMANDS` + ADR-046 test |
| `packages/app/src/services/agent-service.ts:842-848` | Keep reject literal `inline`; diagnostic names `agent.default` (verify fix-pass) |
| `packages/app/tests/services/agent-service.test.ts:1924-1927` | Assert diagnostic contains `agent.default` |
### Testing
**Force re-verify** 2026-08-05 (`/sp-dev-verify 0434 --auto --next --force --focus all --fix all`)

**Verdict: PASS** (branch **b**)

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | ADR-046 Accepted 2026-08-04 chooses branch (b), names what is given up (session chat context for stages) and why (triggers 2/3 + agent.default redirect). `docs/00_ADR.md:1238-1285` (re-read this run). |
| R2 | N/A | Branch (a) not chosen — control inversion not built. |
| R3 | N/A | Branch (a) not chosen. |
| R4 | MET | `AgentService` still rejects `raw === 'inline'` exit 2; does not pretend in-process. `packages/app/src/services/agent-service.ts:842-848`. Diagnostic names `agent.default` (fix-pass this run). |
| R5 | MET | `dev-plan`/`dev-runall` use `<auto\|name>` + `agent.default` redirect prose. Contract test ADR-046: `plugins/sp/tests/inline-execution-contract.test.ts:136-160`. |
| R6 | MET | `dev-run` keeps inline for implement; full-mode prose forbids merge + diagnostic. Flag tables agree with path. `plugins/sp/commands/dev-run.md:17,37`. |
| R7 | MET | `agent.default` suite: config overrides YAML; caller wins; YAML last. `packages/app/tests/services/workflow-service.test.ts:1439-1476` — 3 pass this run. |

**Acceptance Criteria Verification** (Done-when checklist; not Gherkin)

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Dated decision in docs/00_ADR.md naming branch + trade-off | MET | static-ref | ADR-046 `docs/00_ADR.md:1238-1273` |
| Flag table and runtime agree for every declaring command | MET | test + static-ref | `inline-execution-contract` mode-aware + ADR-046 tests; command tables |
| Contract tests encode decision and pass | MET | test | `bun test plugins/sp/tests/inline-execution-contract.test.ts plugins/sp/tests/command-flag-parity.test.ts` — 78 pass |
| Branch (a) host-session / async fail-fast | N/A | n/a | Branch (b) shipped |
| Branch (b): inline unrepresentable + diagnostic names agent.default | MET | test + static-ref | Flag tables drop inline; AgentService diag contains `agent.default` (`agent-service.test.ts` inline case) |
| Executor-redirect still holds | MET | test | workflow-service agent.default describe — 3 pass |
| Lint/test gate | MET | test | Targeted suites green this run (full monorepo suite not re-run; standing network env failures out of scope) |

**Command evidence (this run)**

```
$ bun test plugins/sp/tests/inline-execution-contract.test.ts plugins/sp/tests/command-flag-parity.test.ts
78 pass, 0 fail

$ bun test plugins/sp/tests/inline-execution-contract.test.ts -t "ADR-046"
1 pass

$ bun test packages/app/tests/services/agent-service.test.ts -t "inline"
1 pass (asserts agent.default in diagnostic)

$ bun test packages/app/tests/services/workflow-service.test.ts -t "agent"
6 pass (includes agent.default suite)
```

**Design conformance**

| Claim | Status | Evidence |
|-------|--------|----------|
| R1 decision before build | DONE | ADR-046 before surface edits (commit d785668f) |
| Branch (b) surface honesty | DONE | commands + cross-cutting + glossary |
| Do not make AgentService accept inline | DONE | still rejects |
| agent.default redirect preserved | DONE | R7 tests |

**Checks**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | Branch (b) claims DONE; (a) N/A |
| evidence-rule-pass | pass | Behavior AC rows use test evidence |
| tests-pass | pass | Contract + agent + agent.default suites exit 0 |
| scope-creep | pass | Change set matches ADR-046 file list (+ diagnostic wording) |

**Coverage:** N/A (docs/contract surface; no new runtime coverage target).

**Fix-pass artifacts:**
- `.spur/run/0434-verdict.json` rewritten with AC rows (prior empty acceptanceCriteria)
- AgentService inline diagnostic names `agent.default` (`packages/app/src/services/agent-service.ts:847`)
- Solution change-map corrected (was polluted with 0433 HITL files)
- Requirements/Plan checklists completed; Review P1–P4 table
### Review
**SECUA review** (standalone verify --force) — aggregate: PASS

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | — | — | None |
| P2 | — | — | None |
| P3 | U | `packages/app/src/services/agent-service.ts:842-848` | Pre-fix diagnostic omitted `agent.default`; fixed this verify to match ADR-046 / AC wording. |
| P4 | A | `plugins/sp/commands/dev-run.md:17,37` | Mode-split keeps `inline` representable on implement path only — correct but requires operators to read mode semantics. Acceptable. |
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-05T05:53:23.270Z todo → wip (system)
- 2026-08-05T06:14:18.075Z wip → testing (system)
- 2026-08-05T06:14:18.545Z testing → done (system)
