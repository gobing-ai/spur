---
schema_version: 1
name: Thin spur mcp stdio-to-HTTP bridge for local CLI clients
status: done
template: feature-impl
created_at: 2026-11-17T18:57:28.330Z
updated_at: "2026-11-17T21:47:58.065Z"
feature_id: B9
priority: P2
tags:
  - mcp
  - cli
  - stdio
estimate_hours: 2

dependencies: ["1370", "1372"]
done_forced: "false"
done_reason: unforced close
---

## 1373. Thin spur mcp stdio-to-HTTP bridge for local CLI clients

### Background

Some local coding agents only configure MCP servers over stdio. A thin `spur mcp` bridge lets them talk to the embedded `/mcp` server without duplicating tool/resource handlers.

### Requirements

- [x] R1. Add `spur mcp` CLI subcommand in `apps/cli/src/commands/` that resolves the project's `/mcp` URL (gateway or direct port) and forwards newline-delimited JSON-RPC from stdin to `POST /mcp`.
- [x] R2. Forward `Mcp-Protocol-Version: 2026-07-28` and bearer token from `server.mcp.authEnv` when configured.

### Acceptance Criteria

- [x] AC1 — Thin spur mcp stdio bridge forwards to the embedded /mcp server (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT / WHY / WHERE**
- Add a thin `spur mcp` CLI stdio-to-HTTP bridge (`apps/cli/src/commands/mcp.ts`, registered in `apps/cli/src/index.ts`) so stdio-only coding agents can reach the embedded `/mcp` server without duplicating tool/resource handlers.

**Frozen Names**
- Command: `spur mcp [--cwd <path>] [--url <mcpUrl>]`
- Export: `registerMcpCommand(program, context)` in `apps/cli/src/commands/mcp.ts`
- Headers forwarded: `Mcp-Protocol-Version: 2026-07-28`, `Content-Type: application/json`, and `Authorization: Bearer <token>` from `server.mcp.authEnv` when set.

**Anti-patterns**
- Do NOT duplicate tool/resource execution inside `apps/cli`—`spur mcp` is strictly a stdio↔HTTP transport shim.

**Dependencies & Handoff**
- Assumes from `1370`: `server.mcp.authEnv` config and gateway prefix resolution.
- Assumes from `1372`: embedded `POST /mcp` endpoint on `spur serve`.
- Leaves for `1374`: `spur mcp` CLI entrypoint for end-to-end stdio verification.

### Plan

- Implement `apps/cli/src/commands/mcp.ts` and register in CLI root.
- Add tests with a mock `/mcp` HTTP upstream verifying stdin-to-HTTP forwarding and error handling.

### Solution

Thin stdio-to-HTTP bridge (feature B9, task 1373) so stdio-only MCP clients reach the embedded `/mcp` endpoint mounted by task 1372. Strictly a transport shim — no tool/resource execution duplicated in the CLI.

#### `apps/cli/src/commands/mcp.ts` (new)
- `mcp.ts:24` — `MCP_PROTOCOL_VERSION = '2026-07-28'`: local mirror of the server adapter's `MIN_MCP_PROTOCOL_VERSION` (`apps/server/src/modules/mcp/protocol.ts`); the server barrel does not re-export it and deep cross-workspace imports are forbidden.
- `mcp.ts:47` `runMcpStdioBridge` (R1/R2 core) — readline over the injectable input; each non-blank line is one `POST url` with `Content-Type: application/json`, `Mcp-Protocol-Version`, and `Authorization: Bearer …` only when a token exists; each response body is echoed to stdout verbatim. HTTP error statuses are NOT failures (their JSON bodies forward like any response — e.g. task 1372's 401 envelope reaches the client untouched). Unreachable upstream → stderr + exit 1 (stop: every later line would fail identically); clean EOF → 0.
- `mcp.ts:82` `resolveMcpUrl` (R1) — precedence: `--url` (handled by the action) → gateway prefix URL `http://127.0.0.1:<gateway.port><prefix>/mcp` when the project is a registered local entry with a resolvable prefix and `isGatewayAnswering` (same precedence as the `projects list` URL column, K4 R7) → direct `http://<entry.host>:<entry.port>/mcp` (registry-recorded live port) → `server.port` fallback.
- `mcp.ts:99` `findRegisteredEntry` — uses `ProjectRegistry.peek()`, the documented read-only snapshot: URL resolution never heals/purges/probes the registry (side effects live in `list()`).
- `mcp.ts:108` `bearerToken` (R2) — reads the variable `server.mcp.authEnv` names from the process env; unset/empty is a loud `CommandError` (the endpoint would refuse every request — same posture as task 1372); no `authEnv` → `null` → no Authorization header.
- `mcp.ts:120` `registerMcpCommand(program, context)` — frozen names: `spur mcp [--cwd <path>] [--url <mcpUrl>]`; `--cwd` uses the shared `cwdServe` option; context is the same slice `registerServeCommand` takes. Server settings (`server.mcp.authEnv`, ports) come from the app-layer env config (`buildConfigFromEnv`) — the same source `spur serve` reads; the `server` surface is env-scoped, not in the project config file (verified: `spurConfigSchema` has no `server.mcp`, so no config-loader wiring is needed). Failures report on stderr only; stdout stays the JSON-RPC channel.

#### `apps/cli/src/index.ts` (wiring)
- `index.ts:29` — import `registerMcpCommand`.
- `index.ts:113`, `index.ts:124`, `index.ts:170-173` — `mcp` joins the boot-free transport dispatch branch (alongside workflow transports): the bridge needs no database/boot, and a full boot would create `.spur/spur.db` as a side effect of a pure transport command. Registered before the workflow fallback via plain `createCliContext(context)`.
- `index.ts:377` — banner suppression for `argv[0] === 'mcp'`: a startup banner would corrupt the NDJSON stdout channel.

#### Tests — `apps/cli/tests/commands/mcp.test.ts` (new)
- `runMcpStdioBridge` unit tests against a real `Bun.serve` upstream: NDJSON forwarding + blank-line skip (R1), the three frozen headers incl. bearer only when configured (R2), 401 body forwarded verbatim without failing, unreachable upstream → stderr + exit 1.
- `resolveMcpUrl`: gateway prefix when the gateway answers, registry live-port fallback, `server.port` fallback for unregistered projects (registry + probe isolated via `SPUR_PROJECTS_FILE` / `setGatewayProbeForTests`).
- Command wiring: `authEnv` naming an absent variable fails loud on stderr with exit 1 and zero stdout traffic.
- End-to-end probe (AC1): spawns the real CLI entry (`bun apps/cli/src/index.ts mcp`) against a mock `/mcp` upstream — asserts exit 0, every stdout line parses as the forwarded JSON-RPC response (no banner), headers on the wire, and no `.spur/spur.db` created in the cwd (boot-free dispatch).

#### Checker-policy exemptions (outside the task-named file set — flagged for review)
- `config/rules/surface/check-cli-surface.yaml` — `mcp.ts` added to the `cli-json-output` exclude list: the command declares no `--json` and stdout is the raw NDJSON JSON-RPC channel; envelope framing would corrupt the protocol stream (same precedent bucket as `step-output.ts` "writes bytes").
- `config/rules/strict/http-boundaries.yaml` — `mcp.ts` added to the `no-direct-fetch` exclude list: POSTing each JSON-RPC line is the command's entire purpose; the rule's own header notes no central HTTP-client seam exists to reuse (same precedent bucket as `apps/server/src/worker.ts`).

#### Not done (by design)
- No `docs/help/cmd_mcp.md` row: the help-doc-parity test walks `buildProgram`; `mcp` is registered in the boot-free transport dispatch path (like workflow transports), which that walk does not cover.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/mcp.ts:47-74` (NDJSON stdin -> POST), `apps/cli/src/commands/mcp.ts:82-95` (gateway prefix / direct port), `apps/cli/src/index.ts:110-113`; tests `apps/cli/tests/commands/mcp.test.ts:46-172` (9 pass this run) |
| R2 | MET | `apps/cli/src/commands/mcp.ts:57-61` (Mcp-Protocol-Version 2026-07-28 + Bearer), `apps/cli/src/commands/mcp.ts:108-117` (authEnv token, loud on unset); tests `apps/cli/tests/commands/mcp.test.ts:47-92`, `apps/cli/tests/commands/mcp.test.ts:176` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Thin spur mcp stdio bridge forwards to the embedded /mcp server (req: R1, R2) | MET | test | `apps/cli/tests/commands/mcp.test.ts:211` (real CLI dispatch), `apps/server/tests/mcp-e2e.test.ts:192` (real bridge through gateway, id round-trip); pass this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1373

**Scope:** task 1373 diff (working tree vs base `d0ebf80a` per `.spur/run/1373-base.sha`; HEAD == base, so the reviewed diff is the uncommitted working-tree diff on `sp/runall-b9-7e0288`). This task's files: `apps/cli/src/commands/mcp.ts` (new), `apps/cli/tests/commands/mcp.test.ts` (new), `apps/cli/src/index.ts` (wiring), `config/rules/strict/http-boundaries.yaml` + `config/rules/surface/check-cli-surface.yaml` (exemptions — judgment call, reviewed on merit below), task corpus doc. Remaining modified files in the tree belong to sibling tasks 1370–1372 (already reviewed PASS — prior-task surface, not re-reviewed here).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture (`--focus all`)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The loud `authEnv`-unset error runs before URL resolution and is not bypassed by `--url`: `bearerToken` is computed unconditionally in the action, so `spur mcp --url <other-endpoint>` still exits 1 when `server.mcp.authEnv` names an unset variable, even though the override target may need no bearer. | `apps/cli/src/commands/mcp.ts:130-131` | ACCEPTED (loud-fail posture mirrors task 1372's refuse-every-request rationale for the embedded endpoint, this task's primary target; `--url` is the test/mock escape hatch and the probe test relies on unset `authEnv` passing) |
| 2 | P4 (advisory) | usability | `mcp` is discoverable only via `spur mcp --help` and the feature doc: it is not registered in `buildProgram`, so top-level `spur --help` does not list it and no `docs/help/cmd_mcp.md` row exists (implementer's judgment call, verified on merit — see below). | `apps/cli/src/index.ts:294-332,170-173` | ACCEPTED (identical surface class to the boot-free workflow transports; no parity gate can see or enforce this surface, so a doc row would be unenforced dead weight until the checker walks boot-free dispatch) |
| 3 | P4 (advisory) | correctness | Each echoed response body goes through `consoleOutput.write` → `echo`, which appends `\n`; the "echoed verbatim" header comment is precise only because this project's own endpoint returns `Response.json` bodies without a trailing newline. An upstream that terminates bodies with `\n` would interleave blank lines into the NDJSON stream. | `apps/cli/src/commands/mcp.ts:68` (`apps/cli/src/output.ts:20-24`, `apps/server/src/modules/mcp/index.ts:275,289`) | ACCEPTED (the designed upstream never emits trailing newlines; clients tolerate blank lines) |

No P1–P3 findings. **Judgment call 1 (rule-YAML exemptions) — reviewed on merit, both legitimate precedented-bucket placements.** `check-cli-surface.yaml:67`: `mcp.ts` declares no `--json` and stdout is the raw NDJSON JSON-RPC channel — envelope framing would corrupt the protocol stream; it joins the same exclude bucket as the transport/byte-writing entries already above it (`task/wrapup.ts`, `feature/handoff.ts`, `feature/verify.ts`, `feature/shared.ts`). `http-boundaries.yaml:28`: the rule header itself states "Spur has no central api-client seam yet", and POSTing each JSON-RPC line is the command's entire purpose — the same bucket as `apps/server/src/worker.ts` (platform fetch is the feature). **T10 corpus-check audit run fresh by review (implementer skipped it): `bun run corpus-check` → exit 0, "0 errors, 118 warnings; no suppressions"** — both exemptions land in the warnings-only buckets with no suppressed findings, so the policy change is audited clean, not a gap. **Judgment call 2 (`docs/help/cmd_mcp.md` skipped) — claim verified.** The CLI-side parity test walks `buildProgram` (`apps/cli/tests/help-doc-parity.test.ts:21,40`) and the plugin-side gate enumerates its surface from a root capture `live([])` (`plugins/sp/tests/help-docs-parity.test.ts:71`) → `bun apps/cli/src/index.ts --help` (`plugins/sp/tests/helpers/cli-surface.ts:87-91`), which routes the full-boot path and `buildProgram` — `mcp` is registered only in the boot-free dispatch branch (`apps/cli/src/index.ts:113,124,170-173`), so both parity checkers structurally cannot see the command and no doc row is required by any gate. **Bridge security pass:** bearer is conditional — `Authorization` header sent only when the token is non-null (`apps/cli/src/commands/mcp.ts:60`); `authEnv` configured but its variable unset/empty is a loud `CommandError` naming the variable (`apps/cli/src/commands/mcp.ts:108-117`), with a wiring test asserting exit 1, the variable named on stderr, and zero stdout traffic (`apps/cli/tests/commands/mcp.test.ts:176-206`); the token value never enters a log or error (fetch errors carry only the URL, `apps/cli/src/commands/mcp.ts:65`). Header forwarding is asserted on the wire (`Content-Type`, `Mcp-Protocol-Version: 2026-07-28`, conditional `Authorization` — `apps/cli/tests/commands/mcp.test.ts:47-77`), and the constant matches the server adapter's `MIN_MCP_PROTOCOL_VERSION` (`apps/server/src/modules/mcp/protocol.ts:20` vs `apps/cli/src/commands/mcp.ts:24`). URL resolution is side-effect-free: `ProjectRegistry.peek()` is the documented read-only snapshot that "never heals, purges or probes" (`packages/app/src/services/project-registry.ts:266-276`), `isGatewayAnswering` is a bounded 200 ms health probe with no registry writes (`packages/app/src/services/project-gateway.ts:68-80`, test seam `setGatewayProbeForTests`), and `resolveServeCwd` is a stat check (`apps/cli/src/commands/serve.ts:25-35`). Boot-free dispatch is proven end-to-end: the probe test spawns the real CLI entry and asserts no `.spur/spur.db` is created in the cwd (`apps/cli/tests/commands/mcp.test.ts:211-240`); the banner is suppressed for the NDJSON channel (`apps/cli/src/index.ts:377`). Anti-pattern guard holds: no tool/resource execution in the CLI — every stdin line is exactly one POST and every response body is forwarded (`apps/cli/src/commands/mcp.ts:47-69`). Efficiency: one fetch per line, no buffering, no retry storm — transport failure stops with exit 1 since every later line would fail identically (`apps/cli/src/commands/mcp.ts:63-66`). Architecture: thin-transport boundary respected (command logic in `apps/cli`, no `@gobing-ai/*` deep imports, registry/config seams reused rather than duplicated; frozen names `spur mcp [--cwd] [--url]` and `registerMcpCommand` as designed).

Gate evidence: named checks `format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:apps/cli`, `typecheck:apps/server`, `typecheck:packages/app`, `typecheck:packages/config`, `test:apps/cli`, `test:apps/server`, `test:packages/app`, `test:packages/config` — 11/11 PASS (tier light; receipt `.spur/run/1373-check-receipt.json`, log `.spur/run/1373-light-gate.log`; integrated full gate deferred to the batch base ref per the receipt's deferred-tier note, 1111 R3). Fresh review-side runs: `(cd apps/cli && bun test tests/commands/mcp.test.ts)` → 9 pass / 0 fail; `bun run corpus-check` → exit 0, 0 errors, 118 warnings, no suppressions; `bunx biome check` over the three task source/test files → clean.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/commands/mcp.ts:47-69` (`runMcpStdioBridge`: readline over stdin, one `POST url` per non-blank NDJSON line, body echoed to stdout), `:82-95` (`resolveMcpUrl`: `--url` → gateway prefix `http://127.0.0.1:<gateway.port><prefix>/mcp` when the registry entry is local and the gateway answers → registry live port → `server.port` fallback), `:120-141` (`registerMcpCommand`, frozen names `spur mcp [--cwd] [--url]`), wiring `apps/cli/src/index.ts:29,113,124,170-173,377` (boot-free dispatch + banner suppression); tests `apps/cli/tests/commands/mcp.test.ts:47-77,154-172,211-240` (NDJSON forwarding + blank-line skip, URL precedence incl. gateway/live-port/server.port, real-CLI-entry probe) |
| R2 | MET | `apps/cli/src/commands/mcp.ts:22-24` (`MCP_PROTOCOL_VERSION = '2026-07-28'`, mirrors `apps/server/src/modules/mcp/protocol.ts:20`), `:58-60` (`Mcp-Protocol-Version` always; `Authorization: Bearer` only when a token exists), `:108-117` (`bearerToken` reads the variable `server.mcp.authEnv` names from env; unset/empty is a loud `CommandError`), config source parity with `spur serve` (`packages/config/src/index.ts:1454-1456` env funnel, `:1362-1374` `server.mcp.authEnv` contract); tests `apps/cli/tests/commands/mcp.test.ts:47-77` (headers on the wire), `:79-91` (no Authorization without token), `:176-206` (loud authEnv failure, zero stdout) |

##### Acceptance Criteria Coverage

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Thin spur mcp stdio bridge forwards to the embedded /mcp server (req: R1, R2) | MET | test+static-ref | End-to-end probe spawning the real CLI entry `bun apps/cli/src/index.ts mcp --url … --cwd …` against a live mock `/mcp` upstream: exit 0, every stdout line parses as the forwarded JSON-RPC response with no banner, protocol + no-auth headers verified on the wire, no `.spur/spur.db` created (`apps/cli/tests/commands/mcp.test.ts:211-240`, fresh run 9 pass / 0 fail); bridge + URL-resolution units `apps/cli/tests/commands/mcp.test.ts:47-172`; static forwarding path `apps/cli/src/commands/mcp.ts:47-141` |

**Residual risk:** light-tier gate only — the integrated full gate is owed on the batch base ref (receipt's deferred-tier note); the bridge against the real embedded `/mcp` endpoint (task 1372's server) over a live `spur serve` is covered by design symmetry and the mock-upstream probe, not a live dual-process run; `mcp` sits outside every help/parity checker's surface walk (finding 2), so future flag drift on this command is unguarded until a checker covers boot-free dispatch.

**Next:** proceed to task 1374 (end-to-end stdio verification against live `spur serve`); no remediation required for 1373.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)
- 2026-11-17T20:34:04.730Z todo → wip (system)
- 2026-11-17T20:43:45.416Z wip → testing (system)
- 2026-11-17T20:43:46.699Z testing → done (system)

