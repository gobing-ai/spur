---
schema_version: 1
name: Add protocol tool usage to the history-anatomy report
status: done
template: feature-impl
created_at: 2026-11-18T05:29:36.436Z
updated_at: "2026-11-18T08:36:58.379Z"
feature_id: I61
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 4

dependencies: ["1376", "1377"]
done_forced: "false"
done_reason: unforced close
---

## 1398. Add protocol tool usage to the history-anatomy report

### Background

Protocol events (`mcp.tool.called|failed`, `mcp.resource.read`, `auth.denied` from 1376; `a2a.message.received`, `a2a.task.cancelled` from 1377) land in `system_events` (`packages/domain/src/migrations.ts:162-172`: `event_name`, `occurred_at`, `actor`, `payload_json`, `run_id`). Nothing summarizes them. The history artifact already folds one `system_events` aggregate: `pairingSummary` (`packages/domain/src/analytics/pairings.ts:93`), called from `history-service.ts:930` and stored as `HistoryArtifact.pairings` (`artifact.ts:237`). That is the precedent this task follows.

**Refine corrections (2026-11-17)**
- "history-anatomy section" → the twelve report sections are frozen (`plugins/sp/skills/history-anatomy/references/report-contract.md:7-24`). → No new section. The data goes into the forensics artifact, and the model half cites it under **8. Performance analysis**, with gaps under **6. Telemetry gaps**.
- "per tool and per agent counts, failure rate and p95 from mcp.* and a2a.*" → A2A events carry no tool and no duration (1377 R2/R3: `member`, `outcome`, `taskId`). → Duration and p95 come from `mcp.*` only. A2A gets counts per `member` × `outcome` (accepted / replayed / conflict) plus cancellations. "Per agent" means the `system_events.actor` column; a null actor groups under `unknown` and is reported, never dropped.
- "Respect bounded daily windows (I81)" → the artifact already takes `selector.since/until`. → Reuse the same window as `pairingSummary`.
- "No new table unless a rollup is needed (E91)" → E91's materialized-only rule governs the Board read path (`history_board_*`), not `spur history analyze`, which already reads `system_events` directly for pairings. → No table, no rollup.
- `HistoryArtifact.byTool` (`artifact.ts:99-108`) counts transcript tool calls from imported history, which is a different plane. → Keep it separate. Don't merge MCP calls into `byTool`.

### Requirements

- [x] R1. Add `protocolUsageSummary(db, { since, until })` in `packages/domain/src/analytics/protocol-usage.ts`, returning `ProtocolUsage`:
  - `tools[]`: `{ tool, calls, failures, failureRate, p50Ms, p95Ms, durationUnmeasured }` from `mcp.tool.called`/`mcp.tool.failed`
  - `resources[]`: `{ uri, reads, failures }`
  - `byActor[]`: `{ actor, calls, failures }` (null actor → `unknown`)
  - `a2a[]`: `{ member, received, replayed, conflict, cancelled }`
  - `authDenied[]`: `{ surface, reason, count }`
- [x] R2. p50/p95 are nearest-rank values over `payload.durationMs` within the window. A row with no numeric `durationMs` counts in `durationUnmeasured` and is excluded from the percentile, never treated as 0.
- [x] R3. `history-service.ts` calls it beside `pairingSummary` over the same selector window and sets `HistoryArtifact.protocolUsage?` (optional, like `pairings`). Register its arrays as `'set'` in `artifact-digest.ts`.
- [x] R4. `renderForensics` adds a "Protocol usage" block. An empty window renders `not available (no protocol events in window)`, never zeros.
- [x] R5. In `report-contract.md` and `operations.md`, section 8 cites `protocolUsage`. A missing `protocolUsage` is a section-6 telemetry gap. No section is added or renamed.

### Acceptance Criteria

- [x] AC1 — Daily report shows protocol tool usage (req: R1, R2, R3, R4, R5)

Test layer: domain analytics tests on in-memory SQLite with events seeded through the DAO, plus an artifact/render test.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:08:59.555Z

- **New report section?** No. The 12 sections are frozen, so the data goes in section 8 with gaps in section 6.
- **Per-agent identity for MCP calls?** `system_events.actor` as emitted. MCP uses one shared bearer, so per-agent attribution may be `unknown`. That is reported as a gap rather than guessed.
- **Rollup table?** No. E91 governs the Board; analyze already reads `system_events` raw.

### Design

**WHAT.** One domain query module that does a single bounded `SELECT event_name, actor, payload_json FROM system_events WHERE event_name IN (…) AND occurred_at BETWEEN ? AND ?` and folds the rows in TypeScript. Then one optional artifact field, one renderer block, and two lines in the skill references.

**WHY.** This mirrors `pairings`: the same plane, window, optional-field and digest pattern. SQLite has no percentile function, and the window is bounded, so an in-memory fold is enough. `// ponytail: in-memory percentile; push into SQL or a rollup if a window exceeds ~1e6 protocol events.`

**WHERE.**
- `packages/domain/src/analytics/{protocol-usage.ts,artifact.ts,artifact-digest.ts,index.ts}`
- the forensics renderer (`render-forensics`)
- `packages/app/src/services/history-service.ts:930`
- `plugins/sp/skills/history-anatomy/references/{report-contract.md,operations.md}`

