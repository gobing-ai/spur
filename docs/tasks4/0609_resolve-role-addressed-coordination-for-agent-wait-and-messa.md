---
schema_version: 1
name: "Resolve role-addressed coordination for agent wait and message"
status: todo
template: feature-impl
created_at: 2026-08-20T00:09:15.116Z
updated_at: "2026-08-20T00:40:40.343Z"
feature_id: D6
---

## 0609. Resolve role-addressed coordination for agent wait and message

### Background
Implements feature D6 scenario R6.

**Provenance.** The original workflow-refactor brief said: *"we already finished to add role support for `spur agent run`, if we can continously to add role support to the other `spur agent` comands and `spur message` commands, then we can leverage them more efficiently to enable the spur workldow."* Feature D5 answered this with R6 — a **deferral**, not an implementation: role execution stays on `agent.run`, `wait` and `message` stay identity-pinned, and any future exact-one role binding waits on "a concrete caller, cardinality-one resolution, a persisted occupant pin, and ADR-051 consent."

**Why this task exists.** The deferral is reasoned and may well be the right answer. But a 2026-08-19 audit of the brief against the corpus found the deferral is recorded **nowhere except inside D5's own AC** — no task, no ADR, no design note tracks it. An untracked deferral is indistinguishable from a dropped request once D5 closes. This task exists to reach a decision and record it, in either direction.

**Verified state on entry (2026-08-19 tree):**

- Role-based executor selection is live on `agent.run` only (`AgentRunActionRunner`, registered in `packages/app/src/workflow/builtins.ts`). The reviewed pipelines declare roles for model work — for example `role: reviewer` on the pipeline2 residual sweep.
- The role → tier/stages contract's SSOT is feature B3's work in `packages/config` (`DEFAULT_AGENT_ROLES` + an optional `agent.roles` override), with `plugins/sp/references/roles.md` demoted to a parity-checked projection. B3 is about *where the role table lives*, not about *which commands accept a role* — it does not cover this request.
- `spur agent wait` and `spur message send --wait` are identity-pinned to spec + run + generation (ADR-057 wave 2, task 0530). `followSystemEventsAfter` (task 0531) is the snapshot-then-follow read path.
- No pipeline in `config/workflows/` currently needs to address a role rather than a concrete occupant — which is precisely why D5 found no concrete caller. Establishing whether one exists is the first question, not an assumption to skip past.

**The known risk if this ships.** Role addressing without exact-one resolution degenerates into broadcast, which ADR-057 rules out and D6's scope excludes. Two occupants answering one role turns a pinned wait into a race. Any implementation must resolve to exactly one occupant and persist that pin, or it must not ship.
### Requirements
- [ ] R1. The concrete-caller question is answered with evidence (feature R6). Survey `config/workflows/*.yaml`, the `sp` command surface, and the team/coordination paths for any caller that genuinely needs to address a **role** rather than a concrete occupant. Record the finding either way. "No caller exists today" is a valid, useful answer — but it must be demonstrated by the survey, not assumed from D5's earlier note.

- [ ] R2. A decision is reached and recorded (feature R6). The outcome is either (a) role addressing ships for `spur agent wait` and/or `spur message` with exact-one resolution, a persisted occupant pin, and recorded ADR-051 consent for the public-surface change, or (b) a dated ADR entry closes the question, stating why identity pinning stays authoritative and what evidence would reopen it. Leaving the question open at task completion is the one unacceptable outcome.

- [ ] R3. Exact-one resolution is enforced if anything ships (feature R6). A role that resolves to zero occupants and a role that resolves to more than one are both hard errors naming the role and the resolved count — never a silent pick, never a first-match. The persisted occupant pin is written before the wait or send proceeds, so a reconnect resumes against the same occupant.

- [ ] R4. No broadcast or fan-out addressing is introduced (feature R6). This holds under both outcomes. `spur message` keeps one recipient per send; a role is a way to *name* that recipient, never a way to reach several.

- [ ] R5. The role vocabulary stays closed and singly-owned. Any role accepted by a new surface comes from the existing `DEFAULT_AGENT_ROLES` contract in `packages/config` (feature B3), with `plugins/sp/references/roles.md` remaining a parity-checked projection. Do not introduce a second role list, and do not invent roles.

