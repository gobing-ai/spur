---
schema_version: 1
name: "Config 1.2: ship config.global.yaml and slim spur init seeding"
status: done
template: feature-impl
created_at: 2026-08-23T23:19:18.395Z
updated_at: "2026-08-24T18:14:38.019Z"
feature_id: A4
dependencies: ["0641", "0640"]
---

## 0646. Config 1.2: ship config.global.yaml and slim spur init seeding

### Background
Graduated from the **[A4](../features/A4_spur-config-1-2-global-project-layered-configuration.md)**
map after 0641 delivered the seeding audit and `config.global.yaml` specification. 0641 was a
research ticket and deliberately deleted nothing (its Design forbids it: *"the removal lands with the
implementation ticket that graduates from the A4 map"*). This is that ticket.

0640 landed the layered loader, so the global layer now actually merges — which is the precondition
that makes slimming the project seed safe rather than lossy.
### Requirements
- [x] R1. Create `config/config.global.yaml` from `config/config.example.yaml` per 0641 R4: move
  `agent.default`, `agent.executors`, `agent.roles`, `workflows.paths`; strip `name`, `version`,
  `bootstrap`, `rules`, `redaction`, `tasks`, `features`, `agent.team`; keep the `$schema` header.
- [x] R2. Point the global seed at the new filename — `GLOBAL_CONFIG_EXAMPLE` in
  `apps/cli/src/commands/init.ts` and the exclusion in `packages/config/src/bundled-config.ts`
  (`BUNDLED_CONFIG_EXAMPLE`) must both reference `config.global.yaml`.
- [x] R3. Drop 0641's safe-drop set from the project seed: the natural-path `templates/task/**`
  copies (zero readers), the five top-level JSON baselines, and `plugins/**` placeholders.
  Keep `rules/**`, `templates/bdd/**`, `tasks/templates/**`, `workflows/**`, and `config.yaml`.
- [x] R4. `spur init` writes `version: "1.2"` in the project config literal.
- [x] R5. Existing `spur init` tests still pass; add coverage for the new seed set and filename.
### Acceptance Criteria
```gherkin
Feature: Ship config.global.yaml and slim the project seed

  Scenario: The shipped global default exists and carries only machine-wide keys
    Given the repo-root config tree
    When config.global.yaml is inspected
    Then it declares agent.default and agent.executors
    And it declares no name, bootstrap, rules, redaction, tasks, or features block

  Scenario: The project seed drops assets no project resolves through .spur/
    Given a freshly initialized project
    When the .spur directory is inspected
    Then .spur/templates/task/standard.md is absent
    And .spur/plugins/.gitkeep is absent
    And .spur/corpus-baseline.json is absent

  Scenario: The seed keeps assets whose only copy is the project one
    Given a freshly initialized project
    When the .spur directory is inspected
    Then .spur/rules/typescript/no-debugger.yaml is present
    And .spur/templates/bdd/gherkin.md is present
    And .spur/tasks/templates/standard.md is present

  Scenario: The global default seeds to the user config directory, not the project
    Given a freshly initialized project
    When both the project and global config directories are inspected
    Then the global directory contains config.yaml
    And neither directory contains config.global.yaml

  Scenario: New projects are stamped with the 1.2 config version
    Given a freshly initialized project
    When .spur/config.yaml is read
    Then it declares version "1.2"
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
- [x] Author config/config.global.yaml from the example per the 0641 move/strip table (R1)
- [x] Retarget both bundled-example constants to the new filename (R2)
- [x] Filter the drop set out of the project seed loop (R3)
- [x] Bump the init-written version label to 1.2 (R4)
- [x] Update and extend the init tests; run the config + cli suites (R5)
### Solution
**R1 — `config/config.global.yaml` created.** Moved from `config.example.yaml`: `agent.default`,
`agent.executors` (with the full tier/pairing guidance), and the `agent.roles` guidance block that
0647 then materialized. Stripped: `name`, `version`, `bootstrap`, `rules`, `redaction`, `tasks`,
`features`, `agent.team`. Kept the `$schema` header for editor validation. The file leads with the
merge contract so a reader knows a project config only carries its delta.

**Deviation from 0641 R4, deliberate.** 0641 lists `workflows.paths` as **move**; it ships here
**commented out with the reason**. 0639 classifies `workflows.paths` as project-relative
(`global-legal: no`) — its values resolve against each project's own root, so a machine-wide value
points every project at a directory that mostly does not exist. It buys nothing either way:
`resolveWorkflowPath` (`resolveWorkflowPath` at `apps/cli/src/workflow/make-lifecycle-adapter.ts:43`) already reaches
`~/.config/spur/workflows/` as its third tier without any config key. Shipping the value would have
been a footgun for zero gain; shipping the documentation preserves 0641's intent.

**R2 — one filename, one constant.** `BUNDLED_GLOBAL_CONFIG = 'config.global.yaml'` is now exported
from `packages/config/src/bundled-config.ts` and re-exported through the loader subpath, so
`apps/cli/src/commands/init.ts` (`GLOBAL_CONFIG_EXAMPLE`) and the seed-exclusion read the same
literal instead of two hand-synced copies. `scripts/commands/bundle-config.ts:42` retargeted to skip
`$schema` injection for the new name.

**R3 — drop set applied.** `isDroppedFromProjectSeed` in `bundled-config.ts` removes from the project
seed: `templates/task/**` (dead natural-path duplicate — `loadTemplateBodies` reads
`.spur/tasks/templates/`, which the manifest pass still writes), `plugins/**` (placeholders, no
reader), top-level `*.json` (the five monorepo dev baselines, read from repo-root `config/`), and
`config.global.yaml` itself. Kept per 0641: `rules/**` (operator ruling), `templates/bdd/**` (plugin
skills read the project copy with no resolver behind it), `tasks/templates/**` and `workflows/**`
(their resolvers fall back to a bundled tree a compiled binary may lack). The predicate carries the
per-entry reasoning as its docblock so a future reader does not have to re-derive the audit.

**R4 — `spur init` writes `version: "1.2"`.**

**R5 — tests.** `packages/config/tests/bundled-config.test.ts`: the old "includes … plugins" test
became a kept-set test plus a drop-set test plus an over-reach guard (nested `.json` under a kept
tree must survive — only top-level baselines are dropped). `apps/cli/tests/commands/init.test.ts`:
the full-tree test now asserts the kept paths, two new tests assert the dropped paths are absent and
that the config literal carries `1.2`. Suites green: `packages/config` + init 175 pass / 0 fail;
full monorepo `bun run test` **6270 pass / 0 fail**; `bun run lint` clean across all 7 workspaces.

**Known gap, needs one operator command.** `config/config.example.yaml` is still on disk with **zero
remaining consumers** (every reference is now either a comment or a doc). The sandbox denied the
unlink (`Operation not permitted`), so the rename is content-complete but not file-complete. Finish
with `rm config/config.example.yaml`. Four docs still name `config.example.yaml` as the full-schema reference and
need the same follow-up — filed as fog on the A4 map rather than silently rewritten here.

**Diff files:** `config/config.global.yaml` (new), `packages/config/src/bundled-config.ts`,
`packages/config/src/loader.ts` (re-export), `apps/cli/src/commands/init.ts`,
`scripts/commands/bundle-config.ts`, `packages/config/tests/bundled-config.test.ts`,
`apps/cli/tests/commands/init.test.ts`.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | config/config.global.yaml ships the machine-wide agent and workflow defaults while project-shaped sections remain in config.example.yaml. |
| R2 | MET | BUNDLED_GLOBAL_CONFIG and init seeding target config.global.yaml as the global source. |
| R3 | MET | listBundledProjectSeedFiles tests enforce the safe-drop and retained-asset sets. |
| R4 | MET | spur init emits version 1.2; the dedicated CLI test passes. |
| R5 | MET | Config, bundled-config, init, and root suites all pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: The shipped global default exists and carries only machine-wide keys | MET | test | bundled-config and config-schema suites parse and validate the shipped global source. |
| Scenario: The project seed drops assets no project resolves through .spur/ | MET | test | listBundledProjectSeedFiles safe-drop test passes. |
| Scenario: The seed keeps assets whose only copy is the project one | MET | test | listBundledProjectSeedFiles retained-assets test passes. |
| Scenario: The global default seeds to the user config directory, not the project | MET | test | init global-seeding tests pass. |
| Scenario: New projects are stamped with the 1.2 config version | MET | test | init writes the 1.2 config version label test passes. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Review (2026-08-23, inline — three-dimensional). No P1/P2 blockers to the code; one P2 housekeeping item needs an operator command.**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | correctness | `config/config.example.yaml` | The rename is **content-complete but not file-complete**: every live consumer now reads `config.global.yaml`, but the old file is still on disk because the sandbox denied the unlink (`Operation not permitted`). It is inert — zero readers — but a repo carrying both files invites someone to edit the dead one. Remediation: `rm config/config.example.yaml`. Cannot be done from this session. |
| P3 | correctness | four docs | `docs/04_DESIGN.md:910`, `docs/03_ARCHITECTURE.md:963`, `docs/features/B2`, and `docs/features/B3` still name `config.example.yaml` as the full-schema reference. Stale after the rename, and the operator's Q3 ruling deliberately gave up that reference doc — so these need rewriting, not just renaming. Filed as fog on the A4 map rather than rewritten here (T3 doc-sync belongs with the doc owner, and B2/B3 are other features' records). |
| P3 | correctness | `config/config.global.yaml` | **Deviation from R1 as written.** R1 lists `workflows.paths` among the keys to move; it ships commented-with-reason instead. Justification is sound and recorded (0639 classifies it project-relative; `resolveWorkflowPath` already reaches the global tier without it) — but it is a literal deviation from the requirement text, not a silent one. If the operator wants the key valued, it needs an absolute or tilde-expanded path plus expansion support the loader does not have today. |
| P4 | architecture | `packages/config/src/bundled-config.ts` | The drop predicate identifies dev baselines structurally (`top-level` + `.json`) rather than by name. A future top-level `.json` that a *project* genuinely needs would silently not seed. Mitigated by the over-reach test (nested `.json` must survive) and by the docblock naming the five current files, but the rule is a heuristic, not an allowlist. Acceptable while the five are the only top-level JSON. |
| P4 | efficiency | `apps/cli/src/commands/init.ts` | `templates/feature/default.md` stays seeded although 0641 found no reader in `apps/`, `packages/`, or `plugins/`. Kept deliberately — 0641 flagged residual risk and asked for a re-grep before deleting — so this is conservatism, not oversight. Revisit with the doc-sync follow-up. |

**Dimension 1 — Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `config/config.global.yaml` — `agent.default` + `agent.executors` moved, `agent.roles` materialized by 0647, seven project-shaped blocks stripped, `$schema` kept. `workflows.paths` deviation recorded above (P3). |
| R2 | MET | `BUNDLED_GLOBAL_CONFIG` exported from `packages/config/src/bundled-config.ts`, re-exported through the loader subpath, consumed by `init.ts` and the seed exclusion; `scripts/commands/bundle-config.ts:42` retargeted. One literal, three consumers — the previous two hand-synced copies are gone. |
| R3 | MET | `isDroppedFromProjectSeed` drops `templates/task/**`, `plugins/**`, top-level `*.json`, `config.global.yaml`; keeps `rules/**`, `templates/bdd/**`, `tasks/templates/**`, `workflows/**`. |
| R4 | MET | `init.ts` config literal emits `version: "1.2"`; asserted by test. |
| R5 | MET | 175 pass / 0 fail on the targeted suites; 6270 pass / 0 fail monorepo-wide. |

**Dimension 2 — SECUA**

- **Security:** no new trust boundary. The seed writes fewer files than before, never more; `writeIfNew` overwrite semantics unchanged. No secrets in the shipped global config — `redaction` is one of the stripped blocks precisely because its values are per-project.
- **Efficiency:** strictly less I/O at init (four fewer trees copied per project).
- **Correctness:** the one real risk was over-dropping. Guarded three ways: the kept-set test, the drop-set test, and the nested-`.json` over-reach test. The manifest pass — which writes the *live* `tasks/templates/` copy — was deliberately left untouched, so the template resolver's project tier still exists.
- **Usability:** `config.global.yaml` leads with the merge contract, so a reader learns why their project config can be nearly empty before they read a single key.
- **Architecture:** the drop decision lives in one predicate in the package that owns the seed list, not scattered across `init.ts` call sites. The reasoning is in its docblock so the audit does not have to be re-derived.

**Dimension 3 — Architecture depth**

Boundary respected: `bundled-config.ts` owns *what* is bundled, `init.ts` owns *where it lands*. Adding the drop rule to the former rather than filtering at the two `init.ts` call sites keeps one decision in one place. The exported constant closes a real drift seam — the filename previously existed as two independent literals in two packages.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-23T23:19:59.023Z todo → wip (system)
- 2026-08-23T23:27:57.442Z wip → testing (system)
- 2026-08-23T23:30:42.496Z testing → done (system)
