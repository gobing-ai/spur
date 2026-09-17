# Environment Variables

> The complete inventory of environment variables the Spur product actually reads, grouped by
> contract type. Policy lives in [ADR-120](../00_ADR.md): env vars are a **restricted external
> surface** — a new variable is added only for a real external contract, runtime options belong in
> the project config (`bootstrap.options`) or global config, and every access goes through the
> `@gobing-ai/ts-utils` gateway (`getEnvVar`/`getEnvVars`), never direct `process.env`/`Bun.env`.
> Enforcement: the `env-var-hygiene` rule (error severity, zero exclusions), with raw access
> confined to `packages/config/src/**` and the dependency-free mirrors in `plugins/sp/scripts/`
> and `plugins/sp/hooks/`. User-settable variables are documented in `.env.example`.

## Deployment plane (user-settable — see `.env.example`)

| Variable | Read by | Purpose | Default |
| --- | --- | --- | --- |
| `DATABASE_URL` | apps/cli (`context`, `serve`, `maintain`) | Postgres connection string for CLI storage; app workspaces otherwise default to file/SQLite | empty → file/SQLite |
| `NODE_ENV` | config loader, apps/cli, apps/server | Standard Node mode flag; `production` hardens server behavior | `development` |
| `PORT` | apps/cli (`serve`), apps/server | HTTP port for `spur serve` | `3111` |
| `HOST` | apps/cli (`serve`), apps/server | Bind address for `spur serve` | `127.0.0.1` |
| `SPUR_CORS_ORIGINS` | apps/server (pipeline middleware, worker app) | Comma-separated CORS allow-list for the served web app | empty = same-origin only |
| `SPUR_LOG_LEVEL` | apps/cli, apps/server | Server log level (`trace`…`fatal`) | `info` |
| `SPUR_TELEMETRY_ENABLED` | apps/cli | Anonymous usage telemetry opt-in | `false` |
| `SPUR_TELEMETRY_ENDPOINT` | apps/cli | Telemetry collector (only when enabled) | empty |

## Config-resolution overrides (debug, test, registry paths)

| Variable | Read by | Purpose |
| --- | --- | --- |
| `SPUR_CONFIG_FILE` | config loader | Override the project config file path (`.spur/config.yaml`) |
| `SPUR_CONFIG_DIR` | config loader | Override the `.spur` directory location |
| `SPUR_SKIP_GLOBAL_CONFIG` | config loader | Skip global config resolution (isolation for tests) |
| `SPUR_SKIP_PROJECT_CONFIG` | config loader | Skip project config resolution (isolation for tests) |
| `SPUR_PROJECTS_FILE` | packages/app (projects registry) | Override the multi-project registry path |
| `SPUR_SLASH_COMMANDS_FILE` | apps/cli | Override the slash-command surface file |
| `SPUR_GLOBAL_RULES_DIR` | apps/cli (`init`), rule service | Override the global rules directory |
| `SPUR_RULES_PATH` | rule service | Override the per-project rules path |

## Execution policy (config-first per ADR-112)

Canonical values live in `bootstrap.options` (`schedulerCustomTimeoutMs`, `schedulerKillGraceMs`,
`historyRefreshTimeoutMs`, `asyncRegisterTimeoutMs`). The legacy env chain remains a fallback;
the per-job contract is still env.

| Variable | Read by | Purpose |
| --- | --- | --- |
| `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` | packages/app (execution policy) | Legacy fallback for `schedulerCustomTimeoutMs` |
| `SPUR_HISTORY_REFRESH_TIMEOUT_MS` | packages/app (execution policy) | Legacy fallback for `historyRefreshTimeoutMs` |
| `SPUR_SCHEDULER_KILL_GRACE_MS` | packages/app (bounded child run) | Legacy fallback for `schedulerKillGraceMs` |
| `SPUR_SCHEDULER_TIMEOUT_<NAME>_MS` | scheduler custom-job service, apps/server (`serve`) | **Live per-job timeout contract** — one timeout per scheduled job name |
| `SPUR_HISTORY_SOURCE_TIMEOUT_MS` | apps/cli (history refresh spawn) | Per-source timeout for a single history refresh run |

## Agent selection & host contracts (set by host tools / user)

| Variable | Read by | Purpose |
| --- | --- | --- |
| `CLAUDE_PROJECT_DIR` | plugin hooks (context, write guard) | Claude Code project root — locates the `.spur` tree from hook context |
| `CLAUDE_CODE_ENTRYPOINT` | plugin hooks (agent hint) | Which Claude Code entrypoint invoked the hook |
| `TERM_PROGRAM` | plugin hooks (agent hint) | Terminal host fallback for agent detection |
| `SPUR_AGENT` | plugin hooks (agent hint) | Explicit agent override; first candidate in detection |
| `SPUR_DEFAULT_AGENT` | plugin hooks (agent hint) | Default agent when no specific one is detected |
| `SPUR_MODEL` | plugin hooks (agent hint) | Model override; first candidate in model resolution |
| `ANTHROPIC_MODEL` | plugin hooks (agent hint) | Model override (Anthropic family) |
| `CLAUDE_MODEL` | plugin hooks (agent hint) | Model override (Claude Code) |
| `OPENAI_MODEL` | plugin hooks (agent hint) | Model override (OpenAI family) |
| `SPUR_BIN_CANDIDATES` | pi guard extension | Colon-separated candidate paths for the `spur` binary |

