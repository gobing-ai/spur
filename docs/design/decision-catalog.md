---
kind: design
title: Decision catalogs and the `spur decision` noun
status: proposed
created_at: 2026-10-06
updated_at: 2026-10-11
related: [ADR-134, ADR-125, ADR-113, feature P, feature P1, workflow-catalogue-refactor.md]
tags: [decision, workflow, cli, config]
---

# Decision catalogs and the `spur decision` noun

## 1. Issue and scope

Spur makes AI classifications in three places today, all inline `decide` actions in
`config/workflows/task-pipeline.yaml` (`task-triage`, `failure-class`, `review-failure-class`).
Their vocabulary, threshold and fallback live inside workflow YAML. Operators cannot list them,
inspect them, or run them outside a pipeline run.

Feature P makes `@gobing-ai/ts-ai-decision` catalogs the single source of truth for these
decisions. It adds a standalone `spur decision` noun (`list`, `show`, `run`, `status`) and lets
the operator choose the DecisionMaker per decision point in the global config.

Adoption is staged. Feature P does not touch any workflow. Its purpose is to let operators
measure DecisionMaker reliability on real decision points. Child feature P1 owns all workflow
replacement. It is postponed until that reliability is established, and then proceeds one
decision point at a time.

**In scope (P):**
- The four verbs.
- The `config/decisions/` SSOT and shipping it in the tarball. This includes catalog entries for
  the three existing decision points, so they can be measured with `spur decision run`.
- Layered runtime resolution.
- The `decisions` config section, with `paths`, a global `maker` and per-decision `makers`.
- Task 1100 adds the `log` key: `full` (default) \| `metadata` \| `off` — the decision-log write
  mode (see `docs/design/decision-observability-and-adoption.md` §3.5).
- Owner docs.

**Deferred to P1:** migrating `decide` to catalog references and replacing every shipped workflow
decision point (§3.5).

**Out of scope:**
- Outcome history, i.e. a store of past decision results.
- Per-decision model selection in config.
- Server, oRPC and Board surfaces.
- Upstream package changes.
- Migrating `workflows.hitlDecisionMaker` — done later as an in-development config-surface consolidation: the singular `workflow` section merged into `workflows` (`workflows.hitlDecisionMaker`).

## 2. Context and constraints

- **Upstream:** `@gobing-ai/ts-ai-decision@0.5.16` is pinned in the root catalog but is not yet
  installed or imported. Its API:
  - `createDecisionHub` and `DecisionHub`, with `list`, `describe`, `decide` and `loadFile`.
  - `DecisionMakerRegistry`, with built-in makers `typesafe`, `fm-local` and `laya-local`.
  - `loadDecisionCatalog` and `renderQuestion`.

  A catalog loads all-or-nothing, and duplicate ids across catalogs throw. Every result has the
  shape `{id, type, value, confidence, source: model|default, reason, maker, durationMs}`.
- **ADR-125 `decide`:**
  - `runDecide` in `packages/app/src/workflow/decide.ts` redacts evidence and bounds it with
    `redactAndBound(…, 2000)`.
  - The default `minConfidence` is 0.8.
  - It writes a frozen schemaVersion-1 `resultFile` row.
  - It is gated by `workflows.decideDecisionMaker`, which defaults to false.
  - The inline driver (`inline-run-setup --decide`) and the engine share one runner. That parity
    must survive the change.
- **ADR-113:** workflows resolve in layers:
  1. project `.spur/workflows`
  2. registered `workflows.paths`, which accepts `bundled:` entries
  3. shared `bundledConfigRoot()/workflows`, found with no config

  The operator's global config today carries an absolute path,
  `/Users/robin/node_modules/@gobing-ai/spur/config/workflows/`. It goes stale on reinstall or
  relocation, and the shared layer already makes it unnecessary.
- **Bundling:** `scripts/commands/bundle-config.ts` copies all of `config/` into the package.
  `apps/cli/package.json` already ships `config` and `schemas`.

## 3. Solution

### 3.1 Catalog SSOT and shipping

