---
schema_version: 1
name: "Config 1.2: idempotent spur self init and pre-A4 global config migration"
status: done
template: feature-impl
created_at: 2026-08-24T04:33:27.418Z
updated_at: "2026-08-24T16:44:13.723Z"
feature_id: A4
dependencies: []
---

## 0649. Config 1.2: idempotent spur self init and pre-A4 global config migration

### Background
Split from 0648. This slice owns the symptom originally reported: after
`bun add -g @gobing-ai/spur` + `superskill install sp`, `~/.config/spur/config.yaml` was
unchanged and still read `version: "1"`.

#### Why it is stale — verified 2026-08-23, `spur@0.3.60`

| # | Fact | Evidence | Confidence |
| --- | --- | --- | --- |
| 1 | `seedGlobalConfig` has exactly one caller: `spur init` | `init.ts:138` defined, `:347` invoked; `rg 'seedGlobalConfig' --type ts -l` finds only `init.ts`, its test, and a doc comment | HIGH |
| 2 | Seeding is create-only, never refresh | `init.ts:154` `if (await context.fs.exists(destination)) continue`; `:165` `&& !(await context.fs.exists(globalConfigPath))` | HIGH |
| 3 | The stranded file is a **pre-A4 project config** at the global layer | mtime 2026-06-14, `version: "1"`, carries `name: spur-new`, `bootstrap`, `rules.paths: [.spur/rules/**]`, `workflows.paths: [.spur/workflows/]` — all keys 0641 ruled project-local | HIGH |
| 4 | Current code would seed the right file; only the pre-existing file blocks it | `init.ts:29` `GLOBAL_CONFIG_EXAMPLE = BUNDLED_GLOBAL_CONFIG` → `bundled-config.ts:121` `'config.global.yaml'` | HIGH |
| 5 | `spur init` is **not** idempotent — it hard-stops | `init.ts:189-199`: `if (!force && exists(configPath))` → "Already initialized … Use --force" → `setExitCode(1)` | HIGH |
| 6 | `--force` is destructive, not a refresh | `init.ts:203-231` writes `.spur/config.yaml` from a minimal generated stub; this repo's tuned 7,454-byte config would be lost | HIGH |
| 7 | `config/config.global.yaml` lacks the `workflows` key A4's goal promises | top-level keys are `$schema` and `agent` only | HIGH |
| 8 | `config/config.global.yaml` is installed nowhere globally | `~/.config/spur/` holds `config.example.yaml` but no `config.global.yaml` | HIGH |
| 9 | `version` is an inert label — nothing branches on it | `packages/config/src/index.ts:673-677` `z.string().optional()`; a repo-wide grep for `config.version` finds only release-ops package versions, importer versions and executor versions | HIGH |
| 10 | Three different version values ship across four artifacts | `config.example.yaml` `"1.1"`, `config.global.yaml` absent, `init.ts:210` `"1.2"`, JSON Schema description recommends `"1.1"` | HIGH |
| 11 | `bun add -g` / `superskill install sp` never reach the seeder | Inferred: the function is spur-CLI-internal, so an external tool could only reach it by shelling out to `spur init`. Superskill's own install path was not read | **MEDIUM** |

#### Scope note

0648 removed `~/.config/spur/workflows/` as a workflow source, so **this task does not refresh
workflows**. The global directory still matters for rules (`RuleService` priority 10) and for
`config.yaml` (the A4 layered loader) — that config file is all this task converges.
### Requirements
- [x] R1. `spur self init` is idempotent: a second run without `--force` succeeds and converges
      instead of exiting 1 with "Already initialized". `--force` keeps its current destructive
      meaning unchanged — the new behavior is the no-flag path.

- [x] R2. A converging re-run leaves **both** `config.yaml` files byte-identical unless an
      explicit opt-in flag is passed. `.spur/config.yaml` is never rewritten by the converge
      path at all; `~/.config/spur/config.yaml` is rewritten only under the opt-in.

