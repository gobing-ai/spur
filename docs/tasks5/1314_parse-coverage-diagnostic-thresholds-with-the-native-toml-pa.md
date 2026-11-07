---
schema_version: 1
name: Parse coverage diagnostic thresholds with the native TOML parser
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.921Z
updated_at: "2026-11-07T01:09:20.519Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: C3
priority: P2
tags:
  - simplification-2026-11
  - w8
  - approved
estimate_hours: 3

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1314-verdict.json
---

## 1314. Parse coverage diagnostic thresholds with the native TOML parser

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature C3: Equivalent TOML threshold forms produce equivalent diagnostics.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/services/quality-gate.ts parseCoverageThreshold and callers; packages/app/tests/services/quality-gate.test.ts; scripts/commands/run-tests.ts native parser precedent.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E3 D1 L2 C0 R1 = 7. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Current helper callers expect null for malformed text and support a root-level legacy snippet. Freeze those behaviors rather than introducing new exceptions or changing the full gate outcome.
- Verified source seams: `packages/app/src/services/quality-gate.ts:172`; `packages/app/tests/services/quality-gate.test.ts:330`; `scripts/commands/run-tests.ts:228`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Equivalent TOML threshold forms produce equivalent diagnostics; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Parse coverage diagnostic thresholds with the native TOML parser

  Scenario: AC1 — Equivalent TOML threshold forms produce equivalent diagnostics (req: R1)
    Given inline and standard-table forms of the same coverage threshold plus absent and malformed settings
    When the quality gate reads coverage diagnostics
    Then valid equivalent forms report the same shortfalls while invalid input is actionable and missing settings retain documented behavior without weakening Bun coverage enforcement
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:20.702Z

Closed: preserve null on malformed/missing settings and the legacy helper snippet; this is diagnostic parsing, not gate-policy tightening.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Keep parseCoverageThreshold(text):CoverageThreshold|null exactly. Parse with Bun.TOML.parse in try/catch; malformed TOML returns null as today. Prefer [test].coverageThreshold when the test namespace exists; otherwise accept the existing root coverageThreshold helper form. Read only numeric finite axes functions/lines between 0 and 1; absent/invalid axes yield null if none valid. Ignore comments and unrelated namespaces. Do not parse regex text or add a dependency. Keep gateRc nonzero even if diagnostics are unavailable: a failed/unknown diagnostic can never turn a failed gate into PASS. In the existing failed-gate coverage-diagnostic branch, malformed TOML or an explicitly present invalid coverageThreshold must print and persist one bounded bunfig.toml:1 diagnostic explaining that threshold diagnostics are unavailable. Absent settings stay silent. Preserve the public helper null contract; a private parseCoverageThresholdResult(text):{threshold:CoverageThreshold|null,diagnostic:string|null} carries the reason and the public helper delegates to it, so parsing occurs once per caller and null alone does not imply invalid input. Never change the original gate exit status.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: Independent diagnostics fix; no renderer task dependency.

#### Boundaries and verification

(cd packages/app && bun test tests/services/quality-gate.test.ts tests/services/quality-gate-main.test.ts tests/services/quality-gate-receipt.test.ts). No new dependency; no whole coverage-policy rewrite.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write inline/test-table/root-legacy/comment/unrelated-namespace/malformed/invalid-axis cases before replacing the regex.
- [x] 2. Use native parsing and explicit axis narrowing with the frozen null behavior.
- [x] 3. Prove valid equivalent forms emit identical shortfall anchors and existing coverage/provenance failures still fail. Include malformed/present-invalid diagnostics and silent absent settings.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Implemented R1 / AC1; lifecycle review, full-gate certification and task closure remain with the enclosing pipeline.

