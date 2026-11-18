---
schema_version: 1
name: Flag failing and unused surfaces in spur-doctor
status: done
template: feature-impl
created_at: 2026-11-18T05:29:36.438Z
updated_at: "2026-11-18T08:43:04.450Z"
feature_id: I61
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1398"]
done_forced: "false"
done_reason: unforced close
---

## 1399. Flag failing and unused surfaces in spur-doctor

### Background

`sp:spur-doctor` reflects over history-anatomy findings through a fixed map (`plugins/sp/skills/spur-doctor/SKILL.md:162-176`, keyed on `key`/`category`/`ownerSurface`). It has no runtime reader of its own. E93 classifies command/subagent/skill usage into `history_skill_call` with `capability_kind`/`evidence_kind`/`status` (`packages/domain/src/analytics/history-board-rollup.ts:84-111`). Inventories exist: plugin commands via `findPluginsSpCommandsDir`/`scanMarkdownCommands` (`packages/app/src/services/slash-commands-service.ts:161,244`).

**Refine corrections (2026-11-17)**
- "spur-doctor reports…" → the doctor never computes. It maps history-anatomy findings to actions. → The task produces evidence in the artifact plus finding keys, and the doctor's map routes them unchanged: failing tool → task, or rule candidate if automatable; zero-use surface → task (input to H85 1403).
- "zero-use commands, skills and tools" → zero-use needs an inventory. Commands and skills have one (plugin dirs). MCP tool descriptors live in `apps/server/src/modules/mcp/index.ts:31` (`TOOL_DESCRIPTORS`), which `packages/app` must not import (ADR-021). → MCP tool zero-use is reported as a telemetry gap until the descriptors are importable from a package. Tools are still flagged for failure through 1398's `protocolUsage`.
- "thresholds configurable with defaults" → no config key is needed yet. A failure-rate finding needs `calls >= 20` and `failureRate >= 0.2` (constants in one place). Zero-use needs a window of at least 30 days, otherwise it is `not comparable`. Promote to config when an operator asks.
- The feature note "needs 2–4 weeks of events" is enforced by the minimum-window rule above, not by the operator's memory.

### Requirements

- [x] R1. Add `surfaceUsageSummary(db, { since, until, inventory })` in `packages/domain/src/analytics/surface-usage.ts`. `inventory` is `{ kind: 'command'|'skill', name }[]`. It returns per-item `calls` from `history_skill_call` (classified, any status) in the window, plus `zeroUse[]`.
- [x] R2. `history-service` builds the inventory from the plugin `commands/` and `skills/` dirs (reusing the `findPluginsSpCommandsDir` resolution) and sets `HistoryArtifact.surfaceUsage?`. Items are named as E93 records them (`sp:<name>`).
- [x] R3. The anatomy contract defines two finding keys:
  - `reliability:mcp-tool:<tool>:failure-rate` when `calls >= 20 && failureRate >= 0.2` from `protocolUsage`
  - `coverage:<kind>:<name>:zero-use` when `surfaceUsage.zeroUse` contains the item and the window is at least 30 days
  Each cites the artifact path and counts as its evidence anchor.
- [x] R4. A window shorter than 30 days renders zero-use as `not comparable (window < 30d)` with no findings. MCP tool zero-use always appears as a telemetry gap naming the reason.
- [x] R5. No change to the spur-doctor reflection map (it already routes `reliability`/`coverage` findings). Add one line to the doctor SKILL.md that these keys feed H85.

### Acceptance Criteria

- [x] AC1 — Doctor flags failing and unused surfaces (req: R1, R2, R3, R4, R5)

Test layer: domain analytics test on in-memory SQLite plus the anatomy structure-gate fixture test.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:09:00.940Z

- **Configurable thresholds?** Deferred. They are constants until an operator asks; a config key would be an additive schema change.
- **MCP tool zero-use?** It's a telemetry gap for now. Moving `TOOL_DESCRIPTORS` into a package belongs to B91 or H85 if they need it.

### Design

**WHAT.** A second optional artifact field, an inventory injected from the app layer into the domain query, and two stable finding keys in the anatomy contract.

**WHY.** The artifact is the only evidence plane (history-anatomy primary directive). The doctor and H85 consume findings, so nothing else needs to change.

**WHERE.**
- `packages/domain/src/analytics/surface-usage.ts` (+ artifact, digest)
- `packages/app/src/services/history-service.ts`
- `plugins/sp/skills/history-anatomy/references/report-contract.md` (keys, thresholds)
- `plugins/sp/skills/spur-doctor/SKILL.md` (one line)

**Anti-patterns.**
- Don't import `apps/server` from packages.
- No doctor-side SQL.
- No deletion proposals beyond the finding (H85 owns cuts).
- Don't count `request` evidence as non-use.

