---
schema_version: 1
name: Propose safe npm and pnpm bindings through existing init actions
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.916Z
updated_at: "2026-11-06T04:17:04.735Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A92
priority: P2
tags:
  - simplification-2026-11
  - w4
  - approved
estimate_hours: 8

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1303-verdict.json
---

## 1303. Propose safe npm and pnpm bindings through existing init actions

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W4; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A92: JavaScript project onboarding proposes declared action bindings safely.

Owned surfaces/callers/fixtures/config/docs: apps/cli/src/commands/init.ts and init tests; packages/config builder schema/loader; packages/app/src/services/sdlc-actions.ts; self exec inspection; bundled init templates and SDLC contracts.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- No working-directory field exists in builder.actions and no init preview flag exists. Keep the current action string/array schema; place subdirectory commands behind existing quoting/cwd behavior. UI fixes and Markdown proof are not functional dependencies.
- Verified source seams: `apps/cli/src/commands/init.ts:70`; `packages/app/src/services/sdlc-actions.ts:66`; `apps/cli/src/commands/self/exec.ts:39`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. JavaScript project onboarding proposes declared action bindings safely; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Propose safe npm and pnpm bindings through existing init actions

  Scenario: AC1 — JavaScript project onboarding proposes declared action bindings safely (req: R1)
    Given npm or pnpm scripts, lockfile conflicts, missing tools and existing custom builder actions
    When init discovers or previews action bindings
    Then declared commands and provenance are proposed deterministically while conflicts and unbound actions are explicit and existing configuration is preserved
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:56.973Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Extend the init-only detection helper with discovered package.json scripts and lockfile/packageManager evidence. Frozen precedence: existing explicit builder.actions unchanged; existing Bun detection unchanged; matching declared Make action takes precedence over JS script fallback; npm/pnpm is selected only when one manager is unambiguous. Conflicting lockfiles/packageManager means preset none and commented unbound entries with a reason, never install/run. For each reserved action bind only an identically named declared script, command <manager> run <action> with validated fixed action name. Add private detectBuilderBindings returning {bindings,sourceByAction,diagnostics}; render command config only, provenance as comments, not schema fields. Re-init preserves user bytes. Inspection uses existing self exec --list/--dry-run; no new init flag.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1304 extends the same private detection result; no new runtime config is required.

#### Boundaries and verification

(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts tests/init-templates.test.ts); (cd packages/app && bun test tests/services/sdlc-actions.test.ts). Save generated YAML, inspection JSON and fixture check exit.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write manifest/lock/Make/custom-action fixtures with non-executable candidate commands first.
- [x] 2. Implement deterministic init-only binding detection and render preset none for unambiguous non-Bun bindings.
- [x] 3. Verify conflicting manifests remain unbound, no discovery command executes and reinit preserves configured content.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Implemented R1 / AC1 in the current execution worktree; this pass owns implementation only.

- `apps/cli/src/commands/init.ts:87-128` reads fixed lockfile and packageManager evidence and refuses conflicting, malformed, or unsupported JavaScript manager selection. Missing executables are reported using PATH lookup without running a manager.
- `apps/cli/src/commands/init.ts:132` adds private detectBuilderBindings returning bindings, sourceByAction and diagnostics. Matching Make targets win; JavaScript fallback binds only nonempty string scripts with exact reserved names to fixed manager/action commands. Script bodies and arbitrary names never become commands.
- `apps/cli/src/commands/init.ts:173` renders preset none with provenance, diagnostics and commented unbound proposals. Bun lockfiles keep their preset precedence. Existing non-force re-init returns before detection and preserves user configuration bytes; the explicit force behavior is unchanged.
- `apps/cli/tests/commands/init.test.ts:493` exercises npm/pnpm lockfiles, packageManager-only selection, conflicts, unsupported managers, malformed manifests/scripts, missing tools, Make/Bun precedence, real self-exec inspection, candidate nonexecution and byte-preserving re-init. Tests were written first: the original code failed 20 of the 27 new cases, and all now pass.
- `docs/design/sdlc-actions.md:181` owns the discovery/inspection contract; `config/config.example.yaml:243` carries portable onboarding guidance. No schema or runtime resolver changes were needed.

Focused verification:

