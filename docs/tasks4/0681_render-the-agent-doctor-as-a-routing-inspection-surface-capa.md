---
schema_version: 1
name: "Render the agent doctor as a routing inspection surface: capability tier, executor/agent/model/roles columns, and the full role ladder"
status: done
template: feature-impl
created_at: 2026-08-26T18:52:01.188Z
updated_at: "2026-08-26T23:03:33.871Z"
feature_id: B4
priority: P2
tags: ["cli", "agent", "doctor", "rendering"]
---

## 0681. Render the agent doctor as a routing inspection surface: capability tier, executor/agent/model/roles columns, and the full role ladder

### Background

`spur agent doctor` is the documented preflight for executor routing, but its text output renders the pre-0343 axis and only one rung of the ladder.

`renderDoctorTable` (`packages/app/src/services/agent-service.ts:2155-2198`) prints `DoctorResult.tier` — the agent *support* tier (1 = direct CLI, 2 = gateway/TUI). Against the 15-executor global config every row reads `1`. The axis that decides every routing call since 0343 is the *capability* tier (`cheap|standard|capable-1..3`), which `renderDoctor` already computes but emits only under `--json` as `capabilityTier` (`packages/app/src/services/agent-service.ts:506-514`). The `missing (tier-1)` footer keys off the same dead axis (`agent-service.ts:2188-2194`).

`doctor <role>` routes through `resolveRole` (`packages/app/src/services/agent-service.ts:1766-1830`), which walks `cheapestEligibleExecutors` and breaks on the first usable executor. Correct for dispatch — dispatch must pick one — but wrong for inspection: `agent doctor coder` names `omp-dsv4-flash-volc` and says nothing about the eleven other standard-or-better executors behind it.

The MODEL column shows model *health status* (`unknown` for every relay executor, because `probeModel` short-circuits with no provider key), while the pinned model string — already in hand via `modelByExecutor` at `packages/app/src/services/agent-service.ts:487-489` — is never shown.

The `AGENT` column header is also a misnomer: `DoctorRunner.runAllWithExecutors` overwrites `result.agent` with the **executor** name (`node_modules/@gobing-ai/ts-ai-runner/dist/doctor-runner.js:73`, source `~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts:156-158`), so the cell has always held the executor, never the binary. The binary is never displayed at all.

Design: `docs/design/agent-doctor-inspection-surface.md` §3.

### Requirements

- [x] R1. `renderDoctorTable` renders the **capability tier** (`getExecutorTier`) in the `TIER` column, not `DoctorResult.tier`. No row shows the support-tier values `1`/`2` in that column. The footer reports usable/missing counts without naming a support tier (replacing `missing (tier-1)` at `agent-service.ts:2188-2194`).

- [x] R2. Each row gains an `AGENT` column (the underlying binary from `AgentExecutorConfig.agent`) and a `MODEL` column carrying the **pinned model string** from config. The existing `AGENT` column is renamed `EXECUTOR` — the cell always held the executor name (`DoctorRunner.runAllWithExecutors` overwrites `result.agent` with `executor.name`). An executor with no declared model renders the em-dash placeholder; the value is never fabricated. The rename is display-only: the `--json` wire key stays `agent`.

- [x] R3. Each row gains a `ROLES` column listing the roles the executor is eligible for, computed as `isTierEligible(getExecutorTier(e), roleTier)` over `ctx.roles` — the same predicate behind `cheapestEligibleExecutors`. A role for which this executor is the **elected** one carries a `*` marker; the legend appears in the footer. Exactly one row is starred per role that has a usable executor. A non-usable executor's text cell renders `—` (it can serve no role); its `--json` `roles` array still carries the tier-derived eligible set (Q&A Q1).

- [x] R4. `doctor <role>` renders **every eligible executor** in `cheapestEligibleExecutors` order (the order dispatch walks) with the elected executor marked `ELECTED`, a per-row reason on each non-usable entry, and a summary line reporting eligible count, usable count, and the elected executor. It no longer renders only the resolved executor.

