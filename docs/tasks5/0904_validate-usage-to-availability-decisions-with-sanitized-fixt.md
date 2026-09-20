---
schema_version: 1
name: Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence
status: done
template: brainstorm
created_at: 2026-09-20T00:51:03.294Z
updated_at: "2026-09-20T03:59:16.634Z"
feature_id: I31

priority: P1
ac_altitude: task-local
---

## 0904. Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence

### Background

Type: `wayfinder:research`. This is the second independent investigation on map I31. It validates the existing usage-to-availability producer and consumer with sanitized fixtures and read-only dry-run evidence. The observed operator-owned `codex-astra` preview mismatch is a confirmed observation to explain; no-usage recovery, provider mapping, stale data, and latency/timeout behavior remain validation targets until reproduced. No quota producer or config write is proposed.

### Requirements

- [x] R1. Define sanitized fixtures for provider/model mapping, healthy usage, no-usage, provider errors, stale snapshots, operator-owned disabled/enabled records, and project/global configuration precedence; redact auth diagnostic bodies.
- [x] R2. Run the source-local usage dry-run and compare proposed changes with the consumer's operator-owned protection, including the observed `codex-astra` would-apply versus blocked-update discrepancy at `packages/app/src/services/agent-quota-updates.ts:297-315`.
- [x] R3. Reproduce or rule out the no-usage selection and all-healthy mapping hypotheses in the usage producer loop (around the cited lines 317-354), and document agent equality/model-prefix mapping behavior with raw snapshots kept sanitized.
- [x] R4. Verify applied-versus-proposed reporting and project/global write boundaries without persisting changes; show which rows are eligible, protected, unchanged, or unresolved.
- [x] R5. Measure total and per-provider elapsed time, error/staleness timing, and timeout behavior for an all-provider run. Identify the current timeout owner or record it as unknown; do not add a timeout in this ticket.
- [x] R6. Deliver a sanitized fixture table, dry-run transcript, decision matrix, latency/timeout observations, and ranked follow-up recommendations in this task's Solution or linked run artifact. Keep unknown outcomes unknown and do not claim implementation.

### Acceptance Criteria

- [x] AC1 — Sanitized fixtures exercise provider mapping, no-usage, errors, staleness, operator ownership, and project/global precedence.
- [x] AC2 — The artifact explains the observed operator-owned preview mismatch and separates confirmed observation from hypotheses that did not reproduce.
- [x] AC3 — Applied-versus-proposed rows and write boundaries are evidenced without changing project or global configuration.
- [x] AC4 — Latency and timeout ownership are reported with provenance, including an explicit unknown when the underlying timeout cannot be established.

### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

Reuse the existing usage producer, consumer, raw snapshot shape, and dry-run report. Construct minimal sanitized fixtures around the trust and ownership boundaries; compare the preview to the actual update guard instead of adding another classifier. Treat provider mapping as an evidence question, preserve operator-owned records, and keep external scheduling outside this ticket.

### Plan

- [x] Freeze the fixture schema and redaction rules before reading provider output.
- [x] Capture a source-local dry-run with elapsed-time provenance and no write mode.
- [x] Exercise each fixture through proposed/apply classification and owner precedence.
- [x] Reproduce mapping/no-usage/staleness hypotheses and classify failures or unknowns.
- [x] Publish the sanitized decision matrix and quota correctness follow-up order.

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

- Map: `docs/features/I31_post-delivery-spur-dev-improvement-roadmap-after-b6-b7-b8-and-g66.md`
- Producer/consumer evidence: B6 usage producer and `packages/app/src/services/agent-quota-updates.ts:297-315`; source-local `agent usage --dry-run --json`
- Related owner: `docs/features/B6_executor-availability-lifecycle-disable-ownership-recovery-global-config-persistence-and-an-explicit-usage-producer.md`
- Configuration boundary: `.spur/config.yaml`, `~/.config/spur/config.yaml`, and the existing project/global loader contract (read-only during this ticket)

### History

- 2026-09-20T03:29:05.594Z todo → wip (system)
- 2026-09-20T03:58:29.104Z wip → testing (system)
- 2026-09-20T03:59:16.634Z testing → done (system)

