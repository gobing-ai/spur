---
name: code-verification
description: Verify a task's implementation against its requirements and acceptance criteria, and review code via the SECUA framework. The verifier half of the Spur execution loop — produces a PASS/PARTIAL/FAIL verdict with per-requirement evidence, writes findings back to the task file via CLI verbs, and emits the verdict artifact the pipeline gate reads. Backs the `/sp:dev-verify` (task-oriented) and `/sp:dev-review` (source-oriented) commands. Triggers on "verify task", "verify this", "check the requirements", "code review", "SECUA review", "SECU review", "requirements traceability", "review the diff", or validating a task's delivery before `done`.
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
task's own requirements and Acceptance Criteria, then writes the evidence back to the corpus
through CLI verbs.

It backs two commands:

| Command | Mode | Input | Output |
|---------|------|-------|--------|
| `/sp:dev-verify <wbs>` | **verify** | a task WBS | per-requirement verdict → `## Testing`; SECUA findings → `## Review`; `.spur/run/<wbs>-verdict.json` |
| `/sp:dev-review <wbs>` | **review** | a task WBS (diff scope) | SECUA findings → `## Review` |

The verify mode is the **completion gate's evidence source**: it emits a machine verdict the
`task-pipeline.yaml` workflow reads before allowing `record → done`. A `PASS` clears the gate; a
`PARTIAL`/`FAIL` blocks it. This is what makes "done" mean *verified*, not *self-reported*.

## Why this skill exists (the gap it closes)

`spur task check` validates section **presence**, not content — it passes a hollow `## Testing`
heading. So presence-checking alone lets an agent march a task to `done` with empty evidence and an
implementation that doesn't match its AC. This skill supplies the missing **content** verdict:
it reads requirements and AC, maps each to evidence, and refuses to certify what isn't there. The
verdict artifact carries that signal to the pipeline gate (design §B).

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
- `## Acceptance Criteria` / `### Acceptance Criteria` — checklist items and Gherkin scenarios (the
  AC targets). AC evaluation is mandatory when this section is non-empty; `--bdd` only tightens the
  scenario-to-test requirement.

Flags: `--agent <name|auto>` (agent override — passed through from the thin wrapper;
`auto` = resolve from current runtime, `<name>` = explicit override; omit to use the configured
default executor `omp` — "current agent" is not expressible on the pipeline surface),
`--auto` (no confirmations), `--force` (bypass the terminal-status guard), `--fix
<none|blockers-first|all>` (post-verdict repair), `--focus <all|security|efficiency|correctness|usability|architecture>`
(SECUA dimensions), `--bdd` (strict Gherkin scenario-to-test check), `--next` (on PASS,
auto-transition `testing → done`; on PARTIAL/FAIL, stop).

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

### Step 4 — Requirements traceability gate (Phase 8)

For each `R{n}` in `## Requirements`, find implementation evidence in the changed files / tests and
assign a per-requirement status:

| Per-requirement status | Condition |
|------------------------|-----------|
| **MET** | Concrete evidence (code + test) for the requirement exists in scope |
| **PARTIAL** | Evidence for part of the requirement only |
| **UNMET** | No implementation evidence found |

Record the evidence string (`file:line`, command, or test name) per requirement — this is what lands
in `## Testing`.

### Step 5 — Acceptance Criteria guard

If the task has a non-empty Acceptance Criteria section, evaluate every checklist item and every
Gherkin scenario independently. This gate runs whether or not `--bdd` is set.

| Per-AC status | Condition |
|---------------|-----------|
| **MET** | The AC is satisfied by concrete evidence |
| **PARTIAL** | Some evidence exists, but a material condition is missing or only inferred |
| **UNMET** | No implementation evidence satisfies the AC, or a required scenario fails |
| **N/A** | The AC is explicitly non-applicable with a concrete reason |

Evidence is typed so weak proof is visible:

| Evidence type | Use when |
|---------------|----------|
| `test` | A named automated test or invariant test proves the behavior |
| `command` | A CLI/gate command output proves the behavior |
| `static-ref` | Source/doc/config references prove a contract or structural invariant |
| `manual-review` | Reviewer reasoning is needed, with cited files and rationale |
| `llm-judge` | Qualitative judgment only; advisory unless the AC is inherently qualitative |
| `n/a` | The AC does not apply; must include the reason |

Objective AC cannot be cleared by `llm-judge` alone. Pair qualitative judgment with deterministic or
static evidence, or mark the row `PARTIAL`.

Every **CORE behavior-bearing** AC must include at least one `test` or `command` evidence row. A
`MET` behavior AC with only `static-ref`, `manual-review`, or `llm-judge` evidence is downgraded to
`PARTIAL` by `spur task verdict` and surfaces an `evidence-rule-failed` check. AC rows are treated as
core and behavior-bearing by default; add `[advisory]`, `[non-core]`, `[non-behavior]`, or
`[docs-only]` in the AC id only when that weaker rule is intentional and reviewable.

When the diff touches `apps/cli/**`, include one golden-path `--json` command invocation for the
changed command as `command` evidence. If that command evidence is absent, emit a
`cli-golden-path-present` check with `fail` status in `checks[]`.

When `--bdd` is set, each Gherkin scenario must map to executable evidence (`test` or `command`) or
an explicitly reported missing-test condition. A missing executable mapping is `UNMET` when the
scenario is core to the task and `PARTIAL` only when the scenario is documented as advisory/deferred.

The answer file must include a stable AC table:

```markdown
### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: CLI emits JSON | MET | test | `apps/cli/tests/foo.test.ts:42` |
```

### Step 6 — Design conformance (Phase 7a; Wave C / 0179 R1–R3)

Verify the implementation matches the **approved design**, not just the requirements. The `### Design`
section is the artifact the `refine` HITL gate approves; without this step, an implementation can
diverge completely from the chosen approach and still PASS requirements/AC.

**What to read.** Pull `### Design` from the task content (sub-bullets, chosen approach, invariants,
signatures, rejected alternatives, calibrated tradeoffs). The feature design satellite
`docs/design/<slug>.md` is consulted when one exists (calibration source for SECUA-A: patterns
blessed in DESIGN.md are not flagged).

**Classification.** For each non-trivial design claim, classify against the diff:

| Status | Condition |
|--------|-----------|
| **DONE** | The diff implements the claim exactly as written |
| **PARTIAL** | Some but not all sub-aspects of the claim are implemented |
| **NOT DONE** | The claim has no implementation in the diff |
| **CHANGED** | The implementation differs from the written claim |

**Rules.**

- **Silent deviation = major finding → PARTIAL.** A claim marked NOT DONE **without** a `### Solution` note
  documenting the deviation as goal-equivalent lowers the aggregate verdict to PARTIAL.
- **Documented deviation = CHANGED, PASS-acceptable.** When `### Solution` names the claim and
  asserts goal-equivalent intent, classify as CHANGED and do not lower the verdict.
- **Scope-creep line.** Diff hunks that match **no** Requirement / Acceptance Criteria / Design /
  Plan item are reported as scope-creep. Surface as a `scope-creep` row in `checks[]`. The count
  alone does not lower the verdict; SECUA-A carries it as a major finding if scope-creep exceeds
  50% of the diff.
- **Calibrate SECUA-A.** Patterns blessed in DESIGN.md (or `docs/design/<slug>.md`) are not flagged
  as architectural drift.

Emit a `design-conformance` row into the verdict `checks[]`:

```markdown
| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 4/5 claims DONE; 1 CHANGED (Solution §3) |
```

### Step 7 — SECUA + quality review (Phase 7)

Review the changed code across the `--focus` dimensions (default all): **S**ecurity (secrets,
injection, unsafe input), **E**fficiency, **C**orrectness (null/edge handling, logic), **U**sability
(API clarity, error messages), **A**rchitecture (module depth, seam placement, coupling, locality).
Rank findings by severity (blocker / major / minor). See
[references/secu-review.md](references/secu-review.md).