**Anti-patterns.**
- Don't merge into `byTool`.
- Don't add a section.
- Don't read argument values (payloads have only `argKeys`).
- No new table.

### Plan

- [ ] Step 1 (test first, R1/R2): `packages/domain/tests/analytics/protocol-usage.test.ts` on in-memory SQLite. Seed events through `SystemEventDao`. Assert counts, failure rate, nearest-rank p95, `durationUnmeasured`, the `unknown` actor bucket, the A2A outcome split, and that rows outside the window are excluded.
- [ ] Step 2: implement the module and export it.
- [ ] Step 3 (test first, R3/R4): an artifact test asserting `protocolUsage` is present, stable under the digest, and rendered as `not available` when the window is empty.
- [ ] Step 4: wire `history-service` and the renderer.
- [ ] Step 5 (R5): update the skill references.
- [ ] Step 6: run focused tests, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/features/I61_tool-usage-feedback-loop-protocol-events-into-history-anatomy-doctor-and-rule-scan.md:5` |
| `docs/features/I61_tool-usage-feedback-loop-protocol-events-into-history-anatomy-doctor-and-rule-scan.md:59` |
| `docs/features/I61_tool-usage-feedback-loop-protocol-events-into-history-anatomy-doctor-and-rule-scan.md:71` |
| `docs/features/I61_tool-usage-feedback-loop-protocol-events-into-history-anatomy-doctor-and-rule-scan.md:9` |
| `docs/features/INDEX.md:184` |
| `packages/app/src/services/history-service.ts:1024` |
| `packages/app/src/services/history-service.ts:55` |
| `packages/app/src/services/history-service.ts:911` |
| `packages/app/src/services/history-service.ts:933` |
| `packages/domain/src/analytics/artifact-digest.ts:63` |
| `packages/domain/src/analytics/artifact-digest.ts:67` |
| `packages/domain/src/analytics/artifact.ts:239` |
| `packages/domain/src/analytics/artifact.ts:5` |
| `packages/domain/src/analytics/index.ts:204` |
| `packages/domain/src/analytics/render-forensics.ts:37` |
| `packages/domain/src/analytics/render-forensics.ts:398` |
| `packages/domain/tests/analytics/artifact-digest.test.ts:86` |
| `packages/domain/tests/analytics/render-forensics.test.ts:518` |
| `plugins/sp/skills/history-anatomy/references/operations.md:65` |
| `plugins/sp/skills/history-anatomy/references/report-contract.md:191` |
| `packages/domain/src/analytics/protocol-usage.ts:1` |
| `packages/domain/tests/analytics/protocol-usage.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `protocolUsageSummary(db, {since, until})` returning `ProtocolUsage` with `tools[]`, `resources[]`, `byActor[]`, `a2a[]`, `authDenied[]` | MET | `packages/domain/src/analytics/protocol-usage.ts:110` (single windowed `SELECT` over the six 1376/1377 names, folded in TS), types at `:17-97`, exported via `analytics/index.ts`; `packages/domain/tests/analytics/protocol-usage.test.ts` (5 cases: tools/percentiles, resources+actors+a2a+auth, multi-entry ordering, unreadable plane, empty window) |
| R2 — nearest-rank p50/p95 over `payload.durationMs`; a row without a numeric duration counts in `durationUnmeasured` and is excluded, never 0 | MET | `protocol-usage.ts:244` (`nearestRank`), `:161-168` (measured vs `unmeasured`); assertions `protocol-usage.test.ts:69-73` (p50 10, p95 30 over `[10,30]`, `durationUnmeasured` 1) |
| R3 — `history-service` calls it beside `pairingSummary` over the same window; optional `HistoryArtifact.protocolUsage`; arrays registered `'set'` in `artifact-digest.ts` | MET | `packages/app/src/services/history-service.ts:934` (same selector window, same `Promise.all`), artifact field `artifact.ts:243`, digest `artifact-digest.ts:67-71`; the `ArtifactArrayKey` exhaustiveness guard (`:84-88`) compiles, and `artifact-digest.test.ts` new case proves order-independence |
| R4 — `renderForensics` adds a "Protocol usage" block; empty window renders `not available (no protocol events in window)`, never zeros | MET | `render-forensics.ts:407` (`### Protocol Usage`, wired at `:37` inside section 8 after Bottleneck Ranking); `not available` for both an absent artifact field and an empty window; `render-forensics.test.ts` 3 new cases (table values, empty window, absent block) |
| R5 — `report-contract.md` and `operations.md` section 8 cites `protocolUsage`; missing `protocolUsage` is a section-6 telemetry gap; no section added or renamed | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md` (section-8 paragraph cites `protocolUsage`, states the section-6 gap rule), `operations.md` (protocol-usage note); the frozen 12-section list is untouched (plugin structure tests 34+ invariants pass in the gate log) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Daily report shows protocol tool usage (R1,R2,R3,R4,R5) | MET | test | `packages/domain/tests/analytics/protocol-usage.test.ts` 5/5 + `render-forensics.test.ts` 28/28 + `artifact-digest.test.ts` 4/4; workspace coverage run reports `protocol-usage.ts 100.00% funcs / 100.00% lines`; `history-service.test.ts` 72/72 |
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

- 2026-11-18T08:32:12.198Z todo → wip (system)
- 2026-11-18T08:36:56.507Z wip → testing (system)
- 2026-11-18T08:36:58.374Z testing → done (system)