- [x] R5. When a role has eligible executors but none usable, every candidate is listed with its individual failure reason, the command exits non-zero, and the message names the full tried set (superseding the single joined `tried:` line at `agent-service.ts:1824`). The ladder is rendered **before** the `!resolved.ok` early return at `agent-service.ts:465-472`.

- [x] R6. `--json` gains `model` (pinned string, `null` when undeclared), `roles` (eligible role ids), and `elected` (role ids this executor is elected for) on each `agents[]` entry. `capabilityTier` and `tier` (support tier — still backs the exit code at `agent-service.ts:522`) are retained.

- [x] R7. **Compatibility invariant:** under a role selector, `agents[0]` is the elected executor. `packages/app/src/workflow/actions/doctor-probe.ts:40-57` parses `.agents[0]`; widening the array from one entry to the full ladder must not move the elected executor off index 0. A test pins this with a config where the cheapest *eligible* executor is not the cheapest *usable* one.

- [x] R8. `resolveRole` (`agent-service.ts:1766-1830`) and `TeamService.materializeTeam` (`packages/app/src/services/team-service.ts:737-738`) are **not modified**. A regression test asserts role dispatch still resolves to exactly one executor and team materialization still takes the first eligible entry.

- [x] R9. Same-commit doc sync (T3): the `agent doctor` output shape in `docs/04_DESIGN.md`, the parity-gated `plugins/sp/skills/spur-cli/references/agent.md`, and the `ROLES` column note in `docs/design/agent-doctor-inspection-surface.md` §3.1 (corrected per Q&A Q1).

### Acceptance Criteria

Covers these feature B4 scenarios (titles are the traceability keys — byte-identical to `docs/features/B4_*.md`):

- [x] R1 — The doctor table renders capability tier, not agent support tier
- [x] R2 — Each executor row names its underlying agent binary and pinned model
- [x] R3 — Each executor row lists the roles it can serve and stars the roles that elect it
- [x] R4 — A role selector renders the full eligible ladder, not just the elected executor
- [x] R5 — A role selector with no usable executor reports the whole tried ladder
- [x] R12 — The --json payload carries the routing fields the text view shows
- [x] R13 — Role resolution semantics are unchanged by the rendering work
- [x] R15 — An executor with no declared model renders a placeholder, not a fabricated value

### Q&A

**Q1. Does the `ROLES` column list tier-eligible roles for a *non-usable* executor?**
**Closed — no.** The design doc's column table says "tier eligibility over `ctx.roles`" while its own
example renders `—` for the missing `agy-gemini` row (`docs/design/agent-doctor-inspection-surface.md`
§3.1); the two readings conflict. Resolution: the **text** `ROLES` cell renders `—` when
`usable === false`, because a routing inspection surface must not advertise a role an executor cannot
serve. The **`--json`** `roles` array stays a pure tier derivation regardless of usability — it is a
config fact, and a machine consumer that wants "would this serve `coder` if installed?" must not have
to reconstruct it. `elected` (both surfaces) always requires usability. The design doc's §3.1 column
note is corrected in the same commit.

**Q2. How does ladder mode obtain doctor results for every eligible executor?**
**Closed — one `runAll()`, filtered.** `DoctorRunner.runAll()` is already executor-aware when
`executors` is passed (it is, at `agent-service.ts:445`), so it returns one row per configured
executor in a single pass. Ladder mode filters and reorders those rows by
`cheapestEligibleExecutors(executors, roleTier)`. Rejected: looping `runOne` per eligible executor —
N detections instead of one, for data already in hand.

**Q3. Where does `agents[0]` land under a role selector once the array widens?**
**Closed — elected first, then the remaining ladder in resolution order.** Feature R12 and task R7
both pin this; `packages/app/src/workflow/actions/doctor-probe.ts:40-57` parses `.agents[0]` and would
silently mis-attribute the probe if the cheapest *eligible* (not cheapest *usable*) executor took
index 0. The text ladder keeps pure cheapest-first order — only the JSON array is rotated.

**Q4. Does `renderDoctorDetail` gain the pinned model string?**
**Closed — yes**, per design §3.3 (`model:` line alongside the existing health block). The `auth:`
line removal from the same function belongs to task 0682, which lands after this one; do not
pre-emptively remove it here.

