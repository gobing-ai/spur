---
name: session-formats
description: "Multi-source session log roots, tool-call field maps, OMP deep dive, and spur history bridge for sp:issue-finding."
see_also:
  - issue-finding
---

# Session log formats — multi-source discovery

`sp:issue-finding` analyzes **raw session JSONL** for tool-loop forensics. Layout and event
shapes differ by coding agent. This file is the SSOT for DISCOVER path selection and ANALYZE
field mapping.

**Confidence legend**

| Level | Meaning |
|-------|---------|
| High | Documented adapter used successfully on real sessions (OMP) |
| Medium | Default roots from Spur history help / importer sources; parse best-effort |
| Low | Operator must pass `--sessions`; field map incomplete |

## Source → default root

| `--source` | Default root (expand `~`) | History import source | Fidelity |
|------------|---------------------------|----------------------|----------|
| `omp` | `~/.omp/agent/sessions/-<project-slug>/` | *(not a history source name)* | High |
| `claude` | `~/.claude/projects/` | `claude` | Medium |
| `codex` | `~/.codex/sessions/` | `codex` | Medium |
| `gemini` | `~/.gemini/sessions/` | `gemini` | Medium |
| `opencode` | agent-specific OpenCode session store (varies by install) | `opencode` | Low–Medium |
| `antigravity` | agent-specific Antigravity session store | `antigravity` | Low–Medium |
| `openclaw` | OpenClaw / `~/.agents/` session trees when present | `openclaw` | Low–Medium |
| `pi` | Pi conversation/session roots (see `spur history` examples) | `pi` | Medium |
| `auto` | Detect: prefer explicit agent if known; else first existing root among `omp`, `claude`, `codex`, `pi`, `gemini` | maps when importing | — |

**Project slug (OMP):** path under the sessions root is typically the project path with `/`
replaced (e.g. `/Users/…/xprojects/spur-new` → `-Users-…-xprojects-spur-new` or
`-xprojects-spur-new` depending on host layout). List the sessions parent and pick the directory
that matches the cwd project when ambiguous.

**When the default root is missing or empty:** stop guessing. Ask for a path or require
`--sessions <glob>`.

## Portable tool-call map

When parsing a line of JSONL, look for tool/function invocations under common shapes:

| Source family | Typical tool block type / path | Bash/command field |
|---------------|--------------------------------|--------------------|
| OMP / omp-agent | `message.content[]` entries with `type: "toolCall"` | `input.command` |
| Claude Code | `type: "tool_use"` (or nested message content) | `input.command` / `input` |
| Codex / others | Importer-normalized or vendor-specific; search for `command`, `tool_name`, `name` | best-effort |

Always record **what field path you used** in the inventory Notes so evidence is auditable.

**Loop detection (all sources):** normalize the shell command string and count consecutive or
near-consecutive identical invocations (≥3) without an intervening source-file edit tool call.

## OMP deep dive (High fidelity)

OMP/agent session logs are JSONL under `~/.omp/agent/sessions/-<project>/`:

- Each line is a JSON object with a `type` field
- Key event types: `session`, `message`, `compaction`, `title`, `title_change`, `custom`
- Tool calls live in `message.content` as blocks with `type: "toolCall"` (**not** `tool_use`)
- Bash tool calls expose `input.command`
- Subagent sessions live in subdirectories (e.g. `Run0376/`, `Refine0378/`)
- Subagents may have `*.log` beside the JSONL session file
- Session start: `session.timestamp`
- Session title: `title.title` (often auto-generated from the first user message)
- Session id pattern: `<ISO-timestamp>_<UUID>.jsonl`
- Cross-session: subagent messages may carry `parentId` linking to the parent session

**Discovery without `--sessions`:** list the project sessions directory; take the newest
timestamped main session file; include sibling subagent JSONL under that session’s tree.

## Claude / Codex / Pi / Gemini (Medium)

Documented import examples (see `docs/help/cmd_history.md`):

```bash
spur history import --source claude --root ~/.claude/projects --mode incremental
spur history import --source codex --root ~/.codex/sessions/ --mode incremental
spur history import --source gemini --root ~/.gemini/sessions/ --mode full
spur history import --source pi --file ~/pi/logs/conversation.jsonl
```

For issue-finding:

1. Prefer raw JSONL under those roots for tool-loop analysis.
2. Use `--sessions` when multiple projects share a root.
3. Tool event shapes may differ from OMP — use the portable map; do not force `toolCall`-only parsing.

## History bridge (`--use-history`)

`spur history` holds **validated ETL + ledger**, not a full replacement for forensic JSONL:

| Need | Use |
|------|-----|
| Token / cost aggregates | `spur history analyze [--since …] --json` after import |
| Identical test-command loops, guard retries, git red herrings | Raw session JSONL (this skill’s primary path) |
| Multi-agent cost rollups | Import per source, then analyze |

Import does not invent bottleneck categories. If import fails or the DB is empty, continue with
raw logs and note that cost data is unavailable.

## Edge cases

| Scenario | Handling |
|----------|----------|
| No session root found | Fail DISCOVER with a clear message; request `--sessions` |
| Huge multi-hour JSONL | Prefer Grep/rg for signal patterns first; sample then deep-read hot regions |
| Mixed agents in one investigation | Run per `--source` or pass an explicit multi-file `--sessions` glob; label each session’s source |
| Only transcript markdown available | Medium/Low confidence; extract commands from fenced blocks if present; mark evidence quality |
| Redacted / truncated logs | Analyze what remains; do not invent tool counts |

## Related

- Skill entry: [../SKILL.md](../SKILL.md)
- History CLI: `spur history --help`, `docs/help/cmd_history.md`
- Daily usage (not session forensics): `sp:daily-summary` / ccusage
