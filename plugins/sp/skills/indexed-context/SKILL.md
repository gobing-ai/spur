---
name: indexed-context
description: "Cross-agent project intelligence: file index (anatomy), learnings, pitfalls, bug log, token ledger, and session memory under .spur/context/. Triggers: \"load project context\", \"new session\", \"unfamiliar codebase\", \"index this codebase\", \"codebase memory\", \"indexed context\", \"project intelligence\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - context-provider
    - inversion
  operations:
    - load-context
    - update-anatomy
    - append-learning
    - append-pitfall
    - log-bug
    - record-memory
  openclaw:
    emoji: "🧠"
---

# Indexed Context

`sp:indexed-context` provides **cross-session, cross-agent codebase intelligence** through six
data files under `.spur/context/`. It replaces OpenWolf's Claude Code-only protocol with a
portable, markdown-first approach that works on every target agent.

**One principle:** the agent accumulates knowledge in `.spur/context/` as it works, and checks
that knowledge before redundant work. The token ledger is the only file written automatically
(by hooks); the other five are skill-guided — the agent appends when it recognizes value.

## Data layer — `.spur/context/`

| File | Purpose | Who writes |
|---|---|---|
| `anatomy.md` | File index — 2-3 line description + token estimate per file | Agent (skill-guided) |
| `learnings.md` | Project conventions, API quirks, decision rationale | Agent (skill-guided) |
| `pitfalls.md` | Do-Not-Repeat entries, dated | Agent (skill-guided) |
| `buglog.md` | Structured bug patterns (error, root cause, fix, tags) | Agent (skill-guided) |
| `memory.md` | Session log — milestones, decisions, outcomes | Agent (skill-guided) |
| `token-ledger.jsonl` | Per-event token tracking — append-only event stream | **Hooks (automatic)** |

All files are gitignored — they hold machine-generated state specific to your local working copy.

## When this skill activates

Activate `sp:indexed-context` when you need the **full protocol** — onboarding to a codebase,
starting a significant session, or wanting to understand what prior sessions learned. The
individual habits below also apply implicitly via `AGENTS.md`'s inline rules.

## Protocol — the 6 habits

### 1. Check anatomy before reading files

Before reading a file, check `.spur/context/anatomy.md`. If it has a sufficient description for
your task, **skip the full read** — save the tokens. Only read the full file if the description
is missing, stale, or insufficient for your current task.

**Anatomy entry format:**

```markdown
### `path/to/file.ts`
Brief description (1-3 lines). Token estimate: NNN.

Key exports / responsibilities:
- exportName — what it does
```

### 2. Check pitfalls before generating code

Before writing code, scan `.spur/context/pitfalls.md` for dated Do-Not-Repeat entries relevant to
the area you're touching. Avoid repeating known mistakes.

**Pitfall entry format:**

```markdown
## Do-Not-Repeat: <short title>

- **Date:** YYYY-MM-DD
- **Mistake:** what went wrong
- **Fix:** what to do instead
```

### 3. Update anatomy on file changes

After **creating, deleting, or renaming** a file, update the `anatomy.md` entry:

- **Created:** add a new `### \`path\`` section with description + token estimate.
- **Deleted:** remove the entry.
- **Renamed:** move the entry to the new path.

### 4. Append learnings when you discover value

When you learn a **non-obvious** project convention, API quirk, or user correction, append to
`.spur/context/learnings.md`. Skip obvious things — the value is in the non-obvious.

**Learning entry format:**

```markdown
## Learning: <short title>

- **Convention/quirk:** description
- **Why it matters:** rationale
```

### 5. Log bugs when you fix them

After encountering and fixing a bug, test failure, or error, append to both:

- `.spur/context/buglog.md` — structured entry for pattern matching.
- `.spur/context/pitfalls.md` — if it's a do-not-repeat lesson.

**Bug entry format:**

```markdown
## bug-NNN: <error message>

- **Date:** YYYY-MM-DD
- **File:** `path/to/file`
- **Root cause:** why it broke
- **Fix:** what you changed
- **Tags:** relevant, keywords
```

### 6. Record memory at milestones

At the **end of significant work** (milestone, PR, session wrap-up), append to
`.spur/context/memory.md`:

```markdown
| HH:MM | description | file(s) | outcome | ~tokens |
```

## Token ledger — automatic via hooks

`token-ledger.jsonl` is written by hooks, not by the agent. One event per line:

```jsonl
{"ts":"2026-07-09T14:23:01Z","session":"session-2026-07-09-1423","type":"session_start"}
{"ts":"2026-07-09T14:23:15Z","session":"session-2026-07-09-1423","type":"read","file":"src/dao.ts","tokens":648}
{"ts":"2026-07-09T14:24:00Z","session":"session-2026-07-09-1423","type":"write","file":"src/dao.ts","tokens":222,"action":"edit"}
{"ts":"2026-07-09T14:30:00Z","session":"session-2026-07-09-1423","type":"session_end","totals":{"reads":5,"writes":19,"tokens":2783}}
```

**Never edit `token-ledger.jsonl` by hand.** It feeds a future tool-use monitoring tool. On
agents without hook support, the ledger simply doesn't accumulate — graceful degradation.

## Graceful degradation

On an agent supporting hooks, the token ledger runs silently. On an agent that does NOT support
hooks, the agent can still read/write the other 5 files by skill guidance — it loses only the
automatic ledger. The intelligence layer is fully portable; the counting layer is best-effort.
