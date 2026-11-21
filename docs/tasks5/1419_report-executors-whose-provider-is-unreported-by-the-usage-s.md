---
schema_version: 1
name: Report executors whose provider is unreported by the usage source
status: done
template: issue
created_at: 2026-11-21T04:33:08.544Z
updated_at: "2026-11-21T06:22:47.547Z"
feature_id: B6

priority: P2
ac_altitude: task-local
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1419. Report executors whose provider is unreported by the usage source

### Background

`spur agent usage` only classifies providers the usage source returned, so an enabled executor whose provider the
source never reports is invisible: neither headroom nor exhaustion, never demoted, never flagged. On 2026-11-20 this
let a lapsed volc account stay the cheapest elected standard-tier executor until a run failed (see 1418).

**Evidence (observed 2026-11-20, re-verified 2026-11-20 refine).**

- `~/.config/spur/agent-usage.json` lists providers `codex, claude, antigravity, zai, minimax, kimi, opencodego,
  deepseek, commandcode, grok` — no `volc`.
- `~/.config/spur/config.yaml:115-117` `pi-dsv4.1-flash-volc` (`model: volc/deepseek-v4-1-flash-261017`) and
  `:134-136` `pi-zai-volc` (`model: volc/glm-5.3-flash`) both map to `volc`. The first is now operator-disabled
  (`:110-113` records why and that `agent usage` "can never demote it automatically").
- The producer builds every list from the returned entries only (`packages/app/src/services/agent-usage-producer.ts:300-322`);
  absence is invisible by construction.

**Refine corrections (2026-11-20)**

- R1 cited result fields at `:227-229` / `:451-452` → the result type is `AgentUsageRunResult`
  (`agent-usage-producer.ts:219-232`) and the return literal is `:442-452`; cites re-pointed.
- R1 "listing every enabled executor whose provider appears in none of the lists" implies the producer can name an
  executor's provider independently → it cannot; provider↔executor is matched only by `mapProvidersToExecutors`
  (`:148-165`: agent slug or model prefix). Design now derives the set as "enabled executors that no returned
  provider (healthy or errored) maps to" — same intent, no second mapping rule.
- R2 "never reported as headroom … capture leaves enabled state untouched" → already true by construction
  (`decisionMapping` uses only signal-bearing providers, `:357-362`); kept as a regression guard, not new behaviour.
- R2 "the rollup" → no rollup surface exists; the human output and `--json` result are the surfaces.
- R3 doctor reads the snapshot, not the live capture (`agent-doctor-report.ts:83-102`, `agent-doctor-ops.ts:64`) →
  the set must be persisted in the snapshot for doctor to see it.

### Requirements

- [x] R1. `AgentUsageRunResult` (`packages/app/src/services/agent-usage-producer.ts:219-232`) gains
  `unreportedExecutors: string[]`: the name-sorted enabled executors that no returned provider (healthy or errored)
  maps to via `mapProvidersToExecutors`. Computed on every run including `--dry-run`; persisted in the snapshot as
  `unreported_executors` (non-dry runs).
- [x] R2. Unreported executors are reported as unmeasured, never as headroom: `spur agent usage` prints one
  `Unmeasured executors (not reported by <source>): …` line when non-empty, `--json` carries the field, and the
  capture produces no `changes[]` row and no availability write for them (operator `disabled:` stays the only lever).
- [x] R3. `spur agent doctor` reads `unreported_executors` from the snapshot and, intersected with the executors that
  are enabled now, appends `; unmeasured: <names>` to the `usage:` footer line and `unreportedExecutors` to the
  `--json` `usage` object; nothing is added when the intersection is empty or the snapshot predates the field.
- [x] R4. When the source starts reporting a provider, its executors leave the set on the next capture with no code
  or config change.

Out of scope: auto-disabling unreported executors; probing provider credentials; changing the source (codexbar);
the run-time classifier (1418); new CLI verbs or flags.

### Acceptance Criteria

- [x] AC1 — Capture lists executors the source did not report (req: R1): Given a fake source payload without `volc`
  and a config with two enabled volc-model executors plus one disabled one, `runAgentUsage` returns
  `unreportedExecutors` = the two enabled names (sorted), and the written snapshot carries the same
  `unreported_executors`. Layer: `packages/app/tests/services/agent-usage-producer.test.ts`.
- [x] AC2 — Unreported executors are unmeasured, never changed (req: R2): For the same payload, `changes[]` has no row
  for those executors and their config availability is unchanged; `spur agent usage` text prints the `Unmeasured
  executors` line and `--json` includes the field. Layer: `apps/cli/tests/commands/agent/usage.test.ts`.
- [x] AC3 — Doctor names the unreported set (req: R3): Given a snapshot with `unreported_executors: ["a","b"]` where
  `b` is now disabled, the doctor footer reads `usage: <ts> (<age>); unmeasured: a` and `--json` `usage.unreportedExecutors`
  = `["a"]`; given an empty list or a snapshot without the field, the footer is unchanged. Layer:
  `packages/app/tests/services/agent-doctor-report.test.ts`.
