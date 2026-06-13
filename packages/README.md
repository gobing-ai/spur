# packages/

Local workspace packages. Apps (`apps/cli`, `apps/server`, `apps/web`) are thin transport
wrappers; real functionality lives here (ADR-021). Domain *engines* do **not** live here — they
are external `@gobing-ai/ts-*` packages (see root `AGENTS.md`).

| Directory | Package | Purpose | Key boundary |
|---|---|---|---|
| `app/` | `@gobing-ai/spur-app` | Application services — the functionality layer every transport calls (`AgentService`, `RuleService`, `WorkflowService`, `TeamService`, `HistoryService`, …; planning-layer services join here per ADR-020/021) | The only place business logic lives; apps never bypass it |
| `domain/` | `@gobing-ai/spur-domain` | Spur-domain data layer — DAOs, schema composition (`CLI_SCHEMA_SQL`), analytics | **Sole** ts-db/drizzle consumer; nothing else touches the database |
| `contracts/` | `@gobing-ai/spur-contracts` | oRPC transport contracts — the CLI/server/web type seam; OpenAPI is generated from it | Transport DTOs **only**; domain types never leak in (ADR-005) |
| `config/` | `@gobing-ai/spur-config` | Zod config schema + env parsing for `.spur/config.yaml` (ADR-017 single config) | Schema only; loading runs through the ts-infra/ts-runtime config stack |

Dependency direction: `apps/* → app → domain`; `contracts` and `config` are leaves consumed by
apps and services. Cross-workspace imports always use the `@gobing-ai/*` alias, never relative
paths into a sibling package.

Creating a new local package requires a recorded decision (no package sprawl by default —
`docs/03_ARCHITECTURE.md §12.1`). Authoritative detail: module boundaries in
`docs/03_ARCHITECTURE.md`, decisions in `docs/00_ADR.md`, concrete shapes in `docs/04_DESIGN.md`.
