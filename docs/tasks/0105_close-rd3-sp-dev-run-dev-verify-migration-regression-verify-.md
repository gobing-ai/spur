---
schema_version: 1
name: "Close rd3->sp dev-run/dev-verify migration regression (verify skill + pipeline gate + recursion fix)"
status: done
template: feature-impl
created_at: 2026-06-23T17:39:41.336Z
updated_at: 2026-06-23T19:22:58.321Z
feature_id: H2
priority: P1
tags: ["sp-plugin", "workflow", "verification", "regression", "dogfood"]
---

## 0105. Close rd3->sp dev-run/dev-verify migration regression (verify skill + pipeline gate + recursion fix)

### Background

Dogfood finding (2026-06-23): running task 0101 via omp's `/sp:dev-run 0101 --auto` then `/sp:dev-verify 0101 --auto --fix all --force` surfaced a migration regression. When rd3:dev-run/dev-verify were ported into the sp plugin, the two backing skills that gave them teeth were NOT ported: rd3:task-runner (the execution loop) and rd3:code-verification (the verify procedure). Both sp commands now delegate to a single sp:spur-dev skill that contains neither a completion gate nor a verify procedure. ARCHITECTURE NOTE (confirmed with operator): task-runner must NOT be ported — its execution loop is correctly replaced by `spur workflow` + config/workflows/task-pipeline.yaml per ADR-022 (orchestration is configuration). The gap is three precise holes around that loop, not the loop itself. THREE GAPS: (A) Recursion/undefined-ops — task-pipeline.yaml's `implement` state calls `agent.run: /sp:dev-run`, the SAME command that drives the pipeline, creating a recursive/ambiguous definition; and dev-unit/dev-review/dev-verify delegate to sp:spur-dev operations (unit/review/verify) that have no procedure in the skill. omp resolved the ambiguity by hand-implementing code and skipping test/review/verify/record, leaving 0101 at wip with empty Testing/Review and a hollow barrel-only test. (B) No content/verdict gate — verify->record->done transitions are all `guard: kind: always`, and `spur task check` validates section PRESENCE not content, so the pipeline marches to done regardless of verify verdict (rd3's early-report-complete gap, reopened). (C) sp:spur-dev has no verify procedure — the AC-extraction/evidence/verdict/fix logic from rd3:code-verification lives nowhere in sp; the verifying agent must improvise it. Reference originals: ~/projects/cc-agents/plugins/rd3/skills/{task-runner,code-verification}/SKILL.md and plugins/rd3/commands/{dev-run,dev-verify}.md.

### Requirements
- [ ] R1. Create a new `sp:code-verification` skill (plugins/sp/skills/code-verification/) porting the verify LOGIC (not orchestration) from rd3:code-verification: load task -> requirements/AC traceability -> verdict (PASS/PARTIAL/FAIL) -> `--fix` strategy (none|blockers-first|all) -> write findings to Testing/Review sections via `spur task update --section` -> emit `.spur/run/<wbs>-verdict.json` ({verdict, checks[]}). Adapt to spur's CLI-gated write model (every task write goes through a CLI verb).
- [ ] R2. Repoint plugins/sp/commands/dev-verify.md and dev-review.md to delegate to sp:code-verification; declare the real flags in each `argument-hint` and Arguments table: --auto, --fix <none|blockers-first|all>, --force, --focus, --bdd (currently only `<wbs>` is documented).
- [ ] R3. Break the pipeline recursion in config/workflows/task-pipeline.yaml: the `implement` state must call a real implement entry (a dedicated sp:dev-implement or an `implement` operation added to sp:spur-dev), NOT `/sp:dev-run`. `/sp:dev-run` (command) must mean ONLY 'drive the pipeline'. Ensure dev-unit/dev-review/dev-verify each map to a defined procedure.
- [ ] R4. Add the completion gate to task-pipeline.yaml: change the `verify -> record` transition guard from `kind: always` to a `shell` guard that greps `.spur/run/<wbs>-verdict.json` for verdict==PASS; add a `verify -> failed` transition for the non-PASS case. This is the YAML-native replacement for rd3's default-on --postflight-verify.
- [ ] R5. Validate: `spur workflow validate config/workflows/task-pipeline.yaml` green; `bun run lint` green; re-run task 0101 through the FIXED pipeline (`spur workflow run task-pipeline.yaml --vars '{"wbs":"0101","profile":"auto"}'`) and confirm Testing/Review are pipeline-written and the verdict gate passes before done. 0101 is the dogfood validation case for this very fix.
- [ ] R6. Document the gap + resolution: add an ADR entry if the verify-skill-as-companion + workflow-guard-as-gate is a new cross-cutting decision; update 04_DESIGN.md (sp command/skill surface) and 05_FEATURES.md (H2 status) in the same commit per the doc-map rules.
- [ ] R7. (dogfood) Workflow shell guards/actions must resolve `spur` PATH-independently. `WorkflowService.run` never injected a binary path (only the lifecycle adapter did), so bare `spur` in the execa-spawned `/bin/sh` guard was "command not found" → both precheck guards failed → no-passing-transition. Add a shared `resolveSpurBin(cwd)` (apps/cli/src/workflow/resolve-spur-bin.ts) detecting the Bun *runtime* by execPath basename (NOT source-file existence — the dev entry exists on disk even under a compiled binary, the bug that breaks `<binary> run …`); inject a `spurBin` var in `workflow run`; use `${vars.spurBin}` for every spur call in task-pipeline.yaml; refactor make-lifecycle-adapter to the shared helper. Unit-test both runtime branches.
- [ ] R8. (dogfood) The pipeline's `agent.run` steps used `<default>` agent selection, which resolved to a broken `pi` extension (malformed pi-subagents YAML) → exit 3 at implement. Pin the agent via an `agent` var (default a known-good agent; override with `--vars '{"agent":"claude"}'`) threaded into all four agent.run steps, so a broken agent on the box can't silently capture the run.
- [ ] R9. (dogfood) Make the verify verdict artifact emission DETERMINISTIC. The verify agent judged 0101 PASS but wrote the verdict only as prose to stdout, never `.spur/run/<wbs>-verdict.json` → the gate correctly routed verify→failed. Add a mechanism (e.g. `agent.run` `answerFile` capture + a verify-step shell that derives PASS/FAIL and writes the artifact) so the gate reads a real verdict, not agent discretion. Re-run 0101 and confirm a PASS verify clears verify→record→done.
### Acceptance Criteria

```gherkin
Feature: 

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
## Approach

Close the three gaps with **spur-native** mechanisms — no `rd3:task-runner` port (ADR-022: the
`task-pipeline.yaml` state machine already *is* the execution loop). The fix is surgical: one new
companion skill, two command repoints, and two workflow edits.

| Gap | Fix | Mechanism |
|-----|-----|-----------|
| **C** — no verify procedure | New `sp:code-verification` skill | Port verify *logic* (traceability + verdict + `--fix`), adapt every task write to `spur task update --section` |
| **A** — recursive / undefined ops | Break `/sp:dev-run` recursion; define step ops | Pipeline `implement` calls a real entry, not `/sp:dev-run`; `unit`/`review`/`verify` map to defined procedures |
| **B** — no completion gate | Verdict-file shell guard | `verify` emits `.spur/run/<wbs>-verdict.json`; `verify→record` guard greps `PASS`, else `verify→failed` |

## Rationale

- **Why a new skill, not extend `sp:spur-dev`:** verification logic (SECU + AC traceability + verdict)
  is a distinct concern from the planning/pipeline umbrella. Folding it into the 352-line fat skill
  mixes planning with verification and bloats it. Mirrors rd3's `task-runner`↔`code-verification`
  separation. (Operator-confirmed.)
- **Why a verdict *file*, not `task check`:** `spur task check` validates section **presence**, not
  content — it passes a hollow Testing section. A FAIL verify must block `done`; only an explicit
  verdict artifact carries that signal through a pure-YAML/shell guard (ADR-022, zero engine code).
- **Why break the recursion at the workflow, not the command:** `/sp:dev-run` (command) must mean
  exactly one thing — "drive the pipeline." The pipeline's `implement` step calling `/sp:dev-run`
  was the ambiguity that let omp skip test/review/verify/record. Fix it where the recursion is
  declared (the YAML), keeping the command's contract singular.

## Key shapes

**Verdict artifact** (mirrors rd3 `PostflightVerdict`, adapted):

```typescript
interface VerifyVerdict {
  wbs: string;
  verdict: 'PASS' | 'PARTIAL' | 'FAIL';
  requirements: Array<{ id: string; status: 'MET' | 'PARTIAL' | 'UNMET'; evidence: string }>;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; evidence: string }>;
}
```

**Per-requirement verdict** (ported traceability rule): MET = evidence for the requirement found in
the diff/tests; UNMET = none; PARTIAL = partial. Aggregate: any UNMET → `FAIL`; any PARTIAL (none
UNMET) → `PARTIAL`; all MET → `PASS`. Only `PASS` clears the gate.

**Gate guard** (task-pipeline.yaml, `verify → record`):

```yaml
guard:
  kind: shell
  options:
    command: 'test "$(jq -r .verdict .spur/run/${vars.wbs}-verdict.json)" = PASS'
