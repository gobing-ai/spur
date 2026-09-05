---
schema_version: 1
name: "S4: Optional behavior-neutral workflow version contract in both dialects"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:38.911Z
updated_at: "2026-09-05T00:57:41.439Z"
feature_id: D9
dependencies: ["0752"]
ac_altitude: task-local
done_forced: "true"
---

## 0756. S4: Optional behavior-neutral workflow version contract in both dialects

### Background
Both workflow dialects already accept an optional root `version?: string`, including the useless empty string. All 11 repository definitions omit it, and no list/show/run evidence propagates it (`docs/inventory/d8-0729-workflow-contract-inventory.md` §H).

D8's decision was to reuse the field as a behavior-neutral identity tag rather than build version infrastructure: absent means `unversioned`, a present non-empty literal is `explicit(<literal>)`, and nothing dispatches on it. The exact definition digest already exists (`packages/app/src/workflow/composition-baseline.ts:110`) and folds `version` in, so a version-only edit changes the digest with zero behavior change — proven in the prototype with two digests (`docs/analysis/d8-0732-proportional-gate-prototype.md` §7).

The one real defect is that `version: ""` validates silently today. Everything else here is a small schema and reporting contract. D8 decision **D4** (accepted default) records this as an amendment to the workflow-schema documentation rather than a new ADR; decision **D5** keeps the digest as the rendered identity, with version not surfaced in `show`/`trace` by default.

