---
template: meta
schema_version: 1
name: "Enhance spur history + dev-find-issue to replace ad-hoc session forensics (OMP tool-call extraction, subprocess session root, latency model)"
description: ""
status: backlog
type: meta
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0505", "0506"]
ac_numbering: task-local
created_at: "2026-08-11T06:04:07.701Z"
updated_at: "2026-08-11T06:28:50.036Z"
---

## 0507. Enhance spur history + dev-find-issue to replace ad-hoc session forensics (OMP tool-call extraction, subprocess session root, latency model)

### Background
Task 0505 required raw OMP JSONL parsing because the released `@gobing-ai/ts-llm-jsonl-importer@0.4.25` does not normalize the current OMP event envelope correctly. Current OMP files contain top-level `type: "message"` records whose role, content, model, usage, duration, and tool calls live under `raw.message`; tool-call blocks are flat `{ type: "toolCall", id, name, arguments }`. The mapper instead reads `raw.type`, `raw.content`, `raw.id`, and `raw.seq`, so the defect is broader than a missed flat block: roles are wrong, every event ID becomes a session ID, sequence defaults to zero, assistant duration is dropped, and tool-call rows are absent.

The same structural envelope appears in workflow subprocess logs under `.spur/run/<run-id>/agent-sessions/<executor>/*.jsonl`. Importer default roots are home-relative and currently include only `.omp/agent/sessions`; adding the project-relative run tree to that registry would mix root semantics and may ingest non-OMP executors. The issue-finding skill already resolves concrete session files, so its history path can safely import those selected files one at a time with the existing single-file `force-file` mode.

Tool execution timing/status is a separate seam. OMP assistant tool calls, `custom.tool_execution_start`, and `toolResult` messages share `toolCallId`, but `ompSplit` is a stateless per-line mapper and `history_tool_call` has no correlation column. Producing one complete row therefore needs a file-level correlation design; emitting separate start/result rows would double-count calls. This task leaves that signal on the raw-JSONL path.

OMP assistant messages already carry numeric `message.duration`; the existing `history_message.duration_ms` column can store it. Spur can expose assistant-duration aggregates additively without a database migration or artifact schema-version bump. With those fixes, history becomes the primary source for representable cost/tool/loop/duration aggregates while raw JSONL remains authoritative for command text, compactions, guard/test retries, and tool result timing/status.
### Requirements
- [ ] R1. Correct the OMP mapper for the current `type: "message"` envelope while preserving the legacy direct/nested shape. Using the existing `TransformContext`, derive a stable session ID from the source filename and sequence from `sourceLine`; read role, text blocks, model, usage, cost, and duration from `raw.message`; emit one `history_tool_call` row for each flat `type: "toolCall"` block with `tool_name` and `args_digest`; keep existing nested `block.toolCall` support. Add sanitized mapper/importer regressions, release the next lockstep ts-libs version, and update Spur's catalog/lockfile with source-local provenance evidence.
- [ ] R2. Surface OMP assistant response duration without inventing a thinking-latency model. Map numeric `message.duration` to the existing `history_message.duration_ms`. Add additive `assistantDurationMs` and `assistantDurationUnmeasured` fields to history forensic totals and per-session stats, calculated only from `role = 'assistant'`; preserve existing tool `durationMs` semantics and keep `HISTORY_ARTIFACT_SCHEMA_VERSION = 1`.
- [ ] R3. Make `dev-find-issue --use-history` use ETL for signals it can represent. Freeze the Phase-1 selected OMP JSONL files, import each through the source-local CLI with `--source omp --file <path> --mode force-file`, derive the mapper's session key from the filename, and run `history analyze --session <key> --json`. Use the artifact for token/cost/message/tool/loop/assistant-duration aggregates; continue parsing the same raw files for command text, compactions, test/guard retries, tool execution duration/status/errors, and other unsupported signals. Document ambient and `.spur/run/*/agent-sessions/*/*.jsonl` discovery without adding automatic multi-root import.

