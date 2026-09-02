---
schema_version: 1
name: "Add history_skill_call derived table for skill-load behavior"
status: backlog
template: standard
created_at: 2026-09-02T17:49:40.353Z
updated_at: "2026-09-02T17:52:42.345Z"
feature_id: L
---

## 0735. Add history_skill_call derived table for skill-load behavior

### Background
The LLM-conversation history pipeline (task 0470, ts-llm-jsonl-importer) normalizes per-agent session logs into typed tables: `history_message` and `history_tool_call`. Agent skill loads currently have no normalized home: on Claude Code / OMP they surface as `Skill` tool calls inside `history_tool_call`, on pi they are inlined into user-message text as a `<skill name=... location=...>` wrapper, on codex as `$sp-` prompts plus `<skill><name><path>` blocks, on Antigravity CLI as `view_file` "Viewing skill file" tool calls, and on Grok as `read_file` on a SKILL.md path. This task adds the `history_skill_call` derived table so skill-load behavior is first-class and queryable, mirroring the `history_tool_call` design.

Detection signatures are documented in the storm-research report: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10 ("Deriving skill-load behavior from each agent's conversation log"), verified against real session logs and the harness translation table (`translateSlashCommand` in @gobing-ai/ts-ai-runner).
### Requirements
- [ ] R1. `history_skill_call` typed table is added to the history import schema (`HISTORY_IMPORT_SCHEMA_SQL` in ts-llm-jsonl-importer `src/schema-sql.ts`) via `CREATE TABLE IF NOT EXISTS`, sharing `history_tool_call`'s provenance contract: `record_hash` (PK), `message_hash`, `source`, `source_file`, `source_line`, `session_id`, `seq`, `imported_at`.
- [ ] R2. Skill-specific columns exist and are documented: `skill_name` (TEXT NOT NULL, canonicalized e.g. `sp:dev-run`), `invocation_kind` (TEXT: `user` | `model`), `skill_path` (TEXT: resolved SKILL.md location when the log carries one), `args_raw` / `args_digest` (skill invocation arguments), `call_id`, `status`, `started_at`, `completed_at`, `duration_ms`.
- [ ] R3. Indexes cover the query paths: `(source, session_id, seq)`, `(skill_name)`, `(message_hash)`, `(invocation_kind)`.
- [ ] R4. Importer domain types gain a `SkillCall` record shape + `history_skill_call` as a valid split-entry `target_table` (pattern already enforced by `VALID_TABLE_NAME`), with a `SkillCallSchema`-style validator mirroring the tool-call contract.
- [ ] R5. Schema application is idempotent and additive — existing `history_message` / `history_tool_call` imports are unaffected; re-runs and migrations do not drop or rewrite existing tables.
- [ ] R6. The table is created lazily with the rest of the import schema; an import with zero skill loads leaves an empty-but-created table (no error).
### Acceptance Criteria
- AC1: Applying the history import schema creates `history_skill_call` with every R1–R3 column and index present (schema unit test asserts the DDL).
- AC2: `spur history import` on a corpus with no skill activity completes without error and leaves an empty `history_skill_call`.
- AC3: Existing `history_message` / `history_tool_call` fixture tests still pass unchanged (no behavioral regression).
- AC4: A SkillCall-shaped record round-trips through the domain validator; an invalid record (missing `skill_name`) is rejected by `SkillCallSchema`.
- AC5: `spur task check 0735` passes.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: mirror `history_tool_call` exactly for provenance, then add skill-specific columns. `invocation_kind` distinguishes user-invoked (L0 harness prefix in a user message / `caller.type == "direct"` on Claude) from model-invoked (native load tool). `skill_path` is nullable because pi inlines the body without a resolvable path in some records. No materialization here — table + domain types only; extraction lands in 0736, rollups in 0737.

Impacted surfaces:
- `ts-llm-jsonl-importer` `src/schema-sql.ts` (`HISTORY_IMPORT_SCHEMA_SQL` + indexes)
- `ts-llm-jsonl-importer` `src/types.ts` (SkillCall record, SplitEntry target_table union)
- `ts-llm-jsonl-importer` `src/schema-sql.ts` consumers (spur-domain history schema exports, importer DAO)

Invariants: `record_hash` = sha256 over (source, source_file, source_line, split_index, record) like other typed tables; table name matches `VALID_TABLE_NAME`.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Depends-on (for extraction): 0736, 0737
- Evidence: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10
- Reference schema: `history_tool_call` in `ts-llm-jsonl-importer/src/schema-sql.ts`
### History
