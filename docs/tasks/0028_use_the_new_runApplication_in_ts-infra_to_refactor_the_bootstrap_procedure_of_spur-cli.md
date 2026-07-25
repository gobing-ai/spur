---
name: use the new runApplication in ts-infra to refactor the bootstrap procedure of spur-cli
description: use the new runApplication in ts-infra to refactor the bootstrap procedure of spur-cli
status: done
created_at: 2026-06-08T05:28:32.973Z
updated_at: 2026-06-08T15:06:21.000Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0028. use the new runApplication in ts-infra to refactor the bootstrap procedure of spur-cli

### Background

As we alredy provided a new `runApplication` function in `@gobing-ai/ts-infra` since last version, we can use it to refactor the bootstrap procedure of `spur-cli`. We also need to take this chance to standardize the application bootstrap process across all our projects.

The first step is to re-design the schema and file layout for spur-cli's external configuration files in `.spur/config.yaml`. We hope to use it to control most components of the application, including but not limited to the application's logging, DB location, enabled components, observability and so on so forth. By design, it's not for spur-cli only, it also need to support spur-server later, so we need to resolve the capacity and decide which parts of the configuration should be shared across all applications, and which parts should be specific to each application.

We also need to prepare to support both bun and node.js runtimes later -- but this part is not in the scope of current task. But we need to prepare to support both runtimes (via `@gobing-ai/ts-runtime`) in the future.

### Requirements

### Requirements

- [x] **R1** — Adopt ts-infra bootstrap orchestrator → **MET** | Evidence: `apps/cli/src/index.ts:46 runNodeApplication<SpurAppConfig>`, `apps/cli/tests/bootstrap.test.ts`
- [x] **R2** — `.spur/config.yaml` shared/specific split → **MET** | Evidence: `apps/cli/src/config/schema.ts:38 SpurAppConfigSchema` (app) + `bootstrapSection:'bootstrap'` (portable); `.spur/config.yaml:11`
- [x] **R3** — [CRITICAL] Zero CLI-surface drift → **MET** | Evidence: 572 tests pass/0 fail; init/status diffs marker-only `.json`→`.yaml`; handler registrations unchanged `apps/cli/src/index.ts:98-107`
- [x] **R4** — DB eager + injected, no proxy → **MET** | Evidence: `apps/cli/src/index.ts:38` eager → `services:{db}`; `apps/cli/src/context.ts:37` uses injected adapter directly
- [x] **R5** — App-specific paths unchanged → **MET** | Evidence: `apps/cli/src/config/resolver.ts:22` project→global fallback preserved
- [x] **R6** — Runtime-agnostic readiness (prep) → **MET** | Evidence: `@gobing-ai/ts-infra/application-node` import (Bun+Node compatible)
- [x] **R7** — YAML schema finalized first → **MET** | Evidence: `apps/cli/src/config/schema.ts`, `apps/cli/schemas/spur-config.schema.json`, ADR-017, `docs/04_DESIGN.md:181 §2.1`


### Q&A

**Q1: Lazy DB proxy?** No. A local SQLite3 connection is low burden; create it
normally and inject via `services.db`. Any laziness belongs in `ts-db` later, not
in the application bootstrap.

**Q2: What is shared vs app-specific in the config?** Share only the common
bootstrap parts — `bootstrap.logging`, `.telemetry`, `.database`, `.scheduler`
(if needed). Spur-cli-specific concerns (agent paths, rule presets, workflow
folders) stay fixed to project `.spur/` with fallback to `~/.config/spur/`,
exactly as today — no change.

**Q3: Bump ts-infra to 0.3.5?** Yes — agreed. The `runApplication` /
`runNodeApplication` subpaths do not exist in the installed 0.3.4.

### Design

#### Constraint discovered in current code (flag before implementing)

There is an **existing inconsistency** the new schema must reconcile (do not
paper over it):

- `CLI_CONFIG.configFile = '.spur/config.json'` and `init.ts:153` writes that
  JSON file; `status.ts:34` checks for `.spur/config.json`.
- BUT `init.ts` *also* seeds `config/config.example.yaml` →
  `~/.config/spur/config.yaml`, and a `.spur/config.yaml` already exists in this
  repo with `version/name/agent/rules/workflows/redaction` keys.

So today there are **two parallel config notions**: a JSON project marker
(`.spur/config.json`) and a YAML config (`.spur/config.yaml` /
`~/.config/spur/config.yaml`).

**Decision (confirmed):** `.spur/config.yaml` is the single config surface. The
JSON project marker (`.spur/config.json`) is retired. `init` writes
`.spur/config.yaml`; `status` checks `.spur/config.yaml`. The `init`/`status`
`--json` envelopes and text output stay byte-identical (R3) — only the file the
marker logic points at changes from `.json` to `.yaml`.

