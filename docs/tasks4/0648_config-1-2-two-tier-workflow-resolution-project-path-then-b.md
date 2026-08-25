---
schema_version: 1
name: "Config 1.2: two-tier workflow resolution — project path then bundled root"
status: done
template: feature-impl
created_at: 2026-08-24T04:10:17.881Z
updated_at: "2026-08-25T00:22:29.422Z"
feature_id: A4
---

## 0648. Config 1.2: two-tier workflow resolution — project path then bundled root

### Background
Task 1 of 3 in the A4 post-ship migration split (0648 resolution · 0649 init idempotency ·
0650 surface cleanup). A4 shipped the config-1.2 **mechanism**; it shipped no migration for
installs that already exist. This slice owns workflow path resolution.

#### Verified terrain — 2026-08-23, `spur@0.3.60` on PATH

| # | Fact | Evidence | Confidence |
| --- | --- | --- | --- |
| 1 | `spur workflow run` / `validate` have **no** fallback of any kind | `apps/cli/src/commands/workflow.ts:436`, `:511`, `:763` — bare `resolve(context.cwd, file)` | HIGH |
| 2 | Probed: it hard-fails | in an empty dir, `spur workflow validate .spur/workflows/basic.yaml` → `File not found: <cwd>/.spur/workflows/basic.yaml` | HIGH |
| 3 | `spur workflow list` **already** layers project → global | `packages/app/src/services/workflow-service.ts:920-957` (`layers`, `source: 'project' \| 'global'`) | HIGH |
| 4 | The lifecycle adapter **already** ladders bundled → project → global | `apps/cli/src/workflow/make-lifecycle-adapter.ts:44-58` | HIGH |
| 5 | A4's map cited (4) as proof workflows resolve globally — it covers the adapter only, never the `workflow run` CLI surface every shipped doc names | `docs/features/A4…md` verified-terrain row vs. (1) | HIGH |
| 6 | The **bundled** tree is current; the **global** tree is not | `task-pipeline.yaml`: npm `@gobing-ai/spur@0.3.60` bundled copy identical to repo SSOT; `~/.config/spur/workflows/` copy 785 diff lines behind. All 10 global workflows drifted (idea-pipeline 606, feature-dev 351, wrapup 260, …) | HIGH |
| 7 | The global tree also holds retired workflows nothing prunes | `planning-pipeline.yaml` (deleted per `docs/00_ADR.md:218-220`, ADR-072) and `task-pipeline2.yaml` | HIGH |
| 8 | The global tier existed solely for the compiled-binary case | `make-lifecycle-adapter.ts:38-43` doc comment; task 0071 R5 / F5 | HIGH |
| 9 | Compiled binaries are **not** a shipping target | `build-binaries` (`scripts/commands/build-binaries.ts`) is a manual spur-dev command, absent from `publish.ts` and from both `.github/workflows/ci.yml` and `publish.yml` | HIGH |
| 10 | …and that case is already broken by other means | `bundledConfigRoot()` returns `null` in a compiled binary, so rules and templates do not resolve there either; `bundled-config.ts:28-33` records embedded config (0117 R6) as unimplemented | HIGH |
| 11 | `bundledConfigRoot()` resolves correctly across install layouts | `bundled-config.ts:34-51` walks up from `import.meta.dirname` trying `config/` then `spur-cli/config/`; verified the npm package ships `config/rules` + `config/workflows` | HIGH |

#### The gap in one sentence

Every workflow resolver in the codebase ladders except the one the shipped docs actually
tell agents to call.

#### Concern raised and withdrawn

An earlier draft argued against unlinking `.spur/workflows` here, because a *global* fallback
would silently redirect Spur's own self-dev to a stale published copy — finding 6 quantifies
that at 785 lines. The operator's two-tier ruling makes the fallback target the **bundled**
tree instead, which in this monorepo `bundledConfigRoot()` resolves to repo-root `config/` —
the live working-tree SSOT. The objection does not survive that change and is withdrawn.
### Requirements
- [x] R1. `spur workflow run`, `validate`, and `dry-run` fall back to the bundled config tree
      when the path resolved against `cwd` does not exist. Resolution order is **literal path
      → bundled root**; an existing project path always wins. The three sites are
      `apps/cli/src/commands/workflow.ts:436`, `:511`, `:763`, each currently a bare
      `resolve(context.cwd, file)`.

- [x] R2. The bundled root is obtained from `bundledConfigRoot()`
      (`packages/config/src/bundled-config.ts:34`) — never a hardcoded `node_modules` path.
      The resolver already walks up from `import.meta.dirname` and handles npm and bun,
      global and local installs, and the legacy `spur-cli/config` layout.

