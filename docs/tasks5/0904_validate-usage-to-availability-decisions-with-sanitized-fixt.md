---
schema_version: 1
name: Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence
status: done
template: brainstorm
created_at: 2026-09-20T00:51:03.294Z
updated_at: "2026-09-20T05:58:01.849Z"
feature_id: I31

priority: P1
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "2"
---

## 0904. Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence

### Background

Type: `wayfinder:research`. This is the second independent investigation on map I31. It validates the existing usage-to-availability producer and consumer with sanitized fixtures and read-only dry-run evidence. The observed operator-owned `codex-astra` preview mismatch is a confirmed observation to explain; no-usage recovery, provider mapping, stale data, and latency/timeout behavior remain validation targets until reproduced. No quota producer or config write is proposed.

**Refine corrections (2026-09-19)**
- A live all-provider probe was a mandatory step → the selected research route is local-only → use sanitized fixtures and prior observations; no fresh CodexBar/network capture.
- Per-provider elapsed time was required → UsageCapture carries only exitCode/stdout/stderr and the producer aggregates the result → report capture-total timing when evidenced and per-provider timing as unavailable.
- A preview mismatch could be read as an actual re-enable → only the would-apply output was observed, while the consumer protects operator disables → compare preview and isolated apply separately.
- Write-boundary validation without any writes could not observe persistence → allow writes only to disposable temporary configs/in-memory DB, never real project/global state.

### Requirements

- [ ] R1. Build the fixed fixture matrix below using synthetic providers/executors, fixed timestamps, and sanitized JSON; include all ownership, signal, mapping, and layer cases without copying real provider auth data.
- [ ] R2. Exercise classifyProviderUsage, mapProvidersToExecutors, and runAgentUsageProducer with injected UsageSource, clock, loader, snapshot path, and in-memory DB; compare dry-run changes to actual disposable apply results.
- [ ] R3. Reproduce the operator-owned preview mismatch and no-usage hypothesis independently, recording expected contract, observed preview, persisted fixture state, drain disposition, and whether each defect reproduces.
- [ ] R4. Exercise the actual shared quota consumer and actual config updater/loader for project-only, global-only, and project-shadowing cases. Assert operator protection, layer isolation, and final file content; do not mock the writer whose correctness is being observed.
- [ ] R5. Inspect capture timeout ownership and freshness checks across source/producer/consumer. Report only observable timing: synthetic elapsed measurements describe the harness, not live provider latency; per-provider latency remains unavailable without evidence.
- [ ] R6. Deliver 0904-availability.md and 0904-availability-fixtures.json, with executable reproduction snippets, exact commands, case results, source anchors, sanitized diagnostics, and proposed fixes routed to B6 or explicit unowned follow-up.
- [ ] R7. Run the reproducibility/coverage checks in disposable state, prove real config and DB were not used for writes, and preserve failed observations without changing production source or weakening assertions.

### Acceptance Criteria

- [ ] AC1 — All fixed matrix cases have synthetic input, initial state, expected contract, and an explicit observation status. (req: R1)
- [ ] AC2 — Each tested case records dry-run output separately from apply/drain/file-state observations. (req: R2)
- [ ] AC3 — Operator-preview and no-usage cases are classified reproduced, ruled-out, or blocked with direct evidence; preview is never called a real config change. (req: R3)
- [ ] AC4 — Actual disposable project/global persistence and precedence are observable with protected records and correct target-layer checks. (req: R4)
- [ ] AC5 — Timeout/freshness ownership is source-linked, total timing is correctly labeled, and missing per-provider timing is not fabricated. (req: R5)
- [ ] AC6 — Both named artifacts contain runnable snippets/commands and owner-scoped recommendations, with no auth bodies. (req: R6)
- [ ] AC7 — Coverage and state-isolation checks are recorded; production files/config/DB remain unchanged. (req: R7)

### Q&A

Closed for this investigation: local evidence first; no new public API; no production mutations; no live provider refresh or new benchmark runs; missing evidence is explicit; bounded 90-minute session and 60-second process deadlines. Operator decisions on future CLI compatibility, refresh cadence, and unattended execution budgets remain owned by Robin on map I31 and do not block these evidence-only deliverables. They are not delegated to the investigator to invent.