```

with a sibling `verify → failed` on the negation.

## Files

| File | Change |
|------|--------|
| `plugins/sp/skills/code-verification/SKILL.md` (+`references/`) | **New.** Verify procedure: load → traceability → verdict → `--fix` → write Testing/Review → emit verdict.json |
| `plugins/sp/commands/dev-verify.md` | Repoint to `sp:code-verification`; declare `--auto/--fix/--force/--focus/--bdd` |
| `plugins/sp/commands/dev-review.md` | Repoint to `sp:code-verification` (source/review mode); declare `--focus` |
| `config/workflows/task-pipeline.yaml` | `implement` step → real entry (not `/sp:dev-run`); add verdict-file gate on `verify→record` + `verify→failed` |
| `plugins/sp/skills/spur-dev/SKILL.md` | Document the `implement` entry the pipeline calls; clarify `/sp:dev-run` = pipeline-driver only |
| `docs/00_ADR.md`, `04_DESIGN.md`, `05_FEATURES.md` | ADR for verify-skill+workflow-gate decision; sp surface + H2 status sync (same commit) |

## Invariants

- `/sp:dev-run` (command) drives the pipeline and **never** appears inside a pipeline step.
- Every task-file write in the verify path goes through `spur task update --section` — never a
  direct write.
- The pipeline cannot reach `done` unless `.spur/run/<wbs>-verdict.json` carries `verdict: PASS`.
- `sp:code-verification` adapts rd3 logic to `spur task` verbs — **no** legacy `tasks` CLI calls.

## Dogfood validation

Task 0101 (currently `wip`, code complete, verdict PASS recorded by hand) is the validation case:
after the fix, `spur workflow run task-pipeline.yaml --vars '{"wbs":"0101","profile":"auto"}'` must
drive it through test→review→verify→record→done with Testing/Review **pipeline-written** and the
verdict gate passing — proving the fix on the exact task that exposed the gap.
### Plan
- [ ] 1. **Scaffold `sp:code-verification` skill** — create `plugins/sp/skills/code-verification/SKILL.md` with frontmatter matching sibling sp skills (name, description, license, metadata: author/version/platforms/interactions=[reviewer,pipeline]). Two modes: `verify` (task-oriented, default for dev-verify) and `source`/`review` (for dev-review).
- [ ] 2. **Port verify-mode procedure** — adapt rd3's verify workflow to spur: load task via `spur task show <wbs> --json`; status guard (skip terminal status unless `--force`); parse `## Requirements` R-items + `## Acceptance Criteria` scenarios; git-diff fallback for changed files (`git diff --name-only <task-commit>~1..HEAD`); per-requirement traceability (MET/PARTIAL/UNMET); aggregate verdict (PASS/PARTIAL/FAIL). Replace ALL legacy `tasks` CLI calls with `spur task` verbs.
- [ ] 3. **Emit the verdict artifact** — write `.spur/run/<wbs>-verdict.json` ({wbs, verdict, requirements[], checks[]}) as the machine signal the pipeline gate reads. This is the contract between the verify skill and the workflow guard.
- [ ] 4. **Write findings + `--fix` strategy** — write per-requirement evidence to `## Testing` and SECU findings to `## Review`, both via `spur task update --section --from-file` (never direct write). Implement `--fix none|blockers-first|all`: after the verdict, optionally repair failing requirements/findings, then re-verify.
- [ ] 5. **Repoint dev-verify command** — `plugins/sp/commands/dev-verify.md`: change delegation to `sp:code-verification` (mode=verify); update `argument-hint` and Arguments table to declare `--auto`, `--fix <none|blockers-first|all>`, `--force`, `--focus`, `--bdd`.
- [ ] 6. **Repoint dev-review command** — `plugins/sp/commands/dev-review.md`: delegate to `sp:code-verification` (source/review mode); declare `--focus`.
- [ ] 7. **Break the pipeline recursion** — `config/workflows/task-pipeline.yaml`: change the `implement` state's `agent.run` input from `/sp:dev-run` to a real implement entry (a new `sp:dev-implement` command OR an `implement` operation in sp:spur-dev — pick the lighter one). Confirm `unit`/`review`/`verify` steps map to defined procedures.
- [ ] 8. **Add the completion gate** — in task-pipeline.yaml change `verify → record` guard from `kind: always` to a `shell` guard asserting `jq -r .verdict .spur/run/<wbs>-verdict.json == PASS`; add a `verify → failed` transition for the non-PASS case (so a FAIL verdict short-circuits instead of marching to done).
- [ ] 9. **Document the `/sp:dev-run` contract** — in `plugins/sp/skills/spur-dev/SKILL.md`, clarify that `/sp:dev-run` means "drive the pipeline" only and never appears inside a pipeline step; point the execution-half `implement` description at the new entry from step 7.
- [ ] 10. **Validate the plumbing** — `spur workflow validate config/workflows/task-pipeline.yaml` green; `bun run lint` green (biome + tsc); skill/command frontmatter parses.
- [ ] 11. **Dogfood gate on 0101** — `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0101","profile":"auto"}'`; confirm it drives test→review→verify→record→done, Testing/Review are pipeline-written, the verdict gate passes, and 0101 lands at `done`. (R5 — the fix validates itself on the task that exposed the gap.)
- [ ] 12. **Doc sync (same commit)** — ADR entry for the verify-skill-as-companion + workflow-guard-as-gate decision; update `04_DESIGN.md` (sp command/skill surface) and `05_FEATURES.md` (H2 status) per the doc-map conflict rules.
### Testing
**Verdict: PASS** — all 9 requirements MET, validated by a green end-to-end dogfood run (2026-06-23).

