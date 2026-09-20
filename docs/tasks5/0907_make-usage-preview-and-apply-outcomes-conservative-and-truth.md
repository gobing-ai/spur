---
schema_version: 1
name: Make usage preview and apply outcomes conservative and truthful
status: done
template: feature-impl
created_at: 2026-09-20T15:48:46.080Z
updated_at: "2026-09-20T22:32:49.443Z"
feature_id: B61
priority: P1
tags:
  - i31-next-batch
estimate_hours: 5

ac_numbering: task-local
ac_altitude: task-local
---

## 0907. Make usage preview and apply outcomes conservative and truthful

### Background

I31/0904 C10 exposed preview/apply ownership disagreement. Current runAgentUsageProducer includes no-usage providers in healthy mappings and labels applied before drain; its own contract says no-usage must be skipped. The report reconstruction is a lead, not an executable regression.

### Requirements

- [x] R1. Exclude no-usage and errored providers from availability decisions and observations; retain their diagnostic/snapshot classifications. When providers share an executor, exhausted valid signal wins; absent signal cannot hide valid headroom or imply recovery.
- [x] R2. Preview and apply must preserve both bare disabled:true and explicit operator-owned disables. Preview reports no-op with an ownership reason and unchanged target; it writes no snapshot, observation or YAML.
- [x] R3. Emit applied only after the exact observation created by this invocation is acknowledged without a skip. Use no-op for protected/unchanged decisions, skipped for a superseded or rejected observation, and pending for unacknowledged or failed delivery; expose an accurate reason without swallowing write failures.
- [x] R4. Preserve the existing single availability writer and declaring-layer precedence. Verify isolated project-only, global-only and shadowed declarations, partial provider errors and nonzero parsable captures without touching operator configuration.
- [x] R5. Update the owning design and CLI rendering/tests for additive skipped/pending action values; document applied as acknowledged desired state, not proof of byte mutation. Keep drain.applied as its existing delivery-ack count.

### Acceptance Criteria

- [x] AC1 — usage decisions require a real signal and respect operator ownership (req: R1)
- [x] AC2 — operator-owned disables survive preview and apply (req: R2)
- [x] AC3 — usage actions describe acknowledged outcomes (req: R3)
- [x] AC4 — usable partial provider results remain supported (req: R4)
- [x] AC5 — usage output documents delivery semantics (req: R5)

### Q&A

Ready freeze — 2026-09-20, inline planning owner.

- Q: Implement now or prepare delegation? A: Prepare a reviewable implementation-ready task; production implementation belongs to the delegated coding agent.
- Q: Is I31 evidence sufficient? A: The reports identify candidate defects; current source anchors substantiate the bounded fixes. The implementation starts with executable regression evidence. Sparse 0905 runs do not authorize trace/cost redesign.
- Q: Dependencies and execution order? A: No unfinished semantic upstream dependency. I31 tasks 0903/0904/0905 are done. Recommended serial order: 0906 → 0907 → 0908 → 0909. Parallel work requires isolated worktrees and serial integration; 0907/0908 share a design satellite.
- Q: Which scope choices remain open? A: None required for this task. Requirements and Design freeze the implementation behavior; freshness policy, installed role propagation, fleet receipts and cost attribution are separate follow-ups.
- Q: Feature traceability? A: B61 R1 ↔ AC1-AC2; B61 R2 ↔ AC3/AC5; B61 R4 ↔ AC4 (capture compatibility). Task-local AC describe the implementation checks without redefining feature shipment criteria.
- Q: How is this checked? A: Focused tests listed in Plan, then `bun run spur-check`, task verify PASS and a separate task commit. Run `bun run spur-check-feature` once per completed feature (after both tasks for B61). CLI source changes additionally require `bun link` inside apps/cli and `bun run --filter @gobing-ai/spur build:bundle` from the root. New feature completion must satisfy its real dogfood gate; historical parent evidence is not fabricated.

### Design

