---
schema_version: 1
name: "Remove the authentication signal from the doctor surface and collapse the doctor.probe classifier that existed to neutralize it"
status: done
template: feature-impl
created_at: 2026-08-26T18:52:01.244Z
updated_at: "2026-08-26T20:44:17.602Z"
feature_id: B4
priority: P2
tags: ["cli", "agent", "doctor", "cleanup"]
dependencies: ["0681"]
---

## 0682. Remove the authentication signal from the doctor surface and collapse the doctor.probe classifier that existed to neutralize it

### Background

Task 0621 removed the AUTH column from the doctor table because the signal cannot distinguish "not authenticated" from "no probe exists for this provider". `plugins/sp/skills/spur-dev/references/cross-cutting.md:188-192` tells operators outright not to read provider quota or auth from `spur agent doctor` — the CLI process cannot see an agent-owned credential store, so the row degrades to `auth: no` for every relay executor.

The field nevertheless survives in three places: `renderDoctorDetail` still prints an `auth:` line (`packages/app/src/services/agent-service.ts:2209`; live: `omp-dsv4-flash-volc`, the elected `coder` executor, reads `auth: no`), `renderAuth` still exists to format it (`agent-service.ts:2126-2130`), and `--json` still carries `authenticated` on every entry — not by an explicit key, but because the payload is spread straight from `DoctorResult` at `agent-service.ts:507-514`.

It has one consumer, and that consumer exists only to work around it. `packages/app/src/workflow/actions/doctor-probe.ts:21-37` carries `RELAY_FAMILY`, `ENV_MISS_PATTERN`, `AUTH_FAIL_PATTERN` and `classifyDoctorProbe` for a single purpose: deciding *when to ignore* the auth value, because omp/pi relay executors hold credentials the CLI cannot see. The neutralization gate itself is at `doctor-probe.ts:173-187`. Roughly 60 lines of pattern-matching neutralizing a signal the project has already declared untrustworthy.

**The collapse is not purely subtractive.** `parseDoctorJson` (`doctor-probe.ts:39-57`) reads only `authenticated`, `modelStatus.detail`, and `agent` — never `usable`. With the auth gate gone the action's only remaining FAIL condition would be `res.exitCode !== 0` (`doctor-probe.ts:149`), and `renderDoctor`'s exit code fires only for `!usable && tier === 1` (`agent-service.ts:522`) — so a missing **tier-2** executor would silently PASS. Classifying "on usability alone" therefore requires `parseDoctorJson` to start reading `usable` from `.agents[0]`.

Design: `docs/design/agent-doctor-inspection-surface.md` §4.

### Requirements

- [x] R1. `renderDoctorDetail` no longer emits an `auth:` line (`packages/app/src/services/agent-service.ts:2209`), and the `renderAuth` helper (`agent-service.ts:2126-2130`) is deleted along with its `AuthState` import if it becomes unused.

- [x] R2. The `--json` payload no longer carries `authenticated` on any `agents[]` entry. Because the payload is spread from `DoctorResult` (`agent-service.ts:507-514`), the field must be **explicitly omitted** from the spread — it does not disappear by deleting a key.

- [x] R3. `packages/app/src/workflow/actions/doctor-probe.ts` drops `RELAY_FAMILY`, `ENV_MISS_PATTERN`, `AUTH_FAIL_PATTERN`, `classifyDoctorProbe`, the `ProbeClass` type, and the `auth` field of `parseDoctorJson`. The action classifies the resolved executor on **usability alone**; no probe outcome is decided by an authentication value.

- [x] R4. `parseDoctorJson` gains `usable` (read from `.agents[0].usable`, defaulting to `true` when absent or unparseable so the soft-probe contract is preserved), and the action writes `FAIL` when `usable === false`. Without this, removing the auth gate would leave a missing **tier-2** executor silently PASSing — `renderDoctor`'s non-zero exit fires only for `!usable && tier === 1` (`agent-service.ts:522`).

