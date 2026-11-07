---
schema_version: 1
name: Complete language and monorepo action onboarding without guessing commands
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.917Z
updated_at: "2026-11-07T06:51:59.416Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A92
priority: P2
tags:
  - simplification-2026-11
  - w4
  - approved
estimate_hours: 8

dependencies: ["1303"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1304-verdict.json
---

## 1304. Complete language and monorepo action onboarding without guessing commands

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W4; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A92: Language and monorepo onboarding retains execution ownership.

Owned surfaces/callers/fixtures/config/docs: init discovery introduced by JavaScript onboarding; existing builder.actions working-directory ownership; Cargo/Go/Python/Make fixture manifests; representative mixed monorepo; init/action docs and templates.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Freeze conservative language defaults and package selection. Do not assume Python project.scripts are shell actions or introduce a cwd schema. The selected fixture root and quoted command prefix suffice.
- Verified source seams: `apps/cli/src/commands/self/exec.ts:32`; `packages/app/src/services/sdlc-actions.ts:103`; `apps/cli/src/commands/init.ts:353`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Language and monorepo onboarding retains execution ownership; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Complete language and monorepo action onboarding without guessing commands

  Scenario: AC1 — Language and monorepo onboarding retains execution ownership (req: R1)
    Given Cargo, Go, Python, Make and mixed-monorepo fixtures with selected roots and missing scripts
    When the operator inspects and accepts supported action bindings
    Then working directories and tool availability are explicit, no unsupported command is invented and a representative non-Bun project reaches a successful check within five operator actions
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:59.058Z

Closed: use the conservative mapping above. Sources checked: https://doc.rust-lang.org/cargo/commands/cargo-check.html ; https://doc.rust-lang.org/cargo/commands/cargo-test.html ; https://pkg.go.dev/cmd/go . Python defaults remain unbound without declared project commands.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Extend 1303 detection: explicit Make/action bindings win. With Cargo.toml and available cargo propose build="cargo build", typecheck="cargo check", test="cargo test", check composite [typecheck,test], using Cargo manifest default-member behavior. With go.mod and available go propose build="go build ./...", test="go test ./...", check composite [build,test]; do not relabel build as lint. Python pyproject.toml alone proposes no pytest/uv/poetry command: use an explicit matching Make target or preserved custom action; other actions stay unbound with reason. One chosen package root: root manifest wins, otherwise a single immediate child package may be selected; multiple candidate roots stay unbound with paths listed. For a selected child prefix the stored string with cd <shQuote(relativeRoot)> && <command>, using existing shell-quote helper and no cwd field. No recursive monorepo discovery or execution during detection.

#### Dependencies and handoff

Direct prerequisites: 1303. 1303 provides detectBuilderBindings and preserved init/config behavior; extend it instead of adding another profile detector.

Output/handoff: A verified independently reviewable slice with unchanged public behavior.

#### Boundaries and verification

(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts); (cd packages/app && bun test tests/services/sdlc-actions.test.ts). Use fixture executable stubs for deterministic discovery and separately report real-tool availability. Verify Cargo/Go semantics against the official references recorded in Q&A.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write Cargo default-member, Go, Python-declared-Make and mixed-root/conflict fixtures before implementation.
- [x] 2. Extend only the existing detection result and command rendering; preserve user bindings and tool absence diagnostics.
- [x] 3. Run generated self exec commands only in disposable fixtures and record the five-or-fewer operator action journey for a representative non-Bun project.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

#### Change map

- `apps/cli/src/commands/init.ts:146-187` extends the existing binding detector with available-Cargo build/check/test defaults and available-Go build/test defaults, preserving manifest default members and composing check from action names. Explicit Make/JS bindings take precedence; missing native tools and conflicting Cargo/Go manifests stay unbound. Python project.scripts never becomes a shell action map.
- `apps/cli/src/commands/init.ts:239-274` selects the root when any supported manifest is present, otherwise only one immediate child. Multiple candidates remain unbound with sorted paths; hidden/dependency/vendor directories and outside symlinks are excluded. Discovery performs data reads and PATH lookup only.
- `apps/cli/src/commands/init.ts:282` renders provenance, directory and availability comments, schema-valid composites and shell/YAML-quoted child commands. Leading-dash directory names use ./ before quoting so cd cannot interpret an option. Root Bun preset behavior, existing action schema and executor remain intact. `apps/cli/src/commands/init.ts:584` wires discovery only into fresh/forced init, after the byte-preserving convergence path.
- `apps/cli/tests/commands/init.test.ts:637` adds deterministic Cargo, Go, Python/Make, absent-tool, conflicting-root, root-precedence, child-root, child-JS and symlink fixtures. `apps/cli/tests/commands/init.test.ts:790` covers the four-action public journey, nonexecution during detection/preview, quoted child execution and custom-config preservation. Failure cases and fixtures preceded production changes: initial narrow run had 16 failures and one pass; the leading-dash extension also failed before its fix.
- Owning contract and portable guidance synchronized at `docs/design/sdlc-actions.md:197` and `config/config.example.yaml:243`. No dependency, public noun/verb, cwd schema, workflow or architectural-boundary change.

#### Focused verification and repeatable acceptance evidence

- `(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts tests/init-templates.test.ts --coverage --reporter=junit --reporter-outfile=../../.spur/run/1304/cli.xml)` — PASS, 120 tests, zero failures; changed init source: 98.68% line and 100% function coverage. Captured output: `.spur/run/1304/cli.log:1`; JUnit: `.spur/run/1304/cli.xml:1`.
- `(cd packages/app && bun test tests/services/sdlc-actions.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1304-app.xml)` — PASS, 13 tests, zero failures; `.spur/run/1304-app.log:1`.
- `bun run --filter @gobing-ai/spur typecheck` and changed-file Biome check — PASS. Typecheck: `.spur/run/1304/typecheck.log:1`. Bundle rebuild also PASS: `.spur/run/1304/build-bundle.log:1`.
- Public surface probe: `bun .spur/run/1304/probe.ts` — PASS across four disposable fixture scenarios, exact command argv/cwd/stdout/stderr/exit codes and generated configs saved at `.spur/run/1304/probe.json:24-34`. Real Cargo, rustc, Go and Make availability is recorded separately from stub-based fixtures. Cargo's deliberately broken non-default member is not built; a Go child with apostrophe/spaces/shell-like text executes correctly; Python uses an explicit Make check; mixed roots refuse an unbound check with exit 2. Successful native/Make journeys take four operator actions: self init, self exec --list, self exec check --dry-run, self exec check. Cargo/Go operate offline with caches confined to disposable paths.
- Official command semantics inspected: https://doc.rust-lang.org/cargo/commands/cargo-build.html ; https://doc.rust-lang.org/cargo/commands/cargo-check.html ; https://doc.rust-lang.org/cargo/commands/cargo-test.html ; https://pkg.go.dev/cmd/go . Cargo default-member selection and Go package build/test semantics match the frozen design.

#### Gate limitations and pipeline handoff

- `bun apps/cli/src/index.ts task gate 1304 light` reports FAIL: lint, CLI typecheck and related tests PASS, but tree capture and coverage provenance cannot write Git objects in this sandbox. Evidence: `.spur/run/1304-light-gate.log:1` and `.spur/run/1304-check-receipt.json:1`. Its initial pre-rule scan also overlapped plugin restaging during bundle generation and hit a transient missing directory; the final independent recommended-pre-check run passes all 51 rules with no findings at `.spur/run/1304/pre-check.json:1`. No gate was weakened and no full project gate was run inside implement.
- `bun link` was attempted from apps/cli and failed EPERM creating a symlink in Bun's global directory; `.spur/run/1304/link.log:1`. The source-local CLI and bundle rebuild work.
- The task-scoped commit was attempted, but Git could not create this worktree's index.lock (Operation not permitted); `.spur/run/1304/commit.log:1`. No files were staged and the five-file diff remains reviewable and uncommitted.
- All implementation Plan steps are complete; the pipeline still owns Testing/Review, status transitions, full gate, verify and completion. This implementation pass does not certify a full-gate or verify PASS. The starting task Design note was preserved. Reviewable changes are limited to init, its tests, the owning design/config guidance and this task record.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/init.ts:146` `detectBuilderBindings`; `apps/cli/src/commands/init.ts:176-179` Cargo/Go defaults only when the tool is on PATH; `apps/cli/src/commands/init.ts:239` monorepo root discovery; `apps/cli/src/commands/init.ts:285` child-root path quoting; apps/cli 110 tests, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Language and monorepo onboarding retains execution ownership (req: R1) | MET | test | `apps/cli/tests/commands/init.test.ts:660` Cargo; `apps/cli/tests/commands/init.test.ts:681` Go; `apps/cli/tests/commands/init.test.ts:689` missing tool unbound; `apps/cli/tests/commands/init.test.ts:762` mixed roots propose nothing; `apps/cli/tests/commands/init.test.ts:809` public journey executes only inside the child — pass this session. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1304

**Scope:** Working-tree diff in `apps/cli/src/commands/init.ts`, `apps/cli/tests/commands/init.test.ts`, `config/config.example.yaml`, and `docs/design/sdlc-actions.md`. No tagged implementation commit exists; task 1304 supplies the frozen contract.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.

Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | correctness | Previous CDPATH directory redirection is fixed: every selected child receives an explicit ./ prefix before quoting. The shared renderer covers Cargo, Go, Make and JavaScript; the competing-CDPATH execution regression passes. Evidence: `apps/cli/src/commands/init.ts:285`, `apps/cli/src/commands/init.ts:307`, `apps/cli/tests/commands/init.test.ts:790`. | `apps/cli/src/commands/init.ts:285` | RESOLVED |
| 2 | P4 (advisory) | verification | Existing full-tier receipt records PASS, but fresh task gate 1304 status reports reuse=false/stale because sandbox permissions prevent Git object writes. Receipt freshness is unconfirmed; focused checks below passed freshly. | `.spur/run/1304-check-receipt.json:16` | ACCEPTED |

No open P1–P3 findings remain.

##### Assessment

Functional review traces conservative defaults, explicit-binding precedence, missing-tool refusal, Python non-inference and root selection to `apps/cli/src/commands/init.ts:146` and `apps/cli/src/commands/init.ts:239`. Security/correctness review confirms outside-symlink filtering, shell/YAML quoting, CDPATH isolation and preserved operator configuration; execution regressions are at `apps/cli/tests/commands/init.test.ts:773`, `apps/cli/tests/commands/init.test.ts:790` and `apps/cli/tests/commands/init.test.ts:809`.

Efficiency/usability review found no additional defect in bounded immediate-child discovery and explicit provenance/refusal comments (`apps/cli/src/commands/init.ts:251`, `apps/cli/src/commands/init.ts:295`). Architecture review found no actionable shallow-module, coupling, seam, locality or testability defect: discovery extends the existing detector, rendering reuses the shared quote helper and action resolver, and execution/schema ownership remains unchanged (`apps/cli/src/commands/init.ts:282`, `packages/app/src/services/shell-quote.ts:11`, `apps/cli/src/commands/self/exec.ts:116`).

Design conformance: the frozen language defaults, single-root selection, explicit child prefixes and no-execution discovery are implemented; owning guidance is synchronized at `docs/design/sdlc-actions.md:197` and `config/config.example.yaml:243`. Native command semantics were cross-checked against [Cargo package selection](https://doc.rust-lang.org/cargo/commands/cargo-build.html#package-selection) and [Go commands](https://pkg.go.dev/cmd/go).

##### Verification

- `(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts tests/init-templates.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1304-rereview-cli.xml)` — exit 0; 121 pass, 0 fail. Repeatable JUnit: `.spur/run/1304-rereview-cli.xml:1`.
- `(cd packages/app && bun test tests/services/sdlc-actions.test.ts)` — exit 0; 13 pass, 0 fail.
- `bun .spur/run/1304/probe.ts` — exit 0; four native fixture scenarios PASS. Cargo default members, quoted Go child execution and explicit Python/Make checks each complete in four operator actions; ambiguous mixed roots refuse execution. Recorded real-tool paths and command results: `.spur/run/1304/probe.json:2`.
- Changed TypeScript Biome check, CLI typecheck and implementation-file `git diff --check` — exit 0.
- Broader whitespace check reports a trailing blank line at the end of the task corpus file; the four implementation files pass. No source changes were made during review.
- `spur task verdict 1304 --from-answer .spur/run/38297156-e1d9-4d0a-86df-1baeb68b94b2-review-cert.md --json` — exit 0, PASS; `spur task residual 1304 review-gate --no-logo` — exit 0, blocking=0.
- Existing full-tier gate: 11,941 tests passed; not rerun in this review. Fresh `bun apps/cli/src/index.ts task gate 1304 status` cannot confirm reuse due to sandbox Git permissions.

**Next:** Pipeline certification/recording; retain the separate gate-freshness limitation. Review made no production-code edits or lifecycle transition.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Conservative language defaults and explicit precedence: `apps/cli/src/commands/init.ts:146`; root ownership: `apps/cli/src/commands/init.ts:239`, `apps/cli/src/commands/init.ts:285`. Fresh 121-test CLI check covers missing tools, Python/Make, mixed roots, CDPATH and quoted child execution (`apps/cli/tests/commands/init.test.ts:689`, `apps/cli/tests/commands/init.test.ts:696`, `apps/cli/tests/commands/init.test.ts:762`, `apps/cli/tests/commands/init.test.ts:790`, `apps/cli/tests/commands/init.test.ts:809`). Native journey command `bun .spur/run/1304/probe.ts` passes four scenarios. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Language and monorepo onboarding retains execution ownership (req: R1) | MET | test+command | Fresh CLI tests verify Cargo/Go defaults, Python refusal/explicit Make, missing tools, ambiguous roots, inspection/preview without execution, quoted child ownership and config preservation: `apps/cli/tests/commands/init.test.ts:660`, `apps/cli/tests/commands/init.test.ts:681`, `apps/cli/tests/commands/init.test.ts:689`, `apps/cli/tests/commands/init.test.ts:696`, `apps/cli/tests/commands/init.test.ts:762`, `apps/cli/tests/commands/init.test.ts:790`, `apps/cli/tests/commands/init.test.ts:809`. Native command `bun .spur/run/1304/probe.ts` passes four scenarios; successful non-Bun checks take four operator actions (`.spur/run/1304/probe.json:19`). |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T04:24:43.483Z todo → wip (system)
- 2026-11-06T04:40:09.726Z wip → testing (system)
- 2026-11-06T04:40:11.848Z testing → done (system)

