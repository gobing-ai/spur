---
schema_version: 1
name: Fold the *all commands into --all on their base commands
status: done
template: feature-impl
created_at: 2026-11-18T05:29:31.770Z
updated_at: "2026-11-18T20:08:22.624Z"
feature_id: H84
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 6

done_forced: "false"
done_reason: unforced close
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

- [x] R1. `dev-run`, `dev-refine`, `dev-verify` and `dev-wrap` accept `--all` (exclusive with `<wbs>`) plus every former `*all` flag. Their argument-hints and the `dev-operations.md` table rows list the union. Batch runs dispatch the same `sp:spur-dev` operation the former command dispatched, with the same args.
- [x] R2. `dev-run --all` uses `--schedule <sequential|parallel|auto>` for the batch schedule, and `--mode <full|implement>` keeps its per-task meaning. This is recorded in `docs/design/dev-command-argument-contract.md`.
- [x] R3. The four `*all` files become one-release redirects. Each states the replacement and dispatches the identical action, with `dev-runall` mapping `--mode` to `--schedule`.
- [x] R4. `pipeline-detect.ts` classifies `dev-<base> --all` exactly as the former `*all` token, and the `task-readiness.ts` and `idea-handoff.ts` suggestions emit the new spelling. Unit tests cover both.
- [x] R5. Update AGENTS.md routing, `plugins/sp/README.md`, init templates, and skill/reference prose that names the old commands. `command-flag-parity`, `help-docs-parity` and `bun run plugin-smoke` pass.

### Acceptance Criteria

- [x] AC1 — Batch variants are flags on their base commands (req: R1, R2, R4)
- [x] AC2 — Former command names redirect for one release (req: R3, R5)

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

