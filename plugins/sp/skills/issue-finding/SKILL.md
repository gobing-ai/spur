---
name: issue-finding
description: "Render the session forensics report, analyze agent session logs, find performance bottlenecks, propose fixes, and optionally create a structured task. Triggers: find issues, post-mortem, session review, topic focus."
license: Apache-2.0
version: 2.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: analysis-core
  interactions:
    - pipeline
    - inversion
  pipeline_steps:
    - report
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

Render the forensic report for agent session logs, identify performance bottlenecks and behavioral
anti-patterns, propose fixes, and — only with `--create-task` — create a structured task file.

**Default output is a report, not a task** (task 0556): the typed data plane
(`spur history report --mode forensics`) renders the quantitative sections; this skill authors the
interpretation on top. It codifies the forensic analysis performed after the J4 batch execution
(task 0379), reusable for any set of agent sessions.

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

| Argument                          | Description                                                                                                                                                             | Default         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `[topic]`                         | Optional free-text focus or smart positional input (see below). Narrows IDENTIFY/PROPOSE/GENERATE; the report still covers all selected sessions.                        | (full taxonomy) |
| `--sessions <glob>`               | Session JSONL file(s) or directory to analyze. When omitted, uses the most recent sessions for the resolved source + current project. Pins the raw-fallback path (below). | (most recent)   |
| `--source <name>`                 | Session log source: `auto`, `omp`, `claude`, `codex`, `gemini`, `opencode`, `antigravity`, `openclaw`, `pi`. `auto` = cwd agent when known, else `omp` if present, else first existing default root. | `auto`          |
| `--feature <id>`                  | Feature ID to link the generated task to (e.g., `H51`).                                                                                                                  | (none)          |
| `--template <name>`               | Task template: `meta` (multi-fix umbrella), `issue` (single finding), or `standard`.                                                                                     | `meta`          |
| `--priority <P0\|P1\|P2\|P3>`     | **Task** priority frontmatter (`spur task update --priority`). Not bottleneck severity.                                                                                  | `P2`            |
| `--severity <S0\|S1\|S2>`         | Minimum **bottleneck** severity to keep after ranking (S0 most severe).                                                                                                  | (all)           |
| `--category <list>`               | Comma-separated bottleneck categories to keep (see IDENTIFY table ids).                                                                                                  | `all`           |
| `--since <iso>` / `--until <iso>` | Optional wall-clock bounds on session start times (when timestamps are available).                                                                                       | (none)          |
| `--top <n>`                       | Cap the number of requirements / fixes written into the task.                                                                                                            | (no cap)        |
| `--min-cost <duration>`           | Drop bottlenecks whose estimated waste is below this floor (e.g. `30m`, `2h`). Applied after severity ranking.                                                            | (none)          |
| `--strict-topic`                  | When `[topic]` is set, drop off-topic bottlenecks even if they dominate wall time.                                                                                       | off             |
| `--agent <name>`                  | Narrow sessions to one agent/subagent executor name.                                                                                                                    | (all agents)    |
| `--create-task`                   | Opt **in** to task creation (GENERATE). Default mode stops after the report.                                                                                             | off             |
| `--json`                          | JSON findings to stdout instead of the markdown report. Composable with `--create-task`.                                                                                 | off             |

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

| Flags                  | Create task | Stdout                          |
| ---------------------- | ----------- | ------------------------------- |
| (default)              | no          | markdown report                 |
| `--json`               | no          | JSON findings (`task: null`)    |
| `--create-task`        | yes         | short summary + WBS             |
| `--create-task --json` | yes         | JSON findings with `task` block |

Without `--create-task` the run is report-only — never create a task unasked.

### Removed flags (task 0556)

| Removed flag    | Old behavior                         | Replacement                                                            |
| --------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `--use-history` | Opt in to the `spur history` bridge  | None — the typed data plane is now the default REPORT path             |
| `--no-task`     | Report to stdout, skip task creation | None — report-only is the default; pass `--create-task` to opt **in**  |

