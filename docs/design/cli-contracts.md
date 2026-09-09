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
  via `workspace:` by another workspace package, then add per-package trace tags plus the aggregate
  `@<scope>/<root>-v<version>` publish tag.
- `drop-tags <package-id> <version> [--remote]` — delete the local tag; `--remote` also deletes it
  on origin.
- `drop-tags --all <version> [--remote]` — drop the per-package + aggregate tags.

Package ids are unscoped short names (`@gobing-ai/spur` → `spur`). Unknown ids, invalid semver, a
dirty tree, a detached HEAD, or an existing local/origin tag abort with exit 1 and usage text
(`releaseUsage`). Output and exit behavior are identical to the legacy `spur-dev release` path.

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
`agent.team[].members[]` entries declare an optional `role` — the **primary axis** since 0543: a
member may name the role alone (executor optional) and materialization resolves an executor through
the tier ladder; a member declaring at least one of role/executor is the load rule (R4).
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
`--agent <spec-id>` still addresses the spec during the transition with a one-time warning (shim
`agent-flag-spec-id`). The three selector
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
Team identity (purpose, tags, system prompt) is sourced from the agent **spec** (`agent create`
flags below), not from `run` flags. `--drain` resolves the addressed `--spec <id>` (or the legacy
`--agent <spec-id>`, warned once) as an **agent
spec id** (a different namespace from the coding-agent type), folds that spec's pending inbox
messages into the prompt, and rewrites `--agent` to the spec's **executor name** before dispatch
(Phase 1-3 has no live stdin, so prepending is how deferred messages reach the agent). A
team-materialized spec records the executor name beside the coding-agent kind (task 0537):
`.spur/agents/<teamId>-<localId>.yaml` carries `type: <kind>` **and** `executor: <name>`, so the
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

#### `spur agent list [--json] [--specs]`

Detect installed agents; prints `ok|missing <name> [version]`. Backed by `ts-ai-runner`
`AgentDetector` / `DISPLAY_ORDER`. Canonical agents (0.4.8+): `claude`, `codex`, `gemini`, `pi`,
`omp`, `opencode`, `antigravity-cli`, `openclaw`, `hermes`, `grok` (`antigravity` is a deprecated
alias of `antigravity-cli`). With `--specs`, lists the team agent specs under `.spur/agents/` instead
(`<id> <type> <role> <executor> <purpose>` — role and executor are distinct columns; an undeclared
role renders `unset`, 0544 R2/R4; `--json` includes the spec path plus `role`/`executor` fields,
omitted when unset).

<a id="spur-agent-doctor-agent---json---probe-health---force-refresh"></a>

#### `spur agent doctor [agent] [--json] [--probe-health] [--force-refresh]`

Readiness check per agent (same `DISPLAY_ORDER` as list). Text mode prints an aligned table —
`<✓|✗> <usable|missing> <executor-name> <agent-binary> <pinned-model> <capability-tier> <version>` with a
`STATUS EXECUTOR AGENT MODEL TIER VERSION ROLES` header and an `N usable, M missing` footer
(feature B4 / 0681). Details per column:

- **EXECUTOR** carries the configured `agent.executors[].name`; the **AGENT** cell carries the underlying
  binary (`omp`, `pi`, …) so aliasing is visible; rows outside any executor config fall back to the agent name.
- **MODEL** shows the *pinned* config model (`agent.executors[].model`) or `—`; probed live model health is
  not a table concern — the single-executor detail view disambiguates via `pinned:` (config) vs `health:`
  (probe) lines. Health probing is **opt-in** (feature B4 / 0683): `--probe-health` passes pinned models
  through to the runner so it probes them; without the flag the models are withheld from the probe set and
  no network/model check runs. The MODEL column always reflects config either way.
- **STATUS** shows `disabled` for a profile with `agent.executors[].disabled: true` (feature B5 / 0796):
such rows are synthesized from config without a probe (`usable: false`, error `disabled by config`), a
full-set inventory still exits 0, and naming a disabled executor directly exits 1 with its row.
- **TIER** renders the executor's capability tier (`cheap|standard|capable-*`), distinct from support tier 1/2/3
  (routing introspection only — the task-pipeline size precheck stopped consuming it in 0723), which never appears
  in the table. Declared `agent.executors[].tier`
  wins when the probed name matches a configured executor, else inferred from the name.
- **ROLES** lists pipeline roles this executor could serve (`cheap→scribe`; standard adds coder/reviewer/planner),
  with `*` marking roles where it is the elected (cheapest-usable-by-tier, resolution-order-tiebreak) executor;
  a footer legend explains the star when any row has one.

