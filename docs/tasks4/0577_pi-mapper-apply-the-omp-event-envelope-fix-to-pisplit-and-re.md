---
template: issue
schema_version: 1
name: "pi mapper: apply the omp event-envelope fix to piSplit and re-import pi"
description: ""
status: done
type: issue
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T18:35:44.094Z"
updated_at: "2026-08-17T21:50:40.128Z"
---

## 0577. pi mapper: apply the omp event-envelope fix to piSplit and re-import pi

### Background
Split out of task 0576 (history-load dogfood follow-up, 2026-08-17) after the P2 investigation
found the defect is upstream in `@gobing-ai/ts-llm-jsonl-importer`, not in Spur's watermark code.
0576 keeps the Spur-side fail-open guard; this task owns the mapper.

`ompSplit` was fixed to treat pi/omp-shaped JSONL as **event envelopes**
(`{type, id, timestamp, message: {role, content, model, usage, cost}}`). `piSplit` — which the
importer's own comment calls "near-identical to pi" — never received the same fix, so every pi row
in `history_message` is structurally wrong. The mapper compiles, imports without error, and reports
success; the damage is silent and only visible against the data.

#### Measured evidence (`.spur/spur.db`, 2026-08-17)

| Symptom | pi | omp (fixed mapper) |
| --- | --- | --- |
| messages | 209,393 | 267,969 |
| distinct `session_id` | **176,792** | 917 |
| sessions holding exactly 1 message | **175,288** | — |
| rows with non-null `content_text` | **7,832 (3.7%)** | 163,657 (61%) |
| `history_tool_call` rows | **0** | 101,785 |
| `seq` | **0 on every row** | source line |
| `role` values | `message`, `toolresult`, `custom_message`, `session_info`, `model_change`, `thinking_level_change`, `session`, `custom` | `user`, `assistant`, `meta` |

Consequences: no session grouping, no ordering, no turn structure, no tool telemetry, and — because
the task 0550 watermark degrade rule needs tool-call rows to reason about turn completeness — pi is
marked ~100% `in-progress` and excluded from every analytics query. `input_tokens` /
`output_tokens` / `cost_usd` are the only pi columns that survive (317M / 31M tokens recorded).