Non-goals: cross-line `toolCallId` correlation; tool execution start/completion/status/error fields; a new importer root model or repeatable CLI flag; a new ETL column or migration; an artifact schema-version bump; changing non-OMP mappers; importing every file under `.spur/run`; real-data backfill; full-mode reconciliation; eliminating raw JSONL from issue-finding.
### Acceptance Criteria
Scenario: R1 — Current OMP message envelopes produce stable messages and tool calls
  Given a sanitized OMP JSONL file containing a session event, an assistant `type: "message"` envelope with one flat toolCall block, and its toolResult
  When `runJsonlImport('omp', { files: [file], mode: 'force-file' })` imports it
  Then assistant and toolResult roles come from `raw.message.role`
  And all rows use the source-filename session key and source-line sequence
  And exactly one history_tool_call row carries the tool name and arguments digest
  And the assistant row stores `message.duration` in duration_ms

Scenario: R1 — Legacy OMP shapes remain compatible
  Given an existing direct OMP assistant record with nested `block.toolCall`
  When `ompSplit` maps it
  Then the existing message and tool-call assertions still pass

Scenario: R2 — Assistant duration is additive and distinct from tool duration
  Given OMP assistant messages with measured and missing duration_ms values
  When `spur history analyze --source omp --json` runs
  Then totals and matching bySession entries report assistantDurationMs and assistantDurationUnmeasured
  And tool durationMs remains calculated only from history_tool_call
  And schemaVersion remains 1

Scenario: R3 — Selected ambient and subprocess sessions use the history bridge
  Given `dev-find-issue --use-history` resolves OMP files from the normal session root and `.spur/run/<run-id>/agent-sessions/<omp-executor>/`
  When Phase 2 starts
  Then each frozen file is imported once with single-file force-file mode through the source-local CLI
  And analyze is scoped to the corresponding filename-derived session key
  And no full import or broad `.spur/run` scan occurs

Scenario: R3 — Unsupported forensic signals remain explicit raw evidence
  Given the analyzed session contains tool execution events, command text, compactions, or guard/test retries
  When issue-finding emits its metrics and findings
  Then ETL supplies token/cost/message/tool/loop/assistant-duration aggregates
  And the report names every metric still derived from raw JSONL
  And tool calls are not duplicated to approximate timing or status
### Q&A
**Q: Is the importer defect only the flat toolCall shape?**

A: No. Real OMP records are top-level event envelopes. The released mapper reads the wrapper rather than `raw.message`, so role, content, session identity, sequence, duration, and tool calls are all wrong or absent. R1 fixes that envelope once and retains the older direct shape as compatibility coverage.

**Q: Why not implement tool timing/status in the same mapper change?**

A: The three correlated records are on different JSONL lines. The current custom splitter is stateless and the target table has no `toolCallId`; emitting rows from both assistant and result records would double-count. A correct file-level correlation seam is separate work, not a small mapper branch.

**Q: Why use assistantDurationMs instead of thinkingMs?**

A: OMP directly reports `message.duration`; that is measured assistant response duration. Calling a timestamp gap “thinking” would assert semantics the source does not provide. The measured field reuses the existing message duration column and can be sliced by the existing selectors.

**Q: Why not add `.spur/run` as another default OMP root?**

A: Importer defaults resolve against the home directory, while `.spur/run` is project-relative and can contain sessions from multiple agents. `dev-find-issue` already resolves and classifies exact files, so single-file force-file imports cover subprocess sessions without a new root/config surface or accidental cross-format ingestion.

**Q: Does `--use-history` replace raw JSONL completely?**

A: No. It becomes authoritative for normalized aggregates. Raw logs remain necessary for exact command bodies, compactions, guard/test sequences, and tool timing/status until a file-level correlation contract exists.

**Q: Does the additive artifact field require schema version 2?**

A: No. `packages/domain/src/analytics/artifact.ts` explicitly reserves version bumps for removed or retyped fields; additive fields stay at version 1.
### Design
**R1 — normalize the OMP envelope at its owning mapper**