| File | Lines | What/Why |
| --- | --- | --- |
| `plugins/sp/commands/dev-run.md` | 5, 13-30, 38-86 | R1/R2: `--all` + the former `dev-runall` flags on the hint and table; the batch contract prose (feature preflight abort, `--schedule auto` resolution, `--worktree` rejection, batch-once `--next`, three axes, executor pin, corpus visibility) moved into `## Usage` — a batch is a scope of this command now. |
| `plugins/sp/commands/dev-refine.md`, `dev-verify.md`, `dev-wrap.md` | hints + tables + Implementation | R1: `--all` plus each former `*all` flag, and a batch branch naming the unchanged `sp:spur-dev` operation. |
| `plugins/sp/commands/dev-{run,refine,verify,wrap}all.md` | 1-46 | R3: one-release redirects — description, forwarded flags table (what they accept), `## Usage` showing the replacement, `## Implementation` naming the unchanged operation. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | 74-91 | R1: base rows carry the union; the four `*all` rows stay as deprecated redirects so both spellings are catalogued. |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | 187-200, 282-302, 307-315, 366-372, 528-536, 231-236 | `--all` now documents both senses (batch scope and domain widening); `--concurrency` moves to `dev-run --all --schedule parallel`; declaring-command lists corrected for `--force`, `--tasks`, `--fix`, `--worktree`. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md`, `execution-worktree.md`, `execution-batch-report.md` + `AGENTS.md` anchors | — | The batch schedule flag is `--schedule` everywhere the surface describes it; anchor links re-pointed. |
| `plugins/sp/skills/**`, `plugins/sp/agents/**`, `plugins/sp/README.md`, `AGENTS.md`, `config/templates/AGENTS.md`, `docs/help/**` | — | R5: prose migration off the retired names (58 files), README index keeps the four redirects plus a note that the batch scope is `--all`. |
| `packages/app/src/services/dogfood/pipeline-detect.ts` | 17-42, 96-125, 150-157 | R4: `batchScopeBase()` — `--all` on a base dev command classifies exactly as the `dev-<base>all` token did, for driving and implement-heavy, while `--all` alone stays inert (`spur task list --all`). |
| `packages/app/src/services/task-readiness.ts` | 62 | R4: recovery hint emits `/sp:dev-refine --all --feature …`. |
| `packages/app/src/workflow/idea-handoff.ts` | 459-461 | R4: both suggestions emit the merged spelling. |
| `packages/app/tests/services/dogfood/pipeline-detect.test.ts` | new describe block | R4 unit coverage: four batch positives, four non-batch negatives, implement-heavy split, retired spellings still classify. |
| `packages/app/tests/workflow/idea-handoff.test.ts`, `apps/cli/tests/fixtures/script-absorption-pr5-golden.json` | — | Emitter assertions and the golden parity fixture follow the new spelling. |
| `docs/design/dev-command-argument-contract.md` | new section | R2: the base-command/batch-form mapping, the `--mode` vs `--schedule` split, and how parity holds through the move. |
| `plugins/sp/tests/**`, `scripts/commands/**` | — | Retargeted to the merged owners rather than deleted: parity R8/R5/R7, thin-wrapper and least-privilege sweeps, runtime-requires group counts, executor-selection and shipping-readiness contracts, and the flag-contract C1/C2 real-tree gate (0 violations). The synthetic C1/C2 checker fixtures keep naming real command files. |

`smart routing` note: mem no. Public-surface probe: no new CLI/HTTP route — `dev-run`, `dev-refine`, `dev-verify`, `dev-wrap` gain a flag; four command files become redirects; `sp:spur-dev` operations, workflow YAML and the batch driver are untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 `--all` (+ former `*all` flags) on the four base commands, hints and `dev-operations.md` rows | MET | static-ref: `plugins/sp/commands/dev-run.md:5,13-30`, `dev-refine.md:5`, `dev-verify.md:5`, `dev-wrap.md:5`; `plugins/sp/skills/spur-dev/references/dev-operations.md:74-91`; test: `plugins/sp/tests/command-flag-parity.test.ts` R8 forward+reverse over all four (hint ↔ table row) |
| R2 `dev-run --all` uses `--schedule`, `--mode` keeps its per-task meaning, recorded in the argument contract | MET | static-ref: `plugins/sp/commands/dev-run.md:5,22,38-41` (`--mode <full\|implement>` row kept, `--schedule` row added); `docs/design/dev-command-argument-contract.md` § "Batch scope on the base commands" ; `plugins/sp/skills/spur-dev/references/execution-batch.md` §2.4a retitled |
| R3 four `*all` files are one-release redirects naming the replacement and dispatching the same action | MET | static-ref: `plugins/sp/commands/dev-{run,refine,verify,wrap}all.md` (description + `## Usage` + `## Implementation` naming the unchanged `sp:spur-dev` operation); test: `scripts/commands/command-contract.test.ts` heading/frontmatter/thin-wrapper gates, `plugins/sp/tests/skill-structure.test.ts` R21b/R30 |
| R4 `pipeline-detect` classifies `dev-<base> --all` as the retired token; emitters emit the new spelling; unit tests | MET | static-ref: `packages/app/src/services/dogfood/pipeline-detect.ts:17-42` (`batchScopeBase`), `:96-105`, `:150-157`; `packages/app/src/services/task-readiness.ts:62`; `packages/app/src/workflow/idea-handoff.ts:459-461`; test: `packages/app/tests/services/dogfood/pipeline-detect.test.ts` (4 positives, 4 negatives, implement-heavy split, retired spellings), `idea-handoff.test.ts`, `task-readiness.test.ts` |
| R5 AGENTS.md, README, templates, skill/reference prose; parity gates + plugin-smoke pass | MET | static-ref: 58-file prose migration (`AGENTS.md`, `config/templates/AGENTS.md`, `plugins/sp/**`, `docs/help/**`), README index (redirect rows + batch-scope note); test: `command-flag-parity` (113), `help-docs-parity`, `skill-structure` (99), `scripts/commands` contract suites, `bun run plugin-smoke` PASS; remaining old spellings only in README redirect rows, glossary declarer lists, dev-operations redirect rows and the machine-checked dogfood token inventory |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 batch variants are flags on their base commands (R1, R2, R4) | MET | test | `command-flag-parity` hint/table parity for the four bases; `pipeline-detect` unit block; `flag-contract-parity` real-tree gate reports 0 violations |
| AC2 former command names redirect for one release (R3, R5) | MET | test | `command-contract` heading/frontmatter/thin-wrapper over all 43 commands; `skill-structure` R21b/R30; README index (R43) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of run 51797129 — verdict tables (merged fragments, backfill bare only).

| Req | Status | Evidence |
| --- | --- | --- |
| R1 `--all` + former `*all` flags on the four base commands | MET | static-ref: `plugins/sp/commands/dev-{run,refine,verify,wrap}.md:5` + Argument Flags tables; `plugins/sp/skills/spur-dev/references/dev-operations.md:74-91`; test: `command-flag-parity` R8 both directions |
| R2 `--schedule` for the batch schedule; `--mode` keeps its meaning; design recorded | MET | static-ref: `plugins/sp/commands/dev-run.md:5,22,38-41`; `docs/design/dev-command-argument-contract.md` (Batch scope section); `execution-batch.md` §2.4a |
| R3 four `*all` files are one-release redirects | MET | static-ref: `plugins/sp/commands/dev-{run,refine,verify,wrap}all.md`; test: `command-contract` (headings, frontmatter, thin wrapper), `skill-structure` R21b/R30 |
| R4 detector + emitters follow the merged spelling | MET | static-ref: `packages/app/src/services/dogfood/pipeline-detect.ts:17-42,96-105,150-157`; `task-readiness.ts:62`; `idea-handoff.ts:459-461`; test: `pipeline-detect.test.ts` (new block), `idea-handoff.test.ts`, `task-readiness.test.ts` |
| R5 prose migration + parity gates + plugin-smoke | MET | static-ref: 58 files (AGENTS.md, templates, plugin prose, docs/help), README index; test: parity 113, skill-structure 99, scripts/commands suites, `plugin-smoke` PASS |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 batch variants are flags on their base commands | MET | test | `command-flag-parity` hint/table parity; `pipeline-detect` unit block; `flag-contract-parity` real-tree 0 violations |
| AC2 former names redirect for one release | MET | test | `command-contract` over 43 commands; `skill-structure` R21b/R30; README R43 |

P2 fixed in-run: mirrored tables in the redirects tripped the ADR-054 duplicate-catalog gate — each redirect now documents only the flags it forwards. P3 accepted: wayfinder body baseline +6 bytes for the rename; both spellings stay catalogued for one release (only remaining old-name sites, by design). P4: `--concurrency` mirrored in `dev-runall`'s own row, assertions name both files. No P1.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T20:07:11.511Z todo → wip (system)
- 2026-11-18T20:08:19.607Z wip → testing (system)
- 2026-11-18T20:08:22.616Z testing → done (system)

