---
name: session-formats
description: "Source → session-log root-path table and spur history bridge for sp:issue-finding."
see_also:
  - issue-finding
---

# Session log formats — source discovery

`sp:issue-finding` analyzes **raw session JSONL** for tool-loop forensics — as the **fallback**
path only (task 0556): the primary REPORT path is the typed data plane
(`spur history report --mode forensics`). Layout and event shapes differ by coding agent. This
file covers **DISCOVER path** (where logs live) and the **history bridge**.

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

## History bridge

`spur history` holds **validated ETL + ledger**. It is the primary REPORT path
(`spur history report --mode forensics`). Raw session JSONL is the named fallback only.

| Need | Use |
|------|-----|
| Token / cost aggregates, derived forensics | `spur history analyze` then `spur history report --mode forensics` |
| Identical test-command loops, guard retries, git red herrings | Raw session JSONL (fallback — primitives the typed tables do not retain) |
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

**Selected-file bridge (task 0507 R3):** the data-plane path imports the frozen Phase-1 file set one
file at a time — never a root scan, never a full reconciliation. Ambient discovery covers the
normal OMP root (`~/.omp/agent/sessions/`) **and** workflow subprocess sessions under
`.spur/run/<run-id>/agent-sessions/<omp-executor>/*.jsonl` (same `type: "message"` envelope). For
each file, the session key is the JSONL filename stem (importer `sessionIdFromContext`); import and
analyze per key:

```bash
spur history import --source omp --file <absolute-file> --mode force-file --json
spur history analyze --session <filename-stem> --json
```

ETL owns token/cost/message/tool/loop/assistant-duration aggregates; raw JSONL stays authoritative
for command text, compactions, test/guard retries, and tool execution duration/status/errors.

## OMP tool-call block shapes (task 0564 R5)

Live OMP assistant messages emit **flat** toolCall blocks whose argument bag sits under
`arguments`; older sessions emit the **legacy nested** `{toolCall:{…}}` envelope, and an
intermediate shape used `input` as the argument key. The fallback parser and this skill must
read all three the way the importer does — **`mappers.ts` (`normalizeOmpToolCall`,
`call.input ?? call.arguments`) is the single field-map authority**; this section records the
shapes for recognition, it is not a second map.

1. **Legacy nested block** — argument bag under a `toolCall` envelope:

```json
{"type":"message","message":{"role":"assistant","content":[
  {"toolCall":{"id":"call_x","name":"bash","arguments":{"command":"git status","i":"Check state"}}}
]}}
```

2. **Flat block, legacy `input` key**:

```json
{"type":"message","message":{"role":"assistant","content":[
  {"type":"toolCall","id":"call_x","name":"bash","input":{"command":"git status","i":"Check state"}}
]}}
```

3. **Flat block, current `arguments` key (live shape)** — `{type, id, name, arguments, intent,
   partialArgs, streamIndex}`:

```json
{"type":"message","message":{"role":"assistant","content":[
  {"type":"toolCall","id":"call_x","name":"bash","arguments":{"command":"git status","i":"Check state"},
   "intent":"Check state","partialArgs":"{\"command\":\"git status\",\"i\":\"Check state\"}","streamIndex":0}
]}}
```

The command text is the `command` field inside the argument bag: `call.input ?? call.arguments`
then `.command` — never a hardcoded key choice.

**toolResult messages** are `role: "toolResult"` message envelopes (not content blocks) carrying
`{toolCallId, toolName, content, details, isError, timestamp}` — `details.wallTimeMs` is the
tool's own measured wall time when present; `toolCallId` joins the originating `toolCall.id`.
The importer retains the timing (`history_tool_call.duration_ms` / `started_at` /
`completed_at`, task 0564 R1); raw logs stay authoritative for result text, which lives in
`content[].text` — not a `block.output` field.

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
