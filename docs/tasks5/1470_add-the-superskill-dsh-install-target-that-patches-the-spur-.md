---
schema_version: 1
name: Add the superskill dsh install target that patches the Spur MCP loader entry
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:47.781Z
updated_at: "2026-11-27T16:57:05.297Z"
feature_id: B811

estimate_hours: 4
priority: P2
---

## 1470. Add the superskill dsh install target that patches the Spur MCP loader entry

### Background

Feature B811 asks for a Superskill `dsh` install target that writes the Spur MCP loader entry into dsh's profile patch. Hooks were dropped from scope.

What exists:
- **Spur reads but never writes the patch.** `packages/app/src/services/agent-mcp-readiness.ts:170-182` (`id: 'deepseek'`, path `~/.dsh/profiles/headless/cordis.patch.yml`, format `yaml`). `dshPatchEntry` (`:66`) accepts a YAML **array** whose item has `name: '@deepseek-ai/dsh-mcp-client'` and `config.serverName: 'spur'`. The probe then reads `config.url` (http) or `config.command` (stdio) at `:240-256`.
- **The design calls writing it B811.** `docs/design/dsh-agent-integration.md:53` records the shape, verified against dsh-mcp-client 0.2.2-rc.1.
- **The source of truth is `plugins/sp/mcp.json`:** `{"mcpServers":{"spur":{"command":"spur","args":["mcp","--gateway"],"envVars":[…]}}}`.
- **Superskill has an install-only target pattern.** `../superskill/packages/core/src/targets.ts:26` (`INSTALL_TARGETS = [...TARGETS, 'grok-bot']`, ADR-036). Post-install actions go through `createPostInstallRegistry` (`operations/post-install.ts:94`) with `TransactionalWrite` (`:47`). `mapper.ts:288-294` already reads the plugin `mcp.json`. `yaml@^2.9` is a core dependency.

Cross-repo precedent (task 1456): do the work and run the gates in `../superskill`, then stop before bump/publish for authorization.

**Refine corrections (2026-11-27)**

- R2 loader item `config: { serverName, command, args, env names }` → installed dsh-mcp-client 0.2.2-rc.1 README (minimal configuration + field table) requires `transport` (`stdio` | `streamable-http`) and takes stdio env as an `env` **map** merged over a scrubbed ambient env; there is no `env_vars` field → R2 freezes `{ name: '@deepseek-ai/dsh-mcp-client', config: { serverName, transport: 'stdio', command, args, env: { <NAME>: !!js process.env.<NAME> } } }`.
- R5 "only env var names" assumed names alone reach the child → dsh-mcp-client drops ambient names matching `/KEY|PASSWORD|SECRET|TOKEN/i` (README "Environment scrubbing"), so `SPUR_MCP_TOKEN` would never reach `spur mcp` unless forwarded explicitly → each `mcp.json` `envVars` name is written as a `!!js process.env.<NAME>` reference (README's own pattern): a reference, never a value.
- Spur probe premise → `dshPatchEntry` reads `config.command`/`url` and `env_vars`, but the dsh spec sets `needsEnvVars: false` (`agent-mcp-readiness.ts:170-182`) → the `env` map does not affect the readiness verdict; no Spur probe change. Writing a Spur-only `env_vars` key is rejected (dsh ignores it).
- Superskill gate "`bun run check`" → `../superskill/package.json` has `spur-check` (`lint && test-pre-check && test && test-post-check`); `check` skips the rule gates → R6/Plan use `bun run spur-check`.
- Verified: `INSTALL_TARGETS` at `targets.ts:26`, `createPostInstallRegistry` at `operations/post-install.ts:94`, `TransactionalWrite` type at `:47`, grok-bot precedent (`operations/grok-bot.ts` `postActions` `:1008`, `writeTransactional` `:1075`), `mapper.ts:288-294` reads `mcp.json`, `yaml@^2.9.0`; `plugins/sp/mcp.json` envVars `SPUR_GATEWAY_PORT`, `SPUR_MCP_ENABLED`, `SPUR_MCP_AUTH_ENV`, `SPUR_MCP_TOKEN`.
- Labeled assumption: the headless profile loader evaluates `!!js` tags in `cordis.patch.yml` as the README shows for loader config. Verification: Plan step 5 (a dsh `--json` run lists an `mcp__spur__*` tool); if dsh cannot run, record the proof as blocked.
- AC rows used the non-canonical `R<n> —` form → rewritten as `AC<n> — … (req: …)` with test layers.

### Requirements

- [ ] R1. `dsh` joins `INSTALL_TARGETS` as an install-only target (ADR-036 pattern). It does not join `TARGETS`, rulesync, or the default/`all` expansion.
- [ ] R2. `superskill install <plugin> --targets dsh` translates every `mcpServers` entry of the plugin `mcp.json` into one loader item `{ name: '@deepseek-ai/dsh-mcp-client', config: { serverName: <key>, transport: 'stdio', command, args, env: { <NAME>: !!js process.env.<NAME> } } }`, one `env` entry per `envVars` name. Items are written to `~/.dsh/profiles/headless/cordis.patch.yml` through `TransactionalWrite`, and the file and directory are created when absent.
- [ ] R3. Reinstall is idempotent. Items are keyed by `name` + `config.serverName`: owned items are replaced in place, and foreign items (other loaders, other server names) keep their content and order. A second identical install produces byte-identical output.
- [ ] R4. `--dry-run` prints the planned patch diff and writes nothing. An unparseable existing patch fails with an actionable message and leaves the file untouched.
- [ ] R5. No secret values are written: `env` entries are `!!js process.env.<NAME>` references only. Nothing under `~/.dsh` other than that patch file is read or written.
- [ ] R6. Spur's readiness probe reports the written entry as ready. The superskill gate (`bun run spur-check`) passes. Bump/publish waits for Robin's authorization.

Out of scope: dsh hooks; other dsh profiles; the dsh skills install (§4 of the design); changing Spur's probe.

### Acceptance Criteria

- [ ] AC1 — The dsh target writes the Spur MCP loader entry (req: R1; R2; R4; R5; R6) — unit (superskill, temp HOME): absent patch → created with one `@deepseek-ai/dsh-mcp-client` item carrying `transport: stdio`, `command: spur`, `args: [mcp, --gateway]` and four `!!js process.env.<NAME>` env references and no literal values; `--dry-run` writes nothing; unparseable YAML errors and leaves the file untouched. Real proof: Spur's readiness probe reports dsh "ready" against that HOME.
- [ ] AC2 — Reinstall is idempotent and preserves foreign entries (req: R3) — unit (superskill, temp HOME): a second install is byte-identical; a foreign loader and a foreign `serverName` keep content and order; a stale owned item is replaced in place.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:15.107Z

- **Q: A full execution target, or install-only?** A: Install-only, like `grok-bot`. dsh needs only the MCP patch, not skills/commands mapping through rulesync.
- **Q: Which profile?** A: `headless`. Spur dispatches dsh headless, and that is the path Spur's probe reads.
- **Q: Stdio `spur mcp --gateway` or an http gateway URL?** A: Copy `mcp.json` verbatim (stdio). The probe accepts both, and copying keeps one source of truth.
- **Q: Are the YAML comments in an existing patch preserved?** A: Yes, best effort, using `yaml`'s Document API (`parseDocument`), not `parse`/`stringify`.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: `env_vars` (what Spur's probe parses) or `env` (what dsh-mcp-client reads)?** A: `env`. dsh ignores `env_vars`, and the dsh probe spec has `needsEnvVars: false`, so the verdict is unaffected.
- **Q: How does the token reach `spur mcp` when dsh scrubs `*TOKEN*` names?** A: Each `envVars` name is written as `!!js process.env.<NAME>`, forwarding the operator's value at load time without writing it.
- **Q: Is `transport` required?** A: Yes, per the dsh-mcp-client field table; write `transport: stdio`.