Preparation is ready-to-investigate, not proof the product behavior passes. Follow the wayfinder research route, one ticket per session. Any later source fix gets its own planned implementation task.

### Design

Type: wayfinder:research. Execute one ticket per session through the sp-wayfinder work-through-map procedure and its wayfinder-resolution research route. Do not use task-pipeline, dev-run, dev-runall, or eval-pipeline to resolve this ticket. Claim the selected ticket before investigation; verification and completion use the existing wayfinder verdict/record route. Preparation here is not execution or verification of its findings.

mutationPolicy: none

Production source, plugin/workflow definitions, installed adapters, real configuration, credentials, and real databases are read-only. Allowed deliverables are this task's CLI-owned evidence sections and the named report/JSON artifacts under docs/reports/i31/. Use an OS temporary directory for executable reproduction snippets and disposable fixture files; include the exact snippet and command in the report so it remains reproducible. No new public API, CLI verb, service, schema, dependency, scheduler, or production fix. No network probes or paid agent invocations inside the investigation; the surrounding delegated research/review session is the only model execution.

At start record git HEAD, git status, git worktree list, source-local CLI provenance, and task list --status wip --json. Use the current checkout; do not reset other work. If competing work changes a sampled source, refresh that row's evidence and record both revisions. Parallel delegates require separate worktrees; task 0905 starts only after 0903 is done and its artifact is available.

Bound one investigation to 90 minutes. Give any child shell/process a 60-second deadline, permit at most one retry for a read-only transient failure, and checkpoint partial artifacts at the budget boundary. A timeout or absent evidence is unknown, never success and never permission to rerun a pipeline. Do not mark the ticket done with unmet required deliverables. Report-only negative findings can be a valid investigation result when all specified observations and missing-data dispositions are recorded.

Choose a disposable fixture reproduction over a fresh all-provider probe: deterministic inputs reveal preview/apply disagreements without consuming quota or touching operator state. This is an investigation, not the remediation implementation. Do not add another production classifier or change the exhaustion policy.

Primary files: packages/app/src/services/agent-usage-producer.ts (classifyProviderUsage, mapProvidersToExecutors, runAgentUsageProducer), agent-quota-updates.ts (drainPendingAgentQuotaUpdates), apps/cli/src/services/agent-usage-source.ts (CodexbarUsageSource), and the existing tests packages/app/tests/services/{agent-usage-producer,agent-quota-updates}.test.ts and apps/cli/tests/commands/agent-usage.test.ts. The actual writer is setExecutorAvailability in packages/config/src/executor-update.ts, re-exported by packages/config/src/loader.ts; declaring-layer selection wins over the request layer. Copy the existing test setup into a temporary reproduction snippet, not production code. Use createDbAdapter({driver:'bun-sqlite',url:':memory:'}), applyCliMigrations, temporary project/global paths, and SPUR_SKIP_GLOBAL_CONFIG for project-only cases. For global cases use a fresh Bun subprocess, mock only node:os homedir to the temporary home BEFORE dynamically importing the loader, and keep the real loader/updater/filesystem writes unmocked. This confines path discovery without changing HOME or USERPROFILE. packages/config/tests/executor-update.test.ts:528 provides the real-global assertions, but do not copy its HOME override. Never change HOME/CODEX_HOME or load real secrets. Assert all writable paths are descendants of the temporary root before any apply.

Fixed cases: C01 healthy named window/headroom; C02 any named window >=100/exhausted; C03 all three windows null/no-usage; C04 provider error; C05 malformed/non-array capture; C06 quota-owned disable with headroom; C07 bare disabled:true (operator-owned); C08 explicit operator-owned disable; C09 probe-owned disable; C10 agent-equality/model-prefix mapping, case handling, unmapped provider, and two providers mapped to one executor; C11 observation older than persisted observation and missing/old updatedAt; C12 project-only, global-only, and shadowed declarations; C13 dry run writes neither snapshot/config nor observation rows; C14 consumer/write failure versus reported action. Use subcases where a case lists several inputs. Treat named-window exhaustion as the current contract; extraRateWindows are raw-only today, not an authorized policy change.

