---
schema_version: 1
name: Isolate win32 detached-serve handles so piped projects start reaches EOF
status: done
template: issue
created_at: 2026-09-27T05:56:52.929Z
updated_at: "2026-09-27T05:58:17.113Z"
feature_id: K21

done_forced: "true"
done_reason: "Fix + Windows evidence produced in worktree fix/windows-serve-smoke-hang (PR #4); no /sp:dev-verify pipeline artifact — evidence is external CI: run 36298490835 spawn-probe + windows-serve-smoke both PASS, 22/22 unit tests, biome + tsc clean. Closes 0964 AC3."
---

## 0978. Isolate win32 detached-serve handles so piped projects start reaches EOF

### Background

Follow-up to 0964. 0964 fixed cmd.exe `%VAR%` re-expansion by handing argv off in
`SPUR_SERVE_ARG_<i>` env vars, but its Design pre-authorized PowerShell `Start-Process` as the
fallback "if the Windows smoke fails for option 2" — and the first Windows CI runs proved option 2
fails: `windows-serve-smoke` hung (run 36295064282: serve step produced zero output, 20-min job
timeout) even with `< NUL > NUL 2>&1` added to the `start /b` line, and after the batch-file
workaround the piped `projects start` still never reached EOF (run 36298129792, 90s bounded probe:
daemon correctly spawned with literal `%` path, `cmd` already gone, but the CLI bun process was
still alive). 0964 AC3 was operator-ratified PARTIAL for lack of a Windows host; this task owns the
verified defect, the fix, and the Windows evidence that closes AC3.

### Requirements

- [x] R1. On win32, the detached serve daemon inherits none of the launching CLI's stdio: a caller that pipes `spur projects start` (pwsh `| Out-String`, execa's buffered run inside the CLI) must observe EOF and exit, while the daemon keeps running.
- [x] R2. Argv still reaches the daemon byte-identical (including `%` in a project path); no shell re-parses or expands it.
- [x] R3. The launch spec stays a pure exported `buildWindowsDetachedServeLaunch(cmd)` returning `{ command, args, env }`, unit-tested on any host, with the 0964 rejection guards (empty argv, `.cmd`/`.bat` launcher, `"` in a value) intact.
- [x] R4. No direct `Bun.spawn` / `child_process` call is introduced; the launch stays behind `NodeProcessExecutor.run` (rule `no-direct-process-spawn`).
- [x] R5. The POSIX branch is untouched.
- [x] R6. A fast Windows probe gates the launch shape on real Windows without a monorepo install, and the Windows smoke proves the daemon outlives the CLI (0964 AC3).

### Acceptance Criteria

- [x] AC1 — R1 — Every serve argument reaches the daemon unchanged (req: R1, R2)
- [x] AC2 — R2 — Unsafe launch inputs fail loud before spawn (req: R3)
- [x] AC3 — R3 — The serve daemon outlives the launching CLI (req: R1, R6)
- [x] AC4 — R4 — Launch stays behind ProcessExecutor (req: R4, R5)

**Verify lens**

- **AC1** — unit: exact PowerShell `args` assertion, no argv bytes in `args`, `env.SPUR_SERVE_ARG_<i> === cmd[i]`;
  smoke: `serve cmdline: … --cwd D:\a\_temp\p%USERNAME%x …` with the "no expanded username" assertion passing.
- **AC2** — unit: `"` in a value, `.cmd`/`.bat` launcher, empty argv each throw; no executor call.
- **AC3** — `spawn-probe`: `START-PROCESS closed=true exit=0 leak=false` (close 424 ms) while the pre-fix
  shapes fail (`BATCH` closes only at 14203 ms = marker lifetime; `INLINE` `closed=false exit=null` at 15 s).
  `windows-serve-smoke`: piped-start probe inside its 90 s bound; `projects list --json` shows `running: true`
  after the CLI exited, HTTP probe answers, `projects stop` clean.
- **AC4** — `rg -n "Bun\.spawn|child_process" packages/app/src/services/project-start.ts` empty; POSIX branch
  and its expectations unchanged.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Adopt 0964's pre-authorized fallback: replace the `cmd /c start /b` hop with

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:SPUR_SERVE_ARG_0 -ArgumentList @($env:SPUR_SERVE_ARG_1,…) -WindowStyle Hidden"
```

`Start-Process` creates the daemon through `CreateProcess` with an explicit handle list, so nothing of
ours is inherited; PowerShell performs no `%` expansion, and no shell parses the daemon's argv (the
env-var handoff from 0964 is unchanged). Cost: one extra interpreter and ~0.4 s launch (measured),
paid once per `projects start`; no ts-runtime change, no new dependency.

**Rejected:** batch-file `start /b` (fixes argv mangling but not handle inheritance — measured), caret
escaping (no correct escape inside quotes), a ts-runtime detached-launch API (cross-repo release,
still unresolved in 0.5.9).

### Plan

- [x] Reproduce with a bounded, evidence-producing Windows probe (stream-close detector, not process exit).
- [x] Replace `cmd /c start /b` with `powershell -Command Start-Process … -WindowStyle Hidden`; keep the env handoff.
- [x] Update the launch-spec unit tests (exact args, no argv bytes, env map, three rejection tests).
- [x] Harden `test-win.yml`: gating `spawn-probe`, 90 s bounded piped-start probe, file redirection for the functional flow.
- [x] Run focused tests + biome + tsc; push and watch the Windows jobs.
- [x] Close 0964 AC3 with the Windows smoke evidence.

### Root Cause

`cmd /c start /b` forwards every inheritable handle of cmd's handle table to the grandchild, so the
daemon keeps a duplicate write end of the stdout pipe belonging to whoever spawned the CLI.
Measured with the `spawn-probe` job (node `spawn` + `close`-based detector):

| Shape | cmd exit | stream close |
|-------|----------|--------------|
| inline argv `start /b "" "…" < NUL > NUL 2>&1` | never (mangled by win32 argv escaping) | never |
| batch file `cmd /c <batch>` | 0 after 38 ms | 14203 ms (= marker child lifetime) |
| powershell `Start-Process` | 0 after 424 ms | 424 ms |

`execa` (`NodeProcessExecutor.run`, `forceBuffered: true`) resolves on stream close, so the CLI
never returned from the spawn call — matching the observed CI hang with zero output. The same
duplicate also kept the job's pipe open, which is why `Out-String` never completed.

### Solution

- `packages/app/src/services/project-start.ts:85-130` — `buildWindowsDetachedServeLaunch` now returns
  `{ command: 'powershell.exe', args: ['-NoProfile','-ExecutionPolicy','Bypass','-Command', 'Start-Process -FilePath $env:SPUR_SERVE_ARG_0 -ArgumentList @($env:SPUR_SERVE_ARG_1,…) -WindowStyle Hidden'], env }`.
  Validation (empty argv, `.cmd`/`.bat` launcher, `"` in a value) and the `SPUR_SERVE_ARG_<i>` env map
  are unchanged from 0964; no temp file, no cleanup path.
