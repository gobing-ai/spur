---
name: issue-finding
description: "Analyze agent session logs, find performance bottlenecks, propose fixes, and generate a structured task file. Triggers: find issues, post-mortem, session review, topic focus."
license: Apache-2.0
version: 1.1.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: analysis-core
  interactions:
    - pipeline
    - inversion
  pipeline_steps:
    - discover
    - analyze
    - identify
    - propose
    - generate
  openclaw:
    emoji: "🛡"
see_also:
  - sp:dogfood-testing
  - sp:spur-cli
  - sp:code-testing
  - sp:sys-debugging
  - sp:spur-dev
  - sp:daily-summary
  - sp:reverse-engineering
---

# sp:issue-finding — Session Log Issue Finder

Review agent session logs, identify performance bottlenecks and behavioral anti-patterns, propose
fixes, and generate a structured task file capturing findings for future execution.

This skill codifies the forensic session-log analysis performed after the J4 batch execution
(task 0379), making the process reusable for any set of agent sessions.

**Honesty contract:** install-time skill packaging works on all declared platforms. **Native
session forensics depth varies by agent** — OMP is the deepest documented adapter; other sources
are best-effort path discovery + format notes. Prefer `--sessions` when the default root is wrong.
See [references/session-formats.md](references/session-formats.md).

## When to Use

**Trigger phrases:** "find issues", "performance analysis", "session log review", "identify
bottlenecks", "post-mortem", "what went wrong", "why was this slow"

**Use PROACTIVELY after:**

- A batch task execution (`/sp:dev-runall`) that took longer than expected
- A pipeline run with excessive compactions, test runs, or guard failures
- Any agent session where the operator suspects inefficiency or waste

**Do NOT use for:**

- Debugging a specific runtime failure — use `sp:sys-debugging`
- Code review — use `sp:code-review` or `sp:code-verification`
- Daily activity reporting — use `sp:daily-summary`
- Implementing the fixes found — this skill only creates the task; use `/sp:dev-run` to execute it

## Arguments

| Argument                          | Description                                                                                                                                                                                          | Default         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `[topic]`                         | Optional free-text focus or smart positional input (see below). Narrows IDENTIFY/PROPOSE/GENERATE; DISCOVER still inventories selected sessions.                                                     | (full taxonomy) |
| `--sessions <glob>`               | Session JSONL file(s) or directory to analyze. When omitted, uses the most recent sessions for the resolved source + current project.                                                                | (most recent)   |
| `--source <name>`                 | Session log source: `auto`, `omp`, `claude`, `codex`, `gemini`, `opencode`, `antigravity`, `openclaw`, `pi`. `auto` = cwd agent when known, else `omp` if present, else first existing default root. | `auto`          |
| `--feature <id>`                  | Feature ID to link the generated task to (e.g., `H51`).                                                                                                                                              | (none)          |
| `--template <name>`               | Task template: `meta` (multi-fix umbrella), `issue` (single finding), or `standard`.                                                                                                                 | `meta`          |
| `--priority <P0\|P1\|P2\|P3>`     | **Task** priority frontmatter (`spur task update --priority`). Not bottleneck severity.                                                                                                              | `P2`            |
| `--severity <S0\|S1\|S2>`         | Minimum **bottleneck** severity to keep after ranking (S0 most severe).                                                                                                                              | (all)           |
| `--category <list>`               | Comma-separated bottleneck categories to keep (see IDENTIFY table ids).                                                                                                                              | `all`           |
| `--since <iso>` / `--until <iso>` | Optional wall-clock bounds on session start times (when timestamps are available).                                                                                                                   | (none)          |
| `--top <n>`                       | Cap the number of requirements / fixes written into the task.                                                                                                                                        | (no cap)        |
| `--min-cost <duration>`           | Drop bottlenecks whose estimated waste is below this floor (e.g. `30m`, `2h`). Applied after severity ranking.                                                                                       | (none)          |
| `--strict-topic`                  | When `[topic]` is set, drop off-topic bottlenecks even if they dominate wall time.                                                                                                                   | off             |
| `--use-history`                   | Optionally import/analyze via `spur history` for token/cost aggregates; raw JSONL remains authoritative for tool-loop forensics.                                                                     | off             |
| `--no-task`                       | Markdown report to stdout only; do not create a task.                                                                                                                                                | off             |
| `--json`                          | JSON findings to stdout only; do not create a task. Mutually exclusive with default task creation.                                                                                                   | off             |

