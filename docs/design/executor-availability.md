---
kind: design
title: "Executor availability"
status: implemented
created_at: 2026-09-07
updated_at: 2026-09-18
related: [B5]
tags: [system, B5, agent]
version: 1.2.0
---

# Executor availability

Feature B5 owns acceptance criteria. Robin approved this design on 2026-09-07. Tasks 0796–0799
are implemented (0796 routing/doctor respect for `disabled`; 0797 `setProjectExecutorDisabled`
filesystem updater; 0798 upstream quota-observation producer handoff; 0799 durable application,
server consumer, and runtime refresh).
ADR-111 (Accepted) records the persistence decision; `03 §25` holds the mechanism. Feature B6
(ADR-121, tasks 0890–0893) extends the lifecycle: availability ownership
(`operator | quota | probe`), layer-targeted writes (project fragment wins), ownership-scoped
quota recovery, and the run-once `spur agent usage` producer.

## 1. Ownership and contracts

| Owner | Responsibility |
| --- | --- |
| `packages/config` | Availability schema (`boolean \| {owner, since, reason}`) with a single normalizer, merged defaults, named-reference guard, project and global YAML update, loader invalidation |
| `packages/app` | Selection/doctor policy, quota event subscription, asynchronous application and runtime refresh |
| `packages/domain` | Durable pending update records in the existing project SQLite database |
| `apps/cli`, local `apps/server` | Attach the same event subscription and flush it before exit; server additionally drains pending writes |
| upstream `ts-ai-runner` | Precise failure evidence and quota events, with optional exact routing attribution supplied by Spur |

Configuration remains the source used for execution eligibility. Pending update records are a
delivery mechanism; they do not introduce a second availability override or account health model.
B5 introduced no public CLI surface, new dependency, or Cloudflare filesystem path; B6 added the
consented run-once `spur agent usage` verb (harness-surface-governance §4, ADR-051) and the
`~/.config/spur/agent-usage.json` snapshot path.

## 2. Configuration and eligibility

`agent.executors[].disabled` accepts `boolean | {owner, since, reason}` and defaults to false after
raw global/project merge. A bare `true` is operator-owned; automatic writers must pass the object
form with `owner: quota|probe` (0890). A project omission inherits global true; explicit project
false overrides it. Code reads availability only through the single normalizer
(`normalizeExecutorAvailability`) — never raw truthiness. Update the Zod schema,
`apps/cli/schemas/spur-config.schema.json`, and the existing config example together.

Keep disabled entries in configuration and reference validation. Exclude them at the shared
`cheapestEligibleExecutors` funnel and the independent escalation filters. Guard explicit names
in both `resolveExecutor` and `AgentAppService.resolveExecutorSelector` before canonical-binary
fallback. Team/spec materialization must retain executor attribution until the final launch
check; a previously materialized agent/model pair cannot bypass a later disable.

Run a final enabled check immediately before each subprocess launch. An explicit disabled pin
fails nonzero without fallback. Automatic selection tries another enabled candidate or reports
no eligible enabled executor. An already-running subprocess is not cancelled. A canonical binary
invocation without a named profile remains outside profile-specific disabling.

Doctor renders disabled inventory and matching role-ladder entries as `disabled`, with JSON
`disabled: true`, `usable: false`, and no elected roles. Do not probe disabled entries. Preserve
the enabled elected row at `agents[0]` for successful role checks. Inventory health ignores
intentional disables; explicit-disabled and no-enabled-role checks fail. Include disabled state
in the doctor fingerprint and never reuse stale eligibility from a cached probe. Since 0893,
disabled rows also render provenance (`OWNER`/`SINCE`/`REASON` columns; JSON
`availability {disabled, owner, since, reason}`) and the doctor reports the `agent usage` snapshot
age (`usage` in JSON; `usage: none` when absent — informational, never a warning; ≥6 h renders
`stale`).

## 3. Availability updater (project + global)

Exported from `@gobing-ai/spur-config/loader` (0797; generalized 0891):

```ts
type ExecutorUpdateResult =
    | { status: 'updated' }
    | { status: 'unchanged'; reason: 'already-set' | 'missing-file' | 'missing-executors' | 'missing-executor' };

type ExecutorConfigLayer = 'project' | 'global';

function setExecutorAvailability(request: {
    layer: ExecutorConfigLayer; // requested; the declaring layer wins (project fragment > global)
    projectRoot: string;
    executor: string; // exact name; the updater never creates entries
    disabled: boolean | { owner: 'quota' | 'probe'; since: string; reason: string };
}): Promise<ExecutorUpdateResult>;
```

Errors reject with stable codes `INVALID_CONFIG`, `CONFIG_CONFLICT`, or `CONFIG_WRITE_FAILED`.
The trusted caller resolves the project root; the function edits only its real `.spur/config.yaml`.
Reject a config symlink escaping the project. Missing targets are no-ops. Exact case-sensitive
name equality is required. Name-only project fragments are valid; schema validation uses the
effective merged object without writing the merged object back.