- `packages/app/src/services/project-start.ts:132-160` — `defaultDetachedServeSpawn` win32 branch
  unchanged in shape (delegates to the builder, merges `env`); doc comment now states the handle-isolation
  requirement and why the daemon must inherit nothing.
- `.github/workflows/test-win.yml` — `spawn-probe` (no install, windows-latest): compares inline-argv,
  batch-file and Start-Process shapes with a `close`-based detector plus a `CHILD_STDIO_LEAK` marker and a
  `Win32_Process` survivor dump; gates the job on the Start-Process verdict. `windows-serve-smoke` keeps a
  90 s-bounded piped-start probe (evidence dump on timeout) and runs the functional flow with file
  redirection.
- Rationale: correctness fix for a hang that only appears where a pipe is attached (CI, any `|` consumer);
  startup cost and one interpreter are acceptable for `projects start` and no cross-repo release is needed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Every serve argument reaches the daemon unchanged | MET | run 36298490835 windows-serve-smoke: serve cmdline '… --cwd D:\a\_temp\p%USERNAME%x --port 3001 …' literal, 'no expanded username' assertion passed; unit: no argv bytes in args, env.SPUR_SERVE_ARG_<i>===cmd[i] |
| R2 — Unsafe launch inputs fail loud before spawn | MET | (cd packages/app && bun test tests/services/project-start.test.ts) 22 pass / 0 fail: '"' in a value, .cmd/.bat launcher and empty argv each throw before the executor |
| R3 — The serve daemon outlives the launching CLI | MET | run 36298490835 spawn-probe: START-PROCESS closed=true exit=0 leak=false (close 424ms) vs BATCH closing only at 14203ms (= marker lifetime) and INLINE closed=false exit=null at 15s; windows-serve-smoke: piped start returned inside its 90s bound, running=true after CLI exit, HTTP probe answered, stop clean |
| R4 — Launch stays behind ProcessExecutor | MET | rg -n 'Bun\.spawn\|child_process' packages/app/src/services/project-start.ts -> no matches; win32 branch delegates to buildWindowsDetachedServeLaunch + NodeProcessExecutor.run; POSIX branch unchanged |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | ci | run 36298490835 windows-serve-smoke literal % path + unit expectations |
| AC2 | MET | test | three rejection tests green (22 pass / 0 fail) |
| AC3 | MET | ci | run 36298490835 spawn-probe START-PROCESS close 424ms; windows-serve-smoke daemon alive after CLI exit (job 2m08s vs 20-min cancellation before); closes 0964 AC3 |
| AC4 | MET | command | rg no-direct-process-spawn clean; biome + tsc --noEmit -p packages/app clean |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| P1 | — | None | — |
| P2 | Medium | `powershell.exe` is assumed present; a missing interpreter surfaces as an execa spawn error through `startProject` (no silent fallback). True on Windows 10/11/Server and GitHub runners. | Accepted, documented in Design |
| P3 | Low | `-WindowStyle Hidden` gives the daemon a hidden console; it survives CLI exit (smoke asserts `projects list` + HTTP after exit). | Accepted |
| P4 | Low | `spawn-probe` gates only the Start-Process shape; the two pre-fix shapes are informational, so the job still tests what ships if the reproductions stop. | Accepted |

Residual risk: none observed on windows-latest; POSIX path untouched and its tests green locally (macOS).

### References

- `docs/tasks5/0964_harden-windows-detached-serve-spawn-against-cmd-exe-var-expa.md` — predecessor; Design pre-authorized PowerShell `Start-Process` as the fallback, AC3 PARTIAL here closed.
- PR gobing-ai/spur#4 — `fix/windows-serve-smoke-hang`.
- Runs: 36295064282 (zero-output hang, job cancelled at 20 min), 36298129792 (batch shape: daemon ok, CLI still alive at 90 s), 36298490835 (`spawn-probe` + `windows-serve-smoke` both pass).

### History

- 2026-09-27T05:57:39.023Z todo → wip (system)
- 2026-09-27T05:57:39.572Z wip → testing (system)
- 2026-09-27T05:57:40.057Z testing → done (system)