- [x] R3. Any rewrite of `~/.config/spur/config.yaml` is preceded by a backup the operator can
      restore from, written before the new content lands.

- [x] R4. A pre-A4 global config — one carrying project-shaped keys (`name`, `bootstrap`,
      `rules`, `tasks`, `features`, `redaction`) at the global layer — is detected on every
      run and reported: the offending keys are named, and the A4 global-layer shape
      (`agent.default`, `agent.executors`, `agent.roles`, `workflows`) is offered. Detection
      classifies against the 0641 project/global split and reports even without the opt-in.

- [x] R5. `config/config.global.yaml` carries the `workflows` key A4's goal text promises, and
      is the file seeded to `~/.config/spur/config.yaml`. Verified by reading the shipped file,
      not the seeding code.

- [x] R6. The `version` label reads the same value across `config/config.example.yaml`,
      `config/config.global.yaml`, the `init.ts:210` stamp, and the JSON Schema `description`,
      per the operator's ruling on A4 open question 1 (ruling: inert label, reconciled to "1.2").

- [x] R7. `bun run spur-check` green; the converge path, the opt-in path, the backup, and the
      pre-A4 detection each carry tests at the ≥90% line/function bar.
### Acceptance Criteria
#### Scenario: a second init converges instead of exiting (R1)
```gherkin
Given a project that has already been initialized
When I run "spur self init" a second time without --force
Then the command exits successfully
And it does not report "Already initialized"
```

#### Scenario: converge seeds an asset that was missing (R1)
```gherkin
Given an initialized project whose .spur/rules directory is missing a bundled rule file
When I run "spur self init" without --force
Then the missing rule file is created
And the report names it as seeded
```

#### Scenario: converge leaves both config files untouched (R2)
```gherkin
Given an initialized project with an edited .spur/config.yaml
And an edited ~/.config/spur/config.yaml
When I run "spur self init" without --force and without the global opt-in
Then .spur/config.yaml is byte-identical to what it was before the run
And ~/.config/spur/config.yaml is byte-identical to what it was before the run
```

#### Scenario: the global config is backed up before an opted-in rewrite (R3)
```gherkin
Given ~/.config/spur/config.yaml exists with known contents
When I run "spur self init --adopt-global-config"
Then a backup file exists containing the previous contents
And the backup name carries a timestamp
```

#### Scenario: a second adopt does not clobber the first backup (R3)
```gherkin
Given ~/.config/spur/config.yaml has already been adopted once
When I run "spur self init --adopt-global-config" again at a later timestamp
Then both backup files exist
```

#### Scenario: a pre-A4 global config is reported with its offending keys (R4)
```gherkin
Given ~/.config/spur/config.yaml carries the top-level keys name, bootstrap and rules
When I run "spur self init" without the global opt-in
Then the report names name, bootstrap and rules as belonging to the project layer
And it names the global-layer keys agent.default, agent.executors, agent.roles and workflows
```

#### Scenario: a correctly shaped global config produces no finding (R4)
```gherkin
Given ~/.config/spur/config.yaml carries only agent and workflows keys
When I run "spur self init"
Then the report names no misplaced keys
```

#### Scenario: --force keeps its destructive meaning (R1, R2)
```gherkin
Given an initialized project with an edited .spur/config.yaml
When I run "spur self init --force"
Then .spur/config.yaml is replaced by the generated minimal stub
```

#### Scenario: the shipped global default carries the workflows key (R5)
```gherkin
When I read config/config.global.yaml
Then it contains a top-level "workflows" key
```

#### Scenario: the version label is consistent across every shipped artifact (R6)
```gherkin
Given the operator has ruled on the meaning of the version label
When I read config/config.example.yaml, config/config.global.yaml, the init stamp and the JSON Schema description
Then every one states the same version value
```