- Authority and files: `/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`; focused tests in `tests/mappers.test.ts` and `tests/importer.test.ts`. Do not patch Spur around the released mapper.
- Change `ompSplit` to accept `TransformContext` and reuse the existing `sessionIdFromContext` and `extractContentText` helpers. Use `context.sourceLine` before legacy `raw.seq`; use `raw.message.role/content/model/usage/cost/duration` when present, otherwise retain the current direct fields.
- For assistant content, normalize one local `contentBlocks = raw.message?.content ?? raw.content`. A block is a tool call when `block.toolCall` exists or `block.type === 'toolCall'`; normalize to one local call object and reuse `argsDigest(call.input ?? call.arguments)`. Emit one row only.
- Classify non-message lifecycle/custom records as meta using the same filename session key; never use each event's unique `raw.id` as the session ID when context exists.
- Sanitized regression data must reproduce structural keys only—no copied prompts, command arguments, tool results, credentials, or full 0505 session fixture. The importer-level test writes a tiny temporary JSONL file whose name supplies the session key.
- Release through the existing lockstep ts-libs path after upstream focused/full gates. Update Spur's root catalog and `bun.lock`; validate with `bun run apps/cli/src/index.ts history import ... --dry-run --json` provenance naming the new importer. Publication/push remains the operator-controlled release gate.

**R2 — query measured assistant duration, no schema expansion**

- Upstream mapping: `message.duration` (finite number, milliseconds) → existing `history_message.duration_ms`; missing/non-finite stays NULL.
- Spur query surface: extend `MessageRollupRow` and `messageRollup` in `packages/domain/src/analytics/forensic-query.ts` with role-filtered `assistantDurationMs` and `assistantDurationUnmeasured`. Extend `SessionRow`/`bySession` the same way.
- Artifact surface: define `ForensicTotals` as `TokenTotals` plus the two assistant-duration fields, and add them to `SessionStat` in `packages/domain/src/analytics/artifact.ts`. Update `emptyTotals`, `foldMessage`, and session mapping in `packages/app/src/services/history-service.ts`. Do not overload existing tool `durationMs`/`durationUnmeasured`.
- Tests: extend `packages/domain/tests/analytics/forensic-query.test.ts` and `packages/app/tests/services/history-service.test.ts`; update `docs/04_DESIGN.md` in the same Spur commit. Additive fields do not change `HISTORY_ARTIFACT_SCHEMA_VERSION`.

**R3 — selected-file history bridge**

- Update only the SSOT procedure in `plugins/sp/skills/issue-finding/SKILL.md` and its root/bridge reference `references/session-formats.md`; `plugins/sp/commands/dev-find-issue.md` already declares and forwards `--use-history` and needs no duplicate procedure.
- Phase 1 freezes the concrete session files once. For each file classified by the OMP adapter, invoke `bun run apps/cli/src/index.ts history import --source omp --file <absolute-file> --mode force-file --json`; use the filename stem returned by the mapper's session-key rule for `history analyze --session <key> --json`.
- Extend the existing R24b assertions in `plugins/sp/tests/skill-structure.test.ts` to pin source-local CLI use, force-file mode, both discovery roots, ETL-owned signals, and the raw fallback list. Do not add scripts or a second parser under the skill directory.

**Cross-task contract:** task 0505 supplies the released 0.4.25 baseline and incident evidence; task 0506 supplies the schema-first rule in `session-formats.md`. Both are hard dependencies. Task 0507 must preserve 0506's rule and extend it with the selected-file history flow; it does not re-own or conditionally recreate 0506's work. Execute 0507 only after both dependencies are done. This task leaves a future tool-correlation task a clean contract: correlate assistant/custom/result records by `toolCallId` at file scope and emit exactly one history_tool_call row.

**Traceability:** feature E is a grouping feature without feature-level scenarios; task-local R1–R3 acceptance criteria are authoritative.

