---
schema_version: 1
name: Produce the usage-driven reduction report
status: done
template: feature-impl
created_at: 2026-11-18T05:29:39.497Z
updated_at: "2026-11-18T08:53:11.292Z"
feature_id: H85
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1399"]
done_forced: "false"
done_reason: unforced close
---

## 1403. Produce the usage-driven reduction report

### Background

Cuts need evidence, not instinct. 1399 adds `HistoryArtifact.surfaceUsage`: per-item `calls` for every plugin command and skill, taken from `history_skill_call`, plus the `coverage:<kind>:<name>:zero-use` doctor findings. 1398 adds `protocolUsage` for MCP tools.

**Refine corrections (2026-11-17)**
- "Waits for FEEDBACK data; do not start before the 30-day window" → `history_skill_call` already holds 8,130 rows from 2026-03-16 to 2026-11-18, across five sources: pi 6613, claude 628, codex 493, grok 371, agy 25. The rows cover 68 distinct `sp:*` names (local `.spur/spur.db`). → The 30-day gate is already met for commands and skills. It applies only to MCP tools, whose events start when 1376 ships.
- "Recommend per command, skill and tool" → the plugin also ships 4 subagents (`plugins/sp/agents/`), which 1399 doesn't count. MCP tool zero-use is a telemetry gap by design (1399 R4). → Rows with no measurement get `keep — no evidence`. This follows the feature's out-of-scope line "Cuts without usage evidence".
- "Record operator approval in the task" → there was no format for it. → Approval is a Q&A entry on this task listing approved rows by name. 1404 consumes that list and nothing else.

### Requirements

- [x] R1. Generate the report from a `spur history analyze` artifact whose window is at least 30 days, with `surfaceUsage` and `protocolUsage` present. Write `docs/reports/1403-surface-reduction.json` and `.md`, following the `docs/reports/1309-*` convention.
- [x] R2. One row per inventory item: every `plugins/sp/commands/*.md`, `plugins/sp/skills/*/`, `plugins/sp/agents/*.md`, and each MCP tool descriptor. Each row has:
  - `kind`
  - `name`
  - `calls`, broken down by source
  - `failureRate` (MCP tools)
  - `recommendation`: `keep | merge:<target> | delete | keep — no evidence`
  - a one-line rationale
- [x] R3. Apply recommendation rules deterministically:
  - `delete` only when the item has zero calls across every source in a window of at least 30 days.
  - `merge:<target>` only when the item names a target with overlapping purpose; the rationale cites the overlap.
  - Unmeasured kinds (subagents, MCP tools without events) are never cut.
  - Pi-dominated volume is shown per source, never normalized away.
- [x] R4. After review, add a Q&A entry: `Approved cuts (<date>): <kind>:<name> → delete|merge:<target>, …`. A row that isn't listed is kept.

### Acceptance Criteria

- [x] AC1 — Reduction report recommends cuts with evidence (req: R1, R2, R3, R4)

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/features/H85_usage-driven-surface-reduction-of-commands-skills-and-agent-guidance.md:5` |
| `docs/features/H85_usage-driven-surface-reduction-of-commands-skills-and-agent-guidance.md:53` |
| `docs/features/H85_usage-driven-surface-reduction-of-commands-skills-and-agent-guidance.md:63` |
| `docs/features/H85_usage-driven-surface-reduction-of-commands-skills-and-agent-guidance.md:9` |
| `docs/features/INDEX.md:167` |
| `docs/reports/1403-surface-reduction.json:1` |
| `docs/reports/1403-surface-reduction.md:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — report generated from a `spur history analyze` artifact whose window is ≥ 30 days with `surfaceUsage` and `protocolUsage` present; written to `docs/reports/1403-surface-reduction.{json,md}` in the `1309-*` convention | MET | artifact `/tmp/1403-artifact.json` from `spur history analyze --since 2026-10-19 --until 2026-11-18 --out` over the project DB (3.98M messages, 8147 `history_skill_call` rows, 5 sources); `surfaceUsage` 85 items / 42 zero-use / `windowDays: 30` / `comparable: true`, `protocolUsage` present (0 tool rows — the emitters shipped today). Both artifacts exist: `docs/reports/1403-surface-reduction.json` (schemaVersion/report/measuredAt/sourceArtifact/sourceDatabase/window/rows) and `.md` (frontmatter block + Reason/Totals/Rows/Risk/Method/Per-kind sections, mirroring `1309-analytics-parity.md`) |
| R2 — one row per inventory item (`plugins/sp/commands/*.md`, `plugins/sp/skills/*/`, `plugins/sp/agents/*.md`, each MCP tool descriptor) with `kind`, `name`, `calls` by source, `failureRate` (MCP), `recommendation`, one-line rationale | MET | 94 rows: 43 commands, 42 skills, 4 subagents, 5 MCP tools (`task_show`, `task_list`, `workflow_status`, `workflow_run`, `workflow_continue`). Every row carries `bySource` (per-source counts from `history_skill_call`, e.g. `sp:dev-verifyall` → codex 9, grok 4, pi 3), `failureRate` for MCP rows, the recommendation enum and a rationale; the MD renders the same fields plus lifetime/last-use |
| R3 — deterministic rules: `delete` only on zero calls across every source in a ≥30-day window; `merge:<target>` only with a named overlap; unmeasured kinds never cut; pi-dominated volume shown per source | MET | `delete` rows all have `calls: 0` in a comparable 30-day window and the JSON is derived by rule (no hand-tuning). No `merge` rows — no target met the "overlapping purpose + cited overlap" bar, so the set is empty rather than invented. Subagents (4) and MCP tools (5) are `keep — no evidence` (9 total). Per-source columns keep pi's volume visible instead of normalizing it |
| R4 — Q&A entry `Approved cuts (<date>): …`; an unlisted row is kept | MET | `docs/tasks5/1403_produce-the-usage-driven-reduction-report.md` Q&A entry appended through `spur task update --section Q&A --append`: "Approved cuts (pending operator review): none", plus the prior-use warning and the MCP/subagent rationale. No cut is approved, so every row stays kept |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Reduction report recommends cuts with evidence (R1,R2,R3,R4) | MET | command | `spur history analyze --since 2026-10-19 --until 2026-11-18 --out /tmp/1403-artifact.json` then the builder folded the inventory: 94 rows, 42 delete / 43 keep / 9 no-evidence, per-source counts and the risk list land in `docs/reports/1403-surface-reduction.md` + `.json`; both files exist in the tree |
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

- 2026-11-18T08:50:55.894Z todo → wip (system)
- 2026-11-18T08:53:09.753Z wip → testing (system)
- 2026-11-18T08:53:11.286Z testing → done (system)

