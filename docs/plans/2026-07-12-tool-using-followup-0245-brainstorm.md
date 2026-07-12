---
date: 2026-07-12
topic: tool-using-followup-0245
needs_design: true
status: approved
recommended_approach: three-task-abc-pipeline
feature_id: J
parent_task: "0245"
---

# Brainstorm: Tool Using follow-ups after 0245

## Overview

Task **0245** shipped Observability → Tool Using as a read-only tail of
`.spur/context/token-ledger.jsonl` with Live poll. Operator follow-ups cover capture
quality (hooks, tokens, agent/model), live transport (SSE + pagination), UI polish, and a
reported “only two rows” symptom.

## Investigation highlights

### #7 Two rows

On spur-new, `GET /api/observability/tool-use` returns **count=200, truncated=true** over a
~52k-line ledger. API reverse-tail is healthy. Perception/data issues:

1. **Newest events are often session_start/end** — recent non-Claude sessions do not fire
   PostToolUse; last tool write in sample was 2026-07-11.
2. **Missing `.session.json`** → PostToolUse fail-open drops tool events.
3. **React row keys collide** (~45/200 dups) when ts/session/type/file/tokens match.

### #1 Hook expansion

Today matcher `Read|Write|Edit` only. Claude PostToolUse includes `session_id`, `tool_input`,
`tool_response` (we underuse these).

### #2 Tokens

`tokens: 0` when `tool_response.content` empty is common for Edit. Cascade estimate + `null`
when unknown.

### #3+#4 Live

System Events: history GET + EventSource. Prefer **fs.watch → SSE** + **cursor GET**; hooks stay
file-append fail-open.

### #5 UI

Column reorder + Tokens right-align + thousands separators.

### #6 Agent/model

Best-effort optional fields; never block logging; multi-agent fidelity varies by platform.

## Decision Tree (locked)

| # | Decision | Resolved |
| --- | --- | --- |
| 1 | Packaging | **Tasks A → B → C** ordered |
| 2 | #7 primary fix | Multi-fix: keys + sparse UX + hook/session diagnostics |
| 3 | Token estimate | Cascade → null when unknown |
| 4 | Agent/model | Best-effort optional fields |
| 5 | Live transport | fs.watch + SSE + cursor pagination; poll fallback |
| 6 | Hook tools | Bash + Grep + Glob + R/W/E; redact large stdout |

## Approaches

### Approach 1: Three-task pipeline A→B→C ⭐ Recommended

**A — Capture correctness + UI (P0)**  
Keys, sparse/empty diagnostics, token cascade, optional agent/model/sessionId schema, column
polish (#5), hook SessionStart enrichment.

**B — SSE + cursor pagination (P1)**  
Replace Live poll primary path; System Events–style stream; `?limit=&before=`.

**C — Expand tool matchers (P1)**  
Bash/Grep/Glob; redaction; tests.

**Confidence:** HIGH

### Approach 2: Single mega-task

All seven items one WBS. Reject for delivery risk.

### Approach 3: Feature-only map then plan

Valid if operator wants more ceremony; A→B→C already decomposes.

## Design Summary

| Item | Choice |
| --- | --- |
| Product | Tool Using v1.1+ after 0245 |
| Packaging | Three tasks A→B→C under **J** |
| #7 | Keys + UX + diagnostics (not API rewrite) |
| Tokens | Cascade; null unknown |
| Agent/model | Optional best-effort |
| Live | SSE + cursor; poll fallback |
| Hooks expand | Bash/Grep/Glob + R/W/E |
| `needs_design` | true (SSE + schema) |

## Next Steps

1. Create tasks A, B, C under feature J with deps B→A, C→A (C can parallel B after A).
2. Run A first (`/sp:dev-run`).
3. B and C after A lands event schema.
