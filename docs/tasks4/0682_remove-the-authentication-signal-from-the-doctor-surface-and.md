---
schema_version: 1
name: "Remove the authentication signal from the doctor surface and collapse the doctor.probe classifier that existed to neutralize it"
status: done
template: feature-impl
created_at: 2026-08-26T18:52:01.244Z
updated_at: "2026-08-28T06:24:11.783Z"
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

- `packages/app/src/services/agent-service.ts:2482` — `withoutAuthenticated<T>` strips `authenticated` from a DoctorResult row; both `--json` builders spread it (role branch `:571`, `renderDoctor` `:642`) so the published field cannot leak through either payload.
- `packages/app/src/workflow/actions/doctor-probe.ts:26` — `parseDoctorJson` returns `{usable, resolvedAgent}` with `usable` defaulting true on parse failure; the auth classifier (`RELAY_FAMILY`, `ENV_MISS_PATTERN`, `AUTH_FAIL_PATTERN`, `ProbeClass`) is deleted; FAIL fires when the resolved executor reports `usable=false` or doctor exits non-zero, covering tier-2 executors where `renderDoctor` exits 0. Log line `:148` now reads `precheck: <exe>[ (resolved <x>)] usable=<bool>` with no `auth=`/`probe=` tokens.
- `packages/app/tests/workflow/actions/doctor-probe.test.ts:50` — writes FAIL on a `usable:false` doctor row even though the command exited 0 (B4/0682 R4): this pin locks the added gate; the PASS pin at `:36` asserts a usable row (soft probe returns ok); the unparseable-output test at `:178` defaults `usable=true` and does not fail the run.
- `packages/app/tests/services/agent-service.test.ts:303` — 0621 R1/R12 pin renamed for B4/0682 R2: the table stays auth-free AND `--json` carries no `authenticated` field (assertion inverted at `:338-347`).
- Soft-probe contract unchanged in `packages/app/src/workflow/actions/doctor-probe.ts`: the `.spur/run/` boundary check (`:62-83`), the `splitLaunchCommand`-gated probe (`:87`), the divergence line for `implementAgent !== agent`, the status-file write at `:160`, and the soft-probe return `ok: true` at `:163` keep the recorded-FAIL-not-abort routing intact.

Verification: `bun run format && bun run spur-check` rc=0 (~102 s); packages/app edited suites 178 pass / 0 fail; cli agent suite 43 pass / 0 fail; plugins/sp resilience suite 7 pass / 0 fail. Verdict artifact `.spur/run/0682-verdict.json` (PASS). Docs synced same commit (T3): cross-cutting guidance rewritten, surface docs carry no auth claims.