Freeze the smallest fix in runAgentUsageProducer and its existing result contract. Keep classification thresholds, mapping, observation DAO and quota drain ownership. Filter no-usage before choosing an executor decision, while retaining diagnostic mapping. Evaluate operator ownership before preview planning; the drain still checks ownership again to protect races. Dry-run returns would-apply only for eligible changes and no-op for protected or already-satisfied state.

Track the random observation ID returned by the existing recording path, then inspect AgentExecutorUpdateDao.getUpdate after drain. applied requires applied_observation_id equal to this invocation's ID and no skipped_reason; a later/different observation is skipped (superseded), not success for this run. Unacknowledged delivery/failure is pending with bounded reason; rejected recording is skipped with its outcome. Inspect Promise.allSettled failures instead of silently losing them. Preserve fail-closed capture/parse/config errors. Add only skipped and pending to AgentUsageChange.action; no new noun, flag, table, scheduler or public policy. Keep action/state semantics consistent in human and JSON outputs. For skipped/pending, describe the requested target as intent and explain that completion is unconfirmed; do not claim the desired state was persisted.

A re-acknowledged desired state may be applied without a YAML byte change: this is delivery semantics, not a reason to redesign the shared drain counters. Avoid editing the quota consumer unless its existing observation receipts cannot express the result; if that premise fails, report the exact gap before widening scope.

Regression matrix: enabled + exhausted; quota/probe disabled + real headroom; all-null/missing windows; provider errors; mixed no-signal/headroom/exhaustion aliases; operator true/object in preview and apply; write failure; stale/replaced observation; identical desired state; project/global/shadowed layers. Use in-memory SQLite, temporary snapshots/projects and the actual writer. For global paths run an isolated test child with a narrowly injected homedir seam before module loading; never point the writer at the real home or repurpose HOME. Mock provider input, not the writer. No live Codexbar polling required.

Dependencies: none. Own app producer/tests and CLI usage rendering/tests plus session-pinned-dispatch.md §3. The deadline task owns CLI capture source; both share the design file and CLI test workspace, so integrate serially despite no data dependency.

Source anchors:
- `packages/app/src/services/agent-usage-producer.ts`
- `packages/app/src/services/agent-quota-updates.ts`
- `packages/domain/src/dao/agent-executor-update-dao.ts`
- `packages/config/src/executor-update.ts`
- `packages/app/tests/services/agent-usage-producer.test.ts`
- `packages/app/tests/services/agent-quota-updates.test.ts`
- `apps/cli/tests/commands/agent-usage.test.ts`
- `docs/design/session-pinned-dispatch.md`
- `docs/reports/i31/0904-availability.md`

### Plan

- [x] 1. Establish failing no-usage, operator-preview and post-drain reporting cases against current source, with isolated paths and real DAO (R1-R3/AC1-AC3).
- [x] 2. Implement conservative decision selection and exact-observation reconciliation in the existing producer; update rendering exhaustiveness for skipped/pending (R1-R3,R5/AC1-AC3,AC5).
- [x] 3. Exercise real writer layer precedence and error/supersession cases; run producer/quota tests inside packages/app and usage command tests inside apps/cli (R4/AC4).
- [x] 4. Update session-pinned-dispatch.md §3 and usage reference result semantics; run task-local gates, rebuild/link CLI, verify and commit; defer B61 feature-wide gate until both B61 tasks are complete (R5/AC5).

### Solution

Conservative decision + truthful outcome fix, confined to the existing producer contract and its consumers (0907 R1–R5).

