---
schema_version: 1
name: Land A2A remote writer branches through the integration queue
status: done
template: feature-impl
created_at: 2026-11-16T01:11:47.121Z
updated_at: "2026-11-16T03:18:56.809Z"
feature_id: G76

dependencies: ["1342"]
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1345. Land A2A remote writer branches through the integration queue

### Background

Implements: R9 — A remote writer's branch lands through the same gate.

Closes the gap where a fenced A2A member returns `metadata.remoteBranch` that Spur records but never lands (ADR-148 amendment, task 1337).

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

### Requirements

- [x] R1 — A completed remote write result fetches `remoteBranch` into `sp/remote-<wbs>-<attempt>` and enters the integration queue unchanged.
- [x] R2 — Spur gates the rebased tree; a remote self-reported pass is never accepted (ADR-138).
- [x] R3 — A missing branch or failed fetch is `not-started` for integration; the remote writing turn is never replayed.
- [x] R4 — Fetch uses the operator git config; Spur stores no credentials.

### Acceptance Criteria

- [x] AC1 — A remote writer's branch lands through the same gate

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T01:20:49.160Z

- **Q: Which git remote does `remoteBranch` name?** CLOSED (refine 2026-11-15): `<remote>/<branch>` against a remote already configured in the base repo, honouring R4 (operator git config, no stored credentials). An unknown remote holds with an actionable detail. No new config key (Q5).

### Design

**WHAT.** A completed A2A write result that carries `remoteBranch` is fetched into `sp/remote-<wbs>-<attempt>` and landed by 1342's queue unchanged.

**WHY.** Today the sender records `remoteBranch` (`packages/app/src/services/a2a-member-transport.ts:271`, re-read from `artifact_refs_json` at `:425-431`) but never fetches or merges it (`docs/design/a2a-member-transport.md:238-239`).

**WHERE / frozen names.**
- **Fetch source.** `remoteBranch` is interpreted as `<remote>/<branch>`, where `<remote>` must be a remote configured in the base repo (`git remote get-url <remote>` succeeds). Fetch with `git fetch <remote> <branch>:sp/remote-<wbs>-<attempt>` using the operator's git config and credential helpers. Spur stores no URL or credential, and no new config key is added.
- **Lane.** `WorktreeLaneService.open` (1341) gains an optional `branch` argument so it can check out the fetched branch as the lane instead of creating `sp/run-…`.
- **Queue.** `FleetIntegrationQueue.drainOne` (1342) takes the lane's branch name from the lane record. Rebase, gate, ff-only, persist, sync and dispose are identical. `persistWorktreeRuns` copies nothing when the remote lane has no `.spur/` run rows; this is not an error.
- **Failure mapping.** A missing `remoteBranch`, an unknown remote or a failed fetch → integration outcome `not-started` with a hold detail naming the cause. The A2A turn is **never** re-dispatched (ADR-126 A4).
- **Gate trust.** Only Spur's own gate receipt counts. A remote self-reported pass in the artifact is ignored (ADR-138).

**Anti-patterns.**
- No credential storage.
- No `git pull`.
- No merge commits.
- No second landing path.
- Do not replay the remote turn.

**Handoff.** It extends the two-install fixture from task 1337 (`scripts/commands/fleet-e2e.ts`).

### Plan

1. Write E2E case F11 before code.
2. Extend the two-install fixture from task 1337 so the remote branch lands through the gate.

### Solution

A remote writer's branch now lands through the queue that already exists. `remoteBranch` was recorded
by the A2A transport and never used; the queue interprets it as `<remote>/<branch>`, fetches it with
the operator's own git config and credential helpers, opens it as the lane, and then rebases, gates,
fast-forwards, persists and disposes exactly as a local lane does. The remote's self-reported pass is
never read — only Spur's own receipt counts (ADR-138).

**Change map**

- **Queue:** `packages/app/src/services/fleet-integration-queue.ts`
  - `:17-24` `IntegrationCandidate.remoteBranch` — optional `<remote>/<branch>` from a remote writer.
  - `:37-41` `IntegrationOutcome` gains `not-started` with a reason, so a failed fetch is an integration verdict, never a replay of the remote turn (ADR-126 A4).
  - `:110-135` `land` resolves the lane: an existing local lane is used as-is, a remote candidate is fetched and opened, and anything else is `not-started`.
  - `:196-224` `fetchRemote` — validates `<remote>/<branch>`, proves the remote is configured (`git remote get-url`), fetches into `sp/remote-<wbs>-<attempt>`; no URL or credential is stored (R4).
  - `:189-191` the fetched ref is deleted with the lane after a landing, because `dispose` only knows the local attempt name.
- **Lane service:** `packages/app/src/services/worktree-lane-service.ts:103-125` `open(wbs, attempt, { branch })` checks out a fetched branch as the lane, and refuses a branch that does not exist instead of creating an empty lane.
- **Tests:** `packages/app/tests/services/fleet-integration-queue.test.ts` § "remote writer branches" — a real bare remote + pushed branch lands through the same gate (landed, ff-only, no lane left, remote ref consumed); a missing branch and an unknown remote are `not-started` with the base ref untouched and no gate call.

**Verification**

- `(cd packages/app && bun test tests/services/fleet-integration-queue.test.ts)`: 10 pass (7 queue + 3 remote).
- `(cd packages/app && bun run typecheck)`: clean; biome clean.
- probe: not-applicable (no public noun/verb/flag, no new config key).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — a completed remote write result fetches `remoteBranch` into `sp/remote-<wbs>-<attempt>` and enters the integration queue unchanged | MET | `packages/app/src/services/fleet-integration-queue.ts:110-135` (remote candidate → fetch → lane open), `:196-224` (`fetchRemote`); `packages/app/src/services/worktree-lane-service.ts:103-125` (`open(..., { branch })` checks the fetched branch out as the lane); test "AC1 — a remote branch is fetched into the queue namespace and lands through the same gate" |
| R2 — Spur gates the rebased tree; a remote self-reported pass is never accepted | MET | the landing calls the injected project gate in the lane (`fleet-integration-queue.ts:137-146`) and the test asserts exactly one Spur gate call for a remote landing; nothing reads the remote artifact's verdict |
| R3 — a missing branch or a failed fetch is `not-started` for integration; the remote writing turn is never replayed | MET | `:37-41` (`not-started` outcome with reason), `:126-135` (lane-open failure), `:199-222` (unknown remote / failed fetch); tests "R3 — a missing branch is not-started…" and "R3/R4 — an unknown remote is refused by name"; no dispatch path is touched, so no turn can be re-sent |
| R4 — fetch uses the operator git config; Spur stores no credentials | MET | `fetchRemote` runs `git remote get-url` + `git fetch <remote> <branch>:<ref>` through `NodeProcessExecutor` with the operator's environment (`:196-224`); no URL, token or config key is persisted anywhere in the change |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a remote writer's branch lands through the same gate | MET | test | `packages/app/tests/services/fleet-integration-queue.test.ts` § "remote writer branches" (3 cases): landed with `merges 0`, the fetched content on `HEAD`, lane gone and the remote ref consumed |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:05.617Z backlog → todo (system)
- 2026-11-16T03:16:24.287Z todo → wip (system)
- 2026-11-16T03:18:55.483Z wip → testing (system)
- 2026-11-16T03:18:56.804Z testing → done (system)