- [x] R5. The probe's PASS/FAIL status file contract, its `.spur/run/` path boundary check (`doctor-probe.ts:93-106`), the `splitLaunchCommand` shell-metacharacter rejection, the divergence line for `implementAgent !== agent`, and `return { ok: true, … }` (soft probe — never a raw lifecycle abort) are all unchanged. Only the classification input changes. The `resolvedAgent` extraction from `.agents[0]` is retained (it still distinguishes a role selector from a direct executor in the log line).

- [x] R6. `packages/app/tests/workflow/actions/doctor-probe.test.ts` is reconciled in the same commit: the three auth-keyed tests at `:38`, `:52`, `:79` and the unparseable-degradation test at `:214` are rewritten as usability assertions, not deleted to reach green (T10 — removing a field obliges reconciling its fallout in the same commit). A new test pins R4: a `usable: false` row with exit code 0 writes `FAIL`.

- [x] R7. `packages/app/tests/services/agent-service.test.ts:301-344` (`R1/R12 (0621): text table omits the AUTH column; --json keeps authenticated`) is reconciled in the same commit — its final assertion and its `R16` comment both require `--json` to keep `authenticated`, and both become false. Rename the test and invert the assertion; do not delete it.

- [x] R8. Same-commit doc sync (T3): `plugins/sp/skills/spur-dev/references/cross-cutting.md:188-192` — the paragraph instructing operators not to read quota/auth from `spur agent doctor` cites a row shape `status: usable · auth: no · model: unknown` that no longer exists; rewrite it to describe a surface with no auth field at all. `docs/04_DESIGN.md` and `plugins/sp/skills/spur-cli/references/agent.md` drop `authenticated` from the documented `--json` shape.

- [x] R9. **Out of scope for this task:** suppressing the auth *probe* itself. `isAuthenticated` is called inside `DoctorRunner.buildResult` in published `@gobing-ai/ts-ai-runner@0.4.42` (`~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts:212-226`); sibling task 0684 owns that. This task removes the field from Spur's surface and its consumer — correct and complete on its own.

### Acceptance Criteria

Covers these feature B4 scenarios (titles are the traceability keys — byte-identical to `docs/features/B4_*.md`):

- [x] R6 — No authentication field appears anywhere in the doctor output
- [x] R7 — Removing the auth signal removes the classifier that existed to neutralize it

### Q&A

**Q1. With the auth gate gone, what can still make `doctor.probe` FAIL?**
**Closed — a non-zero doctor exit, or `usable === false` on the resolved row.** The original task text
said "classifies on usability alone" without naming where usability comes from; `parseDoctorJson`
(`doctor-probe.ts:39-57`) never read `usable`. Left as a pure deletion the action's only FAIL would be
`res.exitCode !== 0` (`doctor-probe.ts:149`), and `renderDoctor` exits non-zero only for
`!usable && tier === 1` (`agent-service.ts:522`) — a missing tier-2 executor would slip through. R4
adds the `usable` read. This is the one place the collapse adds code rather than removing it.

**Q2. What does an unparseable doctor payload mean now?**
**Closed — PASS, unchanged.** `parseDoctorJson`'s catch path defaults `usable` to `true`. The action
is a soft probe: it must not convert a parse failure into a pipeline stop. The existing test at
`doctor-probe.test.ts:214` keeps its behavior and only changes its name and its asserted log line
(`auth=unknown probe=unknown` → a usability-keyed line).

**Q3. Does the relay/env-miss distinction survive anywhere?**
**Closed — no, and nothing replaces it.** `RELAY_FAMILY`/`ENV_MISS_PATTERN` existed only to decide
when to disbelieve `authenticated`. Usability is observable from outside the agent's credential store
(the binary is installed and reports a version, or it is not), so the relay/non-relay split has no
bearing on it. Leaving the classifier while removing its input would leave dead branches that always
take the `unknown` path.

**Q4. Ordering against the sibling tasks.**
**Closed — 0681 → {0682, 0683} → 0684, recorded as real `dependencies[]` edges** via `spur task deps`
(0682→0681, 0683→0681, 0684→0682), so the batch topo-sort enforces it rather than relying on
WBS-ascending tie-break. 0682 must precede 0684 so no Spur consumer reads `authenticated` by the time
the ts-libs option turns it into a constant; it must follow 0681 so the `auth:` line is removed from a
`renderDoctorDetail` that has already taken its final shape. 0682 and 0683 are independent of each
other and may land in either order.