- [x] AC4 — The set drains when the source reports the provider (req: R4): A payload that includes `volc` with a
  healthy window yields `unreportedExecutors: []` and otherwise identical changes. Layer:
  `agent-usage-producer.test.ts`.

### Q&A

- **Closed (refine 2026-11-20):** an errored provider's executors are not "unreported" — they already surface under
  `erroredProviders`.
- **Closed:** doctor filters the persisted list to executors enabled now.
- **Closed:** informational only — no auto-disable, no doctor exit-code change.

### Design

**WHAT.** One derived list, computed in the producer, persisted in the snapshot, rendered by `usage` and `doctor`.

**Frozen names.** Result field `unreportedExecutors: string[]`; snapshot key `unreported_executors`;
`DoctorUsageInfo.unreportedExecutors: string[]` (always present, `[]` when absent from the snapshot); human strings
`Unmeasured executors (not reported by <source>): <a, b>` and `; unmeasured: <a, b>`. No new flags, verbs or config.

**Algorithm (producer, after `healthyProviders` at `:315`).**

```ts
const returnedProviders = [...healthyProviders, ...erroredProviders.map((e) => e.provider)];
const reported = new Set([...mapProvidersToExecutors(returnedProviders, executors).values()].flat());
const unreportedExecutors = executors
    .filter((e) => !executorDisabled(e) && !reported.has(e.name))
    .map((e) => e.name)
    .sort();
```

`executorDisabled` is the existing helper (`packages/app/src/services/executor-tier.ts`) the doctor fingerprint uses —
reuse it, do not re-read `disabled:` by hand. Errored providers count as reported (the source spoke; it is already
listed under `erroredProviders`).

**WHERE.**

- `packages/app/src/services/agent-usage-producer.ts` — compute; add to the result literal (`:442-452`) and the
  snapshot payload (`:346-351`).
- `apps/cli/src/commands/agent/usage.ts:118-149` — one conditional output line beside `Unmapped providers`.
- `packages/app/src/services/agent-doctor-report.ts` — `readUsageSnapshot` parses the optional array (non-string
  items dropped); `renderDoctorTable` footer (`:450`) appends the suffix. Intersection with currently-enabled
  executors happens in `agent-doctor-ops.ts` (it holds `executors`) before render/JSON so a since-disabled executor
  is not reported.
- `docs/design/cli-contracts.md` — `spur agent usage` snapshot shape (`{captured_at, source, providers,
  unreported_executors, raw}`) and the `spur agent doctor` `usage` object gain the field (T3 surface update).

**Anti-patterns.** No availability write or `changes[]` row for unreported executors; no guessing an executor's
provider from its name; no warning/exit-code change in doctor (usage stays informational, 0893 R3); no second
provider-mapping rule.

**Decisions.** Closed: errored ≠ unreported. Closed: doctor intersects with live config rather than trusting the
capture-time list.

### Plan

1. Write failing tests: AC1 + AC4 in `packages/app/tests/services/agent-usage-producer.test.ts`; AC3 in
   `packages/app/tests/services/agent-doctor-report.test.ts`; AC2 in `apps/cli/tests/commands/agent/usage.test.ts`.
2. Producer: compute `unreportedExecutors`, add to result + snapshot (R1, R4).
3. `usage.ts`: human line; JSON follows from the result (R2).
4. Doctor: parse field in `readUsageSnapshot`, intersect in `agent-doctor-ops.ts`, render footer suffix + JSON (R3).
5. Update `docs/design/cli-contracts.md` (usage snapshot shape, doctor `usage` object).
6. Focused tests inside each workspace, then `bun run spur-check`.

### Root Cause

`runAgentUsage` (`packages/app/src/services/agent-usage-producer.ts`) derives `erroredProviders`, `healthy`,
`unmappedProviders` and `noUsageProviders` from the source's entries (`:300-322`) and maps providers → executors
(`mapProvidersToExecutors`, `:148-165`). The inverse question — which enabled executors did NO returned provider map
to — is never asked, so the result (`:442-452`), the snapshot (`:346-351`), `spur agent usage` output
(`apps/cli/src/commands/agent/usage.ts:118-149`) and `spur agent doctor` (`agent-doctor-report.ts:450`) all omit it.

### Solution

