---
name: issue-finding
description: "Analyze agent session logs, find performance bottlenecks, propose fixes, and generate a structured task file. Triggers: find issues, post-mortem, session review."
license: Apache-2.0
version: 1.0.0
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
  - sp:reverse-engineering
---

# sp:issue-finding — Session Log Issue Finder

Review agent session logs, identify performance bottlenecks and behavioral anti-patterns, propose
fixes, and generate a structured task file capturing all findings for future execution.

This skill codifies the forensic session-log analysis performed after the J4 batch execution
(task 0379), making the process reusable for any set of agent sessions.

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

| Argument | Description | Default |
|----------|-------------|---------|
| `--sessions <glob>` | Session JSONL file(s) or directory to analyze (e.g., `~/.omp/agent/sessions/-xprojects-spur-new/2026-07-29T*`). When omitted, analyzes the most recent session directory for the current project. | (most recent) |
| `--feature <id>` | Feature ID to link the generated task to (e.g., `J4`). | (none) |
| `--template <name>` | Task template for the generated issue task. `meta` (default) for multi-requirement umbrella tasks; `standard` for single-issue tasks. | `meta` |
| `--priority <P1\|P2\|P3\|P4>` | Priority of the generated task. | `P2` |
| `--no-task` | Report findings to stdout only; do not create a task file. | off |
| `--json` | Emit findings as JSON to stdout instead of creating a task. | off |

## The 5-Phase Protocol

```
sessions (JSONL logs from ~/.omp/agent/sessions/)
  → DISCOVER   locate session logs; build session inventory with timestamps
  → ANALYZE    extract metrics from each session: tool calls, compactions, test runs, guard failures
  → IDENTIFY   rank bottlenecks by time cost; find root causes with evidence
  → PROPOSE    design fixes targeting each root cause; estimate time savings
  → GENERATE   create a structured task file via `spur task create` with all findings
```

### Phase 1: DISCOVER — Session Inventory

**Goal:** Locate and catalog the session logs to analyze.

**Steps:**

1. Determine the session directory. For omp/agent sessions, the path pattern is:
   `~/.omp/agent/sessions/-<project-path-slugified>/`

2. If `--sessions <glob>` is provided, use it to select files. Otherwise:
   - List the session directory
   - Find the most recent timestamped directory (e.g., `2026-07-29T04-54-05-620Z_*`)
   - Include both the main session `.jsonl` file AND any subagent session files in the
     subdirectory (e.g., `Run0374/`, `Run0375/`, `Refine0374/`)

3. Build a session inventory table:

   | Session | File | Start Time | End Time | Duration |
   |---------|------|------------|----------|----------|
   | Main | `2026-07-29T*.jsonl` | 04:54:05 | 07:20:00 | 2.46h |
   | Run0376 | subdirectory/`Run0376_*.jsonl` | 13:01:00 | 18:28:00 | 5.45h |

4. Compute total wall time across all sessions.

### Phase 2: ANALYZE — Metric Extraction

**Goal:** Extract quantitative metrics from each session's JSONL log.

**JSONL event types and what to extract:**

| Event type | What to count | Metric |
|------------|---------------|--------|
| `message` with `toolCall` in `message.content` | Tool name, command | Tool call count per tool |
| `compaction` | Occurrence | Compaction count |
| `message` with bash `toolCall` containing `bun test` or `vitest` | Command string | Test run count |
| `message` with bash `toolCall` containing `spur` | Command string | Spur call count |
| Tool results containing `GuardDeniedError` | Transition attempted | Guard failure count + transitions |
| Tool results containing `error` or `Error` | Error message | Error count |

**Extraction approach:**

Read each JSONL file and parse line-by-line. For each `type: "message"` event:

- Check `message.content` for `toolCall` blocks (not `tool_use` — omp uses `toolCall`)
- Extract the tool name and input (especially `command` for bash calls)
- Count identical commands to detect loops (same command string repeated 3+ times)

Produce per-session metrics:

| Session | Duration | Tools | Compactions | Test runs | Spur calls | Guard failures | Key finding |
|---|---|---|---|---|---|---|---|
| Run0376 | 5.45h | 307 | 6 | 103 | 15 | 0 | Test loop: 79 identical runs |
| Main | 2.46h | 546 | 10 | 55 | 98 | 7 | L3 guard format discovery |

Aggregate across all sessions: total tool calls, total compactions, total test runs, total spur calls.

### Phase 3: IDENTIFY — Root Cause Ranking

**Goal:** Rank bottlenecks by estimated time cost and identify root causes with evidence.

**Bottleneck categories (scan for):**

| Category | Detection signal | Time cost estimate |
|-----------|-----------------|-------------------|
| Test-loop spinning | Same test command run 3+ times with no source edit between runs | (count of identical runs - 1) × ~2 min |
| Guard format discovery | 3+ `spur task check` calls for the same task before pass | (extra check calls) × ~3 min |
| Context window pressure | Compactions > 5 per session | compaction_count × ~2.5 min |
| Section write retries | `spur task update --section` calls > 2× task count | (extra writes) × ~2 min |
| Git state red herrings | `git stash`, `git branch`, `git diff` calls between test failures | ~5-20 min per incident |
| Verbose output flooding | `tail -40` on test output without filtering | per-run × ~1500 tokens |

**For each bottleneck found, record:**

1. **What happened** — concrete description with counts and timestamps from the JSONL
2. **Root cause** — why the agent behaved this way (missing guidance, missing protocol, etc.)
3. **Evidence** — exact tool call counts, timestamps, error messages from the session log
4. **Time cost** — estimated wall-time waste in hours/minutes

Rank by time cost (P0 > P1 > P2) and assign severity:

- **P0**: > 2h waste — must fix before next batch run
- **P1**: 30min–2h waste — should fix soon
- **P2**: < 30min waste — nice to fix

Also note **what worked well** — sessions or patterns that were efficient should be acknowledged
so they can be preserved and not accidentally broken.

### Phase 4: PROPOSE — Fix Design

**Goal:** Design a concrete fix for each identified root cause.

**For each bottleneck, propose:**

1. **Fix description** — what to change (documentation addition, skill reference file, pipeline
   comment, hook, etc.)
2. **Target location** — exact file path where the fix should be applied
   - Skill guidance: `skills/<skill-name>/SKILL.md` or `skills/<skill-name>/references/<name>.md`
   - Pipeline comments: `.spur/workflows/task-pipeline.yaml`
   - CLI reference: `skills/spur-cli/references/tasks/section-editing.md`
3. **Proposed content** — the actual text or code block to add
4. **Expected impact** — estimated time saved per future run
5. **Acceptance criteria** — a Gherkin scenario with measurable targets

Fixes should be **documentation/guidance changes** unless the root cause is a code bug. The harness
code (guards, pipeline, task-check) is usually working correctly — the problem is that agents don't
know the constraints until they hit them.

### Phase 5: GENERATE — Task File Creation

**Goal:** Create a structured task file via `spur task create` with all findings.

**Task creation:**

```bash
spur task create --template.meta \
  --name "Fix <context> performance bottlenecks: <top 3 issues>" \
  --priority P2 \
  --feature <feature-id> \
  --json
```

If `--feature` is not provided, link it after creation:

```bash
spur task update <wbs> --feature <feature-id>
```

**Section population** — write each section to a temp file, then apply via CLI:

```bash
# Write Background section
cat > /tmp/issue-bg.md << 'EOF'
The <context> completed all tasks with PASS verdicts, but took <X> hours — approximately Nx
slower than expected. A forensic analysis of <N> session logs identified <M> root causes...
EOF
spur task update <wbs> --section."Background" --from-file /tmp/issue-bg.md
```

**Required sections for an issue-finding task:**