### Design

- **Chosen:** an install-only `dsh` target with a post-install action `dsh-mcp-patch` that merges loader items into `cordis.patch.yml` via `yaml.parseDocument`, using `TransactionalWrite`.
- **Rejected:**
  - Spur writing the patch itself: the boundary in `dsh-agent-integration.md` says Superskill owns installs.
  - Overwriting the whole file: it destroys foreign entries.
- **Frozen names:** target `dsh`; action id `dsh-mcp-patch`; loader name `@deepseek-ai/dsh-mcp-client`.
- **Invariants:**
  - Owned items are keyed by `(name, config.serverName)`.
  - Foreign items stay byte-stable in content and order.
  - Only env var names are written.
- **Anti-patterns:** reading `~/.dsh` credentials; tests touching the real HOME (use a temp HOME).
- **Handoff:** after release, Spur docs `dsh-agent-integration.md` §3 change from "writing it is B811" to the install command.

### Plan

1. Failure modes first (superskill tests, temp HOME):
   - absent file → created with one item (`transport: stdio`, `env` as `!!js` references);
   - existing foreign loader + foreign serverName → preserved, with order kept;
   - reinstall → byte-identical (`!!js` tags round-trip through `parseDocument`);
   - stale owned item → replaced;
   - unparseable YAML → error, file untouched;
   - `--dry-run` → no write;
   - no env values written (a test env with `SPUR_MCP_TOKEN=secret-x` never appears in output).
2. Implement the target id, the post-install action `dsh-mcp-patch` and the merge (`yaml.parseDocument`; build `!!js` scalars with an explicit tag).
3. Run `(cd ../superskill && bun run spur-check)`.
4. Real proof: with a temp HOME, run `superskill install sp --targets dsh` from source. Then run Spur's readiness probe (Board Integrations or the readiness test helper) against that HOME and record "ready".
5. Assumption check: on an unsandboxed host with dsh installed, one `dsh` `--json` run using the written patch lists an `mcp__spur__*` tool. If dsh cannot run, record this as blocked with the reason.
6. Update `docs/design/dsh-agent-integration.md` §3 (Spur) to name the install command, then run `bun run spur-check` in Spur.
7. Stop for bump/publish authorization.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/services/agent-mcp-readiness.ts:66,170-182,240-256`
- `docs/design/dsh-agent-integration.md` §3 (:53)
- `plugins/sp/mcp.json`
- `../superskill/packages/core/src/targets.ts:26`; `operations/post-install.ts:47,94`; `mapper.ts:288-294`
- Feature B811; task 1456

### History

- 2026-11-27T07:54:34.723Z backlog → todo (system)

