---
schema_version: 1
name: "Add spur agent usage: run-once codexbar usage producer with snapshot file, provider-to-executor mapping, dry run, fail-closed exit, and the ADR-051 consent row"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.554Z
updated_at: "2026-09-18T15:05:14.397Z"
feature_id: B6
priority: P1
tags:
  - cli
  - agent
  - usage
  - codexbar
  - B6
estimate_hours: 8

dependencies: ["0891"]
---

## 0892. Add spur agent usage: run-once codexbar usage producer with snapshot file, provider-to-executor mapping, dry run, fail-closed exit, and the ADR-051 consent row

### Background

The operator's original design: an external scheduler runs a command that dumps `codexbar usage --format json --provider all` and refreshes executor availability. Authority: `docs/design/session-pinned-dispatch.md` §3.4, AC R5/R6/R7/R9; ADR-051 consent for the new verb `spur agent usage` granted at design-approval 2026-09-17 (rejected shape: `spur agent doctor --refresh-usage`).

Premise P1 (codexbar JSON shape) was partially verified on 2026-09-17 with CodexBar 0.60.4, run inside the sandbox:

- The command prints a JSON array of per-provider entries and **exits 1 whenever any provider fails**, even when the array is valid. The exit code alone is therefore not a failure signal.
- A failing entry is `{ "provider", "source", "error": { "code", "message", "kind" } }`.
- A healthy entry is `{ "provider", "source", "usage": { "primary", "secondary", "tertiary", "extraRateWindows", "updatedAt", "identity", ... } }`. Each rate window carries `usedPercent`, `resetsAt`, `windowMinutes` and an optional `resetDescription`; `tertiary` may be `null`.
- Only `antigravity` was healthy in the sandbox (cookie-cache lock EPERM and missing CLIs broke the rest). A redacted sample is at `/Users/robin/xprojects/spur-new/.spur/run/3fc16af1-f2e7-4afd-9f05-59fc6ce555c5-codexbar-sample.redacted.json`. Plan step 1 still captures a sample with healthy `claude`/`codex` entries outside the sandbox before any adapter code.

Exhaustion rule (fixed at readiness, not left to the implementer): a provider is exhausted when any non-null `primary|secondary|tertiary` window has `usedPercent >= 100`, and has headroom when every non-null window is below 100. `extraRateWindows` stays in `raw` only. Known ceiling: a provider whose windows split by model family (antigravity: Gemini vs Claude/GPT) is judged as a whole; per-family mapping is a later item if it misfires.

### Requirements