### Smart positional `[topic]`

| Input pattern                                                                   | Detection        | Behavior                                                                                               |
| ------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| Ends with `.jsonl`, or looks like a session path/glob (`~/.`, `sessions/`, `*`) | Session selector | Treat as `--sessions` (do not also require free-text topic)                                            |
| Matches a known category id or phrase (`test-loop`, `guard`, `compaction`, …)   | Category hint    | Apply as `--category` filter (merge with explicit flag if both set)                                    |
| Mentions a feature id pattern (`J4`, `H51`, …) or task WBS digits               | Work-unit hint   | Prefer sessions/subagents whose titles/paths correlate; still allow full inventory                     |
| Other plain text                                                                | Focus criteria   | Filter/re-rank IDENTIFY + PROPOSE to issues matching the text (e.g. `"test-loop spinning on Run0376"`) |
| Empty                                                                           | Full scan        | Current default: all categories, all severities                                                        |

### Severity vs priority (do not conflate)

| Scale                   | Values     | Meaning                                      | Where it appears                            |
| ----------------------- | ---------- | -------------------------------------------- | ------------------------------------------- |
| **Bottleneck severity** | S0, S1, S2 | Estimated waste of the _finding_             | IDENTIFY ranking, JSON `severity`, Notes    |
| **Task priority**       | P0–P3      | Frontmatter priority of the _generated task_ | `--priority`, `spur task update --priority` |

Severity thresholds:

- **S0**: > 2h waste — must fix before next batch run
- **S1**: 30min–2h waste — should fix soon
- **S2**: < 30min waste — nice to fix

### Output mode matrix

| Flags                  | Create task | Stdout                |
| ---------------------- | ----------- | --------------------- |
| (default)              | yes         | short summary + WBS   |
| `--no-task`            | no          | markdown report       |
| `--json`               | no          | JSON only             |
| `--no-task` + `--json` | no          | JSON only (json wins) |

Never invent a dual-write mode: either create a task **or** emit a report/JSON, not both.

## The 5-Phase Protocol

```
sessions (JSONL — source-dependent roots; see session-formats.md)
  → DISCOVER   locate session logs; build session inventory with timestamps
  → ANALYZE    extract metrics: tool calls, compactions, test runs, guard failures
  → IDENTIFY   rank bottlenecks by time cost; filter by topic/category/severity
  → PROPOSE    design fixes for in-scope root causes; estimate time savings
  → GENERATE   create a structured task via `spur task create` (unless --no-task/--json)
```

### Phase 1: DISCOVER — Session Inventory

**Goal:** Locate and catalog the session logs to analyze.

**Steps:**

1. Resolve `--source` (or `auto`) and default roots from
   [references/session-formats.md](references/session-formats.md).
2. If `[topic]` or `--sessions` already selects paths, use those files.
3. Otherwise list the source root for the current project slug and take the most recent
   timestamped session set (include subagent session files when the layout has them).
4. Apply `--since` / `--until` when session start timestamps are available.
5. Build a session inventory table:

   | Session | File                        | Start Time | End Time | Duration |
   | ------- | --------------------------- | ---------- | -------- | -------- |
   | Main    | `…/*.jsonl`                 | …          | …        | …        |
   | Run0376 | subdirectory / subagent log | …          | …        | …        |

6. Compute total wall time across all sessions. State the resolved source and confidence
   (High = known adapter + readable tool events; Medium = path found, format partial;
   Low = operator-supplied paths only).

### Phase 2: ANALYZE — Metric Extraction

**Goal:** Extract quantitative metrics from each session's JSONL log.

**Portable signals to count** (map field names per source — see session-formats.md):

| Signal                                                                | Metric                           |
| --------------------------------------------------------------------- | -------------------------------- |
| Tool/function calls                                                   | Tool call count per tool name    |
| Context compaction / summarize events                                 | Compaction count                 |
| Bash/shell runs matching `bun test` / `vitest` / `pytest` / `go test` | Test run count                   |
| Bash/shell runs containing `spur`                                     | Spur call count                  |
| Tool results mentioning `GuardDeniedError`                            | Guard failure count + transition |
| Tool results with `error` / `Error`                                   | Error count                      |
| Identical command string repeated 3+ times                            | Loop candidate                   |

