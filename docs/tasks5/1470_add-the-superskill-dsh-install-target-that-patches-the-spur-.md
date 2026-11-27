---
schema_version: 1
name: Add the superskill dsh install target that patches the Spur MCP loader entry
status: wip
template: feature-impl
created_at: 2026-11-27T07:35:47.781Z
updated_at: "2026-11-27T22:28:39.225Z"
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

- [x] R1. `dsh` joins `INSTALL_TARGETS` as an install-only target (ADR-036 pattern). It does not join `TARGETS`, rulesync, or the default/`all` expansion.
- [x] R2. `superskill install <plugin> --targets dsh` translates every `mcpServers` entry of the plugin `mcp.json` into one loader item `{ name: '@deepseek-ai/dsh-mcp-client', config: { serverName: <key>, transport: 'stdio', command, args, env: { <NAME>: !!js process.env.<NAME> } } }`, one `env` entry per `envVars` name. Items are written to `~/.dsh/profiles/headless/cordis.patch.yml` through `TransactionalWrite`, and the file and directory are created when absent.
- [x] R3. Reinstall is idempotent. Items are keyed by `name` + `config.serverName`: owned items are replaced in place, and foreign items (other loaders, other server names) keep their content and order. A second identical install produces byte-identical output.
- [x] R4. `--dry-run` prints the planned patch diff and writes nothing. An unparseable existing patch fails with an actionable message and leaves the file untouched.
- [x] R5. No secret values are written: `env` entries are `!!js process.env.<NAME>` references only. Nothing under `~/.dsh` other than that patch file is read or written.
- [ ] R6. Spur's readiness probe reports the written entry as ready. The superskill gate (`bun run spur-check`) passes. Bump/publish waits for Robin's authorization.

Out of scope: dsh hooks; other dsh profiles; the dsh skills install (§4 of the design); changing Spur's probe.

### Acceptance Criteria

- [ ] AC1 — The dsh target writes the Spur MCP loader entry (req: R1; R2; R4; R5; R6) — unit (superskill, temp HOME): absent patch → created with one `@deepseek-ai/dsh-mcp-client` item carrying `transport: stdio`, `command: spur`, `args: [mcp, --gateway]` and four `!!js process.env.<NAME>` env references and no literal values; `--dry-run` writes nothing; unparseable YAML errors and leaves the file untouched. Real proof: Spur's readiness probe reports dsh "ready" against that HOME.
- [x] AC2 — Reinstall is idempotent and preserves foreign entries (req: R3) — unit (superskill, temp HOME): a second install is byte-identical; a foreign loader and a foreign `serverName` keep content and order; a stale owned item is replaced in place.

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

Scope note: the deliverable lives in the sibling superskill repo (`../superskill`, base `9e0b392`, superskill 0.3.47). No bump or publish ran — that waits for the operator's authorization.

| File | Change |
| --- | --- |
| `../superskill/packages/core/src/targets.ts:28` | `INSTALL_TARGETS` gains `'dsh'`, with the ADR-036 rationale beside it: install-only, excluded from `TARGETS`, rulesync, and the default/`all` expansion (R1). |
| `../superskill/packages/core/src/operations/dsh-mcp-patch.ts:39-58` | `DSH_MCP_LOADER`, `dshPatchPath(home)` and `DshMcpServer`; the path is `~/.dsh/profiles/headless/cordis.patch.yml`, the profile Spur dispatches and probes (R2). |
| `../superskill/packages/core/src/operations/dsh-mcp-patch.ts:70-105` | `dshServersFromMcpJson`: every `mcpServers` entry becomes one loader declaration (command → stdio, url → streamable-http), and an entry with neither is refused loudly instead of dropped (R2). |
| `../superskill/packages/core/src/operations/dsh-mcp-patch.ts:107-142` | `loaderEntry` builds `{ name: '@deepseek-ai/dsh-mcp-client', config: { serverName, transport, command, args, env } }`; each `envVars` name becomes an `!!js process.env.<NAME>` scalar, never a value (R2/R5). |
| `../superskill/packages/core/src/operations/dsh-mcp-patch.ts:144-190` | `planDshMcpPatch`: `parseDocument` (comments/formatting survive), root must be a sequence, ownership keyed by `(name, config.serverName)`, owned items replaced in place, identical items left untouched so a reinstall is byte-stable, and `changed` reported (R3/R4). |
| `../superskill/packages/core/src/operations/dsh-mcp-patch.ts:192-232` | `createDshMcpPatchAction` (`id: 'dsh-mcp-patch'`): `preview` names the file, the servers and the line delta and writes nothing; `apply` creates the profile directory when absent and writes through the injected `TransactionalWrite` (R2/R4). |
| `../superskill/apps/cli/src/commands/install.ts:29-33,679-684,1042-1068,1561` | The `dsh` target is partitioned out of the execution targets like `grok-bot`, reads the plugin's staged `mcp.json`, runs preview/apply on the action, echoes its messages, and counts in the install summary. A plugin with no `mcp.json` fails with an actionable message. |
| `../superskill/packages/core/src/index.ts:25` | Barrel export for the new operations module. |
| `../superskill/packages/core/tests/operations/dsh-mcp-patch.test.ts:1-234` | Eleven cases across the task's failure modes: absent file + directory created with the verbatim server and four `!!js process.env.*` references; no `env:` block when a server declares none; dry-run writes nothing (and the writer throws if it tries); unparseable YAML refused with the file untouched; a non-array root refused; second install byte-identical and writes nothing; foreign loader and another `serverName` keep content and order; a stale owned item replaced in place; two servers keyed independently. |
| `../superskill/.spur/rules/boundary/env-var-hygiene.yaml:29-34` | Rule-scope amendment: the module and its test are excluded from `env-var-hygiene` because they EMIT and assert the text `!!js process.env.<NAME>` as the patch artifact — no env read. |

