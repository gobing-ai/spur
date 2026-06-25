---
name: code-verification
description: Verify a task's implementation against its requirements and acceptance criteria, and review code via the SECU framework. The verifier half of the Spur execution loop — produces a PASS/PARTIAL/FAIL verdict with per-requirement evidence, writes findings back to the task file via CLI verbs, and emits the verdict artifact the pipeline gate reads. Backs the `/sp:dev-verify` (task-oriented) and `/sp:dev-review` (source-oriented) commands. Triggers on "verify task", "verify this", "check the requirements", "code review", "SECU review", "requirements traceability", "review the diff", or validating a task's delivery before `done`.
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - reviewer
    - pipeline
  modes:
    - verify
    - review
  verdicts:
    - PASS
    - PARTIAL
    - FAIL
  openclaw:
    emoji: "🔍"
---

# Spur Code Verification

The **verifier** in the Spur execution loop. A coding agent reports "done" with overconfidence;
this skill is the deterministic counterweight that proves — or disproves — the claim against the
task's own requirements and acceptance criteria, then writes the evidence back to the corpus
through CLI verbs.

It backs two commands:

| Command | Mode | Input | Output |
|---------|------|-------|--------|
| `/sp:dev-verify <wbs>` | **verify** | a task WBS | per-requirement verdict → `## Testing`; SECU findings → `## Review`; `.spur/run/<wbs>-verdict.json` |
| `/sp:dev-review <wbs>` | **review** | a task WBS (diff scope) | SECU findings → `## Review` |

The verify mode is the **completion gate's evidence source**: it emits a machine verdict the
`task-pipeline.yaml` workflow reads before allowing `record → done`. A `PASS` clears the gate; a
`PARTIAL`/`FAIL` blocks it. This is what makes "done" mean *verified*, not *self-reported*.

## Why this skill exists (the gap it closes)

`spur task check` validates section **presence**, not content — it passes a hollow `## Testing`
heading. So presence-checking alone lets an agent march a task to `done` with empty evidence and an
implementation that doesn't match its AC. This skill supplies the missing **content** verdict:
it reads the requirements, maps each to implementation evidence, and refuses to certify what isn't
there. The verdict artifact carries that signal to the pipeline gate (design §B).

## Cross-cutting rules (inherited from sp:spur-dev)

- **Every task write goes through a CLI verb.** Findings land via
  `spur task update <wbs> --section <name> --from-file <tmp>` — never a direct file write. This is
  the only sanctioned path for generated content into the corpus.
- **The verdict artifact is the contract.** `.spur/run/<wbs>-verdict.json` is the machine signal
  the workflow guard reads. Always write it last, after the verdict is final.
- **Adapt to `spur task` verbs.** Use `spur task show <wbs> --json` / `spur task update` — never any
  legacy `tasks` CLI.

---

## Mode: verify (`/sp:dev-verify`)

The task-oriented path: prove the implementation satisfies the task's requirements + AC.

### Step 1 — Load the task and parse flags

```bash
spur task show <wbs> --json
```

The JSON carries `{ wbs, name, status, filePath, content, frontmatter }`. Parse from `content`:

- `## Requirements` — the R-items (the traceability targets).
- `## Acceptance Criteria` — the Gherkin scenarios (the BDD targets, if `--bdd`).

Flags: `--auto` (no confirmations), `--force` (bypass the terminal-status guard), `--fix
<none|blockers-first|all>` (post-verdict repair), `--focus <all|security|efficiency|correctness|usability>`
(SECU dimensions), `--bdd` (scenario check), `--next` (on PASS, auto-transition `testing → done`;
on PARTIAL/FAIL, stop).

### Step 2 — Status guard

If the task status is terminal (`done`, `cancelled`) **and** `--force` is not set, log the skip and
exit 0 (a deliberate non-error skip — re-verifying a `done` task without intent wastes tokens). With
`--force`, proceed regardless. (Under the pipeline the task is at `wip`/`testing`, so the guard is a
no-op there; `--force` matters for re-auditing completed tasks.)