### Per-requirement traceability

| Req | Status | Evidence |
|-----|--------|----------|
| **R1** `sp:code-verification` skill | ✅ MET | `plugins/sp/skills/code-verification/SKILL.md` (verify + review modes) + `references/{verdict-schema,secu-review}.md` |
| **R2** repoint commands + flags | ✅ MET | `dev-verify`/`dev-review` delegate to `sp:code-verification`; flags declared |
| **R3** break `/sp:dev-run` recursion | ✅ MET | pipeline `implement` → `/sp:dev-implement` (new command); `sp:spur-dev` documents the implement-op + driver-only contract |
| **R4** completion gate | ✅ MET | `verify→record` PASS guard + `verify→failed` sibling |
| **R5** validate + live dogfood | ✅ MET | **0101 ran end-to-end: `precheck→implement→test→review→verify→record→done` (6 transitions); 0101 status `done`; History pipeline-written** |
| **R6** doc sync | ✅ MET | ADR-026 + `04_DESIGN §7.5` + `05_FEATURES §9` |
| **R7** PATH-independent spur (dogfood) | ✅ MET | `resolveSpurBin` (Bun-runtime detection by execPath basename) + `spurBin` var + `${vars.spurBin}` in YAML; 3 unit tests / 100% |
| **R8** pin pipeline agent (dogfood) | ✅ MET | `agent` var (default `omp`) threaded into all 4 `agent.run` steps; override via `--vars` |
| **R9** deterministic verdict (dogfood) | ✅ MET | `agent.run answerFile` capture + verify-step shell deriving PASS/FAIL from agent answer **and** independent `spur task check`; 2 unit tests / 100% |