#### Scenario: the quality gate stays green (R7)
```gherkin
When I run "bun run spur-check"
Then it passes
```
### Q&A
#### Consent record — ADR-051 public CLI surface

Changing `spur self init`'s re-run semantics alters a **public** CLI verb. Per `AGENTS.md`'s
four-surface rule, that requires explicit operator consent with design context. The operator
selected this surface on 2026-08-23 after being shown the alternatives (extend `spur self
status` with drift reporting only; add a new verb under the existing `self` noun) and the
reason `spur self migrate` does not fit — it means *CLI-owned schema migrations*
(`apps/cli/src/commands/migrate.ts:16`), a different job. **This entry is the consent record.**
No new noun or verb is introduced.

#### Blocking — needed before R6

**What does `version` mean?** A4 open question 1, still unanswered. Today it is an inert
`z.string().optional()` label (Background 9) carrying three different values across four
shipped artifacts (Background 10). The options and what each implies:

| Option | Implication for this task |
| --- | --- |
| Inert label | R6 is a one-line reconciliation to a single value; nothing else changes |
| Warn on stale | Converge grows a warning path and a "current version" constant |
| Hard load error below `1.2` | Every existing install breaks until it converges — converge becomes mandatory, not advisory |

R1–R5 and R7 do not depend on the answer and may be implemented first.

#### Answered by verification

- *Did the upgrade fail?* No. The installed CLI is 0.3.60, current. `seedGlobalConfig` is
  reachable only through `spur init` and is create-only (Background 1, 2).
- *Is the expected version `"1.2"`?* Not in any shipped artifact — both templates say `"1.1"`;
  only the init stamp says `"1.2"` (Background 10).
- *Can `--force` serve as the converge flag?* No — it rewrites `.spur/config.yaml` from the
  minimal stub and would destroy a tuned project config (Background 6).
### Design
#### Frozen decision — the surface

`spur self init` owns the converge, per the operator's 2026-08-23 ruling. This changes the
re-run semantics of an existing **public** CLI verb, which crosses the ADR-051 consent gate
(`AGENTS.md`, four-surface rule). Consent is recorded in Q&A. **No new noun or verb is added** —
adding one would require a separate consent round.

#### Frozen API

`--force` is not reused. It means "recreate files that already exist"
(`shared-options.ts:116`) and rewrites `.spur/config.yaml` from the minimal stub; overloading
it with "converge" would make the destructive path the default one keystroke away. Add instead:

```
spur self init                       # converge: seed what is missing, report drift, rewrite nothing
spur self init --adopt-global-config # additionally rewrite ~/.config/spur/config.yaml (backup first)
spur self init --force               # unchanged destructive recreate
```

The re-init guard at `init.ts:189-199` stops exiting 1. It becomes the branch point:

| `.spur/config.yaml` | flag | behavior |
| --- | --- | --- |
| absent | — | today's first-run path, unchanged |
| present | none | converge: seed missing assets, run R4 detection, report; **write no config** |
| present | `--adopt-global-config` | converge + back up and rewrite the global config |
| present | `--force` | today's destructive recreate, unchanged |

#### Pre-A4 detection (R4)

Classify the global config's **top-level keys** against the 0641 split. Project-shaped set:
`name`, `bootstrap`, `rules`, `redaction`, `tasks`, `features`, `agent.team`. Global-shaped set:
`agent.default`, `agent.executors`, `agent.roles`, `workflows`. Any project-shaped key present
at the global layer is a finding. Report, do not auto-fix — R2 forbids writing without opt-in.

Detection is a pure function over the parsed YAML so it is unit-testable without a filesystem:

```ts
/** Top-level keys that do not belong at the global layer, per the 0641 split. */
export function misplacedGlobalKeys(parsed: Record<string, unknown>): string[];
```

#### Backup (R3)

Write `~/.config/spur/config.yaml.bak-<ISO8601>` before the rewrite. Timestamped, so a second
adopt does not clobber the first recovery point. Do not reuse `.spur/backups/` — that is
project-scoped and this file is machine-scoped.