When review exposes broader architecture friction rather than a localized defect, use
[references/code-improvement.md](references/code-improvement.md) to frame follow-up candidates
instead of silently expanding the current fix. LLM-as-judge reasoning is useful as a blind-spot
finder, but actionable findings must cite files, severity, and verification feasibility.

### Step 8 — Strict BDD scenario lens (if `--bdd`)

Apply the stricter mapping rules from Step 5 to Gherkin scenarios. Passed executable scenario →
MET; failed executable scenario → UNMET; no executable evidence → UNMET for core scenarios or
PARTIAL only when explicitly advisory/deferred. Fold the AC statuses into the aggregate verdict.

### Step 9 — Aggregate the verdict

```
any core requirement UNMET                          → FAIL
any core AC UNMET                                   → FAIL
any P1/blocker correctness or security finding       → FAIL
any core requirement or core AC PARTIAL (no FAIL)    → PARTIAL
any unresolved major quality finding (no FAIL)       → PARTIAL
all core requirements and AC MET or justified N/A    → PASS
```

Minor/advisory findings do not block. Only `PASS` clears the pipeline completion gate.
(`PARTIAL`/`FAIL` route the pipeline to `failed`.)

### Step 10 — Write findings to the task

Assemble the evidence and write via CLI verbs (temp-file → `--section`):

```bash
# Testing section: per-requirement and per-AC verdict tables + evidence
printf '...' > /tmp/<wbs>-testing.md
spur task update <wbs> --section Testing --from-file /tmp/<wbs>-testing.md

# Review section: SECUA findings ranked by severity
printf '...' > /tmp/<wbs>-review.md
spur task update <wbs> --section Review --from-file /tmp/<wbs>-review.md
```

Section bodies passed to `spur task update --section` must be **body-only**. Do not put a same-level
heading inside any section body; the task writer strips same-level headings to prevent phantom
sections. Concretely:

- **Testing section:** do not put `### Acceptance Criteria Verification`, `### Per-Requirement
  Traceability`, or any `###` heading inside the Testing body. Use bold labels
  (`**Acceptance Criteria Verification**`) or tables instead.
- **Review section:** do not put `### SECUA Review` or any `###` heading inside the Review body.
  Use a priority table or a bold label such as `**SECUA Review**` instead.

### Step 11 — State the verdict (the gate contract)

End the verify output with an explicit, parseable verdict line so the pipeline can
transport it deterministically:

```
Verdict: PASS    (or PARTIAL / FAIL)
```

**Under the pipeline**, the `verify` step captures this answer to
`.spur/run/<wbs>-verify-answer.txt` (via `agent.run answerFile`), and a deterministic
shell step derives the gate artifact `.spur/run/<wbs>-verdict.json` from it **plus** an
independent `spur task check` — so the artifact is never left to the agent's discretion

### Step 12 — Handoff to record (pipeline context)

Under the pipeline (`task-pipeline.yaml`), the verify agent's output is captured to
`.spur/run/<wbs>-verify-answer.txt` (via `agent.run answerFile`). The **record** step
then transcribes this output into the task's `## Testing` and `## Review` sections:

- **Testing** ← verdict from `.spur/run/<wbs>-verdict.json` + per-requirement table
  from the answer file
- **Review** ← SECUA findings (P1–P4) extracted from the answer file

The verify agent's output MUST include a per-requirement traceability table
(`| Req | Status | Evidence |`), an Acceptance Criteria table
(`| AC | Status | Evidence Type | Evidence |`), and a `### SECUA Review` heading with ranked findings
so the record step can extract them mechanically. The verdict artifact
(`.spur/run/<wbs>-verdict.json`) is the gate signal; the answer file is the evidence
the record step transcribes — keep both structures stable.