**Config resolution order (confirmed):**
1. Project `.spur/config.yaml` (cwd).
2. Fallback to global `~/.config/spur/config.yaml` when the project file is
   missing.

This mirrors the existing global-fallback pattern already used for rules/config
seeding in `init.ts`, so no new resolution concept is introduced.

#### `.spur/config.yaml` format (final)

Two top-level concerns: a portable `bootstrap:` block (ts-infra owns it) and the
existing Spur app keys (Spur owns them). The current YAML keys are **preserved
verbatim** to avoid drift; `bootstrap:` is **added** alongside them.

```yaml
# .spur/config.yaml  — Spur project configuration
version: "1"
name: spur-new

# ── Portable bootstrap (consumed by @gobing-ai/ts-infra runNodeApplication) ──
# Shared across spur-cli and (future) spur-server. Keys map 1:1 to ts-infra's
# LoggingOptions / TelemetryOptions / database / SchedulerOptions.
bootstrap:
  logging:
    enabled: true
    level: info          # debug | info | warn | error
    console: true
    json: true
    # filePath: .spur/logs/spur.log   # optional; ts-infra creates the file sink
  telemetry:
    enabled: false       # OFF by default for CLI (per-invocation latency)
    serviceName: spur-cli
    environment: development
    # endpoint: http://localhost:4318   # set => Node OTel exporter activates
  database:
    enabled: true
    driver: bun-sqlite
    url: .spur/spur.db   # ${DATABASE_URL} interpolation supported
  scheduler:
    enabled: false       # CLI is run-once; no scheduler

# ── Spur app section (validated by a local zod schema — UNCHANGED keys) ──
agent:
  default: pi
rules:
  paths:
    - .spur/rules/**/*.yaml
workflows:
  paths:
    - .spur/workflows/
redaction:
  enabled: false
```

Notes:
- `bootstrap.*` keys are exactly the shapes `runNodeApplication` reads
  (`yamlBootstrap.logging/telemetry/database/scheduler` in
  `ts-infra/src/application-node.ts`). `bootstrapSection: 'bootstrap'` is the
  default, so no override needed.
- `${ENV_VAR}` interpolation works via ts-runtime `interpolateTree` (already
  used inside `runNodeApplication`) — e.g. `url: ${DATABASE_URL}`.
- The Spur app section is everything *except* `bootstrap` — loaded via
  `configLoader.appConfig` with a Spur zod validator (`safeParse` form).
- CLI defaults bias for fast startup: telemetry off, scheduler off.

#### Bootstrap wiring (target)

`main()` becomes a thin wrapper that delegates to `runNodeApplication`, runs the
existing Commander dispatch inside `start(app)`, and shuts down before exit:

```ts
// apps/cli/src/index.ts (target shape — handlers UNCHANGED)
export async function main(argv = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
    const output = options.output ?? consoleOutput;
    let exitCode = 0;

    const app = await runNodeApplication<SpurAppConfig>({
        configLoader: {
            configFile: resolveConfigFile(options.cwd),   // .spur/config.yaml (or global fallback)
            bootstrapSection: 'bootstrap',
            appConfig: { safeParse: (raw) => spurAppConfigSchema.safeParse(raw) },
        },
        config: options.overrides,                         // inline > YAML (test injection)
        services: { db: await createMigratedDbAdapter(...) }, // eager, injected (R4)
        async start(appRt) {
            const context = createCliContext({ ...options, app: appRt,
                setExitCode: (c) => { exitCode = c; } });
            const program = buildProgram(context);          // SAME register*Command calls
            try {
                await program.parseAsync(argv, { from: 'user' });
            } catch (err) { exitCode = handleParseError(err, output, exitCode); }
        },
    });
    await app.stop('shutdown');
    return exitCode;
}
```

`createCliContext` is updated to source `logger`/`events` from the injected
`app` runtime instead of constructing nothing (today it has neither). `getDb()`
returns the injected adapter. **Command handlers and their registration are
untouched** (R3).

### Solution

**Chosen approach:** Full `runNodeApplication` adoption (portable orchestrator +
Node convenience YAML loader), sequenced in two phases to de-risk and to satisfy
R7 (schema-first). DB injected eagerly (R4); zero CLI-surface drift (R3).

