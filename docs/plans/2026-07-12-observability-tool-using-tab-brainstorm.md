---
date: 2026-07-12
topic: observability-tool-using-tab
needs_design: true
status: approved
recommended_approach: token-ledger-tail-service-flat-table
feature_id: J
---

# Brainstorm: Observability → Tool Using tab (token-ledger)

## Overview

Operators need a Board surface for **agent file-tool activity** already recorded by `sp` plugin
hooks into `.spur/context/token-ledger.jsonl`. That ledger exists (task 0232 / indexed-context);
the Board has no tab for it. Destination: a read-only **Tool Using** tab under Observability —
newest-first table, optional **Live** poll — backed by a thin observe API. Hooks stay the write
path; no second event store.

## Investigation (hooks — pre-ideation)

| Item | Finding |
| --- | --- |
| Registry | `plugins/sp/hooks/hooks.json` — PostToolUse `Read\|Write\|Edit` → `superskill hook run sp context-post-tool` |
| Writers | `context-session-start.ts`, `context-post-tool.ts`, `context-session-stop.ts` |
| SSOT file | `{project}/.spur/context/token-ledger.jsonl` |
| Skill docs | `plugins/sp/skills/indexed-context/SKILL.md` — “feeds a future tool-use monitoring tool” |
| Live data (spur-new) | ~52k lines / ~9.5 MB; types: session_start, read, write, session_end |
| Tests | `plugins/sp/hooks/context-hooks.test.ts` — 13/13 pass |
| Fix needed? | **No critical fix.** By design: not all tools; `tokens` often 0 when PostToolUse omits content; fail-open; only agents that fire hooks accumulate rows |

**Out of this task:** expanding matcher to Bash/Grep/etc.; reworking token estimation; multi-project aggregation.

## Decision Tree (Phase 1 — locked)

### Root: v1 data contract

- **Resolved:** Existing `token-ledger.jsonl` via new observe API (no DB import, no all-tools hook expansion)
- **Rationale:** Ledger is documented SSOT; volume already real; observe≠control pattern matches 0243

### Branch: Default event types

- **Resolved:** All types (`session_start` | `read` | `write` | `session_end`)
- **Rationale:** True to JSONL content; type badge distinguishes; session rows explain gaps

### Branch: Live refresh

- **Resolved:** Live checkbox on → poll ~3s; off → single load
- **Rationale:** Matches Processes (0243); no file-watch SSE for v1

### Branch: Paging

- **Resolved:** Tail window `?limit=N` (default **200**, max **1000**), reverse chronological
- **Rationale:** 9.5 MB file cannot be fully loaded in browser; cursor pagination = follow-up

### Branch: Columns / empty

- **Resolved:** Core ops — Time | Type | Action | Tokens | Session | File (truncate + full path title). Missing ledger = calm empty, not hard error; unreadable path = structured error
- **Rationale:** Enough for daily ops without expandable JSON v1

### Branch: Path resolution

- **Resolved:** `{serve cwd}/.spur/context/token-ledger.jsonl`
- **Rationale:** Same project root contract as hooks when `spur serve` is started in the project

## Approaches

### Approach 1: TokenLedgerService + observe API + ToolUsingTab ⭐ Recommended

**Description:** Add `TokenLedgerService` (or `ToolUseLedgerService`) in `packages/app` that
efficiently tails the JSONL (read last N lines / reverse parse), normalizes rows, and returns a
DTO. Mount `GET /api/observability/tool-use?limit=` on the existing observability server module
(alongside processes). Append `ToolUsingTab` to `OBSERVABILITY_TABS` with Live checkbox + table.

**Trade-offs:**

- **Pros:** ADR-021 thin apps; testable tail parser with fixtures; reuses observability module mount;
  no hook/schema change; shippable against real 52k-line ledgers.
- **Cons:** Full-history browse needs later cursor; multi-agent tools still invisible until hooks expand.

**Implementation notes:**