**packages/app/src/services/agent-usage-producer.ts**
- R1 (decision mapping, packages/app/src/services/agent-usage-producer.ts:340): decisions now use a `decisionMapping` built from signal-bearing providers only (exhausted/headroom); `no-usage`/errored providers stay in the full diagnostic `mapping` (snapshot `mappedExecutors`, `noUsageProviders`) and can no longer create observations or claim recoveries. Shared-executor severity merge unchanged over signal providers: exhausted wins, else alphabetically-first headroom drives the reason (an absent window can no longer fake a headroom reason).
- R2 (operator pre-check, packages/app/src/services/agent-usage-producer.ts:352-370 + helper at packages/app/src/services/agent-usage-producer.ts:150): `normalizeExecutorAvailability` owner `operator` (bare `disabled: true` included) → change row is `no-op` with an ownership reason and unchanged target (`to` = current); no observation is recorded at all. The drain's own ownership check stays as race protection (untouched).
- R3 (packages/app/src/services/agent-usage-producer.ts:399, packages/app/src/services/agent-usage-producer.ts:410, packages/app/src/services/agent-usage-producer.ts:423, packages/app/src/services/agent-usage-producer.ts:507, packages/app/src/services/agent-usage-producer.ts:536; `recordUsageObservation` returns `{ observationId, outcome }` from packages/app/src/services/agent-usage-producer.ts:451): action starts conservative `pending`; after drain, `AgentExecutorUpdateDao.getUpdate` decides — `applied` only when `applied_observation_id` equals this invocation's ID and `skipped_reason` is null; replaced row → `skipped` (superseded); unacknowledged/failed row → `pending` with `last_error`; rejected recording → `skipped` with the upsert outcome; recording throws are inspected (warn + pending), never swallowed.
- `AgentUsageChange.action` extended additively with `skipped | pending` (interface at packages/app/src/services/agent-usage-producer.ts:161-180; applied = acknowledged desired state, not byte-mutation proof). No drain/DAO/quota-consumer changes — `drain.applied` keeps its delivery-ack meaning.

**apps/cli/src/commands/agent.ts** (R5, apps/cli/src/commands/agent.ts:179-190): human output lists every decision; `skipped`/`pending` rows render `from → to (requested target — completion unconfirmed) [action]`; `--json` flows the additive enum through the existing envelope.

**Docs** (R5): docs/design/session-pinned-dispatch.md:67 — conservative decisions + delivery-semantics paragraph in §3.4; plugins/sp/skills/spur-cli/references/agent.md:235-244 — usage reference: no-usage exclusion, operator preservation, action vocabulary.

**Tests**: packages/app/tests/services/agent-usage-producer.test.ts rewritten hermetic (real loader + `.spur/config.yaml` in temp project + `SPUR_SKIP_GLOBAL_CONFIG`; in-memory SQLite; real drain writer): 10 cases covering R1 no-usage/exhausted/headroom merges, R2 bare-true + operator-object preservation (apply and dry-run), R3 exact-ack applied, superseded-recording skip, failed-delivery pending, plus 0892 dry-run/fail-closed regressions. apps/cli/tests/commands/agent-usage.test.ts:60-66 and apps/cli/tests/commands/agent-usage.test.ts:120-126: operator-exec no-op + `skippedOperatorOwned === 0` and preview ownership-line assertions. Layer precedence/partial-error/nonzero-capture coverage (R4/AC4) verified via existing packages/app/tests/services/agent-quota-updates.test.ts (0891 layer tests) and the CLI R3/R4 cases.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — usage decisions require a real signal and respect operator ownership | MET | R1: `packages/app/src/services/agent-usage-producer.ts:340` — `decisionMapping` filters `classification.status !== 'no-usage'` before decisions; no-usage/errored providers stay diagnostic; severity merge over signal providers (any exhausted wins, alphabetical-first driver) re-read at :371-381 this run \| R2: `packages/app/src/services/agent-usage-producer.ts:355-367` — operator pre-check (`current.disabled && current.owner === 'operator'`) emits `no-op` with `operatorOwnershipReason` (`:153-155`), no observation recorded; drain re-check untouched (`packages/app/src/services/agent-quota-updates.ts` absent from commit e2a6922f9 stat) |
| R2 — usage actions describe acknowledged outcomes | MET | R3: `packages/app/src/services/agent-usage-producer.ts:392` — change starts `pending`; `recordUsageObservation` returns exact `{ observationId, outcome }` (:451-489); `settleRecordings` (:507-534) — rejected → `skipped`, thrown → `pending` (Promise.allSettled inspected); `finalizeOutcomes` (:536-570) — `applied` only when `applied_observation_id === observationId` and `skipped_reason === null`; replaced row → `skipped`; unacknowledged/`last_error` → `pending` \| R5: `apps/cli/src/commands/agent.ts:182-190` — every decision listed; `skipped`/`pending` render "(requested target — completion unconfirmed)"; `docs/design/session-pinned-dispatch.md:67` delivery-semantics paragraph re-read this run; `plugins/sp/skills/spur-cli/references/agent.md:235-244` action glossary re-read this run |
| R4 — usable partial provider results remain supported | MET | R4: No drain/DAO/quota-consumer edits — `git show --stat e2a6922f9` touches no `agent-quota-updates.ts`/DAO file; existing layer-precedence/partial-error/nonzero-capture suites green this run (`bun test tests/services/agent-quota-updates.test.ts` inside packages/app: part of 39 pass / 0 fail / 166 expect) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — usage decisions require a real signal and respect operator ownership | MET | test | AC1: `cd packages/app && bun test tests/services/agent-usage-producer.test.ts tests/services/agent-quota-updates.test.ts` → 39 pass, 0 fail (incl. R1 no-usage + shared-executor exhausted-wins cases); source anchors :340, :371-381 \| AC2: Same run: bare `disabled:true` apply no-op + operator-object preservation cases pass; producer :355-367, :153-155 |
| R2 — usage actions describe acknowledged outcomes | MET | test | AC3: Same run: exact-ack applied, superseded-recording → skipped, failed-delivery → pending cases pass; producer :392, :451-489, :507-534, :536-570 \| AC5: `cd apps/cli && bun test tests/commands/agent-usage.test.ts` → 6 pass, 0 fail (operator no-op, `skippedOperatorOwned === 0`, preview ownership line); CLI rendering :182-190; design doc :67; reference :235-244 |
| R4 — usable partial provider results remain supported | MET | test | AC4: Same run: agent-quota-updates.test.ts layer precedence (project/global/shadowed), partial provider errors, nonzero parsable captures — all pass; no writer modification in commit stat |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0907 (usage preview/apply conservative + truthful)