- Catalogs live in `config/decisions/*.yaml` and follow upstream format version 1. Pipeline
  decisions go in `config/decisions/task-pipeline.yaml`, one file per owning workflow.
  - `gates.yaml` carries `gate-evidence`; `idea-pipeline.yaml` `idea-recommendation` and
    `needs-design`; `history-anatomy.yaml` `anatomy-validation-verdict`; `task-pipeline.yaml`
    `task-triage`, `failure-class` and `review-failure-class`. The workflow audit that maps them
    to steps is `decision-observability-and-adoption.md` §4.
  - `maker-liveness.yaml` carries `maker-liveness`, served by exactly one caller: `spur decision
    status --probe` (§3.4). It declares `minConfidence: 0` because the probe asks whether the maker
    *answered*, not whether the answer was good — a working maker reporting low confidence must not
    read as a dead one. No workflow may reference it, and it ships no parameters: the implicit
    `instructions` parameter carries the probe question.
- `bundle-config.ts`:
  - `schemaFor()` gains a `decisions/` mapping, so the bundled copy carries `$schema`.
  - The upstream `decision-catalog.schema.json` is copied into `apps/cli/schemas/`.
- No change to `files` is needed, because the existing `config` entry already ships the folder.

### 3.2 Layered resolution

`DecisionCatalogResolver` lives in `packages/app` and mirrors `workflow-resolver.ts`:

| Layer | Source | Config needed |
| --- | --- | --- |
| project | `<cwd>/.spur/decisions/*.yaml` | none |
| registered | `decisions.paths[]` (absolute, project-relative, or `bundled:<sub>`) | optional |
| shared | `bundledConfigRoot()/decisions/*.yaml` | none |

- **Winner selection:** for each catalog file basename, the first layer wins, as with workflows.
  This happens before the hub loads, because the hub throws on duplicate ids.
- **Duplicate ids:** the same id appearing in two *different* winning files is reported as a
  catalog error. That error fails `status`, and fails any `run` or `decide` of that id.
- **Load failures:** a catalog that fails to load is reported per layer and skipped. Other
  catalogs still serve.
- **Config shape:** see §3.6. Inside this repo, `config/decisions` resolves through the shared layer during source
  runs, the same way workflows do.

### 3.3 One decision service

`DecisionService` in `packages/app` owns the hub's lifecycle:
- It resolves catalogs, builds `createDecisionHub` with the default maker registry, and caches the
  result per process.
- It exposes `list()`, `describe(id)`, `decide(id, input)` and `status()`.
- It resolves the effective maker per decision (§3.6) and returns the selecting source with it.
- It never reads `workflows.decideDecisionMaker`. That switch governs only the workflow `decide`
  action. `spur decision run` is an explicit operator call whose purpose is measuring reliability.
- It constructs makers lazily, so `list`, `show` and `status` never build one.
- It **owns the `laya-local` client**. That backend's driver holds a warm Python worker "for the
  client's lifetime" and exposes no disposal seam, so the worker's piped stdio keeps the event loop
  alive: without an owner, a one-shot command prints its decision result and then never exits.
  `DecisionService` builds the client itself through the registry's typed `client` driver option
  (built on first ask, so `list`/`status` still work on a host that cannot serve the backend) and
  releases it in `dispose()`. `disposeDecisionServices()` releases every cached service and is
  called once at the Spur process boundary (`runCli`). A disposed service stays usable — the client
  is rebuilt on the next ask.

Today the CLI is the only consumer. In P1 the workflow action calls the same service, so neither
builds its own hub.

### 3.4 CLI contract (`apps/cli/src/commands/decision.ts`)

| Verb | Behavior | Exit |
| --- | --- | --- |
| `list [--layer <l>] --json` | id, type, description, catalog file, layer | 0; 1 on an invalid `--layer` |
| `show <id> --json` | full entry: type, choices/criteria, parameters, fallback, minConfidence, model, catalog, layer, plus the effective maker and its source. Never constructs a maker | 0; 1 if unknown id |
| `run <id> [--param k=v]… [--evidence <file>]… [--maker <name>] --json` | validates params, redacts and bounds evidence, calls the effective maker, prints the result. Never writes a workflow result file | 0 for every backend outcome (accepted, low-confidence, no-backend, timeout, error) |
| `status --json` | configured default maker, per-decision effective maker and source, registered makers, per-layer catalog counts and load errors, duplicate ids, then the readiness marks: per maker registration, the config key naming it, how many decisions it serves and its recorded evidence; per decision the same evidence | 0 when clean; 1 on any catalog or maker-config error |
| `status --probe` | as `status`, plus one liveness decision (`maker-liveness`) served per distinct registered effective maker, reported as a `PROBE` column and streamed to stderr. Never constructs a maker without the flag, never changes the exit code, writes no decision log row and emits no event. `--probe` with `--reliability` is refused | 0 on a completed report, whatever the probe outcomes; 1 on a catalog or maker-config error |

