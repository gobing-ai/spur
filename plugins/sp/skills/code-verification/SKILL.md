---
name: code-verification
description: "Verify a task's implementation against requirements and AC; SECUA code review. Produces a PASS/PARTIAL/FAIL verdict with per-requirement evidence. Triggers: \"verify task\", \"verify this\", \"check the requirements\", \"code review\", \"SECUA review\", \"requirements traceability\", \"review the diff\"."
license: Apache-2.0
metadata:
  author: spur
  review_skills:
    - functional-review
    - code-improvement
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
| `/sp:dev-verify <wbs>` | **verify** | a task WBS | per-requirement verdict → `## Testing`; `.spur/run/<wbs>-verdict.json` |
| `/sp:dev-review <wbs>` | **review** | a task WBS (diff scope) | three-dimensional findings → `## Review` (functional + SECUA + architecture) |

The verify mode is the **completion gate's evidence source**: it emits a machine verdict the
`task-pipeline.yaml` workflow reads before allowing `record → done`. A `PASS` clears the gate; a
`PARTIAL`/`FAIL` blocks it. This is what makes "done" mean *verified*, not *self-reported*. The
three `testing → done` gate layers (strict-core + verdict artifact, provenance guard, Review L3)
and their per-layer remediation are owned by
[gate-checklists.md](../spur-dev/references/gate-checklists.md) § done-gate.

## Why this skill exists (the gap it closes)

`spur task check` validates section **presence**, not content — it passes a hollow `## Testing`
heading. So presence-checking alone lets an agent march a task to `done` with empty evidence and an
implementation that doesn't match its AC. This skill supplies the missing **content** verdict:
it reads requirements and AC, maps each to evidence, and refuses to certify what isn't there. The
verdict artifact carries that signal to the pipeline gate (design §B).

## Cross-cutting rules (inherited from sp:spur-dev)

The CLI-gated section-write contract (every mutation via `spur task update --section --from-file`,
never a legacy `tasks` CLI) is the SSOT in
[spur-dev/cross-cutting.md](../spur-dev/references/cross-cutting.md) — this skill adds one rule of
its own: **the verdict artifact is the contract.** `.spur/run/<wbs>-verdict.json` is the machine
signal the workflow guard reads; always write it last, after the verdict is final.

