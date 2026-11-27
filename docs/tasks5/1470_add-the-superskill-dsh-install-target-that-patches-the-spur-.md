---
schema_version: 1
name: Add the superskill dsh install target that patches the Spur MCP loader entry
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:47.781Z
updated_at: "2026-11-27T07:54:34.723Z"
feature_id: B811

estimate_hours: 4
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

### Requirements

- [ ] R1. `dsh` joins `INSTALL_TARGETS` as an install-only target (ADR-036 pattern). It does not join `TARGETS`, rulesync, or the default/`all` expansion.
- [ ] R2. `superskill install <plugin> --targets dsh` translates every `mcpServers` entry of the plugin `mcp.json` into one loader item `{ name: '@deepseek-ai/dsh-mcp-client', config: { serverName: <key>, command, args, env names } }`. Items are written to `~/.dsh/profiles/headless/cordis.patch.yml` through `TransactionalWrite`, and the file and directory are created when absent.
- [ ] R3. Reinstall is idempotent. Items are keyed by `name` + `config.serverName`: owned items are replaced in place, and foreign items (other loaders, other server names) keep their content and order. A second identical install produces byte-identical output.
- [ ] R4. `--dry-run` prints the planned patch diff and writes nothing. An unparseable existing patch fails with an actionable message and leaves the file untouched.
- [ ] R5. No secret values are written: only env var **names**. Nothing under `~/.dsh` other than that patch file is read or written.
- [ ] R6. Spur's readiness probe reports the written entry as ready. Superskill gates (`bun run check`) pass. Bump/publish waits for Robin's authorization.

Out of scope: dsh hooks; other dsh profiles; the dsh skills install (§4 of the design).

### Acceptance Criteria

- [ ] R1 — The dsh target writes the Spur MCP loader entry
- [ ] R2 — Reinstall is idempotent and preserves foreign entries

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:15.107Z

- **Q: A full execution target, or install-only?** A: Install-only, like `grok-bot`. dsh needs only the MCP patch, not skills/commands mapping through rulesync.
- **Q: Which profile?** A: `headless`. Spur dispatches dsh headless, and that is the path Spur's probe reads.
- **Q: Stdio `spur mcp --gateway` or an http gateway URL?** A: Copy `mcp.json` verbatim (stdio). The probe accepts both, and copying keeps one source of truth.
- **Q: Are the YAML comments in an existing patch preserved?** A: Yes, best effort, using `yaml`'s Document API (`parseDocument`), not `parse`/`stringify`.

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
   - absent file → created with one item;
   - existing foreign loader + foreign serverName → preserved, with order kept;
   - reinstall → byte-identical;
   - stale owned item → replaced;
   - unparseable YAML → error, file untouched;
   - `--dry-run` → no write;
   - no env values written.
2. Implement the target id, the post-install action and the merge.
3. Run `(cd ../superskill && bun run check)`.
4. Real proof: with a temp HOME, run `superskill install sp --targets dsh` from source. Then run Spur's readiness probe (Board Integrations or the readiness test helper) against that HOME and record "ready".
5. Update `docs/design/dsh-agent-integration.md` §3 (Spur) to name the install command, then run `bun run spur-check` in Spur.
6. Stop for bump/publish authorization.

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

