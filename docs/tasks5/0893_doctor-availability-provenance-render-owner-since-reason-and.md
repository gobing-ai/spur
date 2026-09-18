---
schema_version: 1
name: "Doctor availability provenance: render owner, since, reason and usage-snapshot age, and mark stale snapshots"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.555Z
updated_at: "2026-09-18T15:05:14.609Z"
feature_id: B6
priority: P2
tags:
  - doctor
  - executor-availability
  - B6
estimate_hours: 3

dependencies: ["0892", "0889"]
---

## 0893. Doctor availability provenance: render owner, since, reason and usage-snapshot age, and mark stale snapshots

### Background

With tasks 3–5 availability carries ownership and a usage snapshot exists. `spur agent doctor` still renders a bare disabled flag. Authority: `docs/design/session-pinned-dispatch.md` §3.5, AC R8. `agent.usage.maxAgeMs` is a constant (6 h) unless the operator asks for a knob.

### Requirements

- [x] R1. `spur agent doctor` table and `--json` show, per disabled executor, `owner`, `since`, `reason`; JSON keeps the normalized object even for bare-boolean config.
- [x] R2. Doctor reads `~/.config/spur/agent-usage.json` when present and reports `usage.capturedAt` and `usage.age`; a snapshot older than the 6 h constant is rendered `stale` in the table and `stale: true` in JSON, and doctor never derives an enable from a stale snapshot.
- [x] R3. A missing snapshot renders `usage: none` without a warning (the producer is optional).
- [x] R4. Tests in `apps/cli/tests/commands/agent*` cover owner rendering for both config forms and the fresh/stale/missing snapshot cases; the spur-cli `agent.md` doctor rows are updated; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R8.