- CLI: `(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts tests/init-templates.test.ts --coverage --reporter=junit --reporter-outfile=../../.spur/run/1303-cli-junit.xml)` — 100 pass, 0 fail; init.ts function coverage 100%, line coverage 98.40%. Receipt: `.spur/run/1303-cli-focused.log:1`.
- App: `(cd packages/app && bun test tests/services/sdlc-actions.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1303-app-junit.xml)` — 13 pass, 0 fail. Receipt: `.spur/run/1303-app-focused.log:1`.
- `bun run --filter @gobing-ai/spur typecheck` — PASS. Receipt: `.spur/run/1303-typecheck.log:1`.
- `bun run --filter @gobing-ai/spur build:bundle` — PASS. Receipt: `.spur/run/1303-bundle.log:1`.
- Direct recommended pre/post rule evaluations have no findings: `.spur/run/1303-pre-rules.json:1`, `.spur/run/1303-post-rules.json:1`.
- Public-surface probe: `bun .spur/run/1303-probe.ts` — PASS for npm, pnpm and conflicting-lock fixtures. The source-local CLI runs self init, self exec --list and --dry-run against throwaway roots with empty tool PATH; re-init preserves custom bytes and no candidate marker is created. Exact argv, observed stdout/stderr and exits are saved in `.spur/run/1303-probe/npm.json:1`, `.spur/run/1303-probe/pnpm.json:1`, `.spur/run/1303-probe/conflict.json:1`; generated YAML is saved beside each JSON. Summary: `.spur/run/1303-probe/summary.json:1`.

Gate limitation: `bun apps/cli/src/index.ts task gate 1303 light` recorded FAIL. Lint, pre-rules, typecheck and targeted tests passed; rules:post stopped at coverage provenance because Git object writes are sandbox-denied (`git add -A failed: unable to create temporary file: Operation not permitted`). See `.spur/run/1303-light-gate.log:1` and `.spur/run/1303-check-receipt.json:1`. Direct post-rule evaluation passes but does not replace the failed provenance gate. The full gate/review/verify/record and status transition remain the pipeline driver's work; this pass does not claim task done or verify PASS. No gate weakening or full-suite rerun was attempted. Global bun linking was not attempted because its installation paths are outside the writable roots; the local bundle build succeeded.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Deterministic selection/refusal at `apps/cli/src/commands/init.ts:88`; exact declared bindings/provenance at `apps/cli/src/commands/init.ts:133`; effective unbound reporting at `apps/cli/src/commands/init.ts:178`. Fresh passing declaration/conflict/default/precedence/preservation cases at `apps/cli/tests/commands/init.test.ts:493`, `apps/cli/tests/commands/init.test.ts:530`, `apps/cli/tests/commands/init.test.ts:555`, `apps/cli/tests/commands/init.test.ts:591`, and `apps/cli/tests/commands/init.test.ts:613`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — JavaScript project onboarding proposes declared action bindings safely (req: R1) | MET | test | Fresh focused CLI check: 103 pass, 0 fail at `.spur/run/1303/review-final-cli.log:112`; resolver check: 13 pass, 0 fail at `.spur/run/1303/review-final-app.log:18`; public CLI probe: all three journeys pass at `.spur/run/1303-probe/summary.json:1`; effective-default consistency passes at `.spur/run/1303/review-final-consistency.json:1`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1303

**Scope:** Working-tree diff; no implementation commit tagged `(1303)` exists. Reviewed all four product files: `apps/cli/src/commands/init.ts`, `apps/cli/tests/commands/init.test.ts`, `config/config.example.yaml`, and `docs/design/sdlc-actions.md`; cross-checked task requirements, config schema, action resolver, and self-exec callers.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.

Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness, usability | Previous unbound-reporting defect resolved: effective resolution excludes rule defaults from proposals; three regression fixtures assert agreement with CLI inspection at `apps/cli/tests/commands/init.test.ts:530`. Fresh defaults consistency check passes for npm, pnpm, and conflicting managers at `.spur/run/1303/review-final-consistency.json:1`. | `apps/cli/src/commands/init.ts:178` | RESOLVED |
| 2 | P3 (minor) | usability | Previous detached consumer row resolved: the plugin entry is inside the Consumers table, before the discovery subsection. Fresh consumer-table consistency check passes at `.spur/run/1303/review-final-consistency.json:1`. | `docs/design/sdlc-actions.md:180` | RESOLVED |
| 3 | P4 (advisory) | traceability | Structural check passes with an existing Solution citation subject warning for the implementation comment at `apps/cli/src/commands/init.ts:132`; the implementing declaration is at `apps/cli/src/commands/init.ts:133`. This is task-record metadata; current review evidence cites implementation and executable checks directly. | `.spur/run/1303/review-final-structural.json:1` | ACCEPTED |