**Extraction approach:** read each JSONL file line-by-line; parse tool name + command inputs;
count identical commands for loop detection.

Produce per-session metrics (duration, tools, compactions, test runs, spur calls, guard failures,
key finding). Aggregate totals across sessions.

When `--use-history` is set, the **selected-file history bridge** supplies ETL aggregates for the
frozen session set (task 0507 R3):

1. **Freeze Phase 1's selected OMP JSONL files once** — the same inventory the raw analysis reads.
   Discovery roots: the normal OMP session root (`~/.omp/agent/sessions/`) **and**
   `.spur/run/<run-id>/agent-sessions/<omp-executor>/*.jsonl` for workflow subprocess sessions.
   Never import a broad `.spur/run` scan and never run a full/source-root reconciliation here.
2. **Import each frozen file once, through the source-local CLI**, with single-file `force-file`
   mode:
   `bun run apps/cli/src/index.ts history import --source omp --file <absolute-file> --mode force-file --json`.
   The importer derives the session key from the filename; use the same stem for analysis.
3. **Analyze scoped to that key**: `history analyze --session <filename-stem> --json`.
4. Use the artifact for the aggregates ETL can represent — tokens, cost, messages, tool calls,
   loops, and assistant response duration. **Continue parsing the same raw files** for command text,
   compactions, test/guard retries, tool execution duration/status/errors, and every other signal
   the ETL does not carry.

ETL supplies normalized aggregates; it is **not** a substitute for raw tool-loop evidence. If an
import fails or the DB is empty, continue with raw logs and note that cost data is unavailable.
Before any ad-hoc verification SQL against `history_*` tables, follow the schema-first rule in
[references/session-formats.md](references/session-formats.md) — inspect the live schema once.

### Phase 3: IDENTIFY — Root Cause Ranking

**Goal:** Rank bottlenecks by estimated time cost; apply topic / category / severity filters.

**Bottleneck categories** (`--category` ids in parentheses):

| Category id       | Detection signal                                                          | Time cost estimate            |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------- |
| `test-loop`       | Same test command run 3+ times with no source edit between runs           | (identical runs − 1) × ~2 min |
| `guard`           | 3+ `spur task check` calls for the same task before pass                  | (extra checks) × ~3 min       |
| `compaction`      | Compactions > 5 per session                                               | count × ~2.5 min              |
| `section-write`   | `spur task update --section` calls > 2× task count                        | (extra writes) × ~2 min       |
| `git-red-herring` | `git stash` / `git branch` / `git diff` between test failures             | ~5–20 min per incident        |
| `verbose-output`  | Unfiltered test output flooding (e.g. bare `tail` without failure filter) | per-run × ~1500 tokens        |

**For each bottleneck found, record:**

1. **What happened** — counts and timestamps from the log
2. **Root cause** — missing guidance, missing protocol, etc.
3. **Evidence** — tool call counts, timestamps, error messages
4. **Time cost** — estimated wall-time waste
5. **Severity** — S0 / S1 / S2 from thresholds above

**Topic filtering:**

- With `[topic]` and without `--strict-topic`: keep matching bottlenecks; also keep non-matching
  S0 findings (dominant wall-time waste) and annotate them as out-of-topic but severe.
- With `--strict-topic`: keep only topic-matching findings (after category/severity filters).
- Apply `--category`, `--severity`, `--min-cost`, and `--top` after ranking (in that order).

Also note **what worked well** so efficient patterns are preserved.

### Phase 4: PROPOSE — Fix Design

**Goal:** Design a concrete fix for each **in-scope** root cause.

**For each bottleneck, propose:**

1. **Fix description** — documentation, skill reference, pipeline comment, hook, etc.
2. **Target location** — exact file path
   - Skill guidance: `skills/<skill-name>/SKILL.md` or `references/<name>.md`
   - Pipeline comments: runtime workflow under `.spur/workflows/` (e.g. `task-pipeline.yaml`)
   - CLI reference: `skills/spur-cli/references/tasks/…`
