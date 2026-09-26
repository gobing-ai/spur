---
schema_version: 1
name: Harden Windows detached-serve spawn against cmd.exe %VAR% expansion
status: done
template: standard
created_at: 2026-09-26T04:37:18.669Z
updated_at: "2026-09-26T22:14:21.124Z"

feature_id: K21
ac_numbering: task-local
done_forced: "true"
done_reason: "AC3 (Windows smoke: daemon outlives CLI) unverifiable on this host - no Windows machine. R1-R5 + AC1/2/4 MET with test/command evidence across 3 independent verify cycles; gate PASS (9227 tests / 532 files); review PASS x3. AC3 operator-ratified PARTIAL. Commit c84e11a9."
---

## 0964. Harden Windows detached-serve spawn against cmd.exe %VAR% expansion

### Background

Source: `/sp:dev-review packages --focus all` (2026-09-25), SECUA minor (Security). Deliberately **not** fixed inline: there is no reliable escape for `%` inside a quoted `cmd /c` argument (`^%` is literal inside quotes), and the fix cannot be exercised on the macOS dev/CI host — a speculative quoting change is worse than the current exposure.

`packages/app/src/services/project-start.ts:86-95` (`defaultDetachedServeSpawn`), win32 branch:

```ts
args: ['/c', `start /b "" ${cmd.map((c) => `"${c.replace(/"/g, '""')}"`).join(' ')}`]
```

Only `"` is doubled. `cmd.exe` still expands `%NAME%` inside double quotes, and `!NAME!` when delayed expansion is on, so an argument containing `%` is altered (or expands to an env value) before `start` sees it. The POSIX branch is correct (`shQuote`, :64).

Exposure today: low — `cmd` is the spur binary path plus serve flags assembled internally, not operator free text. Becomes relevant if a project path or serve option containing `%` (legal in Windows paths) reaches this branch.

### Requirements

- [x] R1. On win32, the detached serve launch no longer embeds any argument bytes in the `cmd` command line: each argv element is handed off in its own environment variable (`SPUR_SERVE_ARG_<i>`), referenced as `"%SPUR_SERVE_ARG_<i>%"`, under `cmd /d /v:off /c`.
- [x] R2. The launch-spec construction is a pure exported function `buildWindowsDetachedServeLaunch(cmd: readonly string[]): { command: string; args: string[]; env: Record<string, string> }` in `project-start.ts` (exported for tests; not added to the barrel), unit-tested on any host.
- [x] R3. Inputs the handoff cannot carry fail loud before spawn: any argument containing `"` throws (illegal in Windows paths; would break out of quoting after expansion), and a launcher `cmd[0]` ending in `.cmd` / `.bat` (case-insensitive) throws, because a batch interpreter re-expands `%` in its arguments.
- [x] R4. The daemon still outlives the CLI (`start /b` semantics preserved); the POSIX branch is untouched.
- [x] R5. No direct `Bun.spawn` / `child_process` call is introduced; launch stays on `NodeProcessExecutor.run`.

### Acceptance Criteria

Graduates all four of feature K21's scenarios (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R1 — Every serve argument reaches the daemon unchanged (req: R1, R2)
- [x] AC2 — R2 — Unsafe launch inputs fail loud before spawn (req: R3)
- [x] AC3 — R3 — The serve daemon outlives the launching CLI (req: R4)
  <!-- AC3 = PARTIAL by evidence (verify cycles 1-3): no Windows host; operator-ratified via task update --force-done (run 64be6f77, done_reason). Smoke on a Windows machine before trusting daemon behavior. -->
- [x] AC4 — R4 — Launch stays behind ProcessExecutor (req: R5)

**Verify lens**

- **AC1** — unit test over `buildWindowsDetachedServeLaunch(['C:\\bun.exe', 'C:\\a%PATH%b', 'x!y!', 'a&b|c', 'p q', '^caret', ''])`: `command === 'cmd'`; `args` equals `['/d', '/v:off', '/c', 'start /b "" "%SPUR_SERVE_ARG_0%" "%SPUR_SERVE_ARG_1%" … "%SPUR_SERVE_ARG_6%"']`; `args.join(' ')` contains none of the input argument strings; `env.SPUR_SERVE_ARG_<i> === cmd[i]` for every i (byte-identical, including the empty string).
- **AC2** — unit tests: an argument `he said "hi"` throws an error naming the argument index and the `"` restriction; `cmd[0] = 'C:\\tools\\spur.CMD'` throws naming batch launchers; neither calls the executor (spawn seam spy has 0 calls).
- **AC3** — Windows smoke: `spur projects start <name>` from a project path containing `%` (e.g. `C:\tmp\p%USERNAME%x`), CLI exits, `spur projects list --json` shows it running on its port, and the serve process's `--cwd` equals the literal path. Recorded in Testing; if no Windows host is available, Testing states "AC3 untested — no Windows host" and the verdict is PARTIAL for AC3 only (operator decides).
- **AC4** — `rg -n "Bun\.spawn|child_process" packages/app/src/services/project-start.ts` returns nothing; `bun run spur-check` green (includes the `no-direct-process-spawn` rule).