- `run` exits 1 for caller mistakes, and only those: an unknown id, a missing or invalid
  parameter, an unknown or unregistered maker (from the flag or from config), or an unreadable
  evidence file. All are rejected before any backend
  call.
  `status --probe` reports a maker that falls back as data (feature P11); only an unresolvable
  liveness id or an unknown maker is a caller mistake there.
- The human output is one line per result. `status` renders a sectioned readiness report
  (`decision-observability-and-adoption.md` §3.4.1): one status line, errors, then aligned
  `Makers` and `Decisions` tables and a `Catalog` block, with `✓`/`✗` glyphs and `—` for empty
  cells. `run` keeps one line per result. `--json` uses the standard output envelope.
- The `sp:spur-cli` reference `references/decision.md` lands in the same change, per the parity
  rule.

### 3.5 `decide` migration (deferred to feature P1)

This section records the intended P1 shape. Feature P implements none of it.

P1 runs gradually:
- It covers one decision point per slice: `task-triage`, `failure-class`, `review-failure-class`,
  then any later ones.
- Each slice lands only with recorded `spur decision run` evidence for its effective maker.
- The end state is that no shipped workflow declares an inline decide.


The `decide` options become a union.

**Catalog form (new):**
```yaml
- kind: decide
  options:
      decision: task-triage            # catalog id
      params: { wbs: '${vars.wbs}' }
      evidence: [.spur/run/${vars.wbs}-diffstat.json, '${vars.taskSpecPath}']
      resultFile: .spur/run/${vars.wbs}-triage.decision
```

**Inline form (deprecated):**
- It is accepted for one release.
- Composition lint and the runner emit a deprecation warning naming the replacement catalog id.
- It is removed in the following release.

**How `runDecide` changes:**
- It calls `DecisionService.decide`.
- Evidence is redacted and bounded exactly as today, then passed as `${params.evidence}`.
- It maps the hub result onto the unchanged schemaVersion-1 row:
  - `method` takes the catalog `type`.
  - `backend` takes `maker`.
  - `degraded` is `source === 'default'`.
  - `reason`, `confidence`, `evidenceDigest` and `durationMs` carry through.
- Guards keep reading the same file.

**The three shipped decisions** move into `config/decisions/task-pipeline.yaml`:
- Their choices and fallbacks are unchanged: `standard`, `fix`, `fix`.
- The catalog sets `defaults.minConfidence: 0.8`, keeping today's threshold over upstream's 0.7
  default.

### 3.6 DecisionMaker selection in config

```yaml
# ~/.config/spur/config.yaml (documented in the shipped config/config.global.yaml)
decisions:
    paths: []                # optional extra catalog folders (registered layer)
    maker: typesafe          # default DecisionMaker for every decision point
    makers:                  # per-decision-point overrides
        task-triage: laya-local
```

The effective maker is resolved per call. The first source that is set wins:

| # | Source | Reported source |
| --- | --- | --- |
| 1 | `spur decision run --maker <name>` | `flag` |
| 2 | `decisions.makers.<id>` | `config-decision` |
| 3 | `decisions.maker` | `config-default` |
| 4 | catalog `decisions.<id>.maker` | `catalog-decision` |
| 5 | catalog `defaults.maker` | `catalog-default` |

- **Why operator config outranks the catalog:** the catalog ships with the package and cannot know
  which backends a machine has. For example, `laya-local` needs Apple Silicon.
- **Unregistered maker names:** a name not in the `DecisionMakerRegistry` is a config error.
  `status` reports it, and `run` exits 1 before any backend call. It never falls back silently.
- **Merge order:** a project `.spur/config.yaml` may override these keys through the normal A4
  merge.
- **Existing configs:** `init` never overwrites an existing global config. Operators add the keys
  by hand, and until then the catalog maker applies, which `status` shows as `catalog-*`.

### 3.7 Registered makers

The registry holds the three upstream built-ins plus Spur's own `clef` maker: the hosted
Cloudflare Workers AI backend from `@gobing-ai/ts-decision-clef`, wrapped as
`createDecisionMaker({ driver: createClefDriver(creds) })`.