**Non-goals:** broadcast or fan-out messaging; changing `agent.run`'s existing role selection; relocating the role SSOT (feature B3 owns that); shipping a public surface without ADR-051 consent; treating "no concrete caller" as a reason to skip recording the decision.
### Acceptance Criteria
```gherkin
Feature: Role-addressed coordination for agent wait and message

  Scenario: R6 — Role-addressed wait and message are resolved, not left open
    Given agent.run supports role-based executor selection but wait and message are identity-pinned
    When role addressing is evaluated against a concrete caller
    Then the outcome is either shipped role addressing with exact-one resolution, a persisted occupant pin, and ADR-051 consent, or a dated decision record closing the question
    And a decision to keep identity pinning authoritative states the reason rather than lapsing silently
    And no broadcast or fan-out addressing is introduced under either outcome
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT.** Answer one question and record the answer: should `spur agent wait` and `spur message` accept a **role** as an addressee, the way `agent.run` already accepts one for executor selection? Ship it with exact-one resolution, or close it with a dated ADR entry. Either outcome satisfies this task; leaving it open does not.

**WHY.** The original brief asked for role support to spread beyond `agent run`. D5 R6 deferred it behind four preconditions (concrete caller, exact-one resolution, persisted occupant pin, ADR-051 consent) and recorded that deferral **only inside D5's own acceptance criteria** — so when D5 closes, the request disappears with it. This task converts an implicit deferral into an explicit, dated decision.

**WHERE (frozen file targets):**

- `apps/cli/src/commands/agent.ts:95` — the `agent wait <specId>` surface (`--run`, `--until`, `--timeout`, `--json`).
- `apps/cli/src/commands/message.ts:121` — where the `{ specId, runId, generation }` pin is captured before send.
- `packages/config/src/index.ts:173` — `DEFAULT_AGENT_ROLES`, the closed role vocabulary (ADR-061, feature B3).
- `docs/00_ADR.md` — the dated decision entry, in either direction.
- `docs/features/D5_*.md` R6 — amend the deferral to point at that entry once it exists.

**Survey already completed in refine — do not re-derive (checklist item 7).**

- **No shipped workflow invokes `agent wait` or `message send` at all.** `grep -rn "agent wait\|message send\|spur message" config/workflows/*.yaml` returns nothing. The pipeline half of R1's caller question is therefore already answered **NO**, and answered more strongly than D5 R6 put it: the issue is not that pipelines lack a *cardinality-one* caller, it is that they have no wait/message caller of any kind.
- **No CLI command accepts `--role` today.** Role is an `agent.run` action option only (`packages/app/src/workflow/actions/agent-run.ts:144`), validated at the schema gate (0538 R2, `agent-run.ts:204`).
- `role:` is used widely in live YAML (`basic`, `docs-pipeline`, `wrapup-pipeline`, `planning-pipeline`, task pipelines) but **always as executor selection**, never as an addressee.

**Therefore R1's remaining scope is exactly one surface: the team/coordination path** — `spur team` (`assign`, `status`, `up`, `down`, `start`, `stop`) and the agent/operator callers of `agent wait` / `message send` documented in `plugins/sp/skills/spur-cli/references/{agent,message}.md`. That is where a human or agent addresses "the reviewer" rather than a spec id. Survey that surface; the pipeline surface is closed.

**Frozen names — conditional on the outcome.** If nothing ships, this task adds no API. If role addressing ships, the surface is `--role <name>` on the existing `agent wait` and `message send` verbs — **no new noun, no new verb**, per ADR-051's noun-first rule; `--role` is mutually exclusive with the positional `<specId>` / `--to`, and supplying both is a usage error (exit 2). Role values come from `DEFAULT_AGENT_ROLES`; do not introduce a second list.

**Algorithm / precedence if it ships.**

1. Resolve `--role` against live occupants for the current team scope.
2. **Zero matches → error** naming the role and `count=0`. **More than one → error** naming the role, `count=N`, and the candidate spec ids. Never first-match, never a silent pick.
3. On exactly one, materialize the same `{ specId, runId, generation }` pin the identity path already writes, **before** the wait or send proceeds.
4. Everything downstream is unchanged — the pin, not the role, is what the wait or send is bound to. A reconnect resumes against the pin, so a role that would resolve differently later is irrelevant once pinned.

**Anti-patterns (do not implement):**

- Broadcast or fan-out. One recipient per send, under both outcomes. A role names a recipient; it never reaches several.
- First-match or "pick the newest" resolution. Ambiguity is an error, not a heuristic.
- Resolving the role *after* the wait begins, or re-resolving on reconnect — that reintroduces the race the occupant pin exists to remove.
- A second role list, or roles invented outside `DEFAULT_AGENT_ROLES`.
- A new `spur` noun or verb; role addressing is a flag on existing verbs or it does not ship.
- Treating "no concrete caller found" as permission to skip the ADR entry. The no-caller finding **is** the decision's evidence, not a reason to stay silent.
- Changing `agent.run`'s existing role selection, or relocating the role SSOT (feature B3 owns that).

**Cross-task contract.** No `dependencies[]`: this task is independent of 0606/0607/0608 and touches none of the pipeline definitions they edit, so it can run in parallel with D5 closure. It assumes ADR-057's identity-pinned occupant semantics and ADR-061's role SSOT as given, and must not re-open either. It leaves nothing for dependents — a closing ADR entry ends the thread.
### Plan
1. **Caller survey (R1).** Search `config/workflows/*.yaml`, the `plugins/sp` command surface, and the team/coordination paths for a caller that must name a role rather than an occupant. Record each candidate with why it does or does not need role addressing. Verify: the survey names the files searched; "none found" is written as a finding, not left implicit.
2. **Design the exact-one rule (R3).** Specify resolution against the occupant table: zero matches and multiple matches are both hard errors naming the role and the count. Specify where the pin is persisted and when it is written relative to the wait or send. Verify: the rule is written before any code, and it has no silent-pick branch.
3. **Decision point (R2).** Present the survey plus the design to the operator. If a concrete caller exists and consent is given, proceed to step 4. If not, go to step 5. Verify: the decision and its date are recorded either way.
4. **Ship it, if consented (R2, R3, R4, R5).** Implement role resolution for the agreed surface, reusing `DEFAULT_AGENT_ROLES` from `packages/config` — no second role list. Tests must cover zero-match, multi-match, reconnect-against-the-pin, and the absence of any fan-out path. Verify: targeted tests green; the public-surface change is recorded with its consent.
5. **Close it, if not (R2).** Add a dated `docs/00_ADR.md` entry stating why identity pinning stays authoritative and what evidence would reopen the question, and amend D5 R6's deferral to point at it. Verify: the ADR entry exists and D5's deferral is no longer the only record.
6. **Gates.** `bun run lint`, targeted tests, then `bun run spur-check`. If a public surface changed, `bun run corpus-check` too.

**Done when** the concrete-caller question is answered from evidence, a dated decision exists in either direction, and — if anything shipped — exact-one resolution is enforced with a persisted pin and no fan-out path.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
