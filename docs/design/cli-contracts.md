# CLI grammar, initialization, agents, teams and rules

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="1-cli-surface"></a>

## 1. CLI Surface

All commands accept `--json` for machine-readable output and return a meaningful exit code. The
binary is `spur` (`apps/cli/src/index.ts`, run under Bun).

**Startup banner policy (A31/0719):** the interactive entry `runCli()` prints the ASCII logo
exactly once unless the raw argv carries an exact `--no-logo`, `--json`, `--quiet`, or `--silent`
token. The policy is owned by the `shouldRenderBanner()` seam at the composition root
(`apps/cli/src/index.ts`): near-miss tokens do not match, command-owned banners (e.g. the history
report/staleness banners) are unaffected, and programmatic `main()` callers never receive the
logo. `--no-logo` is a root-level option: listed once in top-level help, accepted before or after
nested noun/verb tokens, and it changes no command output or exit code — it only removes the
startup decoration. `--json` output is therefore always JSON-first, including early config
failures.

<a id="10-cli-grammar"></a>

### 1.0 CLI grammar

The canonical invocation shape is:

```
spur <noun> [<verb>] [positionals] [--flags]
```

**Noun-verb contract:**

- Every multi-verb noun follows `spur <noun> <verb> …`. The verb is the second positional token.
- **`builder`** is the noun hosting the release plumbing — `spur builder bump-ver|drop-tags`
  (task 0617, ADR-051). Promoted verbatim from the internal `spur-dev release` script; frozen at
  these two verbs (see `docs/design/harness-surface-governance.md` §3).
- **`self`** is the noun hosting the self-management verbs — `spur self init|maintain|migrate|serve|status`.
  Each verb mounts the same command builder as its legacy top-level noun, so behavior, flags,
  output, and exit codes are identical on both paths.
