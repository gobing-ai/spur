# Agent doctor as the routing inspection surface

**Area:** `spur agent doctor` output contract, doctor probe cost, `doctor.probe` workflow action.
**Status:** Accepted design; implementation pending (feature B4).
**Decision:** No new ADR — this refines the ADR-033 / ADR-061 / ADR-078 routing model's *inspection*
surface without changing its resolution semantics. ADR-051 consent for the two new flags is recorded
in the B4 planning session (2026-08-26).
**Feature:** B4.

## 1. The problem, measured

`spur agent doctor` is the documented preflight for executor routing. Against HEAD `212972e74` with
the 15-executor global config it fails that job three ways.

**(a) It renders a dead axis.** `renderDoctorTable` prints `DoctorResult.tier` — the *agent support
tier* (1 = direct CLI, 2 = gateway/TUI-constrained). With a config of CLI-native agents every one of
the 15 rows reads `1`. The axis that decides every routing call since 0343 is the *capability tier*
(`cheap | standard | capable-1 | capable-2 | capable-3`), which is computed in `renderDoctor` and
emitted **only** under `--json` as `capabilityTier` (`agent-service.ts:504-515`). The
`missing (tier-1)` footer keys off the same dead axis.

**(b) It shows one rung of the ladder.** `doctor <role>` routes through `resolveRole`
(`agent-service.ts:1783-1823`), which walks `cheapestEligibleExecutors` and **breaks on the first
usable**. That is correct for dispatch — dispatch must pick exactly one — but it is the wrong
projection for an inspection surface: `agent doctor coder` reports `omp-dsv4-flash-volc` and says
nothing about the eleven other standard-or-better executors behind it.

**(c) It is slow, and not for the reason it looks like.**

| Command | Wall clock |
| --- | --- |
| `spur --version` (boot floor) | 0.28 s |
| `spur agent list` (detection only) | 1.62 s |
| `spur agent doctor` | 6.20 s |

The 4.6 s delta is **not** provider traffic. `DoctorRunner.probeModel` short-circuits to
`{status:'unknown', detail:"API key not found for provider '<p>'"}` before issuing any HTTP when
`{PROVIDER}_API_KEY` is absent — which is simultaneously why all 15 MODEL cells read `unknown`. The
cost is `isAuthenticated`, called once per executor inside `DoctorRunner.buildResult`: a config with
nine `omp` executors spawns **nine identical `omp` auth probes**, plus codex ×2, grok, agy ×2.

That auth signal is the one task 0621 already deleted from the table because it cannot distinguish
"not authenticated" from "no probe exists for this provider", and which
`spur-dev/references/cross-cutting.md` instructs operators not to read. **74% of the command's wall
clock buys a field the project has already declared untrustworthy.**

## 2. Principle

> Dispatch resolves to one executor. Inspection renders the whole ladder.

`resolveRole` and `TeamService.materializeTeam` keep their first-eligible semantics untouched. Every
change here is a projection over data those functions already compute, or a removal.

## 3. Output contract

### 3.1 Table mode — `spur agent doctor`

```
  STATUS   EXECUTOR                 AGENT   TIER       MODEL                             ROLES
✓ usable   minimax                  omp     cheap      minimax/MiniMax-M3                scribe*
✓ usable   omp-dsv4-flash-volc      omp     standard   volc/deepseek-v4-flash-ga-260731  scribe coder*
✓ usable   omp-zai                  omp     standard   zai/glm-5.3                       scribe coder
✗ missing  agy-gemini               agy     standard   gemini-3.6-flash-high             —
✓ usable   grok                     grok    capable-2  grok-4.6                          scribe coder reviewer planner*
✓ usable   claude                   claude  capable-3  k3                                scribe coder reviewer planner

15 executors · 13 usable, 2 missing · * = elected for that role
```

| Column | Source | Note |
| --- | --- | --- |
| `STATUS` | `DoctorResult.usable` | unchanged |
| `EXECUTOR` | executor name | was `AGENT`; renamed for honesty — the cell always held the executor |
| `AGENT` | `AgentExecutorConfig.agent` | new; the underlying binary, previously invisible |
| `TIER` | `getExecutorTier(executor)` | **replaces** support tier |
| `MODEL` | `AgentExecutorConfig.model` | the pinned string, not health; `—` when undeclared |
| `ROLES` | tier eligibility over `ctx.roles` | `*` marks a role this executor is elected for |

`ROLES` is derived, not probed: role eligibility is `isTierEligible(executorTier, roleTier)`, already
the predicate behind `cheapestEligibleExecutors`. The eligible *set* is a pure function of tier and
therefore redundant with the `TIER` column; the **elected marker is not** — it is the outcome of the
doctor-walk, and it is the signal an operator asking "which executor will `coder` use?" needs.

### 3.2 Ladder mode — `spur agent doctor <role>`

```
Role coder (tier standard) — 12 eligible, cheapest first

✓ omp-dsv4-flash-volc   standard   volc/deepseek-v4-flash-ga-260731   ELECTED
✓ omp                   standard   opencode/deepseek-v4-flash
✗ agy-gemini            standard   gemini-3.6-flash-high              not runnable
✓ claude                capable-3  k3

12 eligible, 10 usable · elected: omp-dsv4-flash-volc (cheapest usable)
```

Rows appear in `cheapestEligibleExecutors` order — the same order dispatch walks — so the listing
*is* the resolution trace. A non-usable row above the elected one carries the reason it was passed
over, which is what makes the ladder readable as an explanation rather than an inventory.

