---
name: messages
description: "Exact dev-next: operator-message literals for sp:next-router — U1, U2, U3, U4, U-HITL, U-GUARD, P1, P2, P3, W-FULL templates, verbatim (R3)."
see_also:
  - next-router
---

# Operator Messages — Exact Templates (R3)

Use these literals (substitute angle-bracket tokens). Prefix every stop with `dev-next:`.

### U1 — no target
```
dev-next: no target
  usage: /sp:dev-next <wbs|feature-id> [--dry-run] [--once] [--auto] [--agent <name|auto>] [--full]
  hint: pass a task WBS (e.g. 0274) or feature id (e.g. N)
```

### U2 — unknown / unresolvable target
```
dev-next: cannot resolve target <raw>
  spur task show / spur feature show failed
  fix: check WBS/feature id, then re-run
```

### U3 — no route (table miss / cancelled)
```
dev-next: no route for <wbs|feature> (status=<status>)
  reason: <one-line from table stop notes>
```

### U4 — deps not satisfied (A2)
```
dev-next: blocked by open dependencies for <wbs>
  unmet: <dep1>(status), <dep2>(status), …
  fix: finish deps or re-order work; re-run /sp:dev-next <wbs>
```

### U-HITL — multi-candidate
```
dev-next: multiple candidates — choose one
  task/feature: <id>  status=<status>
  recommended: <cmd-1>
  alternatives:
    - <cmd-2>
    - <cmd-3>
  stakes: <one line>
  (re-run with an explicit /sp:dev-* if you prefer not to use the router)
```
Then invoke decision-brief / AskUserQuestion; do not dispatch until answered.

### U-GUARD — child guard / review-pending
```
dev-next: dispatch stopped (review-pending)
  child: <exact invocation>
  reason: <guard or verify verdict summary>
  task left at status=<status>
  fix: resolve the finding, then /sp:dev-next <wbs>
```

### P1 — dry-run plan
```
dev-next: plan (dry-run)
  target: <wbs> (from <raw>)  status=<status>  feature=<id|—>
  row: <A#|B#|C#>  probe=<yes|no>
  signals: <bullet or compact json keys>
  dispatch: <exact child argv>
  chain: <embedded --next|none>  once=<bool>  full=<bool>  auto=<bool>
  (no commands executed)
```

### P2 — dispatch start
```
dev-next: dispatch
  row: <A#|B#|C#>
  → <exact child argv>
```

### P3 — success (no further router work)
```
dev-next: ok
  child finished: <exact child argv>
  task status now: <status>
  next: re-run /sp:dev-next <wbs> if more steps remain (or rely on child --next chain if present)
```

### W-FULL — --full ignored
```
dev-next: warning — --full ignored (primary route is not dev-run --next); continuing with <dispatch>
```