- [x] R3. When neither tier holds the file the command fails loudly, naming **both** probed
      absolute paths. A `bundledConfigRoot()` of `null` — the compiled-binary case — degrades
      to the same not-found error rather than throwing.

- [x] R4. The lifecycle adapter drops its global tier (`make-lifecycle-adapter.ts:56-58`) and
      its doc comment stops describing three tiers. After this task
      `~/.config/spur/workflows/` is read by nothing: it is neither refreshed nor deleted by
      Spur, and an operator may remove it by hand. `~/.config/spur/` itself is untouched —
      it stays authoritative for rules (`RuleService` priority 10) and for `config.yaml`
      (the A4 layered loader).

- [x] R5. `bun run spur-check` green; new resolution logic carries tests at the ≥90%
      line/function bar covering precedence, the both-tiers-missing negative, and the
      null-bundled-root path.
### Acceptance Criteria
#### Scenario: an unresolvable project path falls back to the bundled tree (R1)
```gherkin
Given a project whose .spur/workflows/ does not contain "basic.yaml"
And the bundled config root contains workflows/basic.yaml
When I run "spur workflow validate .spur/workflows/basic.yaml"
Then the command reports the workflow as valid
And the resolved source is the bundled tree
```

#### Scenario: an existing project path wins over the bundled copy (R1)
```gherkin
Given .spur/workflows/basic.yaml exists and differs from the bundled copy
When I resolve "basic.yaml" through the workflow CLI surface
Then the project file is the one loaded
And the resolved source is the project layer
```

#### Scenario: the bundled root is resolved, not hardcoded (R2)
```gherkin
Given a spur installation whose package lives outside the default node_modules location
And that package ships config/workflows/basic.yaml
When I resolve "basic.yaml" through the workflow CLI surface from an unrelated directory
Then the bundled copy is found
```

#### Scenario: a workflow missing from both tiers names both probed paths (R3)
```gherkin
Given neither the project path nor the bundled tree contains "absent.yaml"
When I run "spur workflow validate .spur/workflows/absent.yaml"
Then the command reports the workflow as not found
And the message contains the probed project absolute path
And the message contains the probed bundled absolute path
```

#### Scenario: a null bundled root degrades without throwing (R3)
```gherkin
Given bundledConfigRoot() resolves to null as it does in a compiled binary
And the project path does not contain the requested workflow
When I resolve that workflow through the workflow CLI surface
Then the result reports the workflow as not found
And no exception escapes the resolver
```

#### Scenario: the lifecycle adapter no longer consults the global tree (R4)
```gherkin
Given ~/.config/spur/workflows/task-lifecycle.yaml exists
And neither the bundled tree nor the project path contains task-lifecycle.yaml
When the lifecycle adapter resolves that profile
Then it returns no adapter and the caller falls back to the schema-only port
And the global copy is left untouched on disk
```

#### Scenario: the quality gate stays green (R5)
```gherkin
When I run "bun run spur-check"
Then it passes
```
### Q&A
#### Ruling applied — two tiers, not three

Operator, 2026-08-23: fall back to the bundled tree, not the global one.

| Tier | `task-pipeline.yaml` vs repo SSOT |
| --- | --- |
| bundled (`@gobing-ai/spur@0.3.60/config/workflows/`) | identical |
| global (`~/.config/spur/workflows/`) | 785 lines stale |

The global tree is the least trustworthy of the three sources, and stale precisely because
`seedGlobalConfig` is create-only. Removing it as a workflow source **deletes** the staleness
problem instead of building machinery to manage it — the global-workflow-refresh requirement
in this task's omnibus draft is dropped outright, and 0649 narrows to the config file.

Safety of dropping the tier rests on Background 8–10: it existed only for the compiled-binary
case, that case is not shipped, and it is already broken there by other means. Dropping it
removes an inconsistency rather than opening a hole.

`~/.config/spur/` is **not** retired — it stays authoritative for rules (`RuleService`
priority 10) and for `config.yaml` (the A4 layered loader). Only its `workflows/` subtree
stops being read.

#### Correction to the operator's phrasing

The ruling named `~/node_modules/@gobing-ai/spur/config/workflows/` as the fallback. That is
the path on this machine, not the contract: R2 uses `bundledConfigRoot()`, which already
handles npm and bun, global and local installs, and the legacy `spur-cli/config` layout.
Hardcoding the observed path would break every other install shape.

#### Answered by verification

- *Do workflows already fall back?* Only the lifecycle adapter and `workflow list`. The
  `workflow run` surface does not — probed, Background 2.