| Section | Content |
|--------|---------|
| Background | 2-3 paragraphs: what was running, how long it took, why it's slow, how many root causes |
| Requirements | One `[ ] R<n>.` bullet per fix with: trigger detection, fix description, target file, measurable target |
| Acceptance Criteria | One Gherkin `Scenario:` per requirement with `Given`/`When`/`Then` steps and measurable thresholds |
| Q&A | 4-6 Q&A pairs: rationale, approach, hook vs guidance, time savings, decomposition |
| Design | Per-fix detail: problem evidence (counts, timestamps), fix content (code blocks), target location |
| Plan | Ordered execution steps with checkboxes, each referencing a requirement |
| Notes | Root cause analyses (RC1-RC<n>) with forensic evidence: tool call counts, timestamps, failure messages, cost estimates |
| References | Evidence sources: session JSONL paths, guard source code file:line, pipeline YAML, git commits |

**Section format rules** (learned from task 0379):

1. **Solution `file:line` citations**: use `filename:line` format (e.g., `SupervisorTab.tsx:17-20`),
   NOT bare `:line` — the L3 guard at `task-check.ts:404-407` checks for a filename before the colon.
2. **Review P1-P4 table**: if this task has a Review section, it MUST contain a markdown table with
   at least one row containing a cell matching `/^\s*P[1-4]\s*$/` and a non-placeholder content cell.
3. **Meta template**: does NOT allow a "Root Cause" section (L2 warning). Put root-cause analyses in
   the `Notes` section instead.
4. **Canonical sections**: only `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`,
   `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes`.
5. **Section body**: section content passed to `spur task update --section` must be body-only —
   no same-level heading (the section name is already the heading).
6. **Batch writes**: write ALL sections to temp files first, then apply with multiple
   `spur task update` calls, THEN run `spur task check` ONCE. Do not write-check-rewrite-check
   per section.

**Verification:**

```bash
spur task check <wbs>
```

Must return `pass: true` with 0 errors. Warnings are acceptable for a meta task (expected:
prose-prerequisite-unlisted if task numbers are referenced in text, uncovered-task-scenario if AC
scenarios aren't in the feature's scenario list).

## Output

**Default:** A task file in `docs/tasks3/` (or `docs/tasks/` depending on folder config) with WBS
number, linked to the specified feature, containing all findings as structured sections.

**With `--no-task`:** Findings printed to stdout as a markdown report.

**With `--json`:** Findings emitted as a JSON object:

```json
{
  "sessions": [{ "name": "...", "duration": 5.45, "tools": 307, ... }],
  "bottlenecks": [{ "id": "B1", "category": "test-loop", "severity": "P0", "timeCost": "4h", ... }],
  "fixes": [{ "id": "R1", "target": "sp:code-testing", "content": "...", "expectedSavings": "4h" }],
  "task": { "wbs": "0379", "file": "docs/tasks3/0379_...", "status": "backlog" }
}
```

## Session Log Format Reference

OMP/agent session logs are JSONL files at `~/.omp/agent/sessions/-<project>/`:

- Each line is a JSON object with a `type` field
- Key event types: `session`, `message`, `compaction`, `title`, `title_change`, `custom`
- Tool calls are inside `message.content` arrays as blocks with `type: "toolCall"` (not `tool_use`)
- Bash tool calls have `input.command` containing the shell command string
- Subagent sessions are in subdirectories (e.g., `Run0376/`, `Refine0378/`)
- Each subagent may have log files (*.log) alongside its JSONL session file
- Session start time is in the `session.timestamp` field
- Session title is in the `title.title` field (auto-generated from first user message)

**Session ID pattern:** `<ISO-timestamp>_<UUID>.jsonl` where the timestamp is the session start.

**Cross-session correlation:** Subagent sessions reference the parent session via `parentId` in
message events. Use this to trace which main-session tool call spawned each subagent.

## Integration

This skill orchestrates:

- **Session log parsing** — manual JSONL analysis (no external tool required; read files and parse)
- **`spur task create`** — CLI-gated task corpus creation (never direct-write task files)
- **`spur task update --section`** — CLI-gated section population
- **`spur task check`** — format validation before reporting done
- **`spur task update --feature`** — feature linkage

## Required Permissions

| Command | Purpose |
|---------|---------|
| `Read` | Read session JSONL files, skill files, source code |
| `Grep` | Search session logs for patterns, count occurrences |
| `Bash` | `spur task create/update/check` CLI calls |
| `Write` | Write temp files for section content |