**Anti-patterns:** no raw-session fixture copy; no second OMP parser in Spur; no duplicate tool rows; no guessed `thinkingMs`; no repeatable-root/config surface; no `.spur/run` wildcard import; no real database backfill during implementation; no schema-version bump for additive fields.
### Plan
- [ ] P1 (R1) In `~/xprojects/ts-libs`, fix `ompSplit` envelope/session/sequence/text/tool-call/duration mapping using existing helpers; add sanitized mapper and force-file importer regressions; run the package-focused and ts-libs completion gates.
- [ ] P2 (R1) Execute the operator-controlled next lockstep ts-libs release, update Spur's catalog/lockfile, and record source-local CLI provenance for the released importer. Do not use a temporary link as final evidence.
- [ ] P3 (R2) Add role-filtered assistantDurationMs/assistantDurationUnmeasured SQL, artifact types, service folds/mapping, focused domain/app tests, and the same-commit `docs/04_DESIGN.md` surface update; keep schemaVersion 1 and tool-duration fields unchanged.
- [ ] P4 (R3) After task 0506 is done, preserve its schema-first rule and extend issue-finding with selected-file force-file import/analyze routing plus the ETL-vs-raw signal matrix; extend the existing R24b structure test without changing the thin command wrapper.
- [ ] P5 (R1–R3) Run targeted tests first: ts-libs importer mapper/importer suites; Spur forensic-query, history-service, and plugin skill-structure suites. Then run both repositories' required completion gates, source-local dry-run provenance, task verification, and intentional git status. Do not run a full-mode write or backfill the real history database.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Incident baseline: task 0505 (`docs/tasks4/0505_run-real-data-full-mode-verification-pass-for-history-import.md`)
- Overlapping predecessor: task 0506 (`docs/tasks4/0506_fix-0505-run-inefficiencies-inline-wrap-hop-dry-run-probe-gu.md`)
- Upstream OMP mapper: `/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts` (`ompSplit`, `sessionIdFromContext`, `extractContentText`)
- Upstream importer/root contracts: `/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/src/{importer,sources,types,schema-sql}.ts`
- Upstream tests: `/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/tests/{mappers,importer}.test.ts`
- Spur forensic queries: `packages/domain/src/analytics/forensic-query.ts`
- Spur artifact contract: `packages/domain/src/analytics/artifact.ts` (`HISTORY_ARTIFACT_SCHEMA_VERSION`)
- Spur artifact assembly: `packages/app/src/services/history-service.ts`
- Issue-finding SSOT: `plugins/sp/skills/issue-finding/SKILL.md`, `references/session-formats.md`
- Thin wrapper: `plugins/sp/commands/dev-find-issue.md`
- Plugin gate: `plugins/sp/tests/skill-structure.test.ts` R24b
- Surface documentation: `docs/04_DESIGN.md` history analyze section
### History
### Notes
**Verified premises**

- Released ts-libs head is 0.4.25; `ompSplit` is a stateless per-line custom splitter and the OMP source has one home-relative default root.
- The inspected OMP host and wrap-subprocess files share the same wrapper shape: top-level `message` events with nested assistant/toolResult roles and flat toolCall blocks.
- Assistant calls, custom starts, and tool results share IDs, but no target correlation column exists. Timing/status cannot be merged correctly by a one-line mapper branch.
- Assistant `message.duration` is present and numeric; `history_message.duration_ms` already exists.
- Artifact version comments explicitly say additive fields do not bump version 1.
- `dev-find-issue --use-history` currently uses history only optionally for token/cost aggregates and keeps raw JSONL primary.

**Refinement dispositions**

- Expanded R1 from a flat-block patch to the actual OMP envelope correction.
- Replaced optional/ambiguous thinking latency with measured assistant duration.
- Deferred tool timing/status correlation instead of emitting duplicate or partial tool rows.
- Replaced automatic multi-root import with selected-file force-file imports using the existing CLI.
- Kept the thin `dev-find-issue` wrapper unchanged; the skill is the procedure SSOT.

No open design decisions remain.
