---
schema_version: 1
name: "Resolve role-addressed coordination for agent wait and message"
status: done
template: feature-impl
created_at: 2026-08-20T00:09:15.116Z
updated_at: "2026-08-20T02:17:25.157Z"
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
> **Outcome: the question is closed, not shipped.** ADR-075 (Accepted, 2026-08-20) records that
> wait and message stay identity-pinned because no concrete role-addressing caller exists. R3–R5
> are conditional on shipping and are therefore satisfied by non-shipment, not by implementation.

- [x] R1. The concrete-caller question is answered with evidence (feature R6). **The pipeline half is already closed during refine and must not be re-derived:** no shipped workflow invokes `agent wait` or `message send` at all (`grep -rn "agent wait\|message send\|spur message" config/workflows/*.yaml` → no matches), and no CLI command accepts `--role` today. `role:` appears throughout live YAML purely as `agent.run` executor selection, never as an addressee. **The remaining scope is exactly one surface:** the team/coordination path — `spur team` (`assign`, `status`, `up`, `down`, `start`, `stop`) plus the agent/operator callers of `agent wait` / `message send` documented in `plugins/sp/skills/spur-cli/references/{agent,message}.md`. Survey that surface and record whether a caller there genuinely needs to name a role rather than a spec id. "No caller exists" remains a valid and useful answer, provided it is demonstrated.
  - **Done.** Survey completed and recorded in ADR-075: no workflow calls `agent wait`/`message send`, no `spur team` verb takes a role as an addressee, no CLI command accepts `--role`.

- [x] R2. A decision is reached and recorded (feature R6). The outcome is either (a) role addressing ships for `spur agent wait` and/or `spur message` with exact-one resolution, a persisted occupant pin, and recorded ADR-051 consent for the public-surface change, or (b) a dated ADR entry closes the question, stating why identity pinning stays authoritative and what evidence would reopen it. Leaving the question open at task completion is the one unacceptable outcome.
  - **Done.** Outcome (b): ADR-075 "Wait and Message Stay Identity-Pinned — No Role Addressing", **Accepted** 2026-08-20. D5 R6's deferral now points at it.

- [x] R3. Exact-one resolution is enforced if anything ships (feature R6). A role that resolves to zero occupants and a role that resolves to more than one are both hard errors naming the role and the resolved count — never a silent pick, never a first-match. The persisted occupant pin is written before the wait or send proceeds, so a reconnect resumes against the same occupant.
  - **Satisfied by non-shipment.** Nothing shipped, so there is no resolution path to enforce. The rule is preserved in ADR-075 as the precondition any future proposal must meet.

- [x] R4. No broadcast or fan-out addressing is introduced (feature R6). This holds under both outcomes. `spur message` keeps one recipient per send; a role is a way to *name* that recipient, never a way to reach several.
  - **Satisfied by non-shipment.** No change to `apps/cli/src/commands/{agent,message}.ts`; no broadcast or fan-out path exists.

- [x] R5. The role vocabulary stays closed and singly-owned. Any role accepted by a new surface comes from the existing `DEFAULT_AGENT_ROLES` contract in `packages/config` (feature B3), with `plugins/sp/references/roles.md` remaining a parity-checked projection. Do not introduce a second role list, and do not invent roles.
  - **Satisfied by non-shipment.** No new surface accepts a role, so `DEFAULT_AGENT_ROLES` remains the single closed vocabulary.

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
- **A reasoned "no" is a successful outcome.** The refine survey already found that no pipeline calls `agent wait` or `message send` at all, which makes "close the question" the likelier result. Closing it with a dated ADR entry satisfies feature R6 exactly as shipping the feature would. What fails this task is silence.
- **The pipeline caller survey is closed; only the team/coordination surface remains.** Recorded in Design with the exact grep and its result. Do not re-run the pipeline half.
- **If it ships, it is a flag on existing verbs — never a new noun or verb.** ADR-051's first CLI layer is nouns; `agent` and `message` already exist and can host `--role`. A design that needs a new noun is a design that has not been reduced enough, and needs a fresh consent round.
- **Ambiguity is an error, deliberately.** Two occupants answering one role is the exact race the occupant pin was introduced to remove (ADR-057 wave 2, task 0530). Resolving it by picking the newest or the first would reintroduce that race behind a friendlier surface. Exit non-zero naming the role and the candidate spec ids.
- **The pin, not the role, is what binds.** Once exactly one occupant resolves, the existing `{ specId, runId, generation }` pin is written and everything downstream is unchanged. A role that would resolve differently a second later is irrelevant — which is why re-resolution on reconnect is banned.
- **Deferred with owner:** the role→tier SSOT and the `agent.roles` config override stay owned by feature B3 (ADR-061, Accepted 2026-08-16). This task consumes `DEFAULT_AGENT_ROLES` and must not relocate, extend, or fork it.
- **Not blocked by D5 closure.** No `dependencies[]`, and no overlap with the pipeline definitions tasks 0606/0607/0608 edit — this can run in parallel.
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
## R1 — concrete-caller survey: NO caller needs role addressing (evidence)

