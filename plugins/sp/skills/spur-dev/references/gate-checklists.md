---
name: gate-checklists
description: "Pre-gate verification checklists for the five corpus-mutating gates in the spur-dev lifecycle, plus the terminal `testing → done` gate. Each checklist is what the agent verifies BEFORE entering the gate — additive to the CLI's schema validation, catching intent errors the CLI cannot."
see_also:
  - spur-dev
  - cross-cutting
  - execution-workflow
  - planning-workflow
---

# Gate Checklists

Each gate below mutates the corpus or commits the operator to a path. Verify every checkbox before
entering the gate. A failed checkbox means stop and fix — do not enter the gate hoping the CLI will
catch it (the CLI catches schema violations, not intent errors).

Run each checklist as an actual command sequence, not a mental confirmation:

1. Read the checklist for the gate you are about to enter.
2. Run each verification command (grep, `spur task check`, `bun run lint`, etc.).
3. If any checkbox fails: stop, fix, re-run. Do not enter the gate.
4. Only when every checkbox passes: enter the gate (run the CLI verb or trigger the workflow state).

## feature-check gate

Entered before `spur feature check <id> --strict` (idea-pipeline `feature-check` state;
planning-pipeline AC validation).

- [ ] Feature file has a non-placeholder `## Goal` and `## Scope` section.
- [ ] Acceptance criteria are R-numbered scenarios in Gherkin `Feature/Scenario` form (see `ac-style-guide.md`).
- [ ] Each scenario has a stable title (renaming after task creation breaks traceability).
- [ ] No `TODO`, `TBD`, or `???` placeholders remain in the feature body.
- [ ] The `## Out of Scope` section is present and non-empty (PRD-shaped features only).
- [ ] If `--auto` is set: the AC schema is locally valid against the BDD validator before the gate runs.

## batch-create gate

Entered before `spur task batch-create --file <json>` (idea-pipeline `batch-create` state;
planning-pipeline decomposition gate).

- [ ] The batch JSON is a bare array (not an object with a `tasks` key).
- [ ] Each entry validates locally against `apps/cli/schemas/task-batch.schema.json` (`additionalProperties: false` — no unknown keys).
- [ ] Each entry has a non-empty `name` (required).
- [ ] `feature_id` matches an existing feature (or is intentionally deferred with operator awareness).
- [ ] `parent_wbs` is set when the task is a child of a decomposition parent.
- [ ] `template` is one of `feature-impl`, `issue`, `review`, `meta` — chosen per task shape.
- [ ] Requirements, AC, Design, and Plan section bodies are filled (not template placeholder comments) — schema permits empty but execution cannot run against empty sections.
- [ ] Dependencies are encoded in Background/Plan prose (the CLI does not expose `dependencies` as a field).
- [ ] If `--auto` is set: a dry-run validation against `task-batch.schema.json` was run locally and passed.

## precheck gate

Entered before `task-pipeline.yaml` `precheck` state runs `spur task check <wbs>`.

- [ ] `spur task check <wbs> --json` returns no `error`-level findings.
- [ ] The task's `feature_id` resolves to an existing feature (or is explicitly deferred with operator awareness).
- [ ] The `## Requirements` section is non-empty and R-numbered.
- [ ] The `## Acceptance Criteria` section has at least one scenario with a verify command.
- [ ] The `## Plan` section is an ordered checklist (not prose).
- [ ] The `## Design` section, if present, does not contradict the parent feature's design.
- [ ] No `TODO`, `TBD`, or `???` placeholders in Requirements, AC, Design, or Plan.

## review gate

Entered before `task-pipeline.yaml` `review` state dispatches `sp:code-verification` (SECUA review).

- [ ] The implementation matches the task's `## Plan` checklist (every checked item maps to a code/test/doc change).
- [ ] `git status` shows only changes traceable to this task's Plan (no drive-by edits).
- [ ] Lint and typecheck pass (`bun run lint`).
- [ ] Tests pass (`bun run test`) — no `.skip`, `xfail`, or commented-out tests.
- [ ] New `biome-ignore` / `eslint-disable` suppressions: none, or each is justified inline.
- [ ] No new `console.*` in scripts (use a project logger if one exists).
- [ ] The `## Solution` section records the file:line change map and rationale.
- [ ] If the change is high-stakes (code/test/infra): raw gate tails are captured for the `## Testing` section.

## verify gate

Entered before `task-pipeline.yaml` `verify` state produces a task verdict.

