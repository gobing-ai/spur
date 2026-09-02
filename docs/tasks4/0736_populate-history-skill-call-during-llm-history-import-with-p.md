---
schema_version: 1
name: "Populate history_skill_call during LLM history import with per-agent skill-load extraction"
status: backlog
template: standard
created_at: 2026-09-02T17:50:13.810Z
updated_at: "2026-09-02T20:40:31.101Z"
dependencies: ["0735"]
feature_id: E9
---

## 0736. Populate history_skill_call during LLM history import with per-agent skill-load extraction

### Background

With `history_skill_call` in place (0735), the import pipeline must populate it. The per-agent detection signatures are documented and verified in the storm-research report (`content.md` §10). The importer's per-source mappers (`claudeSplit`, `piSplit`, `ompSplit`, `codexSplit`, `agySplit`, `geminiSplit`, `grokSplit`) plus the OpenCode path must emit skill-call split entries, implementing the three detection layers: L0 harness prefix (the translated slash-command dialect: `/sp:` claude, `/skill:sp-` pi/omp, `$sp-` codex, `/sp-` others, rd3 variants), L1 native load tool (the robust signal), L2 inlined body (carries identity).

### Requirements

- [ ] R1. For every typed-table source (claude, pi, omp, codex, agy, gemini, grok) plus the dedicated OpenCode importer path, skill-load events are detected during import and written as `history_skill_call` split entries. Out of scope: `openclaw` and `antigravity` (generic one-to-one sources landing in `history_etl_*` — no typed rows today), `hermes` (no such source in `LlmJsonlSource` — see Q&A).
- [ ] R2. Per-agent extractors implement the verified signatures:
  - claude / omp: assistant `{type:"tool_use"|"toolCall", name:"Skill", input|arguments:{skill, args}}`; claude `caller.type`/user-role L0 prefix maps to `invocation_kind`.
  - pi: user message text matching `<skill name="..." location="...">` (inline-only; no native Skill tool — verified: 0 Skill tool calls across 865 pi logs).
  - codex: `$sp-` prompt + `<skill><name>…</name><path>…/SKILL.md</path>` content block; `exec_command` with `sed|cat …/SKILL.md` as a read signal.
  - agy / Antigravity CLI: `view_file` tool call with `args.toolAction == "Viewing skill file"` and `toolSummary` naming the skill.
  - grok: `session/update` tool_call `title:"read_file"` with `rawInput.target_file` ending in `SKILL.md` (and `_meta.x.ai/tool.namespace == "grok_build"`).
  - opencode: native `skill({name})` tool call (docs + harness; local verification pending), via the `opencode-importer.ts` part-mapper.
- [ ] R3. Skill names are canonicalized (dialect `sp-dev-run` → canonical `sp:dev-run`; `rd3-*` → `rd3:*`), stripping the harness dialect per agent.
- [ ] R4. False-positive suppression: prose that merely quotes a wrapper or prefix must not produce a row. L1 native-tool evidence is authoritative; L0/L2 corroborate identity but do not trigger on their own unless the agent has no L1 (pi inline-only is the sanctioned exception).
- [ ] R5. Deterministic `record_hash`, ledger + checkpoint integration, full/incremental modes, and dry-run behavior match the `history_tool_call` import path (idempotent re-import, no partial writes on error).
- [ ] R6. Fixture-based tests per agent using sampled log records (no network); MIN_SAFE importer version guard analog applied if the pi path changes arg preservation.

Out of scope: schema/type additions (0735), rollups and UI (0737), hermes / openclaw / antigravity typed extraction (no typed import path exists for them today — follow-up task if the importer gains one).

### Acceptance Criteria

- AC1: Importing a fixture log containing a claude `Skill` tool_use produces a `history_skill_call` row with correct `skill_name`, `invocation_kind`, `skill_path` (when present), and `args_raw`.
- AC2: A pi fixture containing `<skill name="..." location="...">` produces a `user`-kind row with the parsed name and path.
- AC3: Each typed-table agent has at least one fixture test asserting its expected signature: claude, pi, omp, codex, agy, gemini, grok, opencode.
- AC4: A message that only quotes `<skill name=` in prose produces zero rows (no false positive).
- AC5: Re-importing the same file is idempotent (ledger dedup, no duplicate rows); `--dry-run` writes nothing.
- AC6: `spur history import` over a real corpus runs without regressing `history_message`/`history_tool_call` counts; `spur task check 0736` passes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-02T20:40:30.918Z