3. **Proposed content** — text or code block to add
4. **Expected impact** — estimated time saved per future run
5. **Acceptance criteria** — Gherkin scenario with measurable targets

Prefer **documentation/guidance** fixes unless the root cause is a code bug. Harness guards are
often correct — agents lack discoverable constraints until they hit them.

When the same anti-pattern appears across **≥2 independent sessions** (or the operator asks to
codify it), offer a handoff to **`/sp:rule-scan`** / rule authoring after GENERATE — do not invent
rules inside this skill.

### Phase 5: GENERATE — Task File Creation

**Goal:** Create a structured task via CLI-gated corpus writes (unless `--no-task` / `--json`).

**Task creation (correct CLI — do not invent flags):**

```bash
spur task create "Fix <context> performance bottlenecks: <top issues>" \
  --template meta \
  --feature <feature-id> \
  --json
```

Notes:

- Title is the **positional** argument (there is no `--name`).
- Template is space form `--template meta` (or `issue` / `standard`); never the dotted form.
- Priority is **not** available on create. After create:

```bash
spur task update <wbs> --priority P2 --json
```

- If `--feature` was omitted at create time and the operator later supplies one:

```bash
spur task update <wbs> --feature <feature-id> --json
```

- Single-finding tasks: prefer `--template issue` (aligned with `sp:sys-debugging`).
- Multi-requirement umbrella: keep `--template meta` (default).

**Section population** — write each section body to a temp file, then:

```bash
# Body only — no same-level heading (section name is already the heading)
cat > /tmp/issue-bg.md << 'EOF'
The <context> completed with PASS verdicts, but took <X> hours — approximately Nx slower than
expected. Forensic analysis of <N> session logs identified <M> root causes...
EOF
spur task update <wbs> --section Background --from-file /tmp/issue-bg.md --json
```

**Required sections for a meta issue-finding task:**

| Section             | Content                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Background          | 2–3 paragraphs: what ran, duration, why slow, root-cause count, topic filter if any                  |
| Requirements        | One `[ ] R<n>.` bullet per fix: trigger, fix, target file, measurable target                         |
| Acceptance Criteria | One Gherkin `Scenario:` per requirement with measurable thresholds                                   |
| Q&A                 | 4–6 Q&A pairs: rationale, approach, hook vs guidance, savings, decomposition                         |
| Design              | Per-fix evidence (counts, timestamps), fix content, target location                                  |
| Plan                | Ordered checkboxes referencing requirements                                                          |
| Notes               | Root-cause analyses (RC1–RC*n*) with forensic evidence (meta template: **not** a Root Cause section) |
| References          | Session JSONL paths, source/agent, guard `file:line`, pipeline YAML, commits                         |

**Section format rules** (from task 0379):

1. **Solution `file:line` citations**: repo-relative `file:line` (e.g. `apps/web/src/components/SupervisorTab.tsx:17-20`), never bare `:line` or bare filename without path.
2. **Review P1–P4 table**: if a Review section exists, include a markdown table with a cell matching
   `/^\s*P[1-4]\s*$/` and a non-placeholder content cell.
3. **Meta template**: no `Root Cause` section — put analyses in `Notes`.
4. **Canonical sections only**: `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`,
   `Design`, `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes`.
5. **Section body**: body-only for `--section` (no duplicate heading).
6. **Batch writes**: write all section temps → apply all `spur task update --section` calls →
   **one** `spur task check`. Never write-check-rewrite-check per section.

**Verification:**

```bash
spur task check <wbs> --json
```

Must return `pass: true` with 0 errors. Warnings may be acceptable on meta tasks
(e.g. `prose-prerequisite-unlisted`, `uncovered-task-scenario`).

## Output

**Default:** A task file under the configured tasks folder (`docs/tasks/`, `docs/tasks3/`, …) with
WBS, optional feature link, and structured sections.

**With `--no-task`:** Markdown findings report on stdout.

**With `--json`:**

```json
{
  "source": "omp",
  "topic": "test-loop spinning",
  "sessions": [{ "name": "...", "duration": 5.45, "tools": 307 }],
  "bottlenecks": [
    { "id": "B1", "category": "test-loop", "severity": "S0", "timeCost": "4h" }
  ],
  "fixes": [
    {
      "id": "R1",
      "target": "sp:code-testing",
      "content": "...",
      "expectedSavings": "4h"
    }
  ],
  "task": null
}
```