- *Is the compiled-binary case a real loss?* No — Background 9, 10.
- *Does this change `workflows.paths` config semantics?* No. That key drives `workflow list`
  discovery, not `workflow run` path resolution; explicitly out of scope.

#### Nothing blocking

This task has no open questions. The `version` ruling that blocks 0649 R6 does not touch this
slice.
### Design
#### Frozen decision

Two tiers, not three. The global workflow tier is removed rather than repaired — see
[0649](0649_config-1-2-idempotent-spur-self-init-and-pre-a4-global-confi.md) Q&A for the
measurement that drove it (bundled tree identical to SSOT at 0.3.60; global tree 785 lines
stale on `task-pipeline.yaml`).

#### Frozen API

Add one exported helper to `packages/app/src/services/workflow-service.ts`, beside the
layering `list()` already performs at `:920-957`:

```ts
/** Resolve a workflow path: literal (cwd-relative) first, then the bundled tree. */
export function resolveWorkflowFile(
    cwd: string,
    file: string,
): { path: string; source: 'project' | 'bundled' } | { path: null; probed: [string, string | null] };
```

Returning the probed pair (rather than throwing) keeps the error message the caller's job and
makes R3's "name both paths" testable without capturing stderr. `probed[1]` is `null` when
`bundledConfigRoot()` returns `null`.

Bundled lookup is `join(bundledConfigRoot(), 'workflows', basename(file))`. Basename, not the
full relative path: callers pass `.spur/workflows/task-pipeline.yaml`, and the bundled tree is
flat under `workflows/`.

#### Call sites (exhaustive)

| File:line | Current | Change |
| --- | --- | --- |
| `apps/cli/src/commands/workflow.ts:436` | `loadWorkflowDef(resolve(context.cwd, file), …)` | resolve via helper; error names both probed paths |
| `apps/cli/src/commands/workflow.ts:511` | same, inside the async/detached branch | same |
| `apps/cli/src/commands/workflow.ts:763` | `const filePath = resolve(context.cwd, file)` (validate) | same |
| `apps/cli/src/workflow/make-lifecycle-adapter.ts:56-58` | tier 3 global lookup | delete the block and the `globalConfigRoot` import if it becomes unused |

#### Anti-patterns to avoid

- **Do not add a second resolver.** `list()` already layers; `make-lifecycle-adapter.ts:44`
  already ladders. This task consolidates onto one helper — adding a third is the 0071/F5
  disagreement bug in a new place.
- **Do not silently swallow a missing file.** R3 exists because a fallback that hides a typo
  is worse than no fallback.
- **Do not touch `workflows.paths` config semantics.** That key drives `workflow list`
  discovery, not `workflow run` path resolution. Out of scope.
- **Do not delete `~/.config/spur/workflows/`.** R4 makes it vestigial, not garbage to
  collect; deleting user files is not this task's business.

#### Handoffs

- [0649](0649_config-1-2-idempotent-spur-self-init-and-pre-a4-global-confi.md) — independent;
  may proceed in parallel.
- [0650](0650_config-1-2-retire-spur-workflows-and-spur-templates-from-see.md) — **blocked on
  this task.** Unlinking `.spur/workflows` before R1 lands breaks the tree immediately.
### Plan
- [x] Add `resolveWorkflowFile()` to `packages/app/src/services/workflow-service.ts` with the
      frozen signature in Design (R1, R2, R3)
- [x] Wire the three `apps/cli/src/commands/workflow.ts` sites (`:436`, `:511`, `:763`) onto
      the helper and make their not-found errors name both probed paths (R1, R3)
- [x] Delete the global tier from `make-lifecycle-adapter.ts:56-58`, drop the now-unused
      `globalConfigRoot` import if orphaned, and correct the three-tier doc comment (R4)
