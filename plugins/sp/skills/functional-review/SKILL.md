---
name: functional-review
description: "Requirements traceability assessment: verify implementation satisfies ALL task requirements. Phase 8b gate for the sp pipeline. Produces per-requirement verdicts with file:line evidence. Triggers: \"functional review\", \"traceability check\", \"verify requirements\", \"did we build what was asked\", \"requirements completeness\"."
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
  verdicts:
    - PASS
    - PARTIAL
    - FAIL
  openclaw:
    emoji: "📋"
see_also:
  - sp:code-verification
  - sp:code-improvement
  - sp:spur-dev
---

# Spur Functional Review

The **requirements traceability** counterweight to `sp:code-verification`'s SECUA review. Where
code-verification asks "is the code correct and secure?", functional-review asks "did we build what
the task actually asked for?" — mapping every `R{n}` requirement to concrete implementation evidence
and refusing to certify gaps.

## When to Use

**Trigger phrases:** "functional review", "traceability check", "verify requirements",
"requirements completeness", "did we build what was asked", "check the requirements".

Load this skill when:

- Verifying implementation against the task's `## Requirements` section (per-requirement traceability).
- Producing an audit trail that ties each requirement to `file:line` evidence.
- Running the requirements-completeness dimension of a multi-dimensional review (`/sp:dev-review`).
- Determining whether functional completeness is sufficient for `done`.

Do **not** use this skill for:

- SECUA code-quality review (use `sp:code-verification` review mode).
- Architecture / deepening review (use `sp:code-improvement`).
- Running tests or measuring coverage (use `sp:code-testing`).
- Driving the pipeline (use `sp:spur-dev`).

## Key Distinctions

| Skill | Question it answers |
| ------- | --------------------- |
| **`sp:functional-review`** | Are all task requirements implemented? (requirements completeness) |
| **`sp:code-verification`** | Is the code correct, secure, efficient, usable? (SECUA quality) |
| **`sp:code-improvement`** | Is the architecture deep / testable? (structural depth) |

A complete `/sp:dev-review` runs all three: functional (this skill) + SECUA + architecture.

## Cross-cutting rules (inherited from sp:spur-dev)

