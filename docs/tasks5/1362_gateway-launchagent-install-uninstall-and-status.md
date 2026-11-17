---
schema_version: 1
name: Gateway LaunchAgent install, uninstall and status
status: todo
template: feature-impl
created_at: 2026-11-17T00:06:29.307Z
updated_at: "2026-11-17T00:29:16.798Z"
feature_id: K4
priority: P2
tags:
  - daemon
  - macos
  - cli
estimate_hours: 6

dependencies: ["1359"]
---

## 1362. Gateway LaunchAgent install, uninstall and status

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §7). The only requirement on the daemon: keep the gateway always on. A macOS user LaunchAgent runs `spur self serve --gateway` at login and restarts it on exit; project serves it spawned survive gateway restarts. Surface: `spur self daemon <install|uninstall|status> [--json]` (operator consent recorded in ADR-151). Covers R9, R10.

### Requirements

- [ ] R9. `install` renders and atomically writes `~/Library/LaunchAgents/ai.gobing.spur.gateway.plist` (absolute spur executable + `self serve --gateway --port <n> --no-open`, `RunAtLoad`, `KeepAlive`, `AbandonProcessGroup`, `ThrottleInterval 10`, captured `PATH`, logs under `~/Library/Logs/spur/`) and bootstraps it in `gui/<uid>`; identical re-install → `unchanged`, changed bytes → bootout + bootstrap; `status` reports loaded, pid, last exit and gateway health; `uninstall` boots out (absent = success) and removes the plist.
- [ ] R10. Non-darwin → exit 1 naming the platform, nothing written; gateway port held by a non-gateway listener → exit 1 naming the port, nothing written; bootstrap failure → plist removed, exit 1 with launchctl stderr; the gateway itself exits nonzero naming the port on `EADDRINUSE` (from 1359).

### Acceptance Criteria

- [ ] AC1 — Gateway installs as a macOS user LaunchAgent (req: R9)
- [ ] AC2 — Daemon lifecycle fails clearly off macOS or on a conflicting port (req: R10)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature K4 R9, R10; ADR-151; `docs/design/project-gateway.md` §7.
- `apps/cli/src/commands/self/index.ts`, `apps/cli/src/commands/self/exec.ts:29`, `apps/cli/src/workflow/resolve-spur-bin.ts:53`, `ProcessExecutor` usage in `packages/app/src/services/process-identity.ts:14`.
- Depends on 1359 (gateway mode + `/api/health` + EADDRINUSE message).

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)