When no executor is usable the command exits non-zero, lists every candidate with its individual
failure, and the message names the full tried set (superseding today's single joined `tried:` line).

### 3.3 Detail mode — `spur agent doctor <executor>`

Unchanged in shape, minus the `auth:` line (§4), plus `model:` (pinned string) alongside the
existing health block.

### 3.4 `--json`

Additive on each `agents[]` entry: `model` (pinned string, `null` when undeclared), `roles` (eligible
role ids), `elected` (role ids this executor is elected for). `capabilityTier` stays. `tier` (support
tier) stays — it still backs the exit code. **`authenticated` is removed** (§4).

**Compatibility invariant:** under a role selector, `agents[0]` is the **elected** executor.
`packages/app/src/workflow/actions/doctor-probe.ts` parses `.agents[0]`; widening the array from one
entry to the ladder must not move the elected executor off index 0.

## 4. Removing the auth signal

The `authenticated` field leaves the doctor surface entirely: no table column (already gone, 0621),
no `auth:` detail line, no `--json` key, no `renderAuth` helper, and — critically — **no probe**.

This deletes a second thing. `doctor-probe.ts` carries `RELAY_FAMILY`, `ENV_MISS_PATTERN`,
`AUTH_FAIL_PATTERN` and `classifyDoctorProbe` for one purpose: to decide *when to ignore* the auth
value, because omp/pi relay executors hold credentials the CLI process cannot see. That classifier
exists only to neutralize the signal being removed. With the signal gone the action's question
collapses to "is the resolved executor usable?", and roughly 60 lines of pattern-matching go with it.

This is the T10 obligation of the change: the field's removal and its consumer's simplification land
in the same commit.

### 4.1 Where the probe suppression lives — the one cross-repo hop

`isAuthenticated` is called inside `DoctorRunner.buildResult`, which lives in published
`@gobing-ai/ts-ai-runner@0.4.42`, not in this repo. Spur can stop *displaying* the field unilaterally,
but it cannot stop the subprocess from spawning without a runner-side lever.

| Option | Verdict |
| --- | --- |
| Stop consuming `authenticated` in Spur only | Rejected — fixes the honesty half, none of the 4.6 s |
| Inject a stub `AiRunner` so `probeAuthOutput` returns instantly | Rejected — a Spur workaround for a facade defect; AGENTS.md prefers fixing the facade |
| Add `probeAuth?: boolean` to `DoctorRunnerOptions` (default `true`) | **Accepted** — backward compatible, one option, `buildResult` yields `authenticated: 'unknown'` without probing when false |

Spur passes `probeAuth: false`. Because this needs a ts-libs release plus a `bun update`, it is
sequenced **after** the Spur-side work rather than blocking it — the Spur-side changes are already
correct and complete without it, and the cache (§5) bounds the cost in the interim.

## 5. Cost control

### 5.1 `--probe-health` — model health becomes opt-in

Today `probeModel` fires whenever `{PROVIDER}_API_KEY` resolves from the environment. That makes the
command's latency and network behavior a function of the operator's shell — invisible, and exactly
the hidden automation AGENTS.md rules out. It also cannot be trusted for relay executors, whose
credentials live in the agent's own store (`cross-cutting.md` already says so).

No runner change is needed. `DoctorRunner` probes iff `executor.model` is set, so Spur withholds
`model` from the `executors` array it constructs unless `--probe-health` was passed. The MODEL
*column* is unaffected — it reads Spur's own config, not the probe result.

### 5.2 Detection cache — `.spur/run/agent-doctor.json`

Detection (`detectAll`, ~1.3 s) is the residual cost once auth probing is gone. It is cached:

| Aspect | Contract |
| --- | --- |
| Path | `.spur/run/agent-doctor.json` |
| Key | executor-set fingerprint (name + agent + model + tier) — a config edit invalidates |
| TTL | 60 s |
| Bypass | `--force-refresh` re-runs detection and rewrites the file |
| Visibility | a cache hit prints its age in the footer |
| Degradation | unreadable / malformed / stale-schema → live run, then rewrite |
| Never cached | `--probe-health` results — a health probe is a liveness question by definition |

The visibility rule is the point. A readiness report is only useful if the reader knows whether it is
live; a silently cached `usable` for a dead executor is a worse failure than a slow command. 60 s is
short enough that a human debugging a routing failure sees fresh data on their second look, and long
enough that `doctor.probe`'s 1–2 calls per pipeline precheck hit warm.

## 6. What does not change

| Surface | Why untouched |
| --- | --- |
| `resolveRole` (`agent-service.ts:1783-1823`) | First-usable-wins is the correct dispatch semantic; this feature is projection only |
| `TeamService.materializeTeam` (`team-service.ts:737`) | Config-time `[0]` selection, no liveness probe — a display change cannot reach it |
| Stage fallback / escalation ladder | Already correct (task 0482 R1); runtime concern, not inspection |
| `DoctorResult.tier` (support tier) | Still backs the exit code and stays in `--json` |
| CLI nouns and verbs | `--probe-health` and `--force-refresh` are flags on the existing `doctor` verb (ADR-051: expand via flags) |

## 7. Same-commit obligations (T3)

- `docs/04_DESIGN.md` — the `agent doctor` output shape and the two new flags.
- `plugins/sp/skills/spur-cli/references/agent.md` — parity-gated; the flag table and `--json` shape.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — the "do not read provider quota from
  `spur agent doctor`" paragraph now describes a surface with no auth field at all.
- `apps/cli/tests/commands/agent.test.ts`, `packages/app/tests/services/agent-service.test.ts`,
  `packages/app/tests/workflow/actions/doctor-probe.test.ts` — pinned output and classifier assertions.