**Scope:** git diff vs HEAD @ non-corpus files: packages/app/src/services/agent-usage-producer.ts, apps/cli/src/commands/agent.ts, docs/design/session-pinned-dispatch.md, plugins/sp/skills/spur-cli/references/agent.md, apps/cli/tests/commands/agent-usage.test.ts, packages/app/tests/services/agent-usage-producer.test.ts, docs/tasks5/0907
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — **approve**

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | usability | Summary line "(N change(s))" counts every non-`no-op` action, so `skipped`/`pending` decisions inflate the headline count; the per-decision lines and the Drain breakdown below it disambiguate. Pre-existing local (`applied`), not a 0907 regression. | `apps/cli/src/commands/agent.ts:175` |
| 2 | P4 (advisory) | correctness | `finalizeOutcomes` labels `row === undefined` as "superseded by a newer observation" — no code path deletes a row, so if it ever happens the named cause is a guess. Action is still conservative (`skipped`), no false success. | `packages/app/src/services/agent-usage-producer.ts:545-548` |
| 3 | P4 (advisory) | architecture | Reconciliation results are carried by mutating `PendingReconciliation.change`/`.observationId` inside `settleRecordings` rather than returned values; small, testable, cohesive today — return values only if the producer grows again. | `packages/app/src/services/agent-usage-producer.ts:507-534` |