**Deferred:** nothing. No open decision blocks implementation.

### Design

**WHAT:** A projection layer over data `renderDoctor` and `resolveRole` already compute. Two render paths change shape (`renderDoctorTable`, and a new ladder renderer for role selectors); `renderDoctorDetail` keeps its shape for executor selectors and gains a pinned-`model:` line. The `--json` builder gains three additive fields.

**WHERE (primary targets):**

| File | Change |
| --- | --- |
| `packages/app/src/services/agent-service.ts` | `DoctorRow` → display row; `buildDoctorRows`; `renderDoctorTable`; new `renderRoleLadder`; `renderDoctorDetail` (+`model:`); `renderDoctor` JSON builder; `doctor()` role branch |
| `apps/cli/tests/commands/agent.test.ts` | pinned doctor output assertions |
| `packages/app/tests/services/agent-service.test.ts` | pinned doctor output + `--json` shape assertions |
| `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/agent.md` | T3 same-commit doc sync |

**Frozen names (do not rename during implementation):**

```ts
/** Display row: DoctorResult joined with its executor config and role eligibility. */
type DoctorRow = {
    executor: string;            // was `agent` — the cell always held the executor name
    agentBinary: string;         // AgentExecutorConfig.agent
    usable: boolean;
    tier: number;                // support tier — retained, backs the exit code only
    capabilityTier: CapabilityTier;
    model: string | null;        // pinned config string; null when undeclared
    roles: string[];             // tier-eligible role ids (usability-independent)
    elected: string[];           // role ids this executor is elected for (requires usable)
    version: string | null;
    modelStatus?: ModelHealthResult | null;
};

function buildDoctorRows(
    results: readonly DoctorResult[],
    executors: readonly AgentExecutorConfig[] | undefined,
    roles: ReadonlyMap<string, AgentRoleDefinition> | undefined,
): DoctorRow[];

function renderDoctorTable(rows: readonly DoctorRow[]): string;
function renderRoleLadder(role: string, roleTier: CapabilityTier, ladder: readonly DoctorRow[]): string;
```

`--json` additions per `agents[]` entry: `model`, `roles`, `elected`. `capabilityTier` and `tier` are retained.

**The `EXECUTOR`/`agentBinary` rename is display-only.** The `--json` `agents[]` entry keeps its existing `agent` key holding the executor name — `packages/app/src/workflow/actions/doctor-probe.ts:56` reads `first.agent` to name the resolved executor, and the JSON payload is spread straight from `DoctorResult` (`agent-service.ts:507-514`). Renaming the wire key would break that consumer for a cosmetic gain. The new `--json` `agent` binary is *not* exposed in this task; only the text `AGENT` column carries it.

**Precedence / algorithm:**

1. **Eligibility** — `roles[]` = every `roleId` in `ctx.roles` where `isTierEligible(getExecutorTier(executor), roleDef.tier)`. Pure tier function, computed regardless of `usable`.
2. **Election** — for each role, walk `cheapestEligibleExecutors(executors, roleDef.tier)` (the order dispatch walks) and take the **first row whose `usable === true`**. That executor's `elected[]` gains the role id. A role with no usable eligible executor elects nobody; no row is starred.
3. **Text `ROLES` cell** — `—` when `!usable` (Q1); otherwise the eligible role ids, each carrying `*` when present in `elected[]`.
4. **Ladder ordering** — text: `cheapestEligibleExecutors` order, unmodified. JSON under a role selector: elected row first, then the remainder in that same order (Q3, R7).
5. **Missing executor config** — an executor row with no matching `AgentExecutorConfig` (bare binary, or no `agent.executors` block) keeps the existing name-based inference for `capabilityTier`, sets `agentBinary` to the row name, and `model` to `null`. Never blocks on the absence.

**WHY this shape:**