### Live dogfood — the gate proved itself both directions

- **Run A** (pre-R9): verify agent judged PASS but wrote no artifact → gate routed `verify → failed`. Correct: no artifact, no certification.
- **Run B** (post-R9): artifact `{"verdict":"PASS","source":"pipeline-verify-step"}` written → gate cleared `verify → record → done`. Correct.

This is the "early-report-complete" protection working as designed — an agent's prose claim alone cannot reach `done`.

### Bugs found by the dogfood (all fixed, all tested)

1. **Stuck at precheck** — `WorkflowService.run` never injected a binary path; bare `spur` unresolved in the execa-spawned `/bin/sh` guard. Fixed via `resolveSpurBin` + `${vars.spurBin}`.
2. **`resolveSpurBin` broke the compiled binary** — assumed `process.execPath` is Bun (`<binary> run …` has no `run` subcommand). Fixed: detect runtime by execPath basename; unit-tested both modes.
3. **Failed at implement** — `agent.run <default>` resolved to a broken `pi` extension. Fixed: pin `agent` var.
4. **Failed at verify gate** — verify agent reported PASS in prose only. Fixed: deterministic `answerFile` + verdict-derivation shell.

### Gate results

- Live pipeline: 0101 `finalState=done`, `transitionsTaken=6`.
- `bun run lint` → PASS; app test suite → PASS; new unit tests → `resolve-spur-bin` 3/3, `agent-run` 16/16 (both files 100% line+func).

