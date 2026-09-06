---
doc: 04_DESIGN
owns: SURFACE — every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 1.68.0
derived_from: [03_ARCHITECTURE, codebase]
owner: Robin Min
updated_at: 2026-09-06
read_before: changing a command, flag, env var, or schema
edit_rules: 99 §6.5
sync: [T3, T9]
---

# 04 Design — Spur

The external, user-facing design surface: every CLI command, the config schema, and the persisted
data shapes. Feature-internal design lives in code.

## UI/UX boundary & DESIGN.md

Repository-root `DESIGN.md` owns all UI/UX design documentation (industry standard visual language, color tokens, typography, component specs, accessibility, and responsive patterns). Read and update it for UI work; keep `docs/04_DESIGN.md` focused on non-UI surface design by default. If `DESIGN.md` is absent, ignore it and follow the project's established UI conventions.

By contrast, `docs/04_DESIGN.md` is our SSOT of non-UI surface design by default — covering CLI command signatures, flags, config schemas, DTOs, tables, and system boundaries.

When collaborating with the design team:

- **UI/UX & Visual Design:** Refer to and update repository-root `DESIGN.md`.
- **Non-UI Surface & API/Schema DTOs:** Refer to and update `docs/04_DESIGN.md` (and `docs/design/<slug>.md` satellites).

## 0. Design satellites (`docs/design/`)

- [`essential-workflow-checks.md`](design/essential-workflow-checks.md) — D61 explicit corpus audit,
  baseline retirement and shared workflow plan/version contracts (implemented).

| Satellite                                                                                               | Area                                                                                                                                                                                                                                                                                                                      | Status                                                                                                                                                          |                                                                                                                               |             |
| ------------------------------------------------------------------------------------------------------- | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------                                                                                                                     | -------------------------------                                                                                                                                 |                                                                                                                               |             |
| [`rd3-migration-design.md`](design/rd3-migration-design.md)                                             | Planning layer (`spur task`/`spur feature`) — schemas, lifecycle, corpus migration (ADR-020–023)                                                                                                                                                                                                                          | finalized; surface in §1.x / §7                                                                                                                                 |                                                                                                                               |             |
| [`server-side-adjustment-design.md`](design/server-side-adjustment-design.md)                           | Server/Web slice — ServerContext, runtime-safe imports, EventBus/JobQueue/Scheduler wiring, oRPC surface                                                                                                                                                                                                                  | design (in progress)                                                                                                                                            |                                                                                                                               |             |
| [`server-side-adjustment-feature-finalized.md`](design/server-side-adjustment-feature-finalized.md)     | Server/Web — finalized feature decisions for the above                                                                                                                                                                                                                                                                    | finalized                                                                                                                                                       |                                                                                                                               |             |
| [`spur-team-mode-design.md`](design/spur-team-mode-design.md)                                           | Team mode — agent specs, inbox, `TeamService`                                                                                                                                                                                                                                                                             | design                                                                                                                                                          |                                                                                                                               |             |
| [`workflow-observability.md`](design/workflow-observability.md)                                         | Workflow run observability plus D5's persisted progress projection                                                                                                                                                                                                                                                       | built (ADR-070)                                                                                                                                                  |                                                                                                                               |             |
| [`workflow-composition-contract.md`](design/workflow-composition-contract.md)                           | D5 workflow composition baseline, split state/evidence effects, structured gate execution, digest-bound proof, and consolidation contract                                                                                                                                                                                 | infrastructure built; proof finality pending (ADR-071, 0703/0704)                                                                                               |                                                                                                                               |             |
| [`workflow-shell-ownership.md`](design/workflow-shell-ownership.md)                                     | Shipped workflow shell-program ownership, including the wrap-up feature-sync extension plus trusted corpus-gate command (task 0625)                                                                                                                                                                                       | accepted; current through 0625                                                                                                                                  |                                                                                                                               |             |
| [`dev-plan-design-doc-generation.md`](design/dev-plan-design-doc-generation.md)                         | `/sp:dev-plan` design-doc step — design by default / `--skip-design` only, seam heuristic (ties lean design), satellite + index authoring (0124)                                                                                                                                                                          | implemented                                                                                                                                                     |                                                                                                                               |             |
| [`dev-agent-flag-and-dogfood-skill.md`](design/dev-agent-flag-and-dogfood-skill.md)                     | Dev execution surface — unified `--agent <inline\                                                                                                                                                                                                                                                                         | auto\                                                                                                                                                           | name>` selector, interactive task-pipeline host driver (0503), named escalation triggers, and `sp:dogfood-testing` extraction | implemented |
| [`agent-inline-host-session.md`](design/agent-inline-host-session.md)                                   | *(historical)* G5-era contract — explicit `inline` as a hard host-session-only guarantee with frozen-message rejection; **superseded by ADR-087 / task 0687**: inline is the default selector, native-subagent eligibility covers all inline resolutions, and headless surfaces substitute tier resolution with a warning | superseded (0687)                                                                                                                                               |                                                                                                                               |             |
| [`dev-command-argument-contract.md`](design/dev-command-argument-contract.md)                           | `/sp:dev-*` argument surface — syntax-only hints, command-local flag/default tables, full-surface semantic parity (H81; ADR-032 amendment)                                                                                                                                                                                | implemented                                                                                                                                                     |                                                                                                                               |             |
| [`e2e-workflow-for-system-development.md`](design/e2e-workflow-for-system-development.md)               | End-to-end workflow system for system development — pipeline architecture, design step auto-detection, HITL gate model, doc-sync boundary (0167)                                                                                                                                                                          | design                                                                                                                                                          |                                                                                                                               |             |
| [`portable-agents-harness-contract.md`](design/portable-agents-harness-contract.md)                     | `spur init` root `AGENTS.md` seed — complementary Spur/Superskill ownership, portable routing, conditional root `DESIGN.md`                                                                                                                                                                                               | implemented                                                                                                                                                     |                                                                                                                               |             |
| [`feature-tree-status-affordance.md`](design/feature-tree-status-affordance.md)                         | Board Features tree — icon-only leading status indicator, accessible-name contract, glyph silhouettes, semantic-token convergence (ADR-034, feature R2)                                                                                                                                                                   | implemented                                                                                                                                                     |                                                                                                                               |             |
| [`feature-action-progress-transparency.md`](design/feature-action-progress-transparency.md)             | Features detail action progress — F83 job-queue runner, queue.job.\* SSE correlation, floating progress layer (implements F81/0352–0354)                                                                                                                                                                                  | design                                                                                                                                                          |                                                                                                                               |             |
| [`feature-check-strict-ac-satisfaction.md`](design/feature-check-strict-ac-satisfaction.md)             | `spur feature check --strict` — verdict-backed AC satisfaction and malformed-artifact diagnostics (0340/0410)                                                                                                                                                                                                             | implemented                                                                                                                                                     |                                                                                                                               |             |
| [`lifecycle-projection-integrity.md`](design/lifecycle-projection-integrity.md)                         | Feature sync/roster convergence, explicit refresh breadth, wrap-up corpus observation, and task/feature projection-content findings (0625; 0688 widened the subject-match window)                                                                                                                                         | implemented (0625, 0688)                                                                                                                                        |                                                                                                                               |             |
| [`history-data-processing.md`](design/history-data-processing.md)                                       | History data plane — importer vs Board catalogs, checkpoint/ledger truth, Q1–Q10 query map, single rollup-refresh choke point, five-tab/eight-path latency matrix, canonical skill allocation, stale fallback, accounting boundary (E9/0632–0633)                                                                         | implemented (0632–0633)                                                                                                                                         |                                                                                                                               |             |
| [`history-importer-arguments-provenance.md`](design/history-importer-arguments-provenance.md)           | Tool call arguments extraction, source JSONL transcript mapping matrix, missing-payload root cause taxonomy, 5-step diagnostic procedure, and config-driven syntax highlighting contract (E9/History Forensics)                                                                                                             | accepted design (2026-09-01)                                                                                                                                    |                                                                                                                               |             |
| [`history-refresh-process-isolation.md`](design/history-refresh-process-isolation.md)                   | History refresh — child-process execution, shared producer path, pending-or-processing SQLite single-flight, queue payload and Board outcome contracts (ADR-101, feature E31)                                                                                                                                             | accepted; built (tasks 0716–0717)                                                                                                                                  |                                                                                                                               |             |
| [`history-incremental-materialization.md`](design/history-incremental-materialization.md)             | History incremental materialization — refresh watermark vs turn watermark, bucket-scoped rollup refresh, append-only dedup invariant, per-table freshness, day-grain dimension/KPI tables, persisted `effective_tool_name`, UI-unchanged diff gate, bounded loop-findings/ranked-steps/source-stats derivations and v4 re-audit corrections (ADR-103, feature E91; 0741 + 0763)                        | implemented (0741, 0763; definition v4)                                                                                                                           |                                                                                                                               |             |
| [`project-switcher.md`](design/project-switcher.md)                                                     | Multi-project Spur Board switcher — registry, serve lifecycle, switcher UI (K1)                                                                                                                                                                                                                                           | design                                                                                                                                                          |                                                                                                                               |             |
| [`inbox-board-module.md`](design/inbox-board-module.md)                                                 | Inbox Board module — shipped unified timeline (M4/0422); accepted message-only boundary under G3 (ADR-052)                                                                                                                                                                                                                | transition design                                                                                                                                               |                                                                                                                               |             |
| [`workflow-run-log.md`](design/workflow-run-log.md)                                                     | Consolidated per-run workflow run log — all-in-one `.spur/run/RUNID.log`, retain-by-default + `--no-log`, `clean` log retention, `trace --follow --output` source (D2; ADR-045)                                                                                                                                           | built                                                                                                                                                           |                                                                                                                               |             |
| [`brainstorm-workflow-observability-steering.md`](design/brainstorm-workflow-observability-steering.md) | Brainstorm — tiered `spur workflow run` output, richer lifecycle/execution events, `--json` machine mode, steering axes (0114/0310 foundation)                                                                                                                                                                            | brainstorm                                                                                                                                                      |                                                                                                                               |             |
| [`workflow-steering-control-channel.md`](design/workflow-steering-control-channel.md)                   | Cross-process workflow steering control channel — durable command record, CAS-versioned, remote/detached steering (ADR-035 keeps the EventBus read-only)                                                                                                                                                                  | proposed design only                                                                                                                                            |                                                                                                                               |             |
| [`board-ui-layout-and-global-agent-bar.md`](design/board-ui-layout-and-global-agent-bar.md)             | Spur Board shell — default-folded 48px rail, sidebar utility footer, module order/nomenclature/tooltips, responsive layout hierarchy, and the global orchestrator agent bar mounted by `BoardLayout` (feature A7, tasks 0778–0780) | implemented (0778–0780)                                                                                                 |                                                                                                                               |             |
| [`workspace-design.md`](design/workspace-design.md)                                                     | Workspace Board module — team-scoped composition over existing Teams, Inbox, and Tasks surfaces (ADR-052, feature G3)                                                                                                                                                                                                     | built                                                                                                                                                           |                                                                                                                               |             |
| [`plugin-surface-parity.md`](design/plugin-surface-parity.md)                                           | `sp:spur-cli` facade / `sp:spur-dev` spine / AGENTS.md noun-table parity harness against the live monorepo CLI (ADR-053/054, feature I2)                                                                                                                                                                                  | implemented                                                                                                                                                     |                                                                                                                               |             |
| [`actionable-observability-context.md`](design/actionable-observability-context.md)                     | Versioned System Event envelope and projection paths, including J9 derived-presentation reprojection (ADR-056/067)                                                                                                                                                                                                        | J5 implemented; J9 built (0601/0602); J91 built (0605)                                                                                                          |                                                                                                                               |             |
| [`system-events-human-table.md`](design/system-events-human-table.md)                                   | System Events table-legibility contract — human SUMMARY/CORRELATION/ACTION, Agent column, optional presentation keys (ADR-073/074, feature J91)                                                                                                                                                                           | built (0605)                                                                                                                                                    |                                                                                                                               |             |
| [`inter-agent-control-plane.md`](design/inter-agent-control-plane.md)                                   | Occupant identity, coordination-facing run artifacts, pinned wait, caller env (ADR-057, feature G4)                                                                                                                                                                                                                       | waves 1–2 landed (0529/0530); wave 3 follow helper landed (0531); `--spec` carrier + executor-binding rewrite landed (0537/0542); first-class `blocked` remains |                                                                                                                               |             |
| [`dev-spine-cost-and-drift.md`](design/dev-spine-cost-and-drift.md)                                     | `/sp:dev-*` spine cost attribution from history data, prefix-cache breakers, `feature`/`agent`/`workflow` drift table vs I2/I3, ranked fix path (feature I6, task 0594)                                                                                                                                                   | measurement + inventory (analysis only)                                                                                                                         |                                                                                                                               |             |
| [`event-tracking.md`](design/event-tracking.md)                                                         | System Event 5W1H + semantic presentation SSOT — 71-event audit, J9 presenter matrix, planning/workflow producer contracts, two-sided gate (ADR-066/068)                                                                                                                                                                  | audit current; J9 built (0601/0602); J91 built (0605)                                                                                                           |                                                                                                                               |             |
| [`run-record-contract.md`](design/run-record-contract.md)                                               | Two-file run record (`<RUNID>.md` append-only + `<RUNID>.state.json` cache), `.spur/run` artifact-kind disposition, mid-run reader inventory, retention proposal, Observability read plane (feature I6, task 0598)                                                                                                        | contract specified; build deferred                                                                                                                              |                                                                                                                               |             |
| [`board-module-boundaries.md`](design/board-module-boundaries.md)                                       | Workspace / Inbox / Teams responsibility boundary under the agent-role mechanism — overlap evidence, per-module disposition, target IA, `role`-noun recommendation (feature I6, task 0599)                                                                                                                                | boundary spec; dispositions are recommendations                                                                                                                 |                                                                                                                               |             |
| [`history-board-module.md`](design/history-board-module.md)                                             | History Board — seven-procedure oRPC seam, live indexed reads, additive Summary/Sources telemetry, and six-tab module (feature E8 / 0626–0630, 0634–0638; Tool Using tab feature E81 / 0724–0725) | built (0626–0630, 0634–0638)                                                                                                                                    |                                                                                                                               |             |
| [`history-board-tool-using-tab.md`](design/history-board-tool-using-tab.md) | History Board **Tool Using** tab — `history.getToolSequence` seam, bounded tool-invocation stream, server-side filters, derived-share token accounting, and the inspection drawer (feature E81 / 0724–0725) | built (0724–0725) |                                                                                                                               |             |
| [`observability-frontend-enhancement.md`](design/observability-frontend-enhancement.md)                 | Observability Board — unified History-aligned header, customizable/sortable event table, consolidated tabs, and refined cell ergonomics (feature J92 / 0651–0654)                                                                                                                                                         | built (0651–0654)                                                                                                                                               |                                                                                                                               |             |
| [`harness-surface-governance.md`](design/harness-surface-governance.md)                                 | Composition measures, four-surface script placement, and dated ADR-051 consent applications (feature A3/0613; feature-refresh breadth/0625; workflow show --format/--json/0695)                                                                                                                                                                      | authority landed; current through 0695                                                                                                                          |                                                                                                                               |             |
| [`features-board-layout-refactor.md`](design/features-board-layout-refactor.md)                         | Features Board — History layout alignment, collapsible tree/metadata panels, markdown width constraints, dynamic action bar, and floating agent prompt bar (feature F84)                                                                                                                                                  | design                                                                                                                                                          |                                                                                                                               |             |
| [`universal-config-loading.md`](design/universal-config-loading.md)                                     | Composition-root merged-config wiring — single load threaded to all consumers, role-fallback provenance, agent-surface `--json` error envelope (ADR-082, ADR-078 amendment, feature A5)                                                                                                                                   | built                                                                                                                                                           |                                                                                                                               |             |
| [`agent-doctor-inspection-surface.md`](design/agent-doctor-inspection-surface.md)                       | `spur agent doctor` inspection contract — capability-tier table, full eligible ladder per role, pinned-model column, auth-probe removal (and its `doctor.probe` classifier), opt-in `--probe-health`, cached detection with `--force-refresh` (feature B4)                                                                | accepted design                                                                                                                                                 |                                                                                                                               |             |
| [`tasks-module-shell-parity.md`](design/tasks-module-shell-parity.md)                                   | Tasks Board — History-parity shell: one-row header, inline filters, append-only tabs, full-bleed density, enriched cards, board-owned folder store (ADR-081, feature F72)                                                                                                                                                 | verified (0663/0664; 2026-08-25)                                                                                                                                |                                                                                                                               |             |
| [`history-anatomy.md`](design/history-anatomy.md)                                                       | History-anatomy diagnostic — daily/ad-hoc report mode, closed finding taxonomy, twelve-section report contract, cache branch + semantic digest (ADR-079/080), atomic publication, HA-S1 issue-finding migration gate (feature I8 / 0657–0661)                                                                             | built (0657–0661)                                                                                                                                               |                                                                                                                               |             |
| [`environment-improvement-lens.md`](design/environment-improvement-lens.md)                             | Environment-improvement lens — plugin-level mapping SSOT, dogfood §6 optional class tags, history-anatomy closed-category keys + section 9 projection, present-don't-apply (ADR-084/085, feature I9)                                                                                                                      | built                                                                                                                                                           |                                                                                                                               |             |
| [`session-review.md`](design/session-review.md)                                                         | `/sp:dev-review-session` + `sp:session-review` — inline current-context evidence, compact five-section report, proposal-only improvements (ADR-089)                                                                                                                               | built                                                                                                                                                           |                                                                                                                               |             |

> Filenames retain `-design`/`-finalized` suffixes (stable grep anchors referenced across task/plans
> history); the bare-`<slug>.md` convention (§4.5 rule 2) applies to **new** satellites. See
> constitution §8 lesson (2026-06-18).

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

### 1.1 Committed product commands

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
project. Re-running is blocked (exit 1) unless `--force` is given, preventing a stray `init` from
clobbering a configured project. `--json` emits
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
  ownership (task 0312; [portable contract](design/portable-agents-harness-contract.md)). Existing
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
name is resolved as a legacy coding-agent binary. Collision precedence: when an executor and an
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

#### `spur agent list [--json] [--specs]`

Detect installed agents; prints `ok|missing <name> [version]`. Backed by `ts-ai-runner`
`AgentDetector` / `DISPLAY_ORDER`. Canonical agents (0.4.8+): `claude`, `codex`, `gemini`, `pi`,
`omp`, `opencode`, `antigravity-cli`, `openclaw`, `hermes`, `grok` (`antigravity` is a deprecated
alias of `antigravity-cli`). With `--specs`, lists the team agent specs under `.spur/agents/` instead
(`<id> <type> <role> <executor> <purpose>` — role and executor are distinct columns; an undeclared
role renders `unset`, 0544 R2/R4; `--json` includes the spec path plus `role`/`executor` fields,
omitted when unset).

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
`roles`, and `elected`; a full-set run adds `cache: {hit, ageMs, path}` — detection results are cached for
60 s at `.spur/run/agent-doctor.json` keyed by an executor-set fingerprint (name/agent/model/tier), served
only on an exact fresh match, and corrupted/stale/unwritable states degrade silently to a live run; text
mode prints a dated footer note on a hit; `--probe-health` never reads or writes the cache and
`--force-refresh` skips the read, re-runs detection live, and rewrites the file. Under a role selector,
entries are ordered elected-first then resolution order (`agents[0]` is the electee). Auth is neither table column nor surfaced shape (liveness-only gate,
ADR/0127). For **grok**, liveness is tri-state from `XAI_API_KEY` and/or non-empty `~/.grok/auth.json`
(no CLI auth-status verb). Exit 1 if any **tier-1** agent is not usable. Backed by `ts-ai-runner` `DoctorRunner`.
Selector precedence inside the arg: exact executor/agent name first, role id second.

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

#### `spur message send --to <id> <body> [--from <id>] [--wait] [--until injected|invoke-exit] [--timeout <ms>] [--json]` · `spur message inbox --agent <id> [--json]` · `spur message reply <msg-id> <body> [--json]` · `spur message watch --agent <id> [--interval <ms>] [--json]`

Durable inter-agent messaging over the SQLite `inbox_messages` table (backed by `TeamService` →
`ts-ai-runner` `MessageService` → `ts-db` `InboxMessageDao`).

- `send` — enqueue a message; `--from` defaults to `operator`. Prints `queued <id> → <to>`.
  `--wait` / `--until` / `--timeout` are documented with `agent wait` above.
- `inbox` — list messages addressed to `--agent` (`<id> <status> <from> <body> <createdAt>`); reports
  "No messages" when empty.
- `reply` — look up the original message, address the reply back to its `from_id`, and thread it via
  `in_reply_to`. Rejects an unknown id, or an operator-originated message (null sender) with no peer.

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

#### `spur workflow show <workflow.yaml> [--format <mermaid|todo>] [--json]` · `spur workflow validate <workflow.yaml> [--json] [--no-schema]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--detail <minimal|invocation|full>] [--quiet|--silent|--verbose] [--trace-file] [--steer] [--no-log] [--json]` · `spur workflow continue [run-id] [--yes] [--answer <yes|no|cancel>] [--json]` · `spur workflow cancel <run-id> [--json]` · `spur workflow list [--json]` · `spur workflow trace [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--follow] [--poll <ms>] [--output] [--json]` · `spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]`

> **Shipped surface (ADR-045 / feature D2, tasks 0426–0429):** `run --no-log` opts out of the
> consolidated `.spur/run/<RUNID>.log` (retained by default otherwise); `trace --follow --output`
> streams that log as a tail -f-equivalent source and is rejected with `--json`; `spur workflow
clean` reclaims retained logs older than `workflow.logRetentionDays` (default 30 days). Shapes:
> [`design/workflow-run-log.md`](design/workflow-run-log.md).

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
  `.spur/runs/workflow/<run-id>.jsonl` and propagates to the detached child. `--steer` enables
  synchronous in-process `continue|note|retry|abort` commands at an action's declared
  `steeringBoundary`; it conflicts with `--json` and `--async`, and retry additionally requires an
  explicit idempotent `retryPolicy`. `--no-plan` remains orthogonal. Mechanism, backpressure, redaction,
  and control boundaries:
  [`design/workflow-observability.md`](design/workflow-observability.md).
  `--async` starts the run in a detached background process and returns the run id immediately.
- `continue [run-id] [--yes]` — resume a paused (HITL) run (E3, design §6 / D04). Omit `run-id` to
  discover the most-recent paused run and confirm (skipped with `--yes`). Resolves the run's
  `workflow_name` back to its YAML, then `resumeRun`. Works for both lifecycle and pipeline runs;
  exit 1 if no paused run, the run isn't paused, or it doesn't resolve to `done`. (A state pauses when
  it declares `pause: true`; the workspace schema supports `pause`.)
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

#### `spur history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--source-timeout <ms>] [--json]`

Import agent conversation JSONL. `--source` ∈ {pi, claude, codex, gemini, opencode, antigravity,
openclaw, omp, grok, agy, **all**} (default `all`). `--mode` ∈ {full, incremental, force-file}
(defaults: `incremental` for root scans, `force-file` when `--file` is given). Reports scanned files,
processed lines, imported/duplicate records, parse/validation errors. Backed by
`ts-llm-jsonl-importer`.

**Provenance header (task 0504 R4):** every invocation prints a `binary:` line (the actually
invoked entry path — source-local `bun run apps/cli/src/index.ts` / built `spur.js`, or the stale
global `spur` that the header exposes) plus the resolved `@gobing-ai/ts-llm-jsonl-importer@<version>`
before the fan-out result; `--json` embeds the same `provenance` field (`{ binary, importer }`) in
the payload. Real-data history validation must run a source-local binary — never a bare global
`spur` — and record the header before each dry-run/write.

**Importer provenance guard (task 0726 R1):** importer releases below `0.4.49` (before ts-libs
commit 96762d5) silently collapse `history_tool_call.args_raw` on pi imports to the todo-tool
argument's first line, destroying bash-command evidence. `HistoryService` therefore asserts
provenance (0726 R1) before any database access on **non-dry-run full imports that include the
`pi` source**: the CLI resolves the installed importer version via `resolveImportProvenance` and
passes it into `HistoryServiceContext.importerVersion` at construction; `assertPiImporterSafe`
(in `history-service.ts`, shared by `import` and `importAll`) rejects versions that fail a strict
`MAJOR.MINOR.PATCH` parse — unknown, malformed, and prerelease values are unsafe by definition —
or that compare below `MIN_SAFE_PI_BASH_IMPORTER_VERSION` (`0.4.49`). Rejection throws
`UnsafeHistoryImporterError` (`code: 'unsafe-history-importer'`, carrying installed and minimum
safe versions plus the upgrade/relink remedy naming commit 96762d5) before the database opens or
the importer runs; the CLI renders it as a structured `--json` error (`details.cliCode`) with
exit 1. Dry-run previews and append-scoped modes (`incremental`, `force-file`) are unaffected.

**Fan-out (task 0470):** `--source all` iterates every known source in `SOURCES` order, each in its
own `try` with its own transaction — a throwing or timing-out source is caught, recorded
`status: 'failed'` with its error, and the loop continues; one source can never abort another. A
source that discovers zero files is `status: 'empty'`, never `ok`; a source with checkpoint rows but
zero files now emits a `source-was-nonempty` warning. `--source-timeout <ms>` bounds each source
(default **600000** = 10 min); a source exceeding it is abandoned at its deadline and recorded
`failed`. A single `--source <x>` is the n=1 case of the same contract — there is never a second
import path.

**Degraded status (task 0504 R2):** a source that imported records while skipping malformed or
schema-invalid ones is `status: 'degraded'`, never clean `ok` — parse/validation error counts are
no longer the only signal. The degraded entry carries a `source-degraded` warning with counts, and
bounded file-and-line samples stay in the artifact (overflow to the `.errors.jsonl` sidecar).