- **Q: Does hermes get an extractor?** A: No — premise corrected during ready-depth refine. `hermes` is not in the importer's `LlmJsonlSource` union (`src/types.ts:6`) and has no source definition; the R2 hermes bullet was removed. Revisit only if the importer gains a hermes source (follow-up task).
- **Q: Do openclaw / antigravity emit `history_skill_call` rows?** A: No — both are generic one-to-one `sourceDefinition`s (`src/sources.ts:218-219`) landing in `history_etl_*`; there is no typed-row path to extend. Explicitly out of scope in R1.
- **Q: Why is pi allowed to trigger on L0/L2 text alone?** A: pi has no native Skill load tool (verified: 0 Skill tool calls across 865 pi logs, per the storm report), so the inlined `<skill name=... location=...>` wrapper is the only signal — the sanctioned R4 exception.
- **Q: Where does OpenCode extraction live?** A: `src/opencode-importer.ts` (dedicated importer path), not the generic `mappers.ts` splits; its local `targetTable` union (line 30) widens to `'history_skill_call'`.

### Design

Approach: add a shared `extractSkillCalls(record, context) → SkillCall[]` seam in the importer's `src/mappers.ts`, invoked from each custom source's split function (`claudeSplit` :234, `piSplit` :355, `ompSplit` :490, `codexSplit` :724, `agySplit` :919, `geminiSplit` :1057, `grokSplit` :1361), plus the OpenCode part-mapper in `src/opencode-importer.ts` (whose `targetTable` union at line 30 widens to include `'history_skill_call'`). Per-agent heuristics live in one place keyed by source. Each extractor returns zero-or-more `SkillCall` records; the split pipeline routes them to `history_skill_call` via `SplitEntry { targetTable: 'history_skill_call', record }` exactly like tool calls route to `history_tool_call`.

Frozen names: `extractSkillCalls` (exported from `mappers.ts`), per-source detection helpers `detect<Source>SkillCall` kept module-private; canonicalization helper `canonicalizeSkillName(dialect) → string` exported for tests.

Key tradeoffs:

- Inline-only detection (pi) intentionally uses L0/L2 text matching as the primary signal because pi has no L1 — this is the sanctioned exception to R4.
- Canonicalization happens at write time (R3) so raw dialect text is preserved for forensic re-derivation.
- `skill_path` resolution: prefer the `location`/`<path>`/`target_file`/`AbsolutePath` field when present; otherwise null (pi body-only records).

Anti-patterns (do NOT implement):

- No new sources: `openclaw` / `antigravity` stay on the generic `history_etl_*` path; no `hermes` extractor (not an `LlmJsonlSource`).
- No generic NLP/heuristic matching beyond the R2 verified signatures — exact structural matches only (R4 false-positive suppression).
- No schema or DAO changes (0735 owns those; this task only emits records).

Impacted surfaces (all inside `@gobing-ai/ts-llm-jsonl-importer`):

- `src/mappers.ts` — `extractSkillCalls` seam + per-source detection helpers wired into the 7 custom splits.
- `src/opencode-importer.ts` — OpenCode part mapping + `targetTable` union widening (line 30).
- `src/types.ts` — consumes the `SkillCall` record shape from 0735 (no changes expected beyond import).
- Importer fixture tests (`*.test.ts`) — per-agent fixtures, false-positive case, idempotency, dry-run.

Assumes from 0735: `history_skill_call` table + DAO typed-column entry exist. Leaves for 0737: populated `history_skill_call` rows keyed for `(source, skill_name, invocation_kind)` aggregation.

### Plan

1. Implement `canonicalizeSkillName` + per-source detection helpers and the exported `extractSkillCalls(record, context)` seam in `src/mappers.ts` — R1, R2, R3.
2. Wire `extractSkillCalls` into the 7 custom split functions so skill records emit as `SplitEntry { targetTable: 'history_skill_call' }` — R1, R5.
3. Extend `src/opencode-importer.ts`: widen the `targetTable` union (line 30) and map native `skill({name})` parts — R1, R2 (opencode).
4. Per-agent fixture tests (claude, pi, omp, codex, agy, gemini, grok, opencode) asserting each R2 signature — AC1, AC2, AC3.
5. False-positive test: prose quoting `<skill name=` / a slash prefix produces zero rows — AC4, R4.
6. Idempotency + dry-run tests: re-import yields no duplicate rows; `--dry-run` writes nothing — AC5, R5.
7. Real-corpus `spur history import` regression run (history_message/history_tool_call counts unchanged) + `spur task check 0736` — AC6, R6.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Depends on: 0735 (schema + DAO typed-column entry for `history_skill_call`)
- Downstream consumer: 0737
- Evidence: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10 (per-agent signatures, verified)
- Harness translation: `translateSlashCommand` in @gobing-ai/ts-ai-runner (`dist/slash-command.js`)
- Split seam: `src/mappers.ts` custom splits (`claudeSplit` :234 … `grokSplit` :1361); OpenCode path `src/opencode-importer.ts:30`

### History