**Deferred:** nothing. No open decision blocks implementation.

### Design

**WHAT:** A deletion, in two layers, plus one small addition the deletion forces. Layer one removes `authenticated` from the doctor's output contract (detail view, `--json`, the `renderAuth` helper). Layer two removes the only code that consumed it, which turns out to be code whose entire purpose was to undo it — and replaces its input with the signal the action should always have read (`usable`).

**WHERE (primary targets):**

| File | Change |
| --- | --- |
| `packages/app/src/services/agent-service.ts` | delete `renderAuth` (`:2126-2130`), the `auth:` line (`:2209`), `DoctorRow.authenticated`, the `AuthState` import if orphaned; omit `authenticated` from the `--json` spread (`:507-514`) |
| `packages/app/src/workflow/actions/doctor-probe.ts` | delete `:21-37` (constants + classifier + `ProbeClass`); `parseDoctorJson` (`:39-57`) swaps `auth` for `usable`; collapse the gate at `:173-187` |
| `packages/app/tests/workflow/actions/doctor-probe.test.ts` | reconcile `:38`, `:52`, `:79`, `:214`; add the R4 test |
| `packages/app/tests/services/agent-service.test.ts` | reconcile `:301-344` |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md`, `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/agent.md` | T3 same-commit doc sync |

**Frozen names:**

```ts
// doctor-probe.ts — the whole surviving parse contract
function parseDoctorJson(stdout: string): { usable: boolean; detail: string; resolvedAgent: string };
```

No other new type, helper, flag, or option. Everything else in this task is a deletion.

**Precedence / algorithm (the surviving `doctor.probe` decision):**

1. `res.exitCode !== 0` → `FAIL` (unchanged, `doctor-probe.ts:149-160`).
2. Otherwise parse `.agents[0]`. `usable === false` → `FAIL`, naming the resolved executor.
3. Otherwise → `PASS`.
4. Unparseable stdout → `usable` defaults `true` → `PASS` (soft-probe contract, Q2).
5. The action always returns `{ ok: true, … }`. A recorded `FAIL` is routed by the transition guard, never by a raw lifecycle abort.

**WHY the classifier goes with the field:** `classifyDoctorProbe` answers "should I believe this auth value?" — a question that exists only because the value is unreliable for relay executors. With the value gone the question is gone, and `doctor.probe`'s remaining question is the one it should always have asked: is the resolved executor usable? That collapse is the point of the task, not a side effect; leaving the classifier in place while removing its input would leave dead branches that silently always take the `unknown` path.

**WHY R4 adds code to a deletion task:** because "usability alone" was aspirational, not descriptive — nothing in the action read `usable` before. Landing the deletion without R4 would narrow the probe's FAIL surface rather than re-point it, and would make a missing tier-2 executor pass a precheck it currently fails. Deletions that quietly relax a gate are the failure mode this requirement exists to prevent.

**WHY it is split from the ts-libs probe suppression:** the two halves have different blast radii and different release mechanics. This half is Spur-local, lands immediately, and is independently correct — the surface stops publishing an untrustworthy field. The probe-suppression half needs a `@gobing-ai/ts-ai-runner` release and a dependency bump, so blocking this work on that would delay a correctness fix behind a cross-repo hop for a performance reason.

**Anti-patterns — do not implement:**

- Do not delete a test to reach green. Every auth-keyed assertion is rewritten as a usability assertion (R6, R7 — constitution T10).
- Do not touch the `.spur/run/` boundary compare (`doctor-probe.ts:93-106`) or the `splitLaunchCommand` metacharacter rejection — both are security checks with their own tests and no relation to this change.
- Do not change the action's return contract to `{ ok: false }` on FAIL. It is a soft probe by design.
- Do not keep `authenticated` in `--json` "for machines" — no consumer remains after R3.
- Do not add a `probeAuth` option, bump `@gobing-ai/ts-ai-runner`, or touch `~/xprojects/ts-libs` here. That is 0684.
- Do not reintroduce any credential source: no provider API call, no local agent config file read.

**Rejected:** keeping `authenticated` in `--json` only ("machines might want it"). No consumer would remain after R3, and a field no one reads that no one can trust is exactly the legacy residue this feature exists to clear.

**Cross-task handoff:**

- **Assumes from 0681:** `renderDoctorDetail` and the `--json` builder are already in their post-rename shape, and the `--json` wire key `agent` is unchanged — `parseDoctorJson`'s `resolvedAgent` extraction depends on it.
- **Leaves for 0684:** zero Spur readers of `authenticated`. Once this lands, `DoctorRunnerOptions.probeAuth = false` turning the field into a constant `'unknown'` is unobservable in Spur — which is precisely the precondition 0684 R6 names.
- **Leaves for 0683:** nothing; the two are independent and may land in either order relative to each other.

### Plan

1. [ ] **(R1) Delete the detail-view auth line** — remove `agent-service.ts:2209` and the `renderAuth` helper at `:2126-2130`. Drop `authenticated` from the `DoctorRow` type and remove the `AuthState` import if `tsc --noEmit` reports it orphaned (it may still be referenced by the runner's `DoctorResult` type import — check before deleting).
2. [ ] **(R2) Omit `authenticated` from `--json`** — in `renderDoctor` (`agent-service.ts:507-514`) the row is spread from `DoctorResult`, so destructure the field away rather than expecting a key deletion to suffice: `const { authenticated: _drop, ...rest } = result;`. Assert in a test that `'authenticated' in agents[0]` is `false`, not merely that it is undefined.
3. [ ] **(R3) Strip the classifier** — delete `doctor-probe.ts:21-37` (`RELAY_FAMILY`, `ENV_MISS_PATTERN`, `AUTH_FAIL_PATTERN`, `ProbeClass`, `classifyDoctorProbe`) and the `classifyAgainst` / `probe` locals at `:163-168`.
4. [ ] **(R4) Re-point `parseDoctorJson`** — swap the `auth` field for `usable`, read from `.agents[0].usable`, defaulting to `true` on absence or parse failure. Keep `detail` and `resolvedAgent` exactly as they are; `resolvedAgent` still drives the `(resolved <name>)` suffix.
5. [ ] **(R3, R4) Collapse the gate** — replace `doctor-probe.ts:173-187` with a single `if (!usable) { status = 'FAIL'; … }` branch whose message names the resolved executor and carries `detail`. Rewrite the per-executor log line at `:170` from `auth=… probe=…` to a usability-keyed form.
6. [ ] **(R5) Confirm the untouched surfaces still pass** — run `bun test packages/app/tests/workflow/actions/doctor-probe.test.ts --test-name-pattern 'resultFile|boundary|spurBin|divergence'` before rewriting anything else; these five tests must stay green without edits. A failure here means the diff escaped its scope.
7. [ ] **(R6) Reconcile the doctor-probe tests** — rewrite `:38` (PASS when usable), `:52` (FAIL when a non-relay executor is unusable), `:79` (an omp row with `usable: true` PASSes regardless of any auth-shaped detail), `:214` (unparseable → PASS, usability unknown). Add the R4 test: `usable: false` with doctor exit code 0 writes `FAIL`.
8. [ ] **(R7) Reconcile the agent-service test** — `packages/app/tests/services/agent-service.test.ts:301-344`. Rename off the `--json keeps authenticated` claim, drop the `R16` comment, and invert the closing assertion to `expect(parsed.agents.every((a) => !('authenticated' in a))).toBe(true)`.
9. [ ] **(R8) T3 doc sync in the same commit** — rewrite `plugins/sp/skills/spur-dev/references/cross-cutting.md:188-192` (the `status: usable · auth: no · model: unknown` row shape it cites no longer exists; the guidance that quota is undetectable preflight still holds and stays). Drop `authenticated` from the `--json` shape in `docs/04_DESIGN.md` and `plugins/sp/skills/spur-cli/references/agent.md`.
10. [ ] **(R9) Scope check** — `git diff --stat` must show no file under `~/xprojects/ts-libs`, no `package.json` version change, and no `probeAuth`. Those belong to 0684.
11. [ ] **Verification** — targeted first: `bun test packages/app/tests/workflow/actions/doctor-probe.test.ts` and `bun test packages/app/tests/services/agent-service.test.ts`. Then `bun run autofix && bun run spur-check`. Grep the tree for residual readers: `rg -n "authenticated" packages apps plugins docs` must return only ts-libs type re-exports and history, no live Spur consumer.

### Solution

Collapse `doctor.probe` to usability-only classification and strip the auth signal from every doctor surface.

- `packages/app/src/services/agent-service.ts:2238` — `withoutAuthenticated<T>` strips `authenticated` from a DoctorResult row; both `--json` builders spread it at :499 and :547 so the published field cannot leak through either payload.
- `packages/app/src/workflow/actions/doctor-probe.ts:24-40` — `parseDoctorJson` returns `{usable, resolvedAgent}` with usable defaulting true on parse failure; the auth classifier (`RELAY_FAMILY`, `ENV_MISS_PATTERN`, `AUTH_FAIL_PATTERN`, `ProbeClass`) is deleted; FAIL fires at :152 when the resolved executor reports usable=false or doctor exits non-zero (:128), covering tier-2 executors where `renderDoctor` exits 0. Log line :149 now reads `precheck: <exe>[ (resolved <x>)] usable=<bool>` with no `auth=`/`probe=` tokens.
- `packages/app/tests/workflow/actions/doctor-probe.test.ts:50` — writes FAIL on a usable:false doctor row even though the command exited 0 (B4/0682 R4): this pin locks the added gate; the PASS pin at :36 asserts a usable row (soft probe returns ok); the unparseable-output test at :178 defaults usable=true and does not fail the run.
- `packages/app/tests/services/agent-service.test.ts:303` — 0621 R1/R12 pin renamed for B4/0682 R2: table stays auth-free AND `--json` carries no authenticated field (inverted final assertion).
- Soft-probe contract unchanged in `packages/app/src/workflow/actions/doctor-probe.ts:126-163`: divergence line (:118), splitLaunchCommand-gated probe, status-file write at :160 (`writeFile(normalized, ...)`), and the soft-probe return `ok: true` at :163 keep the recorded-FAIL-not-abort routing intact.

Verification: `bun run format && bun run spur-check` rc=0 (~102s); packages/app edited suites 178 pass / 0 fail; cli agent suite 43 pass / 0 fail; plugins/sp resilience suite 7 pass / 0 fail. Verdict artifact `.spur/run/0682-verdict.json` (PASS). Docs synced same commit (T3): cross-cutting guidance rewritten, surface docs carry no auth claims.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | renderAuth deleted; AuthState import removed from packages/app/src/services/agent-service.ts (rg 'renderAuth\|type AuthState' → no matches in src); renderDoctorDetail emits pinned:/health:/version lines with no auth line. Pin: agent-service.test.ts detail-mode tests assert 'pinned:' and ':health:' (B4/0681) and contain no auth expectation. |
| R2 | MET | Both --json builders spread ...withoutAuthenticated(result) — agent-service.ts:499 and :547, helper at :2238 destructures `authenticated` out of the DoctorResult before emission, so a field living on the published DoctorResult cannot leak through either path. Pin: agent-service.test.ts:303 renames the 0621 R16 assertion to `parsed.agents.every(a => !('authenticated' in a))` (:347); migrate-stubs.test.ts:74 asserts absence for the real CLI main() flow. |
| R3 | MET | doctor-probe.ts drops RELAY_FAMILY, ENV_MISS_PATTERN, AUTH_FAIL_PATTERN, classifyDoctorProbe, ProbeClass and parseDoctorJson's auth/detail reads — file now has a single usability classifier; rg over src finds zero references. Log line 'precheck: <exe> usable=<bool>' at doctor-probe.ts:149. |
| R4 | MET | parseDoctorJson returns {usable, resolvedAgent} defaulting usable=true on absent/unparseable (doctor-probe.ts:24-40 catch → {usable:true,...}); action writes FAIL when !usable (:152-156) with remediation naming `agent doctor <exe> --json` + --vars override, while res.ok stays true. Pin: doctor-probe.test.ts 'writes FAIL on a usable:false doctor row even though the command exited 0 (B4/0682 R4)' asserts status FAIL + status-file FAIL for exit-code 0. |
| R5 | MET | Unchanged by diff inspection: .spur/run boundary check + normalized resultFile write (doctor-probe.ts:110→end writes `${status}\n`), splitLaunchCommand metacharacter rejection test still green, divergence line still emitted when implementAgent !== agent (test 'probes both executors with a divergence line'), return { ok: true } soft probe preserved (:168-171). |
| R6 | MET | doctor-probe.test.ts rewritten to usability keys: PASS-on-usable-row test, FAIL pin above, unparseable-output test renamed 'unparseable doctor output defaults usable=true and does not fail the run (soft probe)' asserting usable=true log line. plugins/sp/tests/task-pipeline-resilience.test.ts:104 rewired to per-agent stub payloads ($3 = executor): omp-dsv4-flash-volc usable=true → PASS without any SOFT/auth line; codex usable=false → FAIL with the new remediation copy; both status files asserted. |
| R7 | MET | agent-service.test.ts:301 test renamed to 'R1/R12 (0621) + B4/0682 R2: no auth column, and --json carries no authenticated field'; final block inverted to assert every agents[] entry lacks the key; table half unchanged (no AUTH header/cell, 7-column alignment pins intact). Suite green: packages/app 178 pass / 0 fail for the two edited suites; full gate rc=0. |
| R8 | MET | plugins/sp/skills/spur-dev/references/cross-cutting.md:185-191 rewritten to describe an auth-free surface ('Feature B4 removed the auth signal from the surface entirely (no column, no authenticated in --json) ... the precheck probe classifies on usability alone'); docs/04_DESIGN.md doctor section carries no auth column/field claims (auth wording limited to liveness-only ADR/0127 framing, updated in 0681); plugins/sp/skills/spur-cli/references/agent.md JSON shape documents no authenticated key. |
| R9 | N/A | Out of scope by task text: isAuthenticated inside @gobing-ai/ts-ai-runner buildResult is sibling task 0684 territory (tag/publish requires operator approval). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — No authentication field appears anywhere in the doctor output | MET |  | Table (07-column layout, no AUTH), detail view, role ladder, and --json all auth-free — agent-service.ts table/detail paths plus :499/:547 spreads; regression pins agent-service.test.ts:303+, migrate-stubs.test.ts:74, doctor CLI suite 43 pass / 0 fail. |
| R7 — Removing the auth signal removes the classifier that existed to neutralize it | MET |  | doctor-probe.ts lost RELAY_FAMILY/env-miss/auth-fail/ProbeClass entirely (deleted ~60 LOC) with usability-only classification substituted; survivor tests prove soft/hard routing still correct via usable flag, including exit-0-but-unusable FAIL pin. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (pipeline verify step — verdict: UNKNOWN)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict UNKNOWN |

### References

- Parent feature: `docs/features/B4_agent-doctor-as-the-routing-inspection-surface-capability-tier-rendering-full-eligible-ladder-auth-removal-and-cached-probes.md` (scenarios R6, R7)
- Design: `docs/design/agent-doctor-inspection-surface.md` §4 (removing the auth signal), §4.1 (why the probe half is split out)
- Siblings: 0681 (rendering — lands first), 0683 (`--probe-health` / cache), 0684 (ts-libs `probeAuth` — depends on this task)
- Prior art: task 0621 (AUTH column removal — this task finishes it), 0487 R2 / 0503 R2 (the classifier's origin), 0608 / feature D6 R4–R5 (`doctor.probe` replacing the shell classifier), 0622 R1 (resolved-executor classification)
- Constitution: T3 (surface + design doc same commit), T10 (removing a field obliges reconciling its fallout in the same commit)
- Surfaces touched: `packages/app/src/services/agent-service.ts`, `packages/app/src/workflow/actions/doctor-probe.ts`, `packages/app/tests/workflow/actions/doctor-probe.test.ts`, `packages/app/tests/services/agent-service.test.ts`, `plugins/sp/skills/spur-dev/references/cross-cutting.md`, `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/agent.md`

### History

- 2026-08-26T20:30:47.758Z todo → wip (system)
- 2026-08-26T20:44:13.299Z wip → testing (system)
- 2026-08-26T20:44:17.602Z testing → done (system)