### Plan

- [ ] Step 1 (test first, R1/R4): domain test with seeded `history_skill_call` rows and an inventory containing used and unused items. Cover the 29-day window → `not comparable`.
- [ ] Step 2: implement and wire `history-service` (R2).
- [ ] Step 3 (R3/R5): contract keys and thresholds, plus the doctor line. Extend the anatomy structure-gate test fixtures with the two keys.
- [ ] Step 4: `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/history-service.ts:1034` |
| `packages/app/src/services/history-service.ts:1977` |
| `packages/app/src/services/history-service.ts:72` |
| `packages/app/src/services/history-service.ts:914` |
| `packages/app/src/services/history-service.ts:938` |
| `packages/app/src/services/history-service.ts:96` |
| `packages/app/tests/services/history-anatomy.test.ts:622` |
| `packages/domain/src/analytics/artifact-digest.ts:72` |
| `packages/domain/src/analytics/artifact.ts:245` |
| `packages/domain/src/analytics/artifact.ts:6` |
| `packages/domain/src/analytics/index.ts:267` |
| `packages/domain/src/analytics/render-forensics.ts:38` |
| `packages/domain/src/analytics/render-forensics.ts:458` |
| `packages/domain/tests/analytics/render-forensics.test.ts:561` |
| `plugins/sp/skills/history-anatomy/references/report-contract.md:53` |
| `plugins/sp/skills/spur-doctor/SKILL.md:180` |
| `packages/domain/src/analytics/surface-usage.ts:1` |
| `packages/domain/tests/analytics/surface-usage.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `surfaceUsageSummary(db, {since, until, inventory})` returning per-item calls from `history_skill_call` (any status) plus `zeroUse[]` | MET | `packages/domain/src/analytics/surface-usage.ts:59` (one grouped `SELECT` over `skill_name IN (inventory)`, window bounded by the same `buildTimeRangeClauses` the other analytics use), types `:20-45`; `packages/domain/tests/analytics/surface-usage.test.ts` 4/4 (used+unused, short window, unbounded/empty inventory, unreadable plane) |
| R2 — inventory built in `history-service` from the plugin `commands/` and `skills/` dirs via `findPluginsSpCommandsDir`, names as E93 records them (`sp:<name>`), optional `HistoryArtifact.surfaceUsage` | MET | `packages/app/src/services/history-service.ts:1983` (`surfaceInventory()`, reuses the resolver import at `:17`), wired at `:942` beside `protocolUsageSummary`; artifact field `packages/domain/src/analytics/artifact.ts:249`; digest `'set'` entries `artifact-digest.ts:72-74` (compiler exhaustiveness guard still passes) |
| R3 — two finding keys with thresholds: `reliability:mcp-tool:<tool>:failure-rate` (`calls >= 20 && failureRate >= 0.2`) and `coverage:<kind>:<name>:zero-use` (item in `zeroUse`, window ≥ 30d), each citing the artifact path | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md` new "Surface findings" table cites `protocolUsage.tools[]` / `surfaceUsage.zeroUse[]` with both thresholds; structure-gate fixture `packages/app/tests/services/history-anatomy.test.ts` (new case) proves both keys pass the closed-category gate |
| R4 — window < 30d renders zero-use as `not comparable (window < 30d)` with no findings; MCP tool zero-use stays a telemetry gap naming the reason; no `request` evidence read as non-use | MET | `surface-usage.ts:16,60-62` (`comparable` false ⇒ `zeroUse: []`), renderer `render-forensics.ts:468` (emits `not comparable (window < 30d …)` and returns before any zero-use table); tests `surface-usage.test.ts:76-90` and `render-forensics.test.ts` (short-window case asserts no zero-use table); contract states the MCP telemetry-gap rule and that a `request`-only row counts as use |
| R5 — no change to the doctor reflection map; one line that these keys feed H85 | MET | `plugins/sp/skills/spur-doctor/SKILL.md` (H85 paragraph added after the closed-class list; the six-row reflection map is untouched) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Doctor flags failing and unused surfaces (R1,R2,R3,R4,R5) | MET | test | `surface-usage.test.ts` 4/4, `render-forensics.test.ts` 35/35, `history-anatomy.test.ts` 69/69; workspace coverage run reports `surface-usage.ts 100.00% funcs / 100.00% lines`; domain workspace 1495 pass; `spur-doctor` skill structure tests pass in the pipeline gate |
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

- 2026-11-18T08:42:14.779Z todo → wip (system)
- 2026-11-18T08:43:02.907Z wip → testing (system)
- 2026-11-18T08:43:04.445Z testing → done (system)