- [x] AC1 — Doctor renders availability ownership and age (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: doctor stays read-only — it reports provenance and snapshot age but never writes (docs/design/session-pinned-dispatch.md §3.5; the rejected ADR-051 shape). The staleness threshold is a constant because nothing in the design varies it; promote to config only when a second consumer needs a different value. Mutation policy: doctor rendering in `packages/app/src/services/agent-service.ts` and `apps/cli` output, tests, `agent.md`; no producer or updater changes.

### Plan

1. Read design §3.5 and the current doctor renderer + JSON shape (task 2 added `capabilities`).
2. Add provenance columns/fields from the task-3 normalizer; add snapshot read + age/stale computation.
3. Write the tests; update `agent.md`.
4. Run `cd apps/cli && bun test tests/commands/agent*` then `bun run spur-check`.
5. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:17` |
| `apps/cli/src/commands/agent.ts:20` |
| `apps/cli/src/commands/agent.ts:213` |
| `apps/cli/src/commands/agent.ts:24` |
| `apps/cli/src/commands/agent.ts:249` |
| `apps/cli/src/commands/agent.ts:43` |
| `apps/cli/src/commands/agent.ts:66` |
| `apps/cli/src/commands/agent.ts:8` |
| `apps/cli/src/commands/shared-options.ts:101` |
| `apps/cli/tests/commands/agent.test.ts:5` |
| `apps/cli/tests/commands/agent.test.ts:813` |
| `apps/cli/tests/json-envelope-inventory.test.ts:282` |
| `apps/server/tests/serve.test.ts:1115` |
| `apps/server/tests/serve.test.ts:37` |
| `apps/server/tests/serve.test.ts:810` |
| `apps/server/tests/serve.test.ts:814` |
| `apps/server/tests/serve.test.ts:942` |
| `apps/server/tests/serve.test.ts:954` |
| `packages/app/src/index.ts:100` |
| `packages/app/src/services/agent-quota-updates.ts:161` |
| `packages/app/src/services/agent-quota-updates.ts:221` |
| `packages/app/src/services/agent-quota-updates.ts:240` |
| `packages/app/src/services/agent-quota-updates.ts:248` |
| `packages/app/src/services/agent-quota-updates.ts:25` |
| `packages/app/src/services/agent-quota-updates.ts:250` |
| `packages/app/src/services/agent-quota-updates.ts:259` |
| `packages/app/src/services/agent-quota-updates.ts:297` |
| `packages/app/src/services/agent-quota-updates.ts:320` |
| `packages/app/src/services/agent-quota-updates.ts:35` |
| `packages/app/src/services/agent-quota-updates.ts:79` |
| `packages/app/src/services/agent-quota-updates.ts:9` |
| `packages/app/src/services/agent-service.ts:114` |
| `packages/app/src/services/agent-service.ts:2024` |
| `packages/app/src/services/agent-service.ts:2124` |
| `packages/app/src/services/agent-service.ts:2128` |
| `packages/app/src/services/agent-service.ts:2293` |
| `packages/app/src/services/agent-service.ts:2498` |
| `packages/app/src/services/agent-service.ts:2534` |
| `packages/app/src/services/agent-service.ts:2554` |
| `packages/app/src/services/agent-service.ts:2560` |
| `packages/app/src/services/agent-service.ts:2796` |
| `packages/app/src/services/agent-service.ts:2821` |
| `packages/app/src/services/agent-service.ts:2838` |
| `packages/app/src/services/agent-service.ts:2845` |
| `packages/app/src/services/agent-service.ts:2861` |
| `packages/app/src/services/agent-service.ts:2875` |
| `packages/app/src/services/agent-service.ts:2913` |
| `packages/app/src/services/agent-service.ts:2917` |
| `packages/app/src/services/agent-service.ts:2927` |
| `packages/app/src/services/agent-service.ts:2943` |
| `packages/app/src/services/agent-service.ts:2955` |
| `packages/app/src/services/agent-service.ts:2959` |
| `packages/app/src/services/agent-service.ts:2973` |
| `packages/app/src/services/agent-service.ts:3110` |
| `packages/app/src/services/agent-service.ts:4` |
| `packages/app/src/services/agent-service.ts:488` |
| `packages/app/src/services/agent-service.ts:496` |
| `packages/app/src/services/agent-service.ts:516` |
| `packages/app/src/services/agent-service.ts:545` |
| `packages/app/src/services/agent-service.ts:557` |
| `packages/app/src/services/agent-service.ts:581` |
| `packages/app/src/services/agent-service.ts:653` |
| `packages/app/src/services/agent-service.ts:664` |
| `packages/app/src/services/agent-service.ts:671` |
| `packages/app/src/services/agent-service.ts:682` |
| `packages/app/src/services/agent-service.ts:701` |
| `packages/app/src/services/agent-service.ts:735` |
| `packages/app/src/services/agent-service.ts:748` |
| `packages/app/src/services/agent-service.ts:760` |
| `packages/app/src/services/fleet-service.ts:10` |
| `packages/app/src/services/fleet-service.ts:228` |
| `packages/app/tests/services/agent-quota-updates.test.ts:112` |
| `packages/app/tests/services/agent-quota-updates.test.ts:17` |
| `packages/app/tests/services/agent-quota-updates.test.ts:225` |
| `packages/app/tests/services/agent-quota-updates.test.ts:255` |
| `packages/app/tests/services/agent-quota-updates.test.ts:326` |
| `packages/app/tests/services/agent-quota-updates.test.ts:331` |
| `packages/app/tests/services/agent-quota-updates.test.ts:348` |
| `packages/app/tests/services/agent-quota-updates.test.ts:465` |
| `packages/app/tests/services/agent-service.test.ts:369` |
| `packages/app/tests/services/agent-service.test.ts:373` |
| `packages/app/tests/services/agent-service.test.ts:4072` |
| `packages/app/tests/services/agent-service.test.ts:4412` |
| `packages/config/src/executor-update.ts:105` |
| `packages/config/src/executor-update.ts:137` |
| `packages/config/src/executor-update.ts:14` |
| `packages/config/src/executor-update.ts:162` |
| `packages/config/src/executor-update.ts:174` |
| `packages/config/src/executor-update.ts:2` |
| `packages/config/src/executor-update.ts:206` |
| `packages/config/src/executor-update.ts:215` |
| `packages/config/src/executor-update.ts:218` |
| `packages/config/src/executor-update.ts:238` |
| `packages/config/src/executor-update.ts:259` |
| `packages/config/src/executor-update.ts:267` |
| `packages/config/src/executor-update.ts:31` |
| `packages/config/src/executor-update.ts:36` |
| `packages/config/src/executor-update.ts:6` |
| `packages/config/src/executor-update.ts:67` |
| `packages/config/src/executor-update.ts:75` |
| `packages/config/src/executor-update.ts:79` |
| `packages/config/src/executor-update.ts:85` |
| `packages/config/src/index.ts:290` |
| `packages/config/src/index.ts:3` |
| `packages/config/src/index.ts:323` |
| `packages/config/src/index.ts:337` |
| `packages/config/src/index.ts:348` |
| `packages/config/src/index.ts:356` |
| `packages/config/src/index.ts:616` |
| `packages/config/src/loader.ts:287` |
| `packages/config/src/loader.ts:303` |
| `packages/config/tests/executor-update.test.ts:107` |
| `packages/config/tests/executor-update.test.ts:119` |
| `packages/config/tests/executor-update.test.ts:13` |
| `packages/config/tests/executor-update.test.ts:136` |
| `packages/config/tests/executor-update.test.ts:147` |
| `packages/config/tests/executor-update.test.ts:15` |
| `packages/config/tests/executor-update.test.ts:159` |
| `packages/config/tests/executor-update.test.ts:171` |
| `packages/config/tests/executor-update.test.ts:183` |
| `packages/config/tests/executor-update.test.ts:191` |
| `packages/config/tests/executor-update.test.ts:2` |
| `packages/config/tests/executor-update.test.ts:200` |
| `packages/config/tests/executor-update.test.ts:213` |
| `packages/config/tests/executor-update.test.ts:228` |
| `packages/config/tests/executor-update.test.ts:23` |
| `packages/config/tests/executor-update.test.ts:245` |
| `packages/config/tests/executor-update.test.ts:25` |
| `packages/config/tests/executor-update.test.ts:260` |
| `packages/config/tests/executor-update.test.ts:272` |
| `packages/config/tests/executor-update.test.ts:288` |
| `packages/config/tests/executor-update.test.ts:309` |
| `packages/config/tests/executor-update.test.ts:321` |
| `packages/config/tests/executor-update.test.ts:76` |
| `packages/config/tests/executor-update.test.ts:79` |
| `packages/config/tests/executor-update.test.ts:95` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:105` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:107` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:114` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:137` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:180` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:25` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:289` |
| `packages/domain/src/dao/agent-executor-update-dao.ts:51` |
| `packages/domain/src/migrations.ts:1518` |
| `packages/domain/src/migrations.ts:267` |
| `packages/domain/src/migrations.ts:281` |
| `packages/domain/src/migrations.ts:293` |
| `packages/domain/tests/dao/migrations.test.ts:127` |
| `packages/domain/tests/dao/migrations.test.ts:199` |
| `packages/domain/tests/dao/migrations.test.ts:220` |
| `packages/domain/tests/dao/migrations.test.ts:321` |
| `packages/domain/tests/dao/migrations.test.ts:324` |
| `packages/domain/tests/dao/migrations.test.ts:377` |
| `packages/domain/tests/dao/migrations.test.ts:589` |
| `packages/domain/tests/dao/migrations.test.ts:648` |
| `packages/domain/tests/dao/migrations.test.ts:651` |
| `packages/domain/tests/dao/migrations.test.ts:8` |
| `packages/domain/tests/dao/migrations.test.ts:917` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Normalized provenance rendered in table + JSON: `DoctorRow.availability: ExecutorAvailability` (packages/app/src/services/agent-service.ts:2796-2797) carried from `normalizeExecutorAvailability(executor.disabled)` in `buildDoctorRows` (:2825, :2838-2846); JSON entries carry `availability: {disabled, owner: ?? null, since: ?? null, reason: ?? null}` (:735-741) keyed on `agent`; text table gains OWNER/SINCE/REASON headers (:2943-2945) with `owner/since/reason = availability.X ?? dash` on disabled rows and `—` on enabled rows (:2928-2929). Bare-boolean → `{disabled: true, owner: 'operator', since: null, reason: null}` via the 0890 normalizer. Tests: packages/app/tests/services/agent-service.test.ts "R1: bare-boolean disabled renders owner=operator, and --json keeps the normalized object" (:4456, JSON equality + table regex), "R1: object-form disabled renders owner/since/reason in table and JSON" (:4485); apps/cli/tests/commands/agent.test.ts "bare-boolean and object-form disables render normalized availability in --json" (:871) end-to-end through main() |
| R2 | MET | Snapshot read: `readUsageSnapshot` (packages/app/src/services/agent-service.ts:2566-2579) parses `{captured_at}`, computes `age = now - capturedAt`, `stale: age >= USAGE_SNAPSHOT_STALE_MS` (:2503, 6 h constant per design §3.5); `doctor()` computes `usage` after fileSystem/now (:498) from `args.usageSnapshotPath` (:488-489); JSON payload gains `usage: usage ?? null` (:752); footer `usage: <capturedAt> (<age> |
| R3 | MET | Missing/malformed snapshot → silent null (try/catch + exists guard in `readUsageSnapshot` :2566-2579), JSON `usage: null` (:752), footer `usage: none` (:2975) — never a warning. Tests: agent-service.test.ts "R2/R3: table renders usage footer fresh/stale/none; missing snapshot is silent" (:4543, asserts absence of warn/error output); CLI missing-snapshot leg in :887 test |
| R4 | MET | CLI E2E tests in apps/cli/tests/commands/agent.test.ts "agent doctor — availability provenance (0893)" (:820): both config forms via a temp project `.spur/config.yaml` through `main()` (:871) + fresh/stale/missing snapshot legs (:887) pinned via the `SPUR_AGENT_USAGE_SNAPSHOT` injected-env override (`defaultAgentUsageSnapshotPath(env)` apps/cli/src/services/agent-usage-source.ts:53-60, wired at apps/cli/src/commands/agent.ts:250; override unit tests apps/cli/tests/services/agent-usage-source.test.ts:28-38). docs/help/cmd_agent.md doctor rows updated (OWNER/SINCE/REASON + usage footer); plugins/sp/skills/spur-cli/references/agent.md doctor section updated. Repo gate GREEN: .spur/run/0893-test-gate.status=PASS |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Doctor renders availability ownership and age (req R1): agent-service.test.ts "R1: bare-boolean…" (:4456) + "R1: object-form…" (:4485) prove owner/since/reason in BOTH --json and the text table for both config forms; age rendering proven by :4517 (fresh capturedAt/age, stale:true past 6 h) and :4543 (`usage: none` when missing); CLI E2E :871/:887 replays the same shapes through main(); 0621 header-shape test updated 7→10 columns (spec-driven shape change) |
| AC-8 | MET | test | Doctor renders owner/since/reason + snapshot age: `DoctorRow.availability` `packages/app/src/services/agent-service.ts:2796-2797` from `normalizeExecutorAvailability` in `buildDoctorRows` `:2825,:2838-2846`; JSON `availability:{disabled,owner,since,reason}` `:735-741`; OWNER/SINCE/REASON headers `:2943-2945` (`-` on enabled rows); `readUsageSnapshot` `:2566-2579` + `USAGE_SNAPSHOT_STALE_MS` 6h stale marking; tests `agent-service.test.ts:4456,:4485,:4517,:4543`, CLI E2E `apps/cli/tests/commands/agent.test.ts:871,:887` (fresh/stale/missing legs via `SPUR_AGENT_USAGE_SNAPSHOT`) |
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

- 2026-09-18T05:43:45.013Z todo → wip (system)
- 2026-09-18T06:22:05.373Z wip → testing (system)
- 2026-09-18T06:22:39.693Z testing → done (system)