When a task was created (default mode), include `"task": { "wbs": "…", "file": "…", "status": "…" }`
in the short summary; JSON-only mode leaves `task` null.

## Integration

- **Session log parsing** — manual JSONL analysis (no required external analyzer script)
- **Multi-source roots / field maps** — [references/session-formats.md](references/session-formats.md)
- **Optional** `spur history import` / `analyze` when `--use-history`
- **`spur task create` / `update` / `check`** — CLI-gated corpus only (never direct-write task files)

## Required Permissions

| Capability      | Purpose                               |
| --------------- | ------------------------------------- |
| `Read`          | Session JSONL, skill/source files     |
| `Grep` / `Glob` | Pattern search and session discovery  |
| `Bash`          | `spur task` / optional `spur history` |
| `Write`         | Temp files for section bodies         |

## Platform Notes

### Claude Code

- Invoke via `/sp:dev-find-issue …` or `Skill(skill="sp:issue-finding", args="…")`.
- Prefer structured tools for file discovery; parse JSONL with Read/Grep.

### Codex / OpenClaw / OpenCode / Antigravity / Pi

- Read this skill and follow the 5-phase protocol (slash commands may be adapted at install time).
- Prefer `rg` for scanning large JSONL; expand globs carefully.
- If the agent’s session root differs from the table in session-formats.md, require `--sessions`.

### Multi-agent reality

- Packaging is portable; **forensic fidelity is source-dependent**.
- When unsure of layout, ask once for a session path or use `--sessions` rather than guessing.

## Shipped command

### `/sp:dev-find-issue`

Thin wrapper: `Skill(skill="sp:issue-finding", args="$ARGUMENTS")`.

```
/sp:dev-find-issue
/sp:dev-find-issue "test-loop spinning"
/sp:dev-find-issue --sessions "~/.omp/agent/sessions/-xprojects-spur-new/2026-07-29T*" --feature H51
/sp:dev-find-issue "L3 guard format discovery" --source omp --severity S1 --priority P1
/sp:dev-find-issue --category test-loop,guard --no-task
/sp:dev-find-issue --json --source claude --since 2026-07-28
```

## Common rationalizations

| Rationalization                             | Reality                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| "Sessions are huge — I'll sample randomly." | Prefer signal Grep first, then deep-read hot regions. Random samples invent severity.                          |
| "I'll just write the task file with Write." | Corpus writes are CLI-gated (`spur task create` / `update`). Direct Write fails the harness contract.          |
| "OMP format everywhere."                    | Only OMP is High-fidelity documented. Other sources need portable field maps + `--sessions` when roots differ. |
| "P0 severity means task priority P0."       | Severity (S0–S2) ranks waste; `--priority` is separate task frontmatter (P0–P3).                               |
| "History import replaces JSONL forensics."  | History gives token/cost aggregates; tool-loop loops still need raw session lines.                             |

## Red flags

- GENERATE recipes inventing a title flag, dotted template forms, or quoted dotted section flags.
- Claiming multi-agent forensics without stating source confidence (High/Medium/Low).
- Creating a task when `--no-task` or `--json` was requested.
- Skipping batch section writes + single `spur task check`.
- Emitting empty findings without inventorying sessions first.

## Dogfood / self-check fixture

A tiny synthetic OMP session lives under
[examples/session-test-loop.jsonl](examples/session-test-loop.jsonl) with expected categories in
[examples/expected-findings.json](examples/expected-findings.json). Use it to smoke-check IDENTIFY
without real operator logs:

```
/sp:dev-find-issue --sessions plugins/sp/skills/issue-finding/examples/session-test-loop.jsonl --no-task
```

Expect at least the `test-loop` category (and whatever else the expected-findings file lists).

## Reference files

- **[references/session-formats.md](references/session-formats.md)** — multi-source roots, tool-call
  field maps, OMP deep dive, history bridge
- **[examples/session-test-loop.jsonl](examples/session-test-loop.jsonl)** — synthetic OMP fixture
- **[examples/expected-findings.json](examples/expected-findings.json)** — fixture expectations
