---
schema_version: 1
name: Harden Windows detached-serve spawn against cmd.exe %VAR% expansion
status: todo
template: standard
created_at: 2026-09-26T04:37:18.669Z
updated_at: "2026-09-26T04:40:09.304Z"

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

- [ ] R1. The Windows detached-serve launch passes every argument to the child byte-identical, including arguments containing `%`, `!`, `"`, `^`, `&` and spaces.
- [ ] R2. The daemon still outlives the CLI process (the existing detached semantics are preserved).
- [ ] R3. The quoting/launch construction is a pure, exported-for-test function with unit tests that run on any host.
- [ ] R4. No direct `Bun.spawn` / `child_process` call is introduced (the `no-direct-process-spawn` rule); launch goes through `ProcessExecutor`.

### Acceptance Criteria

- [ ] AC1 — unit test: arguments `C:\a%PATH%b`, `x!y`, `he said "hi"`, `a&b`, `p q` produce a launch spec from which the child receives them unchanged (req: R1)
- [ ] AC2 — the win32 branch no longer embeds user arguments in a `cmd /c` command string, or, if it must, a test proves `%` survives (req: R1)
- [ ] AC3 — `bun run spur-check` green (req: R4)
- [ ] AC4 — manual Windows smoke (`spur serve` detached from a project path containing `%`) recorded in Testing, or explicitly marked untested with the reason (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T04:39:45.994Z

- **Q:** Why a task rather than an inline fix? **A:** No cheap correct escape exists for `%` inside `cmd /c` quotes; the right fix changes the launch mechanism and needs a Windows check. Decided 2026-09-25 in the packages review triage.

### Design

Preferred order (pick the first that `ProcessExecutor` supports — check `@gobing-ai/ts-runtime` before choosing):

1. **Avoid `cmd` for argument passing.** Launch the target directly as a detached process through `ProcessExecutor` (argv array, no shell); if ts-runtime lacks a `detached` option, add it there (fix the facade, not a Spur workaround — AGENTS.md).
2. **Pass arguments via environment.** `cmd /c start /b "" "%SPUR_SERVE_BIN%" ...` with each argument in a dedicated env var — `cmd` expands the var *once* and does not re-expand `%` in the result, so values containing `%` survive. Caveat: quote parsing happens *after* expansion, so a value containing `"` still breaks out of the quotes — reject `"` in paths (illegal in Windows filenames anyway) and test it (AC1).
3. Last resort: PowerShell `Start-Process -ArgumentList` with single-quote escaping (`'` → `''`).

Option 1 removes the problem class; 2 is the smallest in-repo change. Either way, extract the win32 launch-spec builder into a pure function (R3) so tests run on macOS CI.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-26T04:40:09.304Z backlog → todo (system)