- [x] Add tests: precedence, both-tiers-missing, null bundled root, and adapter no-global (R5)
- [x] Run `bun run spur-check` (R5)
### Solution
| file:line | Change |
| --- | --- |
| `packages/app/src/services/workflow-service.ts:1466` | Add exported `resolveWorkflowFile(cwd, file)` helper: literal (cwd-relative) path first, then bundled-tree fallback (`join(bundledConfigRoot(), 'workflows', basename(file))`); returns `{ path, source }` or `{ path: null, probed }`. |
| `packages/app/src/services/workflow-service.ts:488` | `validate()` resolves via the helper; not-found names both probed absolute paths instead of a single `File not found`. |
| `packages/app/src/services/workflow-service.ts:578` | `run()` resolves via the helper; both-tiers-missing throws naming both probed paths. |
| `packages/app/src/services/workflow-service.ts:687` | `maybeLinkPipelineRun()` re-resolves via the helper so the pipeline link works for a bundled-only workflow. |
| `packages/app/src/index.ts:481` | Re-export `resolveWorkflowFile` from `@gobing-ai/spur-app`. |
| `apps/cli/src/commands/workflow.ts:462` | Plan preview resolves via the helper (advisory). |
| `apps/cli/src/commands/workflow.ts:540` | Steering identity resolves via the helper (advisory). |
| `apps/cli/src/commands/workflow.ts:797` | `workflow show` resolves via the helper; not-found names both probed paths. |
| `apps/cli/src/workflow/make-lifecycle-adapter.ts:24` | Drop the global `~/.config/spur/workflows/` tier from `resolveWorkflowPath`; two-tier (bundled → project) ladder remains; remove `globalConfigRoot()` and the homedir/`SPUR_GLOBAL_RULES_DIR` override. |

Task 0648 gives the `workflow run`/`validate`/`show` CLI surfaces the same bundled-tree
fallback every other resolver already has (ADR-015 ladder), two tiers instead of three: an
existing project path always wins; the bundled tree is the fallback; the vestigial global
workflows tier is removed rather than repaired (it served only the compiled-binary case,
which is not shipped and already broken). `resolveWorkflowFile()` centralizes the rule so
the CLI and service never disagree, and returns the probed path pair so R3's "name both
paths" is testable without stderr capture.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Workflow run and validate share resolveWorkflowFile; tests cover bundled fallback and project precedence, and a source-local CLI smoke validated task-pipeline from an unrelated empty cwd. |
| R2 | MET | The fallback obtains its root through bundledConfigRoot and joins the workflows directory with the requested basename. |
| R3 | MET | Tests cover both named probe paths and the null-bundled-root branch without throwing. |
| R4 | MET | Lifecycle adapter tests confirm the global workflow tier is absent and project-to-bundled resolution is shared. |
| R5 | MET | Root lint, typecheck, 6332 tests, and coverage gates pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: an unresolvable project path falls back to the bundled tree | MET | command | Source-local CLI validation from an unrelated empty cwd returned a valid bundled task-pipeline. |
| Scenario: an existing project path wins over the bundled copy | MET | test | workflow-service project-precedence test passes. |
| Scenario: the bundled root is resolved, not hardcoded | MET | test | workflow-service bundled-root resolution test passes. |
| Scenario: a workflow missing from both tiers names both probed paths | MET | test | workflow-service not-found diagnostic test passes. |
| Scenario: a null bundled root degrades without throwing | MET | test | resolveWorkflowFile null-root test passes. |
| Scenario: the lifecycle adapter no longer consults the global tree | MET | test | make-lifecycle-adapter tests pass. |
| Scenario: the quality gate stays green | MET | command | bun run spur-check passed 6332 tests with zero failures. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | bun-run-spur-check | — | 6291 tests, 0 fail; all rules green |
### References
#### Feature and siblings

- Feature [A4 Spur config 1.2](../features/A4_spur-config-1-2-global-project-layered-configuration.md) — status `verifying`; this task is part of its post-ship migration gap
- [0649 idempotent spur self init](0649_config-1-2-idempotent-spur-self-init-and-pre-a4-global-confi.md) — independent sibling, may run in parallel
- [0650 retire .spur/workflows and .spur/templates](0650_config-1-2-retire-spur-workflows-and-spur-templates-from-see.md) — **blocked on this task**

#### Code

- `apps/cli/src/commands/workflow.ts:436,511,763` — the three unlayered `resolve(cwd, file)` sites (R1)
- `packages/app/src/services/workflow-service.ts:920-957` — the existing project→global layering (R1)
- `apps/cli/src/workflow/make-lifecycle-adapter.ts:44-58` — the three-tier ladder R4 reduces to two
- `packages/config/src/bundled-config.ts:34-51` — `bundledConfigRoot()` (R2)
- `packages/config/src/bundled-config.ts:28-33` — the documented `null` return in a compiled binary (R3)

#### Authority

- ADR-015 — the `bundled → global → local` asset ladder; this task settles the `workflow run` surface at two tiers
- ADR-072 / `docs/00_ADR.md:218-220` — `planning-pipeline.yaml` retired, still present in the vestigial global tree
- `AGENTS.md` — four-surface rule; this task changes no noun or verb, only resolution behavior
### History
- 2026-08-24T05:44:50.261Z todo → wip (system)
- 2026-08-24T06:12:56.846Z wip → testing (system)
- 2026-08-24T06:25:31.101Z testing → done (system)