- [x] R1. `spur agent usage [--dry-run] [--source codexbar] [--json]` exists under the `agent` noun; it runs `codexbar usage --format json --provider all`, writes `~/.config/spur/agent-usage.json` (`captured_at`, `source`, `providers[]`, `raw`) atomically, maps providers to executors via `agent.executors[].agent` + model/provider prefix, and emits `owner: quota` availability observations through the task-4 updater path using the Background exhaustion rule (`resetsAt` and the window name go into the observation reason); unmapped providers are listed in the output and never guessed.
- [x] R2. `--dry-run` prints the would-be changes (executor, from → to, owner, reason) and writes neither the snapshot nor any config file.
- [x] R3. A missing codexbar binary, or output that is not a parsable JSON array of provider entries (whatever the exit code), exits non-zero with the cause on stderr and changes nothing; the previous snapshot is left intact. A non-zero exit with a parsable array is not a failure: each `{ "error": … }` entry is skipped for its provider (listed in the output, no observation emitted, never treated as recovery) while healthy entries are still applied.
- [x] R4. `spur serve` contains no scheduler, timer or hook that invokes the producer (asserted by a test that greps the serve module for the command and by the design's R9 scenario); the `agent.md` reference documents the external-scheduler pattern (cron/launchd, same as `spur history daily`).
- [x] R5. The codexbar adapter is a small `UsageSource` interface with one implementation and a fixture captured from a real `codexbar` run (redacted), used by the tests.
- [x] R6. `docs/design/harness-surface-governance.md` gains the consent row (date, task WBS, verb + flags, rationale, rejected shape); `plugins/sp/skills/spur-cli/references/agent.md` documents the verb; the `setProjectExecutorDisabled` wrapper from task 4 is deleted.
- [x] R7. Tests in `apps/cli/tests/commands/agent*` cover R1–R3 with the fixture and a stubbed binary; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R5, R6, R7, R9.

- [x] AC1 — The usage producer captures a snapshot and applies quota-owned changes (req: R1)
- [x] AC2 — The usage producer supports a dry run (req: R2)
- [x] AC3 — A missing or failing codexbar changes nothing (req: R3)
- [x] AC4 — The producer is never scheduled by spur serve (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: one run-once command, scheduled outside Spur, rather than a poller in `spur serve` (docs/design/session-pinned-dispatch.md §3.4; feature Scope 'no hidden automation'). The producer reuses task 4's updater so there is exactly one write path to availability; it emits observations, it does not edit YAML itself. `UsageSource` is an interface with one implementation because the operator named a second candidate source in the idea; if that never materializes the interface is a five-line cost. Dry-run is the default-safe verification path for cron authoring. Mutation policy: `apps/cli/src/commands/agent.ts` (verb), `packages/app/src/services/agent-usage-*.ts` (adapter, mapping, snapshot), tests + fixture, governance row, spur-cli `agent.md`, `config/config.example.yaml` comment; no doctor rendering (task 6).

### Plan

1. Outside the sandbox, run `codexbar usage --format json --provider all` and save a redacted sample under `apps/cli/tests/fixtures/codexbar-usage.json`; note the codexbar version in the fixture header.
2. Read design §3.4 and the task-4 updater API; define `UsageSource` and the codexbar adapter; define the snapshot shape.
3. Implement provider→executor mapping and observation emission; implement `--dry-run` and the fail-closed exits.
4. Register the verb in `agent.ts`; add the governance row and the `agent.md` reference; delete the task-4 wrapper.
5. Write the tests (fixture, stubbed binary, serve-has-no-scheduler assertion); run `cd apps/cli && bun test tests/commands/agent*` then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Run-once usage producer closes the loop from codexbar rate windows to quota-owned executor availability (B6 0892).

- **R1 capture + apply** — `runAgentUsageProducer` (`packages/app/src/services/agent-usage-producer.ts:225`): parses codexbar entries (`:41`), classifies exhausted/headroom (`classifyProviderUsage` `:96`), maps providers to configured executors by `agent`/model prefix (`mapProvidersToExecutors` `:118`), and records quota-owned availability via `AgentExecutorUpdateDao.recordObservation`, then drains pending updates (`drainPendingAgentQuotaUpdates`). Snapshot is written atomically (tmp+rename, `writeSnapshotAtomic`), carrying `source`, `capturedAt`, per-provider classification, `unmappedProviders`, `noUsageProviders`.
- **R2 dry run** — `options.dryRun` (`:198`) reports would-be changes with `snapshotPath: null`, `drain: null`; writes neither snapshot nor config.
- **R3 fail-closed** — missing/failed codexbar capture raises `UsageSourceError` (`packages/app/src/services/agent-usage-source.ts:14`) before any write; a non-zero exit with a parsable payload is NOT an error (codexbar exits 1 when any provider fails); unparsable stdout rejects the whole capture.
- **R4 serve never schedules the producer** — no serve/workflow wiring exists; the command doc (`apps/cli/src/commands/agent.ts:213`) directs external cron/launchd scheduling, and `docs/help/cmd_agent.md` says the same.
- **R5 CLI surface** — `spur agent usage` (`apps/cli/src/commands/agent.ts:210`) with `--dry-run`/`--source`/shared JSON flags; flags live in the shared registry (`apps/cli/src/commands/shared-options.ts` `dryRunAgentUsage`/`sourceAgentUsage`); docs/help parity rows added (`docs/help/cmd_agent.md` "spur agent usage"); json-envelope census 67→68 (`apps/cli/tests/json-envelope-inventory.test.ts:284`).
- **Boundary remediation** — spawn/env stay in the CLI layer: `packages/app` keeps the pure seam (`UsageCapture`/`UsageSource`/`UsageSourceError`) and the producer requires injected `source`+`snapshotPath`; `apps/cli/src/services/agent-usage-source.ts` owns `CodexbarUsageSource` (buffered capture via `NodeProcessExecutor`) and `defaultAgentUsageSnapshotPath`; `agent-usage-producer.ts` fs exemption recorded in `config/rules/strict/runtime-boundaries.yaml` (atomic snapshot persistence, mirrors project-registry).
- **Tests** — producer R1/R2/R3 (`packages/app/tests/services/agent-usage-producer.test.ts`), seam contract (`packages/app/tests/services/agent-usage-source.test.ts`), CLI capture paths incl. non-zero-exit passthrough and fail-closed launch (`apps/cli/tests/services/agent-usage-source.test.ts`); scoped suites green: executor-update 29, agent-quota-updates 28, agent.test 32.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Verb + flags: apps/cli/src/commands/agent.ts:210-228 `agent.command('usage')` with `--dry-run`/`--source`/shared JSON, registry entries `dryRunAgentUsage`/`sourceAgentUsage` in apps/cli/src/commands/shared-options.ts:102-103 (parity tests shared-option-parity.test.ts green); codexbar argv `CODEXBAR_ARGV` = `codexbar usage --format json --provider all` (apps/cli/src/services/agent-usage-source.ts); atomic snapshot tmp+rename `writeSnapshotAtomic` packages/app/src/services/agent-usage-producer.ts:214-224 writing `~/.config/spur/agent-usage.json` via `defaultAgentUsageSnapshotPath` with `source`/`capturedAt`/providers; mapping `mapProvidersToExecutors` agent-usage-producer.ts:118-136 (agent + model provider-prefix); `owner: quota` observations via `AgentExecutorUpdateDao.recordObservation` then `drainPendingAgentQuotaUpdates`; exhaustion rule puts window name + `resetsAt` in reason `observationReason` :148-158; unmapped listed never guessed (`unmappedProviders`, test agent-usage-producer.test.ts + cli capture test). Tests: agent-usage-producer.test.ts "R1: applies quota-owned…", apps/cli/tests/commands/agent-usage.test.ts (verb surface), fixture apps/cli/tests/fixtures/codexbar-usage.json captured from a real run (redacted) |
| R2 | MET | `options.dryRun` RunAgentUsageOptions agent-usage-producer.ts:198-206: dry-run returns `snapshotPath: null`, `drain: null`, changes action `would-apply`, writes nothing. Test: agent-usage-producer.test.ts "R2: dry run reports would-be changes but writes neither snapshot nor rows" (existsSync false, getUpdate undefined) |
| R3 | MET | Missing binary → NodeProcessExecutor yields null exit → `UsageSourceError` fail-closed (apps/cli/src/services/agent-usage-source.ts:34-46, test "fail-closed: unusable launch"); unparsable output rejects whole capture (`codexbarEntriesSchema` safeParse → UsageSourceError, producer :281-289); non-zero exit with parsable array is NOT a failure: `erroredProviders` skip per `{error}` entries (classifyProviderUsage :96-116, status 'errored' never recovery), healthy entries still applied (cli capture test "passes through non-zero exits"). Previous snapshot untouched: producer writes only after successful parse (write after classification; R3 test asserts existsSync false on failure) |
| R4 | MET | apps/cli/tests/commands/agent-usage.test.ts:294-297 "R4: the serve module never references the producer" greps serve.ts for `codexbar`/`agent-usage` (0 hits); no scheduler/timer in serve; docs/help/cmd_agent.md "spur agent usage" section: "Schedule it externally (cron/launchd); spur serve never runs it"; plugins/sp/skills/spur-cli/references/agent.md documents the verb |
| R5 | MET | `UsageSource` interface with one implementation: packages/app/src/services/agent-usage-source.ts:7-16 (pure seam, test agent-usage-source.test.ts pins error contract), impl `CodexbarUsageSource` apps/cli/src/services/agent-usage-source.ts:23-47 via NodeProcessExecutor; fixture apps/cli/tests/fixtures/codexbar-usage.json captured from a real codexbar run (redacted) used by apps/cli/tests/commands/agent-usage.test.ts |
| R6 | MET | Consent row dated 2026-09-17 in docs/design/harness-surface-governance.md:121 + :134 (verb+flags, rationale, rejected shape `spur agent doctor --refresh-usage`); plugins/sp/skills/spur-cli/references/agent.md documents `agent usage`; `setProjectExecutorDisabled` deleted — grep across packages/apps: 0 matches |
| R7 | MET | apps/cli/tests/commands/agent-usage.test.ts covers R1-R3 (verb + fixture + stubbed binary via `setAgentUsageSourceForTesting` apps/cli/src/commands/agent.ts:93); repo gate GREEN: .spur/run/0892-test-gate.status=PASS, .spur/run/0892-test-gate.log "8484 pass / 0 fail", biome clean, typecheck 7/7, 46 pre + 2 post rules |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | agent-usage-producer.test.ts "R1: applies quota-owned disable→enable for a matching executor and writes the snapshot": change action `applied` for alpha, snapshot written with `source: codexbar`, drain applied; complement R2 test proves writes only when not dry-run |
| AC2 | MET | test | agent-usage-producer.test.ts "R2: dry run reports would-be changes but writes neither snapshot nor rows": snapshotPath null, drain null, existsSync false, no row |
| AC3 | MET | test | agent-usage-producer.test.ts "R3: unusable capture throws UsageSourceError and touches nothing" + apps/cli agent-usage-source.test.ts "fail-closed: unusable launch" and "passes through non-zero exits" |
| AC4 | MET | test | apps/cli/tests/commands/agent-usage.test.ts:294-297 serve-module grep test (no codexbar/agent-usage reference in serve.ts) |
| AC-5 | MET | test | Snapshot + provider->executor mapping + quota-owned apply: atomic snapshot `writeSnapshotAtomic` `packages/app/src/services/agent-usage-producer.ts:214-224` (`~/.config/spur/agent-usage.json`, source/capturedAt/providers/raw); `mapProvidersToExecutors` `:118-136`; quota-owned observations via `AgentExecutorUpdateDao.recordObservation` + `drainPendingAgentQuotaUpdates`; errored providers skipped `classifyProviderUsage` `:96-116`; unmapped listed never guessed; tests `agent-usage-producer.test.ts` R1, real-run fixture `apps/cli/tests/fixtures/codexbar-usage.json` |
| AC-6 | MET | test | Dry run: `options.dryRun` branch `agent-usage-producer.ts:198-206` returns `snapshotPath:null`, `drain:null`, change action `would-apply`, writes nothing; test `agent-usage-producer.test.ts` R2 (existsSync false, no row) |
| AC-7 | MET | test | Fail-closed: missing binary -> `UsageSourceError` `apps/cli/src/services/agent-usage-source.ts:34-46`; unparsable output rejects whole capture (`codexbarEntriesSchema` safeParse, producer `:281-289`); non-zero exit with parsable array is not a failure (`erroredProviders` skip, healthy still applied); previous snapshot untouched (write only after successful parse); tests R3 + `agent-usage-source.test.ts` fail-closed legs; reactive B5 event path unchanged |
| AC-9 | MET | test | Never scheduled by serve: `apps/cli/tests/commands/agent-usage.test.ts:294-297` greps serve.ts for codexbar/agent-usage (0 hits); no poller/timer in serve; docs `docs/help/cmd_agent.md` + `plugins/sp/skills/spur-cli/references/agent.md` carry external cron/launchd scheduling guidance |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T04:51:54.147Z todo → wip (system)
- 2026-09-18T05:34:33.099Z wip → testing (system)
- 2026-09-18T05:38:21.648Z testing → done (system)