The universal honesty gate — **no "done / passing / fixed / works" claim without fresh, pasted
verification evidence run this turn** — lives in that same file:
[Verification Before Completion](../spur-dev/references/cross-cutting.md#verification-before-completion).
The verify step is where it is enforced hardest: a PASS verdict is a completion claim, so it obeys the gate.

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

Flags: `--agent <inline|auto|name>` (execution surface — inline default, with named escalation triggers taking precedence — see [cross-cutting.md](../spur-dev/references/cross-cutting.md#inline-default-execution-surface)), `--auto` (no confirmations), `--force` (bypass the terminal-status guard), `--fix <none|blockers-first|all>` (post-verdict repair), `--focus <all|security|efficiency|correctness|usability|architecture>` (SECUA dimensions), `--bdd` (strict Gherkin scenario-to-test check), `--next` (on PASS, auto-transition `testing → done`; on PARTIAL/FAIL, stop), `--skip-shippable` (alias `--skip-shipable`) — disable the feature-level **Shippable readiness gate** that otherwise runs when `--fix all` and a feature context exists (see Step 13).

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

Record the evidence string (repo-relative path `file:line`, e.g. `packages/app/src/services/task-check.ts:42`, command, or test name) per requirement — this is what lands
in `## Testing`.

**Line-anchor verification (anti-stale-citation rule).** Every `file:line` evidence citation
written into the Testing table MUST be re-read at the cited lines this run, and the re-read content
MUST name the requirement's subject (the R-item's noun - not merely exist on disk) before a MET row
is written. A citation whose anchor resolves to another ticket's content, a stale line range, or a
heading/comment unrelated to the requirement fails the row to UNMET and surfaces the stale anchor as
a finding (severity >= P2). This closes the gap where a verify run certified a task `done` citing
`evidence:134` that was actually a sibling ticket's telemetry text (0299 R1, from the 0282 re-audit).

### Step 5 — Acceptance Criteria guard

If the task has a non-empty Acceptance Criteria section, evaluate every checklist item and every
Gherkin scenario independently. This gate runs whether or not `--bdd` is set.

| Per-AC status | Condition |
|---------------|-----------|
| **MET** | The AC is satisfied by concrete evidence |
| **PARTIAL** | Some evidence exists, but a material condition is missing or only inferred |
| **UNMET** | No implementation evidence satisfies the AC, or a required scenario fails |
| **N/A** | The AC is explicitly non-applicable with a concrete reason |

Evidence is typed so weak proof is visible. Objective AC cannot be cleared by `llm-judge` alone —
pair qualitative judgment with deterministic or static evidence, or mark the row `PARTIAL`. Full
type list, the core-behavior executable-evidence requirement, and the CLI golden-path rule are the
contract in
[references/verdict-schema.md](references/verdict-schema.md#acceptance-criteria-evidence); apply it
here, don't re-derive it.

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

**Line-anchor verification applies to AC evidence too.** Every `file:line` citation in the AC
evidence column is subject to the Step 4 line-anchor rule - re-read at the cited lines this run and
confirm the content names the AC's subject before marking the row MET.

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

**Rules.** A claim marked NOT DONE **without** a `### Solution` note is a silent deviation →
major finding, verdict drops to PARTIAL. A claim NOT DONE **with** a `### Solution` note asserting
goal-equivalent intent is a documented deviation → classify CHANGED, PASS-acceptable, no downgrade.
Diff hunks matching no Requirement/AC/Design/Plan item are scope-creep — surface a `scope-creep` row
in `checks[]`; SECUA-A escalates it to a major finding only past 50% of the diff. Patterns blessed in
DESIGN.md (or `docs/design/<slug>.md`) calibrate SECUA-A and are never flagged as drift.

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
[references/secu-review.md](references/secu-review.md). For review *depth* — structural remedies,
change sizing, honesty/anti-sycophancy, dead-code hygiene, and dependency discipline — the SSOT is
[code-review/references/review-lenses.md](../code-review/references/review-lenses.md); apply it here
rather than restating it.

When review exposes broader architecture friction rather than a localized defect, use
[references/code-improvement.md](references/code-improvement.md) to frame follow-up candidates
instead of silently expanding the current fix. LLM-as-judge reasoning is useful as a blind-spot
finder, but actionable findings must cite files, severity, and verification feasibility.

### Step 8 — Strict BDD scenario lens (if `--bdd`)

Apply the stricter mapping rules from Step 5 to Gherkin scenarios. Passed executable scenario →
MET; failed executable scenario → UNMET; no executable evidence → UNMET for core scenarios or
PARTIAL only when explicitly advisory/deferred. Fold the AC statuses into the aggregate verdict.

### Step 9 — Aggregate the verdict

Apply the aggregation rule in
[references/verdict-schema.md](references/verdict-schema.md#aggregation-rule): core UNMET or a
blocker finding → FAIL; core PARTIAL or an unresolved major finding (no FAIL) → PARTIAL; everything
MET or justified N/A → PASS. Minor/advisory findings do not block. Only `PASS` clears the pipeline
completion gate (`PARTIAL`/`FAIL` route the pipeline to `failed`).

### Step 10 — Write findings to the task

Assemble the evidence and write via CLI verbs (temp-file → `--section`):

```bash
# Testing section: per-requirement and per-AC verdict tables + evidence
printf '...' > /tmp/<wbs>-testing.md
spur task update <wbs> --section Testing --from-file /tmp/<wbs>-testing.md
```

> **Do not write `## Review` directly in verify mode.** The `## Review` section is owned by the
> `review` step (`/sp:dev-review`), which dispatches `functional-review` + `code-verification`
> review mode + `code-improvement`. The `record` step backfills `## Review` from the verdict
> artifact only if the section is bare (`sectionIsBare` guard, `task-service.ts:563`). Writing
> `## Review` here bypasses that guard and destroys the review step's three-dimensional findings.

Section bodies passed to `spur task update --section` must be **body-only**. Do not put a same-level
heading inside any section body; the task writer strips same-level headings to prevent phantom
sections. Concretely:

- **Testing section:** do not put `### Acceptance Criteria Verification`, `### Per-Requirement
  Traceability`, or any `###` heading inside the Testing body. Use bold labels
  (`**Acceptance Criteria Verification**`) or tables instead.

### Step 11 — State the verdict and hand off (the gate contract)

End the verify output with an explicit, parseable verdict line so the pipeline can transport it
deterministically:

```
Verdict: PASS    (or PARTIAL / FAIL)
```

**Answer-File Schema Contract (R2 / 0478).** The verify answer file (`.spur/run/<wbs>-verify-answer.txt`) MUST follow this exact structure so `spur task verdict --from-answer` can parse it:

```markdown
Verdict: PASS

### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/foo.ts:42` |

### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: CLI emits JSON | MET | test | `apps/cli/tests/foo.test.ts:42` |

### SECUA Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
```

The per-requirement traceability table MUST use `| Req | Status | Evidence |` (exactly this header, no `R#`/`R`/`Requirement` variant, and no extra columns between Req and Status). The Acceptance Criteria table MUST use `| AC | Status | Evidence Type | Evidence |`.

**MUST NOT:** use `| R# | ... |` as the sole id header without `Status` in column 2.
**MUST NOT:** place a `Severity` column between `Req` and `Status` in the authoring contract.
The parser is tolerant of these variants (defense-in-depth), but the authoring contract is
canonical.

**Under the pipeline** (`task-pipeline.yaml`), `agent.run answerFile` captures this whole output to
`.spur/run/<wbs>-verify-answer.txt`. A deterministic shell step then derives
`.spur/run/<wbs>-verdict.json` from it plus an independent `spur task check` (R9; the agent
reporting PASS in prose is necessary but not sufficient — the artifact is never left to the agent's
discretion). The **record** step transcribes only `## Testing` from the verdict — verdict + per-
requirement/AC tables + evidence. `## Review` is owned by the review step (`/sp:dev-review`) and
the record step's `sectionIsBare` guard (`task-service.ts:563`) preserves any non-bare Review
content. Verify mode never writes `## Review`.

**Standalone** (`/sp:dev-verify` outside the pipeline — no answer-file capture exists), write the
artifact yourself; shape and field-by-field contract in
[references/verdict-schema.md](references/verdict-schema.md):

```bash
mkdir -p .spur/run
jq -n --arg wbs "<wbs>" --arg v "<PASS|PARTIAL|FAIL>" \
  '{wbs:$wbs, verdict:$v, requirements:[...], checks:[...]}' \
  > .spur/run/<wbs>-verdict.json
```

For documentation-only, configuration-only, or skill-doc verification where no runtime coverage
measurement applies, include an explicit coverage line in the Testing evidence
(`Coverage: N/A (documentation-only change; no runtime code path added).`) — this satisfies the task
checker without pretending a coverage percentage was measured.

### Step 12 — Fix pass (if `--fix` ≠ `none`)

- `blockers-first` — repair only requirements/AC that are UNMET (the blockers), then re-run Steps 4-11.
- `all` — repair UNMET + PARTIAL requirements/AC and major SECUA findings, then re-run Steps 4-11.
- `none` — stop at the verdict; report and exit.

Loop is bounded — if a fix doesn't move a requirement to MET after one retry, report the residual
and stop (don't thrash).

**Follow-up task create — record-then-reuse discipline (0341 R4).** The CLI dedup guard is **on by
default** when `--feature <id>` is set: a second `spur task create` with an identical (case-insensitive)
title under the same feature within 300 seconds exits `3` with `duplicate-follow-up` and names the
existing WBS. This closes the dogfood double-create where an orphan skeleton + re-create produced
two task files seconds apart.

**On `duplicate-follow-up` (exit 3):** parse the existing WBS from the error and **reuse** it —
populate its sections with `spur task update <wbs> --section …`. Do not call `--allow-duplicate-name`
unless the operator explicitly authorizes a true second task.

**Per-run ledger (belt-and-suspenders).** Maintain `.spur/run/<wbs>-fix-created.json` (empty `[]` if
missing) as the fix pass's record of follow-ups minted. Before creating, check it for an identical
name under the same `feature_id`; if found, reuse that WBS. After a successful create (or the CLI
`duplicate-follow-up` reuse), append `{ wbs, name, feature_id, created_at }` to the ledger.

**Gitignored fix-pass writes (disclosure rule).** Artifacts written under `.spur/run/**` during a
fix pass are gitignored, so a `--fix all` pass can mutate deliverables invisibly to `git status` and
to drift guards. The Testing write-back MUST name the exact artifact path and line range the fix
pass touched (e.g. `.spur/run/0299-verdict.json:12-18 (re-evaluated R2 evidence after fix)`) so the
mutation is discoverable from the tracked task file alone, without diffing untracked directories.

### Step 13 — Shippable readiness gate (feature-level)

Per-task PASS is **not** the same as “this feature is ready to ship.” After Steps 11–12, when the
gate is **active**, evaluate feature AC satisfaction via the existing CLI (do not invent a second
framework).

**When active**

| Condition | Gate |
|-----------|------|
| `--fix all` **and** feature context **and** **not** `--skip-shippable` / `--skip-shipable` | **ON** |
| `--fix` is `none` or `blockers-first` | **OFF** (optional note: shippable not evaluated) |
| No feature context | **N/A** |

**Feature context**

- Single verify: task frontmatter `feature_id` (or `feature-id`).
- verifyall: `--feature <id>`, or every task in the frozen set shares the same non-empty `feature_id`.
- Otherwise: `Shippable: N/A (no feature context)` — do not fail.

**Procedure (must run when active)**

1. Write verdicts only to **repo-root** `.spur/run/<wbs>-verdict.json` (CLI SSOT; never
   `docs/.spur/run` or other nested `.spur` trees). Ephemeral scratch may use `/tmp` or
   `/private/tmp`. Requirement / AC row `id`s in the verdict MUST match feature scenario titles
   (or `AC-N` aliases) so satisfaction can mark MET.
2. Run:

   ```bash
   spur feature check <featureId> --json
   spur task list --feature <featureId> --json
   ```

3. Classify **Shippable: PASS** only if **all** of:
   - No finding whose code/message indicates **linked but unverified** scenarios
     (`L4_SCENARIO_UNVERIFIED` / “linked but unverified”).
   - No **orphan / uncovered** feature scenarios (`L4_ORPHAN_SCENARIOS`,
     `L4_UNCOVERED_FEATURE_SCENARIO` / no covering task).
   - No **incomplete** linked tasks: every task with this `feature_id` is `done` or `cancelled`
     (always under this gate — not only when the feature status is `verifying`).
4. Emit a fixed block (answer file + operator summary). Examples:

   ```
   Shippable: PASS
   Feature: I1
   ```

   ```
   Shippable: FAIL
   Feature: I1
   Reasons:
   - scenario "R1 — …" linked but unverified (covering 0360)
   - incomplete tasks: 0364
   Recovery:
   - Graduate/implement work for unverified ship AC and re-verify those WBS, or
   - Align task AC titles to feature scenarios + ensure PASS+MET verdict rows, or
   - Use --skip-shippable only if this run is deliberately non-ship (research map only)
   ```

5. **Outcome folding**
   - **FAIL shippable:** the run is **not clean**. verifyall batch rollup must be at least
     **PARTIAL** (or **FAIL** if any task already FAIL). Include `"shippable": false` in `--json`
     batch summaries. Single verify: keep the per-task `Verdict: PASS|…` line, but always print
     `Shippable: FAIL` — do not present the session as feature-ready; if `--next` is set, state that
     feature ship is still blocked.
   - **PASS shippable:** print `Shippable: PASS`; per-task verdicts unchanged.
   - **N/A / skipped:** print `Shippable: N/A …` or `Shippable: SKIPPED (--skip-shippable)`.

**`--fix all` may repair** verdict id mismatches and in-task Testing gaps for WBS already in the
set. It must **not** auto-create implement tasks for ship gaps — report Recovery instead.

**verifyall:** run this step **once** after all per-task verifies (and their fix passes), not once
per WBS.

Full flag matrix and ops notes: [spur-dev/references/dev-operations.md](../spur-dev/references/dev-operations.md)
§ verify / verifyall.

### Step 14 — Report

Show the per-task verdict, the per-requirement table, the gate outcome (cleared / blocked), and the
**Shippable:** line from Step 13 when applicable. Under the pipeline the task verdict is consumed by
the done-gate; for a direct `/sp:dev-verify` invocation the full report is the operator's summary.

**`--next` on an already-terminal task (no-op surfacing).** When `--next` is invoked on a task
already at `done` or `cancelled`, the transition cannot fire. The verify report line MUST state the
no-op itself (e.g. `--next: no-op - task already terminal (<status>)`) rather than relying solely
on the CLI print (documented in `dev-verify.md`'s `--next` chain section). The CLI print is the
machine signal; the report line is the operator-visible summary - both must agree so a terminal-task
re-audit cannot be misread as a successful `testing -> done` transition.

---

## Mode: review (`/sp:dev-review`)

The source-oriented path: SECUA review of a task's diff without the full traceability verdict. Runs
Steps 3 + 7 + 10 (Review section only) — no verdict artifact, no `done` gate. Use for a focused
quality/security audit of changes when the full verify isn't wanted.

Flags: `--agent <inline|auto|name>` (execution surface — inline default, with named escalation triggers taking precedence), `--auto` (no confirmations), `--fix <none|blockers-first|all>` (post-review repair), and `--focus <all|security|efficiency|correctness|usability|architecture>` (SECUA dimensions). Apply the [central contract](../spur-dev/references/cross-cutting.md#inline-default-execution-surface) before starting the review.

---

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The AC is obviously met — I can see it in the diff." | Seeing code is not evidence. An AC is met only when a command or test tied to it exited 0 **this run**; paste it, or the AC is UNVERIFIED. |
| "All tests pass, so the verdict is PASS." | Green tests prove the suite's assertions, not that every AC has coverage. Map each AC to its evidence; an AC with no test is not covered by a passing suite. |
| "The implementer reported it works — I'll trust the summary." | A subagent success report is a claim, not a verdict. Verification **re-runs** the check; trusting the report is skipping the gate you were asked to be. |
| "It's a small diff, one AC — full traceability is overkill." | Diff size does not scale the honesty bar. Every AC gets a row in the traceability table regardless of diff size. |
| "This objective AC reads fine — `llm-judge` can clear it." | Objective AC (a test exists, a command exits 0, a file contains X) cannot be cleared by judgment alone; it needs the literal command evidence. |
| "PARTIAL is close enough to ship." | PARTIAL/FAIL leave the task at `testing` and surface to the operator. Rounding PARTIAL up to PASS is the exact dishonesty this gate exists to catch. |
| "All tasks PASS — the feature is shippable." | Per-task PASS can be research-only. Under `--fix all`, Step 13 must run `spur feature check`; missing implement cover ⇒ `Shippable: FAIL`. |
| "I'll skip feature check; the map looks done." | Without `--skip-shippable`, shippable is mandatory when `--fix all` + feature context. Omitting Step 13 is a gate skip. |

## Red Flags

- A PASS verdict with no per-AC evidence column, or evidence that is a description rather than a pasted command + exit status.
- Clearing an objective AC (`file exists`, `command exits 0`, `test named X passes`) with `llm-judge` instead of the literal check.
- A requirements table using `| R# | ... |` or placing `Severity` between `Req` and `Status` — the authoring contract is `| Req | Status | Evidence |`.
- A verdict authored from the implementer's summary without independently re-running the gate.
- Softening a FAIL to PARTIAL, or PARTIAL to PASS, to avoid surfacing to the operator.
- Skipping `spur task check <wbs> --strict-core` because "it passed last run" — stale evidence is not evidence.
- Findings written as "looks good" with no `file:line` anchor.
- `verifyall --feature … --fix all` reporting all-task PASS without a `Shippable:` line.
- Treating research/grilling tickets as ship cover for feature AC scenarios they do not implement.

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
   gate misleadingly. Emit it only after the verdict is final (Step 11).
3. **Never direct-write the task file.** All findings go through `spur task update --section`.
4. **`PASS` is the only clear.** `PARTIAL` blocks the gate — there is no "good enough" pass.
5. **Bounded fix loop.** `--fix` retries once per requirement, then reports residuals — don't loop
   forever chasing a stubborn UNMET.
6. **Task PASS ≠ feature shippable.** When Step 13 is active, emit `Shippable:` and fold FAIL into
   batch cleanliness. Never auto-create implement tasks to clear shippable.

---

## Additional Resources

- [references/verdict-schema.md](references/verdict-schema.md) — the `VerifyVerdict` artifact shape
  and the per-requirement aggregation rule.
- [references/secu-review.md](references/secu-review.md) — the SECUA dimensions and finding-severity
  rubric.
- `.spur/workflows/task-pipeline.yaml` — the `verify → record` gate that consumes the verdict.
- **`sp:spur-dev`** — the execution-half umbrella that drives the pipeline this skill gates.
- [references/code-improvement.md](references/code-improvement.md) — architecture-improvement lens
  for module depth, seam placement, locality, coupling, and testability.
- **`sp:functional-review`** — a peer review skill for requirements traceability (R{n} → file:line
  evidence, per-requirement MET/PARTIAL/UNMET, `FunctionalVerdict`). When the `review` dimension
  needs functional traceability (not just SECUA), dispatch this skill; see
  [../functional-review/SKILL.md](../functional-review/SKILL.md).
- **`sp:code-improvement`** — a peer review skill for architectural deepening (5 signals: shallow
  module, tight coupling, wrong seam, weak locality, poor test surface; severity
  blocker/major/minor/advisory). When review findings expose structural friction rather than a
  localized defect, dispatch this skill; see [../code-improvement/SKILL.md](../code-improvement/SKILL.md).

---

## Platform Notes

### Claude Code

`spur` CLI via the Bash tool. Invoke via the `/sp:dev-verify` / `/sp:dev-review` commands, or
directly: `Skill(skill="sp:code-verification", args="verify <wbs> --fix all")`.

### Codex / OpenClaw / OpenCode / Antigravity

Run `spur` CLI via Bash; parse `--json`. Invoke this skill directly for the verification logic — the
skill is the SSOT; the commands are thin wrappers.
