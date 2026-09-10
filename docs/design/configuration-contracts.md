# Configuration and asset contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="2-configuration"></a>

## 2. Configuration

<a id="21-project-config--spurconfigyaml-adr-017"></a>

### 2.1 Project config — `.spur/config.yaml` (ADR-017)

Written by `spur init`. Single YAML config surface; the legacy `.spur/config.json` project marker is
retired. The merged global+project config (ADR-082) is loaded once at the composition root and
threaded through dispatch; the project-first pick below now describes only which file supplies the
project-shaped `bootstrap:` block to ts-infra: project `.spur/config.yaml` (cwd) → fallback
`~/.config/spur/config.yaml`.

Two top-level concerns:

- **Portable `bootstrap:` block** — consumed by `@gobing-ai/ts-infra` `runNodeApplication`. Shared across
  `spur-cli` and (future) `spur-server`. Keys map 1:1 to ts-infra's `LoggingOptions` /
  `TelemetryOptions` / `DatabaseOptions` / `SchedulerOptions`.
- **Spur app section** — everything except `bootstrap:`, validated by the single merged
  `spurConfigSchema` in `@gobing-ai/spur-config` (ADR-027; the former CLI-local `SpurAppConfigSchema`
  was folded in). Keys are agent/rules/workflows/redaction/version/name, plus the planning-layer
  `tasks:`/`features:` blocks: `tasks.folders` (path → `{baseCounter, label?}`), `tasks.active`, `tasks.severity` (finding code → `error` | `warning` | `off`),
  `features.dir`. Under `agent`: `default` (default role), `executors` (tier → executor profiles), and
  `roles` (ADR-061 / 0572 — optional closed-vocabulary per-role tier/stage overrides merged per-field
  over the `DEFAULT_AGENT_ROLES` constant; unknown role ids fail config load). Every finding emitted by task/feature check carries a stable machine code (e.g. `L3.plan-format`, `L4.feature-not-found`) registered in `packages/config/src/finding-codes.ts` (50 codes: L1×2, L2×5, L3×17; L4×26 — `L3.testing-coverage` retired by task 0688, `L3.status-claim-contradiction` retired by task 0691 / ADR-090). `tasks.severity` overrides finding severities or drops findings (`off`) before pass gate evaluation; unknown codes fail config validation. The dogfood `L4.anchor-subject-mismatch: error` override was removed by task 0688 / ADR-088 (residue after the matcher fix is frozen-legacy warnings, not a worked-down true-positive set). The folder fields tolerate a blank/`null` value (an empty YAML…
  the canonical default. `@gobing-ai/spur-config` is the SSOT; `apps/cli/schemas/spur-config.schema.json`
  mirrors it for editor/CI validation.

`version` is a **string** (YAML must quote it: `"1.1"`). Current recommended value is
`"1.1"` (ADR-033 executor tiers + planning blocks). `"1"` remains accepted; there is no hard
migrator yet. Do not use a bare integer (`version: 2` fails Zod `z.string()`).

```yaml
version: "1.1"
name: <project-name>
bootstrap:
  logging:
    enabled: true
    level: info # debug | info | warn | error
    console: false
    json: false
    file: true
    filePath: .spur/logs/spur.log
  telemetry:
    enabled: false # CLI: off by default (per-invocation latency)
    serviceName: spur
    environment: development
  database:
    enabled: true
    driver: bun-sqlite
    url: .spur/spur.db # ${DATABASE_URL} interpolation supported
  scheduler:
    enabled: false # CLI is run-once; no scheduler
    # jobs: [] # declarative recurring commands, read only under `spur serve` — §5.2
agent:
  default: coder # default role for `--agent auto` when nothing is declared (0542 R2 — role domain; legacy executor names warn once under shim agent-default-executor)
  executors: # ADR-033 / 0343 — declare tier (capable-1/2/3 quality ladder)
    - name: omp
      agent: omp
      tier: standard
    - name: claude
      agent: claude
      tier: capable-3
  # roles: # ADR-061 / 0572 — optional per-role override on the closed vocabulary (scribe|coder|reviewer|planner);
  #   reviewer: # per-field merge over DEFAULT_AGENT_ROLES (re-tier/re-stage, never invent); unknown role ids fail config load
  #     tier: capable-2
  # default-by-phase:     # REMOVED 0452 — use executor tier + stage model_policy
  #   dev-run: omp
rules:
  paths:
    - .spur/rules/**/*.yaml
workflows:
  paths:
    - .spur/workflows/
redaction:
  enabled: false
tasks:
  folders:
    docs/tasks: { baseCounter: 0, label: Core } # legacy folders/base_counter absorbed
  active: docs/tasks # default folder for `spur task create`
  severity:
    L3.plan-format: off # rule severity overrides by code (error | warning | off)
features:
  dir: docs/features
```

`${ENV_VAR}` interpolation works via `ts-runtime` `interpolateTree` (used inside
`runNodeApplication`).

<a id="22-app-config--gobing-aispur-config-zod"></a>

### 2.2 App config — `@gobing-ai/spur-config` (Zod)

Env-derived config (`ln(env)`), consumed by both the CLI context and the server Bun entry:

| Key                  | Env var                   | Default                                                                                                              |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `database.url`       | `DATABASE_URL`            | `:memory:`                                                                                                           |
| `server.port`        | `PORT`                    | `3000`                                                                                                               |
| `server.host`        | `HOST`                    | `localhost`                                                                                                          |
| `server.openBrowser` | —                         | `true` (spur serve only)                                                                                             |
| `server.webDistPath` | —                         | `null` (auto-resolve: cwd `dist/web`, package `web/` next to `spur.js`, binary-adjacent `web/`, monorepo `dist/web`) |
| `telemetry.enabled`  | `SPUR_TELEMETRY_ENABLED`  | `false`                                                                                                              |
| `telemetry.endpoint` | `SPUR_TELEMETRY_ENDPOINT` | —                                                                                                                    |
| `logging.level`      | `SPUR_LOG_LEVEL`          | `info` (debug\|info\|warn\|error)                                                                                    |

Boolean env vars are parsed strictly (`true/1/yes/on` vs `false/0/no/off`); other values throw.

<a id="23-default-config-assets--repo-root-config-adr-015"></a>

### 2.3 Default config assets — repo-root `./config` (ADR-015)

Repo-root `./config` is the single source of truth for all Spur default config, separated from source
code:

```
config/
  rules/
    recommended-pre-check.yaml      # default preset for `spur rule run`
    recommended-post-check.yaml     # stricter dev gate (coverage)
  workflows/
    basic.yaml                      # canonical implement → check → fix loop
    feature-dev.yaml                # existing-feature reuse loop: roster-contract precheck → frozen-list runall → one-shot completion check (0782)
    task-lifecycle.yaml             # task status state-machine (ADR-022)
    feature-lifecycle.yaml          # feature status state-machine (ADR-022)
    task-pipeline.yaml              # task execution pipeline with guards
    planning-pipeline.yaml          # RETIRED (D5-K): no longer seeded or referenced; deleted on ADR-072 accept
    pr-review.yaml                  # GitHub Codex PR-review spine (/sp:dev-pr-review; skill sp:pr-reviewing)
  tasks/
    section-matrix.yaml             # Section-Status-Matrix for `spur task check` (§7.4)
  transition-shims.json            # transition-shim manifest — removal worklist for the agent-role transition (task 0541, §2.5)
  templates/                        # task/feature/bdd/docs body templates (§8); CLI never hardcodes body content (DD-11)
    task/{standard,feature-impl,issue,review,brainstorm,meta}.md   # one per TASK_VARIANTS entry (§7.3.1); SSOT alignment invariant enforced by init.test.ts
    feature/default.md
    bdd/{gherkin,checklist}.md
    docs/{99_PROJECT_CONSTITUTION,00_ADR,01_PRD,02_ROADMAP,03_ARCHITECTURE,04_DESIGN,05_FEATURES}.md  # doc stubs (task 0088)
  plugins/
    .gitkeep                        # home for future bundled plugins (ADR-012)
```

**Build → install → init flow:**

| Stage                      | Action                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build (`build:bundle`)     | Copy repo-root `./config` → package-root `apps/cli/config` via `bundle-config`; copy repo-root `plugins/` + `.claude-plugin/` → package-root `apps/cli/plugins` + `apps/cli/.claude-plugin` via `bundle-plugins`; both shipped via the package `files` array as top-level `config/`, `plugins/`, `.claude-plugin/`.                                                                                                                                                                                                         |
| Install (`bun install -g`) | Package-root `config/` ships inside `@gobing-ai/spur` — no `postinstall` (unreliable for global installs). Legacy installs may still have `spur-cli/config/` (pre-0.3.9); `bundledConfigRoot()` accepts both.                                                                                                                                         |
| First run / `spur init`    | `seedGlobalConfig()` copies bundled `config/{rules,workflows,tasks,…}` (YAML/JSON) → `~/.config/spur/` (never overwrites).                                                                                                                                                                                                                            |
| `spur init` scaffold       | Seed only project-owned assets under `.spur/` (`rules/**`, `tasks/**`, and the `templates/task` → `tasks/templates` remap), plus root-scoped `docs/` + `AGENTS.md`. Workflows and natural-path templates stay bundled; no `.spur/workflows` or `.spur/templates` shadow is created. |
| Workflow runtime resolution | Explicit project path first, then bundled `config/workflows/<basename>` fallback. Shipped workflows are invoked by bare name; the global workflow copy is not a runtime tier. |

**Ownership split.** `@gobing-ai/ts-rule-engine` ships only generic demo rules (one per builtin
evaluator) + a generic `example.yaml` preset for its own tests. Spur owns its presets and workflows
here. The bare `recommended` preset is removed; `recommended-pre-check` is the default (BREAKING, ADR-015).

**`--compile` caveat.** The compiled binary (`dist/cli/spur`) cannot read a sibling package `config/`;
it relies on the `~/.config/spur` seed. The published global install (`spur.js` + package-root
`config/`) reads the bundled tree directly and is the primary path.

No symlinks participate in install or init — config propagates by copy-and-resolve only.

**Monorepo path model (Spur self-dev — avoid triple-sync thrash):**

| Path                                             | Role                                                       | Agent rule                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `config/workflows/`                              | **Tracked SSOT and bundled fallback** for this checkout    | **Edit here** when changing pipeline/lifecycle YAML; invoke shipped definitions by bare name (for example, `task-pipeline.yaml`) |
| `apps/cli/config/`                               | **`build:bundle` / `bundle-config` artifact** (gitignored) | Do **not** hand-`cp` or hand-edit. Regenerated on CLI package build for npm ship                                                |
| `apps/cli/plugins/` + `apps/cli/.claude-plugin/` | **`build:bundle` / `bundle-plugins` artifact** (gitignored) | The `sp` plugin + marketplace manifest shipped in the npm tarball. Regenerated on `bundle-plugins`; never hand-edit              |

Wrong pattern (0454/0455 waste): copy workflow YAML into project or package artifact trees after every edit. Right pattern: edit `config/workflows/` once; runtime uses the explicit-project-path → bundled fallback, and the package tree is refreshed only via `bun run --filter @gobing-ai/spur build:bundle` (or `spur-dev bundle-config`) when testing the **published** layout.

<a id="24-config-loader--single-facade-in-gobing-aispur-config-adr-027"></a>

### 2.4 Config loader — single facade in `@gobing-ai/spur-config` (ADR-027)

`.spur/config.yaml` has exactly one loader. The package splits into two entry points so the
dependency graph stays Workers-safe:

| Entry                                  | Imports                            | Exports                                                                                                                 | Consumed by                                                       |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `@gobing-ai/spur-config` (core)        | zod only — no `yaml`, no `node:fs` | `spurConfigSchema`, `DEFAULT_TASKS_DIR`/`DEFAULT_FEATURES_DIR`, all config types (`SpurConfig`, `TaskFoldersConfig`, …) | server (Cloudflare Workers bundle), any runtime-agnostic consumer |
| `@gobing-ai/spur-config/loader` (node) | `yaml`, `node:fs`, ts-runtime      | `loadSpurConfig(cwd)`, `resolveConfigFile(cwd)`, `resolvePlanningFolders(fs)`, embedded-schema resolution               | CLI, `packages/app` services (on Bun)                             |

- `loadSpurConfig(cwd, opts?)` returns a fully-typed, validated `SpurConfig`. Missing file → schema
  defaults; invalid YAML/schema → throws (fail fast). `validateJsonSchema` defaults on outside tests;
  pass `embeddedSchemas` so the `$schema` ref resolves inside a `bun --compile` binary (the CLI passes
  `EMBEDDED_SPUR_SCHEMAS`). Layer resolution honors skip env vars alongside the explicit `cwd`
  (task 0817 R1): precedence is **explicit `cwd` > the skip env > `process.cwd()`**. With
  `SPUR_SKIP_GLOBAL_CONFIG=true` the global layer is skipped; with `SPUR_SKIP_PROJECT_CONFIG=true`
  AND no explicit `cwd`, the project layer is skipped too — so a programmatic no-`cwd` invocation
  (in-process `main()`, spawned helpers, tests) never resolves the checkout's own
  `.spur/config.yaml`. A caller that passes an explicit `cwd` always keeps its config regardless
  of the env (fixture projects are unaffected); `tests/setup.ts` sets both vars so `bun run test`
  is hermetic. The preload also prepends `scripts/test-shims/` to PATH (task 0818 R1): the tracked
  `100755` launcher there exec's this checkout's `apps/cli/src/index.ts` via bun, resolving to its
  own location (`fileURLToPath`, space-safe) rather than the caller's cwd, preserving caller cwd and
  exit status — so a bare `spur` spawned inside a test child resolves to the checkout's CLI source,
  never a stale global install. Regression: `apps/cli/tests/test-shim-launcher.test.ts`.
- `resolvePlanningFolders(fs)` derives the active + registered task/feature folders, degrading to
  defaults on any error (a broken config must not wedge folder resolution). `@gobing-ai/spur-app`
  re-exports it so app/CLI consumers import from the application layer, not the config package.
- `setProjectExecutorDisabled(projectRoot, executorName, disabled)` (0797/ADR-111) flips one existing
  `agent.executors[]` entry's `disabled` flag in `<projectRoot>/.spur/config.yaml` via the yaml
  document model (comments, ordering, unrelated values, file mode preserved). Exact case-sensitive
  match; absent flag is written explicitly; an already-matching explicit value is a byte-stable
  no-op. Returns `{status:'updated'}` or `{status:'unchanged',reason}` (`already-set`,
  `missing-file`, `missing-executors`, `missing-executor`) — nothing is ever created. Errors:
  `INVALID_CONFIG` (bad args, malformed/ambiguous YAML, aliases/merge keys, symlinked config),
  `CONFIG_CONFLICT` (external change detected pre-commit), `CONFIG_WRITE_FAILED` (lock/atomic-write
  failure). Writes serialize under a per-path lock (dead owners reclaimed, live ones never), commit
  via same-dir temp + fsync + rename, and invalidate the loader cache on success.
- **Type ownership.** `TaskFoldersConfig`/`TaskFolderEntry` are defined once in the loader; services
  re-export, never redefine, so the loader↔service seam shares one identity.
- **Guardrail.** `config/rules/boundary/config-loading-ownership.yaml` blocks `loadStructuredConfig`
  outside `packages/config` and any reference to the retired `docs/.tasks/config.jsonc`.

<a id="25-transition-shim-manifest--gate-task-0541-feature-b2"></a>

### 2.5 Transition-shim manifest & gate (task 0541, feature B2)

**Marker.** A compatibility path that must survive the agent-role transition carries a source comment
marker `@transition-shim(<id>)` where `<id>` is lowercase kebab (`^[a-z0-9][a-z0-9-]*$`). The marker is
a grep target and a review signal — it never changes runtime behavior.

**Manifest.** `config/transition-shims.json` records one entry per marker:

```json
{
  "id": "agent-bare-binary-name",
  "wbs": "0536",
  "file": "packages/app/src/services/agent-service.ts",
  "keepsWorking": "a bare coding-agent binary name (codex, omp, claude with no matching agent.executors entry) remains a valid --agent value, warned once",
  "removalCondition": "no bare-binary --agent value remains in docs/, config/workflows/, or plugins/sp/"
}
```

Every field is required (R1): `id`, `wbs` (owning task), `file` (where the marker lives),
`keepsWorking` (what the shim keeps working), `removalCondition` (when it can be deleted).

**Gate.** `bun run transition-shim-check` (wired inside `spur-check` and `spur-check-new`) is
two-sided by design: a marker with no manifest entry fails as a **new unregistered shim**
naming the id and the file; a manifest entry whose marker no longer appears in source fails
as a **stale entry** — the two are reported distinctly. (The corpus-baseline gate that inspired
this shape retired with its snapshot in task 0775; the shim check keeps its own two-sided
contract.)
Markers are scanned in the source roots `apps, packages, plugins, config,
scripts, tooling` (excluding build output and `tests`/`test` directories — a fixture mentioning a
marker id is test data, not a shim); `docs/` is not scanned, so prose examples do not trip the gate.

**The manifest is the removal worklist (R4).** Emptying `config/transition-shims.json` is the
definition of the agent-role transition being complete. A removal condition must be objectively
checkable against the repository — "remove when `config/workflows/` and `apps/cli/src` contain no
bare-binary `--agent` value" qualifies; "remove when the binary-name form is unused" does not. A
condition resolvable only by human judgement is rejected in review. Shims are registered by the
tasks that create them: the mechanism shipped seeded empty with 0541; 0536/0537/0538/0542
registered the four agent-role entries now in the manifest (`agent-bare-binary-name`,
`spec-without-executor-field`, `agent-flag-spec-id`, `agent-default-executor`).

<a id="26-plugin-script-contract-manifest--gate-task-0600-adr-065"></a>

### 2.6 Plugin-script contract manifest & gate (task 0600, ADR-065)

**Manifest.** `config/plugin-scripts.json` records one entry per file under `plugins/sp/scripts/`:
`rel`, `contract` (`standard` | `repo-only`), and for `standard` entries the `twin` path (a
committed `.mjs` beside the `.ts` source).

**Gate.** `bun run script-contract-check` runs **third** in `spur-check` / `spur-check-new` (after
`transition-shim-check`, before `lint`). It is two-sided against the manifest:

1. a `standard` entry whose `.mjs` twin is missing or older than its `.ts` source fails;
2. a committed `.mjs` with no `standard` entry (or belonging to a `repo-only` entry) fails;
3. a script file on disk with no manifest entry fails;
4. the string `bun plugins/sp/scripts/` in `plugins/sp/{commands,skills,agents}` or
   `plugins/sp/README.md` fails.

Generated twins are excluded from Biome (`plugins/sp/scripts/**/*.mjs`). Shipped surfaces invoke
standard scripts as `node "$(superskill script path sp <rel>.mjs)"`. Repo-only scripts stay on
`bun` and are monorepo/gate-only.