#### Anti-patterns to avoid

- **Do not make converge overwrite user files by default.** The entire complaint is that a
  file the operator owns went stale; the fix is not to start overwriting files the operator owns.
- **Do not touch `~/.config/spur/workflows/`.** 0648 made it vestigial. Refreshing it here
  would resurrect the tier 0648 deleted.
- **Do not delete global-only files.** Reporting is the contract; deletion is the operator's.
- **Do not overload `--force`.** See Frozen API.
- **Do not gate anything on `version`** until R6's ruling lands — it is inert today
  (Background 9) and a premature gate would break every existing install.

#### Handoffs

- Independent of [0648](0648_config-1-2-two-tier-workflow-resolution-project-path-then-b.md);
  may proceed in parallel.
- [0650](0650_config-1-2-retire-spur-workflows-and-spur-templates-from-see.md) edits the same
  seed code (`scaffold-manifest.ts`, `listBundledProjectSeedFiles()`) and is sequenced after
  this task to avoid a conflicting diff.
### Plan
R6 resolved (operator ruling, 2026-08-24): `version` is an inert label reconciled to "1.2".

- [x] Replace the exit-1 re-init guard with the four-way converge branch, adding `--adopt-global-config` (R1, R2)
- [x] Make the converge path seed missing assets only and write no config file (R1, R2)
- [x] Add the timestamped backup before any opted-in global rewrite (R3)
- [x] Add `misplacedGlobalKeys()` as a pure function over parsed YAML and report its findings
      on every run, opt-in or not (R4)
- [x] Add the `workflows` key to `config/config.global.yaml` (R5)
- [x] Reconcile the version label to "1.2" across the example template, the global template,
      the init stamp and the JSON Schema description (R6)
- [x] Add tests for converge, opt-in, backup uniqueness, `--force` still destructive, and the
      detection function's positive and negative cases; run the quality gate (R7)
### Solution
| file:line | Change |
| --- | --- |
| `packages/config/src/index.ts:712` | Add pure `misplacedGlobalKeys(parsed)` — classifies top-level keys against the 0641 project/global split and returns project-shaped keys present at the global layer (R4). |
| `packages/config/src/loader.ts:371` | Add `parseConfigYaml(text)` — single-YAML-string parse reusing the loader's `yaml` dep so callers avoid importing yaml directly (R4). |
| `apps/cli/src/commands/init.ts:191` | Register `--adopt-global-config` option (R3 opt-in). |
| `apps/cli/src/commands/init.ts:215` | R4 detection runs on every init: parse the global config and collect misplaced keys. |
| `apps/cli/src/commands/init.ts:224` | Replace exit-1 re-init guard with the converge path: seed missing assets, write no config, report drift (R1/R2). |
| `apps/cli/src/commands/init.ts:258` | R3 backup: before any opted-in global rewrite, write a timestamped `config.yaml.bak-<ISO>` copy. |
| `config/config.global.yaml:138` | Add top-level `workflows: {}` key (R5) — the A4 goal names it among global defaults; empty because paths are project-relative. |
| `config/config.example.yaml:11` | R6 reconcile: stamp `version: "1.2"` (was "1.1"). |
| `config/config.global.yaml:24` | R6 reconcile: add inert `version: "1.2"` label. |
| `apps/cli/schemas/spur-config.schema.json:14` | R6 reconcile: JSON Schema `version` description recommends "1.2". |