Surveyed the full team/coordination surface (the pipeline half was already closed in refine and not
re-derived; its conclusion re-confirmed below). Files searched and findings:

- **Pipeline surface (closed, re-confirmed):** `grep -rn "agent wait\|message send\|spur message" config/workflows/*.yaml` → **zero matches**. No shipped workflow invokes wait or message at all.
- **Team/coordination surface:** `apps/cli/src/commands/team.ts` — `assign <task-id> <agent-id>` (:41-49), `status` (:50), `up <team>` (:62), `down <team>` (:73), `start <agent-id>` (:84), `stop <agent-id>` (:94). Every verb takes a **concrete spec/team/task id**; no verb accepts a role as an addressee.
- **`agent wait`:** `apps/cli/src/commands/agent.ts:96` — `.argument('<specId>', 'Agent spec id whose occupant to wait on')`. Positional spec id; no `--role` option.
- **`message send --to`:** `apps/cli/src/commands/message.ts:29` — `.requiredOption('--to <id>', 'Recipient agent id')`. The recipient id flows straight into `getOccupant({ specId: options.to })` (:124) and `sendMessage(from, options.to, ...)` (:131) — plain recipient id, no role resolution.
- **No CLI `--role`:** `rg --role apps/cli/src/commands/*.ts` → zero matches outside `agent run`'s action option (`packages/app/src/workflow/actions/agent-run.ts:144`, executor selection only).
- **Apparent role-looking examples are spec ids:** `--to reviewer` / `agent wait reviewer` in `plugins/sp/skills/spur-cli/references/{message,agent}.md` are illustrative spec ids that share role names — the flag tables define them as "Recipient agent id" / "Agent spec id", and the implementation treats them as plain ids. `--tags role:worker` (agent.md:175) is an identity **tag** on a spec (searchable metadata), not a role-resolved addressee.
- **`docs/design/spur-team-mode-design.md`:** no role-addressed wait/message caller.

**Finding: "No caller exists" is demonstrated, not assumed.** Neither the pipeline surface nor the
team/coordination surface needs to address a role rather than a concrete occupant.

## R2 — decision: outcome (b), dated ADR entry closes the question

**ADR-075 (Accepted, 2026-08-20): Wait and Message Stay Identity-Pinned — No Role Addressing.**
`docs/00_ADR.md`. States why identity pinning stays authoritative (the occupant pin `{ specId,
runId, generation }` snapshotted before wait/send is what actually binds a wait to a run; a role
would need exact-one resolution to collapse to that same pin, with zero demonstrated consumers) and
the evidence that would reopen it (a shipped pipeline/team workflow needing role addressing; a
multi-occupant team pattern needing one-role-one-recipient; an agent-to-agent liveness protocol).

D5's R6 deferral — previously recorded **only** inside D5's acceptance criteria — now points at the
decision via a resolution comment in `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md`
(following the R6 scenario). The deferral is no longer the only record.

## R3 — exact-one resolution: N/A (nothing ships)

No role resolution ships, so zero/multi-occupant hard-error semantics do not apply. The rule is
specified in ADR-075's reopening evidence for any future attempt.

## R4 — no broadcast/fan-out: holds trivially

No addressing surface was added. `message send` keeps exactly one recipient per send; the role
vocabulary is untouched.

## R5 — role vocabulary stays closed and singly-owned: holds

No new role list introduced. `DEFAULT_AGENT_ROLES` in `packages/config/src/index.ts:173` remains
the SSOT (ADR-061); `plugins/sp/references/roles.md` remains its parity-checked projection.

## Change map

- `docs/00_ADR.md` — **ADR-075 added** (closing entry, dated 2026-08-20, feature D6, task 0609).
- `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` — resolution comment
  after the R6 scenario pointing the old deferral at ADR-075.