> Line anchors re-resolved in the 2026-08-26 re-audit; the originals (`:499`/`:547`/`:2238`, and the `doctor-probe.ts` ranges) predate siblings 0683/0684 landing in the same files.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | renderAuth and the AuthState import are gone from src — `grep -rn 'renderAuth\|AuthState' packages/app/src apps/cli/src` returns zero matches this run. renderDoctorDetail (agent-service.ts:2578) emits status/pinned/health/version lines with no auth line. |
| R2 | MET | Both --json builders spread `...withoutAuthenticated(result)` — role branch agent-service.ts:571 and renderDoctor agent-service.ts:642; the helper at agent-service.ts:2482 destructures `authenticated` off the DoctorResult before emission, so a field living on the published DoctorResult cannot leak through either path. Pins: agent-service.test.ts:303 ('R1/R12 (0621) + B4/0682 R2: no auth column, and --json carries no authenticated field'), assertion at :338-347; apps/cli/tests/commands/migrate-stubs.test.ts asserts absence through the real CLI main() flow. Live check this run: `agent doctor --json` → no entry has an `authenticated` key. |
| R3 | MET | doctor-probe.ts no longer defines RELAY_FAMILY, ENV_MISS_PATTERN, AUTH_FAIL_PATTERN, classifyDoctorProbe or ProbeClass — `grep -rn` over packages/app/src + apps/cli/src returns zero matches this run. parseDoctorJson (doctor-probe.ts:26) returns `{usable, resolvedAgent}` only; the log line at :148 reads `precheck: <exe>[ (resolved <x>)] usable=<bool>` with no auth=/probe= token. |
| R4 | MET | parseDoctorJson (doctor-probe.ts:26) reads `.agents[0].usable` and defaults to true on absent/unparseable input; the action writes FAIL when !usable, ahead of the status-file write at :160, while the soft-probe return stays `ok: true` (:163). Pin: doctor-probe.test.ts:50 'writes FAIL on a usable:false doctor row even though the command exited 0 (B4/0682 R4)'. |
| R5 | MET | Unchanged by diff inspection and still pinned: the .spur/run boundary check (doctor-probe.ts:62-83, tests :127 and :137), splitLaunchCommand metacharacter rejection (:87, tests :150 and :168), the divergence line for implementAgent !== agent (test :70), the status-file write at :160, and the soft-probe `return { ok: true, … }` at :163. Only the classification input changed. |
| R6 | MET | doctor-probe.test.ts rewritten to usability keys rather than deleted: PASS-on-usable-row (:36), the R4 FAIL pin (:50), non-zero-exit FAIL (:111), and 'unparseable doctor output defaults usable=true and does not fail the run (soft probe)' (:178). plugins/sp/tests/task-pipeline-resilience.test.ts rewired to per-agent stub payloads (usable=true → PASS with no SOFT/auth line; usable=false → FAIL with the new remediation copy), both status files asserted. |
| R7 | MET | agent-service.test.ts:303 renamed to 'R1/R12 (0621) + B4/0682 R2: no auth column, and --json carries no authenticated field'; the R16 assertion is inverted at :338-347 to require every agents[] entry to lack the key, with the table half (no AUTH header/cell, column alignment) unchanged. Test kept, not deleted. Suites green this run: 233 pass / 0 fail across the three B4 suites. |
| R8 | MET | plugins/sp/skills/spur-dev/references/cross-cutting.md rewritten to describe an auth-free surface (no column, no `authenticated` in --json; the precheck probe classifies on usability alone); docs/04_DESIGN.md § `spur agent doctor` states auth is neither table column nor surfaced shape (liveness-only gate, ADR/0127); plugins/sp/skills/spur-cli/references/agent.md documents a --json shape with no authenticated key. |
| R9 | N/A | Out of scope by task text — isAuthenticated inside @gobing-ai/ts-ai-runner buildResult is sibling task 0684's territory. 0684 landed it (probeAuth option, published 0.4.43), so the deferral is discharged, not outstanding. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — No authentication field appears anywhere in the doctor output | MET | test | Table (07-column layout, no AUTH), detail view, role ladder, and --json all auth-free — agent-service.ts table/detail paths plus :499/:547 spreads; regression pins agent-service.test.ts:303+, migrate-stubs.test.ts:74, doctor CLI suite 43 pass / 0 fail. |
| R7 — Removing the auth signal removes the classifier that existed to neutralize it | MET | test | doctor-probe.ts lost RELAY_FAMILY/env-miss/auth-fail/ProbeClass entirely (deleted ~60 LOC) with usability-only classification substituted; survivor tests prove soft/hard routing still correct via usable flag, including exit-0-but-unusable FAIL pin. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECUA findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P3 | Correctness (record) | `docs/tasks4/0682_*.md` § Review | Corrected in the 2026-08-26 re-audit: this section previously read `verdict: UNKNOWN` while `.spur/run/0682-verdict.json` carried `PASS`. The bare-Review backfill wrote a placeholder verdict the artifact contradicted, so the durable task record misreported its own outcome. |
| P4 | Security | `packages/app/src/workflow/actions/doctor-probe.ts:62-87` | No regression: the `.spur/run/` boundary check and `splitLaunchCommand` metacharacter rejection are untouched by the classifier collapse; removing the auth read removes a credential-file access rather than adding one. |
| P4 | Correctness | `packages/app/src/workflow/actions/doctor-probe.ts:26-40`, `:144-163` | Usability-only classification closes the tier-2 hole: `renderDoctor` exits non-zero only for `!usable && tier === 1`, so a missing tier-2 executor would have PASSed silently without the `usable === false` gate. Soft-probe contract (`ok: true`) preserved. |
| P4 | Architecture | `packages/app/src/services/agent-service.ts:2482` | `withoutAuthenticated` is applied at both `--json` emission sites (`:571`, `:642`) rather than at one, so a future third payload path is the only way the field could return — an acceptable seam for a two-site surface. |
| P4 | Scope | — | No P1–P2 findings. Deletion-only diff plus reconciled tests (T10 honored: the three auth-keyed tests were rewritten as usability assertions, not deleted to reach green). |
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
