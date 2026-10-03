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
bun run apps/cli/src/index.ts serve --host 127.0.0.1 --port <free> --no-open --cwd <projectRoot>
```

The default project root is this checkout. Point it at another project with `SPUR_PROJECT_ROOT` or `--project`:

```bash
SPUR_PROJECT_ROOT=/path/to/project bun run desktop:dev
```

`bun` must be on `PATH`, or set `BUN_PATH`. Quit kills the child (SIGTERM, then SIGKILL). A second launch focuses the existing window instead of opening another database.

## Prod

Root `bun run build` produces `dist/server/spur-server` and `dist/web`. Cross-compiled CLI binaries (`dist/cli/spur-<os>-<arch>`, including `spur-windows-*.exe`) come from `bun run --filter @gobing-ai/spur build:binaries`.

```bash
bun run build
bun run desktop:stage
SPUR_DESKTOP_MODE=prod SPUR_PROJECT_ROOT=/path/to/project bun run desktop:start
```

`desktop:stage` copies the CLI binary if that platform's artifact exists, otherwise `dist/server/spur-server`, and places `dist/web` beside it as `web/`. The server's `resolveWebDistPath` finds that sibling directory via `dirname(execPath)/web`. The CLI binary is invoked with the same `serve --host --port --no-open --cwd` flags. The standalone server binary has no flag parser; it is spawned with `cwd=<projectRoot>`, `HOST=127.0.0.1`, and `PORT=<free>`, and it does not open a browser.

`SPUR_DESKTOP_BIN` forces a binary. Packaged builds (`bun run --filter @gobing-ai/spur-desktop pack`) ship that staged directory as `extraResources/spur` next to Electron. `scripts/install.sh` still rejects Windows; Windows users get the binary through this stage/pack path, not the curl installer.

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
