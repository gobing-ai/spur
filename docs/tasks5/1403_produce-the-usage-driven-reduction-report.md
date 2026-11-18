---
schema_version: 1
name: Produce the usage-driven reduction report
status: wip
template: feature-impl
created_at: 2026-11-18T05:29:39.497Z
updated_at: "2026-11-18T08:50:55.894Z"
feature_id: H85
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1399"]
---

## 1403. Produce the usage-driven reduction report

### Background

Cuts need evidence, not instinct. 1399 adds `HistoryArtifact.surfaceUsage`: per-item `calls` for every plugin command and skill, taken from `history_skill_call`, plus the `coverage:<kind>:<name>:zero-use` doctor findings. 1398 adds `protocolUsage` for MCP tools.

**Refine corrections (2026-11-17)**
- "Waits for FEEDBACK data; do not start before the 30-day window" → `history_skill_call` already holds 8,130 rows from 2026-03-16 to 2026-11-18, across five sources: pi 6613, claude 628, codex 493, grok 371, agy 25. The rows cover 68 distinct `sp:*` names (local `.spur/spur.db`). → The 30-day gate is already met for commands and skills. It applies only to MCP tools, whose events start when 1376 ships.
- "Recommend per command, skill and tool" → the plugin also ships 4 subagents (`plugins/sp/agents/`), which 1399 doesn't count. MCP tool zero-use is a telemetry gap by design (1399 R4). → Rows with no measurement get `keep — no evidence`. This follows the feature's out-of-scope line "Cuts without usage evidence".
- "Record operator approval in the task" → there was no format for it. → Approval is a Q&A entry on this task listing approved rows by name. 1404 consumes that list and nothing else.

### Requirements

- [ ] R1. Generate the report from a `spur history analyze` artifact whose window is at least 30 days, with `surfaceUsage` and `protocolUsage` present. Write `docs/reports/1403-surface-reduction.json` and `.md`, following the `docs/reports/1309-*` convention.
- [ ] R2. One row per inventory item: every `plugins/sp/commands/*.md`, `plugins/sp/skills/*/`, `plugins/sp/agents/*.md`, and each MCP tool descriptor. Each row has:
  - `kind`
  - `name`
  - `calls`, broken down by source
  - `failureRate` (MCP tools)
  - `recommendation`: `keep | merge:<target> | delete | keep — no evidence`
  - a one-line rationale
- [ ] R3. Apply recommendation rules deterministically:
  - `delete` only when the item has zero calls across every source in a window of at least 30 days.
  - `merge:<target>` only when the item names a target with overlapping purpose; the rationale cites the overlap.
  - Unmeasured kinds (subagents, MCP tools without events) are never cut.
  - Pi-dominated volume is shown per source, never normalized away.
- [ ] R4. After review, add a Q&A entry: `Approved cuts (<date>): <kind>:<name> → delete|merge:<target>, …`. A row that isn't listed is kept.

### Acceptance Criteria

- [ ] AC1 — Reduction report recommends cuts with evidence (req: R1, R2, R3, R4)

Test layer: the report artifact itself (repeatable from the cited history artifact). No code tests, because this task is report-only.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:16:04.144Z

- **Wait 30 days?** Not for commands or skills, which already have 8 months of data across 5 sources. MCP tool rows stay `keep — no evidence` until 1376 events cover 30 days.
- **Subagents?** They are inventoried but unmeasured, so they are kept. Counting Agent tool calls by `subagent_type` is deferred until a subagent cut is actually wanted.

#### Q&A entry — 2026-11-18T08:50:00.000Z

- **Approved cuts (pending operator review): none.** The report proposes 42 `delete` rows; no row is
  approved here, so by the rule every row not listed is kept. Removing plugin commands is a public
  surface change and the operator has not confirmed any of them.
- **Prior-use warning.** 18 of the 42 delete candidates had calls before the 30-day window (e.g.
  `sp:dev-wrapall` 21 lifetime calls, last 2026-10-08). Each row carries `lifetimeCalls` and
  `lastCallAt`, so an approval decision sees a used capability rather than an apparently dead file.
- **MCP tools and subagents stay.** The MCP emitters shipped today (1376/1377), so no tool row has a
  30-day window — every MCP row reads `keep — no evidence`. Subagents have no `subagent_type` rows at all.

### Design

**WHAT.** A report-only task. It needs no new code beyond a throwaway query script if the artifact needs reshaping; the inputs are the 1398/1399 artifact fields.

**WHY.** A cut is a public-surface change for agents. Evidence plus explicit approval keeps it reversible in review, and per-source counts stop one heavy agent (pi) from hiding usage elsewhere.

**WHERE.**
- `docs/reports/1403-surface-reduction.{json,md}`
- this task's Q&A section

**Anti-patterns.**
- Don't recommend from instinct or file size.
- Don't treat an unmeasured surface as zero-use.
- Don't apply any cut here; that is 1404.

### Plan

- [ ] Step 1: run `spur history analyze` over a window of at least 30 days, and check that the artifact has `surfaceUsage` and `protocolUsage`.
- [ ] Step 2: build the inventory, apply the R3 rules, and write the JSON and Markdown report.
- [ ] Step 3: review it with the operator and record the approved list in Q&A (R4).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T08:50:55.894Z todo → wip (system)