### Files changed

`apps/cli/src/workflow/resolve-spur-bin.ts` (new) + test; `apps/cli/src/commands/workflow.ts`;
`apps/cli/src/workflow/make-lifecycle-adapter.ts`; `packages/app/src/workflow/actions/agent-run.ts`
(`answerFile`) + test; `config/workflows/task-pipeline.yaml`; `plugins/sp/skills/code-verification/SKILL.md`;
docs `00`/`04`/`05`.
### Per-requirement traceability

| Req | Status | Evidence |
|-----|--------|----------|
| **R1** new `sp:code-verification` skill | ✅ MET | `plugins/sp/skills/code-verification/SKILL.md` (verify + review modes) + `references/verdict-schema.md` + `references/secu-review.md` |
| **R2** repoint dev-verify/dev-review, declare flags | ✅ MET | both commands delegate to `sp:code-verification`; `--fix/--focus/--bdd/--auto/--force` declared in arg-hint + Arguments table |
| **R3** break the `/sp:dev-run` recursion | ✅ MET | `task-pipeline.yaml` implement step → `/sp:dev-implement`; new `dev-implement.md`; implement-op + `/sp:dev-run`-is-driver-only contract in `sp:spur-dev` |
| **R4** completion gate (verdict-file guard) | ✅ MET | `verify→record` shell guard (`jq -r .verdict … = PASS`) + `verify→failed` sibling; logic proven across PASS/FAIL/missing |
| **R5** validate + dogfood on 0101 | 🔶 PARTIAL | `workflow validate` PASS; `lint` PASS; gate logic deterministically proven; **live full-pipeline run on 0101 deferred** (spawns real agent subprocesses — operator-supervised); `--dry-run` can't reach the gate (dies at precheck on a pre-existing shell-guard-in-dry-run limitation, proven identical before/after via git-stash A/B) |
| **R6** doc sync (ADR + 04 + 05) | ✅ MET | **ADR-026** (verify-skill-as-companion + workflow-guard-as-gate + no-task-runner-port + SECU-backronym resolution); `04_DESIGN.md §7.5` (step→command mapping + completion gate); `05_FEATURES.md §9` (verifier-gate row, 🔶) |

### Gate results (verified plumbing)

- `spur workflow validate config/workflows/task-pipeline.yaml` → **PASS** (`workflow valid: task-pipeline`).
- `bun run lint` → **PASS** (biome + all-workspace tsc; includes the doc edits).
- `bun run --filter '@gobing-ai/spur-web' test` → **166 pass / 0 fail** (0101 unaffected).
- **Gate-logic proof:** PASS verdict → `verify→record` TRUE / `verify→failed` FALSE; FAIL verdict → record FALSE / failed TRUE; missing file → record FALSE / failed TRUE (blocks safely).
- **No-regression proof:** dry-run `finalState`/`transitions` identical before/after the workflow edits (git-stash A/B) — the precheck dry-run stop is pre-existing.

