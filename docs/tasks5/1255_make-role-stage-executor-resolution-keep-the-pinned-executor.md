---
schema_version: 1
name: Make role-stage executor resolution keep the pinned executor's agent
status: todo
template: issue
created_at: 2026-10-18T19:33:16.740Z
updated_at: "2026-10-19T02:41:28.111Z"

feature_id: B21
---

## 1255. Make role-stage executor resolution keep the pinned executor's agent

### Background

Four distinct executor-resolution failures in the D66 batch (2026-10-18), all in the hop between a stage's declared role and the executor it dispatches.

**Evidence (one row per failure; the `## resolved invocation` block of each partial artifact names both sources).**

| Run | Symptom | Partial artifact |
| --- | --- | --- |
| `379d95ff` | `--agent auto` resolved role `coder` to `agy-gemini`, which is enabled but carries no `executionCapabilities`; the 0706 R5 preflight refused dispatch 144 ms in | `.spur/memory/runs/379d95ff…/artifacts/…-implement-partial.md` |
| `1ae85188` | `remediate` (`role: coder`, `session: reuse`) dispatched `agent=pi` with `model=claude-opus-5-5-medium` (the pinned `agy-opus-5.5`'s model) → pi "Model not found" | `…/1ae85188…-remediate-partial.md` |
| `db097057` | the same hop dispatched `agent=codex` with `model=volc/deepseek-v4-1-flash-261017` (the pinned `pi-dsv4.1-flash-volc` model) → codex read it as `provider: openai` | `…/db097057…-remediate-partial.md` |
| `e398b8b9`, `d1f40ce0`, `d5bfbe22` | `implementAgent=codex-sol`/`pi-dsv4.1-flash-volc` resolved `agent=pi` with an antigravity or bare provider model (`gpt-6.1-sol` is ambiguous across seven authenticated providers) | `…-implement-partial.md` each |

**Mechanism (verified in source).**
- `packages/app/src/services/executor-tier.ts:68-76` (`cheapestEligibleExecutors`) filters only `executorDisabled` and tier, then sorts by tier rank. It never consults capability attestation, so a role can resolve an executor that will be refused 100 ms later; and within one rank the winner is config order, which is how a `capable-1` antigravity entry serves a `standard` role before an attested `standard` pi entry.
- `packages/app/src/workflow/actions/agent-run.ts:688` resolves the role (`resolveRoleFresh`), while `:718` computes `model = asOptionalString(options.model) ?? pin?.model` and `:902/:963/:1008` push that model onto the *resolved* agent's flags. Agent comes from one source, model from another — the observed cross-wiring.
- Config defaults (`~/.config/spur/config.yaml`, `agent.roles`): `coder: standard`, `reviewer: capable-1`, `planner: capable-2`. A role's tier is a floor for selection, so `capable-1` executors are eligible for a `standard` role and can win on list order.

**Operator impact.** Eight pipeline runs across two tasks died on dispatch (144 ms to 20 min), each requiring an executor sweep by hand; the batch also reported an unattested executor as the *cause* of a failure whose pin was valid, which reads as a false accusation against the operator's config.

### Requirements

- [ ] R1. A role-resolved stage never pairs one source's agent with another's model: either both come from the same executor spec (the pin), or the stage resolves both from the role. A mismatch is refused before dispatch with a message naming both sources.
- [ ] R2. Executor usability includes capability attestation: `agent: auto` and every role tier skip an executor whose required axes are unattested, so resolution cannot return an executor the preflight will refuse.
- [ ] R3. A bare model id that is ambiguous across authenticated providers is resolved deterministically (qualified) or refused before dispatch, naming the candidates.
- [ ] R4. Tier eligibility is honest about ranks: an executor below or above the role's tier is only eligible under the documented rule, and within a rank the order is deterministic and documented (not incidental config order).
- [ ] R5. The failure message for a refused dispatch names the offending executor, the stage, and the reason class (`attestation` | `model-resolution` | `agent-mismatch`), so an operator is not told their config is wrong when the pin was valid.
- [ ] R6. A regression test covers each of the four observed pairings (`agy` model + pi, volc model + codex, bare ambiguous `gpt-6.1-sol` via pi, unattested `auto` resolution) and asserts either a correct dispatch or exactly one actionable error.

### Acceptance Criteria

- [ ] AC1 — A stage always dispatches one executor's agent and model together, or refuses with both sources named (req: R1, R5)
- [ ] AC2 — Resolution never returns an executor the capability preflight will refuse (req: R2, R4)
- [ ] AC3 — An ambiguous bare model id is refused before dispatch with its candidates (req: R3)
- [ ] AC4 — The four observed pairings each produce one actionable error or a correct dispatch in tests (req: R6)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen: one resolution, one spec.**
1. Resolve a stage to a *single* `AgentExecutorConfig` (agent + model + tier + capabilities together) at `agent-run.ts` dispatch time, then derive `flags.agent`/`flags.model` from that spec only. `options.model` remains a documented override that replaces both when it names an executor, not a bare model string.
2. Add `capabilityAttestation` to the eligibility predicate in `cheapestEligibleExecutors` (R2), reusing the 0706 R5 requirement check so resolution and preflight agree by construction; export the predicate for `agent doctor`.
3. Resolve bare model ids through the provider registry before dispatch; ambiguity is a refusal with the candidate list (R3).
4. State the tier rule in one place: `isTierEligible` today admits any executor at or above the floor, and the rank sort decides. Keep the semantics, add the deterministic tie-break (rank, then config order) as an explicit comparator with a comment and a test, so the ordering cannot drift with YAML order.

**Rejected.**
- Mapping model ids between agent CLIs: a pi model name passed to codex is never meaningful; refusing is correct.
- A per-stage allowlist of executors: it duplicates the tier policy and would need edits in every workflow.
- Silent fallback to the next executor inside `agent.run`: that is a separate capability (see 1260 — failover on quota/auth), and doing it here would hide resolution defects.

**Frozen names.** `resolveStageExecutor()` (returns the single spec), `isExecutorUsable(executor, requiresCapabilities)`, reason classes `attestation` | `model-resolution` | `agent-mismatch`.

**File targets.** `packages/app/src/services/executor-tier.ts:68-76`; `packages/app/src/workflow/actions/agent-run.ts:688-720,902,963,1008`; `packages/app/src/services/capability-attestation.ts`; `packages/app/src/services/agent-service.ts:363` (`resolveRoleFresh`); tests `packages/app/tests/services/{executor-tier,agent-service}.test.ts`, `packages/app/tests/workflow/actions/agent-run.test.ts`.

**Anti-patterns.** No provider-name heuristics (`contains('claude')`); no automatic model translation between CLIs; do not change tier defaults to work around the ordering; do not relax the capability preflight (0706 R5) to make `auto` succeed.

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
