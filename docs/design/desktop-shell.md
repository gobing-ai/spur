---
kind: design
title: "Desktop shell"
status: implemented
created_at: 2026-10-03
updated_at: 2026-10-04
tags: [contract, desktop, electron]
---

# Desktop shell

Non-UI contract for `apps/desktop`. Indexed by [04 Design](../04_DESIGN.md).
Visual tokens stay in root `DESIGN.md`. The shell is a transport: it does not import
`@gobing-ai/spur-server`, does not call `startServer`, and does not open SQLite.
The child process is the only database owner, at `<projectRoot>/.spur/spur.db`.

## Launch

| Input | Meaning |
| --- | --- |
| `SPUR_DESKTOP_MODE` | `dev` or `prod`. Empty defaults to `dev` when Electron is unpackaged and `prod` when packaged. Any other value throws. |
| `SPUR_PROJECT_ROOT` | Project directory whose `.spur/spur.db` the child owns. Overridden by `--project <path>` / `--project=<path>`. Dev with neither set uses the checkout root. Packaged launches with neither set prompt for a directory; cancelling quits without starting a server. Unpackaged prod uses the Electron process cwd. The path must be an existing directory. |
| `SPUR_DESKTOP_BIN` | Prod only. Forces the child binary. Resolved to an absolute path against the directory Electron was launched from **before** the existence check. A relative value is not resolved again from `projectRoot` (the child cwd). Missing path throws and does not fall through. |
| `BUN_PATH` | Dev only. `bun` executable. Defaults to `bun` on `PATH`. Relative paths containing a path separator resolve against the Electron launch cwd. |

Dev command, cwd = checkout root:

```text
bun run apps/cli/src/index.ts serve --host 127.0.0.1 --port <free> --no-open --cwd <projectRoot>
```

Prod prefers a CLI binary (`serve` flags above, child cwd = `projectRoot`). A binary whose file name is `spur-server` (optional `.exe`) is the standalone server: no argv, `HOST=127.0.0.1`, `PORT=<free>`, child cwd = `projectRoot`. Candidate order when `SPUR_DESKTOP_BIN` is unset:

1. Packaged `process.resourcesPath/spur/spur` then `spur-server` (`.exe` on Windows). Unpackaged prod uses `apps/desktop/resources/spur/` instead. Electron's own `resourcesPath` is ignored unless the app is packaged.
2. `<repo>/dist/cli/spur-<os>-<arch>` then `<repo>/dist/server/spur-server` when a checkout is visible.

`<os>` is `darwin`, `linux`, or `windows`; `<arch>` is `x64` or `arm64`. The child environment is the parent environment with `DATABASE_URL` removed, so the child cannot be pointed at a second database.

The shell binds `127.0.0.1:0` to pick the port, then polls `GET http://127.0.0.1:<port>/api/health` until `{ status: "ok" }` or 60 seconds. The window then loads `http://127.0.0.1:<port>/board`.

## Packaging

`desktop:stage` copies a compiled binary and `dist/web` to `apps/desktop/resources/spur/web` so the server's `resolveWebDistPath` finds `dirname(execPath)/web`.

`bun run build` produces `dist/server/spur-server` and `dist/web`, not a platform CLI. When stage falls back to that server it also ships a CLI companion at `dirname(serverBinary)/../cli/spur` (`.exe` on Windows). That is the path `resolveStandaloneSpurInvocation` in `apps/server/src/index.ts` uses for history refresh. Stage copies `dist/cli/spur-<os>-<arch>` or `dist/cli/spur` when present, and otherwise runs `scripts/spur-dev.ts build-cli`. Packaged builds publish both directories as `extraResources` (`spur` and `cli`).

The desktop devDependency pins Electron **44.5.1** (supported stable line). Electron 35 is end of life and must not be reintroduced.

## Process lifetime

One instance. A second launch focuses the existing window. `before-quit` stops the child with SIGTERM, then SIGKILL after a grace period. Quit while health is still pending aborts startup and kills the already spawned child; the process is not left holding the project database and port. The same stop runs when health never arrives or spawn fails. On POSIX the child is its own process group so `bun run` grandchildren die with it.

## Renderer IPC

Preload (`contextIsolation`, no Node in the page, sandbox, `webSecurity`) exposes `window.spurDesktop` only in the main frame with `platform` and `minimize` / `toggleMaximize` / `close`. Those map to the `desktop:window` channel. Any other payload or IPC sender frame is ignored. Subframe Node integration is explicitly disabled. The preload sets `html[data-spur-desktop]` and `html[data-spur-desktop-platform]` (`darwin`, `win32`, `linux`, …). Browsers and the Cloudflare worker never set those attributes.

Navigation that leaves the child origin is cancelled. New Electron windows are denied; HTTP(S) links without embedded credentials open in the system browser. Other schemes and malformed targets are rejected. Permission requests and checks are denied before the Board loads.

## Window controls overlay

The window uses `titleBarStyle: hidden` with the native frame retained so macOS traffic lights remain visible. macOS uses traffic-light insets and a drag strip in the Board sidebar (`[data-spur-drag-region]`, 2.25rem, `-webkit-app-region: drag`), active only when `data-spur-desktop` is set.

Windows and Linux set `titleBarOverlay` (`height: 36`, overlay color `#1a1d27`). Native controls sit on top of the web content; that rectangle is not usable by the page. The Board therefore, only when `data-spur-desktop-platform` is `win32` or `linux`:

- pads `.board-layout` by `env(titlebar-area-height, 36px)` so the sidebar, workspace, and right panel all start below the overlay
- draws the drag region at `env(titlebar-area-x/y)` with size `env(titlebar-area-width)` by `env(titlebar-area-height)`, which excludes the window controls
- clears the sidebar strip so it does not add a second inset
- keeps the mobile sidebar drawer below the same height

The browser and Cloudflare boards do not set the platform attribute, so their layout is unchanged.

Unexpected child exits after startup show an error and quit the shell. Quit awaits pending startup cleanup before Electron exits. Health probes remove their cancellation listeners after each request.

Electron reads the parent environment through the config gateway. Its Node process and filesystem
adapters are limited to `src/server-process.ts` and `src/layout.ts`: the streaming runtime handle requires Bun, which is absent
in Electron. The runtime rules allow those specific adapters while retaining the boundary
for the rest of the desktop sources.

Stage includes a generated `config/` beside both compiled binaries. The config resolver falls
back to `dirname(process.execPath)/config` when virtual Bun module paths contain no assets; this
ships the task section matrix, rules, workflows and templates without seeding the selected project.

The same binary directories carry the CLI package manifest and `schemas/` so package schema
references validate without a node_modules tree. Existing embedded-schema resolution keeps precedence.