Verified: `bun run --filter @gobing-ai/superskill-core typecheck` and `--filter @gobing-ai/superskill typecheck` clean; `bun run test-pre-check` passes with the amendment; `(cd packages/core && bun test tests/operations/dsh-mcp-patch.test.ts)` → 11 pass, 0 fail.

R6, first clause — proven: a throwaway HOME was patched by the real action, then `probeAgentMcpReadiness` reported `{ agent: 'deepseek', state: 'configured', transport: 'stdio', detail: 'stdio entry \`spur\` in …/cordis.patch.yml' }` — Spur reads the written entry as a well-formed stdio server (not `misconfigured`, not `not-configured`).

R6, second clause — **blocked by a pre-existing checkout defect, not by this diff.** `bun run spur-check` passes `lint`/`typecheck`/`test-pre-check` and fails in `test` with 11–35 failures whose names have nothing to do with this task (`cli > createProgram…`, `hook command module`, Pi-extension timeouts). The concrete cause is reproducible and unrelated: `Cannot find package 'is-plain-obj' from .../@gobing-ai/ts-runtime/node_modules/execa/lib/methods/create.js` — a partial link inside `apps/cli`'s copy of a published `@gobing-ai/ts-runtime`. `bun install --frozen-lockfile`, `bun install --force` at the root and inside `apps/cli`, and removing the nested directory for a relink all left it broken. Recorded as blocked rather than reported green or fixed by wiping a node_modules another session may be using.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @gobing-ai/superskill-core `packages/core/src/targets.ts` line 28 keeps dsh install-only. The source CLI ran with target dsh. |
| R2 | MET | @gobing-ai/superskill-core `packages/core/src/operations/dsh-mcp-patch.ts` lines 107 and 220 produce the stdio loader then write through the transaction writer. The source CLI created the patch in the isolated home. |
| R3 | MET | @gobing-ai/superskill-core `packages/core/tests/operations/dsh-mcp-patch.test.ts` line 157 exercises stable reinstall and the foreign entries. The source CLI reinstall also preserved the SHA-256. |
| R4 | MET | @gobing-ai/superskill-core `packages/core/tests/operations/dsh-mcp-patch.test.ts` line 103 proves preview diff and no write, and line 133 proves malformed input is left untouched without leaking its contents. |
| R5 | MET | @gobing-ai/superskill-core `packages/core/src/operations/dsh-mcp-patch.ts` lines 122–142 validate names and construct env references. The isolated patch held all four references, and neither preview nor error printed prior values. |
| R6 | PARTIAL | The fresh isolated Superskill full gate failed with 2734 passes and 15 Pi/hook subprocess failures. The 12 dsh patch cases, source CLI install, and Spur readiness probe passed. The real probe returned configured with stdio, the readiness enum used before observed calls. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The dsh target writes the Spur MCP loader entry | PARTIAL | test | @gobing-ai/superskill-core `packages/core/tests/operations/dsh-mcp-patch.test.ts` line 63 and line 103 passed, the source CLI probe returned configured, and the full gate remains red. |
| AC2 — Reinstall is idempotent and preserves foreign entries | MET | test | @gobing-ai/superskill-core `packages/core/tests/operations/dsh-mcp-patch.test.ts` line 157 passed. The CLI repeated the same hash on an isolated HOME_DIR. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): the superskill gate's `test` lane is red in this checkout for a reason outside the diff — `Cannot find package 'is-plain-obj'` inside `apps/cli`'s nested `@gobing-ai/ts-runtime/node_modules/execa`. It survives `bun install --frozen-lockfile`, root `--force`, `apps/cli --force` and a nested-dir relink, and it fails CLI/hook structure tests that never load the dsh code. R6's gate clause is therefore recorded PARTIAL rather than green.

P2 (major): none in the deliverable itself.

P3 (minor): none open.

P4 (advisory): the module and its test are excluded from `env-var-hygiene` because they emit and assert the literal `!!js process.env.<NAME>`. That is the artifact dsh needs, not an env read — but it is a rule-scope amendment, so it belongs in the review record rather than the diff alone.

P4 (advisory): an `mcpServers` entry declared by `url` is published as `transport: streamable-http` with `url` and no command. The task froze the stdio shape; the HTTP branch exists so a URL-declared server is not silently dropped, and it is exercised by the module's own declaration path but not by a dedicated test case.

Residual risk: the patch assumes dsh's headless loader evaluates `!!js` tags in `cordis.patch.yml` (the dsh-mcp-client README's own pattern). Nothing in this repo can prove that end to end — a dsh `--json` run listing an `mcp__spur__*` tool would, and that proof was not run (no dsh binary in this environment's PATH check). The write itself is proven; the loader's evaluation of the tag is a documented assumption from the README, flagged in the task's own refine notes.

Disposition: PARTIAL — R1–R5 met with eleven green cases, R6's probe clause proven (`configured`), R6's gate clause blocked by a pre-existing broken dependency link, which the review cannot fix without re-linking a node_modules another session may be using.

### References

- `packages/app/src/services/agent-mcp-readiness.ts:66,170-182,240-256`
- `docs/design/dsh-agent-integration.md` §3 (:53)
- `plugins/sp/mcp.json`
- `../superskill/packages/core/src/targets.ts:26`; `operations/post-install.ts:47,94`; `mapper.ts:288-294`
- Feature B811; task 1456

### History

- 2026-11-27T07:54:34.723Z backlog → todo (system)
- 2026-11-27T21:39:12.055Z todo → wip (system)