- DTO (illustrative):
  ```ts
  {
    events: Array<{
      ts: string;
      session: string;
      type: 'session_start' | 'read' | 'write' | 'session_end';
      file?: string;
      tokens?: number;
      action?: 'create' | 'edit';
      totals?: { reads: number; writes: number; tokens: number };
    }>;
    count: number;
    limit: number;
    truncated: boolean;
    path: string;       // absolute ledger path used
    capturedAt: string;
  }
  ```
- Tail strategy: prefer reading file from end (chunked reverse read) or line buffer of last N lines;
  skip malformed lines (log count); never throw on empty/missing file → `{ events: [], truncated: false }`.
- Wire path: `join(ctx.cwd, '.spur/context/token-ledger.jsonl')`.
- Web: `ToolUsingTab.tsx` — Live default **on** or **off**? Recommend **on** when tab focused / mounted
  (same spirit as Processes poll) but checkbox allows off. Poll 3s; AbortController cancel.
- Docs: `docs/04_DESIGN.md` surface note (T3).
- Hooks: **no change** in this task unless a blocking bug is found during implement (none found).

**Confidence:** HIGH — constrained by locked decisions + 0243/0232 patterns (2026-07-12).

**Decision trace:** All Phase 1 locks.

---

### Approach 2: SSE file-watch live tail

**Description:** Same service + API, plus `fs.watch` / polling watcher on the ledger that pushes
new lines over an SSE channel; Live checkbox toggles subscription vs one-shot GET.

**Trade-offs:**

- **Pros:** Lower latency; elegant “true live.”
- **Cons:** Extra server complexity, multi-subscriber fan-out, watcher reliability on some FS;
  overkill when 3s poll is acceptable.

**Confidence:** MEDIUM — good follow-up if operators complain about poll lag.

**Decision trace:** Conflicts with Decision 3 (poll) for v1 — reject as primary.

---

### Approach 3: Client-only fetch of static ledger path

**Description:** Board fetches a static URL for the JSONL (or raw file via ad-hoc route) and parses
in the browser.

**Trade-offs:**

- **Pros:** Tiny server code.
- **Cons:** Huge payloads; no limit enforcement; path/security issues; violates app-layer logic
  placement (ADR-021).

**Confidence:** LOW — reject.

## Recommendation

**Ship Approach 1.** It completes the loop that 0232 opened (“future tool-use monitoring tool”)
with minimal risk, reuses Observability tab contract, and handles large ledgers safely.

**Explicit non-goals (v1):**

- Expanding PostToolUse to all tool names
- Fixing `tokens: 0` when agent omits `tool_response.content`
- SQLite import / system_events dual-write
- Cursor / infinite scroll deep history
- Expandable raw JSON detail rows
- Multi-project host-wide ledger merge
- SSE file watcher

**Follow-ups (separate tasks):**

1. Optional type filter chips (client or `?type=read,write`)
2. Cursor pagination for deep history
3. Hook coverage expansion (Bash/Grep/…) with redaction policy
4. Better token estimates when content missing (byte size of file on disk?)
5. SSE live tail

## Design Summary

| Item | Choice |
| --- | --- |
| Product | Observability tab **Tool Using** — read-only ledger table |
| Data | `.spur/context/token-ledger.jsonl` (project cwd) |
| API | `GET /api/observability/tool-use?limit=` on observability module |
| App layer | TokenLedgerService + efficient reverse tail |
| UI | Table + Live checkbox (poll ~3s) |
| Order | Descending by time (file append order ≈ chronological; reverse for newest first) |
| Events | All four types |
| Hooks | Unchanged (verified healthy) |
| Feature | **J** (Observabilities board module) |
| `needs_design` | **true** — new service + API + UI tab |

### Spec self-review

- No TODOs/TBDs in locked decisions
- No contradiction with 0232 ledger schema or 0243 observe plane
- Scope not expanded to all-tools hooks
- Ambiguity remaining: exact reverse-read implementation (chunk size) — implementer chooses with tests

## Next Steps

1. Operator confirms Approach 1 (or overrides).
2. Create implementation task under feature **J** with full Requirements / AC / Design / Plan / Solution skeleton.
3. Execute via `/sp:dev-run` or `sp:super-coder`.
4. Same-commit `docs/04_DESIGN.md` when implementing (T3).
