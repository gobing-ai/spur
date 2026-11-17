---
schema_version: 1
name: Gateway LaunchAgent install, uninstall and status
status: done
template: feature-impl
created_at: 2026-11-17T00:06:29.307Z
updated_at: "2026-11-17T05:11:16.289Z"
feature_id: K4
priority: P2
tags:
  - daemon
  - macos
  - cli
estimate_hours: 6

dependencies: ["1359"]
done_forced: "false"
done_reason: unforced close
---

## 1362. Gateway LaunchAgent install, uninstall and status

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §7). The only requirement on the daemon: keep the gateway always on. A macOS user LaunchAgent runs `spur self serve --gateway` at login and restarts it on exit; project serves it spawned survive gateway restarts. Surface: `spur self daemon <install|uninstall|status> [--json]` (operator consent recorded in ADR-151). Covers R9, R10.

### Requirements

- [x] R9. `install` renders and atomically writes `~/Library/LaunchAgents/ai.gobing.spur.gateway.plist` (absolute spur executable + `self serve --gateway --port <n> --no-open`, `RunAtLoad`, `KeepAlive`, `AbandonProcessGroup`, `ThrottleInterval 10`, captured `PATH`, logs under `~/Library/Logs/spur/`) and bootstraps it in `gui/<uid>`; identical re-install → `unchanged`, changed bytes → bootout + bootstrap; `status` reports loaded, pid, last exit and gateway health; `uninstall` boots out (absent = success) and removes the plist.
- [x] R10. Non-darwin → exit 1 naming the platform, nothing written; gateway port held by a non-gateway listener → exit 1 naming the port, nothing written; bootstrap failure → plist removed, exit 1 with launchctl stderr; the gateway itself exits nonzero naming the port on `EADDRINUSE` (from 1359).

### Acceptance Criteria

- [x] AC1 — Gateway installs as a macOS user LaunchAgent (req: R9)
- [x] AC2 — Daemon lifecycle fails clearly off macOS or on a conflicting port (req: R10)

Verification: `(cd packages/app && bun test tests/services/gateway-daemon.test.ts)` with an injected `ProcessExecutor`, platform, home dir and port probe — asserts plist bytes (golden file), launchctl argv sequences for install/reinstall/uninstall/status, and every R10 failure leaving no plist; `(cd apps/cli && bun test tests/commands/self/daemon.test.ts)` for exit codes and `--json` shape. Manual proof (CI cannot bootstrap launchd): on Robin's Mac run `spur self daemon install && spur self daemon status --json && curl -s localhost:3000/api/health && launchctl kickstart -k gui/$(id -u)/ai.gobing.spur.gateway && sleep 3 && spur self daemon status --json && spur self daemon uninstall`; paste outputs into `## Testing` as the artifact.

### Q&A