This also corrects task 0489's coverage matrix, which marks pi **session-discovery ✅** on the
strength of reading `piSplit`'s source (`s(r.id, o(r.session).id)` *looks* like session extraction).
Measured against real data the cell is ✗ — `r.id` is the per-event id.
### Requirements
- **R1** — `piSplit` derives `session_id` from the source file (the `sessionIdFromContext(context, raw)` path `ompSplit` uses), never from the per-event `raw.id`. A pi session file maps to one `session_id`.
- **R2** — `piSplit` derives `seq` from `context.sourceLine` (as `ompSplit` does) so pi rows carry a usable ordering instead of a constant `0`.
- **R3** — `piSplit` maps `role` from the nested `message.role` before falling back to the record type, so pi rows carry canonical `user` / `assistant` / `system` roles instead of leaking pi record types.
- **R4** — `piSplit` collapses pi lifecycle/custom record types (`session`, `session_info`, `model_change`, `thinking_level_change`, `custom`, `custom_message`, `title*`, `compaction`, `custom.*`) to a single `disposition: 'meta'` row keyed by the session, matching `ompSplit`'s meta rule.
- **R5** — `piSplit` extracts `content_text` from block-shaped content via `extractContentText` (as `ompSplit` does) rather than the string-only `s(...)` fallback that nulls 96% of pi rows.
- **R6** — Tool calls are emitted for pi assistant messages, so pi contributes `history_tool_call` rows and the task 0550 watermark rule has turn-closer evidence to work with.
- **R7** — The fixed mapper is released from `~/xprojects/ts-libs/ts-llm-jsonl-importer`, pulled into this monorepo via `bun update`, and pi is re-imported with `spur history import --source pi --mode full` (record hashes and session ids change, so an incremental import will not repair existing rows).
- **R8** — Task 0489's coverage-matrix cell for pi **session-discovery** is corrected from ✅ to the measured verdict, with a pointer to this task.
### Acceptance Criteria
- **AC1 (R1, R2)** — After a full pi re-import, `SELECT COUNT(DISTINCT session_id) FROM history_message WHERE source='pi'` is within an order of magnitude of the pi session-file count (~1,500), not ~176k; and `SELECT COUNT(*) FROM (SELECT session_id FROM history_message WHERE source='pi' GROUP BY session_id HAVING COUNT(*)=1)` is a small minority, not 175,288. `MAX(seq)` for pi is > 0.
- **AC2 (R3, R4)** — `SELECT DISTINCT role FROM history_message WHERE source='pi'` returns only canonical roles (`user`, `assistant`, `system`, `meta`, `unknown`); no pi record type (`message`, `toolresult`, `custom_message`, `session_info`, `model_change`, `thinking_level_change`, `session`, `custom`) appears as a role. Lifecycle record types carry `disposition='meta'`.
- **AC3 (R5)** — pi rows with non-null `content_text` rise from 3.7% to a share comparable to omp's (≥ 50%), measured on the same DB.
- **AC4 (R6)** — `SELECT COUNT(*) FROM history_tool_call tc JOIN history_message m ON m.record_hash=tc.message_hash WHERE m.source='pi'` is > 0.
- **AC5 (R1–R6)** — Unit tests in `ts-llm-jsonl-importer` cover `piSplit` against a real pi JSONL fixture: session id from context, seq from source line, nested role mapping, meta collapsing, block content extraction, and tool-call emission. The existing `ompSplit` tests are the shape to mirror.
- **AC6 (R7)** — `bun run apps/cli/src/index.ts history import --source pi --mode full` prints a provenance header naming the republished importer version, exits 0, and `history analyze --source pi --json` exits 0 with a pi section that is no longer empty.
- **AC7 (R7)** — `bun run lint`, `bun run test`, and `bun run build` are green in this monorepo after the `bun update`; the importer's own suite is green in `~/xprojects/ts-libs`.
- **AC8 (R8)** — `docs/tasks4/0489_forensic-primitive-coverage-matrix-what-the-ten-sources-actu.md` no longer asserts pi session-discovery ✅ unqualified.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan
- [x] Capture the pre-fix baseline query set against `.spur/spur.db` so AC1–AC4 have a before/after (R1)
- [x] Port `ompSplit`'s session/seq/role/meta/content/tool-call handling into `piSplit` in `~/xprojects/ts-libs/ts-llm-jsonl-importer/src/mappers.ts`, against a real pi JSONL fixture (R1, R2, R3, R4, R5, R6)
- [x] Add `piSplit` unit tests mirroring the existing `ompSplit` tests (R1, R2, R3, R4, R5, R6)
- [x] Release the importer and `bun update` the dependent workspaces here; confirm the version in the import provenance header (R7)
- [x] Re-import pi with `--mode full` and re-run the AC1–AC4 queries against the new rows (R7)
- [x] Correct task 0489's pi session-discovery cell (R8)
- [x] Run `bun run lint` / `bun run test` / `bun run build` and re-review the diff (R7)
### Root Cause
Verified against `node_modules/@gobing-ai/ts-llm-jsonl-importer@0.4.33/dist/mappers.js` (dist read
because the mapper is an external package; the fix lands in
`~/xprojects/ts-libs/ts-llm-jsonl-importer/src/mappers.ts`).

`piSplit` (`mappers.js:228`) still assumes pi's JSONL is a flat message record. Four defects, all
already fixed in `ompSplit` (`mappers.js:299`):

