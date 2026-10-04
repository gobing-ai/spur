# Spur desktop

Thin Electron shell around the existing Board. The window loads `http://127.0.0.1:<port>/board` from a **child** Spur server. This process does not import `@gobing-ai/spur-server`, does not call `startServer`, and does not open SQLite. The child is the only database owner, at `<projectRoot>/.spur/spur.db` (`DATABASE_URL` is stripped from the child environment so a parent shell cannot point it elsewhere).

Renderer IPC goes through `src/preload.ts` (`contextIsolation`, no Node in the page). A frameless drag strip in the Board sidebar activates only when the preload sets `html[data-spur-desktop]`, so the browser and Cloudflare boards stay unchanged.

## Dev

From the repo root, after dependencies are installed:

```bash
# Board assets. Without dist/web the server is healthy but /board is 404.
bun run --filter @gobing-ai/spur-web build

bun run desktop:dev
```

`desktop:dev` compiles the shell and runs Electron. The child command is:

```text
bun apps/cli/src/index.ts serve --host 127.0.0.1 --port <free> --no-open --cwd <projectRoot>
```

The default project root is this checkout. Point it at another project with `SPUR_PROJECT_ROOT` or `--project`:

```bash
SPUR_PROJECT_ROOT=/path/to/project bun run desktop:dev
```

`bun` must be on `PATH`, or set `BUN_PATH` (relative paths resolve from the launch directory). Quit kills the child (SIGTERM, then SIGKILL), including a quit during the health wait before the child handle is published. A second launch focuses the existing window instead of opening another database.

## Prod

Root `bun run build` produces `dist/server/spur-server` and `dist/web`. Cross-compiled CLI binaries (`dist/cli/spur-<os>-<arch>`, including `spur-windows-*.exe`) come from `bun run --filter @gobing-ai/spur build:binaries`.

```bash
bun run build
bun run desktop:stage
SPUR_DESKTOP_MODE=prod SPUR_PROJECT_ROOT=/path/to/project bun run desktop:start
```

`desktop:stage` ships generated `config/` assets beside both binaries (including the task section matrix), copies the CLI binary if that platform's artifact exists, otherwise `dist/server/spur-server`, and places `dist/web` beside it as `web/`. The server's `resolveWebDistPath` finds that sibling directory via `dirname(execPath)/web`. The CLI binary is invoked with the same `serve --host --port --no-open --cwd` flags. The standalone server binary has no flag parser; it is spawned with `cwd=<projectRoot>`, `HOST=127.0.0.1`, and `PORT=<free>`, and it does not open a browser. That server resolves history refresh as `dirname(execPath)/../cli/spur`, so stage also copies (or compiles, via `scripts/spur-dev.ts build-cli`) a CLI companion to `resources/cli/spur`.

`SPUR_DESKTOP_BIN` forces a binary. A relative path is resolved against the directory Electron was launched from before the existence check, so spawn does not look it up from `projectRoot`. Packaged builds (`bun run --filter @gobing-ai/spur-desktop pack`) ship `extraResources/spur` and `extraResources/cli` next to Electron. The shell pins a supported Electron release (currently 44.5.1). `scripts/install.sh` still rejects Windows; Windows users get the binary through this stage/pack path, not the curl installer.

On Windows and Linux the frameless window uses `titleBarOverlay` (36px). The Board reserves `env(titlebar-area-height)` across the whole layout and limits the drag region to `env(titlebar-area-width)`. macOS keeps the sidebar drag strip for the hidden title bar.

Opening the packaged app from Finder prompts for a project folder when no `--project` or
`SPUR_PROJECT_ROOT` is supplied. Cancelling exits without starting a server. Unexpected server
exits show an error and close the shell; reopen it to restart.

## Smoke

Unit tests cover port allocation, the spawn argv, health polling, and child shutdown. They do not open a window:

```bash
bun run desktop:smoke
```

Headless end-to-end against a temp project (needs a built workspace and `bun` on `PATH`):

```bash
bun run --filter @gobing-ai/spur-desktop smoke:serve
```

Electron itself needs a display. On Linux without one, `xvfb-run -a bun run desktop:dev` is the manual check; CI for this package is the headless smoke above.

The installed builder is pinned in the lockfile. A selected project with an existing live registered server is refused before database boot. Windows quit uses the private parent JSON IPC channel for graceful drain/deregistration; forced termination remains the timeout fallback.