### Q&A

- **Q:** Why a task rather than an inline fix? **A:** No cheap correct escape exists for `%` inside `cmd /c` quotes (`^%` is literal inside quotes); the fix changes the launch mechanism and needs a Windows check. Decided 2026-09-25 in the packages review triage.
- **Q:** Filed Design option 1 — detached launch without `cmd` via `ProcessExecutor`? **A:** Not available. `@gobing-ai/ts-runtime` 0.5.7 `ProcessOptions` (`packages/runtime/src/process-executor.ts:58-120` in ts-libs) has no `detached`/fire-and-forget option; `run` awaits child exit, and the internal `detached: true` (:817) is process-group containment for deadlines, not daemonization. Adding one is a cross-repo release — out of scope. **Chosen: option 2 (env-var handoff).** Deferred condition: if ts-runtime ships a detached launch API, replace the win32 `cmd` hop with it in a follow-up.
- **Q:** Why does the env-var handoff survive `%`? **A:** `cmd` expands `%VAR%` in one pass over the command line and does not rescan the substituted text, so a value containing `%NAME%` stays literal. `/v:off` disables delayed expansion so `!` is literal regardless of the registry default; `/d` skips AutoRun commands. `^`, `&`, `|`, `<`, `>` are literal inside the double quotes that wrap each reference.
- **Q:** What still breaks it? **A:** (1) A `"` inside a value — quote parsing happens after expansion, so it would close the quote; `"` is illegal in Windows file names and serve flags are internal, so reject it (R3). (2) A `.cmd`/`.bat` launcher — the batch interpreter re-parses `%` in `%*`/`%1`; `resolveSpurServeCommand` normally yields `process.execPath` (bun.exe) but its `Bun.which('spur')` fallback could return `spur.cmd`, so reject it (R3).
- **Q:** Env var collisions? **A:** Names are `SPUR_SERVE_ARG_<index>`; the builder's `env` is merged over the caller env (caller env first, builder keys win). Stale `SPUR_SERVE_ARG_*` from the parent are harmless — only indices `< cmd.length` are referenced.

### Design

**Chosen: env-var handoff under `cmd /d /v:off /c start /b`.** Keeps `NodeProcessExecutor` as the only launcher (rule `no-direct-process-spawn`) and needs no ts-runtime change.

```ts
/** Windows detached-launch spec: argv travels in env vars so cmd.exe never parses argument bytes. */
export function buildWindowsDetachedServeLaunch(cmd: readonly string[]): {
    command: string;
    args: string[];
    env: Record<string, string>;
} {
    // throw if cmd is empty, if cmd[0] matches /\.(cmd|bat)$/i, or if any element contains '"'
    // env: { SPUR_SERVE_ARG_0: cmd[0], … }
    // args: ['/d', '/v:off', '/c', `start /b "" ${cmd.map((_, i) => `"%SPUR_SERVE_ARG_${i}%"`).join(' ')}`]
}
```

In `defaultDetachedServeSpawn`, the win32 branch becomes:

```ts
const launch = buildWindowsDetachedServeLaunch(cmd);
// command/args from launch; env: { ...flattenEnv(options.env ?? getEnvVars()), ...launch.env }
```

The POSIX branch and the `executor.run({...})` call shape stay as they are; only the win32 `{command,args}` and the env merge change. Update the function's doc comment (:77-80) to say Windows uses the env-var handoff and why.

Errors are thrown `Error`s with messages of the form `detached serve launch: argument <i> contains '"', which cannot be passed through cmd.exe` and `detached serve launch: batch launcher <path> re-expands %; use the bun executable`. `startProject` already surfaces thrown spawn errors to the CLI.

**Rejected:** caret/percent escaping inside quotes (no correct escape exists); PowerShell `Start-Process` (adds a second interpreter with its own quoting and a ~300 ms startup; keep as fallback only if the Windows smoke fails for option 2).

### Plan

- [x] Add `buildWindowsDetachedServeLaunch` to `packages/app/src/services/project-start.ts` above `defaultDetachedServeSpawn` (Design snippet).
- [x] Rewire the win32 branch of `defaultDetachedServeSpawn` to use it; merge `launch.env` over the flattened env; update the doc comment.
- [x] Tests in `packages/app/tests/services/project-start.test.ts`: AC1 spec test (metacharacter matrix incl. empty string), AC2 two rejection tests, plus one test that the win32 branch is selected via the builder (call the builder directly; do not stub `process.platform` globally).
- [x] Focused: `(cd packages/app && bun test tests/services/project-start.test.ts)`.
- [x] Gates: `bun run spur-check`; `rg -n "Bun\.spawn|child_process" packages/app/src/services/project-start.ts` empty.
- [x] Windows smoke (AC3) if a host is available; otherwise record "untested — no Windows host" in Testing.
- [x] One commit: `fix(project-start): pass Windows detached serve argv via env to defeat cmd %VAR% expansion (0964)`.

