---
schema_version: 1
name: Fold the *all commands into --all on their base commands
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:31.770Z
updated_at: "2026-11-18T05:55:08.751Z"
feature_id: H84
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 6

---

## 1390. Fold the *all commands into --all on their base commands

### Background

`dev-runall`, `dev-refineall`, `dev-verifyall` and `dev-wrapall` (`plugins/sp/commands/`) are batch scopes of `dev-run`, `dev-refine`, `dev-verify` and `dev-wrap`. Each dispatches a `sp:spur-dev` batch operation (`runall`/`runall-inline`, `refineall`, `verifyall`, `wrapall`). `dev-fixall` is a remediation loop, not a batch scope, and stays.

**Refine corrections (2026-11-17)**
- "add --all with the former batch flags" → there is a flag homonym. `dev-run --mode <full|implement>` (per-task pipeline mode) and `dev-runall --mode <sequential|parallel|auto>` (batch schedule) can't share one hint. → In the merged `dev-run`, `--mode` keeps its per-task meaning, and the batch schedule becomes `--schedule <sequential|parallel|auto>`. The `dev-runall` redirect rewrites `--mode X` to `--schedule X`.
- Selector shapes differ: `runall`/`verifyall` take `--tasks|--feature`, `refineall` takes `--feature|--tasks`, and `wrapall` takes `--since/--feature/--status` with no selector → `--all` is an explicit switch, mutually exclusive with `<wbs>`. The existing selectors narrow it, and with no selector each operation keeps its former default set.
- Runtime code depends on the command names. `dogfood/pipeline-detect.ts:12-29,54` classifies `dev-refineall`/`dev-verifyall` as pipeline-driving, and `dev-refine --all` would not match any token. `task-readiness.ts:62` and `idea-handoff.ts:459-460` emit `/sp:dev-refineall` / `/sp:dev-runall` suggestions. → The detector treats `--all` on a base command like the old `*all` token, and the emitters switch to the new spelling.
- The text footprint is larger than the docs listed → 78 non-history files mention the old names (skills, references, AGENTS.md, templates, code comments).

### Requirements

- [ ] R1. `dev-run`, `dev-refine`, `dev-verify` and `dev-wrap` accept `--all` (exclusive with `<wbs>`) plus every former `*all` flag. Their argument-hints and the `dev-operations.md` table rows list the union. Batch runs dispatch the same `sp:spur-dev` operation the former command dispatched, with the same args.
- [ ] R2. `dev-run --all` uses `--schedule <sequential|parallel|auto>` for the batch schedule, and `--mode <full|implement>` keeps its per-task meaning. This is recorded in `docs/design/dev-command-argument-contract.md`.
- [ ] R3. The four `*all` files become one-release redirects. Each states the replacement and dispatches the identical action, with `dev-runall` mapping `--mode` to `--schedule`.
- [ ] R4. `pipeline-detect.ts` classifies `dev-<base> --all` exactly as the former `*all` token, and the `task-readiness.ts` and `idea-handoff.ts` suggestions emit the new spelling. Unit tests cover both.
- [ ] R5. Update AGENTS.md routing, `plugins/sp/README.md`, init templates, and skill/reference prose that names the old commands. `command-flag-parity`, `help-docs-parity` and `bun run plugin-smoke` pass.

### Acceptance Criteria

- [ ] AC1 — Batch variants are flags on their base commands (req: R1, R2, R4)
- [ ] AC2 — Former command names redirect for one release (req: R3, R5)

Test layer: plugin parity suites over the real command files, plus unit tests on the detector and emitters.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:55:06.796Z

- **`--mode` collision in dev-run?** Closed: the batch schedule becomes `--schedule`, and the redirect rewrites it.
- **`--all` vs the selector alone?** Closed: an explicit `--all` is required, so a typo'd `<wbs>` can never silently become a batch.
- **dev-fixall?** Out of scope: it's a remediation loop, not a batch scope.

### Design

**WHAT.** Each base command gains a batch branch in its Implementation section: `--all present → Skill(sp:spur-dev, "<batch-op> $ARGUMENTS-without---all")`, and otherwise the current per-task dispatch. The `sp:spur-dev` operation names (`runall`, `refineall`, `verifyall`, `wrapall`) and `execution-batch.md` are unchanged. Only the command surface moves.

**WHY.** A batch is a scope, not a different operation. One file per verb halves the docs agents load. The `--schedule` rename is the only way to keep both `--mode` meanings without overloading a flag by context.

**WHERE.** `plugins/sp/commands/dev-{run,refine,verify,wrap}.md`, `dev-{runall,refineall,verifyall,wrapall}.md` (redirects), `plugins/sp/skills/spur-dev/references/dev-operations.md` (table rows), `docs/design/dev-command-argument-contract.md`, `packages/app/src/services/dogfood/pipeline-detect.ts`, `packages/app/src/services/task-readiness.ts`, `packages/app/src/workflow/idea-handoff.ts`, AGENTS.md, `config/templates/AGENTS.md` and `plugins/sp/README.md`.

**Anti-patterns.** Don't change batch driver behavior or workflow YAML. Don't overload `--mode`. Don't rewrite history (CHANGELOG, done tasks).

**Breaking.** `dev-runall --mode` becomes `dev-run --all --schedule`. The redirect absorbs it for one release.

### Plan

- [ ] Step 1 (test first, R1/R2/R4): add `command-flag-parity` expectations for the merged hints, plus unit tests for `pipeline-detect` (`dev-refine --all` is pipeline-driving, `dev-run --all` is implement-heavy) and the two suggestion emitters.
- [ ] Step 2 (R1/R2): edit the base commands and the `dev-operations.md` rows, then update the argument contract design.
- [ ] Step 3 (R3): write the redirects.
- [ ] Step 4 (R4/R5): code emitters, the detector and the prose migration (from an `rg` inventory, excluding history).
- [ ] Step 5: run `(cd plugins/sp && bun test tests/command-flag-parity.test.ts tests/help-docs-parity.test.ts)`, the `packages/app` focused tests, `bun run plugin-smoke`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