If an invocation passes either removed flag, do not swallow it as generic unknown-option noise:
reject the invocation with a message naming the replacement above.

## The 4-Phase Protocol

```
sessions (typed ETL via `spur history` — or raw JSONL under the three fallback conditions)
  → REPORT     render the forensic report: 8 CLI-derivable sections; author analysis on top
  → IDENTIFY   rank bottlenecks by time cost; filter by topic/category/severity
  → PROPOSE    design fixes for in-scope root causes; estimate time savings
  → GENERATE   create a structured task via `spur task create` (only with --create-task)
```

### Phase 1: REPORT — Data plane first

**Primary path (typed sources):** `spur history report --mode forensics` (task 0555).

```bash
# 0568 R4 / 0504 R4: SPUR_BIN env > local CLI. NEVER a bare PATH `spur` for history validation —
# a stale global binary silently runs old code. If SPUR_BIN is unset and apps/cli/src/index.ts
# is absent, FAIL LOUDLY instead of falling back to PATH.
SPUR_BIN="${SPUR_BIN:-$([ -f apps/cli/src/index.ts ] && echo 'bun apps/cli/src/index.ts' || echo '')}"
[ -n "$SPUR_BIN" ] || { echo 'REFUSING: no source-local spur and SPUR_BIN unset (0504 R4)'; exit 1; }

$SPUR_BIN history import --source <source> --json   # checkpoint resume; record provenance header
$SPUR_BIN history analyze --sessions <ids> --source <src> --json   # narrow the artifact (T2: full run → 2.7 MB trap)
$SPUR_BIN history report --mode forensics           # pure renderer; reads the LATEST artifact — verify it is the one you just wrote
```

**Artifact-size discipline:** `history analyze` without narrowing writes an artifact covering every
session in the DB — multi-MB blobs that drown the context. Narrow with `--sessions` / `--source` to
the corpus this investigation actually needs. `history report` renders whatever artifact the latest
pointer references; if you ran analyze for another purpose in between, re-run analyze (narrowed)
before reporting.

The forensics renderer emits **8 CLI-derivable sections**: Session Data Summary, Tool Breakdown,
Token Profile (tokens + cache-hit ratio — never prices), Time Decomposition, Per-Phase, Per-Tool
Execution Time, Bottleneck Ranking, and the Raw Data appendix. The CLI does not write the
interpretation: IDENTIFY and PROPOSE below author the root-cause narrative, fix design, and
acceptance criteria on top of the rendered data — that analysis is why this skill exists.

**Raw JSONL fallback — exactly three conditions** (0492 R7):

1. The resolved `--source` has **no typed mapper** in the importer.
2. The operator passed **explicit `--sessions`** — respect the pin; do not reconcile the pinned
   files against the database.
3. You need a **primitive the typed tables do not retain** (e.g. identical-command loop strings) —
   parse raw lines for just that primitive and keep the data plane for the rest.

A source with a typed mapper must **not** trigger wholesale raw parsing. If an import fails or the
DB is empty, note that aggregate data is unavailable and fall back strictly per the conditions
above.

**Fallback parser — portable signals to count** (map field names per source — see
[references/session-formats.md](references/session-formats.md)):

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
count identical commands for loop detection. Produce per-session metrics (duration, tools,
compactions, test runs, spur calls, guard failures, key finding) plus aggregate totals. Discovery
roots for the fallback path are in [references/session-formats.md](references/session-formats.md).

### Phase 2: IDENTIFY — Root Cause Ranking

**Goal:** Rank bottlenecks by estimated time cost; apply topic / category / severity filters.

**Bottleneck categories** (`--category` ids in parentheses):