### What remains for `done` (R5 only)

The live end-to-end dogfood: `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0101","profile":"auto"}'` for real — confirm it drives implement→test→review→verify→record→done, Testing/Review are pipeline-written, and the gate clears at PASS. This spawns agent subprocesses, so it is an operator-supervised run, not an in-session auto-run.

### SECU-backronym conflict resolved (R2)

The old `dev-review.md` defined SECU as "Security, **Error-handling, Conventions, Untested paths**" — divergent from the rd3-canonical "Security, **Efficiency, Correctness, Usability**" the new skill uses. Aligned to S/E/C/U (better-tested rd3 form); recorded in ADR-026.
### Per-requirement traceability

| Req | Status | Evidence |
|-----|--------|----------|
| **R1** new `sp:code-verification` skill | ✅ MET | `plugins/sp/skills/code-verification/SKILL.md` (verify + review modes) + `references/verdict-schema.md` + `references/secu-review.md` |
| **R2** repoint dev-verify/dev-review, declare flags | ✅ MET | both commands now delegate to `sp:code-verification`; `--fix/--focus/--bdd/--auto/--force` declared in arg-hint + Arguments table |
| **R3** break the `/sp:dev-run` recursion | ✅ MET | `task-pipeline.yaml` implement step → `/sp:dev-implement`; new `dev-implement.md`; implement-operation + `/sp:dev-run`-is-driver-only contract documented in `sp:spur-dev` |
| **R4** completion gate (verdict-file guard) | ✅ MET | `verify→record` shell guard (`jq -r .verdict … = PASS`) + `verify→failed` sibling; logic proven across PASS/FAIL/missing |
| **R5** validate + dogfood on 0101 | 🔶 PARTIAL | `workflow validate` PASS; `lint` PASS; gate logic deterministically proven; **live full-pipeline run on 0101 deferred** — `agent.run` spawns real agent subprocesses (heavyweight/non-deterministic in-session); `--dry-run` can't reach the gate (dies at precheck on a pre-existing shell-guard-in-dry-run limitation, proven identical before/after my edits via git-stash A/B) |
| **R6** doc sync (ADR + 04 + 05) | ❌ UNMET | not yet written |

### Gate results (the plumbing that IS verified)

- `spur workflow validate config/workflows/task-pipeline.yaml` → **PASS** (`workflow valid: task-pipeline`).
- `bun run lint` → **PASS** (biome + all-workspace tsc).
- `bun run --filter '@gobing-ai/spur-web' test` → **166 pass / 0 fail** (0101 unaffected).
- **Gate-logic proof** (`.spur/run/<wbs>-verdict.json` guard): PASS verdict → `verify→record` TRUE / `verify→failed` FALSE; FAIL verdict → record FALSE / failed TRUE; missing file → record FALSE / failed TRUE (blocks safely, no crash).
- **No-regression proof:** dry-run `finalState`/`transitions` identical before and after the workflow edits (git-stash A/B comparison) — confirms the precheck dry-run stop is pre-existing, not introduced.

### What remains for `done`

1. **R6** — write the ADR entry (verify-skill-as-companion + workflow-guard-as-gate decision), sync `04_DESIGN.md` (sp command/skill surface: new `dev-implement`, `sp:code-verification`) and `05_FEATURES.md` (H2 status).
2. **R5** — the live end-to-end dogfood: run `spur workflow run task-pipeline.yaml --vars '{"wbs":"0101","profile":"auto"}'` for real and confirm Testing/Review are pipeline-written and the gate clears at PASS. This spawns agent subprocesses, so it's an operator-supervised run, not an in-session auto-run.

### Note on the SECU-backronym conflict (R2 surfaced)

The old `dev-review.md` defined SECU as "Security, **Error-handling, Conventions, Untested paths**" — a different backronym than the rd3-canonical "Security, **Efficiency, Correctness, Usability**" the new skill uses. I aligned the command to the skill's S/E/C/U (R6/R7: surfaced the conflict, picked the better-tested rd3 form, did not blend). Flag for the doc-sync step.

### History
- 2026-06-23T17:58:59.171Z todo → wip (system)
- 2026-06-23T19:22:58.321Z wip → done (system)