No P1 (blocker), P2 (major), or P3 (minor) findings. The three defects 0907 set out to fix were all confirmed present at HEAD and are gone: HEAD claimed `action: 'applied'` unconditionally at plan time (before the drain ran); HEAD drove decisions from the full provider mapping (an all-null-window `no-usage` provider could claim a recovery or fake a headroom reason); HEAD recorded observations for operator-owned executors and reported them as applied even when the drain acked them as `operator-owned` skips.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Signal-bearing-only `decisionMapping` (exhausted/headroom) drives rows; `no-usage`/errored providers stay diagnostic (snapshot `providers[].status`, `noUsageProviders`, unmapped list) — `packages/app/src/services/agent-usage-producer.ts:338-343`; exhausted-wins merge over signal providers tested: "shared executor — exhausted valid signal wins over an absent one" (`packages/app/tests/services/agent-usage-producer.test.ts:186`) and headroom-cannot-claim-recovery (`:205`) |
| R2 | MET | Operator pre-check before planning pushes `no-op` with ownership reason and unchanged target, records no observation — `packages/app/src/services/agent-usage-producer.ts:352-366` + `operatorOwnershipReason` `:153`; bare `disabled: true` → owner `operator` via the single reader `normalizeExecutorAvailability` (`packages/config/src/index.ts:389-408`); drain ownership re-check kept as race protection (`packages/app/src/services/agent-quota-updates.ts`, `ackSkipped` 'operator-owned'); tests: bare-true apply (`agent-usage-producer.test.ts:224`), operator-object vs exhaustion (`:240`), CLI preview line (`apps/cli/tests/commands/agent-usage.test.ts:237-239`) |
| R3 | MET | Action starts conservative `pending` (`agent-usage-producer.ts:391-392`); recording rejections → `skipped` with outcome, recording throws → warn + `pending` (`settleRecordings`, `:507-534`); `applied` only when `dao.getUpdate` returns this invocation's exact `applied_observation_id` with `skipped_reason` null; replaced row → `skipped`; unacknowledged/`last_error` → `pending` (`finalizeOutcomes`, `:536-570`); tests: exact-ack applied (`test :43-63`), superseded → skipped (`:257`), failed delivery → pending with `last_error` (`:276`) |
| R4 | MET | Delivery unchanged through `drainPendingAgentQuotaUpdates` → `setExecutorAvailability` (single writer, declaring-layer precedence); layer precedence (project-wins/global-only/shadowed), partial provider errors and nonzero-but-parsable captures covered by existing suites — `packages/app/tests/services/agent-quota-updates.test.ts:647,664,592` and CLI `tests/commands/agent-usage.test.ts` R3/R4 cases (missing binary exit 1, rc=1-with-parsable-array still applies) — all green in this review's runs |
| R5 | MET | CLI lists every decision; `skipped`/`pending` render "(requested target — completion unconfirmed)" (`apps/cli/src/commands/agent.ts:181-190`); design §3.4 delivery-semantics paragraph (`docs/design/session-pinned-dispatch.md:67`); reference updated (`plugins/sp/skills/spur-cli/references/agent.md:235-244`); `drain.applied` meaning untouched (delivery-ack count) |

AC1→R1, AC2→R2, AC3→R3, AC4→R4, AC5→R5 — all verified against implementation + tests (task-local ACs, per task doc §Questions).

##### Verification evidence (fresh, run during this review)

- `cd packages/app && bun test tests/services/agent-usage-producer.test.ts tests/services/agent-quota-updates.test.ts` → **38 pass, 0 fail** (161 expect()).
- `cd apps/cli && bun test tests/commands/agent-usage.test.ts` → **6 pass, 0 fail**.
- `bunx tsc --noEmit` → packages/app exit 0; apps/cli exit 0.

##### SECUA / architecture notes

Security: no new trust boundary — capture still parsed by the fixed zod schema, ownership still resolved by the single `normalizeExecutorAvailability` reader, writes still only via the drain's single writer; no env/fs reads added to packages/app. Efficiency: one extra `getUpdate` read per decided executor after the drain (bounded, indexed PK lookup). Architecture: reconciliation is a deep extension — outcome truth is pushed to one post-drain boundary (`finalizeOutcomes`) reusing the DAO row shape instead of re-implementing row queries; hermetic tests use the real loader/writer/DAO with in-memory SQLite.

##### Residual risk

Concurrent overlapping cron invocations are protected by the DAO latest-observation guard + conditional version-specific ack (drain-level supersession tests green); a dedicated two-producer race test does not exist. Acceptable for this task's scope.

**Next:** approve — proceed to stage gate; no code changes requested.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-20T19:03:10.775Z todo → wip (system)
- 2026-09-20T19:20:32.791Z wip → testing (system)
- 2026-09-20T19:56:29.759Z testing → done (system)