- `packages/app/src/services/quality-gate.ts:176`: replaced regex extraction with private native-TOML parsing that distinguishes absent settings from malformed/invalid settings. The test namespace takes precedence; legacy root snippets remain supported. Only finite numeric functions/lines values in [0, 1] are retained, including valid axes beside an invalid axis.
- `packages/app/src/services/quality-gate.ts:209`: preserved the public CoverageThreshold|null signature and null for missing, malformed or wholly invalid settings.
- `packages/app/src/services/quality-gate.ts:1328-1358`: the existing failed-gate coverage branch parses once and persists/prints one bounded bunfig.toml:1 diagnostic when parsing or an explicit threshold is invalid. Missing settings stay silent; valid axes still emit shortfall anchors. The gateRc decision, receipt identity and coverage/provenance enforcement remain unchanged.
- `packages/app/tests/services/quality-gate.test.ts:283`: wrote the failure cases first, observed 19 failing cases plus the separately reproduced partial-axis diagnostic failure, then implemented the parser. Covers inline/table/dotted/root forms, comments, namespace priority, malformed suffixes, invalid types/ranges/non-finite numbers, boundary values, missing settings and failed/successful gate behavior.
- `docs/design/cli-contracts.md:81`: synchronized the existing task-gate contract with native parsing and bounded diagnostic behavior under constitution T3. No new public verb, dependency or architecture boundary.

Implementation evidence (repeatable artifacts under the task run directory):

- Exact focused command: `(cd packages/app && bun test tests/services/quality-gate.test.ts tests/services/quality-gate-main.test.ts tests/services/quality-gate-receipt.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1314-focused.junit.xml)` — 95 pass, 0 fail; log `.spur/run/1314-focused.log`, JUnit `.spur/run/1314-focused.junit.xml`.
- `(cd apps/cli && bun test tests/commands/task/gate.test.ts)` — 6 pass, 0 fail; `.spur/run/1314-cli.log`.
- `bun run --filter @gobing-ai/spur-app typecheck` and `bun run --filter @gobing-ai/spur typecheck` — both exit 0 after correcting the installed parser's object return type.
- `bunx biome check packages/app/src/services/quality-gate.ts packages/app/tests/services/quality-gate.test.ts` — 2 files checked, no findings. `git diff --check` passed.
- `bun apps/cli/src/index.ts rule run --preset recommended-post-check --rule every-export-has-tsdoc --json` — no findings; `.spur/run/1314-tsdoc.json`. The light gate pre-check reports all 51 rules passed.
- Public-surface probe: `bun .spur/run/1314-probe.ts` — five real source-local CLI invocations in throwaway projects, with 120-second timeout and 8 KiB capture per invocation. Inline/table produce `src/short.ts:12 `; malformed/invalid produce `bunfig.toml:1 `; absent produces empty findings. All five CLI invocations return 1 and persist FAIL. Exact argv, cwd, fixture-local lock configuration, stdout/stderr and assertions are saved in `.spur/run/1314-probe.json`. The configured lock remains active in a writable fixture directory because the default host-config path is outside the sandbox.
- Native API source: https://github.com/oven-sh/bun/blob/main/docs/runtime/toml.mdx ; installed Bun 1.4.3 and successful installed-version typechecks/runtime probes corroborate the API.