Rejected alternatives:
- *Portable `runApplication` + Spur-owned YAML loader* — duplicates ~150 lines of
  YAML/interpolation/file-sink that `runNodeApplication` already provides and that
  spur-server would re-need; contradicts the standardization goal. Reserve only
  if `runNodeApplication` proves too rigid, in which case enhance ts-infra
  (per the repo's shared-library-evolution rule) rather than fork the loader.
- *Big-bang single commit* — higher drift risk against R3; harder to review.

Config consolidation decision (confirmed): standardize on `.spur/config.yaml` as
the single config surface, retiring `.spur/config.json`. Resolution is project
`.spur/config.yaml` → fallback `~/.config/spur/config.yaml`. The
`.spur/config.json` project-marker reads in `init.ts` and `status.ts` are
migrated to the YAML marker **in the same change**, preserving identical
observable output (same `--json` keys, same messages, same exit codes).
`04_DESIGN.md` config table + `00_ADR.md` entry updated in the same commit.

Future note (out of scope for 0028): ts-infra's bootstrap configuration may be
streamlined/simplified in a later version. When that lands, revisit the
`bootstrap:` key shapes here to match the simplified surface — but 0028 targets
the current 0.3.5 API as-is.

### Plan

**Phase 0 — Prep**
1. Bump root catalog `@gobing-ai/ts-infra` `^0.3.4 → ^0.3.5`; `bun install`;
   verify `@gobing-ai/ts-infra/application-node` resolves.
2. Add ADR entry in `docs/00_ADR.md`: "spur-cli bootstrap standardized on
   ts-infra runApplication"; update `docs/04_DESIGN.md` with the
   `.spur/config.yaml` key table.

**Phase A — Config schema first (R7)**
3. New `apps/cli/src/config/schema.ts`: zod `spurAppConfigSchema` covering the
   *app* section (agent/rules/workflows/redaction/version/name) — keys verbatim
   from current YAML.
4. Update `config/config.example.yaml` (and `.spur/config.yaml`) to add the
   `bootstrap:` block shown in Design. Keep existing keys unchanged.
5. Wire a loader with the confirmed resolution order: project
   `.spur/config.yaml` first; when absent, fall back to
   `~/.config/spur/config.yaml`. Returns parsed bootstrap + app config. Pass the
   resolved path to `runNodeApplication`'s `configLoader.configFile`.
6. Retire the JSON marker: `init` writes `.spur/config.yaml` (not `.json`);
   `status` checks `.spur/config.yaml`. Update `CLI_CONFIG.configFile`
   accordingly. Preserve identical `--json`/text output (R3).
7. Tests: schema validation (valid/invalid/env-interpolation), loader fallback,
   `init`/`status` output parity (snapshot the current envelopes first).

**Phase B — Bootstrap rewire (R1, R3, R4)**
8. Update `createCliContext` to accept the injected `ApplicationRuntime`
   (logger/events/db) instead of self-wiring.
9. Rewrite `main()` to delegate to `runNodeApplication`; run existing Commander
   dispatch inside `start`; `await app.stop('shutdown')` before returning exit
   code. Banner + `--json` suppression stay outside the bootstrap.
10. Inject eagerly-created migrated DB via `services.db` (reuse
    `createMigratedDbAdapter`); `getDb()` returns it.
11. Verify every command + `--json` envelope is byte-identical to pre-change
    (diff against Phase A snapshots).

**Gate (both phases):** `bun run lint` · `bun run test` · `bun run test-cf` ·
`bun run build` · clean `git status`.

### Review

## Review — 2026-06-08 (dev-verify re-audit, --force)

**Status:** 2 findings (P4 only)
**Scope:** apps/cli/src/{index,context,config/*}.ts, init/status/plugin commands, root catalog
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline (current)
**Gate:** `bun run lint` ✓ · `bun run test` 572 pass/0 fail ✓ · `bun run test-cf` 2 pass ✓ · `bun run build` ✓

**Verdict: PASS** — all 7 requirements MET, no P1/P2/P3 findings.

### P1 — Blockers
_None._

### P2 — Warnings
_None._

### P3 — Info
_None._

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `loadSpurConfigSafe` exported but only consumed in tests | Usability | apps/cli/src/config/loader.ts:50 | Keep if intended as public API for future `status --validate`; otherwise inline into test or drop the `Safe` wrapper. Non-blocking. |
| 2 | Implementation added a `loadSpurConfig` JSON-Schema pre-validation layer not in the task Plan | Usability | apps/cli/src/config/loader.ts:33, schemas/spur-config.schema.json | Plan (§Design lines 171-197) only specified zod `appConfig.safeParse`; the extra JSON-Schema gate is a sound enhancement (IDE + fail-fast) but undocumented vs plan. Note in ADR-017/04_DESIGN that validation is two-tier (JSON Schema → zod). Non-blocking. |


### Testing

**Verified 2026-06-08.** Coverage as planned:

- **Unit — `spurAppConfigSchema`** (`apps/cli/tests/config/schema.test.ts`): 8 tests covering valid full config, minimal config, empty object, invalid types (version, agent.default, redaction.enabled, rules.paths), and type inference.
- **Unit — config resolver** (`apps/cli/tests/config/resolver.test.ts`): 4 tests covering missing config, project resolution, global fallback, and project preference.
- **Integration — full CLI parity:** 566 tests pass (0 fail) — all existing command tests exercise `main()` through the bootstrap. Init/status tests updated to verify `.spur/config.yaml` instead of `.spur/config.json`.
- **Lifecycle:** `app.stop('shutdown')` awaited in `main()`.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References