No product code, no CLI surface, no workflow definition changed. This is a decision-record task by
design (feature D6 R6 allows "a dated decision record closing the question" as the full outcome).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Caller survey of team/coordination surface + `agent wait` / `message send`: `apps/cli/src/commands/team.ts:41-94` — all six verbs (`assign`/`status`/`up`/`down`/`start`/`stop`) take concrete agent/team/task ids, no role addressee; `apps/cli/src/commands/agent.ts:96` — positional `<specId>` with no `--role`; `apps/cli/src/commands/message.ts:29` `--to <id>` recipient flows into `getOccupant({ specId: options.to })` at :124 and `sendMessage(from, options.to, …)` at :131. `--to reviewer` examples in the CLI references are spec-ids literally named "reviewer", not role resolution. No caller needs to address a role rather than a spec id — demonstrated, not assumed. |
| R2 | MET | Decision reached and recorded: `docs/00_ADR.md:921` — ADR-075 (Accepted, dated 2026-08-20, D6/0609) closes the question: wait/message stay identity-pinned, role addressing NOT added; states why identity pinning stays authoritative and lists the evidence that would reopen it. `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md:86-90` RESOLVED comment points the old deferral at ADR-075. |
| R3 | MET | Exact-one resolution not applicable — nothing ships (no surface change). ADR-075 records that any future role binding must resolve exactly-one with a persisted occupant pin before proceeding. |
| R4 | MET | No broadcast/fan-out introduced — `spur message` keeps one recipient per send under both outcomes (ADR-075). |
| R5 | MET | Role vocabulary untouched — `DEFAULT_AGENT_ROLES` in `packages/config` remains the sole role SSOT; `plugins/sp/references/roles.md` stays a parity-checked projection; no second role list invented. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — Role-addressed wait and message are resolved, not left open [docs-only] | MET | static-ref | `docs/00_ADR.md:921-964` — dated ADR-075 entry closes the question (outcome b: identity pinning stays authoritative, reopening evidence listed). The one unacceptable outcome (leaving the question open) is avoided. `[docs-only]` — no runtime path; decision-record task. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS (no P1–P3 findings).** Decision-record task (ADR-075) — no product/CLI/workflow code changed, so SECUA and architecture dimensions are clean by construction.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Traceability | `apps/cli/src/commands/message.ts:124,131` | Solution initially cited `:133`/`:146` for `getOccupant`/`sendMessage`; actual anchors `:124`/`:131`. Substance verified true; line citations corrected this run. |
| P4 | Traceability | `apps/cli/src/commands/agent.ts:96` | Solution initially cited `agent.ts:95`; actual anchor `:96` (off by one). Corrected this run. |
| P4 | — | — | No P1–P3 findings. |


| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Survey of team/coordination surface + `agent wait` / `message send` callers: `apps/cli/src/commands/team.ts:41-84` all verbs take concrete agent/team/task ids; `agent.ts:96` positional spec id with no `--role`; `message.ts:29` `--to <id>` recipient flows into `getOccupant({ specId })` at :124. No caller addresses a role as addressee (`--to reviewer` examples are spec-ids literally named "reviewer"). |
| R2 | MET | Outcome (b): ADR-075 dated entry (2026-08-20) closes the question — wait/message stay identity-pinned, no role addressing; reopening evidence listed. D5 R6 deferral pointer updated to name ADR-075. |
| R3 | MET | Exact-one resolution not applicable — nothing ships (no surface change); ADR-075 records that any future role binding must resolve exactly-one before proceeding. |
| R4 | MET | No broadcast/fan-out introduced — `spur message` keeps one recipient per send under both outcomes. |
| R5 | MET | Role vocabulary untouched — `DEFAULT_AGENT_ROLES` in `packages/config` remains the sole role source; `roles.md` stays a parity-checked projection; no second role list invented. |


| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; docs-only delta. |

**Residual risk:** none material. The decision (ADR-075) is a legitimate, complete outcome per the task's own contract — "No caller exists" was demonstrated by the survey, not assumed. D6 R6 scenario can now be verified MET by this task's PASS verdict.
### References
- Feature: `docs/features/D6_workflow-cost-deterministic-ownership-surface-and-role-addressed-coordination.md` (scenario R6)
- Origin of the request: the operator's original workflow-refactor brief — *"if we can continously to add role support to the other `spur agent` comands and `spur message` commands"*
- The deferral this task converts into a decision: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` R6, and task `0603` R6 / `0604`
- Decisions: `docs/00_ADR.md` — ADR-051 (public-surface consent, noun-first), ADR-057 (inter-agent control plane; identity-pinned occupant semantics), **ADR-061** (role→tier SSOT is code in `packages/config`, Accepted 2026-08-16, feature B3)
- Role vocabulary SSOT: `packages/config/src/index.ts:173` (`DEFAULT_AGENT_ROLES`); projection `plugins/sp/references/roles.md`
- Surfaces in question: `apps/cli/src/commands/agent.ts:95` (`agent wait`), `apps/cli/src/commands/message.ts:121` (pin capture before send)
- Existing role plumbing to mirror, not duplicate: `packages/app/src/workflow/actions/agent-run.ts:144` (role option) and `:204` (schema-gate enforcement, task 0538 R2)
- Occupant pin + wait/message shipped in: task `0530` (identity-pinned `agent wait`, atomic `message send --wait`), task `0531` (`followSystemEventsAfter`)
- CLI reference for the surfaces: `plugins/sp/skills/spur-cli/references/agent.md`, `plugins/sp/skills/spur-cli/references/message.md`
### History
- 2026-08-20T01:58:57.652Z todo → wip (system)
- 2026-08-20T02:09:12.297Z wip → testing (system)
- 2026-08-20T02:09:38.507Z testing → done (system)
