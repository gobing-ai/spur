---
schema_version: 1
name: "Populate history_skill_call during LLM history import with per-agent skill-load extraction"
status: backlog
template: standard
created_at: 2026-09-02T17:50:13.810Z
updated_at: "2026-09-02T17:52:42.643Z"
dependencies: ["0735"]
feature_id: L
---

## 0736. Populate history_skill_call during LLM history import with per-agent skill-load extraction

### Background
With `history_skill_call` in place (0735), the import pipeline must populate it. The per-agent detection signatures are documented and verified in the storm-research report (`content.md` §10). The importer's per-source mappers (`claudeSplit`, `piSplit`, `ompSplit`, `codexSplit`, `agySplit`, `geminiSplit`, `grokSplit`) plus the OpenCode path must emit skill-call split entries, implementing the three detection layers: L0 harness prefix (the translated slash-command dialect: `/sp:` claude, `/skill:sp-` pi/omp, `$sp-` codex, `/sp-` others, rd3 variants), L1 native load tool (the robust signal), L2 inlined body (carries identity).
### Requirements
- [ ] R1. For every supported source (claude, pi, omp, codex, agy, gemini, grok, opencode, openclaw), skill-load events are detected during import and written as `history_skill_call` split entries.
- [ ] R2. Per-agent extractors implement the verified signatures:
  - claude / omp: assistant `{type:"tool_use"|"toolCall", name:"Skill", input|arguments:{skill, args}}`; claude `caller.type`/user-role L0 prefix maps to `invocation_kind`.
  - pi: user message text matching `<skill name="..." location="...">` (inline-only; no native Skill tool — verified: 0 Skill tool calls across 865 pi logs).
  - codex: `$sp-` prompt + `<skill><name>…</name><path>…/SKILL.md</path>` content block; `exec_command` with `sed|cat …/SKILL.md` as a read signal.
  - agy / Antigravity CLI: `view_file` tool call with `args.toolAction == "Viewing skill file"` and `toolSummary` naming the skill.
  - grok: `session/update` tool_call `title:"read_file"` with `rawInput.target_file` ending in `SKILL.md` (and `_meta.x.ai/tool.namespace == "grok_build"`).
  - opencode: native `skill({name})` tool call (docs + harness; local verification pending).
  - hermes: `skill_view(name)` tool call / `/<name>` slash prefix (docs + harness; local verification pending).
- [ ] R3. Skill names are canonicalized (dialect `sp-dev-run` → canonical `sp:dev-run`; `rd3-*` → `rd3:*`), stripping the harness dialect per agent.
- [ ] R4. False-positive suppression: prose that merely quotes a wrapper or prefix must not produce a row. L1 native-tool evidence is authoritative; L0/L2 corroborate identity but do not trigger on their own unless the agent has no L1 (pi inline-only is the sanctioned exception).
- [ ] R5. Deterministic `record_hash`, ledger + checkpoint integration, full/incremental modes, and dry-run behavior match the `history_tool_call` import path (idempotent re-import, no partial writes on error).
- [ ] R6. Fixture-based tests per agent using sampled log records (no network); MIN_SAFE importer version guard analog applied if the pi path changes arg preservation.
### Acceptance Criteria
- AC1: Importing a fixture log containing a claude `Skill` tool_use produces a `history_skill_call` row with correct `skill_name`, `invocation_kind`, `skill_path` (when present), and `args_raw`.
- AC2: A pi fixture containing `<skill name="..." location="...">` produces a `user`-kind row with the parsed name and path.
- AC3: Each supported agent has at least one fixture test asserting its expected signature (claude, pi, omp, codex, agy, gemini, grok, opencode, openclaw).
- AC4: A message that only quotes `<skill name=` in prose produces zero rows (no false positive).
- AC5: Re-importing the same file is idempotent (ledger dedup, no duplicate rows); `--dry-run` writes nothing.
- AC6: `spur history import` over a real corpus runs without regressing `history_message`/`history_tool_call` counts; `spur task check 0736` passes.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: add a shared `extractSkillCalls(record, context) → SkillCall[]` seam in the importer, invoked from each source's split function (and the OpenCode part-mapper), so per-agent heuristics live in one place keyed by source. Each extractor returns zero-or-more SkillCall records; the split pipeline then routes them to the `history_skill_call` target table exactly like tool calls route to `history_tool_call`.

Key tradeoffs:
- Inline-only detection (pi) intentionally uses L0/L2 text matching as the primary signal because pi has no L1 — this is the sanctioned exception to R4.
- Canonicalization happens at write time (R3) so raw dialect text is preserved for forensic re-derivation.
- `skill_path` resolution: prefer the `location`/`<path>`/`target_file`/`AbsolutePath` field when present; otherwise null (pi body-only records).

Impacted surfaces:
- `ts-llm-jsonl-importer/src/mappers.ts` (per-source split functions + skill extractor)
- `ts-llm-jsonl-importer/src/opencode-importer.ts` (OpenCode part mapping)
- `ts-llm-jsonl-importer/src/types.ts` (SkillCall record + target table union from 0735)
- importer tests (`*.test.ts` fixture corpus)
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Depends on: 0735
- Downstream consumer: 0737
- Evidence: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10 (per-agent signatures, verified)
- Harness translation: `translateSlashCommand` in @gobing-ai/ts-ai-runner (`dist/slash-command.js`)
### History