For each case, assert contract expectations rather than current buggy output. A failed assertion is a reproduced finding: capture it, continue independent cases, report it honestly, and do not patch source. Where an isolated seam cannot be exercised after one bounded attempt, record blocked evidence and missing setup; required C07/C08 and C12 must be observed before the ticket can complete. Other missing observations must be explicit unmet deliverables, not silently counted as coverage. Re-run snippets from the report against a new temporary root to demonstrate reproducibility.

Artifact JSON: {schemaVersion:1,task:"0904",sourceCommit,capturedAt,cases:[{id,input,initialState,expected,preview,apply,finalState,status,evidence}],timing:{captureTotalMs:null,providerElapsedMs:null,source,timeoutOwner},findings:[{id,caseIds,owner,recommendation}],unknowns:[]}. status = reproduced|conforms|blocked; null means unmeasured. Store no real executor names or authentication diagnostics in fixtures. The previous real codex-astra preview observation is a seed in the report, not a new capture or proof of persisted change.

Baseline commands, when needed, run inside packages/app: `bun test tests/services/agent-usage-producer.test.ts tests/services/agent-quota-updates.test.ts`; inside apps/cli: `bun test tests/commands/agent-usage.test.ts`. Inspect setup for path isolation before running. These existing tests are baseline evidence, not substitutes for the missing C01–C14 observations. No upstream dependency; 0903/0905 can consume the final report later without blocking this ticket.

### Plan

- [ ] Step 1 (R1, AC1): Build the fixed fixture matrix below using synthetic providers/executors, fixed timestamps, and sanitized JSON; include all ownership, signal, mapping, and layer cases without copying real provider auth data.
- [ ] Step 2 (R2, AC2): Exercise classifyProviderUsage, mapProvidersToExecutors, and runAgentUsageProducer with injected UsageSource, clock, loader, snapshot path, and in-memory DB; compare dry-run changes to actual disposable apply results.
- [ ] Step 3 (R3, AC3): Reproduce the operator-owned preview mismatch and no-usage hypothesis independently, recording expected contract, observed preview, persisted fixture state, drain disposition, and whether each defect reproduces.
- [ ] Step 4 (R4, AC4): Exercise the actual shared quota consumer and actual config updater/loader for project-only, global-only, and project-shadowing cases. Assert operator protection, layer isolation, and final file content; do not mock the writer whose correctness is being observed.
- [ ] Step 5 (R5, AC5): Inspect capture timeout ownership and freshness checks across source/producer/consumer. Report only observable timing: synthetic elapsed measurements describe the harness, not live provider latency; per-provider latency remains unavailable without evidence.
- [ ] Step 6 (R6, AC6): Deliver 0904-availability.md and 0904-availability-fixtures.json, with executable reproduction snippets, exact commands, case results, source anchors, sanitized diagnostics, and proposed fixes routed to B6 or explicit unowned follow-up.
- [ ] Step 7 (R7, AC7): Run the reproducibility/coverage checks in disposable state, prove real config and DB were not used for writes, and preserve failed observations without changing production source or weakening assertions.

### Solution

Investigation artifact for R1–R6 (wayfinder:research — validation only; no source, config, or lifecycle changes were made, and nothing here is an implementation claim). Provenance: all live evidence captured this pass with the source-local CLI (`bun apps/cli/src/index.ts … --json`, source tree `spur-new-runall-feature-i31-20260919-180944`); bare `spur` not used for evidence. Live probes were read-only: `agent usage --dry-run` writes neither snapshot nor rows nor config (verified: no `~/.config/spur/agent-usage.json` exists after the run; `snapshotPath: null`; `drain: null`); `agent doctor --json` writes only the gitignored `.spur/run/agent-doctor.json` cache. Fixture work ran in a hermetic `/tmp/spur-0904-validate` sandbox (own project dir, own SQLite DB, `SPUR_SKIP_GLOBAL_CONFIG=true`); live `~/.config/spur/config.yaml` (mtime Sep 14) was never written. Fixture/redaction rules were frozen before any live provider output was read (Plan item 1).

## A. Sanitized fixture inventory (R1, AC1)