- *Capability tier replaces support tier in the column, rather than adding a second tier column.* Two columns both named some flavor of "tier" is the confusion this task exists to remove. Support tier keeps its only real consumer — the exit code (`agent-service.ts:522`) — and stays in `--json`.
- *The ROLES column is derived, never probed.* Role eligibility is a pure function of capability tier, so the eligible set is technically redundant with the TIER column. The **elected marker is not** — it is the outcome of the doctor-walk, and it is precisely the signal an operator asking "which executor will `coder` use?" needs. The redundancy is accepted so the answer is readable without mentally applying the tier ladder.
- *The ladder is rendered in resolution order.* Listing eligible executors cheapest-first with skip reasons makes the output a **resolution trace**, not an inventory — it explains the election rather than just reporting it.
- *`resolveRole` is untouched.* Dispatch resolution and inspection rendering are different jobs. Widening the resolver's return type to serve a display surface would couple them and put the dispatch path at risk for no gain; the ladder renderer calls `cheapestEligibleExecutors` directly and walks usability itself.
- *Election is computed from the rows already returned by one `runAll()`* (Q2). No extra detection subprocess is spawned to render the star.

**Anti-patterns — do not implement:**

- Do not modify `resolveRole` (`agent-service.ts:1766-1830`), its return type, or `TeamService.materializeTeam` (`packages/app/src/services/team-service.ts:737-738`). R8 pins both.
- Do not loop `doctorRunner.runOne` per eligible executor to build the ladder — one `runAll()` already returns every executor row.
- Do not remove `tier` from `DoctorRow` or from the `renderDoctor` exit-code expression; it is the only remaining consumer.
- Do not fabricate a model string when config declares none — `—` in text, `null` in JSON (R15).
- Do not touch the `auth:` line, `renderAuth`, or `authenticated` — task 0682 owns that removal and lands after this task.
- Do not add a CLI noun or verb.

**Rejected:** a separate `spur agent ladder <role>` verb — ADR-051 keeps the first CLI layer nouns-only and this is `doctor`'s job (inspect readiness); a new verb would cross the consent gate for no gain.

**Cross-task handoff:**

- **Assumes from deps:** nothing. This task is first in feature B4 and depends on no sibling.
- **Leaves for 0682:** `renderDoctorDetail` and the `--json` builder in their post-rename shape; 0682 removes the `auth:` line and the `authenticated` key from exactly those two places. Do not pre-remove them here — a half-removed field in an intermediate commit is what T10 reconciliation exists to prevent.
- **Leaves for 0683:** the MODEL *column* reads `AgentExecutorConfig.model` from Spur's own config, never `modelStatus`. 0683 depends on that decoupling to make `--probe-health` opt-in without blanking the column.

### Plan