This `### SECUA Review` heading is an **answer-file contract only**. It belongs in
`.spur/run/<wbs>-verify-answer.txt` so the pipeline record step can parse the captured output. It
does **not** belong in the body file passed to `spur task update --section Review --from-file`;
section bodies should use tables or bold labels, as noted in Step 10.

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
  acceptanceCriteria?: Array<{
    id: string;
    status: 'MET' | 'PARTIAL' | 'UNMET' | 'N/A';
    evidenceType: 'test' | 'command' | 'static-ref' | 'manual-review' | 'llm-judge' | 'n/a';
    evidence: string;
  }>;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; evidence: string }>;
}
```

For documentation-only, configuration-only, or skill-doc verification where no runtime coverage
measurement applies, include an explicit coverage line in the Testing evidence:

```
Coverage: N/A (documentation-only change; no runtime code path added).
```

This satisfies the task checker without pretending a coverage percentage was measured.

### Step 13 — Fix pass (if `--fix` ≠ `none`)

- `blockers-first` — repair only requirements/AC that are UNMET (the blockers), then re-run Steps 4–12.
- `all` — repair UNMET + PARTIAL requirements/AC and major SECUA findings, then re-run Steps 4–12.
- `none` — stop at the verdict; report and exit.

Loop is bounded — if a fix doesn't move a requirement to MET after one retry, report the residual
and stop (don't thrash).

### Step 14 — Report

Show the verdict, the per-requirement table, and the gate outcome (cleared / blocked). Under the
pipeline this is consumed by the gate; for a direct `/sp:dev-verify` invocation it's the operator's
summary.

---

## Mode: review (`/sp:dev-review`)

The source-oriented path: SECUA review of a task's diff without the full traceability verdict. Runs
Steps 3 + 7 + 10 (Review section only) — no verdict artifact, no `done` gate. Use for a focused
quality/security audit of changes when the full verify isn't wanted.

Flags: `--agent <name|auto>` (agent override), `--auto` (no confirmations), `--fix
<none|blockers-first|all>` (post-review repair), and `--focus
<all|security|efficiency|correctness|usability|architecture>` (SECUA dimensions).

**Agent override:** The `--agent <name|auto>` flag (passed through from the thin wrapper
via `$ARGUMENTS`) controls which agent executes the review. `auto` = resolve from current runtime,
`<name>` = explicit override; omit to use the configured default executor `omp` — "current agent"
is not expressible on the pipeline surface.

---

## When to use

- **Verify a task before `done`** — the pipeline's `verify` step, or a manual `/sp:dev-verify`.
- **Audit completed work** — `--force` re-verifies a `done` task (compliance, post-merge).
- **Focused code review** — `/sp:dev-review` for SECUA findings on a diff.

Do **not** use this skill for:

- Driving the pipeline — that's `/sp:dev-run` → `sp:spur-dev` (execution half).
- Running tests / coverage — that's `/sp:dev-unit`.
- Constraint-rule gating — that's `sp:spur-cli` (deterministic, complementary).

---

## Gotchas

1. **Presence ≠ content.** `spur task check` passing is **not** a PASS verdict. This skill is the
   content gate; never conflate the two.
2. **Write the verdict artifact last.** The workflow guard reads it; a stale/partial file fails the
   gate misleadingly. Emit it only after the verdict is final (Step 12).
3. **Never direct-write the task file.** All findings go through `spur task update --section`.
4. **`PASS` is the only clear.** `PARTIAL` blocks the gate — there is no "good enough" pass.
5. **Bounded fix loop.** `--fix` retries once per requirement, then reports residuals — don't loop
   forever chasing a stubborn UNMET.

---

## Additional Resources

- [references/verdict-schema.md](references/verdict-schema.md) — the `VerifyVerdict` artifact shape
  and the per-requirement aggregation rule.
- [references/secu-review.md](references/secu-review.md) — the SECUA dimensions and finding-severity
  rubric.
- `config/workflows/task-pipeline.yaml` — the `verify → record` gate that consumes the verdict.
- **`sp:spur-dev`** — the execution-half umbrella that drives the pipeline this skill gates.
- [references/code-improvement.md](references/code-improvement.md) — architecture-improvement lens
  for module depth, seam placement, locality, coupling, and testability.

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