Use the installed YAML document model to set just `disabled` in the matching explicit mapping.
Reject duplicate names, parse errors, aliases/merge structures that would mutate another entry,
and unsupported shapes. Preserve comments, ordering, permissions, and unrelated values. Explicit
false (recovery) or the object form (automatic disable) is written when the attribute is absent;
an already matching explicit value is a byte-stable no-op (scalar equality for booleans,
owner/since/reason equality for objects). A `layer: 'global'` write to a project-declared
executor targets the project fragment and leaves the untouched layer byte-identical. The former
`setProjectExecutorDisabled` wrapper was deleted once 0892 removed its last caller.

Serialize updater calls by the project config path with an exclusive lock. Do not import planning
entity locks into config: `packages/domain/src/planning/locks.ts` restricts that lock domain to
planning writes. Use existing runtime filesystem capabilities where supported, plus the minimum
native exclusive-create and same-directory temporary-file/fsync/rename operations.

Re-read under the lock and compare original file identity/content immediately before rename.
An observed external edit produces `CONFIG_CONFLICT`; do not silently retry over it. Arbitrary
editors do not honor our lock, so this is conflict detection, not a claim of transactional
isolation from every editor. Recover stale locks only for a confirmed dead process, never merely
because a live writer has held a lock for a fixed interval. Always release owned resources.

## 4. Quota events

Names: `agent.quota.exhausted` and `agent.quota.recovered`. Reuse the existing event envelope and
run/execution correlation. The typed payload adds:

| Field | Contract |
| --- | --- |
| `observationId` | Stable identifier reused if the same observation is delivered again |
| `observedAt` | Valid UTC timestamp assigned when the local producer observes the outcome |
| `projectId`, `executor` | Exact trusted project and named-profile attribution; optional upstream, required for mutation |
| `agent`, `model?` | Resolved profile binding used to reject events for subsequently replaced profiles |
| `reason` | Normalized `usage-quota` or `credits` for exhaustion; `explicit-recovery` for reserved recovery |
| `evidenceSource` | Structured provider error, bounded verified error record, or explicit recovery instruction |

Never infer a named executor from agent/model similarity. Spur adds attribution at dispatch and
propagates it through all runner entrypoints, including team launches and streaming shims.
Missing attribution remains observable but cannot write configuration. Resolve the project against
the current local server/registry context; reject foreign-project and arbitrary-path payloads.

Detection belongs upstream in `ts-ai-runner`, separate from Spur's broader fallback classifier.
Only confirmed exhausted usage allowance or credits produces exhaustion. A generic 429, temporary
rate limit, overload, context/output budget, auth failure, timeout, or quoted prompt content does
not. Prefer structured error records; textual matching is limited to verified provider error
channels with bounded evidence. Successful output is not scanned for incidental quota vocabulary.
Streaming errors must reach the same classifier without buffering the complete transcript.

Produce one event per observation; preserve the original return/error behavior. Health inspection
remains read-only by default: explicit opt-in health observations can emit exhaustion; ordinary
doctor does not acquire a config-writing side effect. B5 scoped recovery to "type and consumer
only"; B6 supersedes that clause (0891–0892): recovery is ownership-scoped —
`agent.quota.recovered` re-enables only quota/probe-owned disables, never operator-owned — and the
only proactive producer is the explicit run-once `spur agent usage` command (ADR-121), never a
serve-side poller or timer.

## 5. Durable application: accepted adjustment to the evaluation

The evaluation suggested consuming the retained `system_events` ledger. Source inspection shows
that `SystemEventDao.pruneQuotas` deletes old rows without a consumer checkpoint and `insert`
allocates sequence from the remaining maximum. Reliable operational consumption would therefore
need changes to global sequence allocation, pruning, and replay bookkeeping.

**Accepted choice:** persist the newest pending quota update per project/executor in the same
SQLite database, while continuing to emit the original event into normal System Events. This
replaces the proposed ledger cursor with a bounded-by-executor delivery record and leaves existing
event-history retention semantics intact. The normal event ledger is still the audit history.

| Alternative | Assessment |
| --- | --- |
| Extend ledger checkpoints and protect unread quota events | Reuses the follower but couples config mutations to global retention, cursor allocation, and telemetry switches. |
| Reuse the general job queue | Existing consumer claims all ready job types and its startup is opt-in; using it here requires upstream filtered claims, deduplication, and independent lifecycle changes. |
| One pending update per project/executor **(selected)** | Coalesces superseded writes, survives restart, and isolates delivery from history pruning without a generic queue framework. |

The queue limitations are verified in installed `ts-infra/src/job-queue/db-job-queue.ts`
(`claimReady`, missing-handler failure) and server `context.ts` (`jobQueueEnabled`).

### Persistence shape

Add one project database table through the next available migration (allocate its prefix at
implementation time), with a domain DAO and schema export:

`agent_executor_updates(project_id, executor_name, observation_id, observed_at, agent, model,
disabled, applied_observation_id, applied_at, attempts, retry_after, last_error)` — extended by
migration 0048 with `owner` (`operator | quota | probe`), `layer` (`project | global`), and
`skipped_reason` (classified no-op class).

