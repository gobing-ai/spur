---
name: session-formats
description: "Source → session-log root-path table and spur history bridge for sp:issue-finding."
see_also:
  - issue-finding
---

# Session log formats — source discovery

`sp:issue-finding` analyzes **raw session JSONL** for tool-loop forensics. Layout and event
shapes differ by coding agent. This file covers **DISCOVER path** (where logs live) and the
**history bridge** (`--use-history`).

**What typed tables retain is owned by `mappers.ts`.** The importer
`@gobing-ai/ts-llm-jsonl-importer/src/mappers.ts` is the single code authority for which JSONL
fields each source populates on `history_message` / `history_tool_call` — including the
todo-tool `args_raw` retention allowlist (task 0553 R1). This skill holds **no duplicate field
map**; two maps that can disagree is the defect closed by 0553 R5.

## Source → default root

| `--source` | Default root (expand `~`) | History import source |
|------------|---------------------------|----------------------|
| `omp` | `~/.omp/agent/sessions/-<project-slug>/` | *(not a history source name)* |
| `claude` | `~/.claude/projects/` | `claude` |
| `codex` | `~/.codex/sessions/` | `codex` |
| `gemini` | `~/.gemini/sessions/` | `gemini` |
| `opencode` | agent-specific OpenCode session store (varies by install) | `opencode` |
| `antigravity` | agent-specific Antigravity session store | `antigravity` |
| `openclaw` | OpenClaw / `~/.agents/` session trees when present | `openclaw` |
| `pi` | Pi conversation/session roots (see `spur history` examples) | `pi` |
| `grok` | `~/.grok/sessions/<url-encoded-workspace-path>/<session-uuid>/chat_history.jsonl` | `grok` |
| `agy` | *(no discoverable on-disk session format — VS Code fork)* | `agy` |
| `auto` | Detect: prefer explicit agent if known; else first existing root among `omp`, `claude`, `codex`, `pi`, `gemini` | maps when importing |

**Project slug (OMP):** path under the sessions root is typically the project path with `/`
replaced (e.g. `/Users/…/xprojects/spur-new` → `-Users-…-xprojects-spur-new` or
`-xprojects-spur-new` depending on host layout). List the sessions parent and pick the directory
that matches the cwd project when ambiguous.

**When the default root is missing or empty:** stop guessing. Ask for a path or require
`--sessions <glob>`.

**Fail-loud rule:** a zero tool-command count across a **non-empty** session set means the field
map is wrong, not that the sessions were idle. Report a probable field-map error instead of an
idle-session / no-waste finding — a parser that matches nothing must never produce a clean
verdict (0534 R3).

## History bridge (`--use-history`)

`spur history` holds **validated ETL + ledger**, not a full replacement for forensic JSONL:

| Need | Use |
|------|-----|
| Token / cost aggregates | `spur history analyze [--since …] --json` after import |
| Identical test-command loops, guard retries, git red herrings | Raw session JSONL (this skill's primary path) |
| Multi-agent cost rollups | Import per source, then analyze |

Import does not invent bottleneck categories. If import fails or the DB is empty, continue with
raw logs and note that cost data is unavailable.

**Schema-first rule (task 0506 R3):** history tables are owned by
`@gobing-ai/ts-llm-jsonl-importer` and can change between versions — never copy column lists
into this skill. Before any ad-hoc verification SQL that references importer-owned `history_*`
tables, run **one** schema-introspection query for every table you need and compose the data
queries from that result:

```bash
# one introspection pass, then write data queries against what it reports
sqlite3 <db> "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name LIKE 'history_%';"
```

If a column you expected is absent, trust the live schema — do not guess. The importer's
`HISTORY_IMPORT_SCHEMA_SQL` + `mappers.ts` are the authority; this skill holds no duplicate
column contract.

## Edge cases

| Scenario | Handling |
|----------|----------|
| No session root found | Fail DISCOVER with a clear message; request `--sessions` |
| Huge multi-hour JSONL | Prefer Grep/rg for signal patterns first; sample then deep-read hot regions |
| Mixed agents in one investigation | Run per `--source` or pass an explicit multi-file `--sessions` glob; label each session's source |
| Redacted / truncated logs | Analyze what remains; do not invent tool counts |

## Related

- Skill entry: [../SKILL.md](../SKILL.md)
- History CLI: `spur history --help`, `docs/help/cmd_history.md`
- Typed-table field authority: `@gobing-ai/ts-llm-jsonl-importer/src/mappers.ts`
- Daily usage (not session forensics): `sp:daily-summary` / ccusage