### Step 3 — Establish the change scope

Determine which files the task changed (the evidence surface):

```bash
TASK_FILE=$(spur task show <wbs> --json | jq -r .filePath)
COMMIT=$(git log -1 --format=%H -- "$TASK_FILE")
git diff --name-only "${COMMIT}~1"..HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx'
# Fallback when the task file is uncommitted: use the working-tree diff.
git status --porcelain
```

### Step 4 — Requirements traceability (Phase 8)

For each `R{n}` in `## Requirements`, find implementation evidence in the changed files / tests and
assign a per-requirement status:

| Per-requirement status | Condition |
|------------------------|-----------|
| **MET** | Concrete evidence (code + test) for the requirement exists in scope |
| **PARTIAL** | Evidence for part of the requirement only |
| **UNMET** | No implementation evidence found |

Record the evidence string (`file:line` or test name) per requirement — this is what lands in
`## Testing`.

### Step 5 — SECU review (Phase 7)

Review the changed code across the `--focus` dimensions (default all): **S**ecurity (secrets,
injection, unsafe input), **E**fficiency, **C**orrectness (null/edge handling, logic), **U**sability
(API clarity, error messages). Rank findings by severity (blocker / major / minor). See
[references/secu-review.md](references/secu-review.md).

### Step 6 — BDD scenario check (if `--bdd`)

Map each `## Acceptance Criteria` scenario to a passing/failing test. Passed scenario → MET; failed
→ UNMET; no covering test → PARTIAL. Fold into the per-requirement verdict.

### Step 7 — Aggregate the verdict

```
any requirement UNMET            → FAIL
any requirement PARTIAL (no UNMET) → PARTIAL
all requirements MET             → PASS
```

Only `PASS` clears the pipeline completion gate. (`PARTIAL`/`FAIL` route the pipeline to `failed`.)

### Step 8 — Write findings to the task

Assemble the evidence and write via CLI verbs (temp-file → `--section`):

```bash
# Testing section: per-requirement verdict table + evidence
printf '...' > /tmp/<wbs>-testing.md
spur task update <wbs> --section Testing --from-file /tmp/<wbs>-testing.md

# Review section: SECU findings ranked by severity
printf '...' > /tmp/<wbs>-review.md
spur task update <wbs> --section Review --from-file /tmp/<wbs>-review.md
```

### Step 9 — State the verdict (the gate contract)

End the verify output with an explicit, parseable verdict line so the pipeline can
transport it deterministically:

```
Verdict: PASS    (or PARTIAL / FAIL)
```

**Under the pipeline**, the `verify` step captures this answer to
`.spur/run/<wbs>-verify-answer.txt` (via `agent.run answerFile`), and a deterministic
shell step derives the gate artifact `.spur/run/<wbs>-verdict.json` from it **plus** an
independent `spur task check` — so the artifact is never left to the agent's discretion

### Step 8b — Handoff to record (pipeline context)

Under the pipeline (`task-pipeline.yaml`), the verify agent's output is captured to
`.spur/run/<wbs>-verify-answer.txt` (via `agent.run answerFile`). The **record** step
then transcribes this output into the task's `## Testing` and `## Review` sections:

- **Testing** ← verdict from `.spur/run/<wbs>-verdict.json` + per-requirement table
  from the answer file
- **Review** ← SECU findings (P1–P4) extracted from the answer file

The verify agent's output MUST include a per-requirement traceability table
(`| Req | Status | Evidence |`) and a `### SECU Review` heading with ranked findings
so the record step can extract them mechanically. The verdict artifact
(`.spur/run/<wbs>-verdict.json`) is the gate signal; the answer file is the evidence
the record step transcribes — keep both structures stable.

(R9; the agent reporting PASS in prose is necessary but not sufficient).
**Standalone** (`/sp:dev-verify` outside the pipeline), write the artifact yourself:

```bash
mkdir -p .spur/run
jq -n --arg wbs "<wbs>" --arg v "<PASS|PARTIAL|FAIL>" \
  '{wbs:$wbs, verdict:$v, requirements:[...], checks:[...]}' \
  > .spur/run/<wbs>-verdict.json
```

Shape ([references/verdict-schema.md](references/verdict-schema.md)):

```typescript
interface VerifyVerdict {
  wbs: string;
  verdict: 'PASS' | 'PARTIAL' | 'FAIL';
  requirements: Array<{ id: string; status: 'MET' | 'PARTIAL' | 'UNMET'; evidence: string }>;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; evidence: string }>;
}
```

### Step 10 — Fix pass (if `--fix` ≠ `none`)

- `blockers-first` — repair only requirements that are UNMET (the blockers), then re-run Steps 4–9.
- `all` — repair UNMET + PARTIAL requirements and major SECU findings, then re-run Steps 4–9.
- `none` — stop at the verdict; report and exit.

Loop is bounded — if a fix doesn't move a requirement to MET after one retry, report the residual
and stop (don't thrash).

### Step 11 — Report

Show the verdict, the per-requirement table, and the gate outcome (cleared / blocked). Under the
pipeline this is consumed by the gate; for a direct `/sp:dev-verify` invocation it's the operator's
summary.

---

## Mode: review (`/sp:dev-review`)

The source-oriented path: SECU review of a task's diff without the full traceability verdict. Runs
Steps 3 + 5 + 8 (Review section only) — no verdict artifact, no `done` gate. Use for a focused
quality/security audit of changes when the full verify isn't wanted.

---

## When to use

- **Verify a task before `done`** — the pipeline's `verify` step, or a manual `/sp:dev-verify`.
- **Audit completed work** — `--force` re-verifies a `done` task (compliance, post-merge).
- **Focused code review** — `/sp:dev-review` for SECU findings on a diff.

Do **not** use this skill for:

- Driving the pipeline — that's `/sp:dev-run` → `sp:spur-dev` (execution half).
- Running tests / coverage — that's `/sp:dev-unit`.
- Constraint-rule gating — that's `sp:spur-rules` (deterministic, complementary).

---

## Gotchas

1. **Presence ≠ content.** `spur task check` passing is **not** a PASS verdict. This skill is the
   content gate; never conflate the two.
2. **Write the verdict artifact last.** The workflow guard reads it; a stale/partial file fails the
   gate misleadingly. Emit it only after the verdict is final (Step 9).
3. **Never direct-write the task file.** All findings go through `spur task update --section`.
4. **`PASS` is the only clear.** `PARTIAL` blocks the gate — there is no "good enough" pass.
5. **Bounded fix loop.** `--fix` retries once per requirement, then reports residuals — don't loop
   forever chasing a stubborn UNMET.

---

## Additional Resources

- [references/verdict-schema.md](references/verdict-schema.md) — the `VerifyVerdict` artifact shape
  and the per-requirement aggregation rule.
- [references/secu-review.md](references/secu-review.md) — the SECU dimensions and finding-severity
  rubric.
- `config/workflows/task-pipeline.yaml` — the `verify → record` gate that consumes the verdict.
- **`sp:spur-dev`** — the execution-half umbrella that drives the pipeline this skill gates.

---

## Platform Notes

### Claude Code

`spur` CLI via the Bash tool. Invoke via the `/sp:dev-verify` / `/sp:dev-review` commands, or
directly: `Skill(skill="sp:code-verification", args="verify <wbs> --fix all")`.

### Codex / OpenClaw / OpenCode / Antigravity

Run `spur` CLI via Bash; parse `--json`. Invoke this skill directly for the verification logic — the
skill is the SSOT; the commands are thin wrappers.

---

**Template type**: technique
**Purpose**: Verify a task against its requirements with a PASS/PARTIAL/FAIL verdict, write findings to the corpus via CLI verbs, and emit the verdict artifact the execution pipeline's completion gate consumes.