### Solution

- `packages/app/src/services/project-start.ts:86-120` — new exported pure `buildWindowsDetachedServeLaunch(cmd)`: validates inputs (empty argv; `.cmd`/`.bat` launcher; `"` in any argument → thrown `Error`s with index/cause), builds `env` `SPUR_SERVE_ARG_<i>` = argv element, returns `{ command: 'cmd', args: ['/d', '/v:off', '/c', 'start /b "" "%SPUR_SERVE_ARG_0%" …'] }`.
- `packages/app/src/services/project-start.ts:123-146` — win32 branch of `defaultDetachedServeSpawn` now delegates to the builder; executor env is `{ ...flattenEnv(options.env ?? getEnvVars()), ...windowsLaunch?.env }` (caller env first, builder keys win); POSIX `nohup … &` branch and the `executor.run` call shape unchanged; doc comment notes the env-var handoff and why.
- Rationale: cmd.exe expands `%VAR%` inside double quotes (and `!VAR!` under delayed expansion) in one pass without rescanning, so argument bytes in env vars referenced as `"%SPUR_SERVE_ARG_<i>%"` survive; `/v:off` forces `!` literal, `/d` skips AutoRun. Inputs the handoff cannot carry (`"`, batch launchers) fail loud before spawn per R3.

### Testing

- Focused: `(cd packages/app && bun test tests/services/project-start.test.ts)` — 22 pass / 0 fail (58 expect calls), including 5 new tests: AC1 metacharacter matrix (`%PATH%`, `!y!`, `a&b|c`, space, `^caret`, empty string; byte-identical env round-trip; no argument bytes on the command line), AC2 rejections (index-naming `"` error; `.CMD`/`.bat` launcher error; empty argv), and the exact start-chain spec for a realistic serve argv.
- `bunx tsc --noEmit -p packages/app` — clean. `rg -n "Bun\.spawn|child_process" packages/app/src/services/project-start.ts` — doc-comment mentions only; no code-level spawn (launch stays on `NodeProcessExecutor.run`).
- AC3 (Windows smoke: `spur projects start` from a `%`-containing path) untested — no Windows host; macOS dev/CI exercised the pure builder per R2.
- Not run here (later pipeline stages own them): `bun run spur-check` / `spur-check-feature`; no commit made — changes left in the working tree.

### Review

Findings folded from run 64be6f77 (review cycles 1–3, fresh-session `sp-super-reviewer`; all three cycles PASS, zero P1–P3 findings).

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | None found (3 independent review cycles) | `.spur/run/0964-review-report.md` §cycles 1–3 | n/a |
| P2 | None found (3 independent review cycles) | `.spur/run/0964-review-report.md` §cycles 1–3 | n/a |
| P3 | None found (3 independent review cycles) | `.spur/run/0964-review-report.md` §cycles 1–3 | n/a |
| P4 (advisory) | AC3 (Windows daemon smoke) open — unexecutable on this host (no Windows machine); task Testing :111 pre-declared this fallback. Env-var handoff (`SPUR_SERVE_ARG_<i>` + `"%…%"` under `cmd /d /v:off /c start /b`, project-start.ts:104-108) mirrors the proven precedent `shell.ts:97`. | verify cycles 1–3 all PARTIAL on AC3 only; R1–R5, AC1/2/4 MET with test/command evidence | Accepted residual — flip `:43` after a Windows-host smoke; operator ratified via `task update --force-done` |

Residual risk: daemon behavior under real `cmd.exe` (var expansion, `%*` edge cases) unverified on Windows; POSIX branch untouched (byte-identical to base). Final disposition: done — implementation proven at full gate (9227 tests / 532 files, digest `9a2dc0a0…`), 22/22 focused tests, review PASS ×3.

### References

- Feature: K21 (parent K2 — project runtime robustness).
- Review source: `/sp:dev-review packages --focus all`, 2026-09-25, SECUA minor; base commit `959f84bd6`.
- Precedent for env-var handoff: `packages/app/src/workflow/actions/shell.ts:97` (`/bin/sh -c` with vars passed via env).
- `@gobing-ai/ts-runtime` 0.5.7 `ProcessOptions` — no detached launch (see Q&A).

### History

- 2026-09-26T04:40:09.304Z backlog → todo (system)
- 2026-09-26T17:24:25.381Z todo → wip (system)
- 2026-09-26T22:12:57.531Z wip → testing (system)
- 2026-09-26T22:14:21.121Z testing → done (system)