Arg semantics: a bare **agent/exec name** prints that executor's detail block; a **pipeline role id**
(`coder`, `reviewer`, …) instead renders the full eligible ladder for that role — one line per eligible
agent with the ELECTED marker and per-row failure reasons plus an `N eligible, M usable, elected: X`
summary. `--json` emits `{ agents: [...], cache? }`, each entry adding `capabilityTier`, `model` (pinned or null),
`roles`, and `elected`; each entry also carries `disabled` (feature B5 / 0796, config state); a full-set run adds `cache: {hit, ageMs, path}` — detection results are cached for
60 s at `.spur/run/agent-doctor.json` keyed by an executor-set fingerprint (name/agent/model/tier/disabled), served
only on an exact fresh match, and corrupted/stale/unwritable states degrade silently to a live run; text
mode prints a dated footer note on a hit; `--probe-health` never reads or writes the cache and
`--force-refresh` skips the read, re-runs detection live, and rewrites the file. Under a role selector,
entries are ordered elected-first then resolution order (`agents[0]` is the electee). Auth is neither table column nor surfaced shape (liveness-only gate,
ADR/0127). For **grok**, liveness is tri-state from `XAI_API_KEY` and/or non-empty `~/.grok/auth.json`
(no CLI auth-status verb). Exit 1 if any **tier-1** agent is not usable. Backed by `ts-ai-runner` `DoctorRunner`.
Selector precedence inside the arg: exact executor/agent name first, role id second.

<a id="spur-agent-create-id---type-agent-type---json-flags--spur-agent-edit-id--spur-agent-delete-id---force"></a>

#### `spur agent create <id> --type <agent-type> [--json] [flags]` · `spur agent edit <id>` · `spur agent delete <id> [--force]`

Manage team agent specs under `.spur/agents/<id>.yaml` (backed by `ts-ai-runner` agent-spec helpers
and the app-layer `TeamService`).

- `create` — write a spec. `--type` is a canonical coding-agent id (e.g. `claude`, `codex`, `omp`,
  `grok`, … — same set as list/doctor). Flags: `--name`, `--workspace`, `--purpose`, `--tags <a,b>`,
  `--model`, `--autonomy`, `--system-prompt`, `--no-identity-preamble`, `--auto-start`. The id is
  validated (`[a-z][a-z0-9_-]{1,63}`); a duplicate id is refused. An empty `--purpose` falls back to
  `"<type> agent"` so the written YAML round-trips. `--json` emits `{ ok, spec }`.