1. [ ] **Baseline capture** — run `bun run apps/cli/src/index.ts agent doctor` and `… agent doctor coder --json` against the 15-executor global config; paste both outputs into `## Solution` as the before-state the diff is judged against.
2. [ ] **(R2, R6) Widen the display row** — replace the `DoctorRow` structural subset (`agent-service.ts:2131-2139`) with the frozen `DoctorRow` shape from `## Design`, and add `buildDoctorRows(results, executors, roles)` next to it. Join each `DoctorResult` with `executorByName` (the map already built at `agent-service.ts:506`) for `agentBinary`/`model`, and with `getExecutorTier` for `capabilityTier`. Unmatched rows follow the Design step-5 fallback.
3. [ ] **(R3) Compute eligibility and election** — inside `buildDoctorRows`, fill `roles[]` from `isTierEligible(getExecutorTier(executor), roleDef.tier)` over `ctx.roles`, then walk `cheapestEligibleExecutors(executors, roleDef.tier)` per role and set `elected[]` on the first row with `usable === true`. No new probe: election reads only the rows already returned by `runAll()`.
4. [ ] **(R1, R2, R3) Rewrite `renderDoctorTable`** (`agent-service.ts:2155-2198`) to the §3.1 column set `STATUS · EXECUTOR · AGENT · TIER · MODEL · ROLES`, with `TIER` = `capabilityTier`. Replace the `missing (tier-1)` footer (`:2188-2194`) with `<n> executors · <u> usable, <m> missing · * = elected for that role`; append the `*` legend only when at least one row is starred.
5. [ ] **(R4) Add `renderRoleLadder`** — new function beside `renderDoctorTable`. Header `Role <role> (tier <roleTier>) — <n> eligible, cheapest first`; one line per eligible row in `cheapestEligibleExecutors` order carrying glyph, executor, capability tier, model, and either `ELECTED` or a `not runnable` reason; summary line `<n> eligible, <u> usable · elected: <name> (cheapest usable)`.
6. [ ] **(R4, R5, R7) Rewire the role branch of `doctor()`** (`agent-service.ts:462-475`) — call `doctorRunner.runAll()` once, `buildDoctorRows`, then filter/order by `cheapestEligibleExecutors(executors, roleDef.tier)`. Text path → `renderRoleLadder`. JSON path → elected row first, then the remaining ladder in resolution order. Keep `resolveRole` for the elected-name decision so dispatch and inspection cannot disagree.
7. [ ] **(R5) No-usable-executor path** — today the `!resolved.ok` branch (`agent-service.ts:465-472`) returns before anything is rendered, so the ladder must be built and printed **before** the early return: print the full ladder with per-row reasons, emit a message naming every executor tried, then return `resolved.exitCode` (non-zero). This supersedes the single joined `tried:` line at `agent-service.ts:1824` for the *doctor* path only; `resolveRole`'s own message and return shape are unchanged (R8).
8. [ ] **(R2) Detail mode** — add `model:` (pinned string, `—` when absent) to `renderDoctorDetail` (`agent-service.ts:2202-2218`) above the existing health block. Leave the `auth:` line alone — 0682 owns it.
9. [ ] **(R6) `--json` builder** — in `renderDoctor` (`agent-service.ts:506-515`), emit `model`, `roles`, `elected` alongside the retained `capabilityTier` and `tier`. Keep the wire key `agent` unchanged (Design note). Leave `agent-service.ts:522`'s exit-code expression on `tier === 1` untouched.
10. [ ] **(R7) Pin the compatibility invariant** — add a test asserting that `doctor <role> --json` puts the elected executor at `agents[0]` when the cheapest *eligible* executor is not the cheapest *usable* one (`packages/app/tests/services/agent-service.test.ts`). This is the test that would have caught a naive `[...ladder]` emit.
11. [ ] **(R8) Pin the no-change invariants** — regression tests asserting `resolveRole` still returns exactly one executor for a role, and `TeamService.materializeTeam` still selects `cheapestEligibleExecutors(...)[0]` for a role-only member (`packages/app/tests/services/team-service.test.ts`).
12. [ ] **(R1–R6) Reconcile pinned output assertions** — update `apps/cli/tests/commands/agent.test.ts:215-232` and the `AgentService.doctor` describe block at `packages/app/tests/services/agent-service.test.ts:213-360` to the new table/ladder/JSON shapes. Rewrite assertions to the new contract; do not delete one to reach green (T10).
13. [ ] **(R15) Edge test** — an executor entry with no `model`: text cell renders `—`, `--json` `model` is `null`, and no `(unknown)` or fabricated string appears anywhere.
14. [ ] **(R9) T3 doc sync in the same commit** — `docs/04_DESIGN.md` `agent doctor` output shape; `plugins/sp/skills/spur-cli/references/agent.md:28` flag/output table and §`doctor`; and correct the `ROLES` column note in `docs/design/agent-doctor-inspection-surface.md` §3.1 per Q&A Q1.
15. [ ] **Verification** — `bun test packages/app/tests/services/agent-service.test.ts` and `bun test apps/cli/tests/commands/agent.test.ts` green first (targeted-test-first), then `bun run autofix && bun run spur-check`. Re-run the step-1 baseline commands and paste the after-state into `## Solution`.