| File:lines | Change |
| --- | --- |
| `packages/app/src/services/agent-usage-producer.ts:230-238` | `AgentUsageRunResult.unreportedExecutors` — the field itself, with the 2026-11-20 rationale (silence is not headroom). |
| `packages/app/src/services/agent-usage-producer.ts:331-339` | Derivation: returned providers = healthy + errored (an errored provider already spoke, and is listed under `erroredProviders`), intersect `mapProvidersToExecutors` with the enabled executors, name-sort. `executorDisabled` is imported from `executor-tier.ts`, the same helper the doctor fingerprint uses. |
| `packages/app/src/services/agent-usage-producer.ts:364-370` | Snapshot payload gains `unreported_executors` so `doctor` can read it without a live capture. |
| `packages/app/src/services/agent-usage-producer.ts:466-473` | Result literal carries the field (`--dry-run` included). |
| `apps/cli/src/commands/agent/usage.ts:144-150` | One conditional `Unmeasured executors (not reported by <source>): …` line beside the existing unmapped-providers line. |
| `packages/app/src/services/agent-doctor-report.ts:39-47` | `DoctorUsageInfo.unreportedExecutors` (always present, `[]` when the snapshot predates the field). |
| `packages/app/src/services/agent-doctor-report.ts:99-110` | `readUsageSnapshot` parses `unreported_executors`, keeping strings only; a pre-1419 snapshot or a non-array reads as `[]`, never a parse failure (doctor's usage footer gained no new failure mode). |
| `packages/app/src/services/agent-doctor-report.ts:463-465` | Footer appends `; unmeasured: <names>` when non-empty. |
| `packages/app/src/services/agent-doctor-ops.ts:64-77` | Intersection with the executors enabled NOW, before text render and `--json`, so a since-disabled executor is not reported as outstanding work. |
| `docs/design/cli-contracts.md:711,735-745` | T3 surface update: the doctor `usage` object and the usage snapshot shape both document the new field. |
| `packages/app/tests/services/agent-usage-producer.test.ts:385-450` | AC1/AC2/AC4: listing + snapshot persistence, no change row and no availability write, drain when the provider is reported, errored-provider-is-reported, and `--dry-run` computing without writing. |
| `packages/app/tests/services/agent-doctor-report.test.ts:114-125,327-338` | Snapshot parsing (strings only, absent/garbage → `[]`) and the footer suffix, including unchanged output when empty. |
| `packages/app/tests/services/agent-doctor-ops.test.ts:86-140` | AC3 through `AgentDoctorOps.doctor`: a persisted `["live","retired"]` footer-renders `unmeasured: live` once `retired` is disabled, and `--json` carries the intersected list. |
| `apps/cli/tests/commands/agent/usage.test.ts:252-283` | AC2 at the CLI: the text line and `--json` field for an executor the fixture's source never reports. |

No availability write, no `changes[]` row and no auto-disable exists for an unreported executor: it is reported, never acted on.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-usage-producer.ts:332-339` derivation via `mapProvidersToExecutors` + `executorDisabled`; `:367-369` snapshot key; `:473` result field; test `packages/app/tests/services/agent-usage-producer.test.ts:406`, dry run `:441` |
| R2 | MET | `apps/cli/src/commands/agent/usage.ts:143-150` text line; no changes/availability path in producer; tests `packages/app/tests/services/agent-usage-producer.test.ts:416`, `apps/cli/tests/commands/agent/usage.test.ts:266` |
| R3 | MET | `packages/app/src/services/agent-doctor-report.ts:105-110` parse; `packages/app/src/services/agent-doctor-ops.ts:64-75` intersection; `packages/app/src/services/agent-doctor-report.ts:465` footer; tests `packages/app/tests/services/agent-doctor-ops.test.ts:87`, `:124` |
| R4 | MET | `packages/app/tests/services/agent-usage-producer.test.ts:424` drain on report |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/agent-usage-producer.test.ts:406` |
| AC2 | MET | test | `packages/app/tests/services/agent-usage-producer.test.ts:416`; `apps/cli/tests/commands/agent/usage.test.ts:266` (11 pass / 0 fail this verify) |
| AC3 | MET | test | `packages/app/tests/services/agent-doctor-ops.test.ts:87`, `:124`; `packages/app/tests/services/agent-doctor-report.test.ts:120-123` |
| AC4 | MET | test | `packages/app/tests/services/agent-usage-producer.test.ts:424` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `packages/app/src/services/agent-usage-producer.ts:148-165`, `:219-232`, `:300-322`, `:346-351`, `:357-362`, `:442-452`
- `apps/cli/src/commands/agent/usage.ts:118-149`
- `packages/app/src/services/agent-doctor-report.ts:33-41`, `:83-102`, `:450`; `agent-doctor-ops.ts:54-64`
- `docs/design/cli-contracts.md` (`spur agent doctor`, `spur agent usage`)
- Related: 1418 (run-time entitlement classification), 0892/0893/0907 (producer, doctor usage, delivery)
- Concurrency: no other worktree, no `wip` task (checked 2026-11-20).

### History

- 2026-11-21T05:03:07.373Z todo → wip (system)
- 2026-11-21T05:03:32.251Z wip → testing (system)
- 2026-11-21T05:03:33.728Z testing → done (system)