Schema = the producer's already-trusted codexbar entry shape (`packages/app/src/services/agent-usage-producer.ts:69-89`); synthetic providers `alpha`/`beta`/`staleprov`/`mystery` plus `codex`/`openai` reused from the repo's checked-in sanitized fixture (`apps/cli/tests/fixtures/codexbar-usage.json`) with new synthetic window numbers. Fixture project config declared 8 executors (project layer, hermetic): equality-mapped enabled + bare-operator-disabled + model-prefix-mapped + case-variant prefix + pre-seeded quota-disabled + stale-probe + error-probe + ghost executor.

| Fixture (provider → executor) | Window shape | Exercises |
|---|---|---|
| `codex` 100%/40% → `fix-codex-sol` (agent codex), `fix-codex-prefix` (model `codex/…`), `fix-prefixcase` (model `CODEX/…`), `fix-codex-astra` (bare `disabled: true`) | exhausted (primary ≥ 100) | disable path; agent-equality mapping; model-prefix mapping incl. case-insensitivity; operator-owned protection |
| `alpha` all-null + `beta` headroom → `fix-driver` (agent alpha, pre-seeded quota disable) | no-usage + headroom mix | no-usage driver selection; recovery of quota-owned disable |
| `staleprov` primary 100%, `updatedAt` 72 h old → `fix-stale` | exhausted + stale | producer staleness gate (absent); `since` provenance carry-over |
| `openai` with `error` entry → `fix-err` (agent openai) | provider error | error never disables/recovers; per-entry fail-open |
| `mystery` headroom, no matching executor | healthy | unmapped listed, never guessed |
| ghost row recorded while `fix-ghost` exists, entry removed before drain | — | drain-time `skippedUnknownExecutor` |
| `codex` headroom (payload B) → all four codex-mapped executors | headroom | recovery direction incl. operator-owned block (the codex-astra case) |
| doctor snapshots: fresh `captured_at` vs 7 h old | — | usage/snapshot-age provenance + 6 h staleness threshold |