- The legacy **hidden aliases** (`spur init`, `spur maintain`, `spur migrate`, `spur serve`, `spur status`) stay
  registered at the top level for back-compat with existing scripts and workflow YAML. They are
  verb-less commands that accept flags and optional positionals directly, but they are omitted from
  the `spur --help` listing (commander's `hidden` option), leaving `self` as the visible surface.
- All other nouns require a verb. Commander enforces this: calling `spur workflow` without a verb
  prints commander's help and exits 1.

**Help dispatch:**

| Invocation                           | Behavior                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `spur` / `spur help` / `spur --help` | Top-level help: commander's standard flat command listing (alphabetical, with summaries) |
| `spur <noun> --help`                 | Commander-generated command-scoped help (options, subcommands)                           |

The CLI surface is built on `commander` + `@commander-js/extra-typings`. Each noun exports a
`registerXxxCommand(program, context)` function from `apps/cli/src/commands/<noun>.ts`. Adding a
noun requires writing its registration function and importing it in `apps/cli/src/index.ts`.
Commander handles option parsing, `--help` rendering, and subcommand dispatch — no custom
help rendering overrides remain.

<a id="101-shared-option-registry-0618"></a>

### 1.0.1 Shared option registry (0618)

Every option shared by two or more command modules is declared **once**, in
`apps/cli/src/commands/shared-options.ts`. The registry exports:

- `SHARED_OPTIONS` — `Record<string, readonly [flags, description]>` (`as const` tuples). One entry
  per **(flag, description) pair**, not per flag string: semantic homonyms (`--json` machine-output
  vs `--json` serve's `{port,url,pid}`; `--cwd` serve vs agent) and per-module one-off descriptions of
  a shared flag each get their own key. Spreading a tuple into `.option(...SHARED_OPTIONS.<key>)`
  preserves `@commander-js/extra-typings` inference; parser/default/collector args are appended after
  the spread at the call site.
- `SHARED_OPTION_FLAGS` — the derived membership set (28 flag strings). A flag string qualifies for
  the registry the moment it is declared in ≥2 command modules; **all** of its (flag, desc)
  declarations get entries so the parity test is total.

Enforcement: `apps/cli/tests/shared-option-parity.test.ts` fails on (a) any literal
`.option/.requiredOption` declaration of a flag string in `SHARED_OPTION_FLAGS`, (b) a registry entry
spread by zero command modules, or (c) a shared flag string consumed by fewer than two modules.
Adding a shared option: add the entry, spread it at every site — never re-declare inline.

<a id="11-committed-product-commands"></a>

### 1.1 Committed product commands

<a id="spur-init---name-name---force---minimal---json"></a>

#### `spur init [--name <name>] [--force] [--minimal] [--json]`

> **Canonical path:** `spur self init`. The legacy `spur init` top-level form remains a hidden alias
> over the same command — identical flags, output, and exit codes; absent from `spur --help`.

Scaffold a local Spur project. Writes `.spur/config.yaml` (§2.1) and records the config artifact. Unless
`--minimal`, materializes the project-owned assets from §2.3: `.spur/rules/`, `.spur/tasks/`, root docs,
and `AGENTS.md`. Workflows and natural-path templates remain bundled; init creates neither
`.spur/workflows/` nor `.spur/templates/`.
The set of scaffolded files is an explicit reviewed manifest (`scaffold-manifest.ts`) — adding a default
is a one-line manifest edit, not new control flow. Files are read from the resolved config source, not
embedded as string literals. Always creates `.spur/agents/` (with a `.gitkeep`) for team-mode agent
specs, regardless of `--minimal`. On first run it seeds `~/.config/spur/` from the bundled package-root `config/`
assets (existing files are never overwritten), so `spur rule run` resolves a real ruleset from any
project. Re-running fills missing assets and preserves existing configuration/customized docs;
`--force` may replace only non-preserve assets. `--json` emits
`{ ok, project, config, created[], skipped[], globalConfigSeeded }`.

**Init ownership contract.** Two surfaces collaborate; their cut is strict (task 0188):

- **`spur init` owns file materialization.** Copies every `SCAFFOLD_MANIFEST` entry from
  `bundledConfigRoot()` to `.spur/` (and the `docs/` stubs to the project root). Idempotent;
  `--force` overwrites non-preserve entries, never overwrites preserve-marked docs; `--minimal`
  skips bundled project-asset materialization. The manifest is pure data — adding a default is a
  one-line edit, no control-flow change. **AGENTS.md** (`preserve: true`): when scaffolding a
  *new* file from `config/templates/AGENTS.md`, init substitutes `{project-name}` (from `--name`
  or cwd basename) and `{project-description}` (stub: `local Spur project`) so fresh projects
  never ship residual brace tokens (task 0242). The seed names Spur and Superskill as complementary
  first-class harness tools, routes each operation to its owning plane, and conditionally makes a
  repository-root `DESIGN.md` authoritative for UI/UX work without colliding with this doc's surface
  ownership (task 0312; [portable contract](portable-agents-harness-contract.md)). Existing
  customized AGENTS.md is never overwritten.

- **`/sp:spur-init` owns content adaptation only.** Calls `spur init` as its first step, then
  performs three classes of adaptation. Its scaffold step invokes `spur init --json` exactly once,
  retains the result envelope, reports one concise created/skipped summary, and reuses
  `result.project` for customization without replaying the human transcript. Two probes sit between
  scaffold and customization:
  - *Functional probe (Phase 1.5):* `spur status`, `spur task create`, `spur workflow validate`.
  - *Rule glob adaptation (Phase 1.6):* the `recommended-pre-check` preset ships globs calibrated
    to Spur's monorepo (`apps/**/*.ts` etc.). On any other layout these match zero files and `rg`
    exits 2, surfacing as `kind: "error"` findings. The command detects the project layout
    (monorepo / single-package / flat / polyglot) and writes adapted overrides under
    `.spur/rules/<category>/` — local-layer shadowing (first-layer-wins by relative path), not
    scaffold materialization. The probe `spur rule run --preset recommended-pre-check` must then
    report zero `kind: "error"` findings. Adapted rule files are customization overlays, analogous
    to the Phase 2 doc edits — NOT `SCAFFOLD_MANIFEST` entries.
  - *Doc customization (Phase 2):* routes every doc touch through `sp:doc-evolve` (project naming,
    stack detection, PRD/ADR drafts).
    The command NEVER creates `SCAFFOLD_MANIFEST` files itself — it edits content the CLI already
    wrote, or writes local-layer overlays the CLI never owned.

**Scaffold-variant parity invariant.** `SCAFFOLD_MANIFEST` ships exactly one
`templates/task/<variant>.md` entry per `TASK_VARIANTS`
(`standard·feature-impl·issue·review·brainstorm·meta`); enforced by
`apps/cli/tests/commands/init.test.ts` to prevent template/manifest drift.

<a id="spur-builder-bump-ver-package-id--all-version---push--spur-builder-drop-tags-package-id--all-version---remote"></a>

#### `spur builder bump-ver <package-id|--all> <version> [--push]` · `spur builder drop-tags <package-id|--all> <version> [--remote]`

**Release plumbing, promoted from `spur-dev` (ADR-051, task 0617).** `builder` hosts the two
release verbs formerly hidden behind the internal `bun run scripts/spur-dev.ts release` command;
`scripts/commands/release.ts` is now a thin forwarder to the same implementation. The noun is
**frozen at exactly these two verbs** — no further spur-dev verb may be promoted onto it, and any
future spur-dev → public-noun promotion needs its own consent-gate entry
(`docs/design/harness-surface-governance.md` §3).

- `bump-ver <package-id> <version> [--push]` — bump one workspace package: rewrite its
  `package.json` version (plus the in-source `binaryVersion` literal in `src/config.ts` when
  present and any `workspace:` pins of consumers), commit
  `chore(release): bump <pkg> to <version>`, create the annotated tag `<pkg>-v<version>`, and
  optionally `--push` the branch + tag.
- `bump-ver --all <version> [--push]` (or a bare `bump-ver <version>`) — bump every package pinned
  via `workspace:` by another workspace package **plus the aggregate package**, then add
  per-package trace tags plus the aggregate publish tag (the aggregate package's own
  `<pkg>-v<version>` tag, or `<rootName>-v<version>` when no aggregate package resolves).
- `drop-tags <package-id> <version> [--remote]` — delete the local tag; `--remote` also deletes it
  on origin.
- `drop-tags --all <version> [--remote]` — drop the per-package + aggregate tags.

Package ids are unscoped short names (`@gobing-ai/spur` → `spur`). Unknown ids, invalid semver, a
dirty tree, a detached HEAD, or an existing local/origin tag abort with exit 1 and usage text
(`releaseUsage`). Before any manifest mutation `bump-ver` runs the plugin-install-smoke gate
(`bun run plugin-smoke`); a failed gate aborts with the refusal error ("fix the plugin surface
before releasing"), and a repo without the gate script (e.g. throwaway bump-ver test repos)
skips the gate with a visible note. Output and exit behavior are identical to the legacy
`spur-dev release` path.

**Release knobs are project config, not code (`.spur/config.yaml` `builder.bump-ver`).** The tag
separator, publish workflow, commit type/scope, and `gh run list` limit resolve from the merged
global+project config (zod defaults = the original hardcoded values), so projects with different
release conventions configure them instead of patching release scripts:

```yaml
builder:
  bump-ver:
    aggregatePackage: spur      # package whose own tag triggers the publish workflow
    tagVersionSeparator: "-v"   # release tag = <package><separator><version>
    publishWorkflow: publish.yml # workflow the pushed tag triggers
    releaseCommitType: chore
    releaseCommitScope: release
    ghRunListLimit: 5
```

**`aggregatePackage` names the publish trigger, and it must be a package `--all` bumps.** The
aggregate tag is the only tag `--all --push` pushes, so the package it names has to carry the
version the publish gate checks (`tag version == package.json version`). Default: the package
whose full name equals the workspace root manifest name — which only works when the root manifest
is the publishable package (the spur repo itself: `@gobing-ai/spur`). A repo whose root name is
unscoped (`knowledge-kit` vs `@gobing-ai/knowledge-kit`) matches nothing: `--all` bumped only the
`workspace:`-pinned packages and pushed `knowledge-kit-v<version>`, a tag no workflow consumes
(2026-09-15: 0.0.15 was committed and pushed but never published). Set `aggregatePackage` to the
unscoped id of the published package in that shape; an id that matches no workspace package
aborts before any mutation, listing the known ids.

**Marketplace/plugin version carriers.** When `.claude-plugin/marketplace.json` exists, every
listed plugin's `version` (and its own `<source>/plugin.json`) is bumped to the release version in
the same commit — superskill's update check reads the marketplace version first, so leaving it
stale silently degrades staleness detection. Entries are mutated in place; unrelated fields
(e.g. `description`) survive.

**Version carriers are project config (`builder.bump-ver.versionCarriers`).** Beyond the built-in
carriers (workspace `package.json` files; marketplace + entry `plugin.json`; the `binaryVersion`
literal in `src/config.ts`), a repo declares extra ones per project:

```yaml
builder:
  bump-ver:
    versionCarriers:
      - type: plugin-manifest            # repo-wide manifests no marketplace entry covers,
        paths: [.cursor-plugin/plugin.json, .codex-plugin/plugin.json]  # synced + staged with the release
      - type: ts-literal                 # override the probed file/identifier
        file: src/version.ts             #   (package-relative; default src/config.ts)
        identifier: APP_VERSION          #   (default binaryVersion)
```

Example: superskill's git-tracked `.cursor-plugin/` and `.codex-plugin/` mirrors previously went
stale (0.3.1 vs marketplace 0.3.27) because nothing reached them; declaring them as
`plugin-manifest` carriers folds them into every release commit.

**Adding a carrier type is one registration.** Types live in
`apps/cli/src/version-carriers.ts`: `registerCarrierType(name, { schema, ...hooks })` where a type
implements only what it needs — `syncRepoWide` for repo-wide manifest carriers, `probePackageLiteral`
for per-package version literals. Config parsing stays deliberately open (just `type` + fields); the
registry validates each instance at release time and fails loudly with the registered type names
before any mutation. The release flow itself never needs structural edits for a new type.

**Runtime-noise tolerance.** CLI startup eagerly creates the runtime SQLite state
(`.spur/spur.db*`, `.spur/logs/`), which dirties a pristine repo before dispatch; the clean-tree
gate ignores exactly those untracked paths (`status --porcelain -uall`) and still blocks on
anything else.

<a id="spur-agent-run-prompt---agent-name---spec-id---continue---model-name---mode-mode---cwd-path---drain---json"></a>

#### `spur agent run <prompt> [--agent <name>] [--spec <id>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--drain] [--json]`

**The subprocess LLM execution surface.** Every out-of-process model invocation in Spur routes
through this verb: workflow `agent.run` actions, explicit `/sp:dev-* --agent auto|--agent <name>`
subprocess dispatches, and team-mode runs. This keeps subprocess agent resolution, auth, slash-command translation, and team
identity in one place, and is the seam where a future remote/SSE execution channel attaches without
touching callers.

Model-bearing `/sp:dev-*` commands invoked from a live coding-agent session use the host-native
skill/subagent surface by default; omitting `--agent` keeps the host-session default (eligible
model stages may use a native subagent, task 0508) and omitting `--agent` and explicit `--agent inline` resolve identically (task 0687 — eligible
model stages may use a native subagent with host-session fallback). `--agent auto` /
`--agent <name>` force this verb. The four dispatch-surface triggers select the subprocess path
when the selector is omitted/`auto`/a name; explicit `--agent inline` rides the same unified inline resolution (subagent-first, host fallback)
The applied trigger is named. Inline has no isolated workspace, per-stage subprocess action record,
independent timeout/abort boundary, or tier-selected executor. Interactive `dev-run --mode full`
and sequential `dev-runall` are ADR-047 control-inversion cases over `task-pipeline.yaml`;
`dev-idea` and `dev-plan` use the same host driver over `idea-pipeline.yaml` but never dispatch a
native subagent unless the operator asks. Task runs record a pipeline link; all inline runs append
`stage <id> executed inline in session <session-id>` provenance. Explicit dev-command executors
launch the workflow asynchronously so `workflow cancel` owns the worker process group; only a
`killed: true` result certifies that a live process stopped. Direct
`spur agent run`, headless `spur workflow run`, explicit executor selection, and parallel batches
remain subprocess surfaces.
Execute a prompt or slash command via a coding agent. `--agent` (default `auto`) takes a **role**
from the Layer-1 role table — `DEFAULT_AGENT_ROLES` in `packages/config` (ADR-061 / 0572:
`scribe`·cheap, `coder`·standard, `reviewer`·capable-1, `planner`·capable-2; `plugins/sp/references/roles.md`
is a parity-gated projection), optionally re-tiered/re-staged per-project via `agent.roles` (§2.1) —
a configured executor name, a coding-agent binary name, or `auto`. A **role** selects the *starting
tier* and resolution begins at that tier's cheapest eligible executor (R1); the resolved role, tier,
and executor ride the `--json` envelope. An **executor name** is a permanent pin that beats role
routing (R2 — load-bearing for `config/workflows/task-pipeline.yaml`'s deliberate pins; no
deprecation warning). A **bare binary name** (e.g. `codex`, `omp` with no matching executor entry)
keeps working during the transition under a registered shim, with a one-time warning
(`config/transition-shims.json`: `agent-bare-binary-name`). A value that is none of these is
rejected at the flag boundary **before any agent process spawns**, with a message naming both
accepted sets (R3). With no stage and no declaration, `agent.default` is resolved as the **default
role** (0542 R2 — the value domain moved from executor names to roles; recommended value `coder`):
a role uses the new semantics; a configured executor name still resolves during the transition with
a one-time warning (shim `agent-default-executor`); a value that is neither fails naming both
accepted sets. On miss, Tier-1 priority applies. The legacy
`current`/`inherit` tokens were removed (ADR-047): they resolve as unknown executor names (exit 2) —
`inline` is the surviving value for "the agent running this session". Host-agent detection reads
`SPUR_AGENT`/`CLAUDE_CODE_ENTRYPOINT`/`TERM_PROGRAM` via `resolveAgentHint`, not `--agent current`.
(`default-by-phase` removed 0452; prompt-regex phase detection `extractPhase` removed 0536 R4 — the
prompt text never derives a stage or role.)
**Declaration sites (0538 R1/R3).** The role travels with the caller, never the prompt: every file
under `plugins/sp/commands/` declares `role:` in its YAML frontmatter (from its row in the Layer-1
table; enforced by `plugins/sp/tests/roles.test.ts`, which fails on a command with no `role:`),
and the command dispatcher threads it into `--agent` so subprocess dispatch routes by the declared
role; workflow `agent.run` steps declare `role:` beside their `agent:` pin; and
`.spur/config.yaml`'s `agent.fleet` members declare an optional `role` — the **primary axis** since 0543: a
member may name the role alone (executor optional) and materialization resolves an executor through
the tier ladder; a member declaring at least one of role/executor is the load rule (R4). (Both retired
carriers are gone: `agent.team` was removed with the roster runtime in 0857 and `.spur/fleet.json`
with the fleet-in-config move in 0858; a leftover of either now fails the config load.)
An explicit `--agent` value always wins over a declaration.
**Explicit `--agent` is role-first, then executor-aware (0346 / 0536).** An explicit `--agent <name>`
matches roles first (the vocabulary is closed and pairwise-disjoint from executor names, 0537 R4),
then reuses the executor-first-then-binary lookup as `agent.default` (`resolveExecutorSelector`):
if `agent.executors` has an entry whose `name` matches, that profile's `{ agent, model? }` is used
(the profile's `model` becomes the run model unless the user also passed `--model`); otherwise the
name is resolved as a legacy coding-agent binary. A profile with `disabled: true` (feature B5 / 0796)
**fails with exit 2 naming the profile and the enable-fix before any probe or spawn** — disabled
profiles are never silently substituted. Collision precedence: when an executor and an
agent binary share a name, **the executor wins** (to reach the bare binary, remove or rename the
executor entry). An explicit selector never consults phase / `default-by-phase` config (R8).
**Spec-id addressing (feature G4 / 0537 / 0542).** Under `--drain`, `--spec <id>` (canonical since
0542 R1) is matched against agent spec ids (`.spur/agents/<id>.yaml`); a match rewrites the
selector to the spec's executor name before the executor-first lookup above runs, and the occupant
pin `spec-id` is set before the rewrite so the ADR-057 wave 1 record persists. The legacy
`--agent <spec-id>` is still accepted as fallback addressing; task 0849 retired its `agent-flag-spec-id`
deprecation warning once the flag-spec-id scan proved no caller remained. The three selector
namespaces — role names (`scribe`/`coder`/`reviewer`/`planner`, task 0535), executor names, and
spec ids — are proven pairwise disjoint at config load (0537 R4), so one `--agent` value can never
mean two things; a config that collides them (executor named `coder`, member id shadowing an
executor, composed spec id equal to an executor name) fails to load naming both colliding names.
**Stage-registry routing (ADR-033).** `auto` resolves on the canonical `stage_id` **derived from
the declared role** — each Layer-1 role folds its declared `stages` (the resolved role map:
`DEFAULT_AGENT_ROLES` merged per-field with any `agent.roles` override), and the dispatch routes
through the folded stage carrying the highest `min_tier` (ties → declaration order). That floor
equals the role's own tier, so derivation never moves where a run starts; it supplies the `model_policy` the escalation ladder needs. The prompt text
never derives a stage (0536 R4) and there is no CLI `--stage` flag — the role every pipeline
`agent.run` step declares (0538 R2) is the input. Before this, the stage was reachable only through
an internal flag no caller set, which left `model_policy`, the fallback chain, and
resource-exhaustion failover inert outside tests. The stage's
`model_policy` starts on the cheapest eligible executor at its `min_tier`
(`cheap`/`standard`/`capable-1`/`capable-2`/`capable-3`, matched against each executor's `tier`
field; 0343 split bare `capable` into quality sub-tiers) and escalates along the ordered `fallback`
chain on an objective failure signal
(`gate-fail`/`timeout`/`insufficient-evidence`/`retry-exhausted`/`resource-exhaustion`/`auth`),
with the escalation record naming the current executor and tier. Legacy bare `capable` normalizes to `capable-1` during
the deprecation window. The stage-registry schema version is 1.3 (1.2 added the `auth` trigger; 1.3 added optional artifact `identity` — the exact task-section/file identity used for the one-writer-per-section projection (F92 0593)).
**Stage floors (cost-aware):** `plan` starts at `capable-2` (escalate to
`capable-3`) so Design is authored at create by default; `refine` floors at `standard` (fallback
`capable-2`) as the blank-Design fallback; `implement` stays `standard`; `verify`/`dogfood` floor at
`capable-1`. Unified `--skip-design` skips feature satellite **and** per-task Design at create.
`default-by-phase` was removed (task 0452 / ADR-033 retirement). Routing uses stage registry
`model_policy` only; migrate legacy configs to `agent.default` + executors + stage tiers.
`--continue` resumes the previous session. `--mode text|json` (default `text`) passes output format
to the agent CLI (Grok maps `text` → `--output-format plain`). `--cwd` sets the working directory.
`--json` emits a machine-readable envelope
(`{ exitCode: number|null, stdout, stderr, signal?, durationMs, resolved }`), where `resolved`
(`{ role?, roleOrigin?, tier?, executor?, agent, source }`, tasks 0536 R1/R2 + 0551) reports the
resolution decision:
the role selector and its resolved tier and the executor entry that won for role routing, the
executor pin for an explicit executor, the canonical agent, and the resolution source
(`role`/`explicit`/`default`/`stage`/`priority`). `roleOrigin` (`'declared' | 'inherited'`, task
0551) records whether the effective role was declared by the caller (a role selector, workflow
`role:` step, or explicit `--agent <role>`) or inherited from the dispatching run's `SPUR_ROLE`
environment (a fanned-out subagent that declared none). When the run is
addressed by a **spec id** (`--spec <id>`, or the legacy `--agent <specId>` matching an agent
spec), the envelope **adds** two optional keys (ADR-057 wave 1 / G4): `occupant`
(`{ specId, agentKind, processId|null, runId, generation }`) — the live occupant pin
retained even after `--drain` rewrites `--agent` to the spec's **executor name** (0537) — and `run`
(`{ status: 'running'|'exited'|'errored', startedAt, completedAt, artifactRefs }`), where
`artifactRefs` is a path-only array (`{ kind: 'result'|'log'|'verdict', path }`) to
project-relative files, never stdout/stderr bodies. A bare `spur agent run --agent codex`
(no spec) creates no occupant and emits neither key. Slash commands like
`/plugin:command` are translated per-agent (claude pass-through, codex `$`, pi/omp `/skill:…`,
others including grok/hermes/opencode → `/plugin-command`).
Team identity (purpose, tags, system prompt) is sourced from the agent **spec** (materialized from
the fleet declaration, below), not from `run` flags. `--drain` resolves the addressed `--spec <id>` (or the legacy
`--agent <spec-id>` fallback, whose warn-once notice was retired by task 0849) as an **agent
spec id** (a different namespace from the coding-agent type), folds that spec's pending inbox
messages into the prompt, and rewrites `--agent` to the spec's **executor name** before dispatch
(Phase 1-3 has no live stdin, so prepending is how deferred messages reach the agent). A
team-materialized spec records the executor name beside the coding-agent kind (task 0537):
`.spur/agents/<slug>-<localId>.yaml` carries `type: <kind>` **and** `executor: <name>`, so the
rewrite resolves back through `resolveExecutor`'s executor-first lookup and restores the
operator's `{ agent, model }` with the executor's declared tier — a spec bound to `codex-sol`
runs on `gpt-5.6-sol` at `capable-3`, not bare `codex` on the default model. For a **role-only**
member (0543 R1) `executor` is the executor the tier ladder resolved (cheapest eligible for the
role's tier — the same funnel `--agent <role>` uses), so the resolution is inspectable on the
spec, not implicit. Pre-existing specs
with no executor field fall back to the coding-agent type (`@transition-shim(spec-without-executor-field)`).
A spec whose executor is absent from `agent.executors` (renamed or removed) **fails loudly** at
drain, naming the spec and the missing executor, and no process spawns — it never silently
downgrades to a bare binary. It also
sets a `spec-id` flag (the spec id, **before** rewriting `agent`) so a spec-addressed run
persists an occupant pin + coordination-facing run row in `coordination_runs` (ADR-057 wave 1).
Every run that resolves a DB also records a **run→session mapping** in `history_run_session`
(feature E6 / task 0557): `AgentService` watermarks the agent's session root (a timestamp,
cheap) right before dispatch and, after the agent exits, walks the root for session files
written during the run. Exactly one candidate → `exactness: exact, mechanism: observed`; a
supplied `--session-id`/`--sessionDir` skips observation entirely (`mechanism: supplied`, still
exact); zero candidates, multiple candidates, a concurrent same-agent overlap (R3), or an
unreadable root (R5) record `unresolved` with a NULL `session_id` — never an exact row with a
guessed session. Resolution happens after the run outcome is decided and never fails the run
(R5).

**Retroactive correlation (task 0558, R1b) fills the pre-observation gap.** Imported history
rows predating the mapping (all 1.3M rows carry `run_id` NULL) are correlated by
`RetroCorrelator` (`packages/domain/src/analytics/retro-correlation.ts`): history sessions are
matched by `(source, cwd, ts)` span against run windows built from `system_events`
(`agent.invoke.start` → `agent.invoke.exit` pairs keyed by `run_id`, never `coordination_runs`
which holds 0 rows), writing `exactness: estimated, mechanism: inferred` rows. Invariants:
run cwd is not persisted so cwd is a session-identity dimension, not a per-run filter; an
`exact` row is never shadowed (guarded in `RunSessionDao.insertInferred`, R2); a session
matching zero or several run windows writes nothing and is counted, never a nearest-neighbour
guess (R3); the scan is bounded by an explicit window (indexed on `ts` / `occurred_at`) and
re-runs are idempotent (R4); the report carries correlated / ambiguous / no-candidate row
counts plus the window (R5). An open window (crash/kill, no `exit`) is bounded by the
correlation window's end — never treated as matching everything after it.
Exit 0 on success, 1 on agent-not-found, 2 on invalid arguments, 3 on agent execution failure.

<a id="spur-agent-list---json---specs"></a>

#### `spur agent list [--json] [--specs] [--server <url>]`

Detect installed agents; prints `ok|missing <name> [version]`. Backed by `ts-ai-runner`
`AgentDetector` / `DISPLAY_ORDER`. Canonical agents (0.4.8+): `claude`, `codex`, `gemini`, `pi`,
`omp`, `opencode`, `antigravity-cli`, `openclaw`, `hermes`, `grok` (`antigravity` is a deprecated
alias of `antigravity-cli`). With `--specs`, lists the team agent specs under `.spur/agents/` instead
(`<id> <type> <role> <executor> <purpose>` — role and executor are distinct columns; an undeclared
role renders `unset`, 0544 R2/R4; `--json` includes the spec path plus `role`/`executor` fields,
omitted when unset). Since 0848 `--specs` also merges live run status from the `spur serve`
supervisor through `--server <url>` (default `http://localhost:3000/api`), each row gaining a
`running`/`stopped`/`errored`/`unknown` column and `pid=<n>` where a process exists; an unreachable
server falls back to all `stopped` with a stderr warning.

<a id="spur-agent-doctor-agent---json---probe-health---force-refresh"></a>

#### `spur agent doctor [agent] [--json] [--probe-health] [--force-refresh]`

Readiness check per agent (same `DISPLAY_ORDER` as list). Text mode prints an aligned table —
`<✓|✗> <usable|missing> <executor-name> <agent-binary> <pinned-model> <capability-tier> <version> <caps> [<owner> <since> <reason>]` with a
`STATUS EXECUTOR AGENT MODEL TIER VERSION CAPS ROLES OWNER SINCE REASON` header and an `N usable, M missing` footer
(feature B4 / 0681; CAPS column feature B8 / 0889; OWNER/SINCE/REASON columns feature B6 / 0893 —
rendered on `disabled` rows only, `—` otherwise). Details per column:

- **EXECUTOR** carries the configured `agent.executors[].name`; the **AGENT** cell carries the underlying
  binary (`omp`, `pi`, …) so aliasing is visible; rows outside any executor config fall back to the agent name.
- **MODEL** shows the *pinned* config model (`agent.executors[].model`) or `—`; probed live model health is
  not a table concern — the single-executor detail view disambiguates via `pinned:` (config) vs `health:`
  (probe) lines. Health probing is **opt-in** (feature B4 / 0683): `--probe-health` passes pinned models
  through to the runner so it probes them; without the flag the models are withheld from the probe set and
  no network/model check runs. The MODEL column always reflects config either way.
- **STATUS** shows `disabled` for a profile with `agent.executors[].disabled: true` (feature B5 / 0796):
such rows are synthesized from config without a probe (`usable: false`, error `disabled by config`), a
full-set inventory still exits 0, and naming a disabled executor directly exits 1 with its row. Since
feature B6 / 0893, `disabled` accepts `boolean | {owner, since, reason}` (a bare `true` is
operator-owned) and disabled rows render their provenance in the OWNER/SINCE/REASON columns.
- **TIER** renders the executor's capability tier (`cheap|standard|capable-*`), distinct from support tier 1/2/3
  (routing introspection only — the task-pipeline size precheck stopped consuming it in 0723), which never appears
  in the table. Declared `agent.executors[].tier`
  wins when the probed name matches a configured executor, else inferred from the name.
- **ROLES** lists pipeline roles this executor could serve (`cheap→scribe`; standard adds coder/reviewer/planner),
  with `*` marking roles where it is the elected (cheapest-usable-by-tier, resolution-order-tiebreak) executor;
  a footer legend explains the star when any row has one.
- **CAPS** (feature B8 / 0889) renders the runner-declared session capability of the underlying agent binary as
  `r✓d✗s✓o✗` (`r`esume-by-id, session `d`ir, persistent `s`tdin, structured `o`utput), `—` when the binary is
  unknown to the runner. Spur reads the record from `@gobing-ai/ts-ai-runner` `getAgentSessionCapability` — it
  never re-declares capabilities. Staleness is core-level (0899): branding prefix/suffix on the detected
  string is not drift; drift is a detected version core that differs from the record's `verifiedAgainst`
  core. When
  it differs, a
  trailing `⚠` marks the cell and text mode emits a `capability-declaration-stale` stderr warning; `--json`
  stays stderr-clean and carries the same facts per agent entry as `capabilities` (the record, `note` included)
  and `capabilityStale: {verifiedAgainst, detected}` (`null` when fresh — or unverifiable: no version core on
  either side, e.g. an `unverified (CLI not installed)` record, never warns).

Arg semantics: a bare **agent/exec name** prints that executor's detail block; a **pipeline role id**
(`coder`, `reviewer`, …) instead renders the full eligible ladder for that role — one line per eligible
agent with the ELECTED marker and per-row failure reasons plus an `N eligible, M usable, elected: X`
summary. `--json` emits `{ agents: [...], cache? }`, each entry adding `capabilityTier`, `model` (pinned or null),
`roles`, and `elected`; each entry also carries `disabled` (feature B5 / 0796, config state) and, feature B8 / 0889,
`capabilities` + `capabilityStale`; feature B6 / 0893 adds `availability {disabled, owner|null, since|null, reason|null}`
per entry plus a top-level `usage` snapshot report (`{capturedAt, age, stale}`; `usage: none` when no
`~/.config/spur/agent-usage.json` exists — informational only, never a warning, never gating; ≥6 h
renders text `stale` and sets `usage.stale: true`); a full-set run adds `cache: {hit, ageMs, path}` — detection results are cached for
60 s at `.spur/run/agent-doctor.json` keyed by an executor-set fingerprint (name/agent/model/tier/disabled), served
only on an exact fresh match, and corrupted/stale/unwritable states degrade silently to a live run; text
mode prints a dated footer note on a hit; `--probe-health` never reads or writes the cache and
`--force-refresh` skips the read, re-runs detection live, and rewrites the file. Under a role selector,
entries are ordered elected-first then resolution order (`agents[0]` is the electee). Auth is neither table column nor surfaced shape (liveness-only gate,
[agent-doctor-inspection-surface](agent-doctor-inspection-surface.md) §4). For **grok**, liveness is tri-state from `XAI_API_KEY` and/or non-empty `~/.grok/auth.json`
(no CLI auth-status verb). Exit 1 if any **tier-1** agent is not usable. Backed by `ts-ai-runner` `DoctorRunner`.
Selector precedence inside the arg: exact executor/agent name first, role id second.

<a id="spur-agent-usage---dry-run---source-name---json---json-envelope"></a>

#### `spur agent usage [--dry-run] [--source <name>] [--json] [--json-envelope]`

Run-once quota-usage producer (feature B6 / 0892, ADR-121; consent row in
[harness-surface-governance](harness-surface-governance.md) §4): executes the external `codexbar`
capture once (`--source <name>`, default `codexbar`), writes the snapshot to
`~/.config/spur/agent-usage.json` (`{captured_at, source, providers, raw}`;
`SPUR_AGENT_USAGE_SNAPSHOT` overrides the path for tests), maps providers to executors per
[session-pinned-dispatch](session-pinned-dispatch.md) §3.4, and drains the resulting observations
as `owner: quota` events through the single availability writer. `--dry-run` prints the would-be
executor changes and writes nothing. A missing/failing capture exits non-zero and changes nothing;
the capture is bounded by a finite deadline (180000 ms default in `CodexbarUsageSource` via
`@gobing-ai/ts-runtime` `NodeProcessExecutor.run({ timeout })`, 0908), and an interrupted run
(timeout/cancel/signal/error) is unusable even when partial stdout parses — it surfaces as
`UsageSourceError` naming the deadline, never an installation hint, before any write.
Per-provider error entries are skipped and reported; partial-provider application holds only for
normally completed runs, and only providers with a real signal (exhausted/headroom) drive
availability decisions — `no-usage` and errored providers stay diagnostic-only, so an absent
window can neither imply recovery nor hide valid headroom (0907). Reported change `action` values
are delivery semantics (`would-apply`/`applied`/`no-op`/`skipped`/`pending`), not byte-mutation
proof; decision and outcome detail lives in
[session-pinned-dispatch](session-pinned-dispatch.md) §3.4. An external
scheduler (cron/launchd) owns invocation — `spur serve` never runs it (asserted by test), keeping
the no-hidden-automation posture: no poller, no timer, no serve-side loop. Mapping rules and the
recorded rejected shape (`spur agent doctor --refresh-usage`) live in
[harness-surface-governance](harness-surface-governance.md) §4 and
[session-pinned-dispatch](session-pinned-dispatch.md) §3.

<a id="agent-specs"></a>

#### Agent specs (`.spur/agents/<id>.yaml`)

Agent specs are backed by `ts-ai-runner` agent-spec helpers and the app-layer `AgentCoordinationService` /
`FleetService`. There is no CLI authoring verb (`agent create|edit|delete` were removed at the G64
cutover, 2026-09-14): specs are materialized from the fleet declaration at `spur serve` start and read
through `spur agent list --specs`. Spec ids are validated (`[a-z][a-z0-9_-]{1,63}`).

- **Materialized specs record the executor binding (0537).** Materialization writes
  `.spur/agents/<slug>-<localId>.yaml` with the coding-agent kind (`type`, required for the
  runner) **and** the configured executor name (`executor: <name>` beside `type`, e.g. `codex-sol`),
  so `--drain --spec <specId>` can resolve back to the operator's model + tier. `executor` is
  optional on disk — pre-existing specs carrying only `type` still load and drain via the fallback
  (`@transition-shim(spec-without-executor-field)`). **Role is the primary axis (0543).** A member
  may declare `role: <scribe|coder|reviewer|planner>` (the Layer-1 role vocabulary —
  `DEFAULT_AGENT_ROLES` in `packages/config`, task 0535) with or without an executor; `purpose` stays human
  annotation. A member declaring a role **and** an executor pins the executor (R2, pin beats policy);
  a member declaring a role **alone** resolves at materialization through the shared tier ladder —
  cheapest executor eligible for the role's tier, the same funnel `--agent <role>` uses (0543 R1) —
  and the spec records **both** the role (`config.role`) and the resolved executor (`executor`), so
  the resolution is inspectable. A member declaring neither role nor executor fails config load
  naming the team id and member position (R4); an unknown role fails naming the value and the
  accepted set (R5). Local id stays `id ?? executor` (0251); a role-only member derives
  `<role>-<n>` by declaration order among same-role role-only members (frozen index — a shifting
  id would break inbox addressing, 0543 R3).

<a id="spur-agent-wait-specid---role-name---run-runid---until-state---timeout-ms---json--spur-message-send---to-id--role-name-body---from-id---wait---until-injectedinvoke-exit---timeout-ms---json"></a>

#### `spur agent wait [<specId>] [--role <name>] [--run <runId>] [--until <state>...] [--timeout <ms>] [--json]` · `spur message send (--to <id>|--role <name>) <body> [--from <id>] [--wait] [--until injected|invoke-exit] [--timeout <ms>] [--json]`

Identity-pinned wait on an occupant run (ADR-057 wave 2 / G4 R4–R5; role-addressed selector per the
ADR-075 amendment, 0685). Addressing is by spec id **or** `--role` — never both: `--role` resolves
against materialized instances (`AgentInstanceStore`, vocabulary = `AGENT_ROLE_NAMES` ∪ configured
executor names) and MUST match exactly one instance. Zero matches → exit 1
(`selector_unmatched`, `count=0`, candidates `none`); multiple → exit 1
(`selector_ambiguous`) naming `count=N` + candidates;
unknown name → exit 2 naming the accepted vocabulary. The resolution collapses onto the SAME
spec-id path below; wait-bearing commands snapshot the same identity pin — pinning semantics are unchanged.
`agent wait` pins the occupant
(`specId`+`runId`+`generation`) and resolves when the first `--until` (OR) is satisfied; default
`idle`. `--run` pins an explicit run (default: latest). Replacement / generation bump / disappearance
fails fast. `message send --wait` snapshots the occupant **before** enqueue, then waits on that pin
in the same process (default `invoke-exit`); enqueue is not rolled back on wait failure. Wave 3 (0531)
replaced the 100 ms poll with `followSystemEventsAfter` over the shared ledger — snapshot
`sequence`, then follow `sequence > snapshot` (global monotonic cursor auto-assigned at persist
in `SystemEventDao.insert`).

`--json` errors: `{ error: { code, message } }` with codes `occupant_gone | run_replaced |
wait_stalled | timeout` (exit 1). `--until blocked` has no first-class signal in wave 2 → exit 2.
No oRPC wait path in this wave.

<a id="spur-message-send---to-id-body---from-id---wait---until-injectedinvoke-exit---timeout-ms---json--spur-message-inbox---agent-id---json--spur-message-reply-msg-id-body---json--spur-message-watch---agent-id---interval-ms---json"></a>

#### `spur message send --to <id> <body> [--from <id>] [--wait] [--until injected|invoke-exit] [--timeout <ms>] [--json]` · `spur message inbox --agent <id> [--json]` · `spur message reply <msg-id> <body> [--json]` · `spur message watch --agent <id> [--interval <ms>] [--json]`

Durable inter-agent messaging over the SQLite `inbox_messages` table (backed by `AgentCoordinationService` →
`ts-db` `InboxMessageDao`).

- `send` — enqueue a message; `--from` defaults to `operator`. Prints `queued <id> → <to>`.
  `--wait` / `--until` / `--timeout` are documented with `agent wait` above.
- `inbox` — list messages addressed to `--agent` (`<id> <status> <from> <body> <createdAt>`); reports
  "No messages" when empty.
- `reply` — look up the original message, address the reply back to its `from_id`, and thread it via
  `in_reply_to`. Rejects an unknown id, or an operator-originated message (null sender) with no peer.

<a id="spur-agent-start-spec-id---server-url---json--spur-agent-stop-spec-id---server-url---json"></a>

#### `spur agent start <spec-id> [--server <url>] [--json]` · `spur agent stop <spec-id> [--server <url>] [--json]`

Supervised process lifecycle (backed by `SupervisorService` via `spur serve`). The `spur team` noun was
removed at the G64 cutover (2026-09-14): `assign` → `spur task update --assignee`, `status` →
`spur agent list --specs`, `up` → fleet materialization at serve start. There is no attach verb:
attach is `GET /api/processes/:id/stream` (SSE) plus Board/HTTP clients.

- POST to `<server>/agents/<id>/(start|stop)` (default server `http://localhost:3000/api`; `--server` overrides). `--json` returns the raw server payload; otherwise `start` prints `started <id> (pid=<pid>, status=<status>)`, `stop` prints `stopped <id>`. Exit 1 on transport failure or server-side error. `start` launches `spur agent loop` under the supervisor and injects caller-identity env into that process: `SPUR_SPEC_ID` (spec id), `SPUR_RUN_ID` (process-generation UUID), and `SPUR_SERVE_URL` from the supervisor constructor or env (ADR-057 wave 1). `SPUR_AGENT` remains the host coding-agent hint, not a spec id. Process-pipe stdin (`POST /api/processes/:id/stdin`) is operator attach, not durable inbox delivery.

<a id="spur-rule-run---preset-name---file-path---rule-id---fail-on-severity---stop-on-first-severity---fix-mode-mode---dry-run---verbose---json"></a>

#### `spur rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--stop-on-first [<severity>]] [--fix-mode <mode>] [--dry-run] [--verbose] [--json]`

Evaluate constraint rules over the working tree. `--preset` (default `recommended-pre-check`) or
`--file` for an ad-hoc rule file; `--rule <id>` filters to one rule. `--fail-on error|warning|info` (default
`error`) sets the exit-1 threshold. `--stop-on-first [<severity>]` (default `error` when bare) stops
evaluation after the first rule with findings at or above the given severity — this controls
**traversal** (when to stop), orthogonal to `--fail-on` which controls **verdict** (what to fail on).
They compose: stop early, then threshold the partial findings via `--fail-on`. Omitting
`--stop-on-first` preserves the default exhaustive scan.

`--fix-mode none|suggest|auto` (default `none`) controls fix collection and application:

- `none` — fixes not collected. Byte-identical to the pre-`--fix-mode` behavior.
- `suggest` — collect candidate fixes, surface them (`fixes[]` in `--json`), **write nothing**.
- `auto` — collect AND apply. Effective per-rule mode is `min(rule.fix.mode, maxFixMode)`.
  `--dry-run` previews the diff without writing.

Exit code is governed by `--fail-on` based on **findings** alone; applying a fix does NOT retroactively
clear the exit code (the operator re-runs to confirm green). `--verbose` streams per-rule progress with
execution time to stderr (e.g. `✓ passed - 0.12s`). Rule roots resolve highest-priority-first:
`SPUR_RULES_PATH`, local `.spur/rules`, the user-global `~/.config/spur/rules`, then the generic demo
rules bundled with `ts-rule-engine` as a fallback so a preset's categories resolve before `spur init`
seeds the global layer. A run that resolves **zero rules** exits 1. Setting `SPUR_GLOBAL_RULES_DIR`
overrides the global root and suppresses the bundled fallback for a hermetic run. Backed by
`ts-rule-engine`.

<a id="spur-rule-validate---file-path--preset-namepath---kind-type---no-schema---json--spur-rule-list---preset-name---json--spur-rule-trace-run-id---preset-name---status-s---since-date---last-n---json"></a>

#### `spur rule validate [--file <path>|--preset <name>|<path>] [--kind <type>] [--no-schema] [--json]` · `spur rule list [--preset <name>] [--json]` · `spur rule trace [run-id] [--preset <name>] [--status <s>] [--since <date>] [--last <n>] [--json]`

- `validate` — load and normalize a rule file or preset without evaluating it.
- `list` — list the effective rule-file inventory grouped by source layer and category (`local`, `global`,
  and any `SPUR_RULES_PATH` override, deduped by relative path); with `--preset`, list the resolved preset
  rules.
- `trace` — query persisted rule run history from SQLite. No argument: list recent runs (default last 20,
  newest first) with filters `--preset`, `--status` (`done`|`failed`), `--since` (ISO date), `--last` (positive
  integer). With `<run-id>`: per-run detail showing summary metadata and per-rule evaluation rows in
  execution order with finding counts, duration, and status. `--json` returns structured DTOs.
  Runs are persisted inline by `spur rule run` when a DB is available (direct writes from the
  `ts-rule-engine` `RulePersistenceAdapter`; Spur writes via `DbRulePersistenceAdapter`).
  Human and JSON projections add project, source, timing, dry-run/fix policy, applied fixes, outcome,
  per-evaluation severity/evaluator/timestamps, and an exact preset command or source path when safe.
  Finding messages and fix replacement bodies are not projected; malformed optional JSON becomes
  explicit unavailable data without failing the command. Existing JSON keys remain present.
  Backed by `ts-rule-engine`. Help dispatch per §1.0.

<a id="spur-workflow-show-workflowyaml---format-mermaidtodo---json--spur-workflow-validate-workflowyaml---json---no-schema--spur-workflow-run-workflowyaml---run-id-id---vars-json---dry-run---async---no-plan---detail-minimalinvocationfull---quiet--silent--verbose---trace-file---steer---no-log---json--spur-workflow-continue-run-id---yes---answer-yesnocancel---json--spur-workflow-cancel-run-id---json--spur-workflow-list---json--spur-workflow-trace-run-id---workflow-name---status-s---since-date---last-n---follow---poll-ms---output---json--spur-workflow-clean---older-than-minutes---force---logs---dry-run---json--spur-workflow-progress-run-id---json"></a>

#### `spur workflow show <workflow.yaml> [--format <mermaid|todo>] [--json]` · `spur workflow validate <workflow.yaml> [--json] [--no-schema]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--detail <minimal|invocation|full>] [--quiet|--silent|--verbose] [--trace-file] [--steer] [--no-log] [--json]` · `spur workflow continue [run-id] [--yes] [--answer <yes|no|cancel>] [--async] [--no-log] [--json]` · `spur workflow cancel <run-id> [--json]` · `spur workflow list [--json]` · `spur workflow trace [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--follow] [--poll <ms>] [--output] [--json]` · `spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]` · `spur workflow progress <run-id> [--json]`

> **Shipped surface (ADR-045 / feature D2, tasks 0426–0429):** `run --no-log` opts out of the
> consolidated `.spur/run/<RUNID>.log` (retained by default otherwise); `trace --follow --output`
> streams that log as a tail -f-equivalent source and is rejected with `--json`; `spur workflow
clean` reclaims retained logs older than `workflow.logRetentionDays` (default 30 days). Shapes:
> [`design/workflow-run-log.md`](workflow-run-log.md).

- `show <file> [--format <mermaid|todo>] [--json]` — read-only projection of a definition (0695/D7).
  Default prints the fenced mermaid FSM diagram, byte-identical to the pre-flag output (0620).
  `--format todo` prints a declared-step checklist — one `- [ ] <id>` per state/node in declaration
  order, markers after ` — ` (`initial` `terminal` `failure` `pause` `loop-back` `conditional`, then
  `nodeType` when not `action`); state-machine output declares itself an inventory, not a predicted
  execution path — no topological reordering, and `conditional` means "entered only through guarded
  transitions" (no `--vars` prediction). `--json` wraps the selected projection: `{name, kind,
  format: 'todo', steps: WorkflowStep[]}` (each step: `id` + `initial`/`terminal`/`failure`/
  `pause`/`loopBack`/`conditional`, optional `nodeType`) or `{name, kind, format: 'mermaid',
  diagram}`; bare `--json` returns the mermaid envelope. Both envelopes carry `source: {layer,
  path}`, the layer and file that name resolution picked (ADR-113). Unknown `--format` exits 1
  naming both values before file resolution; not-found and schema-invalid errors are identical for every
  format. Consumer: the inline driver's layer-1 todo (0696, `inline-pipeline-driver.md`).
- `progress <run-id> [--json]` — read-only projection of one run's execution progress
  (D62 / ADR-117). The payload **is** `projectWorkflowProgress`
  (`packages/app/src/workflow/progress-projection.ts`): `{schemaVersion, runId, workflow, status,
  definitionDigest, version?, currentState, states[], transitions[], artifacts[],
  nextTransitions[], diagnostics[], projectedAt}` — current state, each action's attempts
  (`actionRunId`, status, `ok`, started/completed, `durationMs`), and the candidate next
  transitions with their eligibility. `apps/cli` renders only; it adds no projection logic and no
  query shape. A running or incomplete run exits `0` and leaves unanswered values as `unknown`
  (`null` digest/state, absent attempts, `diagnostics` naming what is missing). An unknown run id
  exits `1` with `Run <run-id> not found.` (`NOT_FOUND` under `--json-envelope`).
- `validate <file>` — load + Zod-validate a workflow definition.
- **YAML extensions (0533/D4):** a workflow may declare `extensions.actions: [./module.ts]` /
  `extensions.guards: [...]` — relative module paths resolved against the workflow file's own
  directory. `validate`, `run` (incl. `--dry-run`), and `continue` all load them onto the engine
  host before any step (same path for all three). The YAML declaration is the `allowExtensions`
  gate; a missing module, a module without the declared capability, an absolute path, or `..`
  traversal fails the command before any workflow step. Schema: both workflow JSON schemas carry
  `extensions` (0431 parity).
- **Composition findings (0614/ADR-069, ADR-115):** on the valid path `validate` also reports
  composition findings: `--json` adds `composition: {findings[]}` where each finding is
  `{workflow, state, actionKey, level, measure: {kind, measured, threshold?, severity?},
  recommendation}`. `level` is `warn` or `error`; `measure.kind` is `shell-lines`, `shell-chars`,
  `guard-lines`, `agent-run-chars` or `agent-run-output`; `threshold` is the cap the measure
  exceeded. A guard finding names its source state in `state` and `<from>→<to>` in `actionKey`.
  `shell-lines` and `guard-lines` count logical commands (split on newline, `;`, `&&` and `||`;
  blank, `#` and bare structure tokens skipped). Tiers are owned by
  [surface governance](harness-surface-governance.md) §1.2: a `shell` action warns at 6–10 and
  errors >10 logical commands or >800 characters; a shell guard warns at 4–5 and errors >5; an
  `agent.run` `input` errors >1000 characters whatever its shape and otherwise warns when it is
  not slash-led (severity by raw length: <200 low / ≤1000 medium); an `agent.run` with neither
  `expectFile` nor `requireDiff` warns. Human mode prints findings to stderr. Any error-level
  finding exits 1; warn-only findings keep exit 0. Findings are derived from the definition itself
  (`extractResolvedWorkflowFacts`) on the validate path only; `run`, `run --dry-run` and `continue`
  never compute or act on them. `spur-check` fails on an error-level finding in
  `config/workflows/*.yaml` and ignores warn-level ones.
- `run <file> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan]` — execute; prints `<status>: <name> -> <finalState>`;
  exit 1 unless `done`. `--vars` takes a JSON object of per-run variable overrides
  (e.g. `--vars '{"taskId":"0042"}'`), merged over the workflow's `vars` for `${vars.*}` resolution.
  `--dry-run` validates the definition and walks the transition graph without executing actions
  — useful for verifying workflow structure before committing side effects.
  **Observability (0114/0310/0365, synchronous human runs):** default output prints the run id,
  plan, correlated phase/action lines, resolved agent/model, redacted invocation summary, bounded live
  stdout/stderr, timeout budget, 30-second liveness, duration/outcome, and explicit `usage unavailable`.
  `--detail minimal` retains compact lines; `--detail invocation` is the default; `--verbose`
  implies full correlation and FSM transitions. `--quiet` keeps only the final summary;
  `--silent` suppresses routine output. `--json` emits only the existing result object.
  `--trace-file` appends the schema-versioned redacted stream under
  `.spur/workflow/<run-id>.jsonl` and propagates to the detached child. `--steer` enables
  synchronous in-process `continue|note|retry|abort` commands at an action's declared
  `steeringBoundary`; it conflicts with `--json` and `--async`, and retry additionally requires an
  explicit idempotent `retryPolicy`. `--no-plan` remains orthogonal. Mechanism, backpressure, redaction,
  and control boundaries:
  [`design/workflow-observability.md`](workflow-observability.md).
  `--async` starts the run in a detached background process and returns the run id immediately.
  0901 R1: a `--run-id` (or discovered) id whose run row already exists refuses before spawn
  instead of silently reusing the existing run (exit 1, `Run "<id>" already exists`); the async
  launcher performs the same pre-flight check, and `continue` reuses the guard for its target id.
- `continue [run-id] [--yes] [--answer <yes|no|cancel>] [--async] [--no-log]` — resume a paused or
  interrupted (0901 R2) HITL run (E3, design §6 / D04). Omit `run-id` to
  discover the most-recent paused run and confirm (skipped with `--yes`). A headless resume
  (`--json` or non-TTY stdout) without an explicit `--answer` is refused with exit 2 — `--yes`
  only skips the CLI confirm and never answers gates (0901 R3); the `--async` worker forwards the
  caller's `--answer`, so detached CI resumes must pass it too. With `--async` the launcher spawns
  a detached worker, reports `started` once the worker has claimed the run (run-row status leaves
  paused/interrupted, 0901 R4) or `failed` with a hint to rerun synchronously. Resumed runs
  persist the consolidated `.spur/run/<RUNID>.log` and pass shell streams through the secret
  redactor + 64 KiB tail (0901 R5/R6) unless `--no-log`. With a recorded launch
  source (0784 R1), resume replays that exact recorded file from the recorded launch workdir — a
  missing recorded source refuses rather than resolving a same-named replacement; pre-pin rows
  resolve by `workflow_name` with an explicit degraded-identity warning (0784 R2). Checkpoint
  freshness validates in the launch workdir; associated checkpoints must project a nonterminal
  engine state (`pending`/`running`/`approved`). Then `resumeRun`. Works for both lifecycle and
  pipeline runs; exit 1 if no resumable run, the run isn't resumable (only `paused` or
  `interrupted` qualify), or it doesn't resolve to `done`.
  (A state pauses when it declares `pause: true`; the workspace schema supports `pause`.)
- `cancel <run-id>` — mark a single non-terminal run failed; SIGTERM the worker process group when live. Idempotent: already-terminal runs report no change. Bulk/stale variant is `clean`.
- `list` — list workflow YAML files by layer, in resolution order (ADR-113): `project`
  (`<cwd>/.spur/workflows`, always listed, even when missing), one `registered` layer per extra
  `workflows.paths` folder, then `shared` (the installed package's `config/workflows`). `--json`
  returns `{layers: [{id, path}], entries, totalFiles}`; an entry's `source` is its layer id and its
  `description` is the definition's top-level `description`, or `null`. Human output prints every
  layer header, including empty ones.
- `trace` — query persisted workflow run history. No argument: list recent runs (default last 20,
  newest first) with filters `--workflow`, `--status`, `--since`, `--last`. With `<run-id>`:
  per-run timeline of state entries, transitions, and action executions interleaved by `created_at`.
  `--follow` requires a run id, replays that durable timeline, polls every `--poll` milliseconds
  (default 1000; minimum 50), emits changed action rows, and exits at terminal status. It is a
  human stream and cannot be combined with `--json`. `--output` (requires `--follow`) swaps the
  follow source to a raw tail of `.spur/run/<RUNID>.log` (tail -f equivalent), also a human stream
  rejected with `--json`; a run started with `--no-log` prints a clear no-log message at terminal
  status instead of hanging. List/detail/follow share project, run timing/duration/outcome, and exact
  next-action fields. Detail transitions show both endpoints and their persisted time; actions show
  id/node/status/timestamps, allow-listed invocation metadata, bounded error, cost, and existing run
  or partial-work artifacts. Arbitrary action stdout/stderr/argv is never projected; malformed
  `result_json` produces explicit unavailable fields. Existing JSON keys remain present.
- `clean [--older-than <minutes>] [--force] [--logs] [--dry-run]` — housekeeping: finalize orphaned
  runs stuck in `running`/`pending` past a staleness threshold (default 30 min) as failed, and
  reclaim retained run logs older than `workflow.logRetentionDays` (`.spur/config.yaml`, default 30
  days). `--logs` scopes to log reclamation only; `--dry-run` lists what would be cleaned without
  writing; `--force` overrides `--older-than`.
  Action lines include the action kind, duration when finalized, and an in-flight/success/failure marker.
  **Per-step cost (0311 / task 0559):** `agent.run` lines carry token usage + cache-hit joined from
  `history_message`'s typed token columns through the `history_run_session` mapping — the action's
  run id → mapped `(source, session_id)` pairs → their message rows. Exact (task 0557) and estimated
  (task 0558 retroactive) mappings are folded and rendered apart, never summed (R2), with `~` marking
  estimated figures; `· cost n/a` when no mapped usage matches (never `$0.00` — 0281/0284
  never-fabricate). An unjoined step appends a footer hinting `spur history import`. Tokens only — no
  currency value is computed or emitted (R3); `history_message.cost_usd` and the pricing tables stay
  unread. `--json` gains a nullable per-action `cost` object (`exact`/`estimated` attribution, each
  with token dims + `cacheHitRatio`), additive so existing consumers are unaffected. Cost is read from
  already-imported history; `trace` never triggers an import. Join + math:
  `packages/domain/src/analytics/run-cost.ts`.
  Backed by `ts-dual-workflow-engine` (`WorkflowService` + `DbWorkflowPersistenceAdapter`).

### Optional DecisionMaker for executed HITL actions

Set the single project/global config switch through the existing merged config loader:

```yaml
workflow:
  hitlDecisionMaker: true
```

Absent or `false` returns the existing interactive/default responder unchanged: no DecisionMaker
construction, credentials or network calls are needed. Setting it back to `false` disables the
integration without changing workflow YAML. Existing `hitl.confirm`, `hitl.select`, `hitl.input`
action names, options, events, cancellation and answer variables remain authoritative.

When enabled, the application-owned responder uses A2 for confirm/select and delegates free-text
input. It supplies at most the latest 20 completed non-HITL action outcomes for the same run:
node/kind/success plus bounded error and stdout/stderr/summary text. It excludes environment,
workflow variables, command fields, arbitrary result fields and files; known credentials and configured
secret values are redacted before transmission. Enabling the switch therefore authorizes sending
these selected workflow outputs and the question/options to the configured A2 provider.

The default provider uses `TYPESAFE_API_KEY` from the process environment (never project config),
a 15-second request timeout and zero retries. Deploy with an upstream `ts-ai-runner` release that
contains A2: the previously installed 0.5.0 artifact predates these exports, despite the local
upstream source version also being 0.5.0. An unavailable API/export/key, missing evidence, malformed
answer, explicit defer, or confidence/selected probability below 0.9 falls back to the same original
responder. Other options must have strictly lower probabilities. This threshold is conservative
policy, not calibrated proof of better judgments. The fallback retains existing policy, including
an explicitly configured automatic confirm default; it does not force denial or invent an approval.

Stock `task-pipeline.yaml` with `profile=auto` skips approval, so no responder runs there. This
switch affects executed `hitl.*` actions only; it does not change the graph, CLI resume confirmation,
or the requirement for an explicit answer when resuming a paused headless run (ADR-122).

#### Explicit decision modes (task 0911)

`hitl.confirm` and `hitl.select` accept an optional `decision` option making participation explicit
per action. `hitl.input` rejects `decision` at parse time.

```yaml
- kind: hitl.confirm
  options:
    prompt: "Publish?"
    decision:
      mode: never            # always the human responder, even when the switch is on

- kind: hitl.select
  options:
    prompt: "Which route?"
    options: [tutorial, reference]
    decision:
      mode: evidence
      statusVar: decisionStatus   # required identifier, must differ from the answer var
      evidenceNodes: [assess]     # producer state/node ids in this workflow (1..20, unique)
      summaryArtifact: s.md       # optional registered artifact; envelope must match producer evidence
```

Semantics per mode (absent `decision` = 0910 implicit participation, unchanged):

| Mode | Enabled switch | Disabled/absent switch |
| --- | --- | --- |
| `never` | always the original responder; provenance `policy-never` | identical |
| `evidence` | answers only from verified evidence (below) | defers (`disabled`) |
| absent (legacy) | 0910 implicit behavior | 0910 passthrough |

Evidence mode accepts only when: every `evidenceNodes` producer has a completed, unambiguous
latest attempt in the same run; confidence ≥ 0.9 with the selected choice strictly dominant; and,
when a `summaryArtifact` is declared, that it resolves to a registered artifact whose JSON envelope
(`schemaVersion 1`,
matching `runId`/producer node/action id and a summary equal to the producer's recorded redacted
outcome) is at most 8 KiB. Evidence is capped at 20 rows and 2000 redacted characters per row
(32 KiB serialized). Any failure defers: the answer var is cleared to `""` (a stale previous answer
cannot steer the next transition) and, for evidence mode, `statusVar` records `deferred` (`accepted`
on success). Provenance — mode, outcome, reason, provider, confidence, selected probability,
evidence action ids, evidence digest, artifact id, duration — is persisted with the action result
(`action_runs.result_json`) and projected by `spur workflow trace` (a `decision` object on the JSON
action event, plus the human `decision=` line). It is not attached to the run's event metadata, and
raw evidence text and provider exception text never enter it.

`workflow validate` (and `run`) reject: `decision` on `hitl.input`; unknown keys/modes; evidence
mode in `pause: true` states/nodes; more than one evidence action per state/node; select choices
violating the evidence invariants (<2, duplicate, empty, a `defer` choice); and producer nodes
that do not exist in the workflow. Bundled workflows ship explicit `mode: never` on their human
gates, and `config/workflows/decision-routing-example.yaml` demonstrates all three modes.

Offline readiness is projected by `spur self status` as `decisionMaker: {enabled, provider,
credentialPresent, state, connectivity, inlineSupport}` with states `disabled`, `missing-key`,
and `configured-not-probed` (presence check only — no live probe, never echoes the key value).
Known limitations: no hot reload (config is read at process start), no live connectivity probe,
and provider probabilities are uncalibrated policy, not measured quality.