The CLI-gated section-write contract (every mutation via `spur task update --section --from-file`,
never a legacy `tasks` CLI) is the SSOT in
[spur-dev/cross-cutting.md](../spur-dev/references/cross-cutting.md). The universal honesty gate —
**no "done / passing / fixed / works" claim without fresh, pasted verification evidence run this
turn** — lives in that same file:
[Verification Before Completion](../spur-dev/references/cross-cutting.md#verification-before-completion).
A PASS verdict is a completion claim; it obeys the gate.

---

## Two-Track Assessment

### Track A — BDD-Assisted (if `--bdd-report` provided)

When a BDD execution report exists (from `sp:code-testing --bdd` or equivalent), map each
requirement to one or more Gherkin scenarios by requirement text, identifier, or explicit
traceability markers:

| Scenario status | Requirement status |
| ----------------- | -------------------- |
| All covering scenarios `passed` | `MET` |
| Any covering scenario `failed` or `skipped` | `PARTIAL` |
| No covering scenarios found | fall through to Track B |

Only requirements that remain uncovered after BDD mapping fall through to Track B — the BDD report
is the stronger (deterministic) evidence and takes precedence.

**Expected BDD report schema** (JSON):

```typescript
interface BddExecutionReport {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration_ms: number;
    scenarios: Array<{
        name: string;          // maps to requirement text or AC scenario title
        feature: string;
        status: 'passed' | 'failed' | 'skipped';
        steps: Array<{ step: string; checker: string; status: string }>;
    }>;
}
```

### Track B — LLM Assessment (direct source evidence)

For each requirement not covered by BDD, gather concrete source evidence and assess:

1. Read the changed files (the task's diff scope — see Step 3 of `sp:code-verification`).
2. Search for implementation evidence: function definitions, type declarations, test cases,
   config keys, CLI surface.
3. Assign a per-requirement status using the Evidence Quality Standard below.

```typescript
// For each uncovered requirement
const evidence = gatherEvidence(req, changedFiles);
const assessment = llmAssess(req, evidence);
verdict[req.id] = { status: assessment.status, evidence: assessment.evidence };
```

---

## Per-Requirement Status

| Status | Condition |
| -------- | ----------- |
| **MET** | Concrete evidence (code + test, or code + static ref) for the requirement exists in scope |
| **PARTIAL** | Evidence for part of the requirement only — a material sub-condition is missing or only inferred |
| **UNMET** | No implementation evidence found in scope |

**Zero-requirements case:** if the task has 0 numbered requirements, return `verdict = PASS` with the
note "No requirements to verify" — this is a documentation-only or config-only task, not a failure.

---

## Evidence Quality Standard

All evidence MUST be specific. Vague evidence is rejected and the requirement is downgraded to
`UNMET` or `PARTIAL`.

### SPECIFIC Evidence (required)

| Type | Example |
| ------ | --------- |
| File path + line | `src/api/users.ts:42` |
| Function / method name | `createUser()` |
| Class / type name | `UserController` |
| Test case | `tests/users.test.ts::createUser validates email` |
| Command + exit status | `bun test apps/cli --reporter=dots` → exit 0, 2499 pass |
| Config / schema key | `package.json#bin.spur` |

### VAGUE Evidence (rejected)

| Type | Why rejected |
| ------ | -------------- |
| "implemented correctly" | No specific location |
| "meets requirements" | No evidence cited |
| "the code does X" | No file:line reference |
| "as specified" | No implementation pointer |

### Evidence Templates

**MET:**

```
- `src/api/users.ts:42` — `createUser()` implements user creation
- `src/api/users.ts:45-48` — input validation for email field
- `tests/users.test.ts:15-20` — unit test verifies email uniqueness
```

**PARTIAL:**

```
- `src/api/users.ts:42` — `createUser()` implements basic creation
- MISSING: `src/api/users.ts` — no error handling for duplicate emails (R3 sub-condition "duplicate email rejected")
```

**UNMET:**

```
- NO IMPLEMENTATION FOUND for requirement R5: "Send email notification on user creation"
- Searched: src/api/, src/services/, src/notifications/
```

---

## Workflow

### Step 1 — Load the task

```bash
spur task show <wbs> --json
```

Parse from `content`:

- `## Requirements` — the `R{n}` items (the traceability targets).
- `## Acceptance Criteria` — if present, AC evaluation is complementary; `sp:code-verification`
  verify mode owns the AC gate, but functional-review cross-checks that AC map back to requirements.

Flags: `--bdd-report <path>` (BDD execution report JSON), `--source-paths <a,b>` (explicit source
scope; defaults to the task's diff scope), `--auto` (no confirmations), `--next` (on PASS,
auto-transition `testing → done`; on PARTIAL/FAIL, stop).

### Step 2 — Parse requirements

Extract every `R{n}` from `## Requirements` into a numbered list. If the section is empty or absent,
return `verdict = PASS` with "No requirements to verify" (zero-requirements case).

### Step 3 — Establish the change scope

If `--source-paths` is given, use it. Otherwise derive the diff scope exactly as
`sp:code-verification` Step 3 does (the task file's last commit → `git diff --name-only` for
`*.ts`/`*.tsx`/`*.js`/`*.jsx`, fallback to working-tree diff).

### Step 4 — Track A: BDD mapping (if `--bdd-report`)

Load the BDD report, map each requirement to scenarios, assign `MET`/`PARTIAL` per the Track A
table. Uncovered requirements fall through to Track B.

### Step 5 — Track B: LLM evidence assessment

For each uncovered requirement, gather source evidence and assign `MET`/`PARTIAL`/`UNMET` per the
Evidence Quality Standard. Record the evidence string (`file:line`, command, or test name).

### Step 6 — Aggregate the verdict

Apply the aggregation rule (contract in
[references/verdict-schema.md](references/verdict-schema.md#aggregation-rule)):

```
any core requirement UNMET                         → FAIL
any core requirement PARTIAL (no UNMET)            → PARTIAL
all core requirements MET                          → PASS
```

`PARTIAL` blocks the gate exactly like `FAIL` — the distinction only tells the operator *how far
off* delivery is.

### Step 7 — Write findings to the task

Write the review body to the task's `## Review` section via CLI verbs. The body MUST lead with a
`| Priority | Dimension | Location | Finding |` table (the L3 `hasPopulatedPriorityTable` gate at
`task-check.ts:96-106` requires at least one `P[1-4]` row with non-placeholder siblings — any other
shape, e.g. `| Req | Status | Evidence |` alone, is structurally rejected and denies the
`wip→testing` transition). Use the same canonical shape as `sp:code-verification`:

```bash
cat > /tmp/<wbs>-functional.md <<'BODY'
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1  | MET     | `src/api/users.ts:42` — `createUser()` |
| R2  | PARTIAL | `src/api/users.ts:42` — basic only; MISSING duplicate-email handling |
| R3  | UNMET   | no implementation found; searched src/api/, src/services/ |
BODY
spur task update <wbs> --section Review --from-file /tmp/<wbs>-functional.md
rm /tmp/<wbs>-functional.md
```

For a PARTIAL/FAIL verdict, replace the P4 row with the actual P1–P3 findings ranked by severity.
The priority table leads; the traceability table follows for per-requirement detail.

Section bodies passed to `spur task update --section` must be **body-only** — no same-level (`##`)
headings inside the body. Tables and bold labels are fine.

### Step 8 — Report

End the output with an explicit, parseable verdict line:

```
Functional Verdict: PASS    (or PARTIAL / FAIL)
```

Include the per-requirement traceability table in the report:

```markdown
| Req | Status | Evidence |
|-----|--------|----------|
| R1  | MET    | `src/api/users.ts:42` — `createUser()` |
| R2  | PARTIAL | `src/api/users.ts:42` — basic only; MISSING duplicate-email handling |
| R3  | UNMET  | no implementation found; searched src/api/, src/services/ |
```

**Under the pipeline**, `sp:functional-review` is the review step dispatched by `/sp:dev-review`,
so it owns `## Review` — its `--section Review` write is the authoritative source. The pipeline's
`record` step transcribes only `## Testing` from the verify verdict (`code-verification/SKILL.md`,
`task-record.ts:226-247`); it does not overwrite a non-bare `## Review` thanks to the
`sectionIsBare` guard (`task-service.ts:485`). Keep the priority-table lead stable so the L3 gate
stays satisfied through `record` → `done`.

---

## Quality Gates

1. **Evidence gate:** all evidence must be specific (`file:line` or named test/command).
2. **Coverage gate:** every numbered requirement must have a verdict row.
3. **Verdict gate:** overall verdict must be PASS/PARTIAL/FAIL with per-requirement reasoning.

---

## Verdict Schema

The artifact shape, per-requirement status enum, and aggregation rule are the contract in
[references/verdict-schema.md](references/verdict-schema.md). When emitting a machine-readable
verdict (standalone or pipeline), shape it as `FunctionalVerdict` — not `VerifyVerdict` (which is
`sp:code-verification`'s SECUA + AC contract). The two artifacts are complementary; a full
`/sp:dev-review` may emit both.

---

## Common Rationalizations

| Rationalization | Reality |
| --- | --- |
| "The requirement is obviously met — I can see it in the diff." | Seeing code is not evidence. A requirement is MET only when `file:line` evidence is cited. |
| "All tests pass, so all requirements are covered." | Green tests prove the suite's assertions, not that every requirement has coverage. Map each requirement to its evidence. |
| "The implementer reported it works — I'll trust the summary." | A subagent success report is a claim, not a verdict. Functional review **re-checks** the evidence; trusting the report skips the gate. |
| "R5 is a minor requirement — I'll skip it." | Every numbered requirement gets a row. No silent skipping. |
| "PARTIAL is close enough to ship." | PARTIAL/FAIL both block the gate. Rounding PARTIAL up to PASS is the exact dishonesty this gate exists to catch. |

---

## Red Flags

- A PASS verdict with no per-requirement evidence column.
- A requirement marked MET with evidence that is a description, not a `file:line` anchor.
- A verdict authored from the implementer's summary without independently re-reading the source.
- Softening FAIL to PARTIAL, or PARTIAL to PASS, to avoid surfacing to the operator.
- Skipping a requirement because "it's advisory" — if it carries an `R{n}` number, it gets a row.

---

## Gotchas

1. **Requirements ≠ AC.** `sp:code-verification` owns the AC gate; this skill owns the
   requirements gate. They are complementary, not redundant.
2. **Zero requirements is a PASS.** A doc-only or config-only task with no `R{n}` items is not a
   failure — return PASS with the "No requirements to verify" note.
3. **BDD takes precedence.** When a BDD report covers a requirement, the deterministic scenario
   result wins; do not re-assess with LLM judgment.
4. **Never direct-write the task file.** All findings go through `spur task update --section`.

---

## Platform Notes

### Claude Code

Invoke via `Skill(skill="sp:functional-review", args="<wbs>")`. The `spur` CLI runs via the Bash
tool for `spur task show` / `spur task update`.

### Codex / OpenClaw / OpenCode / Antigravity

Run `spur` CLI via Bash; parse `--json`. Invoke this skill directly for the functional-review logic
— the skill is the SSOT; the commands are thin wrappers. `Skill()` and `$ARGUMENTS` are
Claude-specific; on other platforms, execute the workflow steps inline.