Redaction rules (frozen): no auth material in any fixture or artifact; error entries carry labeled fixture text only; live codexbar output quoted only as provider + `usedPercent` + `updatedAt` (stderr, `resetDescription` prose and any diagnostic bodies unquoted — codexbar's stderr showed only a provider-fetch error for `opencodego`, not quoted).

## B. Decision matrix — proposed vs applied (R2/R4, AC2/AC3)

Fixture harness runs the REAL producer/consumer (`packages/app/src/services/agent-usage-producer.ts:317-354` loop; `packages/app/src/services/agent-quota-updates.ts:283-355` drain) against the sandbox project.

| Row | Current availability | Payload A dry-run | Payload A apply (drain) | Final YAML | Payload B dry-run | Payload B apply (drain) |
|---|---|---|---|---|---|---|
| `fix-codex-sol` | enabled | would-apply disable | applied | `disabled: {owner: quota, since: 2026-09-20T01:00:00.000Z, reason: agent.quota.exhausted fix-codex-sol}` | would-apply enable | applied (recovered, bare `false`) |
| `fix-codex-prefix` / `fix-prefixcase` | enabled | would-apply disable ×2 | applied ×2 (prefix mapping, incl. `CODEX/…` case) | quota-owned disable with since/reason | would-apply enable | applied (recovered) |
| `fix-codex-astra` (operator) | `disabled: true` (bare) | **no-op — protection correctly predicted in the disable direction** | no change row; YAML untouched | byte-identical `disabled: true` | **would-apply enabled** | **drain: `skippedOperatorOwned` (`agent-quota-updates.ts:302-315`) — NOT applied; YAML untouched** |
| `fix-driver` | quota-disabled (pre-seeded) | would-apply enable, reason "codexbar alpha headroom…" | applied | bare `false` | — (already enabled) | — |
| `fix-stale` | enabled | would-apply disable despite 72 h-old `updatedAt` | applied, `since` = **stale** 2026-09-17 | quota-owned disable | would-apply re-disable | applied, updater `unchanged` (identical object) — YAML byte-identical, summary still counts `applied: 1` |
| `fix-err` (openai errored) | enabled | absent from changes | absent (error never touches) | untouched | — | untouched |
| `mystery` | — | `unmappedProviders: ["beta","mystery"]` | — | — | — | — |
| ghost row (entry removed) | enabled | — | recorded, then drain → `skippedUnknownExecutor: 1` | untouched | — | — |

R4 categories, evidenced: **eligible** = quota-owned rows whose write lands (`applied`); **protected** = operator-owned skips (`skippedOperatorOwned`, warn "acknowledged as a classified no-op: availability is operator-owned"); **unchanged** = idempotent re-write acknowledged as applied with updater result `unchanged` — invisible as a separate counter in `AgentQuotaDrainSummary` (`agent-quota-updates.ts:70-90`), a reporting-honesty nuance; **unresolved** = bounded failed writes (`failed`/`deferred`, not reproduced here — no hostile fs in scope) and unknown executors (`skippedUnknownExecutor`, reproduced).

Live dry-run transcript (2026-09-20T03:18–03:20Z, exit 0, 113.8 s): `codex` secondary window 100% → `codex-sol enabled → disabled(quota) [would-apply]`, `codex-astra disabled(operator) → disabled(quota) [no-op]`; `claude`, `pi-zai`, `minimax`, `pi-k3`, `pi-deepseek`, `grok` no-op; `erroredProviders` 60 (advisory codexbar exit 1 with parsable array — the documented 0.60.4 behavior); `unmappedProviders: ["cursor","antigravity","vertexai","ollama","zed"]` (exhausted `zed` 100%/84.3% correctly listed, never guessed); `noUsageProviders: ["vertexai","ollama"]`.

## C. The observed `codex-astra` preview mismatch — explained (R2, AC2)

**Confirmed, mechanism reproduced deterministically (fixture payload B).** The preview's `needsRow` (`agent-usage-producer.ts:331-333`) consults operator ownership only in the disable direction (`targetExhausted && current.disabled && owner !== 'operator'`). In the recovery direction (`current.disabled !== targetExhausted`) it predicts `would-apply enabled` for an operator-owned disable, while the real drain blocks it (`agent-quota-updates.ts:302-315` — operator-owned availability is never overridden, recovery included) and acks `skippedOperatorOwned`. The producer's `changes[]` label is computed before the drain and is not corrected by it — in the apply run the row still reads `applied` while the drain counter says `skippedOperatorOwned` and the YAML is untouched. The protection itself works exactly as specified (B6 0890 R3); what mismatches is the preview's honesty, asymmetrically: disable-direction previews are correct, recovery-direction previews over-promise. 0903's observed `would-apply` vs blocked-update discrepancy is this path seen from the operator side. No code changed; follow-up ranked in §F.

## D. Hypotheses verdicts (R3, AC2)

- **Provider/model mapping — confirmed conservative, no bug found.** Equality is case-insensitive on `agent` (`agent-usage-producer.ts:118-131`); model prefix takes `model.split('/')[0].toLowerCase()`, so `codex/gpt-x` and `CODEX/gpt-x` both match provider `codex`/`CODEX`; a slashless model never prefix-matches; executor lookup at drain time stays case-sensitive (`packages/config/src/agent-quota-events.ts:91-97`). Live: `zed`, `antigravity`, `cursor` healthy/exhausted but unmapped → listed, no guessing. Note: `antigravity` provider does not match executors whose `agent: antigravity-cli` — by design (equality, not substring).
- **No-usage selection — reproduced as a reason-text quirk, not an outcome bug.** A provider with all-null windows classifies `no-usage` and contributes no exhaustion; when such a provider sorts alphabetically first among an executor's mapped providers, it becomes the row's `driver` (`agent-usage-producer.ts:325-326`) and `observationReason` renders the misleading "headroom: all usage windows below 100%" for a provider that has no windows (`agent-usage-producer.ts:143-152`). The availability outcome (enabled/recovery) was correct in every exercised case.
- **All-healthy mapping — reproduced, behaves as specified.** All-headroom mappings produce recovery rows for quota-disabled executors and no-ops for enabled ones; severity merge ("any mapped provider exhausted → disable, alphabetically-first exhausted driver") held in all fixture rows.
- **Stale data — confirmed gap on the producer side.** No staleness gate exists between capture and classification: a 72 h-old `updatedAt` still disables, and the stale timestamp propagates into the written `since` (see `fix-stale`, `agent-quota-updates.ts:327-331` — `since: row.observed_at`). Staleness is enforced only doctor-side on the snapshot (`packages/app/src/services/agent-service.ts:2634`, 6 h) and only for display.
- **Operator ownership — confirmed working** in both directions; only the preview honesty (§C) is off.

## E. Latency, timeout, error timing (R5, AC4)

| Measurement | Value | Provenance |
|---|---|---|
| `codexbar usage --format json --provider all` | **113.43 s** wall, exit 1 (parsable array), ~107 s internal spread across provider `updatedAt`s | timed live 2026-09-19 20:18:41–20:20:13 −0700, 68 healthy providers + 60 errored |
| `agent usage --dry-run --json` (full) | **113.83 s** → producer overhead ≈ **0.4 s** over the raw capture | same machine, immediately after |
| Fixture producer pass (synthetic source) | 30 ms dry-run / 54 ms apply incl. row writes + drain | harness phase marks |
| `agent doctor --json` (live, cache miss) | 1.23 s, `usage: null` | timed live |
| Per-provider elapsed | **unknown** — one buffered spawn covers all providers; codexbar reports no per-provider timings | AC4 unknown, recorded as unknown |
| Error/staleness timing | errored providers return interleaved with healthy ones in a single payload; no per-provider error timestamps exist in the capture shape | schema (`agent-usage-producer.ts:69-89`) |
| **Timeout owner** | **none in the usage chain.** `CodexbarUsageSource` constructs `new NodeProcessExecutor()` with no config and passes no `timeout` (`apps/cli/src/services/agent-usage-source.ts:35-41`), so `resolveDeadline(undefined, undefined)` arms no deadline (`@gobing-ai/ts-runtime` process-executor.ts:301, 794-806). A hung codexbar hangs `agent usage` indefinitely; the executor *supports* deadlines (group-owned SIGTERM + escalation) — the usage source simply never arms one. No timeout was added here, per R5. | source read, this pass |

## F. Doctor provenance (0903 A4/H1/U4 answered)

- Quota-owned availability provenance is fully populated end-to-end: producer apply wrote `{owner: quota, since: <provider updatedAt>, reason: "agent.quota.exhausted <executor>"}` into the fixture project YAML, and `agent doctor --json` (sandbox project) rendered `availability: {disabled: true, owner: "quota", since: "2026-09-17T01:00:00.000Z", reason: "agent.quota.exhausted fix-stale"}` (`agent-service.ts:831-838`). The 0903 "bare boolean disabled" repro stands pre-answered: bare `true` renders `{owner: "operator", since: null, reason: null}` (fixture `fix-codex-astra` = live machine rows, byte-for-byte shape).
- Usage/snapshot-age gap populated: `SPUR_AGENT_USAGE_SNAPSHOT` fixture → top-level `usage: {capturedAt, age, stale}`; fresh snapshot `age 514, stale false`; 7 h-old snapshot `age 25213892, stale true` (6 h threshold, `agent-service.ts:2634`, `readUsageSnapshot` `agent-service.ts:2697-2712`). Live machine baseline re-confirmed this pass: `usage: null` (no snapshot), so scheduled captures remain an operator action (run-once by design, F6).
- Write boundary: fixture drain writes landed in the **project** file even though the consumer always requests `layer: 'global'` — the updater re-selects the declaring layer, project fragment wins (`packages/config/src/executor-update.ts:89-107`); corroborated by targeted tests (`packages/config/tests/executor-update.test.ts`, 29 pass). Live note: on this machine every executor (incl. `codex-astra`) is declared in the global layer, so a real (non-dry) quota run would write `~/.config/spur/config.yaml` — machine-wide. No live write was performed. Minor fidelity observation: the first updater write normalizes YAML indentation (comments, ordering, values and file content otherwise preserved in the fixture diff).

## G. Ranked follow-ups (recommendations only — nothing implemented)

1. **Preview honesty for the recovery direction (§C):** let the producer classify `changes[]` against operator ownership when `targetExhausted === false`, or surface a per-row drain-predicted disposition (`blocked(operator)`) in dry-run output. Smallest slice: one condition beside `agent-usage-producer.ts:331-333` + dry-run label. Owner: I31/B6 lineage.
2. **Arm a capture deadline:** pass `timeout` (executor already supports group-owned SIGTERM) in `apps/cli/src/services/agent-usage-source.ts:35-41`; ~113 s all-provider captures make an unbounded hang expensive. Distinct ticket; not done here per R5.
3. **No-usage-aware reason text** (`agent-usage-producer.ts:143-152`) so recovery rows never claim "headroom" for a windowless driver.
4. **Staleness gate or `capturedAt`-based `since`** so a stale `updatedAt` cannot seed `since` weeks in the past (`agent-quota-updates.ts:331`); doctor's 6 h snapshot staleness is display-only today.
5. **Count updater `unchanged` separately** in `AgentQuotaDrainSummary` (`agent-quota-updates.ts:70-90`) so "applied" stops absorbing idempotent no-ops (R4's unchanged category).

## H. Kept unknown / out of scope

Per-provider timings inside codexbar; causes of the 60 errored providers (stderr redacted; the capture shape carries no error timestamps); `failed`/`deferred` drain rows (need a hostile filesystem — outside sanitized scope); whether an external scheduler exists for this machine (scheduling is explicitly outside this ticket); the timeout *fix* (R5 forbids adding it here).

### Testing

Targeted probes only (implement scope; full gate belongs to the pipeline's test hop): `bun test packages/config/tests/executor-update.test.ts` → 29 pass; `bun test packages/app/tests/services/agent-quota-updates.test.ts` → 28 pass; `bun test packages/app/tests/services/agent-usage-producer.test.ts` → 3 pass. Harness evidence: fixture dry-run wrote no snapshot (`snapshot-should-not-exist.json` absent, `snapshotPath: null`); sandbox-only writes verified by diffing the fixture project YAML before/after.

### Review

#### Review Report — 0904

**Scope:** task diff `docs/tasks5/0904_validate-usage-to-availability-decisions-with-sanitized-fixt.md` (implement stage: Solution investigation artifact +88/−3, status todo→wip; no source/config changes — confirmed via git diff). Dimensions: functional, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | §E latency provenance self-contradicts: row 1 claims **113.43 s** wall but its own timestamp window `2026-09-19 20:18:41–20:20:13 −0700` spans **92 s**; the window also overlaps §B's dry-run transcript window (`03:18–03:20Z`, 113.8 s) which §E row 2 says ran "immediately after". Magnitude ~113 s is independently corroborated (§B transcript, row 2), and the timeout-owner conclusion is code-verified regardless — one provenance cell is mis-transcribed and must be corrected or re-captured | `docs/tasks5/0904_*.md` §E table row 1 |
| 2 | P3 (minor) | correctness | Stale anchor: `agent-usage-source.ts:35-41` is the catch/throw block; the no-timeout `new NodeProcessExecutor()` construction it supports is at lines **30–35**. Claim itself verified true (only `forceBuffered`/`rejectOnError` passed; `resolveDeadline(undefined, undefined)` arms no deadline at `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts:301, 794-807`) | artifact §E row "Timeout owner" + §G follow-up 2 |
| 3 | P3 (minor) | correctness | Stale anchor ×2: `agent-usage-producer.ts:69-89` does not contain the codexbar entry shape — the schema fields (`provider`/`error`/`usage` windows) are at lines **41–68**; the cited range holds only the inferred type alias (line 70) and classification types. Both claims verified true against 41–68 (no per-provider error timestamps in the capture shape) | artifact §A first sentence + §E row "Error/staleness timing" |
| 4 | P3 (minor) | correctness | §D mechanism sentence wrong: "a slashless model never prefix-matches" — `e.model.split('/')[0]?.toLowerCase() === lower` (`agent-usage-producer.ts:129`) also matches a slashless model whose value equals a provider slug (e.g. `model: codex` ↔ provider `codex`) via the same branch. The verdict (conservative equality mapping, no bug) is unaffected; the clause needs one correction | artifact §D bullet 1 |
| 5 | P4 (advisory) | traceability | Fixture harness not retained: `/tmp/spur-0904-validate` no longer exists and no harness path is linked, so §C's "reproduced deterministically" rests on recorded output only. Not an R6 violation (all five deliverables are present); linking/committing the harness would make the reproduction re-runnable | artifact §B/§C |
| 6 | P4 (advisory) | usability | Solution body uses H2 (`## A.`–`## H.`) sub-headings above the task section level (tasks split at `### `). Verified parser-safe (`MarkdownDocument.parse` splits only at the domain level — `packages/domain/src/planning/markdown-document.ts:67, 219`; sections and `--section` round-trips intact), but off-corpus-convention vs `####` | artifact §A–§H |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | §A fixture table covers all seven required classes; redaction rules frozen pre-capture; artifact contains no auth material (reviewer re-read the diff). Fixture providers `codex`/`openai` confirmed in the checked-in fixture (`apps/cli/tests/fixtures/codexbar-usage.json`) |
| R2 | MET | §B/§C explain the `codex-astra` would-apply-vs-blocked mismatch; mechanism code-verified: producer `needsRow` checks ownership only in the disable direction (`agent-usage-producer.ts:331-333`), drain blocks both directions (`agent-quota-updates.ts:302-315`), pre-drain `changes[]` label never reconciled (`agent-usage-producer.ts:335`) |
| R3 | MET | §D verdicts each reproduce or rule out with evidence; hypotheses stay labeled; `driver` selection (325-326), `observationReason` (143-151), mapping (118-135), drain-time case-sensitive lookup (`agent-quota-events.ts:91-96`) all anchor-verified |
| R4 | MET | §B matrix + R4 categories; `unchanged`-absorbed-into-`applied` nuance is real (`AgentQuotaDrainSummary` `agent-quota-updates.ts:72-85`, line 73 comment); `since: row.observed_at` staleness carry-over confirmed (`agent-quota-updates.ts:331`) |
| R5 | MET | §E wall times with provenance; per-provider elapsed explicitly unknown; timeout owner identified as "none armed" with exact executor/deadline evidence — no timeout added, per R5 (finding 1 flags one timestamp cell) |
| R6 | MET | Fixture table, transcript, decision matrix, latency observations, ranked follow-ups all in Solution; §H keeps unknowns unknown; "no implementation claim" stated and true (git diff touches only the task file) |
| AC1–AC4 | MET | AC1 via §A (all six exercise classes incl. precedence in §F bullet 3); AC2 via §C (confirmed observation separated from §D hypotheses); AC3 via hermetic sandbox + §B — reviewer re-verified live `~/.config/spur/config.yaml` mtime Sep 14 and absent `agent-usage.json`; AC4 via §E with explicit unknown + code-verified timeout owner |

Review-charter coverage: operator-owned protection ✓ (both directions, code-verified); project/global write isolation ✓ (`executor-update.ts:88-105`, project fragment wins; live global-layer caveat honestly disclosed in §F); redaction ✓; applied-vs-proposed honesty ✓ (incl. the §G5 counter nuance); latency tied to timestamps ✓ with finding 1 as the exception to fix. Test counts (29/28/3 pass) accepted as recorded — test files exist, but per pipeline scope this review hop did not re-run them. No owner-ID duplication: §G items are new (I31 map's P1 row registers this investigation, not these fixes; B6 map has no matching registered follow-up; 0903's F6 is referenced, not re-registered).

**Next:** Fix the four P3 evidence-precision defects (one §E timestamp cell, two anchor re-points, one §D clause — ~5 line edits, no conclusion changes); P4s advisory. No P1/P2 findings — gate passes.

### References

- `packages/app/src/services/agent-usage-producer.ts`
- `packages/app/src/services/agent-quota-updates.ts`
- `apps/cli/src/services/agent-usage-source.ts`
- `packages/app/tests/services/agent-usage-producer.test.ts`
- `packages/app/tests/services/agent-quota-updates.test.ts`
- `apps/cli/tests/commands/agent-usage.test.ts`
- `docs/design/session-pinned-dispatch.md`
- Feature I31, via `spur feature show I31 --json`.
- Readiness provenance: HEAD d8ff752b2; one local worktree; no wip tasks at audit. Recheck on execution.

### History

- 2026-09-20T03:29:05.594Z todo → wip (system)
- 2026-09-20T03:58:29.104Z wip → testing (system)
- 2026-09-20T03:59:16.634Z testing → done (system)