Primary key is `(project_id, executor_name)`. `disabled` remains a constrained boolean desired
state; drain precedence is ownership-scoped (an operator-owned disable is never auto-re-enabled;
quota/probe updates record their classified skip instead). Retain the
latest row after application so older/duplicate observations cannot recreate pending work. Only
trusted executor-attributed events can create rows; missing project-local targets return a
classified no-op without growing a record for arbitrary names. Retain the latest row for removed
profiles to prevent old event replay; historical executor churn, rather than event volume, bounds
growth. No general-purpose queue or event-replay framework is added.

An observation order is `(observedAt, observationId)` with deterministic lexical ID tie-breaking.
For the same local producer clock, older/equal observations do not replace newer ones. This is not
a distributed causal clock; remote producers remain outside scope (automatic recovery is
ownership-scoped since B6 0891). A
profile binding mismatch is reported and acknowledged as a no-op, never applied to its replacement.

The shared app subscription validates both events and upserts the latest observation. Install it
on CLI execution buses and the local server bus independently of telemetry display/persistence
toggles. Emission persistence is awaited/flushed before producer exit. System Event catalog entries
provide normal presentation and redaction; their optional tap is not the operational delivery path.
**Shipped delta (0799):** as built, the two quota events are consumed from the run bus by the
durable pipeline (`attachAgentQuotaUpdates` / `attachAgentQuotaPersistence`) and have **no
`SYSTEM_EVENT_CATALOG` entry** — board presentation/redaction awaits ADR-110 catalog-open
ingestion; the durable consumer is the operational delivery path.
Persistence failure is reported while preserving the original agent failure and immediate local
exclusion; no success is claimed for a lost update.

### Application and crash behavior

At startup, the Bun server begins one project-scoped drain before autostart or accepting dispatch.
It polls pending records and accepts a local bus wake-up. Both feed the same serial drain; bus
callbacks never independently write YAML. Use the server's existing single-instance ownership,
with an explicit per-project consumer lease/lock if that ownership cannot be proven at integration.

For each pending row: reload effective config, verify exact profile binding, recheck that the row
is still the newest observation, invoke the updater, then acknowledge that observation conditionally.
If a newer event arrives during the write, acknowledge only the version just written and process
the remaining version next. Do not mark a newer event applied by acknowledging an older write.

A crash after YAML rename but before acknowledgement replays the idempotent operation on restart.
Transient write failures use bounded retries (three attempts per drain activation); retain a
visible error and pending row after exhaustion. A later server restart retries retained failures.
A newer observation resets retry state. A conflict is surfaced without automatic overwrite retries.
No error is silently converted into a successful config update. Pending records are outside event
history pruning. Shutdown detaches subscriptions, stops new draining, and awaits active writes and
producer persistence before closing the database.

Delivery coalesces intermediate statuses that have already been superseded before application;
each observation is still emitted for audit. This is appropriate because the target is a boolean
desired value, not an operation that must execute once per event.

## 6. Runtime refresh and limitations

The successful updater invalidates the loader cache. Long-lived dispatch paths reload effective
agent config at each selection/launch boundary; replace captured executor snapshots and associated
doctor fingerprints without reparsing unrelated runtime policy in every inner loop. Keep the
current invocation's attempted/exhausted set in memory so fallback never waits for persistence.

Global-only entries persist through `setExecutorAvailability` (B6 0891): a `layer: 'global'`
request writes `~/.config/spur/config.yaml` with the same per-path lock, atomic rename and
conflict detection as the project layer, and a project fragment still wins when both layers
declare the name. Recovery is evidence-driven only: the `agent.quota.recovered` consumer (B6
0891) re-enables quota- or probe-owned executors; operator ownership is never overridden and
there is no timer and no synthetic recovery, per feature Scope. A disable affects only its
named profile, not all profiles on the same account. Manual YAML false remains normal recovery.

## 7. Verification and implementation order

B5's 16 stable scenarios define completion. Add focused regression cases in config schema/layer
tests; agent selection/doctor/team tests; upstream runner error fixtures; domain update-record tests;
and app/server CLI-to-database-to-YAML lifecycle tests. Exercise restart, duplicate/stale events,
concurrent edits, atomic-write failure, profile replacement, and telemetry-disabled operation.
Use fake providers and temporary files; do not spend live model quota to prove error classification.

Implementation deliverables:

1. Config flag, shared availability enforcement, doctor behavior, and corresponding surface docs.
2. Exact-name YAML updater and focused filesystem/concurrency checks.
3. Upstream event/classification/attribution implementation plus a release-consumption handoff.
4. Durable update record, shared producer wiring, server drain, runtime refresh, and end-to-end checks.

The upstream release is a prerequisite for final Spur integration. No upstream package version,
task ID, publication, or deployment is assumed or authorized by this planning document. Each
implementation task must start from an isolated clean tree and carry its applicable documentation
sync and harness verification gates. No implementation task is declared ready before decomposition.