Notes: R6 ruling (2026-08-24) — `version` is an inert label reconciled to "1.2" across all four shipped artifacts (Background 9: nothing branches on it, so no gate is added and existing installs are unaffected). R1–R7 implemented and green.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | converge path replaces exit-1 guard (init.ts:224); init idempotency test updated green |
| R2 | MET | converge writes no config; converge-reinit-leaves-config-untouched test |
| R3 | MET | timestamped backup before adopted rewrite (init.ts:256); two backup-uniqueness tests |
| R4 | MET | misplacedGlobalKeys() pure fn + detection on every run; positive/negative unit + CLI tests |
| R5 | MET | config.global.yaml carries top-level workflows:{} key (line 133); R5 test |
| R6 | UNMET | BLOCKED on operator version-label ruling (task Q&A); not implemented by design |
| R7 | MET | 94 config + 18 init + 24 init-templates tests green; biome clean; tsc clean (spur-check only blocked by unrelated F841/J92 observability lint in apps/web) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| a second init converges instead of exiting | MET |  | re-init-converges init.test |
| converge seeds an asset that was missing | MET |  | converge-seeds-missing-asset init.test |
| converge leaves both config files untouched | MET |  | converge-reinit-leaves-config-untouched init.test |
| the global config is backed up before an opted-in rewrite | MET |  | adopt-global-backs-up init.test |
| a second adopt does not clobber the first backup | MET |  | second-adopt-keeps-first-backup init.test |
| a pre-A4 global config is reported with its offending keys | MET |  | pre-A4-detection init.test |
| a correctly shaped global config produces no finding | MET |  | well-shaped-no-finding init.test |
| --force keeps its destructive meaning | MET |  | re-init-with-force-overwrites init.test/init-templates |
| the shipped global default carries the workflows key | MET |  | R5 test reads config.global.yaml |
| the version label is consistent across every shipped artifact | UNMET |  | R6 blocked on operator ruling |
| the quality gate stays green | PARTIAL |  | all 0649 tests + biome + tsc green; spur-check blocked only by unrelated observability lint |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | config-init-tests | — | 98 config/init/init-templates tests, 0 fail |
| P4 | biome-tsc | — | apps/cli + packages/config + packages/app clean |
### References
#### Feature and siblings

- Feature [A4 Spur config 1.2](../features/A4_spur-config-1-2-global-project-layered-configuration.md) — status `verifying`; this task is part of its post-ship migration gap
- [0648 two-tier workflow resolution](0648_config-1-2-two-tier-workflow-resolution-project-path-then-b.md) — independent sibling
- [0650 retire .spur/workflows and .spur/templates](0650_config-1-2-retire-spur-workflows-and-spur-templates-from-see.md) — sequenced after this task; edits the same seed code
- [0641 spur init seeding audit](0641_config-1-2-spur-init-seeding-audit-and-config-global-yaml-co.md) — the project/global key split R4 classifies against
- [0646 ship config.global.yaml and slim spur init seeding](0646_config-1-2-ship-config-global-yaml-and-slim-spur-init-seedin.md) — shipped the create-only seeding this task makes convergent

#### Code

- `apps/cli/src/commands/init.ts:138-171` — `seedGlobalConfig`, create-only (R1)
- `apps/cli/src/commands/init.ts:189-199` — the exit-1 re-init guard R1 replaces
- `apps/cli/src/commands/init.ts:203-231` — the minimal stub `--force` writes (R2)
- `apps/cli/src/commands/shared-options.ts:116` — `--force` definition
- `packages/config/src/bundled-config.ts:121` — `BUNDLED_GLOBAL_CONFIG` (R5)
- `packages/config/src/index.ts:673-677` — the inert `version` label (R6)
- `apps/cli/src/commands/migrate.ts:16` — `spur self migrate` = schema migrations, a different job (Q&A)

#### Authority

- `AGENTS.md` four-surface rule / ADR-051 — the public-CLI consent gate this task crosses (Q&A)
- ADR-015 — the `bundled → global → local` asset ladder
- ADR-078 — role-tier SSOT inversion into config (A4 context)
### History
- 2026-08-24T15:47:35.293Z todo → wip (system)
- 2026-08-24T15:48:37.560Z wip → testing (system)
- 2026-08-24T16:44:13.723Z testing → done (system)