| # | `piSplit` (broken) | `ompSplit` (correct) | Damage |
| --- | --- | --- | --- |
| 1 | `const sessionId = s(r.id, o(r.session).id) ?? 'unknown'` | `const sessionId = sessionIdFromContext(context, raw)` | `r.id` is the per-event id → 175,288 singleton sessions |
| 2 | `const seq = typeof r.seq === 'number' ? r.seq : 0` | `const seq = context?.sourceLine ?? …` | pi has no `r.seq` → `seq = 0` on all 209,393 rows |
| 3 | `const role = mapRole(r.type ?? r.role)` | `const role = mapRole(msg?.role ?? raw.type ?? raw.role)` | `mapRole` passes unknown strings through (`mappers.js:1181`), so the record type lands in `role` |
| 4 | no meta branch; `content_text: s(r.content, r.text, msg?.content)`; tool calls gated on `role === 'assistant'` | meta branch at `:311-337`; `extractContentText(contentBlocks)`; same gate but `role` is real | lifecycle rows counted as messages, block content nulled (96%), zero tool calls |

`ompSplit`'s own comment states the invariant `piSplit` violates: *"The unique top-level `id` is an
event id, never a session id; the session key and sequence come from the source file (context)."*
The header above `ompSplit` reads *"OMP mapper (near-identical to pi)"* — the fix was applied to one
of the pair and never back-ported.

Defect 3 is what makes this visible in Spur: with `role='message'` the tool-call branch never runs,
pi ends up with zero `history_tool_call` rows, and the task 0550 watermark degrade rule (which needs
tool-call evidence to find turn closers) marks essentially every pi session `in-progress` — dropping
pi from analytics entirely. That symptom is guarded separately in task 0576; this task removes the
cause.
### Solution
**Correction (re-audit 2026-08-17, `/sp:dev-verifyall --feature E5 --force --fix all`).** The
previous auto-generated change-map on this section listed task **0576**'s watermark diff
(`packages/domain/src/analytics/watermark.ts`, `watermark.test.ts`,
`packages/app/src/services/history-service.ts`) — 0576 and 0577 landed in the same commit
`d3b8f082`, and the generator attributed the whole commit to this task while omitting 0577's own
changes. Replaced below with this task's actual delivery surface.

**R1–R6 — `piSplit` (external package, not a repo-relative path).** The mapper fix lives in
`@gobing-ai/ts-llm-jsonl-importer` (`packages/llm-jsonl-importer/src/mappers.ts` in
`~/xprojects/ts-libs`), not in this monorepo: `piSplit` now derives `session_id` via
`sessionIdFromContext(context, raw)` instead of the per-event `raw.id` (R1), `seq` from
`context.sourceLine` (R2), `role` from the nested `message.role` before the record-type fallback
(R3), collapses pi lifecycle/custom record types to `disposition: 'meta'` (R4), extracts
`content_text` through `extractContentText` (R5), and emits tool calls for pi assistant messages
(R6) — the `ompSplit` shape throughout. Unit coverage is `tests/mappers.test.ts` in that repo.

**R7 — release + re-import (this repo).**

- `package.json:36` (`workspaces.catalog`) and `package.json:95` — `@gobing-ai/ts-llm-jsonl-importer`
  pinned to the released mapper (`^0.4.38` / `0.4.38` today; `0.4.36` at this task's landing,
  carried forward monotonically by tasks 0578 and 0580).
- `bun.lock` — resolved snapshot for the bump.
- Full pi re-import from a source-local binary (`bun run apps/cli/src/index.ts history import
  --source pi --mode full`), provenance header recorded in Testing. Record hashes and session ids
  change, so an incremental import cannot repair the existing rows.

**R8 — coverage-matrix correction.**

- `docs/tasks4/0489_forensic-primitive-coverage-matrix-what-the-ten-sources-actu.md:245` — the pi
  **session-discovery** cell now reads `✅ (fixed by 0577)` rather than an unqualified `✅`.
- Same file `:258-262` — the per-primitive evidence block records the measured result
  (1,501 files → 1,424 sessions, 0 singletons; was 176,792 sessions / 175,288 singletons).