- **Credentials are environment-only:** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUTH_TOKEN`. The
  driver itself never reads the environment; `DecisionService` passes the values explicitly.
- **Registration is gated on both variables being set** (non-empty). Unlike `laya-local`, which
  registers unconditionally because the registry cannot detect Apple Silicon, the environment can
  answer whether this backend exists on the machine. An ungated maker would report itself in
  `status.registeredMakers` while failing every call, so a `decisions.maker: clef` typo on a
  machine without credentials would degrade every decision to a silent `no-backend` fallback that
  `status` reads as healthy. Gated, it is a loud config error: `status` exits 1, and `run --maker
  clef` exits 1 before any backend call (§3.6).
- **Model:** the driver defaults to `clef-flash`; a catalog `model` (or an `ask({ model })` call)
  selects `clef` instead. Per-decision model selection in config stays out of scope (§1).
- **Credential-free host checks stay lazy.** `laya-local` and `fm-local` are registered
  unconditionally because registration cannot detect Apple Silicon; their host checks run at first
  resolve, and a construction failure is the hub's `no-backend`. `DecisionService` builds the
  `laya-local` client on first ask for the same reason (§3.3).
- **Failure taxonomy:** a malformed account id or an unreachable host is a driver error, so the
  hub maps it to the declared fallback with `reason: no-backend` (construction) or per the error
  taxonomy (transport). It never throws and never escapes the fallback contract.

## 4. Contract and compatibility

- **Workflows:** no shipped workflow or `decide` behavior changes in P (feature P R10).
- **resultFile rows (P1):** schemaVersion stays 1, and the field set is unchanged.
- **Inline options (P1):** these keep working for one release, with a warning.
- **Public surface:** the new noun has operator consent through the feature P idea. No existing
  noun or verb changes.
- **Config:** the whole `decisions` section is optional and additive, and an absent section is
  valid. The shipped `config/config.global.yaml` documents it.
  Operators may delete the absolute `workflows.paths` entry, since the shared layer covers it.
- **Dependency:** `@gobing-ai/ts-ai-decision` and `@gobing-ai/ts-decision-clef` are added to
  `packages/app` through `catalog:`. `ts-ai-decision` transitively brings `ts-decision-fm` and
  `ts-laya-mlx`.
- **Plugin standalone rule:** `plugins/sp` scripts must not value-import the package. The inline
  driver reaches it through the app service only, as `--decide` does today.

## 5. Tradeoffs and open questions

### Deviations from the original proposal

| Proposal | Design | Reason |
| --- | --- | --- |
| Noun converts non-deterministic decisions into deterministic ones | Decisions are *total*: closed vocabulary, declared fallback, recorded outcome. Fully deterministic only with the switch off | A model answer is not reproducible. Overclaiming determinism would hide real variance from operators |
| Runtime relies on a new `decisions` config section pointing at the installed package | The shared layer auto-finds `bundledConfigRoot()/decisions`. `decisions.paths` is optional, for extra catalogs | An absolute path into `node_modules` breaks on reinstall, upgrade or relocation. The operator's current `workflows.paths` shows the failure mode |
| Add a CLI noun | Noun first, with catalog entries for existing decision points. All workflow replacement is centralized in P1 and done gradually | Maker reliability is still unproven. Pipeline routing must not depend on it until `spur decision run` evidence exists (operator decision, 2026-10-06) |
| (not specified) | Global `decisions.maker` plus per-decision `decisions.makers.<id>` | The operator chooses the maker per decision point, which the catalog cannot know (operator request, 2026-10-06) |
| `status` (unspecified) | Readiness: switch, makers, per-layer load errors, duplicate ids | Outcome history needs a store and retention policy. It is deferred (I11) |
| Add the folder to the tarball | No `files` change; add the `schemaFor` mapping and ship the schema | `bundle-config.ts` already copies all of `config/` |

### Risks and open questions

- **Bundle size:** `ts-laya-mlx` and `ts-decision-fm` may pull native or large dependencies into
  the compiled binary. The first implementation task measures `build:bundle` size before and
  after. If the growth is material, load makers lazily behind the switch.
- **Evidence mapping:** passing evidence as one `params.evidence` string matches today's prompt
  shape. Per-file params are deferred until a decision needs them.
- **Outcome history** for drift and calibration analytics is deferred to a follow-up feature.