| Category id       | Detection signal                                                          | Time cost estimate            |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------- |
| `test-loop`       | Same test command run 3+ times with no source edit between runs           | (identical runs − 1) × ~2 min |
| `guard`           | 3+ `spur task check` calls for the same task before pass                  | (extra checks) × ~3 min       |
| `compaction`      | Compactions > 5 per session                                               | count × ~2.5 min              |
| `section-write`   | `spur task update --section` calls per task > 1.5× the canonical section count for the task's variant/status matrix entry (feature-impl ≈ 9 sections ⇒ flag > ~13 writes/task; one write per canonical section is correct behavior, not waste) | (extra writes) × ~2 min       |
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

### Phase 3: PROPOSE — Fix Design

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

### Phase 4: GENERATE — Task File Creation

**Goal:** Create a structured task via CLI-gated corpus writes (`--create-task` only; default
mode stops after the report).

**Task creation (correct CLI — do not invent flags):**

```bash
spur task create "Fix <context> performance bottlenecks: <top issues>" \
  --template meta \
  --feature <feature-id> \
  --json
```

- Title is the **positional** argument (there is no `--name`).
- Template is space form `--template meta` (or `issue` / `standard`); never the dotted form.
- Single-finding tasks: prefer `--template issue`; multi-requirement umbrella: keep `meta`.
- Priority is **not** available on create. After create:

```bash
spur task update <wbs> --priority P2 --json
```

**Section population** — write each section body to a temp file, then:

```bash
# Body only — no same-level heading (section name is already the heading)
cat > /tmp/issue-bg.md << 'EOF'
The <context> completed with PASS verdicts, but took <X> hours — approximately Nx slower than
expected. Forensic analysis of <N> session logs identified <M> root causes...
EOF
spur task update <wbs> --section Background --from-file /tmp/issue-bg.md --json
```

**Recommended sections for a meta issue-finding task** (live matrix `.spur/tasks/section-matrix.yaml`
meta variant — `Root Cause` is allowed at every status; `Notes` and `References` are **not** defined
sections and must not be authored):

| Section             | Content                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Background          | 2–3 paragraphs: what ran, duration, why slow, root-cause count, topic filter if any                  |
| Requirements        | One `[ ] R<n>.` bullet per fix: trigger, fix, target file, measurable target                         |
| Acceptance Criteria | One Gherkin `Scenario:` per requirement with measurable thresholds                                   |
| Q&A                 | 4–6 Q&A pairs: rationale, approach, hook vs guidance, savings, decomposition                         |
| Design              | Per-fix evidence (counts, timestamps), fix content, target location                                  |
| Plan                | Ordered checkboxes referencing requirements                                                          |
| Root Cause          | RC1–RC*n* analyses with forensic evidence — allowed at every status for meta tasks                   |


**Section format rules** (from task 0379):

1. **Solution `file:line` citations**: repo-relative `file:line` (e.g. `apps/web/src/components/SupervisorTab.tsx:17-20`), never bare `:line` or bare filename without path.
2. **Review P1–P4 table**: if a Review section exists, include a table with a cell matching
   `/^\s*P[1-4]\s*$/` and a non-placeholder content cell.
3. **Meta template**: `Root Cause` is allowed at every status for meta tasks (live matrix) —
   put RC analyses there, never in `Notes` or `References` (undefined sections).