### Solution
**R1–R7, R9** — `packages/app/src/services/agent-service.ts:2354`: new `DoctorRow` display type + `buildDoctorRows` (`:2381`, elections via `cheapestEligibleExecutors` first-usable walk per role at `:2399`). `packages/app/src/services/agent-service.ts:2441`: `renderDoctorTable` → `STATUS|EXECUTOR|AGENT|MODEL(pinned)|TIER(capability)|VERSION|ROLES(*elected)` + legend footer (`:2482`); new `renderRolesCell` (`:2419`, `—` when unusable/no roles); new `renderRoleLadder` (`:2496`) for role selectors (ELECTED + per-row reasons + summary at `:2515`). `packages/app/src/services/agent-service.ts:450`: `doctor()` — one `doctorRunner.runAll()` per invocation; failure ladder text-only before the non-zero return (`:539`; JSON keeps the single `{error:{code:'agent-resolution'}}` envelope); success JSON orders elected-first (`:545-551`) with added `capabilityTier`/`model`/`roles`/`elected` (`:554`, `:621`); wire key `agent` unchanged; exit code still support-tier based (`:640`). `renderDoctorDetail` (`:2524`) gains `pinned:` vs `health:` lines; unused `renderModelStatus` deleted.

> Line anchors above were re-resolved in the 2026-08-26 re-audit. The originals (`:2199`/`:2251`/`:2238`/`:2306`/`:444`) were written before siblings 0683 and 0684 landed in the same file and shifted every symbol below `doctor()` by ~+180 lines.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/services/agent-service.ts:2441 renderDoctorTable — TIER cell = String(result.capabilityTier) (:2451), sourced from getExecutorTier over executor config in buildDoctorRows (:2381, :2391); footer `N usable, M missing` (:2482-2484) names no support tier. Pin: packages/app/tests/services/agent-service.test.ts:584 asserts the cell text and that no bare '1'/'2' renders in TIER. |
| R2 | MET | buildDoctorRows (:2381) joins results to executor config by executor name so runAllWithExecutors rows keep executor-name keys; EXECUTOR/AGENT/MODEL columns rendered by renderDoctorTable (:2441+), model from `executor.model ?? null` (:2391) with an em-dash placeholder when undeclared. Pin: agent-service.test.ts:606 (omp-zai → binary omp + pinned model; bare executor → em-dash). Wire key `agent` unchanged in --json (spread of DoctorResult at :554 / :621). |
| R3 | MET | renderRolesCell (:2419) renders `—` when unusable or no eligible roles, starred ids otherwise; eligibility via isTierEligible over ctx.roles (buildDoctorRows :2410); elections map = cheapestEligibleExecutors first-usable per role (:2399), elected list at :2411; legend footer emitted by renderDoctorTable when any star exists. Pin: agent-service.test.ts:631. |
| R4 | MET | doctor() role branch :510-568 builds ladderRows from cheapestEligibleExecutors order mapped through the single runAll() rowset (:526-530); renderRoleLadder (:2496) prints the ELECTED marker (:2509 status line) and the summary `N eligible, M usable, elected: X` (:2515). Pin: agent-service.test.ts:659 (2 eligible / 1 usable / elected std-exec with a 'not found' reason on the dead-cheap row). |
| R5 | MET | Failure path renders renderRoleLadder(..., undefined) to output.error at :539 BEFORE returning resolved.exitCode, so the whole tried ladder prints ahead of the non-zero exit; --json keeps the single {error:{code:'agent-resolution'}} envelope (stderr-clean), pinned by agent-service.test.ts:560 ('a role that resolves to no usable executor emits a single agent-resolution envelope'). |
| R6 | MET | Both --json builders add capabilityTier/model/roles/elected per entry — role branch :554-559, renderDoctor :621-626. Support tier is retained inside the spread DoctorResult and still backs the exit code (:640). model is null when undeclared. Live check this run: `agent doctor --json` → every entry has capabilityTier/model/roles/elected, wire key `agent` intact. Pin: agent-service.test.ts:693. |
| R7 | MET | packages/app/src/workflow/actions/doctor-probe.ts consumes .agents[0]; role-branch JSON orders elected-first then resolution order (:545-551). Pin: agent-service.test.ts:693 places dead-cheap (standard, unusable) ahead of std-exec in executor order so the cheapest ELIGIBLE is not the cheapest USABLE, and asserts agents[0].agent === 'std-exec'. |
| R8 | MET | resolveRole (:1883) and TeamService.materializeTeam untouched — `git show --stat bb5fc3fb4` carries no team-service.ts hunk and no resolveRole hunk. Dispatch + team-materialize regressions green this run: packages/app agent-service suite + apps/cli agent suite, 233 pass / 0 fail across the three B4 suites. |
| R9 | MET | Same-commit sync (T3) re-verified this run: docs/04_DESIGN.md:397-430 doctor section carries the STATUS/EXECUTOR/AGENT/MODEL/TIER/VERSION/ROLES header, the role-ladder arg semantics and the --json field list; plugins/sp/skills/spur-cli/references/agent.md:28 doctor row updated; docs/design/agent-doctor-inspection-surface.md §3.1 matches the implemented Q&A-Q1 behavior (`—` for the unusable text cell, eligible set still in JSON). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The doctor table renders capability tier, not agent support tier | MET | test | agent-service.test.ts:584 |
| R2 — Each executor row names its underlying agent binary and pinned model | MET | test | agent-service.test.ts:606 |
| R3 — Each executor row lists the roles it can serve and stars the roles that elect it | MET | test | agent-service.test.ts:631 |
| R4 — A role selector renders the full eligible ladder, not just the elected executor | MET | test | agent-service.test.ts:659 |
| R5 — A role selector with no usable executor reports the whole tried ladder | MET | test | agent-service.test.ts failure-path envelope pin + :657 family (ladder rendered pre-return) |
| R12 — The --json payload carries the routing fields the text view shows | MET | test | agent-service.test.ts:693 (capabilityTier/model/roles/elected) |
| R13 — Role resolution semantics are unchanged by the rendering work | MET | test | resolveRole untouched; 168 pass app suite + 43 pass cli suite this run |
| R15 — An executor with no declared model renders a placeholder, not a fabricated value | MET | test | agent-service.test.ts:606 (bare-claude row contains em-dash); :691 JSON null |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**SECUA review (P1–P4):**