Gate limitation: `bun apps/cli/src/index.ts task gate 1314 light` records FAIL solely for rules:post on the final implementation. Lint, rules:pre, app typecheck and related tests pass. The post-check cannot capture a Git tree: `git add -A` cannot create temporary object files (Operation not permitted); it reports `coverage-artifact: tree-unavailable`. The receipt is unbound for the same reason. See `.spur/run/1314-check-receipt.json` and `.spur/run/1314-light-gate.log`. No gate was weakened, no full project gate was run inside implement, and no verify PASS is claimed. Git object writes also prevent creating the required task commit in this sandbox; the scoped diff remains reviewable. The pipeline must run its own full gate/review/record after Git write access is available.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/quality-gate.ts:169`, `packages/app/src/services/quality-gate.ts:1328`; fresh focused-behavior and cli-golden-path-present checks prove equivalent forms, actionable invalid-input diagnostics, silent absent settings and preserved failure status. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Equivalent TOML threshold forms produce equivalent diagnostics (req: R1) | MET | test | `packages/app/tests/services/quality-gate.test.ts:283` covers equivalent forms; `packages/app/tests/services/quality-gate.test.ts:306` covers absent/malformed/invalid settings and bounded diagnostics; `packages/app/tests/services/quality-gate.test.ts:368` covers mixed axes and successful-gate silence. Fresh focused-behavior and cli-golden-path-present checks passed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1314

**Scope:** Working-tree diff; no implementation commit tagged (1314). Reviewed three product files and the task specification.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.

Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | functional, security, efficiency, correctness, usability, architecture | No P1–P3 findings. Native parsing, namespace precedence, finite-axis validation, bounded diagnostics and unchanged failure status satisfy R1; the private result helper serves both callers without widening the public contract. | `packages/app/src/services/quality-gate.ts:169`; `packages/app/src/services/quality-gate.ts:1328` | ACCEPTED |

##### Verification

| Check | Status | Evidence |
| --- | --- | --- |
| focused-behavior | pass | Fresh: `(cd packages/app && bun test tests/services/quality-gate.test.ts tests/services/quality-gate-main.test.ts tests/services/quality-gate-receipt.test.ts)`: 95 pass, 0 fail, 496 assertions; repeatable JUnit: `.spur/run/1314-review-focused.junit.xml:1`. |
| cli-tests | pass | Fresh: `(cd apps/cli && bun test tests/commands/task/gate.test.ts)`: 6 pass, 0 fail. |
| cli-golden-path-present | pass | Fresh: `bun .spur/run/1314-probe.ts`: five real CLI cases passed; inline/table shortfalls agree, malformed/invalid inputs produce actionable anchors, absent settings remain silent; all five preserve exit 1 and persisted FAIL. |
| typecheck-and-lint | pass | Fresh app typecheck exited 0; Biome checked both changed TypeScript files without findings. Product-file `git diff --check` passed. |
| task-structure | pass | Fresh `spur task check 1314 --strict-core --json`: pass, no findings; this evaluates current wip status. |
| full-gate-evidence | pass | Enclosing pipeline receipt `.spur/run/1314-check-receipt.json:1`: full PASS, 12,476 tests passed, 0 failed. Reviewed log reports quality-gate service coverage of 100% functions and 95.83% lines. Fresh `git diff --exit-code a3d1e11cc1402274905b22234a8c0276e94f6196 -- packages/app/src/services/quality-gate.ts packages/app/tests/services/quality-gate.test.ts docs/design/cli-contracts.md` exited 0. |
| design-conformance | pass | Native parser and null-preserving public facade: `packages/app/src/services/quality-gate.ts:176`, `packages/app/src/services/quality-gate.ts:209`; diagnostic integration preserves gateRc: `packages/app/src/services/quality-gate.ts:1328`; owning surface contract: `docs/design/cli-contracts.md:81`. |

**Limits:** Receipt reuse could not be recomputed in this session: Git object writes are denied. The read-only comparison above confirms the reviewed product files match the recorded full-gate tree. Repository-wide whitespace checking reports an extra EOF blank line in the task record; the product-file check passes. No task completion or commit is claimed.

**API source:** [Bun native TOML parser documentation](https://github.com/oven-sh/bun/blob/main/docs/runtime/toml.mdx), corroborated by fresh executable cases and typecheck.

**Next:** Return the certified review to the enclosing pipeline for record and lifecycle gates.

**Task outcome:** 1314 PASS; open P1: 0, P2: 0, P3: 0.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/quality-gate.ts:169`, `packages/app/src/services/quality-gate.ts:1328`; fresh focused-behavior and cli-golden-path-present checks prove equivalent forms, actionable invalid-input diagnostics, silent absent settings and preserved failure status. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: AC1 — Equivalent TOML threshold forms produce equivalent diagnostics (req: R1) | MET | test + command | `packages/app/tests/services/quality-gate.test.ts:283` covers equivalent forms; `packages/app/tests/services/quality-gate.test.ts:306` covers absent/malformed/invalid settings and bounded diagnostics; `packages/app/tests/services/quality-gate.test.ts:368` covers mixed axes and successful-gate silence. Fresh focused-behavior and cli-golden-path-present checks passed. |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-07T01:02:42.600Z todo → wip (system)
- 2026-11-07T01:09:18.361Z wip → testing (system)
- 2026-11-07T01:09:20.506Z testing → done (system)

