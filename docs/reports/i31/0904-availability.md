# 0904 — Usage-to-availability validation (report artifact)

**Task:** 0904 (feature I31) · **Source commit:** `99562391f14d2118b80a189826fca0b8e2f25e4b` · **Captured:** 2026-09-20T06:51:00Z
**Provenance:** remediation artifact under verify `--fix all` re-verification. Case observations are transcribed from the task `### Solution`'s recorded hermetic-harness run (real producer/consumer/updater against a disposable sandbox: own project dir, own SQLite DB, `SPUR_SKIP_GLOBAL_CONFIG=true`). The sandbox (`/tmp/spur-0904-validate`) is gone per the Design's disposable-fixture rule; case data + fixtures live on in `0904-availability-fixtures.json` (same directory). **No auth bodies anywhere** — redaction validated by the checker.

## Exact commands (reproducible)

```bash
# Live read-only probes (re-runnable; dry-run writes nothing — re-confirmed this run:
# no ~/.config/spur/agent-usage.json exists after probing)
bun run apps/cli/src/index.ts agent usage --dry-run --json        # full preview, exit 0
bun run apps/cli/src/index.ts agent doctor --json                 # availability rows + usage key

# Repeatable checker (this artifact's R7 gate)
bun run docs/reports/i31/0904-check.ts                            # exit 0 = CHECK-PASS

# Harness shape (reconstruction from recorded behavior — original snippet was disposable):
# import { runAgentUsageProducer } from 'packages/app/src/services/agent-usage-producer.ts'
# with injected UsageSource (fixture payloads A/B), fixed clock, fixture loader,
# SPUR_AGENT_USAGE_SNAPSHOT path, and an in-memory SQLite DB; then drain via
# packages/app/src/services/agent-quota-updates.ts against a sandbox project config
# declaring the 8 fix-* executors. Sandbox root: any fresh $TMPDIR dir with
# SPUR_SKIP_GLOBAL_CONFIG=true.
```

## Case results (14 groups — full data in the JSON)

| Case | Group | Classification | Headline observation |
| --- | --- | --- | --- |
| C01–C03 | mapping | reproduced | Exhausted codex disables equality- and prefix-mapped executors (incl. `CODEX/…` case); quota-owned `since/reason` written |
| C04 | ownership | reproduced | Operator-bare `disabled: true` protected in the disable direction; preview correctly predicts no-op |
| C05 | signal | reproduced | No-usage provider drives a misleading "headroom" reason text but the recovery outcome is correct |
| C06 | signal | reproduced | **No staleness gate**: 72 h-old `updatedAt` still disables and seeds a stale `since` |
| C07 | signal | reproduced | Provider error entries never disable/recover; fail-open holds |
| C08 | mapping | reproduced | Unmapped providers listed (`unmappedProviders`), never guessed |
| C09 | ownership | reproduced | Removed-before-drain entry → `skippedUnknownExecutor: 1` |
| C10 | ownership | **reproduced (defect)** | **Preview mismatch**: recovery direction predicts `would-apply enabled` for an operator-owned disable; real drain blocks it (`skippedOperatorOwned`) while `changes[]` still reads `applied` |
| C11 | mapping | reproduced | Headroom recovers quota-owned rows (bare `false`) |
| C12 | signal | reproduced | Idempotent re-disable: updater `unchanged`, YAML byte-identical, summary still counts `applied: 1` (reporting nuance) |
| C13 | layer | reproduced | Doctor usage provenance populates from snapshot fixture: fresh `age 514 stale false`; 7 h `age 25213892 stale true` (6 h threshold) — answers 0903's H1/U4 |
| C14 | layer | reproduced | Consumer requests `layer: global`; updater re-selects the declaring layer — fixture writes landed in **project** YAML. Live corollary: all executors on this machine are global-declared, so a real quota run would write `~/.config/spur/config.yaml` |

## The preview mismatch, precisely (R3)

`needsRow` (`packages/app/src/services/agent-usage-producer.ts:331-333`) consults operator ownership only when `targetExhausted && current.disabled && owner !== 'operator'`. In the recovery direction it predicts `would-apply enabled` for an operator-owned disable, while the drain never overrides operator-owned availability (`packages/app/src/services/agent-quota-updates.ts:302-315`) and acks `skippedOperatorOwned`. Protection itself works exactly as specified (B6 0890 R3); only the preview's honesty is asymmetric: disable-direction previews are correct, recovery-direction previews over-promise.

## Timing (synthetic harness ≠ live latency; missing per-provider timing not fabricated)

| Measurement | Value | Note |
| --- | --- | --- |
| `codexbar usage --provider all` | 113.43 s wall, exit 1 (parsable array) | 68 healthy + 60 errored |
| `agent usage --dry-run --json` | 113.83 s | producer overhead ≈ 0.4 s |
| Fixture producer pass | 30 ms / 54 ms | harness marks |
| Per-provider elapsed | **unknown** | single buffered spawn; not fabricated |
| Timeout owner | **none in the usage chain** | `apps/cli/src/services/agent-usage-source.ts:35-41` arms no deadline; a hung codexbar hangs `agent usage` indefinitely (executor supports deadlines; the source never passes one) |

## Owner-scoped recommendations (nothing implemented)

1. **B6** — preview honesty for the recovery direction (`agent-usage-producer.ts:331-333`).
2. **B6** — arm a capture deadline (`agent-usage-source.ts:35-41`).
3. **B6** — no-usage-aware reason text (`agent-usage-producer.ts:143-152`).
4. **B6** — staleness gate / `capturedAt`-based `since` (`agent-quota-updates.ts:331`).
5. **unowned follow-up** — count updater `unchanged` separately in `AgentQuotaDrainSummary` (`agent-quota-updates.ts:70-90`).

## Coverage and state-isolation checks (R7)

- Checker: `bun run docs/reports/i31/0904-check.ts` → `CHECK-PASS: 14 cases (groups: layer,mapping,ownership,signal), 5 timing rows, 5 follow-ups, 5 unknowns; anchors + redaction validated` (exit 0, this run).
- State isolation: fixture writes confined to the disposable sandbox (own DB, `SPUR_SKIP_GLOBAL_CONFIG=true`); live `~/.config/spur/config.yaml` never written; this remediation wrote only `docs/reports/i31/0904-*` — `git status --porcelain` shows no production source or config change.
- Failed observations preserved as unknowns: per-provider timings, errored-provider causes, `failed`/`deferred` drain rows (hostile fs out of scope), external scheduler existence, the timeout fix itself.

## Checker output

```
$ bun run docs/reports/i31/0904-check.ts
CHECK-PASS: 14 cases (groups: layer,mapping,ownership,signal), 5 timing rows, 5 follow-ups, 5 unknowns; anchors + redaction validated
exit=0
```