**Reconciliation pass-through (task 0505 R1):** on `--mode full` with importer 0.4.25+, each JSON
entry carries the importer's optional `reconciliation` summary (`{ staleTargetRows,
staleLedgerRows, staleCheckpointRows }`) — additive, absent on incremental runs — so a dry-run
preview and its write can be compared count-for-count without manual SQL.

**Single-file full-write guard (task 0506 R2):** `--file <path> --mode full` **without** `--dry-run`
is rejected at the CLI boundary (exit 1) before any database access — full mode treats the file as
the authoritative input for a reconciliation of the real repository DB, which is only safe for an
all-source/source-root full write. The error names both alternatives: add `--dry-run` to preview,
or use `--mode force-file` to import one file. `--file --mode full --dry-run`, `--file --mode
force-file`, and all-source/source-root full writes are unchanged.

**Exit-code contract (R3, amended 0504 R2) — replaced the old "exit 1 if any errors":** `0` every
source ok/empty, `2` at least one failed **and** at least one not (or any source `degraded`), `1`
every source failed. A source is `failed` only if it threw or hit its timeout. Before 0504, parse
and validation errors were counts only (deliberate loss of "parse errors ⇒ exit 1", which under
fan-out cannot distinguish one noisy source from six dead ones); 0504 restores the loud signal for
skipped records at the source level — `degraded` status + non-zero exit — while keeping per-source
isolation intact. The compensating signals remain the artifact's error counts and the `history.*`
events.

##### Assistant-step duration provenance — `duration_source` (task 0702 R2, T3)

Four of six sources (`claude`, `pi`, `codex`, `agy`) write no per-step `duration_ms`, so
bottleneck ranking and per-model latency were unusable for the two busiest of them and roughly
73% of the measured span could not be attributed to llm/tool/idle. The provider-side fix lives
upstream in `@gobing-ai/ts-llm-jsonl-importer` and costs a lockstep family bump plus a publish;
the transcripts already carry a per-record `ts`, so the ETL derives the value instead.

**Frozen name.** `history_message.duration_source` (migration
`0026_spur_cli_history_message_duration_source`), a nullable `TEXT`:

| Value | Meaning |
| --- | --- |
| `NULL` | `duration_ms` is the provider's own measurement, or the step has none |
| `'derived'` | `duration_ms` is an ETL timestamp delta — includes queue and network time |

**Derivation.** `deriveAssistantDurations()` (`packages/domain/src/analytics/assistant-duration.ts`)
runs once per non-dry-run `history import`, after `alignMessageProvenance()`. For each `assistant`
row with a valid `ts` and no `duration_ms`, it takes the delta to the preceding record in the same
`(source, session_id)` by `seq`, at exact millisecond resolution
(`unixepoch(ts, 'subsec')` — the `julianday` form loses ~1ms to double-precision rounding).

Three rules keep the number honest, each pinned by a test in
`packages/domain/tests/analytics/assistant-duration.test.ts`:

- **A provider value always wins.** The `UPDATE` re-asserts `duration_ms IS NULL`, so the pass is
  additive and idempotent; re-running after a later import only fills rows it could not reach.
- **A session gap is never billed as work.** Deltas above `DERIVED_DURATION_CEILING_MS` (30 min)
  stay unmeasured — attributing an overnight gap to a step would corrupt the ranking this exists
  to make usable.
- **Absent is not zero (0680 R6).** A non-positive delta (shared timestamp, out-of-order records)
  leaves the row unmeasured rather than writing `0`.

**Reporting contract.** `stepSupport` carries `stepsWithDerivedDuration` alongside
`stepsWithDuration`, and the forensics **Section Support** table's Time column reads `yes`
(provider), `derived` (ETL only), `yes (mixed)`, or `no`. A derived value is not a weaker `yes` —
it measures something different, and a reader comparing latency across sources must be able to see
which is which. Nothing may present the two as the same measurement.

**Not a backfill of history.** Rows imported before the migration gain their derived value on the
next `history import`, not through a one-time migration pass; until then they render as unmeasured
(never as zero).

#### `spur history daily [--since <iso>] [--until <iso>] [--root <path>] [--source-timeout <ms>] [--mode <name>] [--json]`

Run-once daily pipeline (task 0470 R6): **import-all → analyze → write artifact → prune** reports
older than 90 days (`REPORT_RETENTION_DAYS`), in a single process that exits when done — never stays
resident (a resident schedule belongs to 0471's launchd agent, not Spur's embedded scheduler). The
**import** step takes no date window and runs `--mode incremental` on every source, relying on
checkpoint resume (R7): a missed night self-heals on the next run with no gap and no double-count.
Only the **analyze** step scopes the report via `--since`/`--until`. `--root <path>` overrides the
per-source history roots (test seam; default is each source's platform dir). `--json` emits the
structured `DailyResult` (`{ fanOut, artifact, pruned, coverage }`). Exit code follows the fan-out import
outcome (0/1/2), so `history.daily.failed` and the exit agree. `coverage` (task 0550, R3/R4) is the honest
coverage report `{ refreshed, skipped, window }`: `refreshed` names the full-fidelity sources this refresh
imported (claude, codex, pi, omp, agy, grok), `skipped` names the unsupported sources deferred by the
2026-08-06 operator ruling (gemini, opencode, antigravity-ide, openclaw, hermes), and `window` carries the
MIN/MAX message `ts` the analyze covered (`{ since, until }`) so a reader can tell current data from stale
without inspecting the database. A failed full-fidelity source drops out of `refreshed` (surfaced via
`fanOut`/exit code) rather than being silently counted as refreshed.

**`--mode <name>` (task 0555 R4) is a pure pass-through:** when set, `daily` additionally writes a
`.md` sidecar next to the artifact rendered in that report mode (`reportPath` in `DailyResult`,
`report:` line in the human output). The mode is validated up front — an unknown name fails before
the import fan-out runs. Daily's composition (per-source isolation, checkpoint self-heal, 90-day
pruning) is untouched; without `--mode`, behavior is unchanged.

**Operation-triggered refresh (feature E3, tasks 0549–0550).** Completing a task (`spur task update <wbs> done`) or a non-dry workflow run (`status: done`) enqueues a `history.refresh` job on the embedded job queue when `history.refresh.on_completion` is `true` in `.spur/config.yaml`. The key is **opt-in and defaults off**. Completions inside `history.refresh.debounce_ms` (default **600000**) join one pending job and stretch its covered window — a burst produces one refresh, not N. The server queue handler does not call `HistoryService.daily` in-process: E31 (0717) executes `<invocation> --no-logo history daily` in an isolated child via `ProcessExecutor`, passing the validated payload through `SPUR_HISTORY_REFRESH_CONTEXT`; 0716's single-flight writer extends exclusion through `processing`. See [`history-refresh-process-isolation.md`](design/history-refresh-process-isolation.md).

**Periodic refresh (task 0750, replacing 0696).** There is no history-specific scheduling key. Recurring refresh is declared like any other periodic execution, as a `bootstrap.scheduler.jobs` entry running `history daily` (see *Scheduled jobs*, task 0734); `registerSchedulerEntries` no longer reads project config and registers only the prune and smoke built-ins plus the configured jobs. The retired `history.refresh.schedule_minutes` key is dropped from `HistoryRefreshConfigSchema`, and `HistoryRefreshTriggerConfig` no longer carries `scheduleMinutes`. `'schedule'` remains a valid `history.refresh` payload trigger value so rows persisted by the old path still validate, but nothing enqueues with it.

**Trade-off recorded at migration.** A configured job is a plain non-coalesced `scheduler.custom` enqueue, so a periodic refresh no longer shares the `enqueueHistoryRefresh` single-flight row with the completion trigger, and no longer inherits its `DATABASE_URL`/`resolveSpurBin` plumbing — the command's own `cwd` (project root) resolves the database. Coalescing and per-job env for configured jobs are open enhancements against the shared scheduler surface, not a reason to keep a second scheduling mechanism.

`DailyResult.coverage` is `{ refreshed, skipped, window: { since, until } }`. Analyze stamps `bySession[].sessionState` (`in-progress` | `complete`): a session whose last stored message is not an assistant turn is in progress, and derived aggregates clip to the last complete turn so a partial turn cannot fabricate totals. Re-analyzing a growing session replaces the previous `bySession` row (one record per session, not one per refresh). Events: `history.refresh.enqueued`, `history.refresh.completed`, `history.refresh.skipped` (disabled). No new CLI noun.

#### `spur history analyze [--since <iso>] [--until <iso>] [--source <s|all>] [--session <id>] [--run <runId>] [--task <wbs>] [--top <n>] [--out <path>] [--json]`

Aggregate imported history into forensic analytics and write a **versioned JSON artifact** (task 0474).
Aggregation is done in **SQL** over `history_message` / `history_tool_call` (the Q1–Q10 forensic query
set — per-step time/token cost, tool-call counts, repeated-call loop detection, unknown-disposition
drift) — never by loading the corpus into memory. Reads the contract tables populated by the six
converted sources (claude, codex, pi, omp, grok, agy) plus the generic ETL sources.

Six composable `AND` selectors, each resolving against an indexed column: `--since`/`--until`
(`history_message.ts`), `--source <s>` / `all` (`source`; `all` = no source predicate), `--session`,
`--run`, `--task` (task-only selection resolves through the mapping authorities — the
`task_run_links` → `history_run_session` run chain plus the direct `history_task_session`
attribution recovered at import (task 0722) — never through `run_id`/`task_wbs` message columns,
which are reserved for boundary promotion; task+run selection intersects through the run chain), and `--top <n>` (default 20; bounds `bySession`/`byTool` only — never
`totals`/`bySource`/`byModel`/`daily`).

Artifact: `.spur/reports/history/<YYYY-MM-DD>/analyze-<selectorDigest>.json` where `selectorDigest` is
the first 8 hex of sha256 over the canonicalized selector (stable for the daily loop). `--out <path>`
overrides; `latest.json` symlinks the newest artifact. `schemaVersion: 1`; additive fields do not bump
it. `coverage[].parseErrors`/`validationErrors` are **counts** plus at most 20 samples per source, with
full detail streamed to `analyze-<digest>.errors.jsonl` (R6). `recordsWithUsage` /
`durationUnmeasured` carry the never-fabricate invariant — a consumer renders `n/a`, never a
fabricated `0`. No artifact flags ⇒ human stdout summary (rendered from the artifact); `--json` ⇒ the
artifact shape.

**Watermark policy (task 0550, R1/R2):** a session still being written is analyzed only up to its **last
complete turn** — an assistant (non-meta) message with no open tool call closes a turn, and everything
after it is a possibly-incomplete trailing turn excluded from derived values. Each `bySession[]` row
carries an additive `sessionState: 'in-progress' | 'complete'` (absent ⇒ unknown for artifacts written
before 0550) so a consumer can filter to finished sessions; the state is output, never a new column.
Where "complete" is ambiguous for a source (no tool-call rows to inspect), the rule degrades to "last
message is assistant-like" — including `role='unknown'`/role-less rows, so imported role-less messages are
analyzed rather than zeroed. Pre-0550 behavior for complete sessions is unchanged — no data is excluded.

**Assistant response duration (task 0507 R2):** totals (`assistantDurationMs`,
`assistantDurationUnmeasured`) and per-session stats (`bySession[].assistantDurationMs` /
`assistantDurationUnmeasured`) aggregate the **measured** `history_message.duration_ms` from OMP
assistant responses — role-filtered to `role = 'assistant'`, additive, and distinct from tool-call
`durationMs`/`durationUnmeasured` (which remain computed only from `history_tool_call`). Missing or
non-finite durations count as unmeasured, never as zero. `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 —
the fields are additive.

**Derived variables (task 0554):** `analyze` additionally computes `derived` on the artifact via a
**MetricRegistry** (`packages/domain/src/analytics/derived.ts`) — an ordered list of `MetricFn`s run
after the SQL aggregation, each receiving `{ sessionSpans, sessionTools, todoCalls, results }` and
returning an additive key. Defaults: `phases` (todo-tool `args_raw` replay — per-session first
`in_progress` → first `completed` per todo name, `endedAt` falls back to the session's last todo-call
ts; sources without todo tools report `phaseSupport: 'unsupported'`), `timeDecomposition` (per-session
`llmMs` + `toolMs` + `idleMs`, with `unattributedMs` holding the remainder whenever any duration in
the session is unmeasured — the never-fabricate invariant extends to decomposition), and
`bottlenecks` (time buckets ranked desc by `ms`, `share = ms / spanMs`). `derived` is optional on the
artifact: old artifacts remain valid (`schemaVersion` stays 1), and sessions with no measured time
surface `derivedWarnings[]` (`derived-unattributed-time`) instead of zeros. Metric inputs come from
three new forensic queries (`sessionSpans`, `sessionToolDurations`, `todoToolCalls` — the latter
reading the 0012 `args_raw` column) alongside the existing SQL set; registry metrics never load the
corpus into memory.

#### `spur history reset --yes [--json]`

Destructively wipe every `history_*` table in one atomic batch: normalized rows
(`history_message` / `history_tool_call` / `history_run_session` / `history_task_session`), the ten
importer-created `history_etl_*` tables, all derived analytics (`history_daily_stats`, the ten
`history_board_*` rollups), and importer bookkeeping (`history_import_checkpoint` /
`history_import_ledger`). Requires `--yes`; without it the command refuses with exit 1. Task corpus
and run provenance (`task_run_links`) are untouched, so run-chain attribution re-resolves after a
full re-import. Unlisted `history_*` tables are reported (never silently deleted) in the
`unknown` result field. The canonical table list lives in
`HISTORY_RESET_TABLES` (domain `history-reset.ts`) with a drift-guard test asserting it covers
every migrated history table; a full `spur history import` + `analyze` rebuilds everything after a
reset.

#### `spur history report [path] [--mode <name>] [--task <wbs>] [--top <n>] [--json]`

Pure renderer of a previously-generated analyze artifact — never opens the database. Reads the
artifact JSON, asserts `schemaVersion === HISTORY_ARTIFACT_SCHEMA_VERSION`, then renders a stdout
spend rollup (reusing `formatSummary` via `artifactToSummary`) plus forensic sections the spend
summary cannot express: per-tool time/calls/result-bytes, detected loops, session leaderboard, and
per-source coverage. Writes a `.md` sidecar next to the artifact (same basename) so the morning read
needs no CLI invocation.

- `[path]` — explicit artifact JSON path. When omitted, resolves `.spur/reports/history/latest.json`
  (a symlink to the newest artifact, written by `analyze`). An explicit path wins (R6).