## Invocation contracts (caller → `spur`)

| Variable | Read by | Purpose |
| --- | --- | --- |
| `SPUR_JSON_ENVELOPE` | packages/app (output envelope), apps/cli | Flag+env contract (ADR-091): wrap output in the machine envelope, equivalent to `--json-envelope` |
| `SPUR_HITL_AUTO_APPROVE` | apps/cli (context, errors, HITL responder) | Auto-approve HITL gates in non-interactive runs |
| `SPUR_CAREFUL` | plugin hook (careful guard) | Activate extra-caution write gating |
| `SPUR_WRITE_GUARD` | plugin hook (task write guard) | Override write-guard mode (on/off/careful) |
| `SPUR_DEBUG` | apps/cli (`serve`) | `1` → include stack traces in served error responses |
| `SPUR_QUALITY_GATE_RETRY_DELAY_MS` | plugin scripts (`quality-gate`) | Retry delay for the quality gate script |
| `SP_DAILY_SUMMARY_NO_PROMPT` | plugin scripts (`daily-summary`) | Suppress the interactive prompt in daily summary |
| `SPUR_ASYNC_WORKER` | apps/cli (`workflow`) | Mark the invocation as an async workflow worker |
| `SPUR_EXPECTED_DEFINITION_DIGEST` | apps/cli (`workflow`) | Workflow-resume guard: child must match the parent's definition digest |
| `SPUR_WORKFLOW_RUN_ACTIVE` | apps/cli (`workflow`) | Guard against nested workflow activation |
| `SPUR_EVAL_PIPELINE_ACTIVE` | scripts (`eval-pipeline`) | Mark an eval-pipeline invocation |
| `SPUR_CLI_PATH` | packages/app (project start) | Explicit CLI path for spawned children |
| `SPUR_HISTORY_REFRESH_CONTEXT` | packages/app (history refresh service) | Serialized per-child refresh context for isolated history workers |

## Parent → child (set by `spur` for spawned processes)

| Variable | Read by | Purpose |
| --- | --- | --- |
| `SPUR_BIN` | plugin scripts (inline run setup, prechecks, feature sync) | Absolute path of the invoking `spur` binary — children re-invoke the same build |
| `SPUR_ROLE` | packages/app (agent service) | Declares the child's coordination role in agent-team runs |
| `SPUR_SERVE_URL` | packages/app (supervisor service) | Serve URL handed to supervised children |
| `SPUR_RUN_ID` | packages/app (supervisor, fleet), plugin hooks | Process-generation id for a spawned run |
| `GIT_INDEX_FILE` | packages/app (workflow proof fingerprint, agent run) | Git's own env var; read to fingerprint staged-tree state in proofs |

## TTY / standard

| Variable | Read by | Purpose |
| --- | --- | --- |
| `NO_COLOR` | apps/cli colors, rule check | Disable ANSI color (the standard contract) |
| `FORCE_COLOR` | apps/cli colors | Force ANSI color even when not a TTY |

## Retired (do not use)

| Variable | Replaced by |
| --- | --- |
| `SPUR_PROVENANCE_OVERRIDE` | `spur task update --provenance-bypass` (audited, task 0902) |
| `SPUR_DIAGNOSTIC_EVENTS` | `bootstrap.options.diagnosticEvents` |
| `SPUR_EVENT_RETENTION_DEFAULT` / `SPUR_EVENT_RETENTION_<NS>` | `bootstrap.options.eventRetentionDefault` / `eventRetentionPrefixes` |
| `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS`, `SPUR_HISTORY_REFRESH_TIMEOUT_MS`, `SPUR_SCHEDULER_KILL_GRACE_MS` | `bootstrap.options` (still honored as legacy fallback — see above) |
| `RD3_DAILY_SUMMARY_NO_PROMPT` | `SP_DAILY_SUMMARY_NO_PROMPT` |

## Web build (compile-time, not runtime env)

`apps/web` reads `PUBLIC_API_URL` and `DEV` via Astro's `import.meta.env` at build time — they
are baked into the bundle, not read at runtime, and are outside the env-gateway rule's scope.

## Adding a new variable (ADR-120 gate)

Before adding an env var, it must clear **all** of:

1. A real **external contract** requires it (deployment plane, host-tool / parent→child process
   contract, or CI invocation) — with the reason recorded where the variable is defined.
2. It is **not** a design-time/dev-time option (those are constants in source) and **not** a
   runtime option (those go in `.spur/config.yaml` `bootstrap.options` or the global config).
3. The access goes through the `@gobing-ai/ts-utils` gateway; raw access only inside the two
   sanctioned zones (`packages/config/src/**`, `plugins/sp/scripts/env.ts`).
4. The user-settable set is updated in `.env.example`, and this inventory gains a row.