**Not changed here:** the watermark fail-open fix (`watermark.ts`) is task **0576**; the release +
re-import contract this task follows is defined by task **0578**; codex/claude/grok/pi timestamp and
usage mapper work is task **0580**.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | sqlite: distinct session_id pi = 1424, singletons = 0 (baseline 176792/175288) |
| R2 | MET | sqlite: roles exactly user/assistant/meta/unknown (101852/88693/10282/8722) |
| R3 | MET | record_type preserved: message 190545, tool_start/end 4314, custom_message 2718, session_info 1919, model_change 1611, … |
| R4 | MET | meta records collapsed to disposition=meta, role=meta (10282 rows) |
| R5 | MET | content_text non-null 150713/199267 keep-rows = 75.6% (≥ 50% AC; baseline 3.7%) |
| R6 | MET | history_tool_call pi: 98093 rows across 1067 sessions; 98084 carry call_id; top: bash 55788, read 19304, edit 11799 (baseline 0) |
| R7 | MET | import provenance header: importer @0.4.36, 1501 files → 307642 messages, exit 0; bun run lint/test/build green (5678 pass) |
| R8 | MET | task 0489 matrix line 245: pi session-discovery ✅ (fixed by 0577) + evidence block rewritten with measured numbers |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | SELECT COUNT(DISTINCT session_id) WHERE source='pi' → 1424; singletons 0; files=1501 |
| AC2 | MET | command | SELECT DISTINCT role → user, assistant, meta, unknown only |
| AC3 | MET | command | content_text non-null share 75.6% of keep rows (≥ 50%) |
| AC4 | MET | command | 98093 tool-call rows joined to pi messages (baseline 0) |
| AC5 | MET | test | ts-libs mappers.test.ts: 218 pass / 0 fail incl. new piSplit envelope/session/seq/epoch/tool-call/meta tests |
| AC6 | MET | command | import header printed importer: @gobing-ai/ts-llm-jsonl-importer@0.4.36 |
| AC7 | MET | command | bun run lint clean; bun run test 5678 pass/0 fail; bun run build exit 0 (all after catalog bump to 0.4.36) |
| AC8 | MET | manual-review | docs/tasks4/0489_….md line 245 now ✅ (fixed by 0577); per-primitive evidence block cites 0577 measured numbers |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | lint | — | biome + tsc --noEmit all workspaces exit 0 |
| P4 | test | — | 5678 pass / 0 fail, 303 files |
| P4 | build | — | all workspace builds exit 0 |
| P4 | task-check | — | spur task check 0577 after record: 0 ERR / 0 WARN |
### References
- Parent finding: task 0576 (`docs/tasks4/0576_history-load-dogfood-follow-up-findings-2026-08-17.md`) — P2 investigation that isolated this cause; 0576 owns the Spur-side fail-open guard.
- Dogfood run: `docs/dogfood/2026-08-17-sp-dev-history-load-dogfood.md` (run `20260817-historyload-103307`).
- Watermark policy this defect trips: task 0550, `packages/domain/src/analytics/watermark.ts`.
- Coverage matrix to correct: task 0489, `docs/tasks4/0489_forensic-primitive-coverage-matrix-what-the-ten-sources-actu.md` (pi session-discovery cell).
- ETL contract precedent: task 0466 (`docs/tasks3/0466_implement-the-forensic-etl-contract-in-ts-llm-jsonl-importer.md`).
- Upstream source: `~/xprojects/ts-libs/ts-llm-jsonl-importer/src/mappers.ts` — `piSplit` vs `ompSplit`.
- Re-import contract (source-local binary + provenance header): `CLAUDE.md` § "Build & repo commands", task 0504 R4.
### History
- 2026-08-17T19:16:29.083Z todo → wip (system)
- 2026-08-17T19:35:01.149Z wip → testing (system)
- 2026-08-17T19:36:18.390Z testing → done (system)