- `--json` — emit the parsed artifact shape instead of the human report.
- **Render-time narrowing (task 0564 R3):** `--task <wbs>` and `--top <n>` mirror `analyze`'s
  flags exactly and narrow the already-loaded artifact JSON client-side — the renderer never gains
  database access. `--task` renders only when the artifact's selector carried that task dimension
  (the artifact WAS analyzed with `--task <wbs>`; its buckets are that task's rows); an artifact
  with no task dimension, or one analyzed for a different task, exits 1 with a message naming the
  artifact id and the missing/mismatched dimension — never a silent unfiltered render. `--top`
  re-slices the `byTool`/`bySession` leaderboards to depth `n`. A narrowed render prints one banner
  line naming the applied filter and the artifact id.
- **Staleness banner (R7):** when the artifact is resolved via the `latest.json` pointer and is older
  than 36 hours, a `⚠ STALE ARTIFACT` banner prints before the report body — the daily loop may have
  stopped. Suppressed for explicit paths (the operator already knows the file's age).
- **Version gate (R4):** an artifact whose `schemaVersion` is not the one this renderer understands is
  refused with a clear message naming the path, the actual version, and the expected version; nothing
  else is emitted. Re-run `spur history analyze` to regenerate.
- **Never-fabricate (R5):** when a tool bucket has calls but every `duration_ms` was NULL
  (`durationUnmeasured === calls`), timing renders `n/a`, never `0` — the same convention
  `formatRatio` uses for unavailable cache-hit ratios.
- Rendering is pure (`packages/domain/src/analytics/render-report.ts`); the FS seam lives in
  `packages/app/src/services/history-service.ts` (`runHistoryReport`).

**Report mode registry (task 0555 R1):** rendering resolves through
`REPORT_MODES` (`packages/domain/src/analytics/report-modes.ts`) — a `Readonly<Record<string,
ReportRenderer>>` of pure `HistoryArtifact → string` functions. The registry **subsumes** the former
direct `renderReport`/`renderMarkdown` call path: `default` maps to `renderReport` (byte-identical
legacy output), `forensics` to `renderForensics`. `--mode <name>` (default: `default`) resolves via
`resolveReportMode`; an unknown name fails with `UnknownReportModeError` naming the registered set —
before any import or render work. Built-in TS renderers only: no template engine, no
variable-binding contract, no config surface (operator ruling 2026-08-09). `renderMarkdown` moved
into `report-modes.ts` and is mode-aware (fenced sidecar of the selected mode's body).

**Forensics renderer (0555 R2–R5):** `renderForensics`
(`packages/domain/src/analytics/render-forensics.ts`) renders the 8 sections task 0491 identified
as derivable from the artifact alone — Session Data Summary (incl. Tool Breakdown + Token
Profile), Time Decomposition, Per-Phase Breakdown, Per-Tool Execution Time, Bottleneck Ranking,
Raw Data. Tokens only, never currency (R3): no `$`/USD value appears, `MODEL_PRICING` gains no
consumer; cache efficiency renders as `cacheRead / inputTokens` ("share of billed input served
from cache", `n/a` when `recordsWithUsage === 0`). Missing derived inputs render honest
`not available` lines — artifact without a `derived` block (rerun `spur history analyze`) for the
three derived-dependent sections, `phaseSupport: 'unsupported'` for phases (R5). The 8 partial /
model-authored sections from 0491 are deliberately absent, not stubbed (task 0556).

**Per-step sections (task 0581, feature E5):** the analyze artifact gains three additive fields
(no schema bump, `schemaVersion` stays 1): `topStepsByTokens`, `topStepsByDuration`
(`StepStat[]` — raw `history_message` columns, nulls preserved), `cacheWaste`
(`{ steps, inputTokens, topSteps }`), and `stepSupport` (`StepSupportEntry[]` — per-source
support verdicts derived from assistant rows, never hard-coded). Queries Q11–Q14 are
`LIMIT ?`-bounded and watermarked like the Q1–Q10 set; Q13a is a single-row aggregate bounded
by `LIMIT 1`. `renderForensics` renders `## Per-Step Analysis` (between Per-Tool Execution Time
and Bottleneck Ranking) — `### Section Support`, `### Top Steps by Total Tokens`, `### Top Steps
by Duration`, `### Cache Re-Send Waste`. Tokens only (R3): `StepStat.costUsd` is unread. Cache
waste counts assistant steps with fresh input > 100,000 tokens and < 10 % cache reuse
(`CACHE_WASTE_MIN_INPUT_TOKENS` / `CACHE_WASTE_MAX_REUSE_FRACTION` in
`packages/domain/src/analytics/forensic-query.ts`); NULL cache reads never compare true, so
only measured low-reuse steps count. Pre-0581 artifacts state `not available` for all four
sections (R5), never zeros.

**True population + coverage rendering (HA-S1, ADR-080):** `analyze` records an additive
optional `population` block on `HistoryArtifact` (`SelectionPopulation` — sessions, tools,
loops, warnings, `appliedTop`; no schema bump) from unbounded `COUNT(DISTINCT …)` queries over
the active selector — never from the bounded leaderboard array lengths. `renderForensics`
renders the Sessions metric and the Raw Data Counts line through `fmtTopOf`: `top N of M` when
the applied depth is below the true population, the plain count when the whole population is
shown, and `not available` on a pre-HA-S1 artifact (never reconstructed from a bounded length).
The coverage table adds `Last imported` / `Parse err` / `Validation err`, marks sample overflow
`(truncated)` at the `MAX_ERROR_SAMPLES` cap, and warnings render one `code — detail` line per
warning instead of a code-only list. `narrowArtifact` re-slice (`report --top`) lowers
`appliedTop` to `min(requested, existing)` and leaves the population counts untouched.

**Verified-outcome projection (ADR-100, task 0712):** `HistoryArtifact.verifiedOutcome?`
(`VerifiedOutcomeStat`, additive, no schema bump; absent on pre-0712 artifacts and whenever no
task locator is configured — absence means unknown, never zero). The app derivation
(`packages/app/src/services/verified-outcome.ts`) gathers per-task evidence — `task_run_links`
⨝ `runs` (window-bounded population, hard row cap), the task-file corpus (frontmatter
`status`/`done_forced`, `## History` transitions via the shared `parseHistoryLine`, the
`## Testing` `Verdict:` line via the shared `parseVerdictLine`), and
`.spur/run/<wbs>-verdict.json` — and the pure domain fold
(`packages/domain/src/analytics/verified-outcome.ts`) applies the frozen R1/R2 definitions:
verified = done ∧ PASS artifact verdict ∧ proof digest present ∧ certifying run completed;
correction = verified task with a reopen transition or a superseding failed run. Rates null on
a zero denominator; time-to-verified folds first-wip→done spans; measured cost per verified
result uses exact run→session mappings only (estimated mappings and dollar figures unread, per
run-cost R3) and is `null` plus an explicit `costCoverage {covered,total}` pair — absence is
never coalesced to zero (R4). Exclusions land in `excludedReasons` by frozen reason. The
default report mode renders a `Verified outcome` section with `n/a` for unmeasured values
(R5); duplicate wbs rows dedupe (R8); `history analyze --json` carries the block unchanged.
`HistoryServiceContext.taskLocator` (wired in `apps/cli/src/commands/history.ts` from
`TaskLocator.forDirs`) gates derivation; derivation failure never fails the analyze batch.

**Pairings renderer (task 0574, feature J8 R2/R3):** `renderPairings`
(`packages/domain/src/analytics/render-pairings.ts`) — a pure `HistoryArtifact → string` mode
consuming ONLY the additive `pairings` / `ladderSnapshot` fields (0573); never opens the
database, never reads `.spur/config.yaml` at render time (the ladder arrives embedded in the
artifact), and never compares schema versions. Two sections: `## Pairings` — one ranked table
per role ordered success rate desc → total escalations asc → cost asc — and `## Ladder diff` —
per tier, the snapshotted config order vs the measured order, with `suggest: promote <executor>
above <executor> (dispatches=N, success=X% vs Y%, cost=$a vs $b)` lines for each adjacent
inversion. A rung totalling fewer than `MIN_PAIRING_DISPATCHES = 5` dispatches is marked
`insufficient-evidence (N<5)` and never suggested. Absence degradation mirrors the
`SessionStat.sessionState` precedent: a pre-0573 artifact renders `section unavailable (artifact
predates the pairings field; re-run spur history analyze)` in place of the missing section —
never a throw, never a fabricated row. Registered in `REPORT_MODES` as `pairings`; unknown mode
names keep failing with `UnknownReportModeError` naming the registered set.

**Report-first surface (task 0556, superseded 0661):** `/sp:dev-find-issue` was the report-first
entry over the forensics renderer + `sp:issue-finding`. **As of HA-S1 (0661) it is a thin forwarder
to `sp:history-anatomy`** with the reduced surface `[<focus>] [--mode <daily|ad-hoc>] [--date
<YYYY-MM-DD>] [--since <RFC3339>] [--until <RFC3339>] [--recompute] [--agent <inline|auto|name>]
[--output <path>]`; the fourteen legacy flags (`--full`, `--save`, `--source`, `--sessions`,
`--feature`, `--template`, `--priority`, `--severity`, `--category`, `--top`, `--min-cost`,
`--strict-topic`, `--create-task`, `--json`) are dropped, `/sp:dev-history-load` is deleted (its
independent import owners — `load-history` in `package.json` and the History UI Import & Analyze
path — are preserved), and the command never triggers an import. The legacy skill `sp:issue-finding`
remains packaged and directly invocable under the bounded coexistence and retirement gate in
`plugins/sp/README.md`; no logic is shared with the new skill.

**History-anatomy surfaces (HA-S1 0658/0660):** skill `plugins/sp/skills/history-anatomy/` owns
interpretation (mode contract, finding taxonomy, twelve-section report contract, `enrich`/`validate`
rubrics); workflow `config/workflows/history-anatomy.yaml` owns the cache branch, deterministic stage
ordering, a shared two-pass correction budget, and atomic publication — the cache/digest/structure/publish
determinism is `plugins/sp/scripts/history-anatomy-cache.ts` (+ committed `.mjs` twin, ADR-065
standard contract, ADR-079 digest-truth). Publication is reachable only from a passing validation
state; a hit reuses model enrichment only and refreshes `validated_at` + the imported-snapshot banner
without claiming a later import.

**Active-session review (ADR-089):** `/sp:dev-review-session [<focus>]` invokes
`sp:session-review` directly in the active host session. Focus changes ordering, not evidence
collection. The current conversation is the primary evidence plane; read-only repository checks
may confirm material claims. The compact report contains Outcome, a non-overlapping Time breakdown,
Resolved issues, Open issues and risks, Process and environment improvements, and Next actions.
Timing comes only from visible session evidence, renders as `M:SS` or `H:MM:SS`, separates operator
waits from execution bottlenecks, and uses `n/a` rather than estimates. It launches no workflow or
agent, imports no history, performs no baseline/cache/publication step, and mutates nothing.
Historical, cross-agent, recurrence, trend, and quantitative questions stay on
`/sp:dev-find-issue`.

**Artifact-digest ownership boundary (task 0669).** The semantic artifact digest and its ranked-
versus-set canonicalization rules live in **`packages/domain/src/analytics/artifact-digest.ts`**,
beside the `HistoryArtifact` type they canonicalize. The classification
(`ARTIFACT_ARRAY_CLASSIFICATION`) is type-derived: a recursive array-key type over the artifact plus
an exhaustive `Record<ArtifactArrayKey, 'ranked' | 'set'>` makes an unclassified new array field a
`tsc` error naming the field — order-as-evidence must be declared, closing the drift class that hid
`topSteps`/`bottlenecks` for months. The plugin script consumes this authority through a **generated**
copy (`plugins/sp/lib/artifact-digest.generated.mjs`, built by `bun run build:plugin-lib` and
committed) because ADR-065 forbids a monorepo import surviving into the script's `.mjs` twin;
consequently the domain module has exactly one consumer reached through a generated file, not an
import. Consequences that are deliberate: no hand-maintained enumeration of artifact array keys may
exist in `plugins/sp/scripts/`; the twin's bare-`node` fixture test (R2) backstops the twin-staleness
hole (script-contract-check compares mtimes only against the direct source); and
`REPORT_SECTIONS`/`FINDING_FIELDS` stay local to the script with `skill-structure.test.ts` requiring
`report-contract.md` to name every entry of both — full single-owner treatment of the report
vocabulary was deferred as it has never drifted.

**Helper verb surface and stage order (0659/0660, corrected 2026-08-25).** The helper's CLI is
`paths | probe | stamp | refresh | digest | check | publish` — every stage in the workflow is one
invocation of one of these (ADR-069 R1 glue length). Stage order is
`resolve-scope → resolve-paths → analyze → cache-probe → {hit: refresh-provenance | miss: render →
enrich → structure-gate → validate → stamp} → publish`. **`analyze` precedes `cache-probe`
deliberately:** ADR-079 makes validity a *derived* fact, so the semantic digest must come from the
fresh artifact, never from the cached report being judged. Publication is reachable only via `stamp`
(guarded on `Verdict: PASS`) or `refresh-provenance` (whose model half was itself published through
a passing validation).

**Frontmatter provenance block (0660 R7).** `stamp` writes, and `parseProvenance` reads back, the
full block: `identity` (contract version, mode, date, IANA timezone, normalized inclusive bounds,
sources), `windowState` (`provisional` until the local calendar day closes, then `closed`),
`generatedAt`/`validatedAt`, `artifactDigest` + `baselineArtifactDigest`, `contractDigest` /
`skillDigest` / `workflowDigest`, per-source `coverage` with `lastImportedAt`, `runId`,
`currentArtifactPath`/`baselineArtifactPath`, `spurVersion`, `schemaVersion`, `executor`, `model`,
and `cacheDisposition`. Audit fields round-trip through `parseProvenance` so a cache-hit republish
never strips them. A logic path that cannot be resolved digests to `not available` (which compares
equal to itself, so an unresolvable path degrades to "no invalidation signal", never a false match).
The banner renders the **earliest** per-source `lastImportedAt`, so the report never claims a source
was imported later than its own recorded timestamp.

#### History nightly loop — scheduling surface and observability (task 0471)

The daily pipeline runs on an **external macOS launchd agent**, not Spur's embedded scheduler. The
embedded scheduler needs a daemon the run-once CLI is not, and drives nothing under the CLI
(`bootstrap.scheduler.enabled = false`). An external supervisor is the only correct fit.

> **Amendment (2026-09-02, task 0734):** the *cron* half of this rationale is obsolete —
> `NodeSchedulerAdapter` now accepts real five-field cron, so `0 2 * * *` is expressible and no
> longer degrades to a 60-second interval. The decision stands on the remaining premise: the daily
> pipeline must run whether or not `spur serve` is up. An operator who *does* run the server can now
> express the same schedule as a `bootstrap.scheduler.jobs` entry instead (§5.2).

**Template:** `config/launchd/ai.gobing.spur.history.daily.plist` — `StartCalendarInterval` (daily
wall-clock), `WorkingDirectory` = project root, `StandardOutPath`/`StandardErrorPath` →
`.spur/logs/history-daily.out`/`.err`. Ship-as-template (not an installer verb): one plist + two
documented commands beat a Spur verb that must track macOS launchctl changes.

```bash
# Install (from the project root, after substituting SPUR_BIN and PROJECT_DIR in the template)
cp config/launchd/ai.gobing.spur.history.daily.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.spur.history.daily.plist

# Uninstall
launchctl bootout gui/$(id -u)/ai.gobing.spur.history.daily
```

**Rejected alternatives** (ADR recorded under task 0464 § R6): Spur's embedded scheduler (cannot
express daily cron, silent 60-s fallback); a `spur history install-schedule` verb (tracks launchctl
changes forever); a fifth detection layer or health-check verb (four already earn their place).

**System events (R1, R2).** Choosing an external scheduler makes the event ledger the only in-harness
evidence the loop ran. Three `history.*` events declared in `packages/app/src/services/event-names.ts`
emit from `apps/cli/src/commands/history.ts` (daily verb) via the existing
`attachSystemEventLedger(bus, context)` bridge:

| Event                       | Renderer          | When                                                        |
| --------------------------- | ----------------- | ----------------------------------------------------------- |
| `history.import.completed`  | `history-import`  | fan-out import finished (regardless of per-source failures) |
| `history.analyze.completed` | `history-analyze` | analyze + artifact write finished                           |
| `history.daily.failed`      | `history-daily`   | the daily command exited non-zero or threw                  |

All three are `metadata-only`, `default` tier — history payloads may carry `cwd`, file paths, and error
text quoting source content; `raw-safe` would persist that. The canonical envelope builder retains
only catalog-declared history metadata, excludes content-bearing fields, and redacts configured
secrets before bounds. `await ledger.flush()` runs in a `finally` on **both** the success and failure
paths — without it, a run-once process exits before the async inserts land, reproducing the exact
"0 rows" symptom this task exists to end.

**Four-layer missed-run detection (R5, R6).** No single layer is the sole signal:

| Layer                   | Signal                                           | Detects                                        |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------- |
| 1 — artifact freshness  | `latest.json` older than 36 h ⇒ staleness banner | the whole loop stopped                         |
| 2 — ledger events       | `history.*` rows present / absent                | started-and-failed vs never-started (R6)       |
| 3 — per-source coverage | `coverage[].status` per source                   | one source stopped while others kept working   |
| 4 — launchd error log   | `.spur/logs/history-daily.err`                   | failures before Spur's own logging initializes |

R6 is what layer 2 buys and layer 1 cannot: "no artifact" is ambiguous (launchd never fired vs the run
started and failed). A `history.daily.failed` row ⇒ it ran and failed; **no** `history.*` row in the
window ⇒ it never started. Both are checkable without reading the artifact, which by definition does
not exist in either case.

**Report reachability (R7).** The daily-summary surface (`plugins/sp/scripts/daily-summary/`) resolves
the `.spur/reports/history/latest.json` pointer and emits a `## History Report` section carrying the
newest artifact path — so a completed nightly run reaches the operator through the summary they already
open, with no new notification channel.

#### History completion-triggered refresh — coalesced enqueue on work completion (task 0549)

`spur history daily` is bound to a clock; this trigger binds a refresh to **work completing** so the
history DB reflects the burst of session activity a task pipeline just produced, without waiting for
the 02:00 nightly loop.

**Trigger points (exhaustive).** Exactly two, both terminal — never "every CLI invocation":

1. `spur task update <wbs> done` (task completion) — `apps/cli/src/commands/task.ts`.
2. `spur workflow run` / `continue` reaching a terminal status (pipeline-run completion) —
   `apps/cli/src/commands/workflow.ts`, at the sync completion path, the main sync run path, and the
   `continue` path. The `--async` launcher itself does **not** trigger — its worker does when the run
   completes.

**Config (`config/config.global.yaml`, `packages/config/src/index.ts`)** — explicit/opt-in, disable-able
with no code edits:

```yaml
history:
  refresh:
    on_completion: false   # default; set true to enable
    debounce_ms: 600000    # coalescing window, floor 1000 ms
```

Periodic (clock-driven) refresh is **not** configured here — it is a `bootstrap.scheduler.jobs`
entry like every other recurring command (task 0750):

```yaml
bootstrap:
  scheduler:
    enabled: true
    jobs:
      - name: history-refresh
        intervalMinutes: 10
        command: bun apps/cli/src/index.ts --no-logo history daily
```

The debounce default (600 000 ms = 10 min) follows task 0548's measured figures
(`docs/tasks4/0548-import-cost-measurement.md`: steady-state all-fanout import ≈ 20.6 s, recommended
coalescing window 10 min, floor 5 min) — the window must dwarf the import cost so a burst pays one
import, not N.

**Coalescing semantics (R2).** `enqueueCoalesced` (`packages/domain/src/db.ts`) joins the newest
**pending** job of the type instead of inserting a second: merged payload keeps the earliest
`windowStart` and extends `windowEnd` to the latest completion, and `nextRetryAt` slides to
`now + debounce_ms`. A burst of N completions inside the window therefore yields **exactly one**
refresh whose covered window spans all N. Once a job is claimed (`processing`), the next completion
starts a fresh job — a refresh already in flight is never starved by further joining.

E31/ADR-101 supersedes the final sentence: a processing refresh returns
`already-running`, and the database admits no simultaneous pending follow-up. Schedule and Board
manual producers also use the same writer. Exact merge and outcome shapes live in
[`history-refresh-process-isolation.md`](design/history-refresh-process-isolation.md).

**Never inline (R1).** The trigger (`apps/cli/src/history-refresh.ts`, `packages/app/src/services/history-refresh-service.ts`)
is two queue-table statements — one lookup, one insert/update — and returns; the firing operation's
elapsed time is unaffected. The refresh runs as queue job kind `history.refresh` in an isolated child process (`apps/server/src/serve.ts`
registers a handler that runs `<invocation> --no-logo history daily` via `ProcessExecutor`), so
the same import-all fan-out with **per-source isolation** (R5: one source failing never aborts the others),
analyze, and artifact write the nightly loop uses executes outside the server event loop.
Both launchers provide a PATH-independent invocation: `spur serve` reuses its live CLI entry, while the
standalone server resolves the source-local CLI or its sibling compiled `dist/cli/spur`. All coalesced
refresh producers share `max_retries = 3`; this intentionally replaces the old scheduler-only value of 1.
The server queue visibility timeout is two hours because `history daily` can spend ten minutes on each
of six sequential sources before analysis; the generic 30-second default would duplicate a live child.

**Failure policy.** A degraded fan-out (per-source failures) emits `history.daily.failed` and does
**not** rethrow — the refresh is idempotent (checkpoint resume) and the next completion re-triggers
it. An exception from `daily` itself emits and rethrows so the queue records the job failed.

**Observability (R3).** Enqueue is observable through the ledger: the trigger emits
`history.refresh.enqueued` (renderer `history-refresh`, `default` tier) carrying
`trigger`/`jobId`/`windowStart`/`windowEnd`; the job body emits the existing
`history.import.completed` / `history.analyze.completed` / `history.daily.failed` catalog events in the
child, stamped with the coalesced `trigger`/window and resolved `importMode` from
`SPUR_HISTORY_REFRESH_CONTEXT` (+ `coverage` on import). The child inherits the server's resolved
`DATABASE_URL`, so `spur serve --cwd` refreshes the same database; the parent emits no `history.*` events.
Enqueue failures degrade to a stderr warning and never change
the firing operation's exit code.

#### `spur feature sync [id] [--all] [--dry-run] [--force] [--folder <path>] [--json]`

Sync feature status with linked task states via conservative forward-only derivation rules (ADR-0322).

- `[id]` — sync a single feature by ID.
- `--all` — evaluate and sync all features with linked tasks.
- `--dry-run` — report proposed status sync transitions without applying writes.
- `--force` — force applying reopen proposals (`done/cancelled -> active` when non-terminal tasks are linked) without confirmation.
- Applied-hop projection (task 0625): after one or more lifecycle hops, `syncFeature` calls
  `refresh({ featureId: id })` from `finally` before returning or rethrowing a later-hop guard
  failure, so the touched feature's `## Tasks` marker region reflects the task edges used to derive
  status. Dry-run, confirmation-refused, and no-op results do not refresh.
- `POST /features/{id}/sync` HTTP endpoint: `pull` direction delegates to `syncFeature` (`{ direction: 'pull', affectedTasks, applied, newStatus }` — `affectedTasks` = number of tasks linked to the feature, `applied` = whether a status transition was applied); `push` direction returns HTTP 501 structured error (not supported; use pull or CLI `spur feature sync`).
- Pipeline integration (task 0328; bounded by 0411, amended by 0625): `task-pipeline.yaml`'s
  post-record step syncs the linked feature or records an orphan proposal. `wrapup-pipeline.yaml`'s
  `feature-transition` step syncs `${vars.feature}`, captures the result and exit code, and runs
  trusted workflow var `featureGateCmd` (default `$spurBin feature check "$feature"` — the
  affected feature, not the corpus or code suite) when `applied` is true or
  sync exits non-zero after a possible partial transition. Both prefer `feature-sync-bounded.ts` and
  fall back to plain `spur feature sync` in a seeded project. The shells remain advisory (`exit 0`);
  the wrap-up gate emits explicit PASS/FAIL while leaving recovery to the operator. An empty wrap-up
  feature id fails loud with exit 1.

Task frontmatter supports `feature_link_declined: true` to record explicit operator deferral.

Detailed shapes: [`lifecycle-projection-integrity.md`](design/lifecycle-projection-integrity.md).

#### `spur task scaffold-tests <wbs> [--file <path>] [--folder <path>] [--json]`

Scaffold BDD `test.todo` stubs from task Acceptance Criteria into `<workspace>/tests/tasks/<wbs>.test.ts` (or `--file <path>`). Each scenario produces one stub with Given/When/Then steps as AAA comments and a `// @ac:<normalizedTitle>` tag. Expands Scenario Outlines into 1 stub per Examples row. Merges idempotently with existing test files (preserves filled bodies, appends new scenarios, reports drifted scenarios). `--json` returns `{ wbs, targetFile, created, skipped, drifted, driftedScenarios, warnings }`.

### 1.2 Supporting utilities

| Command                                                                       | Behavior                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur status [path] [--json]`                                                 | Project health: `ok`/exit 0 requires a valid `.spur/config.yaml`; `packageJson` is an independent optional fact. Also reports Git context, team agent spec ids under `.spur/agents/`, and optional path metadata (size, isFile, isDirectory). Hidden alias — canonical: `spur self status`. |
| `spur serve [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]` | Start the web server (local fallback) and serve the Spur Board SPA when static assets resolve. Options: `--port` (env PORT, default 3000), `--host` (env HOST, default localhost), `--no-open` skip browser, `--json` print {port,url,pid}. Board assets ship in the npm package as `web/` next to `spur.js` (`resolveWebDistPath`); without them `/board` returns JSON 404 and the server logs a warning. Hidden alias — canonical: `spur self serve`. |
| `spur projects [add                                                           | remove                                                                                                                                                                                                                                                                                                                                                                                                     | list | start | stop] [args] [--json]` | Multi-project registry management: `add <path>` registers project, `remove <target>` unregisters, `list` shows registered projects and health status, `start <target>` spawns server on allocated port, `stop <target>` stops server process. `--json` shapes for scripting. |
| `spur migrate [--json]`                                                       | Temporary helper: apply CLI-owned schema migrations; reports `{ ok, applied }`. Hidden alias — canonical: `spur self migrate`. |
| `spur maintain [--vacuum] [--json]`                                           | Run database maintenance: PRAGMA optimize, WAL truncation, optional VACUUM compaction. Hidden alias — canonical: `spur self maintain`. |

| `spur --help` / `spur --version` | Commander-rendered usage / binary version (ADR-014). |

### 1.3 Agent command surface — commands as SSOT (feature H5 (was O), ADR-032)

The `plugins/sp` agent-facing command surface (31 `/sp:dev-*` wrappers; 37 command wrappers total) is
**hand-authored** — each `commands/<name>.md` is the authoritative, directly-editable source.
Per-platform adapters are **install-time output** owned by `superskill` (`superskill install sp`)
and never committed in plugin `sp` (ADR-032).

| Artifact                                    | Role                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/sp/commands/<name>.md`             | Hand-editable SSOT — frontmatter + invocation syntax + delegation line only                                                        |
| `plugins/sp/scripts/validate-commands.ts`   | Thin-wrapper contract validator: (a) heading whitelist, (b) frontmatter schema, (c) target resolution, (d) allowed-tools coherence |
| `plugins/sp/tests/command-contract.test.ts` | Contract test — validates the same four gates against the live corpus + negative-path coverage                                     |

Invariants: wrappers carry invocation syntax + the delegation line only — lifecycle semantics live
in the dispatched skill/workflow/procedure (0283 R4). The thin-wrapper contract is enforced by
validation, not generation — commands are hand-editable; the validator catches drift. A fresh
session is required to trust an in-session dogfood of a just-edited wrapper (platforms snapshot
command bodies at session start). The command index is owned by `plugins/sp/README.md`.
Supersedes the 0308 generated-adapter approach (ADR-032 records the decision).

**H81 contract (task 0412).** Dev-command frontmatter carries syntax-only
`argument-hint`; each body adds `## Argument Flags` immediately before `## Usage`, with exact
`Flag | Description | Default` columns and one canonical glossary reference. The validator enforces
the ordered three-heading contract and five gates (a–e); parity tests derive coverage from all
dev commands. Full shapes:
[`dev-command-argument-contract.md`](design/dev-command-argument-contract.md).

#### 1.3.1 `/sp:dev-find-conflict` — authority-aware conflict audit (feature H11, task 0486)

Thin wrapper over the `sp:conflict-finding` skill. Standalone audit, not a spine pipeline stage.

```text
/sp:dev-find-conflict [<scope>]
    [--pillar <source|tasks|features|authority|all>]   # default all
    [--mode <adaptive|full>]                            # default adaptive
    [--resolve]                                         # default off
    [--agent <inline|auto|name>]                        # default omitted
    [--json]                                            # default off
```

Behavior: audits the four pillars (source code, task files, feature files, project authority files)
for within-pillar and cross-pillar semantic conflicts. Authority is resolved per **subject + claim
type** — never by a global `docs > features > tasks > code` ranking; incomparable or missing
authority yields a `needs-authority-decision` item rather than a fabricated winner. Without
`--resolve` the run is read-only with respect to source, corpus, and numbered docs. With `--resolve`
the skill presents a repair set, requires explicit confirmation, revalidates evidence freshness, then
routes each approved repair through its owner surface (`spur task`/`spur feature`, `sp:doc-evolve`,
the Spur dev lifecycle, or the Superskill capability lifecycle).

Result envelope (identical content in Markdown and `--json`):

```text
schema_version, command, scope, mode, pillars, authority_map,
inventory, findings, unresolved, coverage, cost, remediation, errors
```

Each finding carries `id, subject, claim_type, conflict_type, pillars, artifacts,
normative_authority, observed_reality, precedence_reason, evidence, freshness, severity, confidence,
false_positive_check, proposed_repair, repair_owner, status`. `conflict_type` ∈ {`contradiction`,
`stale`, `duplicate`, `omission`, `orphan`, `ambiguous-authority`}; `status` ∈ {`open`,
`needs-authority-decision`, `confirmed`, `repairing`, `resolved`, `failed`}. `coverage.complete`
is `false` whenever a selected pillar was skipped or a preflight tool failed — "comprehensive" may
not be claimed against a false value. v1 adds no production analyzer, index/cache/database,
dependency, CLI noun, workflow, or dedicated subagent. SSOT:
`plugins/sp/skills/conflict-finding/SKILL.md` + its four references.

#### 1.3.2 `/sp:dev-find-next` — feature frontier prioritizer (feature H12, tasks 0497, 0498)

Thin wrapper over the `sp:next-feature` skill. Standalone report, not a spine pipeline stage.
Answers "which feature should we work on now?" — the target-omitted case `sp:next-router`
declares out of v1 (routing-table §0 step 1c); within-target routing stays `/sp:dev-next`'s.

```text
/sp:dev-find-next
    [--task [<feature-id>]]                             # default omitted
    [--agent <inline|auto|name>]                        # default omitted
    [--auto]                                            # default off
    [--json]                                            # default off
```

Behavior: (0) sync-first precondition — `spur feature sync --all --dry-run --json`; material drift
leads the report with a "sync first" block and ranking uses the post-sync status view. (1) Assemble
the candidate set from `spur feature list --json` (containers and terminal features excluded; the
`group` tag is not a reliable container marker). (2) Gate on actionability — the frontier predicate
is **cited at runtime** from next-router's routing-table row B3, never restated; gated features are
reported with reasons, never ranked. (3) Derive the four measured signals (AC coverage, churn
exposure, dogfood proximity, authority pull) via `spur … --json`, `git`, and `rg`; a signal with a
degenerate spread is reported rejected-with-spread. (4) Rank in **ordinal tiers with per-candidate
evidence** — no numeric scores (the corpus carries no value/effort estimates; the `priority` field
is degenerate and never used as an ordering). (5) Defect pass — rank-distorting tree defects D1–D4
are emitted as proposals conforming to `docs/plans/feature-tree-restructure-map.md`'s schema, each
clearing the `sp:conflict-finding` evidence bar (`false_positive_check` mandatory); silence is a
valid outcome. (6) Report — the command performs no `spur feature move` and writes nothing under
`docs/features/**`; `/sp:dev-feature-change` (dry-run → confirm → apply) is the sole path from a
structure proposal to a changed tree. (7) **`--task` only (task 0498, resolving OQ1 toward the
planning half):** offer the rank-1 candidate (or the id passed to `--task`), then route on the tier
step 4 assigned — T3 with valid AC and zero tasks → `/sp:dev-plan --feature <id>` then
`/sp:dev-refineall --feature <id> --auto --depth ready`; T1 → refineall only (a live frontier already
exists; a second decomposition duplicates it); T3 with invalid AC → stop with next-router's B4 hop,
never inventing idea text; T2 (blocked) and T4 (stale-done) → refuse with the reason. The skill
**creates no tasks itself** — decomposition and the `task-batch.schema.json` gate belong to
`/sp:dev-plan`. Confirm is interactive by default; **`--auto` auto-accepts the offered target**
(rank-1 or the explicit `--task <id>`) as operator pre-consent to take the ranking's recommendation
and is forwarded to the dispatched children. T2/T4 refuse and invalid-AC stop still apply under
`--auto`. Without `--task`, `--auto` is a no-op. Adds no TypeScript, schema, frontmatter field, CLI
verb, or subagent. SSOT:
`plugins/sp/skills/next-feature/SKILL.md` + its four references
(`signal-derivation`, `ranking-rubric`, `proposal-contract`, `handoff-routing`).

## 2. Configuration

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
    feature-dev.yaml                # agent-driven feature loop with pre/test/post gates
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
  `EMBEDDED_SPUR_SCHEMAS`).
- `resolvePlanningFolders(fs)` derives the active + registered task/feature folders, degrading to
  defaults on any error (a broken config must not wedge folder resolution). `@gobing-ai/spur-app`
  re-exports it so app/CLI consumers import from the application layer, not the config package.
- **Type ownership.** `TaskFoldersConfig`/`TaskFolderEntry` are defined once in the loader; services
  re-export, never redefine, so the loader↔service seam shares one identity.
- **Guardrail.** `config/rules/boundary/config-loading-ownership.yaml` blocks `loadStructuredConfig`
  outside `packages/config` and any reference to the retired `docs/.tasks/config.jsonc`.

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

## 3. Data Shapes

### 3.1 Tables (composed package-owned schema, ADR-007)

| Table                                                      | Owner                     | Purpose                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces`                                               | CLI                       | Static workspace binding (name, root, purpose, default agent)                                                                                                                   |
| `runs`, `phase_runs`, `transition_runs`, `workflow_states` | CLI + workflow engine     | Workflow run model                                                                                                                                                              |
| `artifacts`                                                | CLI                       | Captured output references                                                                                                                                                      |
| `history_import_ledger`                                    | importer                  | One row per imported record (hash, source, file, line)                                                                                                                          |
| `history_import_checkpoint`                                | importer                  | Incremental position, composite PK `(source, source_file)`                                                                                                                      |
| `history_message`                                          | importer + CLI            | Typed message rows. Nullable `request_id` identifies repeated Claude response snapshots; rollups retain the final cumulative row (`MAX(rowid)`) once, backed by partial index `idx_history_message_request_id` (migration `0020_spur_cli_history_message_request_id_idx`). |
| `history_tool_call`                                        | importer                  | Typed tool-call rows joined to messages by `message_hash`; result bodies are never stored, only bounded metadata such as `result_bytes`. |
| `history_etl_<source>`                                     | importer                  | Generic/custom-source payload rows, created lazily only when an accepted record targets the table. Built-in typed imports leave no empty ETL tables; migration `0019_spur_cli_history_etl_tables_drop` retires the ten vestigial built-in tables. |
| `inbox_messages`                                           | ts-db (`InboxMessageDao`) | Durable inter-agent message queue; indexed on `(to_id, status)`. Added by migration `0001_spur_cli_team_inbox`; composed into `CLI_SCHEMA_SQL` via `INBOX_MESSAGES_SCHEMA_SQL`. |
| `coordination_runs`                                        | ts-db (`CoordinationRunDao`) | Occupant pin + path-only artifact refs for spec-addressed runs (ADR-057 wave 1). PK `run_id`; indexed `(spec_id, generation DESC)`. Added by migration `0010_spur_cli_coordination_runs`. Never stores stdout/stderr bodies. |
| `agent_instances` (reserved draft)                         | CLI                       | Future DB home for materialized instances (ADR-086): `spec_id` PK; `team_id`, `member_key`, `executor`, nullable `role`, `workspace`, `status` (`stopped\|running\|exited\|errored`), nullable `pid`/pin fields, JSON `tags`/`config`, integer timestamps; indexes on role, executor, and team. Draft id `0026_spur_cli_agent_instances` is intentionally absent from `CLI_MIGRATIONS`. |
| `history_run_session`                                      | CLI (`RunSessionDao`)        | Run→session mapping (feature E6): `run_id` → `(source, session_id)` with `exactness` (`exact` \| `unresolved` \| `estimated`) and `mechanism` (`observed` \| `supplied` \| `inferred`). `RunSessionObserver` writes boundary observations; import may promote an unresolved row to exact when a session is observed inside that run's `.spur/run/<runId>/agent-sessions/` directory (task 0624). `RetroCorrelator` writes estimated/inferred rows and never shadows exact. Indexed on `run_id` and `(source, session_id)`. |
| `history_task_session`                                     | CLI (`TaskSessionDao`)       | Task↔session attribution (feature E6, task 0722): evidence-backed `(wbs, source, session_id)` triples recovered during history import. One row per task per session; `exactness` is `estimated` on the import path (first-party operational syntax only, echo rule per run-2 remediation R9 — task-scoped `/sp:dev-*` slash invocations in user rows, structured `spur task <verb> <wbs>` operations **only via tool-call args**; quoted command text in user rows, tool-output echoes, and prose never links and is counted skipped — validated through the task locator) and distinguishable from invoke-boundary `exact` mappings; `evidence_kind`/`evidence_ref` carry a bounded audit locator (`user-command`\|`cli-tool`, `<file basename>#<line>`), never transcript content. The primary key makes re-imports idempotent and enforces exact-over-estimated precedence. Indexed on `(source, session_id)`. |
| `rule_runs`, `rule_eval_runs`                              | ts-rule-engine (≥0.3.15)  | Persisted rule-run history powering `spur rule trace`; added by migration `0002_spur_cli_rule_history`. `applied_fix_count` is re-stamped by Spur after `applyFixes`.           |

### 3.2 SourceDefinition (history import)

One config object per source: `source` discriminant, `displayName`, `filePatterns`, `defaultRoots`,
`splitConfig` (one-to-one | one-to-many | custom), `fieldMap` (raw→canonical), optional
`fieldTransforms`, and a Zod `schema` validating canonical fields. Adding a source = one variant.

**`fieldTransforms` limits (task 0722 run-2 probe, importer 0.4.48).** Transforms are per-source,
apply to **every** split record of that source, and receive only the mapper's split record — never
the raw JSONL object, and no target-table identity. Consequence measured live: a derived
`getSourceDefinition('pi')` definition adding an `args_raw` transform to recover pi bash tool-call
commands (persisted `NULL` upstream — `maybeArgsRaw` keeps args only for the todo allowlist) fails
twice over. The command is absent from the split record (`piSplit` discards non-todo
`call.input`; only the one-way `args_digest` survives), and the transform's key presence on
`history_message` split records makes the typed message insert throw (`Typed table
"history_message" has unknown columns: args_raw`). Bash-args recovery is therefore an upstream
mapper fix, not a caller-side transform.

### 3.3 Analytics records

`CostRecord` (source, date, model, input/output tokens, cache split, costUsd) is the single-record cost
shape kept for the analyze rollup helpers. The run-cost path (task 0559) no longer builds `CostRecord`s:
`attributeActionCost` folds `history_message`'s typed token columns directly through the
`history_run_session` mapping (exact vs estimated apart, never priced). The analyze path aggregates in
SQL over `history_message` / `history_tool_call` into a versioned `HistoryArtifact`
(`packages/domain/src/analytics/artifact.ts`), whose core bucket is `TokenTotals` extended with the
forensic dimensions (`messages`, `toolCalls`, `durationMs`, `durationUnmeasured`) and
`cacheWriteTokens` (matching the `history_message.cache_write_tokens` column). Artifact contract:
`schemaVersion`, `generatedAt`, `spurVersion`, `selector`, `coverage`, `totals`, `bySource`,
`byModel`, `daily`, `byTool`, `bySession`, `loops`, `warnings` (0464 R2). Additive 0581 fields for
the per-step sections: `topStepsByTokens`, `topStepsByDuration` (`StepStat[]`), `cacheWaste`
(`{ steps, inputTokens, topSteps }`), `stepSupport` (`StepSupportEntry[]`) — all optional in the
type, absent on pre-0581 artifacts (schemaVersion stays 1).

## 4. Output Conventions

- Human mode: terse, line-oriented, tab-separated where tabular.
- JSON mode (`--json`): a single JSON document to stdout, stable keys for automation.
- Errors go to the error sink with context (what failed, path/identifier); exit codes are meaningful.

### 4.1 CLI `--json` shape inventory (F95 / task 0693, swept 2026-08-27 @ emit set below)

Per-noun inventory of every `--json`-bearing verb across the 14 noun modules under
`apps/cli/src/commands/`, from a full `toJson(` / `JSON.stringify(` sweep (104 emit sites,
counts per module in parentheses). Target shape = the ADR-091 envelope
(`{ok: true, data}` / `{ok: false, error: {code, message, details?}}`; paginated list verbs
`{ok, data, meta}`). This table doubles as the migration ledger: rows gain a **Post-adoption**
note as nouns adopt behind `--json-envelope` (plan step 8).

**Post-adoption (task 0693 R4, 2026-08-27; re-swept 2026-08-28):** all 104 sites are accounted for — 99 adopted
behind the opt-in (`toJson(payload)` → `toEnvelopeJson(payload, { enveloped: options.jsonEnvelope })`;
raw output stays byte-identical), 5 intentionally kept raw. Default rule per row: the "Current
shape" column describes the **raw default that remains unchanged**; enveloped output wraps it
as `{ok, data}` (single), `{ok, data, meta}` (list), or normalizes it (error envelopes).
Row-level deltas from the default rule:

- **List-kind sites** (bare arrays → paginated `{ok, data, meta}`): `task list`, `task check`
  (default path), `feature list`, `feature check`. The check verbs' envelope `ok` is command
  success (`ok: true` with the verdict carried per row in `data`) — the frozen
  `apiSuccessSchema` pins `ok: true`, so an aggregate-failure cannot be expressed as
  `ok: false, data` without re-spelling the envelope (recorded as the one classification
  judgment call of R4).
- **Error normalization** (class 4 sites → enveloped `{ok: false, error: {code,
  message, details}}` with `code: 'INTERNAL_ERROR'` and the CLI-local code carried in
  `details.cliCode`): task create/batch-create collision + duplicate-follow-up,
  projects add/remove/list/start/stop error branches, builder bump-ver/drop-tags error
  branches, message send/wait usage + typed failures, agent wait resolution/usage/fail
  branches, history daily `{error: detail}`, and (close-out 2026-08-27) the `feature show` /
  `feature transition` not-found returns at `apps/cli/src/commands/feature.ts:60,175`, which had
  bypassed the seam via a direct `context.output.error(...)`.
- **Class-3 top-level-`ok` payloads** move under `data` unchanged; the envelope `ok` is
  recomputed as command success (task migrate, migrate-anchors, check --corpus, noop,
  agent create, init fresh run, projects/builder success payloads).
- **Kept raw (5 sites, not adopted):** `task verdict` (writes the `.spur/run` verdict
  artifact consumed by pipeline code, not CLI stdout), the two workflow internal event
  fingerprints (dedup keys, not CLI output), and the two `workflow show` `toJson` sites
  (`apps/cli/src/commands/workflow.ts:866,875` — the verb deliberately does not advertise
  `--json-envelope`, so no enveloped path exists to route to). `rule list` and
  `task verifyall-aggregate` raw `JSON.stringify(x, null, 2)` sites were adopted — their
  formatting is identical to the `toJson` raw path, so byte-identity holds.
- **Service-side adoption — CLOSED (task 0697, 2026-08-27).** The envelope helpers moved to
  `packages/app/src/output/envelope.ts` (ADR-091 amendment 2026-08-27); `apps/cli/src/output.ts`
  re-exports them, so all 99 sites adopted at 0693 are unedited. The verbs that emit their JSON
  from a `packages/app` service now receive the decision through an `enveloped` option threaded
  from the command layer, and `envelopeEnabled()` applies the same precedence
  (explicit flag > `SPUR_JSON_ENVELOPE=1` > raw) — no service reads the env var itself:

  | Verb | Emit site (post-0697) | Threaded from | Enveloped shape |
  | --- | --- | --- | --- |
  | `agent list` | `agent-service.ts` `list()` | `agent.ts` → `runAgentList` → `svc.list({enveloped})` | `{ok, data: {agents}}` |
  | `agent doctor` | `agent-service.ts` `renderDoctor()` (2 sites) + role-ladder failure | `agent.ts` → `svc.doctor({enveloped})` | `{ok, data: {agents, rolesSource, cache}}`; failure → `{ok:false, error:{code:'INTERNAL_ERROR', details:{cliCode:'agent-resolution'}}}` |
  | `agent run` | `agent-service.ts` `handleRunOutput()` + resolution failure | `agent.ts` → `flags.jsonEnvelope` shim → `AgentService.run()` | `{ok, data: {exitCode, stdout, …}}`; failure as above |
  | `rule run` | `rule-service.ts` `evaluate()` | `rule.ts` → `service.evaluate({enveloped})` | `{ok, data: {preset, ruleCount, findings, fixes}}` |
  | `rule validate` | `rule-service.ts` `validate()` (valid + invalid branches) | `rule.ts` → `service.validate({enveloped})` | `{ok, data: {valid, kind, source, …}}` |

  `agent run` was **not** in the original four; the AC4 scan surfaced it as the same defect class
  (it registers the flag and emits from the service) and it is closed with them. All five emit
  **flat objects**, so `apiSuccessSchema` `{ok, data}` applies and `paginatedResponseSchema` does
  not — the arrays inside (`agents`, `findings`) stay fields of the payload rather than being
  unwrapped to the top level. The private `toJson` helper in `agent-service.ts` is deleted; every
  emitter routes through the one seam.

  **The inventory is now guarded, not swept by hand.** `apps/cli/tests/json-envelope-inventory.test.ts`
  walks every `.command()` block registering `SHARED_OPTIONS.jsonEnvelope` (68 verbs) and fails on
  any verb that advertises the flag without routing it to an envelope emitter — in-module, through
  a module-level helper, or threaded to a service. The only permitted exception is its explicit
  `KEPT_RAW` allowlist, which must stay in sync with the "Kept raw" bullet above; today it holds
  one entry (`task verdict`, whose stdout doubles as the `.spur/run` artifact bytes). Raw-default
  byte-identity for the service verbs is pinned against a pre-relocation baseline captured before
  any edit: `packages/app/tests/fixtures/json-raw-baseline.json`, asserted by
  `packages/app/tests/services/json-envelope-adoption.test.ts`.

| Noun | Verb | Emit sites (`apps/cli/src/commands/<noun>.ts`) | Current shape | Deviation from ADR-091 envelope |
| --- | --- | --- | --- | --- |
| task (26) | create | 191, 199, 217 | mixed: success flat-object `{…result, wbs, filePath}`; collision errors pseudo-envelope `{ok:false, error:{code:'wbs-collision'\|'duplicate-follow-up', …}}` | success unwrapped; error codes not in `API_ERROR_CODES` (ADR-091: collapse to `INTERNAL_ERROR` with `details`) |
| task | show | 255 | flat-object `{…rest, frontmatter}` | unwrapped |
| task | update | 324, 349, 431, 475 | flat-object; `--section` result `{ref, warnings, …}` has **no `ok`** (0688 case 1); `noop` path `{ok:true, noop, …}` | unwrapped; top-level `ok` on a subset of branches = two meanings of `ok` across calls |
| task | deps | 546 | flat-object | unwrapped |
| task | sections | 610 | flat-object | unwrapped |
| task | list | 657 | **bare-array** | no envelope; becomes `{ok:true, data, meta}` paginated form |
| task | refresh | 690 | flat-object | unwrapped |
| task | migrate | 715 | flat-object-with-ok `{ok:true, dryRun, corpusDir, …report}` | `ok` at top level means command success, not envelope discriminant |
| task | migrate-anchors | 754 | flat-object-with-ok | same top-level-`ok` conflict |
| task | refresh-roster | 797 | flat-object | unwrapped |
| task | batch-create | 821, 840 | success flat-object `{created, wbs, parentsWired}`; collision error pseudo-envelope | unwrapped success; non-vocabulary error code |
| task | record | 880 | flat-object | unwrapped |
| task | verdict | 947 | flat-object artifact written to `.spur/run/<wbs>-verdict.json` (raw `JSON.stringify`) | file artifact, not stdout; unwrapped; bypasses `toJson` |
| task | verifyall-aggregate | 1013 | flat-object (raw `JSON.stringify`) | unwrapped; bypasses `toJson` |
| task | check | 1104 (`--corpus`), 1245 (default) | `--corpus`: flat-object-with-ok (0688 case 4); default: **bare-array** `[{wbs, status, findings, pass, …}]` (0688 case 3) | bare-array path wraps array as `data` with `ok` from aggregate pass/fail; corpus `ok` moves under `data` |
| task | resolve | 1268 | flat-object | unwrapped |
| task | path | 1294 | flat-object `{wbs, filePath}` | unwrapped |
| task | run-link | 1332 | flat-object | unwrapped |
| task | scaffold-tests | 1368 | flat-object | unwrapped |
| workflow (14) | validate | 273 | flat-object | unwrapped |
| workflow | run | 406, 431, 440, 621 | flat-object (sync/async-fallback result, `{status:'failed', reason, hint}` failure, `{runId, status:'started', …}` handle, sync result) | unwrapped; failure is status-discriminated, not `{ok:false, error}` |
| workflow | continue | 698 | flat-object | unwrapped |
| workflow | clean | 744 | flat-object (`logsOnly ? logResult : {…result, logs}`) | unwrapped |
| workflow | cancel | 788 | flat-object (status union incl. `not_found`) | not-found is a status value, not an error envelope |
| workflow | list | 813 | flat-object (`WorkflowListResult`) | list verb without paginated `{ok, data, meta}` form |
| workflow | show | 855, 864 | flat-object (`{name, kind, format, steps}` todo · `{name, kind, format, diagram}` mermaid) | **kept raw** — registers `SHARED_OPTIONS.jsonSupported`, not `jsonEnvelope`, so it never advertises the flag (added by task 0695 after the 0693 sweep; recorded 2026-08-28) |
| workflow | trace | 946 | flat-object (timeline/summary union) | unwrapped |
| workflow | (internal) | 1121, 1128 | `JSON.stringify` event fingerprints — **not CLI output** (dedup/dedupe keys) | none — counted in the 104 for sweep parity, no migration |
| feature (11) | create | 33 | flat-object | unwrapped |
| feature | show | 64 | flat-object `{…rest, content}` | unwrapped |
| feature | update | 143 | flat-object | unwrapped |
| feature | advance | 178, 210 | flat-object `{id, status, hops}` | unwrapped |
| feature | list | 241 | **bare-array** | wraps as paginated `{ok, data, meta}` |
| feature | move | 269 | flat-object | unwrapped |
| feature | refresh | 328 | flat-object `{index_path, tasksUpdated}` | unwrapped |
| feature | check | 403 | **bare-array** (0688 case 2) | wraps array as `data`, `ok` from aggregate pass/fail |
| feature | sync | 450, 474 | flat-object | unwrapped |
| projects (10) | add | 32, 39 | `{ok:true, project, …}` / `{ok:false, error:"<string>"}` | top-level `ok` is command success, not envelope discriminant; `error` is a bare string, not `{code, message}` |
| projects | remove | 60, 67 | same `{ok, …}` / `{ok:false, error:"…"}` pattern | same |
| projects | list | 91, 106 | `{projects}` (no `ok`) / `{ok:false, error:"…"}` | unwrapped success; string error |
| projects | start | 128, 148 | `{ok:true, project, running}` / `{ok:false, error:"…"}` | top-level-`ok` conflict; string error |
| projects | stop | 204, 211 | `{ok:true, stopped}` / `{ok:false, error:"…"}` | same |
| message (10) | send | 49, 64, 154, 190, 274, 470 | errors: pseudo-envelope `{error:{code:'usage'\|…, message}}` (**no `ok`**); success: flat-object queued ack / wait payload `{msgId, toId, status, wait}` | error shape is near-miss (no discriminant, CLI-local codes); success unwrapped |
| message | inbox | 296 | flat-object `{count, messages}` | unwrapped |
| message | reply | 323 | flat-object | unwrapped |
| message | watch | 388 | stream of flat-object message rows (one JSON doc per poll) | streamed rows stay per-row flat; envelope applies per emitted row under `--json-envelope` |
| history (9) | import | 72, 85, 104, 125 | errors `{status:'error', message}`; success `{…fanOut, provenance}` | failure discriminated by `status` field, not envelope; success unwrapped |
| history | analyze | 162 | flat-object (HistoryArtifact) | unwrapped |
| history | report | 198 | flat-object (HistoryArtifact) | unwrapped |
| history | daily | 217, 347, 356 | errors `{status:'error', message}` / `{error: detail}`; success flat-object | mixed failure conventions, none the envelope |
| team (6) | status | 150, 329 | flat-object status doc; `--by-team` `{teams}` | unwrapped |
| team | start | 261 | flat-object (`result.body`) | unwrapped |
| team | stop | 307 | flat-object (`result.body`) | unwrapped |
| team | up | 399 | flat-object `{…result, started}` | unwrapped |
| team | down | 438 | flat-object `{…result, stopped}` | unwrapped |
| agent (6) | list | 243 (`--specs`); plain path emits service-side (`agent-service.ts` `AgentService.list`) | flat-object `{specs:[…]}` / `{agents}` | unwrapped; plain path adopted 0697 — honors flag/env via threaded `enveloped` |
| agent | doctor | service-side (`agent-service.ts` `AgentService.doctor` / `renderDoctor`; errors were pseudo-envelopes `{error:{code:'agent-resolution', message}}`) | flat-object `{agents, rolesSource, cache…}`; errors pseudo-envelope | adopted 0697 — success honors flag/env; enveloped errors normalize to `INTERNAL_ERROR` with `details.cliCode: 'agent-resolution'`; raw bytes unchanged |
| agent | run | service-side (`agent-service.ts` `handleRunOutput`); failure pseudo-envelope `{error:{code:'agent-resolution', message}}` | flat-object `{exitCode, stdout, stderr, durationMs, …}` | adopted 0697 — honors flag/env via tri-state `jsonEnvelopeFlag(flags)` (absent → `SPUR_JSON_ENVELOPE`); raw bytes unchanged |
| agent | wait | 137, 775, 792, 802 | errors pseudo-envelope `{error:{code:'usage'\|'wait_stalled'\|…, message}}`; success flat-object `{satisfied, pin}` | near-miss error shape (no `ok`), CLI-local codes |
| agent | create | 308 | flat-object-with-ok `{ok:true, spec}` | top-level-`ok` conflict |
| builder (4) | bump-ver | 38, 44 | `{ok:true, verb, target, version}` / `{ok:false, verb, error:"…"}` | top-level-`ok` conflict; string error |
| builder | drop-tags | 74, 80 | same pattern | same |
| rule (3) | run | service-side (`packages/app/src/services/rule-service.ts` `RuleService.evaluate`, JSON branch) | flat-object `{preset, ruleCount, …engine result}` | unwrapped; adopted 0697 — honors flag/env via threaded `enveloped` |
| rule | validate | service-side (`RuleService.validate`, both JSON branches) | flat-object `{valid, kind, source, …}` (`valid: false` carries `errors`) | unwrapped; adopted 0697 — `valid` stays a payload field; envelope `ok` is command success |
| rule | list | 98 | flat-object (`RuleListServiceResult`) via **raw `JSON.stringify`** | unwrapped; bypasses `toJson` helper |
| rule | trace | 135, 147 | flat-object detail / `{runs}` | unwrapped |
| init (2) | init | 282, 426 | converged re-run flat-object `{…result, globalRulesSeeded, …}` (no `ok`); fresh run `{ok:true, project, config, …result}` | inconsistent between branches; top-level-`ok` on fresh path only |
| status (1) | status | 51 | flat-object | unwrapped |
| serve (1) | serve | 37 | flat-object `{port, url, pid:null, running:false}` (dry probe) | unwrapped |
| migrate (1) | migrate | 23 | flat-object | unwrapped |

Sweep parity: 104 raw sites = 102 verb emit sites + 2 workflow internal fingerprints
(1121/1128, footnoted above); per-module counts in the Noun column match the live sweep
(task 26, workflow 14, feature 11, projects 10, message 10, history 9, team 6,
agent 6, builder 4, rule 3, init 2, status/serve/migrate 1 each). The 0693 sweep recorded
102 sites / workflow 12; task 0695 added `workflow show --format todo|mermaid` (855/864),
re-swept 2026-08-28 during the 0693 `--force` re-verify.

Cross-cutting deviation classes (every row is an instance of one of these):

1. **Unwrapped flat-object** — no `{ok, data}` envelope (majority).
2. **Bare-array** — `task list`, `task check`, `feature check`.
3. **Top-level `ok` with non-envelope meaning** — projects/builder/init-fresh/agent-create/
   task migrate/migrate-anchors/corpus-check: `ok` states command success and siblings sit
   beside it, so `.ok` is not an envelope discriminant (the two-`ok`s hazard ADR-091 rule 4
   resolves by moving these under `data`).
4. **Pseudo-envelope errors** — `{error:{code, message}}` with no `ok` (message/agent/task
   collision paths) or `{ok:false, error:"<string>"}` (projects/builder): neither validates
   against `apiErrorSchema`; codes are CLI-local strings, not `API_ERROR_CODES`.
5. **Helper bypass** — `rule list`, `task verdict`, `task verifyall-aggregate` stringify
   without `toJson`.

### 4.2 Citation convention — prefer `path:symbol` over `path:line` (task 0694, F94)

Line anchors rot: 0606's `eval-pipeline.ts:528` drifted to `:562` after an unrelated +34-line
edit, caught post-commit by a human. New task citations and test evidence therefore prefer
the `path:symbol` form — the symbol names a named code entity, so an edit that shifts lines
does not invalidate it.

- **Preferred form:** `` `anchor-qualifier.ts:resolveRepoRoot` `` — repo-relative path plus a
  named symbol (function, class, exported const). Applies to new citations in task files
  (Solution/Testing/References evidence) and test descriptions.
- **Line anchors stay acceptable** when there is no enclosing named symbol or the reference is
  not to code position: a specific line in a non-code file, a diff hunk under review, a quoted
  log line, or code with no enclosing named symbol. State the exception explicitly in the
  citation (a convention with no stated exception gets ignored wholesale).
- **No rewrite of existing `path:line` citations.** This governs new citations only; a mass
  rewrite would mint the churn F94 exists to remove.
- **Dated decision note:** the 0688 friction review (2026-08-27) recorded this preference (the
  per-code diagnosis lived in the corpus-baseline `note` field, retired by task 0775). The
  drift *detection* side is task 0692's report; enforcement is deliberately deferred — this is a
  documentation convention, not a gate.

## 5. Server/Web Surface (current slice)

| Endpoint            | Source                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `GET /api/health`   | oRPC `health` procedure → `{ status, timestamp, service, version }` |
| `GET /openapi.json` | Generated from the oRPC contract                                    |
| `GET /`             | Redirect to `/api/health`                                           |

Web (`apps/web`) renders live health from the typed oRPC client. Deeper read surface is Phase 4.

### 5.1 Bootstrap (ADR-019, ADR-036)

The server bootstraps through `@gobing-ai/ts-infra` using a runtime-aware split:

| Entry                        | Bootstrap            | Subpath                     | Workers-Safe?       |
| ---------------------------- | -------------------- | --------------------------- | ------------------- |
| `src/index.ts` (Bun)         | `runNodeApplication` | `ts-infra/application-node` | No (uses `node:fs`) |
| `src/worker.ts` (CF Workers) | `runApplication`     | `ts-infra/application`      | Yes                 |

**Runtime seams:**

| Export                       | Runtime | Role                                                                                        |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `serverBootstrapConfig(env)` | Shared  | Portable `logging`/`telemetry`/`events` config with test-mute guard                         |
| `createApp(appRt?, opts?)`   | Bun     | Full Hono module registry, oRPC context, and local static assets                            |
| `createWorkerApp(env?)`      | Workers | Health, readiness, project identity, OpenAPI, and explicit 503 for local-runtime API routes |

The Worker entry uses a **lazy singleton** (`let rtPromise`) — no top-level await, `runApplication`
initialized on first `fetch`. Its static asset directory is `../../dist/web`, resolved relative to
`apps/server/wrangler.toml`. The Bun entry uses `runNodeApplication` mirroring the CLI (ADR-017).

### 5.2 Scheduler surface — `bootstrap.scheduler` (task 0734)

Recurring commands are declared in **one** place: the `bootstrap.scheduler` object that
`runNodeApplication` already owns. There is no top-level Spur `scheduler` section and no second
cron grammar in `packages/config` — `bootstrap` is deliberately excluded from the Spur Zod schema
(`packages/config/src/index.ts`), so adding one there would fork validation.

```yaml
bootstrap:
  scheduler:
    enabled: true
    jobs:
      - name: nightly-import
        cron: "30 2 * * *" # five fields, local wall-clock time
        command: bun run load-history
      - name: hourly-analyze
        intervalMinutes: 60 # 1..35791; mutually exclusive with `cron`
        command: spur history analyze
```

Mirrored for editor completion in `apps/cli/schemas/spur-config.schema.json` and documented in
`config/config.example.yaml`. The JSON Schema is an IDE aid only — `runNodeApplication` is the
validator of record and aborts startup with an issue path under
`bootstrap.scheduler.jobs.<index>.<field>`.

**Ownership seam.** `@gobing-ai/ts-infra` owns the contract and the lifecycle; Spur owns execution:

| Concern                                                        | Owner                                            |
| -------------------------------------------------------------- | ------------------------------------------------ |
| `SchedulerJobConfig` shape, validation, normalization           | ts-infra (`/application`)                        |
| Cron parsing and the `NodeSchedulerAdapter` timers              | ts-infra                                         |
| Adapter construction, `start()`, `stop()`                       | ts-infra runtime (`appRt.scheduler`)             |
| Binding each job to a queue entry                               | `registerSchedulerEntries` (`apps/server/src/serve.ts`) |
| Running the command                                             | `handleSchedulerCustomJob` (`packages/app`)      |

`spur serve` registers built-in **and** configured entries against `appRt.scheduler` inside the
`start` callback — which runs before ts-infra's scheduler plugin starts the adapter — and reads
configured jobs only from `appRt.config.scheduler.jobs`. `StartServerDeps.createScheduler` is gone:
a second Spur-owned adapter would have run every entry twice once the production scheduler was
enabled. `appRt.config.scheduler.enabled` is the effective gate; a disabled scheduler still carries
validated job definitions but creates no adapter and runs nothing.

**Cron semantics.** Five fields (minute hour day-of-month month day-of-week), evaluated in **local
process wall-clock time** — no timezone or DST policy per job. `ts-infra` keeps the three legacy
interval forms (`"600000"`, `* * * * *`, `*/N * * * *`) on `setInterval`; every other valid
expression self-reschedules with `setTimeout` to the next matching minute, never overlaps its own
tick, and skips occurrences missed while a tick runs. Anything outside the grammar throws
`RangeError` at registration — nothing silently degrades to a 60-second fallback.

**Trust boundary.** `command` is trusted operator input from the project's own config file, executed
as `/bin/sh -c <command>` with the project root as `cwd`. It is never echoed into an event payload
or a log line — only the job `name` is. Spur adds no per-job `cwd`, `env`, `enabled`, timeout, or
concurrency knob; a job that needs those wraps them in the script it invokes.

**Execution bounds** (`handleSchedulerCustomJob`): buffered output capped at 1,000,000 bytes, a
3,600,000 ms timeout (deliberately under the server queue's two-hour visibility timeout so the
queue never reclaims a still-running command), and the child's exit code as the only success
verdict. A non-zero exit, signal, or spawn failure throws an error naming the job plus at most the
final 400 characters of stderr (stdout only when stderr is empty), so retry and failure records
carry bounded, non-secret detail.

**Observability — enqueue vs. attempt.** The two are separate on purpose and reuse existing events:

| Event                                                     | Emitted by            | Means                                   |
| --------------------------------------------------------- | --------------------- | --------------------------------------- |
| `scheduler.job.executed` (name `scheduler.custom:<name>`) | the scheduler tick    | the tick fired and enqueued (or failed to) |
| `queue.job.completed` / `.retrying` / `.failed`           | the queue consumer    | one execution **attempt** of the command |

A tick is a normal non-coalesced enqueue of `scheduler.custom` with payload `{ name, command }`, so
it inherits the queue's default three-total-attempt policy. No new table, column, event name, API
route, or UI component: the Jobs tab and System Events already render both families.

## 6. Plugin System (Removed — ADR-012 amended 2026-06-09)

> **Amendment (2026-06-09):** The standalone `@gobing-ai/spur-plugin-sdk` is deleted. The bare
> lifecycle core (`Plugin` + `PluginHost`) lives upstream in `@gobing-ai/ts-infra` (shipped in
> `0.3.6`). Capability registries, trust ladder, manifest-driven discovery, and the server route
> seam are **deferred** — re-addable later on top of the ts-infra `Plugin` interface when a real
> plugin consumer exists. Mechanism lives in `03 §11`.

### 6.1 Current state

Spur consumes the ts-infra `Plugin` interface directly:

```ts
import type { Plugin, PluginHost } from "@gobing-ai/ts-infra/application";
```

The `Plugin` interface provides lifecycle hooks only: `onLoad`, `onStart`, `onStop`, `onUnload`,
plus `failFast`. The `PluginHost` drives registration and lifecycle fan-out (load → start →
stop → unload) with fail-fast load, fail-soft start/stop/unload in reverse registration order.

The `runApplication` / `runNodeApplication` bootstrap accepts `plugins`/`pluginHost` options
and drives the plugin lifecycle natively — no Spur-side host wiring needed.

### 6.2 Deferred (not permanently rejected)

| Concern                  | Status  | Notes                                                                                           |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Manifest (`plugin.yaml`) | Removed | Re-addable as YAML + Zod on the ts-infra `Plugin` interface                                     |
| Capability registries    | Removed | 9 registries (api, command, event, harness, provider, rule, skill, ui, worker) — re-addable     |
| Trust ladder             | Removed | 4-tier (`bundled` > `curated` > `local` > `untrusted`) — re-addable as registration-time gating |
| CLI plugin command       | Removed | `spur plugin list                                                                               | info` — re-addable when plugin discovery returns |
| Server route seam        | Removed | `mountPluginRoutes` / `collectPluginOpenApiPaths` — re-addable when plugins exist               |
| Plugin config override   | Removed | Per-plugin `.spur/plugins/<name>.yaml` — re-addable                                             |
| Event registry           | Removed | Glob-pattern + rate-limiting wrapper over `EventBus` — re-addable                               |

## 7. Planning Layer Surface (reserved — ADR-020; filled by Roadmap §1.5 Stage D)

Landing zone for the rd3-migration design output, reserved now so the system design has a defined
home and lands as subsection fills, not doc restructuring. Nothing below is invokable until
shipped (`05 §9` tracks status).

| Subsection                               | Will own                                                                                                                               | Design input until filled                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 `spur task` commands                 | Verbs, flags, exit codes — CRUD, WBS, `--section --from-file`, list/kanban, check, batch-create, resolve, migrate                      | triage doc Group A                                                                                                   |
| 7.2 `spur feature` commands              | Verbs/flags — CRUD, INDEX refresh, task-links, check, goal derivation                                                                  | triage doc Group B + the feature-file design spec (`cc-agents/docs/plans/2026-06-10-rd3-tasks-operator-feedback.md`) |
| 7.3 Frontmatter schemas                  | Zod field tables for task + feature files incl. `schema_version`, `parent_wbs`, `feature-id`, status enums                             | same design spec + triage A18/X02                                                                                    | `packages/domain/src/planning/schema.ts`; `taskFrontmatterSchema`, `featureFrontmatterSchema`, `TaskStatus`, `FeatureStatus` (DD-01/02/03/07/10/13/14). |
| 7.4 Section-Status-Matrix + format rules | Config file shapes under `./config` (ADR-015); warning-first enforcement core                                                          | triage A13/A14; `03 §12.3`                                                                                           |
| 7.5 Lifecycle workflow definitions       | `config/workflows/` task/feature lifecycle YAML shapes + guard wiring                                                                  | ADR-022; `03 §12.2`                                                                                                  |
| 7.6 Task DTOs                            | oRPC contract shapes for the board                                                                                                     | server/web design task (ADR-021.b)                                                                                   |
| 7.8 `sp:dev-*` command operations        | Dev-\* operation map (13 ops: 9 `Skill()`-backed + 4 inline; `implement` is a sub-mode of `run`; `dev-dogfood` → `sp:dogfood-testing`) | `plugins/sp/skills/spur-dev/references/dev-operations.md`                                                            |

### 7.1 `spur task` commands

| Planned extension | Status |
| --- | --- |
| [Task creation and readiness](design/task-creation-readiness.md) | Approved design; F21 / ADR-109; not yet shipped |

The command table below continues to describe the current registrations.

Core CRUD and utility verbs. Every subcommand supports `--json` (ADR-010 invariant).
Source: delivery §1.1, design §10.

| Command                                | Flags                                                                                                                                    | Exit    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur task`                            | — (noun help)                                                                                                                            | 0       | Lists subcommands if no subcommand given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `spur task create <title>`             | `--feature <id>` `--parent <wbs>` `--template <variant>` `--dedupe-within <seconds>` `--allow-duplicate-name` `--folder <path>` `--json` | 0/1/2/3 | Race-safe WBS allocation; every create rejects an identical case-insensitive title in the same collision scope (same `--feature`, or no feature for unscoped creates) created within 300 seconds by default (exit 3, `duplicate-follow-up`); `--dedupe-within` accepts a positive-integer override; `--allow-duplicate-name` disables the guard. `--feature` enables B09 Goal→Background derivation; `--template` selects a section-matrix variant (`standard·feature-impl·issue·review·meta·brainstorm`; default `feature-impl` when `--feature`, else `standard`); unknown variant or invalid dedup window → exit 2. With `--json`, duplicate errors include `error.code`, `existingWbs`, `existingName`, and `attemptedName`; the success envelope carries additive top-level `wbs`/`filePath` mirrors of `ref.id`/`ref.filePath` so scripts projecting the `task list/show` key vocabulary never read nulls on success.                                                                                                                                                                                                                                                                        |
| `spur task show <wbs>` (alias `get`)   | `--folder <path>` `--json`                                                                                                               | 0/1     | Frontmatter is a top-level field in `--json` output. `get` is a registered alias (task 0534 R1): the lexical suggester cannot bridge `get`→`show`, so agents guessing `get` previously got a bare `unknown command`. One command, one help entry, one code path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `spur task update <wbs> <status>`      | `--section <name> --from-file <path>` `--feature <id>` `--priority <p>` `--ac-numbering <mode>` `--folder <path>` `--json`               | 0/1/2   | Status transition runs lifecycle guard; `--section` reads body from file; `--feature`/`--priority`/`--ac-numbering` set the scalar frontmatter field on an existing task (the only post-create path, allow-listed to `feature_id`/`parent_wbs`/`priority`/`ac_numbering`, plus `done_forced`/`done_reason` written by the verdict-guard override). `--force-done` waives the verify **verdict** only — the FSM path still applies, so from an earlier status walk the hops first: `todo` → `wip` → `testing` → `done`, each running the structural `spur task check` (task 0487 R7b). An explicit `--section Solution --from-file` body must carry at least one recognized `file:line` citation (backticked `` `path:line` ``, bare `path.ext:line`, or adjacent file/line table cells) — validated at the write seam with the same predicate as the L3 checker (task 0510 R1), so an invalid authored Solution exits 3 before any mutation instead of being rejected later by `task check`; placeholder creation via templates / `sections init` is unaffected. `--ac-numbering task-local` opts a pre-existing task into the L3 Requirements↔AC coverage check; new tasks receive the field from the task templates. **Authoring-time size warning (0575 R1):** a `--section Requirements` or `--section Plan` write re-evaluates the whole post-write task body via `evaluateTaskSize` against `DEFAULT_TASK_SIZE_LIMITS` (max 10 R-items / max 16 Plan items — the same caps the pipeline precheck enforces, sole owner of the thresholds) and appends any `Task has N …` reasons to the result's `warnings[]` — stderr in human mode, inside the JSON payload under `--json`. Advisory only: the write has already landed, the exit code stays 0, and no other section ever runs the evaluation. |
| `spur task deps <wbs> <op> [values...]` | `--folder <path>` `--json`                                                                                                                   | 0/1/2/3 | Mutate `dependencies[]` frontmatter. Ops: `set <wbs...>` replace / `add <wbs...>` append (deduped) / `remove <wbs...>` drop / `clear` empty. WBS format, existence, self-edge, duplicate, and cycle validation all run before any write (atomic). Exit 3 = validation error, 2 = unknown op. |
| `spur task sections <wbs> <op> [name]` | `--folder <path>` `--json`                                                                                                                 | 0/1/2/3 | Canonical section mutation (matrix-enforced). Ops: `init` add every required section for current status (idempotent); `add <name>` add one canonical section (rejects unknown/forbidden); `list` read-only matrix resolution (required/optional/forbidden + present/missing). Names validated against `TASK_CANONICAL_SECTIONS` + variant/status matrix; universal sections always allowed. Writes go through the planning-write-service `updateSection` pipeline (phantom-section guards, atomic writes, history). |
| `spur task list`                       | `--status <s>` `--phase <p>` `--parent <wbs>` `--feature <id>` `--folder <path>` `--json`                                                | 0/1     | `--phase` is a legacy alias for `--status`; `--feature` filters to tasks carrying that `feature_id` edge (exact match) — the enumeration primitive for feature-level execution loops. Filters combine (AND).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur task refresh`                    | `--folder <path>` `--json`                                                                                                               | 0/1     | Re-scan the task corpus and report counts. The generated `kanban.md` artifact was retired in the A17 cutover (task 0192) once the web task-kanban board (task 0191) became the daily driver — this verb no longer writes any file. `--json`: `{folders, tasks}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `spur task refresh-roster <wbs>`       | `--folder <path>` `--json`                                                                                                               | 0/1     | Regenerate a parent's sub-task roster block inside its `## Plan` (the generator half of the 0121 roll-up gate, task 0123). Scans `parent_wbs` children, renders a WBS·title·status table between `refresh-roster` auto-gen markers, and writes it idempotently — inserting the block (preserving hand-written Plan content) when absent, rewriting it in place when present. Zero children → clean no-op (`written:false`); no `## Plan` → error. `--json`: `{wbs, childCount, written}`.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `spur task migrate`                    | `--dry-run` `--folder <path>` `--json`                                                                                                   | 0/1     | Run the A17 task corpus normalization pass over the active task folder or `--folder`. `--dry-run` computes the full per-file report with zero writes; apply writes through the corpus migrator's atomic write path. Idempotent: a second run over a migrated corpus is a no-op. The live `docs/tasks2/` corpus was migrated 2026-07-04 (task 0192).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `spur task migrate-anchors`            | `--dry-run` `--json`                                                                                                                      | 0/1     | Anchor-qualification pass (task 0583 R1–R3): rewrite every backticked evidence anchor whose basename resolves to exactly one tracked repo path into its repo-relative form, preserving the line spec byte-for-byte. Writes Testing/Solution bodies via `PlanningWriteService.updateSection` (the same path `spur task update --section` uses) — distinct from the `migrate` M-rules, which never touch bodies. Ambiguous basenames are reported with all candidates and left untouched (R2). `--dry-run` produces the full old→new report with zero writes; idempotent on a second apply. The tracked index comes from `git ls-files` at the repo root (`resolveRepoRoot`), so untracked/gitignored files (e.g. `.spur/run/**` external evidence, task 0584) are never a target. Rule `L4.anchor-subject-mismatch` (R4/R5; task 0688 / ADR-088; narrowed by task 0714 R1) fires when a live (non-terminal) record's citing row carries exactly one backticked anchor plus real subject tokens and the cited range does not name that subject. Subject tokens exclude every backticked anchor in the row. Default severity is warning; the 0583-R6 `tasks.severity` error override was removed after the matcher fix left 982 frozen-legacy residuals rather than a worked-down true-positive set. Bounds checking (`L4.stale-line-anchor`) always applies — including to terminal records — and still uses the **cited** range. Surface: `packages/app/src/services/anchor-qualifier.ts`, `task-check.ts`; finding code `packages/config/src/finding-codes.ts`. |
| `spur task batch-create --file <json>` | `--folder <path>` `--json`                                                                                                               | 0/1     | Create many tasks from validated JSON — all-or-nothing for child creation; validated against `apps/cli/schemas/task-batch.schema.json` (A08/C03). After children land, every distinct `parent_wbs` is wired best-effort: parent roster refresh + `todo→wip` lifecycle transition. `--json`: `{created, wbs, parentsWired:[{wbs, rostered, transitionedTo, errors[]}]}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `spur task resolve <file-path>`        | `--folder <path>` `--json`                                                                                                               | 0/1     | Maps a path to owning task (WBS + file). Returns 1 if no match. Strategies: direct match, filename WBS parse, walk-up (A10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur task path <wbs>`                 | `--folder <path>` `--json`                                                                                                               | 0/1     | Resolve a WBS to its absolute task file path across configured task folders. Exit 1 when not found. |
| `spur task check [<wbs>]`              | `--strict` `--strict-core` `--as <status>` `--fix` `--corpus` `--since <ref>` `--folder <path>` `--json`                                                         | 0/1/2   | Four-layer validation (§3). L4 traceability: `feature_id`/`parent_wbs`/`dependencies` edge resolution + **AC coverage** (DD-09: task scenarios must be a subset of the linked feature's AC by normalized title — advisory before completion; errors at effective done) + **parent↔child roll-up** (ADR-020 amendment 2026-06-25, task 0121: for a decomposition parent, block effective `done` when a child remains open or the required roster/dependency link is missing; warn when all children are closed but the parent is still open; inert for tasks with no children). Validates all tasks in the active folder when `<wbs>` is omitted; a WBS-targeted check (`<wbs>` present, no `--folder`) resolves the task across **all configured task folders** — the same resolution as `task show`/`task path`/`task update` — while an explicit `--folder <path>` is normalized to an absolute path and restricts lookup to that single directory, so relative and absolute spellings produce identical findings; unscoped checks and `task list` remain active-folder-only (task 0522); `--strict` elevates ALL warnings; `--as <status>` evaluates the task as if it were already in `<status>` (F92 R2 — the lifecycle guards pass the transition target so `testing→done` checks the `done` row and executes `done.gate:true`); `--strict-core` is retained as a temporary compatibility alias. `--as` is validated against canonical task statuses. **Explicit corpus audit (ADR-108):** `--corpus` checks active tasks and features with cross-folder reference/identity resolution; `--since <ref>` scopes the advisory fog comparison. No baseline or severity override suppresses findings; warnings alone pass. Legacy `baselined` counts are zero, `duplicateKeys` is empty, and `newErrors`/`newWarnings` contain all findings. Cannot combine with WBS, `--folder`, `--as`, `--fix`, or strict switches; invalid combinations exit 2. Routine gates never invoke the audit. Matrix loaded from `.spur/tasks/section-matrix.yaml` with the bundled matrix fallback. |
| `spur task verdict <wbs>`              | `--from-answer <path>` `--folder <path>` `--json`                                                                                        | 0/1     | Derive the PASS/PARTIAL/FAIL/UNKNOWN gate verdict from the verify-step answer file and write `.spur/run/<wbs>-verdict.json`. Parses requirement rows, AC rows, and checks rows; behavior-bearing CORE AC rows marked `MET` without `test`/`command` evidence are downgraded to `PARTIAL` and surfaced via `evidence-rule-failed`. A `MET` requirement/AC row whose evidence is absent, empty, or whitespace-only is hollow (0721): the row is retained, the aggregate is `PARTIAL` (never `PASS`), and one `hollow-met-evidence` major check names every hollow row — the shared aggregation rule (`aggregateVerifyVerdict`) is authoritative, so persisted artifacts, completion checks, record rendering, and the tracked-Testing fallback fail closed identically. Warns (stderr, non-fatal) when no requirement row matches any scenario in the task's linked feature — bare `R1`-style ids derive a verdict but credit no scenario at the feature done gate (dogfood 2026-08-15, I3). The deterministic replacement for grep-over-prose in the pipeline verify step (0109). Consumed by the completion gate and by `spur task record`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `spur task record <wbs>`               | `--verdict-file <path>` `--solution-from-diff` `--transition <status>` `--folder <path>` `--json`                                        | 0/1     | Write Testing/Review from verify verdict; optional Solution backfill from `git diff` and status transition. Preserves `acceptanceCriteria[]` evidence rows in Testing when present. A `--transition done` with a **PASS** verdict auto-walks `wip → testing → done` through the FSM and auto-creates the `pipeline` run-link the provenance gate requires (task 0436 R4); a non-PASS verdict to `done` surfaces a single `GuardDeniedError` instead of a bookkeeping retry loop.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

| `spur task verifyall-aggregate`        | `--from-file <path>` `--json`                                                                                                             | 0/1     | Read a JSON array of `{wbs, outcome[, reason]}` and emit the deterministic batch verdict; NOT-STARTED excluded from the rollup. Default input `.spur/run/verifyall-batch-input.json`. Replaces agent-discretion rollup prose (task 0341). |
| `spur task run-link <wbs>`             | `--source <src>` `--run-id <id>` `--json`                                                                                                | 0/1     | Record a pipeline provenance run-link for a task (used by `--next` auto chains to satisfy the testing→done guard). Idempotent: re-run prints already-exists and skips. `--source` default `chain`; `--run-id` auto-generated when omitted. Shared ensure helper with `task record` (task 0436). |

**Explicit audit diagnostics (0766, 2026-09-06).** The optional Git fog comparison reports its
evaluated range or an explicit `SKIPPED` reason on stderr (including non-Git/shallow checkouts and
unresolvable `--since` refs). This does not change audit severity, exit policy or the single JSON
document on stdout; required structural-check failures still fail the audit.

**D61 completion policy (0765 re-verification, 2026-09-06).** Normal task and feature checks
reject unresolved declared feature/parent/dependency references. At effective `done`, required
scenario, verdict, dogfood and roll-up findings are errors; severity overrides cannot suppress
them. Optional absent references and presentation warnings remain advisory. The shared summary
applies this policy before overrides, including checks invoked through lifecycle guards.

**Projection-content additions (tasks 0625, 0688; ADR-090 / task 0691; 0714 R1).** `spur task check`
emits `L4.testing-verdict-stub` for the record-generated hollow Testing row (error at effective
`done`, warning before completion). Anchor content
matching (task 0714 R1): every Testing/Solution citation still receives repository-relative path
existence and line-bounds validation (`L4.stale-line-anchor`) regardless of record status;
terminal (`done`/`cancelled`) records stop there — their evidence is historical (ADR-092) and no
subject/drift heuristic runs against it. A live record is subject-matched only when its citing row
carries exactly one parsed line anchor and yields real subject tokens (no filename-derived
subjects; no whole-file relocation scan); a failed exact-range comparison then reports
`L4.anchor-subject-mismatch`. The matcher reads exactly the cited line range and excludes every
backticked anchor in the row from subject tokens (0688 R1/R2; 0691 retired the
±`ANCHOR_WINDOW_LINES` window — cited-range only). `L3.testing-coverage` is retired (bunfig.toml
already enforces 90/90); `L3.status-claim-contradiction` is retired (ADR-090 F96 disposition
DELETE). Exact triggers and tokenization:
[`lifecycle-projection-integrity.md`](design/lifecycle-projection-integrity.md) §2.

**Exit codes:** 0 success, 1 error, 2 invalid usage. Follows the design §10 `api-response` envelope
for `--json` output (`{ ok, data? }`).

### 7.2 `spur feature` commands

Core feature verbs over `PlanningWriteService` (same write path as tasks). Features use
position-encoding hierarchical IDs (DD-14): single-letter top-level groups, children append one
digit 1–9 per level; ID length = depth; parent = drop the last character; **no `parent_id` field**.
Every subcommand supports `--json` (ADR-010 invariant). Source: delivery §1.2, design §2.2/§2.4.

| Command                                | Flags                                                                                        | Exit  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur feature`                         | — (noun help)                                                                                | 0     | Lists subcommands if no subcommand given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spur feature create <name>`           | `--parent <id>` `--folder <path>` `--json`                                                   | 0/1   | ID allocated under the create-lock (R1): `--parent` → next free child digit 1–9; no parent → next free group letter A–Z.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur feature show <id>` (alias `get`) | `--folder <path>` `--json`                                                                   | 0/1   | Returns the feature summary + content; 1 if not found. `get` is a registered alias (task 0534 R1) mirroring `spur task show` — the noun is symmetric (show by id), same discovery gap. One command, one help entry, one code path.                                                                                                                                                                                                                                                                                                                                                                                                             …
| `spur feature update <id> [status]`    | `--field <key> --value <v>` `--section <name> --from-file <path>` `--folder <path>` `--json` | 0/1/2 | `<status>` runs the lifecycle transition (guarded, §7.5); `--field/--value` sets a scalar frontmatter field; `--section/--from-file` replaces an existing feature section body using the same body-only contract as `spur task update --section`. Section, field, and status updates may be composed in one invocation and apply in that order. 2 if an option pair is incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `spur feature advance <id>`            | `--to <status>` `--folder <path>` `--json`                                                   | 0/1   | Walk a feature through the legal forward lifecycle path (`backlog→active→verifying→done`, default target `done`). Runs the same feature checks the old wrapup shell ladder used before guarded hops (`active→verifying` non-strict, `verifying→done` strict), verifies observed status after each transition, and returns `{id,status,hops}` in `--json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spur feature list`                    | `--status <s>` `--priority <p>` `--folder <path>` `--json`                                   | 0/1   | Lists features sorted by ID; optional status/priority filters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `spur feature check [<id>]`            | `--strict` `--as <status>` `--fix` `--folder <path>` `--json`                                        | 0/1   | Four-layer validation (§3): L1 schema, L2 section-matrix, L3 BDD AC (shared 0043 module) + one-active-P0-goal over `active` (0418: `verifying` is terminal-bound and no longer counts as a goal; `--as <status>` evaluates the rule against the post-transition status so lifecycle guards never deny the exit they relieve) + ≤9-children (DD-14, corpus-derived), L4 incoming `feature_id` edges + orphan-scenario warnings + **AC coverage** (DD-09) + verdict-backed AC satisfaction from canonical `id` rows or the `scenario` compatibility alias + bounded malformed-artifact diagnostics + verifying-readiness (linked tasks not done/cancelled). Validates all features when `<id>` omitted; `--strict` elevates warnings. Details: [`feature-check-strict-ac-satisfaction.md`](design/feature-check-strict-ac-satisfaction.md). |
| `spur feature refresh`                 | `--feature <id>` `--all` `--folder <path>` `--json`                                          | 0/1/2 | Regenerate the deterministic global `INDEX.md`; exactly one of `--feature <id>` or `--all` is required. `--feature` rewrites only that feature's `## Tasks` marker region, while `--all` opts into every feature. Missing or conflicting breadth exits 2. Feature lifecycle status, non-marker feature content, and all task files are preserved (task 0625; ADR-051 consent).                                                                                                                                                                                                                                                                                                                                                         |
| `spur feature move <id> --parent <id>` | `--parent <id>` `--dry-run` `--folder <path>` `--json`                                       | 0/1   | Cascade-rename (DD-14): re-IDs the node + all descendants (ID encodes position), renames their files, rewrites each `id` frontmatter + appends a move History line, and updates every task `feature_id` edge. Validates the full old→new plan first (collision / ≤9 / not-into-own-subtree); applies atomically with best-effort rollback. `--dry-run` returns the old→new map + affected tasks with zero writes. Omit `--parent` to move to a top-level group.                                                                                                                                                                                                                                                                                                                                                                           |

L4 verdict-backed AC satisfaction reads coverage in a fixed order: the `<wbs>-verdict.json`
artifact when present (authoritative, never merged or tiebroken), else the task's tracked
`## Testing` section via `parseTesting` (F93/0671), else an `L4.evidence-not-recoverable` named
state for evidence that predates durable recording (F93/0672).

**Dogfood identity (task 0625).** For self-referential workflow work, `feature check` accepts a
report only when the feature ID appears as a non-alphanumeric-delimited filename segment; an
incidental substring does not satisfy `L4.dogfood-missing`. Exact shape:
[`lifecycle-projection-integrity.md`](design/lifecycle-projection-integrity.md) §3.

ID rules (DD-14): valid IDs match `^[A-Z][1-9]*$`. The `## Tasks` auto-gen markers are
`<!-- AUTO-GENERATED by spur feature refresh -->` … `<!-- END AUTO-GENERATED -->` (recognized by
`MarkdownDocument.replaceMarkerRegion`). The full `spur feature` surface
(create/show/update/advance/list/check/refresh/move/sync) is now live.

**Root-node discipline (ADR-063).** Because the ID encodes position, the single-letter root set is
the product's coarsest map and a new letter is effectively permanent. File new work under the
feature that already owns its primary object; **a new top-level node requires explicit operator
consent**, requested with the candidate parents considered and why each was rejected. The ≤9-children
cap is never a reason to add a root letter — a full parent means nest deeper or repick the parent.
Misplacement is cheap to correct: `spur feature move <id> --parent <id>` cascade-renames the subtree
and rewrites every task `feature_id` edge, with `--dry-run` to preview.

### 7.3 Frontmatter schemas

Task and feature files share a `schema_version: 1` strictness gate (DD-03) and are written only
through `PlanningWriteService` (§7.5). Canonical field tables below; authority is the Zod schemas
in `packages/domain/src/planning/schema.ts` (`taskFrontmatterSchema`, `featureFrontmatterSchema`).

### 7.3.1 Task frontmatter — `taskFrontmatterSchema`

Mirrors `docs/design/rd3-migration-design.md` §2.1. Exported by
`@gobing-ai/spur-domain` from `packages/domain/src/planning/schema.ts`.

| Field            | Zod type                                                  | Req | Notes                                          |
| ---------------- | --------------------------------------------------------- | --- | ---------------------------------------------- |
| `schema_version` | `z.literal(1)`                                            | ✔   | Strictness gate; future evolution (DD-03).     |
| `name`           | `z.string().min(1)`                                       | ✔   | Title; used in slug.                           |
| `description`    | `z.string().optional()`                                   | —   | No `description == name` default (DD-10).      |
| `status`         | `z.enum(TASK_STATUSES)` (transform → lowercase)           | ✔   | See §7.3.3; aliases accepted on input only.    |
| `type`           | `z.enum(['task','brainstorm']).default('task')`           | —   | `brainstorm` retained for corpus compat.       |
| `profile`        | `z.enum(PROFILES).optional()`                             | —   | Single key (DD-02); legacy `preset` collapsed. |
| `feature_id`     | `z.string().regex(/^[A-Z][1-9]*$/).nullable().optional()` | —   | Single traceability edge (DD-07).              |
| `parent_wbs`     | `z.string().regex(/^\d{4}$/).nullable().optional()`       | —   | Single sub-task convention (X02).              |
| `priority`       | `z.enum(['P0','P1','P2','P3']).optional()`                | —   | Aligned with the feature priority scale.       |
| `tags`           | `z.array(z.string()).optional()`                          | —   | Free-form filtering.                           |
| `ac_altitude`    | `z.enum(['graduating','task-local']).optional()`          | —   | DD-09 altitude contract (ADR-062, task 0584): `task-local` skips the subset rule; absent/`graduating` enforces it. Field-only, never inferred (R4). |
| `dependencies`   | `z.array(z.string()).optional()`                          | —   | Soft WBS refs; `check` warns on dangling.      |
| `created_at`     | ISO 8601 string                                           | ✔   | Write-service-owned.                           |
| `updated_at`     | ISO 8601 string                                           | ✔   | Written **only** by the write service.         |

Removed from the legacy schema (A17): `impl_progress` (frozen-state problem), `folder` (derivable from
file location), `preset` (collapsed into `profile`).

**External-evidence citation form (ADR-062, task 0584).** Evidence that lives OUTSIDE `spur`'s working
tree uses a frozen non-anchor form — a named origin plus a backticked path with the line number
**outside** the backticks:

```
Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 481 — omp call_id write
```

`checkLineAnchors` classifies it as external and never raises `L4.stale-line-anchor` for it (R1); a
citation whose basename resolves uniquely inside this repo is in-repo evidence and must use the
repo-relative backtick form `` `path:line` `` — the external form still reports there (R2).

### 7.3.2 Feature frontmatter — `featureFrontmatterSchema`

Mirrors `docs/design/rd3-migration-design.md` §2.2. No `parent_id` field (DD-14): the parent is derived
by dropping the last character of `id`.

| Field            | Zod type                                           | Req | Notes                                                                                                                                        |
| ---------------- | -------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | `z.literal(1)`                                     | ✔   | Same evolution mechanism as tasks.                                                                                                           |
| `id`             | `z.string().regex(/^[A-Z][1-9]*$/)`                | ✔   | Position-encoding hierarchical ID (DD-14).                                                                                                   |
| `name`           | `z.string().min(1)`                                | ✔   |                                                                                                                                              |
| `status`         | `z.enum(FEATURE_STATUSES)` (transform → lowercase) | ✔   | See §7.3.3; `verifying` is canonical.                                                                                                        |
| `priority`       | `z.enum(['P0','P1','P2','P3']).optional()`         | —   | Optional for parity with tasks; consumers default a missing value to `P2`. The P0 feature in `active`/`verifying` is the project goal (B09). |
| `tags`           | `z.array(z.string()).optional()`                   | —   |                                                                                                                                              |
| `created_at`     | ISO 8601 string                                    | ✔   | Write-service-owned.                                                                                                                         |
| `updated_at`     | ISO 8601 string                                    | ✔   | Write-service-owned.                                                                                                                         |

### 7.3.3 Canonical status vocabularies

Lowercase canonical values (DD-01); display layers capitalize. Input is case-insensitive and
alias-tolerant. The legacy alias map is preserved as input normalization — never as storage.

| Domain          | Canonical values                                                    |
| --------------- | ------------------------------------------------------------------- |
| `TaskStatus`    | `backlog · todo · wip · testing · blocked · done · cancelled`       |
| `FeatureStatus` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) |

Input normalization (excerpt, full map lives in `normalizeTaskStatus` / `normalizeFeatureStatus`):
`completed → done`, `in-progress / in_progress / in progress → wip (task) or active (feature)`,
`dropped / canceled / cancel → cancelled`, `review / in-review / in_review → verifying` (feature only),
`pending / new → backlog`, mixed case accepted via `.trim().toLowerCase()`. Storage is always the
lowercase canonical form; aliases never persist.

**Status icon SSOT (R1).** `TASK_STATUS_ICONS` and `FEATURE_STATUS_ICONS` in
`packages/domain/src/planning/schema.ts` map each canonical status to a presentation emoji.
Consumed by the board toggle group, swimlane headers, and CLI `spur task show`/`list` output.
Storage values stay lowercase canonical (DD-01); the icon is presentation-only and never persisted.

### 7.4 Section-Status-Matrix + planning event catalog

**Section-Status-Matrix.** Source: `config/tasks/section-matrix.yaml` (schema:
`apps/cli/schemas/section-matrix.schema.json`). The YAML declares a root `$schema` ref and is loaded

- validated by the standard `loadStructuredConfig` path (`loadSpurConfig` in
  `apps/cli/src/config/loader.ts`, with the schema embedded for `--compile` binaries) — a typo'd section
  name or status key fails loud at load instead of becoming a dead rule. (The Zod `sectionMatrixSchema`
  in domain remains the typed contract + unit-test surface.) Each **template variant**
  (`standard·feature-impl·issue·review·meta·brainstorm` — the unified
  `TASK_VARIANTS` axis selected by a task's `template:` frontmatter, defaulting to `standard`) maps a
  status → { required, optional, forbidden } section lists, evaluated by `spur task check` /
  `spur feature check` (the L2 layer, design §3.2). `spur task check` resolves the variant from
  `fm.template ?? 'standard'` (not `type`). Ships permissive (warning-first); the hard-gate core is the
  `done` status (Solution + Testing + Review required, `gate: true`) plus the AC/Solution/Review format
  rules. `Root Cause` is optional for `meta` tasks because process/chore investigations may retain
  causal evidence without adopting the stricter `issue` template. Authority for matrix semantics:
  design §3 (the L2 layer), delivery §3.2.

**Matrix-driven creation (single producer).** The same matrix is the **sole semantic authority**
for which sections a *new* task file carries, **per variant** (F92 R1). `spur task create` /
`batch-create` always render the body via the canonical
`buildTaskSkeleton` (`packages/domain/src/planning/task-skeleton.ts`) from the matrix entry for the
chosen variant + creation status — there is no second, inline section list in `task-service.ts` (the
removed `DEFAULT_CREATION_SECTIONS`) and no template-as-skeleton rendering path (the templates supply
**bodies** only). Packaged/compiled execution loads a matrix data asset copied/generated from the
canonical `config/tasks/section-matrix.yaml` and **fails loudly with the attempted paths** if no
asset is reachable — the removed `FALLBACK_MATRIX` made the same task render differently by
installation layout and defeated the SSOT. Per-variant section **bodies** (e.g.
`review`'s `#### Review Findings` input table under Background) come from the scaffold template files
(`config/templates/task/<variant>.md`), extracted by `extractTemplateBodies` and merged under the
task-specific bodies (Background/Requirements) — so variant boilerplate is **data, never hardcoded**.

**Target-aware lifecycle validation (F92 R2/R3).** `spur task check` accepts
`--as <status>` (a read-only `asStatus` projection). Frontmatter **schema** validation reads the real
document, while the lifecycle-dependent L2/L3/L4 policy evaluates
`effectiveStatus = asStatus ?? frontmatter.status`. The lifecycle guards pass the transition **target**:
`wip→testing` runs `--as testing` and `testing→done` runs `--as done`, so a testing task is checked
against the `done` row (`Solution + Testing + Review`, `gate: true`) — closing the defect where
`testing→done` evaluated the current `testing` row and never executed `done.gate:true`. The task file
is never mutated before the guard allows the transition. `--strict-core` is retained only as a
temporary compatibility alias for installed plugins/workflows; target-state selection supplies the
real done semantics.
Each remaining unfilled section gets an invisible HTML guidance comment (skipped by the L3 format
rules via `isPlaceholderBody`). **Creation status (§2.3 semantics):** a spec'd task (a `--feature`
link, or a batch item with `background`/`requirements`) is created at **`todo`** ("ready to execute"
— the HITL review gate, so Acceptance Criteria + Design + Plan are present); a bare capture is created
at **`backlog`** ("still preparing" — Background only). `Solution` is the implementation change-map
and first appears at `wip`; the L3 `file:line` rule only fires once it has real content.
`History`/`References`/`Notes` are universally allowed by the closed-world check (structural, present
throughout the lifecycle).

**Planning event catalog (X04).** The six planning events on `PlanningEventMap` + three engine-seam
events. All planning events are emitted by `PlanningWriteService` (design §7) and persisted to the
`planning_events` table (append-only ledger, rehydratable from `## History`). SSOT for the names is
the code: `packages/app/src/services/planning-write-service.ts` (`PlanningEventName` union) and
`packages/app/src/services/planning-events.ts` (`PlanningEventMap`). Document, never invent.

| Event                  | Fired when                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `task.created`         | A task file is created (including each item of a `batch-create`).                      |
| `task.updated`         | Any non-status write to a task (section edit, frontmatter change).                     |
| `task.transitioned`    | A task status change completes through the lifecycle workflow (includes cancellation). |
| `feature.created`      | A feature file is created.                                                             |
| `feature.updated`      | Any non-status write to a feature.                                                     |
| `feature.transitioned` | A feature status change completes (includes cancellation).                             |

Engine-seam events (from `ts-dual-workflow-engine`, per lifecycle/pipeline run — ADR-022):

| Event           | Fired when                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| `on_transition` | A workflow run moves between states — the seam planning events derive from. |
| `on_guard_fail` | A guard (e.g. `spur task check` pre-gate) blocks a transition.              |
| `on_complete`   | A workflow run reaches its terminal state.                                  |

### 7.5 Lifecycle workflow definitions

Source: `config/workflows/task-lifecycle.yaml`, `config/workflows/feature-lifecycle.yaml`.
Authority: ADR-022 (lifecycles are engine configuration — no local FSM); design §2.3 (graphs +
guard placements), §5.1 (skeleton). Both are `kind: state-machine` definitions validated against
the engine schema shipped by the CLI, referenced as
`@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (the schema file lives at
`apps/cli/schemas/state-machine-workflow.schema.json` and is exported via the package's
`./schemas/*` map).

| File                     | States (§2.3)                                                       | Initial   | Terminal      | Guards                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------- | --------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-lifecycle.yaml`    | `backlog · todo · wip · testing · blocked · done · cancelled`       | `backlog` | `[cancelled]` | `wip→testing`: `spur task check <wbs> --as testing`; `testing→done`: `spur task check <wbs> --as done` (F92 R3: guard evaluates the transition target)                                                                                                                                    |
| `feature-lifecycle.yaml` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) | `backlog` | `[cancelled]` | `active→verifying`: `spur feature check <id> --as verifying`; `verifying→done`: `spur feature check <id> --strict --as done` (0418: guards pass the edge target so the one-active-goal rule evaluates the post-transition state) |

Guard commands reference the check verbs (tasks: 0051/0057). The engine integration is **live**:
`spur task update <wbs> <status>` (0055) and `spur feature update <id> <status>` (0059) drive these
graphs through the dual-workflow engine via `LifecycleAdapter` / `FeatureLifecycleAdapter`
(create-or-attach a durable run keyed `task:<wbs>` / `feature:<id>`, file-wins re-seed per DD-04,
then `requestTransition` — a denied guard aborts the write with its report). The feature
`active→verifying` guard is non-blocking (warns when linked tasks aren't all done/cancelled, DD-13);
`verifying→done` is blocking (`feature check --strict`); `verifying→active` is rework (mandatory
History entry). Unconditional transitions use the engine's `always` guard (externally-driven via
`requestTransition`, not auto-advance). `done` is re-enterable (reopen, warned); `cancelled` is
truly terminal (no outgoing transitions).

**Status normalization invariant (0152):** the raw frontmatter `status` is case-normalized
(`normalizeTaskStatus` / `normalizeFeatureStatus`) at the `PlanningWriteService` boundary before
`requestTransition`, so the file-wins re-seed always receives a canonical lowercase state even when
the stored value is capitalized (`Backlog`), aliased (`completed`), or otherwise non-canonical. This
service-boundary normalization is the sole production entry into the engine transition path; removing
it re-introduces the `FSMError: Cannot reseed run … to undeclared state` crash for any case-drifted
task. See `packages/app/src/services/planning-write-service.ts:326,367`.

**Drift prevention:** `packages/domain/tests/planning/lifecycle-drift.test.ts` parses both YAMLs
and asserts state sets == the `TASK_STATUSES` / `FEATURE_STATUSES` unions from `schema.ts`. The
YAML files and the 0041 enums can never drift silently.

Validate: `spur workflow validate config/workflows/task-lifecycle.yaml` — full JSON-Schema
validation resolves the `@gobing-ai/spur` workspace package and passes (no `--no-schema`
needed). `feature-dev.yaml` uses the same resolvable ref.

**Task execution pipeline** — `config/workflows/task-pipeline.yaml` (design §6, ADR-022
"orchestration is configuration": YAML over the existing engine, zero engine code). `kind:
state-machine`, shape `precheck → implement → test [→ test-fix ↔ test-recheck] → review →
approve(HITL) → verify → record → done` (precheck failure short-circuits to `failed`; `approve`
routes to `failed` on rejection or `cancelled` on cancel). Invariants: it never touches files
directly — status moves use the normal `spur task update <wbs> <status>` verb and section writes go
through `spur task record` (0108) / `spur task update --section`, so the lifecycle guards apply
identically; `approve` is a `hitl.confirm` gate skippable with `--vars '{"profile":"auto"}'`.

**Rival pipeline — retired.** `config/workflows/task-pipeline2.yaml` (feature I6, task 0596) was a
parallel file beside the live pipeline, adding a `residual-sweep` FSM stage reached only via the PASS
verdict guard. It was **deleted rather than promoted** on 2026-08-20 (ADR-076): it had zero live
callers, and a resolved-fact comparison showed it declared **5** model queries against the canonical
pipeline's **4**, so promotion would have raised cost against a goal of lowering it. `task-pipeline.yaml`
is the single canonical task pipeline. Two-layer plan rendering is the inline driver's job
(`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:33-42`).

**D5 transition (ADR-071/072/076).** The proof-state invariant (ADR-071) requires remediation to be
separated from a digest-bound quality → review → `--fix none` proof chain. The task pipeline half
landed (task 0703, 2026-08-29): observe-only verify, entry-point capture, bounded remediation hop,
proof-block evidence, and fail-closed completion guards. The docs pipeline remains open under task
0704. The `task-pipeline2.yaml`
candidate was retired without promotion (ADR-076, 2026-08-20) — the invariant it was meant to
demonstrate stands on its own and governs any future candidate. Composition, action, gate, and artifact shapes are in
[`workflow-composition-contract.md`](design/workflow-composition-contract.md).

**Vars.** `wbs`, `profile`, `spurBin`, `agent`, `implementAgent`, `stepTimeoutMs`, `implementTimeoutMs`,
`maxImplementReqs`, `maxImplementPlanItems`, `qualityGateCmd`, `qualityGateMaxFixAttempts`, `gateProbeCmd`,
`formatCmd`, `implementScopeGuard`, `mutationPolicy`, `__hitlAnswer`, plus the proof-chain trio (task 0703):
`taskSpecPath` (task file resolved at `test` entry — `docs/tasks*` is excluded from the digest's
git-tree half), `proofDigest` (canonical capture at quality-gate entry, re-captured at
`test-recheck`), and `proofDigestNow` (live re-capture compared at verify entry and before
`record`). Three are command-shaped (the per-project override
surface): `qualityGateCmd` (default `bun run spur-check`) is single-sourced across the soft
probe, the `/sp:dev-fixall` input and the recheck; `formatCmd` (default `bun run format`) is the
post-implement auto-format; `gateProbeCmd` (default `bun run lint`) is the cheap red-detector run before
the full gate on `test-recheck` only — a red probe records `FAIL` and skips the full gate (empty ⇒ pre-0587
behavior, full gate every recheck). `review` is only ever entered through a **full green** `qualityGateCmd` —
only the full gate writes `PASS` (task 0587 R3). `formatCmd` is invoked best-effort (`${vars.formatCmd} ; exit 0`) — a
missing or failing formatter must not abort a run, because `qualityGateCmd` at `test` is the gate
that actually decides. **Implement-only pin (task 0454):** `implementAgent` is used only by the
implement `agent.run` hop; override with `--vars '{"implementAgent":"pi-zai"}'` without retargeting
review/verify. **Agent var precedence (task 0487 R4):** caller `vars.implementAgent` > caller
`vars.agent` > `agent.default` > YAML literal, resolved per var — `--vars '{"agent":"claude"}'`
therefore reaches the implement hop too, where it previously lost to `agent.default`. Precheck logs
the configured resolution, not the interactive session model: `auto` resolves through the configured
role/tier and usable-executor selection; capability attestation gates the chosen executor before spawn.
No session-model inheritance is implied. **Remediation policy (0777):** `mutationPolicy` defaults to
`code`; test-fix reads the task's explicit standalone `mutationPolicy: <value>` declaration in its
body (or frontmatter). Automatic fixall requires both run and task policies to be `code`. `none`,
`tests`, invalid or ambiguous declarations halt before agent dispatch, preserving the failed gate
for scoped manual remediation. A permissive run override cannot weaken a restrictive task policy.
**Precheck (deterministic and doctor-free since 0723):** precheck runs no
`doctor.probe` and spawns no `spur agent doctor` subprocess on any execution surface — the inline
driver executes host-side actions too, so `--agent inline` never implied a bypass. Executor
liveness, routing, and native capability attestation stay fail-closed at the `agent.run` dispatch
boundary (0706): precheck does not predict what dispatch proves. The `doctor.probe` built-in
remains registered for idea-pipeline, which intentionally elects an executor at `start`.
**Size precheck (0454; count-only since 0723):** `maxImplementReqs` (default `10`) and
`maxImplementPlanItems` (default `16` — the operator-approved doubling of the original 5/8
defaults) feed `plugins/sp/scripts/task-size-precheck.ts`, a deterministic count-only check of
R-items and Plan checklist items with no `--executor` flag and no doctor call. A missing or
failing size checker writes FAIL (never PASS), so readiness fails closed; a raised limit is an
explicit size override, not a capability grant. precheck→implement requires
`.spur/run/<wbs>-precheck-size.status=PASS` plus `spur task check <wbs>` (run exactly once, in
the guard). Auto-profile feature reactivation is single-shot (`feature sync`, one
`feature update` fallback); a real reactivation failure surfaces and blocks implementation,
while dirty-tree diagnostics stay advisory.
**Evidence-channel precheck (0726 R2):** alongside the size check,
`plugins/sp/scripts/task-evidence-precheck.ts` makes a task's declared live-data evidence
calls deterministic. It parses the task content for `evidence-channel:` declarations; only the
exact channel `history_tool_call.args_raw[pi]` is allowlisted — any other token is an unknown
declaration and writes FAIL. With the exact declaration present, one fixed query
(`SELECT COUNT(*) AS n FROM history_tool_call WHERE args_raw IS NOT NULL AND source = 'pi'`)
runs on `.spur/spur.db` via bun:sqlite; a missing database, a missing table, or a zero count
also writes FAIL (fail closed). A task without any `evidence-channel:` declaration passes
without opening SQLite. The script always exits 0; the precheck→implement guard requires
`.spur/run/<wbs>-precheck-evidence.status=PASS` in addition to the size status, so a task that
declares live pi bash-command evidence must import real history (safe importer, non-dry-run)
before implementation begins.
**Diff-scope guard (task 0487 R1):** the implement step's `requireDiff` also rejects changes outside
the exact files and explicit directory/glob prefixes backticked in the target task's body, naming
the rogue files; new files beside an exact declared file are allowed, and a task body naming no
paths fails open. The guard snapshots the non-corpus tree before dispatch, so pre-existing dirt is
not attributed to the implementer. Set `--vars '{"implementScopeGuard":"off"}'` to bypass. **Edit surface:** change this YAML under
`config/workflows/task-pipeline.yaml` only (see §2.3 monorepo path model) — no hand-sync to
`.spur/workflows` or `apps/cli/config`.

**Step→command mapping (ADR-026, amended by ADR-043):** `implement` → `/sp:dev-run --mode implement`
(NOT `--mode full` — that drives this pipeline, so calling it here recurses); `test` → **the project
quality gate**, a soft shell probe of `${vars.qualityGateCmd}` plus a bounded pure-slash
`/sp:dev-fixall` loop — *not* `/sp:dev-unit`, which is the coverage gap-fill competency (router
C3/C5). The gate run is tee'd to `.spur/run/${wbs}-test-gate.log`, and the `test-fix` hop passes
`--gate-log .spur/run/${wbs}-test-gate.log` to `/sp:dev-fixall` so the fix agent starts at the
captured finding's `file:line` anchor rather than re-deriving the failure (task 0482 R3);
`review` → `/sp:dev-review` (→ `sp:super-reviewer` → `sp:code-verification` +
`sp:functional-review` + `sp:code-improvement`; three dimensions — SECUA / functional /
architecture, task 0227); `verify` → `/sp:dev-verify --fix none` (→ `sp:code-verification` verify
mode) — observe-only per task 0703/ADR-071: a repairable non-PASS routes once through the bounded
`verify → test-fix` edge (budget shared with the quality gate via
`.spur/run/<wbs>-test-fix-attempt`), and `test-recheck` re-captures `proofDigest` so the re-entered
quality → review → verify chain certifies a fresh state. Gate run output is a bounded summary
(task 0772 R1): a green gate prints status, attempt count, log path, and byte size; a red gate
prints at most the last 40 lines plus the log path — the durable full log on disk is never
truncated, and the log path is also what `test-fix` consumes.

**Completion gate (ADR-026; proof block per task 0703/ADR-071):** the `verify` step emits
`.spur/run/<wbs>-verdict.json` whose `checks[]` carries a `proof-input-digest` row and whose
`proof` block names the digest (`capturePoint: quality-gate-entry`) with per-stage results for
`qualityGate`, `review`, and `verification` — each carrying the same digest value. The
`verify → record` transition is a shell guard asserting `.verdict = PASS` AND `.proof.digest` + all
three stage digests equal `$proofDigest`, with a bounded `verify → test-fix` edge (repairable
non-PASS, budget unexhausted) and an `always` sibling `verify → failed` — so a PARTIAL/FAIL,
missing file, malformed JSON, or missing/mismatched proof evidence blocks `done` and always
terminates. This is the spur-native replacement for rd3's default-on `--postflight-verify`.
**Canonical verdict contract (task 0592, F92):** the verify artifact is validated and aggregated
by one runtime contract — `packages/app/src/services/verify-verdict.ts` owns the Zod schema
(`verifyVerdictSchema`), the parser (`parseVerifyVerdict` / `readVerifyVerdict`, distinguishing
missing / malformed JSON / structurally invalid / valid non-PASS / valid PASS, with the compatibility
aliases normalized in that one place — `scenario`→`id` on coverage rows, and `check`/`id`→`name` on
`checks[]` rows, the latter resolved for raw rows too via `checkRowName` because aggregation and the
done guard's `task-check` lookup run over unparsed artifacts; a check row carrying no label at all is
structurally invalid, since an unnamed check would silently exempt a failed task-check from the
completion rule), and the single aggregation policy
(`aggregateVerifyVerdict`) that answer derivation, persisted-artifact consistency, task/feature
validation, record rendering, and the done gate all share. The done-transition choke point
(`done-transition-guard.ts` `evaluateDoneTransition`) is the final authority: it re-parses and
re-evaluates the artifact, applying check severity (`blocker` → FAIL, `major` → PARTIAL,
`minor`/`advisory` non-blocking; legacy no-severity `fail` → FAIL / `warn` → PARTIAL) and denying any
PASS that is not internally consistent (a stored PASS whose coverage rows do not recompute to PASS,
including a row-less PASS, is treated as non-PASS). `--force-done --reason` remains the sole auditable
override; workflow routing (`verify → record/failed`) may route states but cannot weaken the final
transition.
**`task_run_links` pipeline linkage (kind=pipeline, R4):** resolved by task 0436 — `spur task record`
now auto-creates the `pipeline` run-link when recording a PASS verdict to `done`, so no link-writing
CLI verb is needed from a shell step.
**Step timeout (ADR-026 amendment, 2026-06-23, task 0107; raised task 0398 R4):** each `agent.run`
step carries a `timeoutMs` option — `${vars.stepTimeoutMs}` for review/verify/test-fix and
`${vars.implementTimeoutMs}` for the heavier implement hop, both defaulting to `"1800000"` (30 min).
On elapse the ts-libs `ProcessExecutor` kills the subprocess (never abandons it); the agent step
exits non-zero → `ok:false` → pipeline routes to `failed`, and a partial-work handoff artifact is
written to `.spur/run/<runId>-<state>-partial.md`. The artifact carries a `## resume context` block
naming the agent session dir (`.spur/run/<runId>/agent-sessions/<executor>/`) and the latched
session sidecar (`.spur/run/<runId>-agent-session.json`), so an operator resumes from the dead
agent's transcript instead of re-deriving it (task 0482 R4). Overridable per run via
`--vars '{"stepTimeoutMs":"120000"}'`. The `agent.run` action surface accepts `timeoutMs`
(number parsed from the workflow option or CLI string flag `--timeout`), forwarded through
`AgentService.executeRun` → `AiRunner.runPromptCommand` → `ProcessExecutor.run({ timeout })`.

**Declared step role (0538 R2).** Every `agent.run` step declares `role: <scribe|coder|reviewer|planner>`
beside its `agent:` pin — the Layer-1 role vocabulary (`DEFAULT_AGENT_ROLES`, `packages/config`).
`spur workflow validate` fails a step with no or an unknown role via the post-schema walk
(`collectAgentRunRoleViolations` — `packages/app/src/services/workflow-service.ts`; the JSON schema
validator is a keyword subset, so the walk is the enforcement surface). `spur workflow run` rejects
the same step at dispatch time via `AgentRunActionRunner`'s runtime guard — which is also the
fallback for any dispatch path that bypassed validate — so neither verb ever spawns a role-less
step. The runner threads
the role onto the underlying `spur agent run` — the `--json` envelope and the run trace record it —
and the step-reporter renders it on the action line (`role=<id>`). An `agent:` pin still beats role
routing permanently (0536 R2): the role declares the *reason*, so removing the pin later routes
correctly instead of falling to the default role.

#### Agent capability attestation

**Capability attestation (ADR-094 principle / ADR-102 contract, task 0706).** A `agent.run` step may declare
`requiresCapabilities` — a partial map over the closed axis vocabulary
`fsRead|fsWrite|networkEgress|processSpawn|externalMutationApproval` to a minimum level
`available|enforced` (`EXECUTION_CAPABILITY_*`, `packages/config/src/index.ts`). Executors attest
`executionCapabilities` (`version: 1`, partial `axes` map, per-axis `state` + `provenance`
`native-known|operator-configured|unattested`) in their agent-config entry. `AgentService`
dispatch resolves the target executor and compares requirements against the attestation BEFORE
spawning, re-checking on each escalation hop; a missing attestation, unknown axis state, or
level below the requirement fails closed (exit 2) with an axis-by-axis diagnostic naming required
vs. actual state and provenance. Missing data resolves to `unknown`, never permissive; tier is
never a capability signal. Satisfied gates record a bounded, redacted per-axis evidence payload
(axis/state/provenance only — no config blobs) on `routing.capabilities` in the run trace.
`AgentRunActionRunner` re-validates the option shape at the action boundary. Shipped reference
workflows attest the two unattended tree-mutating stages (`implement`, `test-fix` in
`task-pipeline.yaml`); observe-only stages stay undeclared.

**Usage propagation and hard budgets (ADR-095, task 0707, R1–R7).** Agent usage is a normalized optional
contract (`NormalizedAgentUsage`, `packages/app/src/services/agent-usage.ts`): `availability:
'measured'|'unavailable'` with typed token/cost fields only when actually reported — unavailable
stays unavailable with a reason and is **never** coerced to zero. The contract reads ONLY typed
structured fields off a runner result (R2); parsing stdout/stderr for accounting is rejected. The
installed `@gobing-ai/ts-ai-runner` facade exposes no structured usage today, so dispatch results
carry the honest `unavailable` shape (`AgentRunTracedResult.usage?`, `agent.execution.finished`, and
the trace-safe `WorkflowActionUsageSummary` projection) until the owning runner package publishes
typed fields — the seam normalizes them the day they appear. `agent.run` accepts optional
`maxTokens` / `maxCostUsd` hard budgets (R4): validated at the action trust boundary (positive
finite; string numbers accepted), evaluated once when the dispatch returns — wall-clock
(`timeoutMs`) remains the only mid-run control. Over-budget steps fail with per-cap violations and
emit a bounded `workflow.agent.budget` event (identifiers + scalars only; run-log records one line);
a cap that cannot be evaluated because usage is unavailable fails closed as `budget-unverifiable`
(R5) — never silently passed, never estimated from public price tables (R8). Actions that declare no
budget dispatch unchanged; failed dispatches keep their existing diagnostics (R7).

**Fail-closed operational trip wires (ADR-096, task 0708, R1–R8).** High-risk operational signals at
workflow/action safe boundaries are evaluated against a **closed, deterministic catalog**
(`packages/app/src/workflow/tripwire.ts`): `retry-exhausted`, `hard-budget`, `capability-denied`,
`proof-invalidated`, `output-drop` — each versioned, with a fixed `response` (`fail` for all but
`output-drop`, which records and continues) and an `nextDecision` recovery instruction (R1/R6). No
model call, no DSL, no new thresholds (Q&A). The agent-run action evaluates the wires once per
dispatch at the existing post-dispatch boundary, reading only already-normalized outcomes — the
budget verdict, the steering settle reason, the capability-attestation denial marker
(`CAPABILITY_BLOCK_PREFIX`), the bounded relay's drop counter — never duplicated state (R2/R5). A
fired wire emits the canonical bounded `workflow.tripwire.fired` event on the workflow observability
bus (policy id/version, run/action/task correlation, observed value, threshold, evidence refs,
next decision; run-log records one line) (R4). Fail policies return through the existing
action-failure semantics with the exact next decision in the error and the partial-work artifact
preserved, so the engine stops subsequent actions and the state machine follows its declared route
(R3/R7); `capability-denied` keeps the richer pre-dispatch failure path (no dispatch ever ran). The
steering boundary's timeout default is fail-closed: once the retry policy is exhausted and the
attempt failed, a steering timeout resolves `abort` with a `retry-exhausted` reason instead of
continue (R3). `proof.fingerprint` participates when composed with the observability bus: an
`expect` mismatch emits the `proof-invalidated` wire before failing through its existing mismatch
semantics. Deterministic fail-closed evaluation means an unknown signal id fails the evaluation
rather than silently passing, and drift between emitters and the catalog is caught by unit tests
pinning the closed catalog and the event map (R8).

**Fresh-context review independence (ADR-097, task 0710, R1–R8).** `agent.run` accepts `freshSession: true`
(R1): the action bypasses every inherited session knob (`__agentSessionDir`, `__agentSessionId`, the
`__agentSession` latch), dispatches into a per-node `fresh-<node>` session directory with no session
id, and publishes **only** routing evidence on success — never its own session identity — so a
review/verify hop cannot contaminate a later implement/test-fix resume. Every successful dispatch
persists bounded routing evidence under the workflow var `__agentRouting_<node>` (R3):
`{"agent": <resolved executor>, "model?"}` — identifiers only. The task pipeline's `review` and
`verify` steps declare `freshSession: true` and route by `role: reviewer` alone (R2/R7): the
implementation executor pin is gone, so review/verify resolve through the executor registry and the
reviewer's context comes only from the persisted task spec, the recorded diff, and run artifacts.
Risk policy (R4): a task's frontmatter priority (extracted to `taskPriority` at the quality-gate
stage) decides whether the P0/P1 distinct-executor rule applies — review/verify must then resolve a
DIFFERENT executor spec than `__agentRouting_implement` records; lower priorities (and unknown
priority) require fresh context only, with executor reuse allowed. Distinctness is evaluated AFTER
routing and BEFORE dispatch via the pure `review-independence` module (R5): missing implementation
evidence, unresolvable reviewer routing, and equal executor names all fail closed with the exact
configuration remedy (`roles.reviewer` tier override or an explicit pin) — never a silent dispatch.
Composition (R8): the live pipeline itself is checked — a proof-chain test fails if review/verify
re-pin an executor, lose `freshSession: true`, or drift from `compareExecutorWith: implement`, and
the composition baseline digest regenerates with every pipeline change.

**Escalation packets (ADR-098, task 0709, R1–R3).** A blocked or failed run emits exactly ONE
versioned escalation packet — a pure, deterministic projection over evidence that already exists
(`packages/app/src/workflow/escalation-packet.ts`). The packet carries `schemaVersion` (1), a stable
`fingerprint` (sha256 over run id + trigger + gate + evidence refs, so the same failure re-projects
to the same id), the trigger (`tripwire` | `terminal-failure`), and one unresolved operator decision
drawn from a closed vocabulary: `retry`, `revise_requirements`, `grant_capability`, `raise_budget`,
`inspect_failure`. The trip-wire policy → decision mapping is a closed catalog keyed on the ADR-096
gate ids; an unknown gate falls to `inspect_failure`. Evidence enters as **references only** — task,
run, proof, artifact, budget, capability, and event ids — never copied logs or payloads, and every
string field is bounded and redacted. JSON is the source of truth; Markdown is an optional render.
The sink (`packages/app/src/observability/escalation-packet-sink.ts`) writes the artifact under
`.spur/run/` plus one artifacts-table row, and gates emission on `isDryRunProbe(runId)` so a dry
probe never writes a packet (0753 R4) — an escalation channel that fires on probes is one nobody
reads. No new persistence plane is introduced.

**Checkpoint and indexed-context freshness (ADR-099, task 0711, R1–R5).** A session checkpoint is an
**advisory** resume projection under `.spur/memory/sessions/`; task/feature files and persisted
workflow state stay authoritative. `packages/app/src/workflow/checkpoint-contract.ts` fixes the
metadata contract at `CHECKPOINT_SCHEMA_VERSION = 1`: `sessionId`, `workflow`, `runId`, `taskWbs`,
`featureId`, `phase`, `status`, `lastGate`, `sourceCommit`, `digest`, `generatedAt`, `updatedAt`,
`nextAction`, and `artifacts[]` — the freshness fields the Session Checkpoint Convention documented
but writers never emitted. `parseCheckpointMetadata` returns `null` for any structurally invalid
file (missing or short frontmatter, missing required field, wrong schema version); callers must
report-and-ignore, never silently trust (R3). `TERMINAL_CHECKPOINT_STATUSES`
(`done`/`failed`/`cancelled`/`skipped`) bound cleanup: `WorkflowService.cleanCheckpoints` deletes
only expired, unreferenced, regenerable state inside its own confined owner path, and never a file
it cannot prove is a terminal checkpoint (R5). The plugin's
`plugins/sp/scripts/stage-registry-adapter.ts` keeps a self-contained lean copy of this semantics —
it installs into foreign repos and cannot import workspace packages — and a parity test pins the two
together.

**Verifier-owned verify answer file (task 0726, R3).** The verify step's `agent.run` declares
`expectFile` instead of `answerFile`: the verifier writes `.spur/run/<wbs>-verify-answer.txt` itself
(append-progress authoring — `Verdict: PARTIAL` first, one complete requirement/AC row at a time,
first verdict line replaced only after all rows are certified), and the host checks post-exit
existence without capturing or overwriting, so an interrupted verify leaves lintable partial rows
instead of losing the capture. A hard `verify-answer-lint.ts` gate runs after the agent exits and
before `spur task verdict --from-answer`, rejecting with row-level diagnostics: missing, duplicate,
or unknown requirement IDs (vs the task's bold `R#` items), AC IDs that do not exactly match a task
AC checklist label (or its leading token) or a linked feature scenario title, status/evidence-type
values the verdict parser would drop, and empty evidence. The lint's normalization mirrors
`packages/app/src/services/task-verdict.ts` exactly (compound evidence types included), so the lint
is a strict pre-filter of the verdict parser, never an independent dialect. On retry the verifier
keeps rows that pass the lint and verifies only the missing IDs.

**Task evidence precheck + verify answer lint (tasks 0726, R2/R3):** `precheck` gains a
fail-closed `task-evidence-precheck` step (same contract as the size precheck: PASS/FAIL to
`.spur/run/<wbs>-precheck-evidence.status`, always exit 0; a missing checker fails closed) and the
precheck→implement guard requires BOTH status files PASS. On the verify stage, the verifier OWNS
the answer file — `agent.run expectFile` (engine checks existence; the verifier authors it and
appends progress) — and a deterministic hard-gate lint step
(`plugins/sp/scripts/verify-answer-lint.ts`) runs between capture and
`spur task verdict --from-answer`: bounded row findings (max 10), non-zero exit writes nothing,
enforcing verdict-line shape, requirement row completeness/uniqueness/identity, status/evidence
validity, and AC-label identity against the task checklist (AC completeness stays a verifier
judgement, not a lint class). A lint failure halts the stage before the verdict step can misread a
malformed answer.

**Run status (ADR-044):** terminal states partition into success and failure via an optional
`failureStates` subset of `terminalStates` (declared per workflow; absent ⇒ today's behavior). Landing
in a failure terminal finalizes the run as `status: "failed"` through `lifecycle.fail` — the persisted
run row, the `workflow.run.failed` event, and the CLI exit code all agree, so **`status` alone is
authoritative for pass/fail**. Judge a run by `status === 'done'`, never by string-matching a
`finalState` name the caller does not own. Workflows declaring no `failureStates` still finalize every
terminal as `done` (backward compatible).

**Pipeline section-ownership model (ADR-026 amendment, 2026-06-23, task 0106):** every
`done`-required section ([Solution, Testing, Review]) is owned by exactly one pipeline step:

| Required section          | Owning step                    | When                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Solution` (change-map)   | `/sp:dev-run --mode implement` | After writing code — the implement agent authors a markdown table of changed files with `file:line` + `what/why`. Idempotent (upsert via `replaceSection`); writes only when the section is bare (absent, empty, or a placeholder). |
| `Testing` (verdict table) | `record`                       | Post-verify — transcribes the per-requirement verdict + evidence from `.spur/run/<wbs>-verify-answer.txt` and `.spur/run/<wbs>-verdict.json`.                                                                                       |
| `Review` (P1–P4 findings) | `record`                       | Post-verify — transcribes SECU findings from the verify output.                                                                                                                                                                     |

The `record` step provides a **Solution safety-net**: if the implement step didn't write
`## Solution`, `record` backfills a minimal change-map from `git diff --name-only`. A
`sectionIsBare` predicate (in `packages/app/src/services/task-service.ts`) detects absent,
empty/whitespace, or placeholder sections — the single reusable mechanism behind all three
writes.

**Done gate:** the `record → done` transition runs a shell guard `spur task check <wbs>` plus the
proof-block re-assertion (`.verdict = PASS` and `.proof.digest = $proofDigest`, task 0703 R5) with
an `always` `record → failed` sibling — mirroring the `verify → record` gate exactly. The guard
passes because every required section was guaranteed upstream and the evidence still names the
captured digest; a genuinely non-compliant task routes to `failed` instead of a silent bad `done`.

**Planning pipeline** — `config/workflows/planning-pipeline.yaml` (task 0088; design §6). Front-half
of the dev workflow: `phasing(HITL) → feature-id → design-gen → design-approval(HITL) → handoff`.
`kind: state-machine`, `vars: { slug, profile, feature }`, same engine as `task-pipeline.yaml`
(ADR-022 — zero new engine code). Companions the `sp:spur-plan` skill (how-to-think for the
non-deterministic steps: phasing judgment, feature-ID derivation, design-doc authoring). HITL gates
use `hitl.confirm`, skippable with `--vars '{"profile":"auto"}'` (Q4). Doc-write discipline (Q3):
auto-writes derived docs (`docs/design/*`, `docs/features/*`); **stages** `02_ROADMAP`/`04_DESIGN`
index edits to `docs/plans/` for human commit. Every authoritative-doc touch invokes `sp:doc-evolve`
(§5 sync triggers). Terminal at `handoff` (drafted feature list → `sp:spur-dev` steps 7–12) or
`cancelled`. Validates against the workspace state-machine schema.

**D5-K caller migration landed (task 0604; ADR-072 still Proposed).** Planning is absorbed into
the canonical idea/dev-plan path: `/sp:dev-plan` routes through `idea-pipeline.yaml`, the scaffold
manifest no longer carries a planning row, `listBundledProjectSeedFiles` excludes
`workflows/planning-pipeline.yaml` (`packages/config/src/bundled-config.ts` —
`RETIRED_PROJECT_SEEDS`), and no skill, README, or help table points at it. A fresh `spur init`
therefore never receives a second planning graph.

The **source file is deliberately retained** at `config/workflows/planning-pipeline.yaml`: deleting
it is gated on operator acceptance of ADR-072, which is also what resolves ADR-029's deferred
consolidation question. Until then it stays schema-valid and schema-valid (composition baseline retired, task 0767),
but nothing ships or invokes it.

### 7.6 Task DTOs (oRPC contract)

Transport DTOs live in `packages/contracts/src/task.ts` and are the single source of truth for the
wire shape. Domain types stay in `@gobing-ai/spur-domain`; transport DTOs belong in `packages/contracts`.

| DTO                     | Key fields                                                                          | Notes                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskSummarySchema`     | `wbs, name, status, priority?, featureId?, parentWbs?, type?, filePath, updatedAt?` | List response. `type` and `priority` are extracted from frontmatter by the server handler. `priority` is a free-form `z.string()` (not the `PRIORITIES` enum) because the corpus mixes `P0–P3` with `high/medium/low`; the raw value is passed through. |
| `taskCreateInputSchema` | `title, featureId?, parentWbs?, folder?, template?`                                 | `template` selects a `TASK_VARIANTS` scaffold (R8); defaults to `standard` or `feature-impl` (when `featureId` set).                                                                                                                                    |
| `taskActionInputSchema` | `wbs, action, channel?, skipDeps?`                                                  | `action` ∈ `refine\|plan\|run\|verify\|decompose\|evaluate`. `channel` ∈ `claude\|codex\|gemini\|pi\|opencode\|antigravity\|openclaw`; `skipDeps` is persisted in the queued job metadata for dependency-bypass-aware runners (R9).                     |
| `taskFolderSchema`      | `path, label?`                                                                      | Folder entry from `docs/.tasks/config.jsonc` (R6).                                                                                                                                                                                                      |

### 7.7 Workflow action primitives for anti-hallucination (ADR-024)

Two primitives back the anti-hallucination migration (superskill task 0041):

| Primitive                  | Surface                                                  | Description                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentService.runCapture`  | `packages/app/src/services/agent-service.ts`             | Opt-in capture path: returns `{ exitCode, answer }` without streaming or diagnostics. Uses buffered output mode.                                                                                                                                                                                          |
| Workflow `agent.run`       | `packages/app/src/workflow/actions/agent-run.ts`         | Always dispatches through `AgentService.runTraced`: buffered output, non-interactive stdin, and a sanitized resolved invocation persisted in `ActionResult.data`. `capture: true` only surfaces buffered stdout as `data.answer`. Direct `spur agent run` keeps its TTY-aware `run` / `runCapture` paths. |
| `response.validate` action | `packages/app/src/workflow/actions/response-validate.ts` | Reads `text` from options, calls injected `ResponseValidateEngine.validate()`, maps `{ ok, reason, issues }` to `ActionResult`. Engine injected via `SpurWorkflowBuiltinsOptions.responseValidateEngine` in `builtins.ts`.                                                                                |

**Engine seam:** `ResponseValidateEngine` interface (`{ validate(text: string): { ok, reason, issues? } }`) is the contract. The concrete engine is owned by superskill 0041 and provided by the externally-installed `cc:anti-hallucination` skill; the caller wires a thin adapter over its surface. The in-repo copy (`plugins/sp/skills/anti-hallucination/`) was removed once the migration completed (ADR-024 amendment, 2026-06-20); the seam itself is DI-only and unchanged.

**Retry/deny pattern:** transition-flow spike (`packages/app/tests/fixtures/anti-hallucination-spike.yaml`) confirms `validate → ok:done | fail:generate(bounded) | exhausted:denied` is expressible. `iterationBound` caps retries; a proper retry-count guard (checking `vars.__retryCount`) is future work (R3.1).

### 7.8 `sp:dev-*` command operations

The `sp:dev-*` commands back onto the orchestration spine plus competency skills
(`sp:spur-dev`, `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`,
`sp:functional-review`, `sp:code-improvement`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`) or define their procedure inline. The
authoritative reference for all 13 operations — purpose, inputs, backing, behavior contract — is
[`plugins/sp/skills/spur-dev/references/dev-operations.md`](../plugins/sp/skills/spur-dev/references/dev-operations.md).
The `runall` operation (#13) is the batch entry — interactive sequential omit/inline keeps the
driver loop in the host session; explicit/parallel execution delegates it to `sp:super-planner` per
[`execution-batch.md`](../plugins/sp/skills/spur-dev/references/execution-batch.md).
Model-bearing operations share the single execution-surface selector `--agent <inline|auto|name>`
(`inline` is the default when omitted; the former `--inline`/`--subprocess` flags are collapsed into
it, ADR-041/047). `--agent auto` / `--agent <name>`, or another named dispatch-surface trigger,
selects `spur agent run`; headless workflow operations retain their `agent.run` subprocess actions.
**Explicit `--agent inline` and an omitted `--agent` resolve identically (ADR-087, task 0687):**
`inline` is the default selector; host-session surfaces execute model-bearing work in the invoking
session, with eligible model stages allowed a native platform subagent per task-0508 eligibility
(now generalized to all inline resolutions). Headless surfaces (`spur agent run`, workflow
`agent.run`, serve-side dispatch) cannot host a session; `AgentService.resolveAgent` substitutes
tier resolution there and emits one warning naming the resolved executor — no rejection, no
frozen message, no `exit 2`. Genuine resolution failures keep the existing
`agent-resolution` envelope.
Interactive full task execution uses the YAML-backed host driver defined in
[`inline-pipeline-driver.md`](../plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md).
Interactive omit is host-controlled and **non-subprocess** (no `spur agent run`, no
`spur workflow run`), but eligible sequential model-bearing `agent.run` stages dispatch once to a
native platform subagent when the host exposes one with shared-worktree read/write/shell
capability; host fallback covers every ineligible stage, and post-dispatch failures follow the
stage error policy without host replay (ADR-047 amendment, task 0508). Operator confirmation
actions and approve/taste/ask decisions stay host-owned.
The SSOT is
[`cross-cutting.md`](../plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
The `review` operation resolves to deterministic modes: WBS mode runs functional traceability (`sp:functional-review`), SECUA framework (`sp:code-verification`), and architectural depth (`sp:code-improvement`), writing findings to the task's `## Review` section; Path mode runs advisory SECUA and architecture with no task mutation. `--fix` is deprecated (no-op + warning; route remediation → `/sp:dev-verify --fix`). `--next` was **removed** from `dev-review` (feature H8, task 0401 R3): it had been a deprecated no-op, and once `--next` was redefined as chain-to-completion with propagation (ADR-039) keeping a no-op spelling of a now-meaningful flag would have been the fourth contradictory meaning. Route progression through `/sp:dev-next`.
The `handover` operation writes the durable handover SSOT to `docs/handover/<YYYY-MM-DD>-<slug>.md` and appends a pointer link into the task's `References` / `Notes` without clobbering existing content.
See [`dev-operations.md`](../plugins/sp/skills/spur-dev/references/dev-operations.md).

| Pattern              | Operations                                                                                          | Backing                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Skill()` delegation | implement, unit, review, verify, run, refine, plan, docs, brainstorm, dogfood, runall, debug, daily | `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`, `sp:functional-review`, `sp:code-improvement`, `sp:spur-dev`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`, `sp:sys-debugging`, `sp:daily-summary` |
| Inline procedure     | changelog, gitmsg, fixall, handover                                                                 | git CLI + `spur` CLI + agent reasoning                                                                                                                                                                                            |

**Brainstorm artifact exits.** `dev-brainstorm` runs the grilling interview → ideation, then lands an
artifact via one of two **mutually exclusive** exits:

- `--task [<feature-id>]` — one `todo` task via `spur task create` (the fast path for a single unit
  of work; skips feature/AC ceremony on purpose).
- `--feature [<parent-id>]` — the **front-half entry**: `spur feature create`, then author Goal/Scope
  and BDD acceptance criteria from the decision trace through
  `spur feature update --section <name> --from-file <path>`, then loop
  the `spur feature check` gate to exit 0. Lands a validated feature and hands off to
  `/sp:dev-plan --feature <ID>` for schema-gated decomposition. Passing both exits is an error.

> **`dev-new-task` retired (2026-06-25).** The standalone single-task command was a thin wrapper over
> `spur task create` + intake; its use cases are absorbed by `dev-brainstorm --skip-discovery --task`
> (same result, seeds Background/Requirements/Plan). Operation count dropped 12 → 11.

**Pipeline step→command mapping (ADR-026):** `implement` → `/sp:dev-run --mode implement`, `test` → `/sp:dev-unit`,
`review` → `/sp:dev-review`, `verify` → `/sp:dev-verify` (§7.5). The remaining commands are
operator-invoked, not pipeline-driven.

### 7.8a Process inventory (Observability → Processes)

Task **0243**. The Processes tab is a **read-only** serve-rooted runtime inventory — not the
team control plane (`/api/team/*`).

| Surface                            | Contract                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/observability/processes` | Snapshot of the serve PID tree + supervisor overlay                                                                                                                                        |
| Success body                       | `{ processes: ProcessInventoryRow[], rootPid: number, capturedAt: string }`                                                                                                                |
| Row fields                         | `pid`, `ppid`, `depth`, `source` (`serve` \| `supervisor` \| `descendant`), `label`, optional `agentId`, `command` (may be truncated), `status`, `rssBytes`, `elapsedSeconds`, `startedAt` |
| Unsupported OS                     | `501` + `{ error, code: "UNSUPPORTED_PLATFORM" }` (macOS + Linux only in v1)                                                                                                               |
| Team APIs                          | Unchanged — `GET /api/team/processes` remains supervised-agents-only for control clients                                                                                                   |

**Mechanism:** `ProcessInventoryService` (`packages/app`) walks OS processes via a
`ProcessInspector` port (default: `ps -axo pid=,ppid=,rss=,etime=,command=`), filters to
descendants of `process.pid`, and overlays `SupervisorService.list()` by pid for agent labels.
Board UI polls every ~3s. Threads/%CPU, host-wide shell `spur` CLIs, and ProcessExecutor live
registry enrichment are deferred.

### 7.8b Tool-use ledger (Observability → Tool Using)

Tasks **0245** / **0246** / **0247** / **0248**. The Tool Using tab is a **read-only** tail of the
project token ledger written by indexed-context hooks (task 0232) — not a second event store and not
a control plane.

> This is the **Observability** module's tab. The History Board has a separate tab of the same name
> (feature E81, `design/history-board-tool-using-tab.md`) reading the imported forensic corpus over
> `POST /history/tool-sequence`. Different store, different surface — do not conflate them.

| Surface                                          | Contract                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/observability/tool-use?limit=&before=` | Newest-first page; `before` = exclusive ISO cursor for older pages                                                                                                                                                       |
| Query                                            | `limit` default **200** max **1000**; optional `before`                                                                                                                                                                  |
| Success body                                     | `{ events, count, limit, truncated, path, capturedAt, sparseToolActivity, nextBefore }`                                                                                                                                  |
| `nextBefore`                                     | Oldest `ts` in page when more older events exist; else `null` (load-more cursor)                                                                                                                                         |
| Event fields                                     | `seq` (0=newest in page), `ts`, `session`, `type`, optional `file`, `summary`, `tokens`, `action`, `totals`, `sessionId`, `agent`, `model`                                                                               |
| Types                                            | `session_start` / `session_end` / `read` / `write` / `bash` / `grep` / `glob` (Edit → `write` + `action=edit`)                                                                                                           |
| Token semantics                                  | Present only when estimated; **omit** when unknown (UI shows `—`). Cascade: response → Write input → Edit strings → Read stat; Bash/Grep/Glob from **capped** response size only                                         |
| Capture tools                                    | PostToolUse matcher `Bash\|Grep\|Glob\|Read\|Write\|Edit` — no `*` / MCP without allowlist                                                                                                                               |
| Redaction                                        | Summary only (command / pattern / glob, ≤~200 chars); never full stdout; cap estimate input **4 KiB**; strip secret-like patterns                                                                                        |
| `GET /api/observability/tool-use/stream`         | SSE: `connected` then `tool-use` frames when the JSONL grows (`fs.watch` + byte poll)                                                                                                                                    |
| Missing file                                     | `200` + empty `events` (calm empty UI — not an error)                                                                                                                                                                    |
| Hard I/O failure                                 | `500` + `{ error }`                                                                                                                                                                                                      |
| Write path                                       | Hooks append JSONL only; Board never writes; no HTTP from hooks                                                                                                                                                          |
| UI                                               | Live prefers **SSE** (poll fallback if `EventSource` missing); **Load older** uses `before=nextBefore`; columns Time \| Type \| **Target** (file basename or summary) \| Action \| Tokens \| Session \| Agent? \| Model? |

**Mechanism:** `TokenLedgerService` reverse-tails with optional `before` filter; `TokenLedgerWatcher`
fans out appends to SSE subscribers. The Node-only watcher loads only when a local SSE request has a
`ServerContext`; Worker bootstrap does not import its `node:fs` graph. The `connected` frame follows
watcher subscription, so an immediate append cannot race initialization. Hooks stay file-append only
with privacy default **summary over body**.

### 7.9 System Event catalog

The `System Events` tab on the observability board subscribes to events on the
canonical server `EventBus<ServerEventMap>` exposed by `ServerContext.eventBus()`.
Only events registered in `SYSTEM_EVENT_CATALOG` (`packages/app/src/services/event-names.ts`)
are persisted to `system_events` and pushed over `/api/events/planning`. The catalog
is the single source of truth — both the tap (`registerSystemEventTap`) and the SSE
module derive their subscriptions from it.

**Tier rules (task 0221 R5).**

| Tier             | Meaning                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `default`        | Persisted and streamed on the SSE channel without extra runtime config.                                  |
| `diagnostic`     | Persisted and streamed only when `SPUR_DIAGNOSTIC_EVENTS=1` (or `true`) is set on the server runtime.    |
| (out of catalog) | Emit is not part of the board contract — CLI-local buses, browser store notifications, raw Node signals. |

The `SPUR_DIAGNOSTIC_EVENTS` flag ships through `serverBootstrapConfig(env).events.diagnostic`
(`apps/server/src/bootstrap.ts`) and is consulted in two places: the system-event tap
(`registerSystemEventTap(bus, dao, logger, { diagnosticEnabled })`) and the SSE module when
building the stream name list. Diagnostic entries remain in the catalog so the UI can
filter them by `tier` once the toggle is enabled — no CLI restart required.

**Envelope v2 and payload projection (task 0526).** Fresh persistence and SSE use the same
`buildSystemEventEnvelope(entry, payload, project, secretValues?)` boundary. The payload becomes
`{ schemaVersion: 2, data, context, presentation }`; catalog metadata supplies the concrete producer
package/subsystem, last-resort default severity, description, retained presentation fields, and
remediation kind. Fresh envelopes prefer a producer-stamped payload `severity` (ts-libs 0.4.30+)
over that catalog default.
`metadata-only` is a real allow-list with recursive depth/array/object/node/string bounds. Content
bodies, prompts, commands/environment, arbitrary business payloads, complete rule finding arrays,
and stdout/stderr are excluded; credential patterns and configured secrets are redacted before those
bounds. Server and CLI composition roots inject both project name/root and configured secret values.

The current `projectStoredSystemEventEnvelope` preserves canonical v2 rows and wraps legacy raw rows at the
history response only. ADR-067's accepted J9 replacement is indexed below; neither path rewrites stored history. Correlation accepts direct and nested
run/execution/action/entity/job identifiers, with indexed ledger columns remaining query authority.
Unknown names and malformed optional payloads degrade to a bounded generic envelope without failing
the product operation. Canonical shape, projection paths, and pending consumer contracts live in
[`actionable-observability-context.md`](design/actionable-observability-context.md).

**J9 semantic presentation (built — tasks 0601/0602).** Event-specific presenter shapes, outcome support,
producer enrichment, exact planning/workflow/queue summaries, and the two-sided 71-event matrix live in
[`event-tracking.md`](design/event-tracking.md). History reprojection and generic tooltip identity live in
[`actionable-observability-context.md`](design/actionable-observability-context.md); visual tooltip placement lives
in root `DESIGN.md`. Envelope v2 and the ledger schema do not change.

**J91 human table projection (built — task 0605; ADR-073/074).** Table cells are
human-only; optional `presentation.correlators` / `actionLabel` / `agent` and the Agent column live in
[`system-events-human-table.md`](design/system-events-human-table.md). `context` stays closed. No new CLI
noun. Tooltip remediation and raw ids stay out of the table.

**Routing decision attribution (task 0545).** Agent-run lifecycle rows carry the routing decision as
envelope metadata — no new table or column. `agent.invoke.start` / `agent.invoke.exit` payloads gain
a `routing` block (`role?`, `tier`, `executor`, `source`) merged at the per-run invoke bridge in
`AgentService.executeRun` from the resolution funnel's result (`resolveExecutorSelector` and
siblings — the only place that knows role, tier, executor, and source together). The selection
source distinguishes a declared role resolution (`role`) from an explicit pin (`explicit`) from an
`agent.default` selection (`default`); stage/phase/priority resolutions record their own source.
Runs join to the history plane over the indexed `run_id` column (task 0557 threads the correlation;
0547 consumes the join). An escalation is its **own** default-tier record
(`agent.invoke.escalated`, emitted by the Spur agent-service bridge, producer-attributed to
`spur`): originating tier, resulting tier, and the objective trigger (`gate-fail`, `timeout`,
`insufficient-evidence`, `retry-exhausted`, plus the class-level `resource-exhaustion`/`auth`
members of the registry vocabulary). A run that never escalates emits no such row — absence and
not-recorded are distinguishable (R2). Attribution carries identifiers, tiers, and counts only:
prompt text, command lines, and configured secrets are excluded by the J5 bounds and recursive
redaction before persistence (R4).

**Routing aggregate read path (task 0546).** `SystemEventDao.routingSummary({ since?, until? })`
answers "which executor served which role, how often, and how often did it escalate" in **one
indexed round trip** — the aggregate is computed in SQL (`GROUP BY` over `json_extract` of the
routing envelope), never by sifting a fixed row window client-side (the failure mode feature J3
fixed on this ledger). The `event_name` + window predicates ride the composite
`idx_system_events_name_occurred (event_name, occurred_at)` index and the escalation join rides
the indexed `run_id` column, so work is bounded to the attribution families (measured via
EXPLAIN QUERY PLAN: every family-filtered scan is served by the composite index).
Per pair it reports `{ role, executor, source, runs, escalations }`: `runs` counts
`agent.invoke.start` dispatches (start, not exit, is the dispatch moment; an escalated re-dispatch
is its own serve on the executor it landed on), and `escalations` counts
`agent.invoke.escalated` rows whose `fromExecutor` matches the pair — "this pairing started too
cheap", not "was escalated to". Selection sources stay separate (R4): a pinned (`source:
'explicit'`) run is not counted as evidence that role routing chose that executor. Pre-attribution
rows and malformed payloads are excluded rather than imputed as an unknown role (R5), and the
covered `window` is reported on the result; `since`/`until` default to a bounded recent 7-day
range. No new CLI noun or verb — this rides the observability read API (ADR-051 gates noun
additions). Task 0547 joins the same rows to the history plane over `run_id` for the token
dimension; task 0552 renders this aggregate.

**Role token aggregate (task 0547).** `roleTokenSummary({ since?, until? })`
(`packages/domain/src/analytics/role-tokens.ts`) attributes token consumption to the role each
attributed run served, over the same bounded window and source rows as `routingSummary`. The
join is attribution → run→session mapping → typed columns: `agent.invoke.start` rows carrying a
routing block join `history_run_session` by the indexed `run_id` (task 0557 boundary observation /
task 0558 retroactive correlation), and each mapped session's `history_message` typed token
columns (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) are folded
per role. Per role it reports `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }`
plus coverage (`totalRuns`, `matchedRuns` — matched of attributed, R5) and the never-fabricate
state (R3): a bucket is present only when its matched rows carried usage
(`recordsWithUsage > 0`), so a role with no matched rows — or rows without a provider `usage`
object — reports **unmeasured** with the matched-run count, never zero tokens as an observed
fact. Exact and estimated mappings are folded into separate buckets and never summed (R4,
mirroring `attributeActionCost`'s split). No dollar figure is computed, stored, or displayed
(R2): `history_message.cost_usd` and the pricing tables stay unread, and the result type carries
no currency field. Missing tables (unmigrated DB / dead history plane per feature E1) read as
empty — best-effort like the rest of the trace path. Task 0552 renders these totals.

**Board render — routing and token consumption (task 0552).** The observability module's Routing
tab (`apps/web/src/modules/observability/RoutingTab.tsx`, registered as the `routing` tab in
`OBSERVABILITY_TABS`) consumes the two J6 aggregates through
`GET /api/observability/routing-summary` (`apps/server/src/modules/observability`), which forwards
`since`/`until` to `routingSummary` + `roleTokenSummary` and returns `{ routing, tokens }` — the
route adds no query of its own, and the domain surfaces keep their bounded defaults. The tab is
render-only: it narrows the envelope once (`parseRoutingSummaryResponse`) and never re-derives a
count. Honest states render as themselves, per the J6 contract: the pair table keeps selection
sources distinct (`explicit` renders as *pinned*, `role` as *resolved*, `default` as *default*;
a `role: null` group renders as `—`), a role with no measured bucket renders **unmeasured** with
its matched-of-total coverage and no token figures (never zero-as-fact), exact and estimated
buckets render side by side as separate labelled rows (never summed), and an empty result states
that no attribution has been recorded rather than rendering zeroes. No currency symbol can appear:
the DTOs carry no currency field and the surface formats plain token counts only (R2, asserted by
test).

**Board projection (task 0527).** The web client narrows envelope v2 once in its history/SSE parser.
Desktop renders `Time | Severity | Event | Summary | Producer | Correlation | Outcome |
Action`; below 640 px it keeps `Time | Event` and stacks the semantic fields. The Producer
column title and value are package / subsystem only. Project name/root are omitted from the
table and tooltip (constant for a Board view) and remain in expanded detail. Severity always pairs
icon and text. The event-name tooltip uses the server-owned description, fields, producer, outcome,
and remediation, with equivalent hover/focus/pin interactions; raw redacted envelope JSON and
prefix/tier/actor stay in expanded detail. Canonical `data` is unwrapped for the existing Jobs/Tasks
consumers, while malformed or legacy client input receives explicit `unavailable` sentinels and no
fabricated action. The Board renders those sentinels as `-`.

**Source families (tasks 0221/0526).** `SystemEventSource` is the producer family
(`planning | queue | scheduler | message | process | workflow | rule | agent | team | history | bus |
api`). Each catalog entry additionally fixes its concrete producer package and subsystem. The catalog
declaration order is canonical; `SYSTEM_EVENT_PREFIXES` is derived and powers the UI prefix filter.

**Event-name alias policy (task 0221 R4).** Where upstream and canonical names diverge
(e.g. engine `workflow.action.start` vs. observability adapter `workflow.action.started`),
the engine-native names are catalog-canonical and the alternates get their own row — one
per logical moment — to avoid silently collapsing two lifecycle moments into one row.
The persistence-side `ObservableWorkflowAdapter` continues to feed live consumers via
its own typed bus; it produces a separate `system_events` row only if the engine did not.

**Producer invariant (R3).** Board-visible server work receives the canonical bus,
directly or through a typed adapter. Each app service has an optional `events?()`:

| Service                                             | Wiring                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AgentService.run()` / `runCapture()` (0219 + 0221) | `AiRunner({ events: bridge(events), processEvents: bridge(events) })`                               |
| `RuleService.evaluate()` / `evaluateVerbose()`      | `RuleEngine({ events: bridge(events) })` plus a forwarding subscription over the verbose local bus. |
| `WorkflowAppService.run()`                          | `EngineWorkflowService.runFile({ events: bridgeEngineEvents(events) })` via `createEngineService`.  |
| `TaskActionJob` (server-side queued job)            | `new AgentService({ events: ctx.eventBus(), ... })` in `serve.ts:runTaskActionJob`.                 |
| `JobQueue` / `QueueConsumer` (0190)                 | Already wired via `createServerContext` (forwards `queue.*`).                                       |

**Server-context integration tests (0219 AC).** `apps/server/tests/context.test.ts`
proves that `task.*` events flow through the canonical bus into `system_events`;
analogous tests for `rule.run.start`, `agent.invoke.start`, and `workflow.run.started`
are added in 0221 by emitting the upstream event through a service constructed with
`events: ctx.eventBus()` and asserting `dao.query({ name })` returns a row.

### 7.10 System event correlation columns (task 0369)

`system_events` carries four nullable correlation columns beside the original five,
so a run- or entity-scoped read is one indexed round trip instead of a client-side
scan of the newest-N window:

| Column        | Type      | Source                                              |
| ------------- | --------- | --------------------------------------------------- |
| `run_id`      | `TEXT`    | 0365 envelope `runId` (`workflow.*`, agent events)  |
| `sequence`    | `INTEGER` | 0365 envelope `sequence` — monotonic within one run |
| `entity_kind` | `TEXT`    | Planning event `entity.kind` (`task`, `feature`)    |
| `entity_id`   | `TEXT`    | Planning event `entity.id`                          |

Indexes: `idx_system_events_run_id` and the pair index `idx_system_events_entity
(entity_kind, entity_id)` — the pair, because entity ids are only unique within a kind.

**Derivation.** `extractSystemEventCorrelation` (`packages/app/src/services/system-event-tap.ts`)
is the single derivation, shared by both write paths — the server tap
(`registerSystemEventTap`) and the CLI planning emitter (`SystemEventEmitter`) — the
same one-canonical-derivation contract `extractSystemEventActor` holds for actor. Every
column is nullable: an event carrying neither run nor entity identity persists nulls.

**Migration.** `0008_spur_cli_system_events_correlation` adds the columns and indexes to
pre-0369 ledgers. It is columns-and-indexes only — no payload rewrite or backfill, so
pre-migration rows keep their `payload_json` and read back with nulls. Fresh databases
get the columns from the `0000` foundation DDL, so the migration carries
`addColumnIfMissing: { table: 'system_events', column: 'sequence' }` and journals itself
without executing the ALTERs (the `runs.external_key` precedent).

**Read surface.** `SystemEventDao.query` accepts `run_id`, `entity_kind`, and `entity_id`
filters, composed with `name`/`since` under AND. `GET /api/events/history` projects the
columns additively as `runId`, `entityKind`, `entityId`, `sequence`; no existing response
field is renamed, dropped, or re-typed.

**Server-side filters + keyset pagination (task 0372).** Filters run in SQL (never by
post-filtering a prefetched page). Order is `occurred_at DESC, id DESC` so a keyset
cursor is a total order under concurrent inserts.

| Surface                   | Contract                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/events/history` | Newest-first page over `system_events`                                                                 |
| Query (v1, preserved)     | `name`, `since`, `limit` (default **100**, max **500**)                                                |
| Query (0372)              | `prefix`, `names` (comma or repeated), `runId`, `actor`, `cursor`                                      |
| Success body              | `{ events, count, catalog, nextCursor, hasMore }` — `nextCursor`/`hasMore` are additive                |
| `nextCursor`              | Opaque base64url keyset of the last returned row when `hasMore`; else `null`                           |
| `prefix`                  | Cataloged family only (`SYSTEM_EVENT_PREFIXES`); unknown → **400** `{ error, code: "UNKNOWN_PREFIX" }` |
| `cursor`                  | Malformed → **400** `{ error, code: "MALFORMED_CURSOR" }` — never falls back to unfiltered             |
| DAO filters               | `prefix` (`LIKE 'prefix.%'`), `names` (`IN`), `actor`, `before: { occurred_at, id }` exclusive keyset  |
| Stability                 | Newer concurrent inserts do not reappear on later pages; rows older than the cursor are not skipped    |

## Workflow run-store read API (0373)

The durable record of what a pipeline did lives in the workflow run store
(`runs`, `phase_runs`, `transition_runs`, `action_runs`, `task_run_links`) —
not in the `system_events` ledger. Task 0373 exposes a **raw Hono** read surface
over that store so the Board (J4 Tasks tabview) can show a task digest with
progress and action log. Query composition and `result_json` redaction live in
`RunStoreService` (`packages/app`); the server module is transport-only and does
not import `ts-db` (ADR-021).

| Surface                     | Contract                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/runs`             | Newest-first list over `runs`                                                                                                                                |
| Query                       | `status`, `limit` (default **50**, max **200**), `cursor` (opaque keyset)                                                                                    |
| Success body                | `{ runs, count, nextCursor, hasMore }`                                                                                                                       |
| List entry                  | `{ id, workflowName, status, mode, agent, startedAt, completedAt }`                                                                                          |
| `cursor`                    | Malformed → **400** `{ error, code: "MALFORMED_CURSOR" }`                                                                                                    |
| Order                       | `started_at DESC, id DESC` exclusive keyset (stable under concurrent inserts)                                                                                |
| `GET /api/runs/:runId`      | One run + ordered `phases`, `transitions`, `actions`                                                                                                         |
| Action fields               | `id, node, kind, status, durationMs, ok, resultSummary, startedAt, completedAt`                                                                              |
| `resultSummary`             | Redacted/bounded projection of `result_json`: sensitive-key blanking plus recursive credential-pattern and configured-secret replacement; never the raw blob |
| Unknown id                  | **404** `{ error, code: "RUN_NOT_FOUND", runId }` — no partial/fabricated object                                                                             |
| `GET /api/runs/by-wbs/:wbs` | Every `task_run_links` row for the WBS with link `kind` + run digest                                                                                         |
| Empty WBS                   | **200** `{ wbs, links: [], count: 0 }` — not an error                                                                                                        |
| Optional query              | `limit` (default **50**, max **200**) on the WBS lookup                                                                                                      |

**Layering.** Domain DAOs own SQL (`RunDao.traceRows` / `traceRowById` with `agent` +
keyset `before`; `PhaseRunDao` / `TransitionRunDao` / `ActionRunDao` /
`TaskRunLinkDao`). `RunStoreService({ getDb, secretValues? })` composes them and redacts.
`summarizeActionResult(resultJson, secretValues?)` owns the trace-safe projection. `runsModule`
maps HTTP ↔ service results only.

## Team + Message HTTP Routes (0256)

The board's team supervision and inter-agent messaging surface is **raw Hono handlers** (not oRPC).
oRPC stays the planning-CRUD convention; the live board/streaming surface is raw + SSE (which oRPC
can't express). Web consumes via `fetchWithTimeout` + `resolveApiUrl` and native `EventSource`.

### Team routes (`apps/server/src/modules/team/index.ts`)

| Method | Path                             | Body / Query            | Response                                                                     | Notes                                                         |
| ------ | -------------------------------- | ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/team/processes`            | —                       | `{ processes: [{agentId, pid, status, startedAt, exitCode}], count }`        | List supervised processes (0243).                             |
| POST   | `/api/team/agents/:id/start`     | —                       | `{ ok, pid, status }` (201) or `{ error }` (400)                             | Spawn a supervised agent.                                     |
| POST   | `/api/team/agents/:id/stop`      | —                       | `{ ok }` or `{ error }` (400)                                                | Stop a supervised agent.                                      |
| POST   | `/api/team/processes/:id/stdin`  | `{ line: string }`      | `{ ok }` or `{ error }` (400)                                                | Forward a line to the process stdin.                          |
| GET    | `/api/team/processes/:id/stream` | —                       | SSE stream of `{stream, ts, line, seq}` frames                               | Ring-buffer replay + live tail. Heartbeat every 15s.          |
| GET    | `/api/team/teams`                | —                       | `{ teams: [{teamId, name, members: [{id, type, status, pid?, role?, executor?}]}], count }` | Teams grouped by `team:<id>` tag + config (0256 R2); member payload carries the declared role + resolved executor, omitted when unset (0544 R3/R4). |
| POST   | `/api/team/:team/up`             | `?check=true` (dry-run) | `{ materialized: {upserted, orphaned, written}, started: [{id, ok, pid?}] }` | Materialize + best-effort start (0256 R3/R5).                 |
| POST   | `/api/team/:team/down`           | `?purge=true`           | `{ stopped: string[], purged: string[] }`                                    | Stop members + optional purge (0256 R3).                      |
| GET    | `/api/team/health`               | —                       | `{ ok: true }`                                                               | Liveness probe for CLI `team up` best-effort start (0256 R4). |

### Message routes (`apps/server/src/modules/messages/index.ts`)

| Method | Path                      | Body / Query                         | Response                                                                  | Notes                             |
| ------ | ------------------------- | ------------------------------------ | ------------------------------------------------------------------------- | --------------------------------- |
| GET    | `/api/messages/inbox`     | `?agent=<id>&limit=<n>`              | `{ messages: [{id, fromId, body, status, createdAt, inReplyTo}], count }` | One agent's inbox queue.          |
| GET    | `/api/messages`           | `?limit=<n>`                         | `{ messages: [...], count }`                                              | Global message feed (all agents). |
| POST   | `/api/messages`           | `{ fromId, toId, body, inReplyTo? }` | `{ msgId, toId, status: 'queued' }` (201)                                 | Enqueue a message.                |
| POST   | `/api/messages/:id/reply` | `{ fromId, body }`                   | `{ msgId, toId, status: 'queued' }` (201)                                 | Reply to a message.               |

**Convention:** response envelopes use `{ data…, count }` for lists and `{ ok, ... }` for mutations,
matching the existing board routes. Error shape: `{ error: string }` with the appropriate HTTP status.
All team routes are Bun-gated (require `ServerContext`); they return 503 on the Cloudflare Workers path.
