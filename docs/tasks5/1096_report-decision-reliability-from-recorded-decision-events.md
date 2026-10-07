---
schema_version: 1
name: Report decision reliability from recorded decision events
status: done
template: feature-impl
created_at: 2026-10-07T01:02:20.691Z
updated_at: "2026-10-07T05:38:24.740Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 4

dependencies: ["1095"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1096-verdict.json
---

## 1096. Report decision reliability from recorded decision events

### Background

Slice S3 of docs/design/decision-observability-and-adoption.md §5, plus the audit and roadmap of §4–§5. Each adoption slice (task 1094 and the rescue tasks) starts only when recorded evidence exists for its decision id and maker. Covers R9, R10.

### Requirements

- [x] R1. Add a domain aggregation `SystemEventDao.decisionSummary(spec?: {since?, decisionId?})` in `packages/domain/src/dao/system-event-dao.ts`, modelled on `routingSummary` (`:464`).
  - It filters `name = 'decision.end'` and groups by `json_extract(payload_json, '$.data.decisionId')` × `$.data.maker`.
  - It returns per group: `samples`, `accepted` (count of `source = 'model'`), `fallbacks` (count by `$.data.reason` where `source = 'default'`), `firstSeen`/`lastSeen`, and the raw `durationMs` and `confidence` values needed for percentiles.
  - Confidence is read from the `end` row (`$.data.confidence`, added by task 1095), so no join is needed.
- [x] R2. Add an app service `packages/app/src/decision/decision-reliability.ts`, `decisionReliability(dao, spec)`. It computes `acceptedRate`, `medianConfidence` (nulls excluded; null when there are none), and `p50`/`p95` `durationMs` in process, using nearest-rank. Every catalog id from `DecisionService.list()` with zero rows is reported as `{ evidence: 'none' }`.
- [x] R3. It reads recorded rows only and never constructs or calls a maker.
- [x] R4. CLI surface: add `--reliability` (with `--since <iso>` and `--json`) to the existing `spur decision status` (`apps/cli/src/commands/decision.ts:172`). Its JSON is `{ generatedAt, groups:[…] }`. Plain `decision status` output and exit codes stay unchanged. This is a new public flag: the implementer confirms operator consent at pickup (see Q&A) before landing it.
- [x] R5. Mark `docs/design/decision-observability-and-adoption.md` `status: accepted`. Re-verify that the §4 table classifies every file in `config/workflows/*.yaml`, and add any missing row.

### Acceptance Criteria

- [x] AC1 — A reliability report summarizes recorded decision outcomes per decision and maker
- [x] AC2 — The workflow audit classifies every shipped workflow step

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:47.269Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

#### Q&A entry — 2026-10-07T01:19:10.353Z

- Surface decision: the default is `spur decision status --reliability [--since <iso>] --json`. This adds a public flag, so per AGENTS.md public-surface consent the implementer confirms with the operator before landing it. If consent is declined, the fallback is an internal command in `scripts/commands`, with the same app service and no public flag.
- Only `decision.end` rows are counted. Confidence rides on `end`, which is added in this task, so no join is needed.

#### Q&A entry — 2026-10-07T01:19:49.735Z

- Confidence rides on the `decision.end` payload (task 1095 R3), so the report reads one row per invocation with no join.

### Design

**Chosen: SQL aggregation in packages/domain, percentiles in packages/app, and a thin CLI flag.**

- `packages/domain` is the only `ts-db` consumer, so `json_extract` grouping belongs in the DAO. This follows the precedent of `routingSummary` (`packages/domain/src/dao/system-event-dao.ts:464`).
- Percentiles and the evidence-none fill need the catalog list, so they live in the app service.

**Rejected:**
- A separate analytics store, because `system_events` already holds every field.
- A new verb such as `decision report`, because `status` already owns readiness reporting and a flag is a smaller surface change.

**Correctness rules:**
- Only `decision.end` rows are counted, so each invocation counts once.
- Rejected calls never produce `end`, so caller mistakes do not lower `acceptedRate`.
- Rows from 1095's workflow inline path carry makerSource `inline` and inline ids (e.g. the task-pipeline question ids). They are grouped like any other id.

**Execution budget:**
- About 5 source files and 1 doc.
- `requireDiff: true`.
- One new public flag, which needs operator consent.

### Plan

1. Failure list:
   - The ledger is empty.
   - One decision has mixed makers.
   - A row has null confidence.
   - A non-decision source leaks into the groups.
   - A rejected call is counted as a sample.
   - p95 on a single sample.
   - A catalog id has no rows and is omitted instead of reported as `evidence: none`.
2. Add `decisionSummary` to the DAO, following `routingSummary`. Write the DAO test with in-memory SQLite, inserting `decision.end` rows through `SystemEventDao`.
3. Add the `decisionReliability` app service: aggregation, percentiles and the evidence-none fill. Export it.
4. Add `--reliability`/`--since` to `decision status` in `apps/cli/src/commands/decision.ts`, after consent confirmation.
5. E2E, in a temporary project with no backend:
   - Run `spur decision run task-triage --param wbs=1` 3 times and `failure-class` once.
   - `spur decision status --reliability --json` shows `task-triage` with samples 3, acceptedRate 0, fallbacks `{no-backend: 3}`.
   - `failure-class` shows samples 1.
   - Other catalog ids show `evidence: none`.
   - Save the output as `.spur/run/1096-reliability.json`.
6. Satellite: set status to accepted and complete the §4 coverage check.
7. Gate: `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/decision.ts:10` |
| `apps/cli/src/commands/decision.ts:13` |
| `apps/cli/src/commands/decision.ts:140` |
| `apps/cli/src/commands/decision.ts:147` |
| `apps/cli/src/commands/decision.ts:159` |
| `apps/cli/src/commands/decision.ts:17` |
| `apps/cli/src/commands/decision.ts:179` |
| `apps/cli/src/commands/decision.ts:200` |
| `apps/cli/src/commands/decision.ts:203` |
| `apps/cli/src/commands/decision.ts:216` |
| `apps/cli/src/commands/decision.ts:225` |
| `apps/cli/src/commands/decision.ts:232` |
| `apps/cli/src/commands/decision.ts:6` |
| `apps/cli/tests/commands/decision.test.ts:343` |
| `docs/design/decision-observability-and-adoption.md:145` |
| `docs/design/decision-observability-and-adoption.md:177` |
| `docs/design/decision-observability-and-adoption.md:4` |
| `docs/design/decision-observability-and-adoption.md:6` |
| `docs/design/event-tracking.md:132` |
| `docs/design/event-tracking.md:138` |
| `docs/design/event-tracking.md:140` |
| `docs/design/event-tracking.md:21` |
| `docs/design/event-tracking.md:219` |
| `docs/design/event-tracking.md:355` |
| `docs/design/event-tracking.md:49` |
| `docs/features/INDEX.md:181` |
| `docs/features/P1_workflow-decision-points-adopt-spur-decision-catalogs.md:166` |
| `docs/features/P1_workflow-decision-points-adopt-spur-decision-catalogs.md:176` |
| `docs/features/P1_workflow-decision-points-adopt-spur-decision-catalogs.md:5` |
| `docs/features/P1_workflow-decision-points-adopt-spur-decision-catalogs.md:9` |
| `docs/help/cmd_decision.md:100` |
| `docs/help/cmd_decision.md:110` |
| `docs/help2/decision.md:62` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:14` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:153` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:217` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:251` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:26` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:264` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:33` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:4` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:42` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:48` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:54` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:59` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:62` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:66` |
| `docs/tasks5/1095_emit-decision-lifecycle-events-and-persist-them-to-the-syste.md:7` |
| `packages/app/src/decision/decision-service.ts:1` |
| `packages/app/src/decision/decision-service.ts:13` |
| `packages/app/src/decision/decision-service.ts:195` |
| `packages/app/src/decision/decision-service.ts:199` |
| `packages/app/src/decision/decision-service.ts:20` |
| `packages/app/src/decision/decision-service.ts:204` |
| `packages/app/src/decision/decision-service.ts:213` |
| `packages/app/src/decision/decision-service.ts:222` |
| `packages/app/src/decision/decision-service.ts:226` |
| `packages/app/src/decision/decision-service.ts:272` |
| `packages/app/src/decision/decision-service.ts:96` |
| `packages/app/src/index.ts:12` |
| `packages/app/src/services/event-names.ts:1593` |
| `packages/app/src/services/event-names.ts:25` |
| `packages/app/src/services/event-names.ts:371` |
| `packages/app/src/services/event-names.ts:97` |
| `packages/app/src/services/inline-run-setup.ts:1543` |
| `packages/app/src/services/inline-run-setup.ts:1549` |
| `packages/app/src/services/inline-run-setup.ts:1562` |
| `packages/app/src/services/inline-run-setup.ts:1597` |
| `packages/app/src/services/inline-run-setup.ts:56` |
| `packages/app/src/services/inline-run-setup.ts:64` |
| `packages/app/src/services/inline-run-setup.ts:70` |
| `packages/app/src/services/inline-run-setup.ts:82` |
| `packages/app/src/services/inline-run-setup.ts:833` |
| `packages/app/src/services/inline-run-setup.ts:879` |
| `packages/app/src/services/inline-run-setup.ts:884` |
| `packages/app/src/workflow/actions/decide.ts:104` |
| `packages/app/src/workflow/actions/decide.ts:6` |
| `packages/app/src/workflow/actions/decide.ts:60` |
| `packages/app/src/workflow/actions/decide.ts:64` |
| `packages/app/src/workflow/builtins.ts:111` |
| `packages/domain/src/dao/index.ts:83` |
| `packages/domain/src/dao/system-event-dao.ts:151` |
| `packages/domain/src/dao/system-event-dao.ts:564` |
| `packages/domain/tests/dao/system-event-dao.test.ts:1358` |
| `plugins/sp/lib/inline-run.generated.mjs:1710` |
| `plugins/sp/lib/inline-run.generated.mjs:1716` |
| `plugins/sp/lib/inline-run.generated.mjs:1721` |
| `plugins/sp/lib/inline-run.generated.mjs:1737` |
| `plugins/sp/lib/inline-run.generated.mjs:546` |
| `packages/app/src/decision/decision-events.ts:1` |
| `packages/app/src/decision/decision-reliability.ts:1` |
| `packages/app/tests/decision/decision-events.test.ts:1` |
| `packages/app/tests/decision/decision-reliability.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/dao/system-event-dao.ts:582-691` â `decisionSummary(spec)` filters `event_name = 'decision.end'`, groups by `json_extract(payload_json, '$.data.decisionId')` Ã `$.data.maker`; returns samples, accepted (source='model'), fallbacks by `$.data.reason` (source='default'), firstSeen/lastSeen, and raw durationMs/confidence arrays read from the end row (`$.data.confidence`, no join); since/decisionId bound as SQL parameters |
| R2 | MET | `packages/app/src/decision/decision-reliability.ts:66-98` â `decisionReliability(dao, spec)` computes acceptedRate, medianConfidence (numeric-only, null when none), nearest-rank p50/p95 durationMs (`:124-130`); every catalog id with zero rows reported as `evidence: 'none'` (`:77-93`) |
| R3 | MET | `packages/app/src/decision/decision-reliability.ts:1-8` â module reads recorded rows only through `SystemEventDao.decisionSummary`; no maker import, construction or call anywhere in the service (verified by full-file read, 130 lines) |
| R4 | MET | `apps/cli/src/commands/decision.ts:225-268` â `decision status` gains `--reliability`, `--since <iso>`, `--json`; report JSON is `{ generatedAt, groups }` (`packages/app/src/decision/decision-reliability.ts:98`); plain status output and exit codes unchanged (reliability branch returns at `:261` before the status path); `--since` without `--reliability` rejected (`:267-268`); public-flag operator consent recorded at `docs/design/decision-observability-and-adoption.md:177-179` |
| R5 | MET | `docs/design/decision-observability-and-adoption.md:4` â `status: accepted`; Â§4 audit table `:127-147` classifies all 9 `config/workflows/*.yaml` files (task-pipeline, idea-pipeline, history-anatomy, wayfinder-resolution, wrapup-pipeline, pr-review, feature-verification, feature-lifecycle, task-lifecycle) across adopt/rescue-only/keep-deterministic/keep-human â no missing row found against the live `config/workflows/` listing |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts:1390-1648` â 7 DAO tests (per-group samples/accepted/fallbacks, mixed makers, end-only counting, null confidence excluded but row counted, since/decisionId filters, empty ledger); `packages/app/tests/decision/decision-reliability.test.ts:59-130` â 7 service tests (nearest-rank percentiles, single-sample p95, null median, evidence-none fill, decisionId/since narrowing); `apps/cli/tests/commands/decision.test.ts:344-430` â flag, human output, invalid `--since`, plain-path exit codes; E2E artifact `.spur/run/1096-reliability.json:1` â task-triage samples 3 / acceptedRate 0 / fallbacks {no-backend: 3}, failure-class samples 1, review-failure-class evidence none |
| AC2 | MET | command | comm of ls config/workflows/* vs docs/design/decision-observability-and-adoption.md:127-150 rows → 0 of 9 shipped workflow files unclassified (run 2026-10-06, batch branch) |
| A reliability report summarizes recorded decision outcomes per decision and maker | MET | test | see AC1: packages/app/tests/decision/decision-reliability.test.ts:59 |
| The workflow audit classifies every shipped workflow step | MET | test | see AC2: docs/design/decision-observability-and-adoption.md:127 |
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

- 2026-10-07T04:37:51.053Z todo → wip (system)
- 2026-10-07T05:38:10.400Z wip → testing (system)
- 2026-10-07T05:38:24.736Z testing → done (system)

