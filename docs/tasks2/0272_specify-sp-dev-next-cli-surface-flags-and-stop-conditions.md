---
template: brainstorm
schema_version: 1
name: "Specify /sp:dev-next CLI surface, flags, and stop conditions"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dev-next"]
dependencies: ["0270", "0271"]
created_at: "2026-07-17T00:54:27.284Z"
updated_at: "2026-07-17T01:09:01.684Z"
---

## 0272. Specify /sp:dev-next CLI surface, flags, and stop conditions

### Background
**Type:** `wayfinder:grilling` · **Feature:** N

**Question:** What is the operator-facing contract for `/sp:dev-next` — argument-hint, flags, defaults, stop messaging, and README one-liner — ready to paste into `plugins/sp/commands/dev-next.md`?

**Locked defaults (discovery):**
- Positional: task WBS preferred; feature ID optional rollup
- Default: execute recommended dispatch; chain on clean success; stop on gates/ambiguity
- Must support: `--dry-run`, `--once`
- Must not confuse operators with the existing `--next` **flag** on refine/run/verify (different noun: this is a **command** named `dev-next`)

**Naming collision:** Document both clearly so agents do not confuse "run next chain link" with "status router entry".

**Depends on:** 0270 (routing table), 0271 (ownership / Implementation Skill line).
### Requirements
- [x] R1. Full argument-hint string and Arguments table (every flag, default, semantics).
- [x] R2. Deterministic resolution order: parse args to dispatch/stop.
- [x] R3. Exact operator-facing messages for no target, multi-candidate, guard stop, dry-run plan, success.
- [x] R4. Interaction with --auto documented (forward; never breaks HITL ties).
- [x] R5. Interaction with --agent documented (router inline; forward to children).
- [x] R6. README command-index one-liner draft.
- [x] R7. Out-of-scope for v1 flags listed explicitly.
- [x] R8. Solution is paste-ready command skeleton sections.
### Acceptance Criteria
```gherkin
@core
Scenario: Command doc skeleton is complete
  Given 0272 Solution
  When copied into plugins/sp/commands/dev-next.md with skill wiring filled
  Then argument-hint, flags, stop messages, and Implementation Skill() line are all present
  And naming collision with --next flag is documented
```
### Q&A
**Q (required target).** Yes for dispatch. Empty target prints U1 usage stop (not git/wip inference).

**Q (--once vs child --next).** --once strips --next from the shaped child argv so only the current step runs.

**Q (--auto on multi-candidate).** Does not pick a winner; U-HITL still fires (0270).

**Q (v1 --full).** Only rewrites dev-run --next into --mode full; ignored with W-FULL otherwise.
### Design
**Selected:** Full paste-ready dev-next.md skeleton with flags --dry-run, --once, --auto, --agent, --full; exact stop/plan messages; naming collision block; Skill(sp:next-router).

**--once semantics:** strip embedded --next from table dispatch (single step), not a second FSM.

**--full:** narrow override for run-chain rows only (addresses 0270 fog).

**Rejected:** omit-target inference; router self-loop --max-steps; --json in v1.
### Plan
1. Wait until 0270 + 0271 Solutions exist (or work from drafts if both claimed sequentially).
2. Author command markdown skeleton in Solution.
3. Align flag names with existing /sp:dev-* conventions (--auto, --agent, --dry-run).
4. Note any need for a future `spur task next-hint --json` helper as fog/follow-up, not v1 requirement unless ownership demands it.
### Solution
**Answer:** Paste-ready operator contract for `/sp:dev-next`. Backing skill: `sp:next-router` (0271). Routing tables: 0270 / `references/routing-table.md`.

---

## README one-liner (R6)

| Command | What it does |
| --- | --- |
| `dev-next` | Status-aware router — inspect a task (or next frontier under a feature), dispatch the best existing `/sp:dev-*` command, chain on clean success |

Suggested "When to use" blurb for README on-ramps: *Unsure which `/sp:dev-*` to run for a WBS or feature — start with `dev-next`.*

---

## Naming collision (required doc block)

**`/sp:dev-next` (this command)** = status→command **router entry**.  
**`--next` (flag on refine / run / verify / review)** = "advance this command's linear chain link."

They compose: the router often *dispatches* children that themselves carry `--next` (e.g. `/sp:dev-run 0042 --auto --next`). Operators and agents MUST NOT treat `/sp:dev-next` as a synonym for passing `--next` to another command.

---

## Paste-ready command skeleton

Copy into `plugins/sp/commands/dev-next.md` (skill fills Implementation wiring from 0271).

```markdown
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
5. **Cardinality** — 0 → stop U-NONE; 1 → continue; >1 → HITL stop U-HITL (never silent pick; `--auto` does not break ties).
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
```

---

## Out-of-scope v1 flags (R7)

| Flag / idea | Why deferred |
| --- | --- |
| Omit-target "infer from wip/git" | Locked out of v1 signals (discovery) |
| `--json` machine plan output | Nice for CI; not required for first ship (fog) |
| `--tasks` / runall integration | Batch is deliberate aperture (0270 non-route) |
| `--max-steps N` router self-loop | Unbounded cost risk; operator re-invokes |
| `--merge` passthrough to wrap | Irreversible HITL must stay explicit on wrap |
| `spur task next-hint` CLI verb | Pure skill + existing `--json` show/list is enough for v1 (0271/0270 fog) |
| `--yes` synonym | Prefer `--auto` for consistency with other dev-* |

**In scope for v1:** `--dry-run`, `--once`, `--auto`, `--agent`, `--full` (narrow: run chain → full pipeline only).

---

## --once vs child-embedded `--next` (clarification)

0270 TABLE A rows encode `--next` on refine/run/verify. Operator-facing `--once` on `/sp:dev-next` means "only the current step":

1. Build child argv from table.
2. If `--once`: remove `--next` from child argv (and any router-level re-entry).
3. Dispatch single step; print P3 with hint to re-run `/sp:dev-next`.

Without `--once`, leave table `--next` intact so refine→run→verify chain runs as today.

---

## R-checklist

| R | Where |
| --- | --- |
| R1 argument-hint + table | skeleton Arguments |
| R2 resolution order | Behavior § |
| R3 messages | U1–U-GUARD, P1–P3, W-FULL |
| R4 `--auto` | Arguments + Behavior |
| R5 `--agent` | Arguments + Behavior table |
| R6 README line | top of Solution |
| R7 out-of-scope flags | section above |
| R8 paste-ready skeleton | full markdown block |

## Source anchors (file:line)

- Pass-through commands: `plugins/sp/README.md:311-312`
- Ownership: 0271 Solution (`sp:next-router`)
- Routing algorithm: 0270 Solution
- Peer `--auto`/`--next`: `plugins/sp/commands/dev-refine.md:3-31`
- Peer inline driver `--agent`: `plugins/sp/commands/dev-dogfood.md:34-48`
### Testing
**Validation.**
- Aligned flags with 0270 algorithm and 0271 ownership
- Matched peer patterns: dev-refine.md argument-hint, dev-dogfood.md driver-scoped --agent
- Message set covers R3 cases U1, U-HITL, U-GUARD, P1, P3

**Runtime.** N/A (spec ticket; command file not written this session — implementation follows).
### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Dependencies: 0270, 0271
- Downstream: implementation task(s) graduated after this resolves
### History
- 2026-07-17T01:08:01.403Z todo → wip (system)
- 2026-07-17T01:08:58.851Z wip → testing (system)
- 2026-07-17T01:09:01.684Z testing → done (system)