##### Verification and architecture

- Fresh focused CLI check: `(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts tests/init-templates.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1303/review-final-cli.xml)` — exit 0, 103 pass, 0 fail; `.spur/run/1303/review-final-cli.log:112`.
- Fresh resolver check: `(cd packages/app && bun test tests/services/sdlc-actions.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1303/review-final-app.xml)` — exit 0, 13 pass, 0 fail; `.spur/run/1303/review-final-app.log:18`.
- Fresh public CLI probe: `bun .spur/run/1303-probe.ts` — exit 0; npm, pnpm, and conflicting-lock journeys pass. Generated YAML and inspection JSON: `.spur/run/1303-probe/summary.json:1`. Exercises missing tools, dry-run/list inspection, candidate nonexecution, and byte-preserving re-init.
- Changed TypeScript passes Biome; CLI typecheck exits 0; strict-core structural check passes with the advisory above. Receipts: `.spur/run/1303/review-final-biome.log:1`, `.spur/run/1303/review-final-typecheck.log:1`, `.spur/run/1303/review-final-structural.json:1`.
- No new security, efficiency, or architecture defects found. Discovery remains init-local and data-only, emits fixed reserved commands, preserves Make/Bun precedence, and reuses the existing effective resolver: `apps/cli/src/commands/init.ts:88`, `apps/cli/src/commands/init.ts:133`, `apps/cli/src/commands/init.ts:174`, `packages/app/src/services/sdlc-actions.ts:66`. Existing configuration returns before detection at `apps/cli/src/commands/init.ts:453`. Portable guidance matches at `config/config.example.yaml:243`.
- Gate limitation: the stored full-gate receipt reports PASS at `.spur/run/1303-check-receipt.json:1`, but fresh `task gate 1303 status` refuses reuse because sandbox-denied Git object writes prevent tree capture; `.spur/run/1303/review-final-gate-status.json:1`. This review does not certify a fresh full gate or transition the task to done. Initial diff whitespace check reports only an existing trailing blank line in the task record.

**Next:** Pipeline driver handles gate freshness and completion. Open P1: 0; P2: 0; P3: 0. The accepted P4 derives MEDIUM for this section; executable MET acceptance evidence derives HIGH for the separate captured answer.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Deterministic manager selection and refusal at `apps/cli/src/commands/init.ts:88`; exact declared bindings and provenance at `apps/cli/src/commands/init.ts:133`; effective unbound reporting at `apps/cli/src/commands/init.ts:178`. Fresh 103 CLI tests and 13 resolver tests pass; declaration/conflict cases at `apps/cli/tests/commands/init.test.ts:493`, default consistency at `apps/cli/tests/commands/init.test.ts:530`, preservation at `apps/cli/tests/commands/init.test.ts:613`. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — JavaScript project onboarding proposes declared action bindings safely (req: R1) | MET | test+command | Fresh focused CLI check: 103 pass, 0 fail at `.spur/run/1303/review-final-cli.log:112`; resolver check: 13 pass, 0 fail at `.spur/run/1303/review-final-app.log:18`. Cases at `apps/cli/tests/commands/init.test.ts:493`, `apps/cli/tests/commands/init.test.ts:530`, `apps/cli/tests/commands/init.test.ts:555`, `apps/cli/tests/commands/init.test.ts:591`, and `apps/cli/tests/commands/init.test.ts:613` cover selection, conflicts, defaults, precedence, and preservation. Public CLI probe passes all three journeys at `.spur/run/1303-probe/summary.json:1`. |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T04:00:43.313Z todo → wip (system)
- 2026-11-06T04:17:02.741Z wip → testing (system)
- 2026-11-06T04:17:04.725Z testing → done (system)