- [ ] `spur task check <wbs> --strict-core --json` returns PASS.
- [ ] Every AC scenario has a corresponding verify command that exited 0.
- [ ] The `## Solution` section is filled (not the placeholder comment).
- [ ] The `## Testing` section records the commands run and their outcomes.
- [ ] The `## Review` section records findings (or explicitly states "no findings").
- [ ] No gate was bypassed with `--no-verify`, `--force`, or a suppression comment.
- [ ] If `--auto` is set: the verdict is `PASS` (not `PARTIAL` or `FAIL`) — `--auto` does not auto-advance a failed verify.
- [ ] The task is ready for `spur task record <wbs>` and legal transition to `done`.

## done gate (`testing → done`)

The terminal chain link: `/sp:dev-verify <wbs> --next` transitions `testing → done` on the
(post-`--fix`) PASS verdict. The transition runs **three** gate layers in the order below; a
failure at any layer stops the transition with that layer's remediation. **No `--no-lifecycle`:**
these guards are the final defense-in-depth check before `done`.

> **Precondition — `/sp:dev-review` must have run first** on a standalone
> `--next` invocation. Verify mode is forbidden from writing `## Review` (code-
> verification SKILL.md Step 10), yet the done-gate's Review L3 layer (see
> below) requires a populated P1–P4 `### Review` table. So a standalone
> `/sp:dev-verify --next` on a task that skipped `/sp:dev-review` cannot reach
> `done` unaided — the stop message will name the missing Review. The Step 10
> write prohibition stays intact; the contract tension is real and intentional.
> Pipeline-driven runs satisfy this automatically (the pipeline's `review`
> state runs `/sp:dev-review` before `verify`).

When `--fix` is set, `--next` acts on the **post-fix** verdict: the fix pass repairs findings, the
skill re-verifies (Step 10's bounded loop), and the **re-verified** verdict drives the transition.
A `--fix all` that turns a FAIL into a PASS therefore reaches `done`; a residual UNMET after the
bounded retry does not.

### The three `testing → done` gate layers

The CLI verdict-artifact check runs first. The lifecycle adapter then checks provenance, Review L3,
and finally the workflow's strict-core shell guard. The table groups the two complementary
strict-core/verdict checks as one defense-in-depth layer even though they bracket the adapter checks.
The first denial wins; each denial names its own remediation. In verify-0293, the artifact check
passed, so provenance denied first and Review L3 denied on the retry.

| # | Gate layer | Triggers denial when | Remediation |
|---|------------|----------------------|-------------|
| 1 | **Strict-core + verdict artifact** (`spur task check <wbs> --strict-core` + `done-transition-guard.ts`) | The strict-core check fails, or `.spur/run/<wbs>-verdict.json` is **missing** or has a non-PASS aggregate. **Missing artifact is a deny** (not a silent allow — closes the 0349 "done without verdict" class). The aggregate is recomputed from requirement/AC rows; the harsher of stored and computed wins. | Re-run `/sp:dev-verify <wbs>` until PASS (writes the artifact), or explicitly override with `spur task update <wbs> done --force-done --reason "<why>"`. Docs-only pipelines write a docs PASS stub under `.spur/run/` before `done` (see `docs-pipeline.yaml`). |
| 2 | **Provenance guard** (`lifecycle-adapter.ts`) | No pipeline-kind run link exists for `<wbs>`. | Run `/sp:dev-run <wbs>` through the pipeline, use `/sp:dev-run <wbs> --auto --next`, or record the audited bypass with `SPUR_PROVENANCE_OVERRIDE=1`. |
| 3 | **Review L3** (`task-check.ts`) | `### Review` is empty, placeholder-only, or lacks a populated P1–P4 findings table. | Run `/sp:dev-review <wbs>`; verify cannot write Review because of the Step 10 prohibition above. |

When the verdict is **PARTIAL/FAIL**, or any gate layer fails: stop as review-pending — surface
the verdict (or the gate's blocking finding), leave the task at its current status, do NOT
transition to `done`.

> **Already-terminal task (`--force` re-audit):** when the task is already `done`/`cancelled`, a
> PASS verdict has no transition to make — `--next` is a no-op. The CLI prints the honest message
> `<wbs>: already <status> — no transition` (task 0292 R9) and exits 0. Do not expect a
> `testing → done` transition line.

> **Answer-file shape (R3).** The verify step's structured output (`.spur/run/<wbs>-verify-answer.txt`)
> is parsed by `spur task verdict` to derive the artifact. Free-form prose with no markdown
> requirement/AC tables parses to `verdict: "UNKNOWN"` and will deny the done-gate. The expected
> table format (`| Req | Status | Evidence |` and `| AC | Status | Evidence Type | Evidence |`)
> is documented in [sp:spur-cli `tasks/verbs.md` §Answer-file shape](../../spur-cli/references/tasks/verbs.md#answer-file-shape-what---from-answer-parses).
> The verify skill writes this shape automatically — operators only need it when hand-authoring
> an answer file or debugging an UNKNOWN verdict.