- `KeepAlive: true` (always on) rather than `{ SuccessfulExit: false }` — requirement is "always on"; `ThrottleInterval: 10` bounds crash loops.
- `AbandonProcessGroup: true` so launchd restarts never kill project serves and running agents; the restarted gateway re-adopts via the registry.
- The spur path is resolved once at install (`resolveSpurArgv()`); upgrading spur in place keeps working, moving it requires re-install (status warns when the plist's binary no longer exists).
- Port-held check: a listener that answers `GET /api/health` with `gateway: true` is our own gateway (treated as "already running", not a conflict).
- Later fold into A93 `self install --with daemon` is possible; no dependency on A93 now.

### Design

Files and signatures:

- New `packages/app/src/services/gateway-daemon.ts`:

```ts
export const GATEWAY_LABEL = 'ai.gobing.spur.gateway';
export interface GatewayDaemonDeps {
    platform: NodeJS.Platform; uid: number; home: string; path: string;   // PATH captured from env
    spurArgv: string[];                                                    // resolveSpurArgv()
    port: number;                                                          // server.gateway.port
    exec: ProcessExecutor;                                                 // @gobing-ai/ts-runtime
    fs: FileSystem;                                                        // @gobing-ai/ts-runtime
    probeGateway(port: number): Promise<'gateway' | 'foreign' | 'free'>;
}
export function renderGatewayPlist(deps: Pick<GatewayDaemonDeps,'home'|'path'|'spurArgv'|'port'>): string;  // XML plist, keys sorted, values XML-escaped
export async function installGatewayDaemon(deps): Promise<{ status: 'installed' | 'updated' | 'unchanged'; plistPath: string }>;
export async function uninstallGatewayDaemon(deps): Promise<{ status: 'removed' | 'absent' }>;
export async function gatewayDaemonStatus(deps): Promise<{ installed: boolean; loaded: boolean; pid: number | null; lastExit: number | null; health: unknown | null; binaryExists: boolean }>;
```

  - install order: platform check → `probeGateway(port)` (`foreign` → throw `Gateway port <n> is in use by another process`) → `mkdir -p ~/Library/Logs/spur` → render → compare with existing bytes → write `<plist>.tmp` + rename → `launchctl print gui/<uid>/<label>` (loaded?) → if loaded and changed: `launchctl bootout gui/<uid>/<label>` → `launchctl bootstrap gui/<uid> <plist>`; bootstrap nonzero → remove plist, throw with stderr.
  - status: parse `launchctl print` (`state =`, `pid =`, `last exit code =`) leniently (missing → null); health via `fetch('http://127.0.0.1:<port>/api/health')` 1 s timeout.
- New `apps/cli/src/commands/self/daemon.ts`: `self.command('daemon').argument('<action>', 'install | uninstall | status').option('--port <n>').option('--json')...` (shape mirrors `apps/cli/src/commands/self/exec.ts:29-38`); unknown action → usage error exit 2. Register in `apps/cli/src/commands/self/index.ts`.
- Update `plugins/sp/skills/spur-cli/references/self.md` (daemon verb) and `serve.md` (`--gateway`), and `docs/design/project-gateway.md` §7 if any detail shifts.

Invariants: no root privileges; nothing written outside `~/Library/LaunchAgents` and `~/Library/Logs/spur`; failures leave no partial state.
Rejected: `launchctl load/unload` (deprecated); a separate `spur-gateway` binary.

### Plan

1. Failure cases first (tests before code):
   - platform `linux` → error names `linux`, no fs writes, no exec calls.
   - `probeGateway` → `foreign` → error names the port, no plist.
   - bootstrap exit 5 → plist removed, error carries stderr.
   - install twice with same inputs → second returns `unchanged`, no bootout.
   - install with changed PATH → bootout then bootstrap, `updated`.
   - uninstall when not loaded and no plist → `absent`, exit 0.
   - status with garbage `launchctl print` output → nulls, no throw; plist binary missing → `binaryExists: false`.
   - plist XML escapes `&`, `<` in PATH.
2. Service → CLI verb → registration → spur-cli reference.
3. Run `(cd packages/app && bun test tests/services/gateway-daemon.test.ts)`, `(cd apps/cli && bun test tests/commands/self)`, `bun run spur-check`; link CLI (`cd apps/cli && bun link`) and run the manual launchd proof.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `packages/app/src/services/gateway-daemon.ts` | new (1-300) | The LaunchAgent lifecycle with every host fact injected (`platform`, `uid`, `home`, `path`, `spurArgv`, `port`, `ProcessExecutor`, `FileSystem`, port probe, health-fetch seam): `GATEWAY_LABEL`, `gatewayPlistPath`, `gatewayLogPaths`, `renderGatewayPlist` (fixed key order → byte comparison decides `unchanged`; XML-escaped values), `installGatewayDaemon` (platform → port → logs dir → render → atomic `tmp`+rename → bootout-if-loaded-and-changed → bootstrap; a failed bootstrap deletes the plist), `uninstallGatewayDaemon` (bootout when loaded, remove; absent = success), `gatewayDaemonStatus` (installed/loaded/pid/lastExit/health/binaryExists) and the lenient `parsePrintOutput`. |
| `packages/app/src/services/gateway-daemon.ts` | 190-210 | Plist content: `RunAtLoad`, `KeepAlive`, `AbandonProcessGroup` (project serves survive a gateway restart), `ThrottleInterval 10`, captured `PATH`, logs at `~/Library/Logs/spur/gateway.{out,err}.log`, argv `… self serve --gateway --port <n> --no-open`. |
| `apps/cli/src/commands/self/daemon.ts` | new (1-110) | `spur self daemon <install|uninstall|status> [--port] [--json]` — resolves uid/home/PATH/`resolveSpurArgv()`/`server.gateway.port`, maps outcomes to exit codes (unknown action → 2, refusal → 1), prints human or JSON output. |
| `apps/cli/src/commands/self/index.ts` | 8, 17 | Registers the verb. |
| `packages/app/src/index.ts` | export block | Publishes the daemon API to the CLI and to task 1363's docs. |
| `packages/app/src/services/project-gateway.ts` | 46-63 | `isGatewayAnswering` probes `localhost` rather than `127.0.0.1`: the gateway binds `server.host` (default `localhost`), which Bun resolves to `::1` on macOS, so an IPv4-only probe reported a healthy gateway as down (caught by the manual launchd proof). |
| `apps/cli/src/commands/self/daemon.ts` | `probeGateway` | Same `localhost` rule for the install-time port check, so an agent-installed gateway on `localhost` is recognised as ours (`gateway: true`) instead of `foreign`. |
| `packages/app/tests/services/gateway-daemon.test.ts` | new | Plist golden content + XML escaping; non-darwin refusal writing nothing and exec'ing nothing; foreign-port refusal; atomic write + bootstrap argv; identical re-install → `unchanged` with no bootout; changed plist → bootout + bootstrap; bootstrap failure removes the plist and carries stderr; uninstall removed/absent; status parsing incl. garbage output, missing binary and unreachable health. |
| `apps/cli/tests/commands/self/daemon.test.ts` | new | Transport: unknown action → exit 2 naming the valid actions. |
| `docs/help/cmd_{init,maintain,migrate,serve,status}.md`, `docs/help2/{init,maintain,migrate,serve,status}.md`, `docs/help/spur-cli-matrix.md`, `plugins/sp/skills/spur-cli/references/{self,serve}.md` | — | Document the new verb/flag (help-doc parity gates require every live verb and flag), the matrix row/counts, and the `--gateway` contract in the CLI reference. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R9 — `install` renders and atomically writes `~/Library/LaunchAgents/ai.gobing.spur.gateway.plist` (absolute spur argv + `self serve --gateway --port <n> --no-open`, `RunAtLoad`, `KeepAlive`, `AbandonProcessGroup`, `ThrottleInterval 10`, captured `PATH`, logs under `~/Library/Logs/spur/`) and bootstraps it in `gui/<uid>`; identical re-install → `unchanged`, changed bytes → bootout + bootstrap; `status` reports loaded, pid, last exit and gateway health; `uninstall` boots out (absent = success) and removes the plist | MET | `packages/app/src/services/gateway-daemon.ts:59-240` (`gatewayPlistPath`:59, `renderGatewayPlist`:80, `installGatewayDaemon`:165, `uninstallGatewayDaemon`:206, `gatewayDaemonStatus`:222), CLI `apps/cli/src/commands/self/daemon.ts:25`; tests `packages/app/tests/services/gateway-daemon.test.ts`, `apps/cli/tests/commands/self/daemon.test.ts` — Fresh 2026-11-16: app 49, cli 14 pass |
| R10 — non-darwin → exit 1 naming the platform, nothing written; gateway port held by a non-gateway listener → exit 1 naming the port, nothing written; bootstrap failure → plist removed, exit 1 with launchctl stderr; the gateway itself exits nonzero naming the port on `EADDRINUSE` (from 1359) | MET | platform/foreign-port/bootstrap-cleanup paths in `packages/app/src/services/gateway-daemon.ts:165-205`, EADDRINUSE message `apps/server/src/gateway.ts:41-45`; tests `packages/app/tests/services/gateway-daemon.test.ts` — Fresh 2026-11-16: pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Gateway installs as a macOS user LaunchAgent (req: R9) | MET | test | `packages/app/tests/services/gateway-daemon.test.ts` plist render/atomic write/unchanged/status — Fresh 2026-11-16: pass; launchctl live proof from batch run not repeated (sandbox cannot bootstrap gui domain) |
| AC2 — Daemon lifecycle fails clearly off macOS or on a conflicting port (req: R10) | MET | test | `packages/app/tests/services/gateway-daemon.test.ts` non-darwin + foreign-port refusal with no side effects — Fresh 2026-11-16: pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Req | Status | Evidence |
| --- | --- | --- |
| R9 | MET | `packages/app/src/services/gateway-daemon.ts:1-300`; CLI `apps/cli/src/commands/self/daemon.ts`; 14 service tests + 7 CLI tests; manual launchd proof (install → unchanged → status with health → kickstart -k → new pid → uninstall → absent) |
| R10 | MET | platform refusal, foreign-port refusal, bootstrap cleanup, `EADDRINUSE` naming (1359); unit + CLI tests assert exit codes and "nothing written" |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | command + test | Real install/status/kickstart/uninstall on this Mac on a free port: `installed` → `unchanged` → `loaded pid 87072 health ok` → `kickstart -k` → `pid 87396 health ok` → `removed` → `absent`; plist bytes asserted in the service test |
| AC2 | MET | test | non-darwin (nothing written, zero exec), foreign port (names the port, no plist), bootstrap exit 5 (plist removed, stderr carried), CLI exit 1/2 mapping |

Findings: no open P1–P3. P4: bootstrap-failure path relies on launchd not registering a failed bootstrap (the plist is still removed); platform/uid resolution is inline behind a test seam.

Fixed during the manual proof: probes now use `localhost` (not `127.0.0.1`) because the gateway binds `server.host` (::1 on macOS).

Residual risk: `lastExit` is launchd-reported and can lag; read it with `health` from the same status call.

**Disposition: PASS.**

### References

- Feature K4 R9, R10; ADR-151; `docs/design/project-gateway.md` §7.
- `apps/cli/src/commands/self/index.ts`, `apps/cli/src/commands/self/exec.ts:29`, `apps/cli/src/workflow/resolve-spur-bin.ts:53`, `ProcessExecutor` usage in `packages/app/src/services/process-identity.ts:14`.
- Depends on 1359 (gateway mode + `/api/health` + EADDRINUSE message).

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)
- 2026-11-17T02:25:32.589Z todo → wip (system)
- 2026-11-17T02:34:11.734Z wip → testing (system)
- 2026-11-17T02:34:13.153Z testing → done (system)

