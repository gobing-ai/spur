---
name: debugging-protocol
description: "Full systematic debugging protocol with per-phase decision gates, common failure-mode signatures, and per-language diagnostic commands."
see_also:
  - sys-debugging
---

# Debugging Protocol — Full Reference

## Per-phase decision gates

| Phase | Gate | Pass → | Fail → |
|-------|------|--------|--------|
| Feedback loop | Named command is red-capable, deterministic (or pinned flake rate), fast, agent-runnable — and repro is minimised to load-bearing elements only? | Isolate | Keep narrowing; document as INTERMITTENT if still non-deterministic |
| Isolate | Smallest repro found? | Root Cause | Continue isolating |
| Root Cause | 3–5 ranked, falsifiable hypotheses tested top-down; file:line anchor identified? | Fix | Escalate (15-min rule) |
| Fix | Minimal fix applied, `[DEBUG-xxxx]` instrumentation grepped out, tests pass? | Regression Test | Re-examine root cause |
| Regression Test | Test fails-before, passes-after? | Done | Fix was incomplete |

## Common failure-mode signatures

| Signature | Likely cause | First diagnostic |
|-----------|-------------|------------------|
| `TypeError: Cannot read properties of undefined` | Null/undefined not handled | Trace the property chain; add null guard at source |
| `TypeError: X is not a function` | Wrong import, missing method, or type mismatch | Check import path and module exports |
| `AssertionError: expected X to equal Y` | Logic error or stale expected value | Check if the assertion or the code changed last |
| `RangeError: Maximum call stack size exceeded` | Infinite recursion | Check recursive calls; add base case or depth limit |
| `SyntaxError: Unexpected token` | Malformed code or wrong file parsed as JS/TS | Check file extension, bundler config |
| `Timeout - Async callback was not invoked` | Missing async/await, unhandled promise | Check promise chain; add `.catch()` or try/catch |
| Deadlock / hang | Mutex/lock ordering, circular wait | Check lock acquisition order; add timeout to acquires |
| Flaky test (passes ~70% of time) | Race condition, time dependency, or shared state | Run with `--rerun-each 10`; check for `Date.now()` / `setTimeout` |
| `ECONNREFUSED` / `ENOTFOUND` | Service not running or wrong host/port | Check if service is up; verify host:port config |
| `ENOENT: no such file or directory` | Missing file, wrong path, or race with file creation | Check `existsSync` before read; verify relative vs absolute path |

## Per-language diagnostic commands

### Bun / TypeScript

```bash
bun --inspect <file>          # Debugger
bun test --rerun-each 5       # Flaky test diagnosis
bun run typecheck             # Catch type errors without running
rg "pattern" -n -C 3          # Search codebase for similar patterns
```

### Go

```bash
go test -v -run <TestName>    # Run specific test
dlv test ./...                # Debugger
go vet ./...                  # Static analysis
go test -count=10 -run <Test> # Flaky test diagnosis
```

### Python

```bash
pytest --pdb                  # Drop into debugger on failure
pytest -x --lf                # Run last failed test first
python -m traceback <script>  # Full traceback analysis
pytest --count=10 -x          # Flaky test diagnosis (pytest-repeat)
```