| Priority | Dimension | Verdict | Notes |
| --- | --- | --- | --- |
| P1 | Correctness | PASS | buildDoctorRows is 1:1 over results order — renderDoctor JSON `results[i]` and detail `rows[0]` indexing safe; role-branch `results.find` cannot miss (ladderRows derived from same rows). Election keys match runAllWithExecutors executor-name rows. |
| P2 | Contract stability | PASS | Wire key `agent` unchanged; exit codes unchanged; resolveRole/materializeTeam untouched (R8). |
| P3 | Honesty/safety | PASS | No fabricated values (em-dash/null placeholders), JSON stderr purity preserved on failure path. |
| P4 | Scope | PASS | T3 doc sync same-commit; main-tree lint advisories (history-anatomy.yaml etc.) belong to a parallel session — out of scope, logged. |

### References

- Parent feature: `docs/features/B4_agent-doctor-as-the-routing-inspection-surface-capability-tier-rendering-full-eligible-ladder-auth-removal-and-cached-probes.md` (scenarios R1–R5, R12, R13, R15)
- Design: `docs/design/agent-doctor-inspection-surface.md` §3 (output contract), §6 (what does not change)
- Siblings: 0682 (auth removal — lands after this task), 0683 (`--probe-health` / detection cache), 0684 (ts-libs `probeAuth`)
- ADR-051 (CLI surface governance — no new noun/verb; expansion via flags), ADR-061 (`DEFAULT_AGENT_ROLES` SSOT)
- Prior art: task 0343 (capability tiers), 0487 R3 (`capabilityTier` in `--json`), 0482 R1 (stage fallback ladder), 0572 (role table), 0621 (AUTH column removal), 0622 R1 (role selector doctor-walk)
- Surfaces touched: `packages/app/src/services/agent-service.ts`, `apps/cli/tests/commands/agent.test.ts`, `packages/app/tests/services/agent-service.test.ts`, `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/agent.md`

### History

- 2026-08-26T20:29:37.178Z todo → wip (system)
- 2026-08-26T20:29:37.855Z wip → testing (system)
- 2026-08-26T20:29:38.282Z testing → done (system)