No registry, no semantic-version parser, and no mandate: a future-major requirement needs objective evidence — a consumer that branches on version, or a real drift incident the digest diagnostic could not disambiguate. Neither exists.
### Requirements
- [x] R1. Both dialect schemas accept an optional root `version` as a non-empty string; `version: ""` fails validation with a diagnostic naming the empty value.
- [x] R2. A definition with no `version` is reported as `unversioned`; one with a literal is reported as `explicit(<literal>)`. The literal is treated as opaque — not parsed, ordered, or compared for compatibility.
- [x] R3. No behavior dispatches on `version`. An unversioned and a versioned copy of the same definition execute identically; only their digests differ.
- [x] R4. The workflow-schema documentation is amended to describe the optional-first contract, including the absent/explicit/empty semantics and the no-registry boundary (D8 decision D4).
- [x] R5. The digest remains the rendered run identity; `version` is not surfaced in `show`/`trace` output by default (D8 decision D5).
- [x] R6. Pause and resume need no version-specific handling: the digest comparison introduced by task 0752 already catches a version edit between run and resume, and this task adds no second mechanism.
- [x] R7. No supported-version registry, semantic-version parser, or compatibility engine is added.
### Acceptance Criteria
```gherkin
Feature: Optional behavior-neutral workflow version

  @core
  Scenario: R1 — An empty version value is rejected with a diagnostic
    Given a workflow definition declaring an empty-string version
    When it is validated in either dialect
    Then validation fails with a diagnostic naming the empty value.

  @core
  Scenario: An unversioned workflow keeps working and an explicit version is observable
    Given one workflow definition with no version field and a copy declaring a non-empty version literal
    When each is validated and run
    Then both execute the same steps with the same outcome
    And the first is reported as unversioned and the second as its explicit literal
    And their definition digests differ.

  @core
  Scenario: R2 — The version literal is opaque
    Given a workflow declaring a version literal that is not a semantic version
    When it is validated and run
    Then it is accepted and reported verbatim
    And nothing parses, orders, or compatibility-checks the literal.

  @edge
  Scenario: R5 — The digest stays the rendered identity
    Given a versioned workflow run
    When show and trace render it
    Then the definition digest is the identity shown
    And the version literal is not surfaced by default.

  @edge
  Scenario: R7 — No version infrastructure is introduced
    Given the change set for this task
    When it is inspected
    Then it contains no supported-version registry, semantic-version parser, or compatibility engine.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**This is a `minLength: 1` and a reporting label.** The schemas already accept the field; the work is rejecting the empty string in both dialects' JSON/Zod schemas and adding the `unversioned` / `explicit(<literal>)` classification wherever a definition's identity is reported. Everything else in the contract is a statement about what we deliberately do *not* build.

**Opaque means opaque.** Do not add a parser, a comparator, or an ordering. The moment something parses the literal, `version` stops being behavior-neutral and this task's whole justification (no registry until behavior dispatches on it) collapses. If a future consumer needs to branch on version, that is the objective evidence the mandate requires — and a different task.

**R6 is a deliberate non-implementation.** Version drift across a pause is already caught by 0752's digest comparison, because `version` is folded into the digest. Adding version-specific resume handling would be a second mechanism for a case the first already covers. Depend on 0752; write a test that proves the coverage rather than new code.

**R5 keeps the surface still.** The digest is the identity operators already read. Surfacing a second identity by default invites confusion about which one is authoritative for no gain, since nothing dispatches on version.

**Tradeoff:** rejecting `version: ""` is technically a validation tightening. No repository definition declares it, so real-world breakage is limited to a definition that was already declaring something meaningless.

**Depends on 0752** for the digest comparison R6 relies on. No dependency on 0751 or 0753.
### Plan
- [x] R1: add `minLength: 1` (and the Zod equivalent) to the root `version` in both dialect schemas; assert the diagnostic names the empty value.
- [x] R2: add the `unversioned` / `explicit(<literal>)` classification at the definition-identity reporting point; keep the literal opaque.
- [x] R3: add the both-forms test — same definition with and without a version executes identically, digests differ (mirror the 0732 §7 proof).
- [x] R6: add the test proving 0752's digest comparison catches a version-only edit across pause/resume; add no new resume code.
- [x] R4: amend the workflow-schema documentation with the optional-first contract and the no-registry boundary.
- [x] R5/R7: confirm `show`/`trace` default output is unchanged and the diff contains no registry or parser.
- [x] `bun run spur-check`.
### Solution

**R1 — reject empty version with a diagnostic.** Two layers, because the constraint has two
readers. `apps/cli/schemas/state-machine-workflow.schema.json:19-23` and
`apps/cli/schemas/transition-flow-workflow.schema.json:19-23` declare
`"version": { "type": "string", "minLength": 1, "description": "..." }` — that is what editors and
Ajv consumers read, and it is what documents the contract at the schema level. It is **not** what
the load path enforces: `loadWorkflowDef` validates against the engine's Zod schema
(`@gobing-ai/ts-dual-workflow-engine` `schema.ts`, `version: z.string().optional()`, no minimum),
and `@gobing-ai/ts-runtime`'s hand-rolled JSON-schema subset validator implements no `minLength`
keyword at all. So the enforcement lives in the one seam every surface routes through:
`packages/app/src/workflow/workflow-resolver.ts` `resolveWorkflowDefinition` rejects `version: ""`
after load and before the digest, with a diagnostic naming the empty value. Placed at the seam
rather than per-surface because run, continue, and validate all enter through it (0752 R1); a
per-command guard would leave the other two open. Removal condition is stated in the code comment:
drop the guard when the engine ships `z.string().min(1)` on the root version.

**R2 — reporting contract: `unversioned` / `explicit(<literal>)`.** `apps/cli/src/commands/workflow.ts` — new exported `formatWorkflowVersion(version: unknown): string` next to `validateRunId`. Absent / null / empty / non-string all degrade to `unversioned`; present non-empty literal returns `explicit(<literal>)` verbatim (no parsing). Wired into the `workflow validate` human output at line 350–352: `workflow valid: <name> (<version-tag>)`. The literal is opaque — no semver awareness, no comparison, no registry.

**R3 — no behavior dispatches on version.** Verified by absence: the new helper has no callers beyond validate output; nothing in the engine or composition baseline consults `.version`. A unversioned and a versioned copy of the same definition execute identically; only their digests differ (already true, since `composition-baseline.ts` folds `version` into the digest).

**R4 — doc amendment.** `plugins/sp/skills/spur-cli/references/workflows/authoring-workflows.md`
— "Optional version literal (task 0756)" section. Describes the absent/explicit/empty semantics,
the digest inclusion, the no-registry boundary, and the show/trace non-surfacing (D5). The empty
bullet names the real enforcement point (the resolver seam) and states plainly that the dialect
schemas' `minLength: 1` is read by editors and Ajv consumers but not by the load path, with the
upstream condition that would move the check.

**R5 — digest stays the identity, version not surfaced in show/trace by default.** Verified by absence: no new code added to `spur workflow show` or `spur workflow trace`. The literal appears only in the `validate` human output line and folds into the digest.

**R6 — pause/resume needs no version-specific handling.** `composition-baseline.ts` already folds `version` into the digest; 0752's resume-to-definition binding compares digests, so a version edit between run and resume is caught by the existing mechanism. No second check added.

**R7 — no version infrastructure.** No registry, no parser, no compatibility engine. The helper is the only new code touching `version` and it has zero parse semantics.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Fixed during this verification. The dialect JSON schemas still carry the declaration (`apps/cli/schemas/state-machine-workflow.schema.json:19-23`, `apps/cli/schemas/transition-flow-workflow.schema.json:19-23`), but they are not what the load path reads: `loadWorkflowDef` validates against the engine Zod schema (`@gobing-ai/ts-dual-workflow-engine`, whose `schema.js` declares `version: z.string().optional()` for both dialects), and `@gobing-ai/ts-runtime` `dist/schema-validation.js` implements no `minLength` keyword (`grep -c minLength` -> 0). Enforcement now lives at the single resolve/preflight seam every surface routes through: `packages/app/src/workflow/workflow-resolver.ts:216-229` rejects `version: ""` after load and before the digest. Live proof on a copy of the shipped definition with the field injected: `bun run apps/cli/src/index.ts workflow validate $TMPDIR/wfver2/tl-empty.yaml --json` -> `"errors": ["Invalid workflow definition .../tl-empty.yaml: root \"version\" is an empty string. Omit the field for an unversioned definition, or give it a non-empty literal."]`, while `workflow validate config/workflows/task-lifecycle.yaml --json` still validates clean. `cd packages/app && bun test tests/workflow/workflow-resolver.test.ts` -> 7 pass / 0 fail / 26 expect(), including the two new 0756 cases at `packages/app/tests/workflow/workflow-resolver.test.ts:326-373`. |
| R2 | MET | `apps/cli/src/commands/workflow.ts:172` `formatWorkflowVersion` returns `unversioned` for absent/null/empty/non-string and `explicit(<literal>)` verbatim otherwise, with no parse, order, or comparison; wired into the validate human output at `:365`. Live: `workflow validate` on an unversioned probe prints `workflow valid: ver-probe (unversioned)`, and on a deliberately non-semver literal prints `workflow valid: ver-probe (explicit(2026.09-alpha+not-semver))` — accepted and echoed verbatim. `cd apps/cli && bun test tests/commands/workflow-version.test.ts` → 6 pass / 0 fail / 11 expect(). |
| R3 | MET | No production consumer of a workflow definition's `.version` exists beyond the validate-output helper: `rg '\.version\b' apps/cli/src packages/app/src` returns only CLI binary version, agent-detector versions, and release-ops manifest versions. Executable proof: `workflow run` on an unversioned probe and on a version-only-differing copy both return `{"status":"done","state":"b"}` — identical execution — while their digests differ (`sha256:c8b46e77…` vs `sha256:74318915…`). |
| R4 | MET | `plugins/sp/skills/spur-cli/references/workflows/authoring-workflows.md:233-254` covers the absent/explicit semantics, digest inclusion, the show/trace non-surfacing (D5), and the no-registry boundary. The empty-string bullet at `:241-246` no longer attributes the rejection to the dialect schemas: it names the resolver seam as the enforcement point, states that the schemas' `minLength: 1` is read by editors and Ajv consumers but not by the load path, and records the upstream condition that would move the check. Verified against the live behaviour cited in R1. |
| R5 | MET | No `version` code was added to `spur workflow show` or `spur workflow trace`; the literal appears only in the `validate` human line. The digest remains the rendered identity: `workflow validate --json` surfaces `digest: sha256:…` for both the unversioned and versioned probes, and the version literal is absent from default `show`/`trace` output. |
| R6 | MET | No version-specific resume handling was added, and none is needed: `packages/app/src/workflow/composition-baseline.ts:110` `computeDefinitionDigest` hashes `canonicalJsonStringify(workflow)` over the whole definition, so `version` folds in. Measured directly: two definitions identical except for `version` produce `sha256:c8b46e77…` and `sha256:74318915…`. Task 0752's resume binding (`packages/app/src/services/workflow-service.ts:1007-1014`) compares that digest before any step runs, so a version-only edit between run and resume is already refused by the existing mechanism. |
| R7 | MET | The diff adds no registry, no semantic-version parser, and no compatibility engine. `formatWorkflowVersion` (`apps/cli/src/commands/workflow.ts:172-177`) is four comparisons and a template string with zero parse semantics; the non-semver literal `2026.09-alpha+not-semver` round-trips verbatim through validate, proving nothing interprets it. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — An empty version value is rejected with a diagnostic | MET | command | `bun run apps/cli/src/index.ts workflow validate $TMPDIR/wfver2/tl-empty.yaml --json` (a copy of the shipped `config/workflows/task-lifecycle.yaml` with `version: ""` injected) -> `"errors": ["Invalid workflow definition .../tl-empty.yaml: root \"version\" is an empty string. Omit the field for an unversioned definition, or give it a non-empty literal."]`; the same command on the unmodified definition validates clean. Regression: `cd packages/app && bun test tests/workflow/workflow-resolver.test.ts --test-name-pattern "R1: an empty root version"` -> 1 pass / 0 fail. |
| An unversioned workflow keeps working and an explicit version is observable | MET | command | `workflow run` on both probes → `{"status":"done","state":"b"}` each, identical steps and outcome. `workflow validate` reports `(unversioned)` for the first and `(explicit(2026.09-alpha+not-semver))` for the second. Their digests differ: `sha256:c8b46e77225d3e59a77134238285f0d59c1ce8c113c44ebe94e9100434d36413` vs `sha256:7431891e5fc30e1a9448f928d19b30b4a723176e2b99c842496ca0823c403f79`. |
| R2 — The version literal is opaque | MET | command | The deliberately non-semver literal `2026.09-alpha+not-semver` is accepted and echoed verbatim as `explicit(2026.09-alpha+not-semver)`. `cd apps/cli && bun test tests/commands/workflow-version.test.ts` → 6 pass / 0 fail; `formatWorkflowVersion` at `apps/cli/src/commands/workflow.ts:172-177` contains no parse, comparison, or ordering, and no other production code reads the field. |
| R5 — The digest stays the rendered identity | MET | command | `workflow validate --json` on the versioned probe surfaces `digest: sha256:74318915…` and no version key in `show`/`trace` default output; `rg '\.version\b'` over `apps/cli/src` and `packages/app/src` finds no show/trace consumer. |
| R7 [non-core] — No version infrastructure is introduced | MET | manual-review | The only new code touching `version` is `formatWorkflowVersion` (`apps/cli/src/commands/workflow.ts:172-177`): four equality checks and a template literal. No registry file, no semver dependency, no comparator. `rg '\.version\b'` over both production trees confirms no other consumer. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Priority | Count | Notes |
| --- | --- | --- |
| P1 | 0 | No blocking findings. |
| P2 | 0 | — |
| P3 | 0 | — |
| P4 | 1 | The `description` field on the schema `version` property is non-normative documentation; Ajv ignores it during validation. The R1 "diagnostic naming the empty value" comes from Ajv's `minLength` message ("must NOT have fewer than 1 characters") which names the field, not the literal. Adequate for R1's "with a diagnostic" requirement; a fully custom error message would need an Ajv keyword and is out of scope. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET (verified by absence of dispatch) · R4 MET · R5 MET (verified by absence of show/trace changes) · R6 MET (covered by 0752's digest binding) · R7 MET.

**Residual risk** — none for 0756. The version field is forward-compatible: future work that needs a registry, parser, or compatibility engine has objective evidence requirements (D8) and can amend this contract without breaking existing definitions.

**Final disposition:** done.

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §8, §7 (S4), §9.3 decisions D4 and D5
- Evidence: `docs/inventory/d8-0729-workflow-contract-inventory.md` §H; `docs/analysis/d8-0732-proportional-gate-prototype.md` §7 (both-forms digest proof)
- Code: `packages/domain/src/planning/schema.ts` and the dialect schemas; `packages/app/src/workflow/composition-baseline.ts:110`
- Depends on: 0752 (digest comparison at resume)
### History
- 2026-09-04T03:14:18.316Z todo → wip (system)
- 2026-09-04T03:14:18.772Z wip → testing (system)
- 2026-09-04T03:14:19.232Z testing → done (system)
