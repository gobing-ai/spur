---
description: Status-aware router — pick and run the next best /sp:dev-* step for a task or feature frontier
argument-hint: "[<wbs|feature-id>] [--dry-run] [--once] [--auto] [--agent <name|auto>] [--full]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Next

Wraps the **sp:next-router** skill.

Inspect corpus status (and light gates when needed), select the single best existing `/sp:dev-*`
(or documented `spur` verb) for a task WBS or feature frontier, optionally execute it, and on clean
success allow that command's own `--next` chain to continue — without inventing a second pipeline FSM.

## When to use

- Unsure which `/sp:dev-*` command to run for the current task or feature.
- Want to complete the current lifecycle step and advance when gates are clean.
- Hygiene forks (unit gap, lint red, rule findings) need a deterministic first hop.
- Operator says "what's next", "continue this task", or "advance the feature".

## Naming: command vs `--next` flag

| Symbol | Kind | Meaning |
|--------|------|---------|
| `/sp:dev-next` | **command** | Status router entry (this file) |
| `--next` | **flag** on refine/run/verify/… | Advance that command's chain link |

This command frequently *dispatches* children that include `--next`. Do not confuse the two.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `target` | Task WBS (digits), task `.md` path, or feature id (`^[A-Z][1-9]*$`). Positional. | (required for dispatch; omit → usage stop) |
| `--dry-run` | Print the resolved plan (signals, table row, exact child invocation) and **do not** dispatch | off |
| `--once` | After a successful dispatch, **suppress** any further chain the child would start *only when the router would re-enter*; for children that embed `--next` in the TABLE A dispatch string, `--once` **strips `--next` from the child invocation** so only the current step runs | off |
| `--auto` | Forward into dispatched children that support it (refine/run/verify/unit/wrap). **Does not** auto-resolve multi-candidate HITL stops | off |
| `--agent <name\|auto>` | Forwarded into the **dispatched child** when that child documents `--agent`. The **router** always runs in the **current session** (inline driver — same pattern as dogfood's driver half) | (omit → forward nothing) |
| `--full` | When the primary route would be `dev-run … --next` (implement chain), substitute `dev-run <wbs> --mode full` **without** `--next` instead. No effect on non-run routes | off |

### Smart positional detection

| Input pattern | Detection | Example |
|---------------|-----------|---------|
| Digits only | Task WBS | `0274` |
| Ends with `.md` and is a task file | Task path → resolve WBS via `spur task resolve` / path | `docs/tasks2/0274_….md` |
| `^[A-Z][1-9]*$` | Feature id → TABLE B frontier pick | `N`, `M3` |
| Empty / missing | Usage stop (message U1) | `/sp:dev-next` |

### Flag interactions

| Combo | Behavior |
|-------|----------|
| `--dry-run` + anything | Plan only; never dispatch; `--once`/`--full` still shape the *printed* child command |
| `--once` + TABLE A row with embedded `--next` | Strip `--next` (and do not rely on child chain) |
| `--full` + non-run primary | Ignore `--full` with warning W-FULL |
| `--auto` + multi-candidate HITL | Still stop; print decision-brief (0270 §4) |
| `--agent` + child without `--agent` | Forward nothing; optional advisory finding in plan line |

## Behavior

Thin wrapper: resolution algorithm, TABLES A/B/C, messages, and dispatch live in **sp:next-router**.

### Resolution order (deterministic — R2)

1. **Parse** `$ARGUMENTS` → target, flags.
2. **Resolve target** → task WBS (direct or via feature frontier algorithm B3 from routing-table).
3. **Collect signals** — corpus first: `spur task show --json` / `spur feature show --json` / dep statuses; light gates only if row.probe=yes.
4. **Table lookup** — TABLE A (task) or TABLE B (feature-level); apply TABLE C short-circuit.
5. **Cardinality** — 0 → stop U3; 1 → continue; >1 → HITL stop U-HITL (never silent pick; `--auto` does not break ties).
6. **Shape child argv** — apply `--once` / `--full` / `--auto` / `--agent` forward rules.
7. **`--dry-run`** → print plan block P1; exit success without dispatch.
8. **Dispatch** — invoke child command/skill protocol; on failure/guard → stop U-GUARD; on success → done (child may chain if `--next` left intact).

**Step budget:** one router invocation → at most one primary dispatch. No self-loop of `/sp:dev-next`.

### `--auto` (R4)

- When set, append/ensure `--auto` on dispatched refine, run, verify, unit, wrap/wrapall when those commands support it.
- TABLE A default rows already include `--auto` on refine/run/verify for chain style; if operator omits `--auto` on `/sp:dev-next`, **strip** forced `--auto` from table defaults and dispatch the interactive form where the child allows (refine Q&A, wrap confirmations). Exception: `--dry-run` prints both variants when useful.
- **Never** use `--auto` to choose among multi-candidate HITL options.

### `--agent` (R5)

| Layer | Semantics |
|-------|-----------|
| Router (`sp:next-router`) | **Inline** — always current session (like dogfood driver / refine default) |
| Child command | **Forward** `--agent <value>` only if the child documents the flag; child remains pipeline vs inline per cross-cutting.md for *that* command |

Do not invent "router agent" subprocess for table lookup.

## Operator messages (exact templates — R3)

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

## Implementation

Delegates to **sp:next-router** (decision 0271):

```
Skill(skill="sp:next-router", args="$ARGUMENTS")
```

Routing tables and algorithm: `plugins/sp/skills/next-router/references/routing-table.md` (from 0270).

## Platform Notes

- **Claude Code:** native `Skill()` + `AskUserQuestion` for U-HITL.
- **Other platforms:** run `sp:next-router` protocol from SKILL.md; corpus via `spur … --json`; HITL via platform equivalent of decision-brief.

## See Also

- **sp:next-router** — router skill (owner of algorithm + tables)
- **0270 routing table** — TABLE A/B/C SSOT
- **/sp:dev-refine**, **/sp:dev-run**, **/sp:dev-verify** — common dispatch targets; their `--next` flag is the chain link
- **/sp:dev-runall** — batch aperture (not default for feature path)
- **/sp:dev-dogfood** — meta quality driver (separate workstream)