4. **Canonical sections only**: `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`,
   `Design`, `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `History`.
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

**Default:** markdown report on stdout — the 8 CLI-derivable forensics sections (when the data
plane path applies) plus the model-authored IDENTIFY/PROPOSE analysis.

**With `--create-task`:** a task file under the configured tasks folder (`docs/tasks/`,
`docs/tasks3/`, …) with WBS, optional feature link, and structured sections, plus a short summary
with the WBS.

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

With `--create-task`, include `"task": { "wbs": "…", "file": "…", "status": "…" }`; otherwise
`task` stays `null`.

## Integration

- **Session forensics report** — `spur history report --mode forensics` (primary data plane)
- **Multi-source roots / field maps** — [references/session-formats.md](references/session-formats.md)
- **Raw JSONL fallback** — only under the three conditions in Phase 1
- **`spur task create` / `update` / `check`** — CLI-gated corpus only (never direct-write task files)

## Required Permissions

| Capability      | Purpose                              |
| --------------- | ------------------------------------ |
| `Read`          | Session JSONL, skill/source files    |
| `Grep` / `Glob` | Pattern search and session discovery |
| `Bash`          | `spur history` + `spur task` CLI     |
| `Write`         | Temp files for section bodies        |

## Platform Notes

- **Claude Code** — invoke via `/sp:dev-find-issue …` or `Skill(skill="sp:issue-finding",
  args="…")`. Prefer structured tools for file discovery; parse JSONL with Read/Grep only on the
  fallback path.
- **Other platforms** (Codex / OpenClaw / OpenCode / Antigravity / Pi) — follow the 4-phase
  protocol (slash commands may be adapted at install time); prefer `rg` for large JSONL on the
  fallback path. If the agent's session root differs from the session-formats.md table, require
  `--sessions`.
- **Multi-agent reality** — packaging is portable; **forensic fidelity is source-dependent**. When
  unsure of layout, ask once for a session path or use `--sessions` rather than guessing.

## Shipped command

### `/sp:dev-find-issue`

Thin wrapper: `Skill(skill="sp:issue-finding", args="$ARGUMENTS")`.

```
/sp:dev-find-issue
/sp:dev-find-issue "test-loop spinning"
/sp:dev-find-issue --sessions "~/.omp/agent/sessions/-xprojects-spur-new/2026-07-29T*" --feature H51
/sp:dev-find-issue --category test-loop,guard
/sp:dev-find-issue --create-task "J4 batch bottlenecks" --template meta --priority P1
/sp:dev-find-issue --json --source claude --since 2026-07-28
```

## Common rationalizations

| Rationalization                              | Reality                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| "Sessions are huge — I'll sample randomly."  | Prefer signal Grep first, then deep-read hot regions. Random samples invent severity.                          |
| "I must hand-parse JSONL for everything."    | The typed data plane renders 8 sections. Raw parsing is only for the three fallback conditions.                |
| "I'll just write the task file with Write."   | Corpus writes are CLI-gated (`spur task create` / `update`). Direct Write fails the harness contract.          |
| "OMP format everywhere."                     | Only OMP is High-fidelity documented. Other sources need portable field maps + `--sessions` when roots differ. |
| "P0 severity means task priority P0."        | Severity (S0–S2) ranks waste; `--priority` is separate task frontmatter (P0–P3).                               |
| "The CLI report is the whole deliverable."    | The renderer emits data; the model-authored IDENTIFY/PROPOSE analysis makes it actionable.                     |

## Red flags

- Creating a task without `--create-task` (default mode is report-only).
- Wholesale raw JSONL parsing when the source has a typed mapper.
- Accepting `--use-history` or `--no-task` silently instead of naming their replacements.
- GENERATE recipes inventing a title flag, dotted template forms, or quoted dotted section flags.
- Claiming multi-agent forensics without stating source confidence (High/Medium/Low).
- Skipping batch section writes + single `spur task check` (when generating).
- Emitting empty findings without inventorying sessions first.

## Dogfood / self-check fixture

A tiny synthetic OMP session lives under
[examples/session-test-loop.jsonl](examples/session-test-loop.jsonl) with expected categories in
[examples/expected-findings.json](examples/expected-findings.json). Use it to smoke-check the
fallback parser without real operator logs (explicit `--sessions` is fallback condition 2):

```
/sp:dev-find-issue --sessions plugins/sp/skills/issue-finding/examples/session-test-loop.jsonl
```

Expect at least the `test-loop` category (and whatever else the expected-findings file lists).

## Reference files

- **[references/session-formats.md](references/session-formats.md)** — multi-source roots, tool-call
  field maps, OMP deep dive, history bridge
- **[examples/session-test-loop.jsonl](examples/session-test-loop.jsonl)** — synthetic OMP fixture
- **[examples/expected-findings.json](examples/expected-findings.json)** — fixture expectations
