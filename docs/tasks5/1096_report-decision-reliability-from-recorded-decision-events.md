---
schema_version: 1
name: Report decision reliability from recorded decision events
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.691Z
updated_at: "2026-10-07T01:19:56.946Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 4

dependencies: ["1095"]
---

## 1096. Report decision reliability from recorded decision events

### Background

Slice S3 of docs/design/decision-observability-and-adoption.md §5, plus the audit and roadmap of §4–§5. Each adoption slice (task 1094 and the rescue tasks) starts only when recorded evidence exists for its decision id and maker. Covers R9, R10.

### Requirements

- [ ] R1. Add a domain aggregation `SystemEventDao.decisionSummary(spec?: {since?, decisionId?})` in `packages/domain/src/dao/system-event-dao.ts`, modelled on `routingSummary` (`:464`).
  - It filters `name = 'decision.end'` and groups by `json_extract(payload_json, '$.data.decisionId')` × `$.data.maker`.
  - It returns per group: `samples`, `accepted` (count of `source = 'model'`), `fallbacks` (count by `$.data.reason` where `source = 'default'`), `firstSeen`/`lastSeen`, and the raw `durationMs` and `confidence` values needed for percentiles.
  - Confidence is read from the `end` row (`$.data.confidence`, added by task 1095), so no join is needed.
- [ ] R2. Add an app service `packages/app/src/decision/decision-reliability.ts`, `decisionReliability(dao, spec)`. It computes `acceptedRate`, `medianConfidence` (nulls excluded; null when there are none), and `p50`/`p95` `durationMs` in process, using nearest-rank. Every catalog id from `DecisionService.list()` with zero rows is reported as `{ evidence: 'none' }`.
- [ ] R3. It reads recorded rows only and never constructs or calls a maker.
- [ ] R4. CLI surface: add `--reliability` (with `--since <iso>` and `--json`) to the existing `spur decision status` (`apps/cli/src/commands/decision.ts:172`). Its JSON is `{ generatedAt, groups:[…] }`. Plain `decision status` output and exit codes stay unchanged. This is a new public flag: the implementer confirms operator consent at pickup (see Q&A) before landing it.
- [ ] R5. Mark `docs/design/decision-observability-and-adoption.md` `status: accepted`. Re-verify that the §4 table classifies every file in `config/workflows/*.yaml`, and add any missing row.

### Acceptance Criteria

- [ ] AC1 — A reliability report summarizes recorded decision outcomes per decision and maker
- [ ] AC2 — The workflow audit classifies every shipped workflow step

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