- **Team-materialized specs record the executor binding (0537).** `spur team up <teamId>` writes
  `.spur/agents/<teamId>-<localId>.yaml` with the coding-agent kind (`type`, required for the
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
- `edit` — open the spec in `$EDITOR`, or print its path when `$EDITOR` is unset. Errors if missing.
- `delete` — remove the spec; refuses (exit 2) without `--force`; errors (exit 1) if missing.

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

Durable inter-agent messaging over the SQLite `inbox_messages` table (backed by `TeamService` →
`ts-ai-runner` `MessageService` → `ts-db` `InboxMessageDao`).

- `send` — enqueue a message; `--from` defaults to `operator`. Prints `queued <id> → <to>`.
  `--wait` / `--until` / `--timeout` are documented with `agent wait` above.
- `inbox` — list messages addressed to `--agent` (`<id> <status> <from> <body> <createdAt>`); reports
  "No messages" when empty.
- `reply` — look up the original message, address the reply back to its `from_id`, and thread it via
  `in_reply_to`. Rejects an unknown id, or an operator-originated message (null sender) with no peer.

<a id="spur-team-assign-task-id-agent-id--spur-team-status---json---by-team---server-url--spur-team-up-team---check---server-url---json--spur-team-down-team---purge---server-url---json--spur-team-start-agent-id---server-url---json--spur-team-stop-agent-id---server-url---json"></a>

#### `spur team assign <task-id> <agent-id>` · `spur team status [--json] [--by-team] [--server <url>]` · `spur team up <team> [--check] [--server <url>] [--json]` · `spur team down <team> [--purge] [--server <url>] [--json]` · `spur team start <agent-id> [--server <url>] [--json]` · `spur team stop <agent-id> [--server <url>] [--json]`

Team coordination (backed by `TeamService` + `SupervisorService` via `spur serve`). There is no
`spur team attach` verb: attach is `GET /api/team/processes/:id/stream` (SSE) plus Board/HTTP clients.

- `assign` — set `assignee: <agent-id>` in the YAML frontmatter of `docs/tasks/<task-id>_*.md`
  (replacing any existing assignee). Errors if no matching task file is found.
- `status` — list every spec under `.spur/agents/` with its run status; `--by-team` groups by
  `agent.team.<id>`; `--json` emits `{ agents: [...] }`. Each row carries the declared `role`
  (rendered `unset` when undeclared, 0544 R1/R4) and the spec's `executor`. When `--server` is
  reachable, rows enrich from the supervisor; otherwise they fall back to local spec metadata.
- `up` / `down` — materialize or tear down the roster for `<team>`. `up --check` is a dry-run.
  `down --purge` deletes `spur:generated` specs only. When serve is reachable, `up` best-effort
  starts autostart members and `down` stops members.
- `start` / `stop` — POST to `<server>/team/agents/<id>/(start|stop)` (default server `http://localhost:3000/api`; `--server` overrides). `--json` returns the raw server payload; otherwise `start` prints `started <id> (pid=<pid>, status=<status>)`, `stop` prints `stopped <id>`. Exit 1 on transport failure or server-side error. `start` launches `spur agent loop` under the supervisor and injects caller-identity env into that process: `SPUR_SPEC_ID` (spec id), `SPUR_RUN_ID` (process-generation UUID), `SPUR_TEAM_ID` when the spec has a `team:` tag, and `SPUR_SERVE_URL` from the supervisor constructor or env (ADR-057 wave 1). `SPUR_AGENT` remains the host coding-agent hint, not a spec id. Process-pipe stdin (`POST /api/team/processes/:id/stdin`) is operator attach, not durable inbox delivery.

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

<a id="spur-workflow-show-workflowyaml---format-mermaidtodo---json--spur-workflow-validate-workflowyaml---json---no-schema--spur-workflow-run-workflowyaml---run-id-id---vars-json---dry-run---async---no-plan---detail-minimalinvocationfull---quiet--silent--verbose---trace-file---steer---no-log---json--spur-workflow-continue-run-id---yes---answer-yesnocancel---json--spur-workflow-cancel-run-id---json--spur-workflow-list---json--spur-workflow-trace-run-id---workflow-name---status-s---since-date---last-n---follow---poll-ms---output---json--spur-workflow-clean---older-than-minutes---force---logs---dry-run---json"></a>

#### `spur workflow show <workflow.yaml> [--format <mermaid|todo>] [--json]` · `spur workflow validate <workflow.yaml> [--json] [--no-schema]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--detail <minimal|invocation|full>] [--quiet|--silent|--verbose] [--trace-file] [--steer] [--no-log] [--json]` · `spur workflow continue [run-id] [--yes] [--answer <yes|no|cancel>] [--json]` · `spur workflow cancel <run-id> [--json]` · `spur workflow list [--json]` · `spur workflow trace [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--follow] [--poll <ms>] [--output] [--json]` · `spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]`

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
  diagram}`; bare `--json` returns the mermaid envelope. Unknown `--format` exits 1 naming both
  values before file resolution; not-found and schema-invalid errors are identical for every
  format. Consumer: the inline driver's layer-1 todo (0696, `inline-pipeline-driver.md`).
- `validate <file>` — load + Zod-validate a workflow definition.
- **YAML extensions (0533/D4):** a workflow may declare `extensions.actions: [./module.ts]` /
  `extensions.guards: [...]` — relative module paths resolved against the workflow file's own
  directory. `validate`, `run` (incl. `--dry-run`), and `continue` all load them onto the engine
  host before any step (same path for all three). The YAML declaration is the `allowExtensions`
  gate; a missing module, a module without the declared capability, an absolute path, or `..`
  traversal fails the command before any workflow step. Schema: both workflow JSON schemas carry
  `extensions` (0431 parity).
- **Composition advisory (0614/ADR-069):** on the valid path `validate` also emits a warn-only
  composition advisory: `--json` adds `composition: {findings[], suppressed}` where each finding is
  `{workflow, state, actionKey, measure: {kind: 'shell-lines'|'agent-run-chars', measured,
  threshold?, severity?}, recommendation}`; human mode prints the advisory to stderr and stays
  exit 0. Rules (frozen): a `shell` action flags when its command has **≥6** non-comment units
  (split on newline and `;`, blank/`#` units skipped); an `agent.run` action flags when its
  `input` is a **non-slash** prompt, severity by raw length (<200 low / ≤1000 medium / >1000
  high); guards are exempt (actions only). Findings are derived from the workflow definition itself
  (`extractResolvedWorkflowFacts`); 0775 retired the suppression snapshot, so every finding is
  reported — none are suppressed. The advisory never changes exit status and is not part of
  `spur-check` / `spur-check-new`.
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
- `continue [run-id] [--yes]` — resume a paused (HITL) run (E3, design §6 / D04). Omit `run-id` to
  discover the most-recent paused run and confirm (skipped with `--yes`). With a recorded launch
  source (0784 R1), resume replays that exact recorded file from the recorded launch workdir — a
  missing recorded source refuses rather than resolving a same-named replacement; pre-pin rows
  resolve by `workflow_name` with an explicit degraded-identity warning (0784 R2). Checkpoint
  freshness validates in the launch workdir; associated checkpoints must project a nonterminal
  engine state (`pending`/`running`/`approved`). Then `resumeRun`. Works for both lifecycle and
  pipeline runs; exit 1 if no paused run, the run isn't paused, or it doesn't resolve to `done`.
  (A state pauses when it declares `pause: true`; the workspace schema supports `pause`.)
- `cancel <run-id>` — mark a single non-terminal run failed; SIGTERM the worker process group when live. Idempotent: already-terminal runs report no change. Bulk/stale variant is `clean`.
- `list` — list available workflow YAML files across project (`.spur/workflows/`) and global
  (`~/.config/spur/workflows/`) layers, grouped by source.
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
