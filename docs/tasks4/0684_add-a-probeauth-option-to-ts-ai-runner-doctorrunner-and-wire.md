---
schema_version: 1
name: "Add a probeAuth option to ts-ai-runner DoctorRunner and wire Spur to stop spawning per-executor auth probes"
status: done
template: feature-impl
created_at: 2026-08-26T18:52:01.284Z
updated_at: "2026-08-26T22:32:02.916Z"
feature_id: B4
priority: P2
tags: ["ts-libs", "agent", "doctor", "performance"]
dependencies: ["0682"]
---

## 0684. Add a probeAuth option to ts-ai-runner DoctorRunner and wire Spur to stop spawning per-executor auth probes

### Background

`spur agent doctor` spends ~4.6 s of its 6.20 s wall clock on authentication probes — 74%, for a signal task 0621 already deleted from the table as untrustworthy and that `plugins/sp/skills/spur-dev/references/cross-cutting.md:188-192` instructs operators not to read.

`DoctorRunner.buildResult` calls `isAuthenticated(canonical, …)` once **per executor row** (`~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts:212-226`). With nine `omp` executors in the global config that is nine identical `omp` auth probes, plus codex ×2, grok, and agy ×2. For `omp`/`pi` the probe falls through to `probeAuthOutput` (`~/xprojects/ts-libs/packages/ai-runner/src/agents/auth-shims.ts:109`, `:167`), a subprocess, unless `GOOGLE_API_KEY`/`ANTHROPIC_API_KEY` is non-empty.

Measured 2026-08-26 at HEAD `212972e74`: `spur --version` 0.28 s (boot floor), `spur agent list` 1.62 s (detection only), `spur agent doctor` 6.20 s.

`buildResult` lives in published `@gobing-ai/ts-ai-runner@0.4.42`, not this repo, so sibling task 0682 — which removed the field from Spur's surface — could not stop the subprocess. This task closes that half.

**Release mechanics are not a manual publish, and the version is family-wide.** `~/xprojects/ts-libs/packages/ai-runner/package.json:47` disables `npm publish` outright: releases go through GitHub Actions Trusted Publishing, triggered by pushing a tag `@gobing-ai/ts-ai-runner-v<version>`. `spur builder bump-ver` / `drop-tags` are the version-and-tag plumbing (ADR-051). All eight `ts-*` packages are currently lockstepped at `0.4.42`, and Spur pins them in two places that must move together: the `workspaces.catalog` ranges at root `package.json:31-39` and the root `dependencies` pins at `:96-103`. `packages/app/package.json:23` consumes `@gobing-ai/ts-ai-runner` as `catalog:` and needs no edit. Whether the release bumps only ai-runner or the whole family is settled in `## Q&A`.

Design: `docs/design/agent-doctor-inspection-surface.md` §4.1.

### Requirements

- [x] R1. `DoctorRunnerOptions` in `@gobing-ai/ts-ai-runner` (`~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts:61-80`) gains `probeAuth?: boolean`, **defaulting to `true`** so existing consumers are unaffected. When `false`, `buildResult` (`:212-226`) yields `authenticated: 'unknown'` without calling `isAuthenticated` — no subprocess, no credential-file read.

- [x] R2. `'unknown'` is the only correct false-path value. `buildResult`'s existing not-installed branch yields `'unauthenticated'`, which is a *claim*; a suppressed probe has made no claim at all, and `AuthState` already carries `'unknown'` for exactly that case (`doctor-runner.test.ts:154-165` pins the meaning). Never return `'unauthenticated'` when the probe was skipped.

- [x] R3. Covered by ts-libs tests: (a) `probeAuth: false` invokes no auth probe — assert on an injected `runner`/`fileSystem` spy recording zero calls, not on timing; (b) the same run still reports `usable` correctly, since `usable` is liveness-only and never consulted auth; (c) the default path still probes, pinning backward compatibility.

- [x] R4. ts-ai-runner is released and the Spur dependency bumped. Release is tag-driven Trusted Publishing (`packages/ai-runner/package.json:47` disables manual publish); the Spur side edits the `workspaces.catalog` range at root `package.json:31-39` and the root `dependencies` pin at `:96-103`, then `bun update`. Scope of the version bump (ai-runner only vs. the lockstepped family) per `## Q&A` Q1.

- [x] R5. **All three** `DoctorRunner` constructions in `agent-service.ts` pass `probeAuth: false`, not the two the original scope named: the `doctor` path at `:445`, the public `resolve()` path at `:411`, and the **run-dispatch** path at `:761`. The third feeds `resolveAgent → checkUsable → doctorRunner.runOne` (`agent-service.ts:1857-1871`), so every `spur agent run` pays an auth probe today — the most latency-sensitive of the three, and the one the original scope missed.

- [x] R6. Measurable outcome: `spur agent doctor --force-refresh` on the 15-executor config drops from ~6.2 s to approximately the `spur agent list` floor (~1.6 s). `--force-refresh` is mandatory for the measurement so sibling task 0683's detection cache cannot flatter the number. Record before/after timings, the command used, and the resolved `@gobing-ai/ts-ai-runner` version in the task's evidence.

- [x] R7. The `dependencies: ["0682"]` frontmatter edge is the ordering contract; the pre-flight that proves it held is `rg -n "authenticated" packages apps plugins` returning no live Spur consumer before implementation starts.

- [x] R8. No credential source is reinstated anywhere: not provider API calls, not local agent config files. `isAuthenticated` itself stays in ts-ai-runner for other consumers; only Spur's doctor path opts out.

- [x] R9. No `bun link` in the landed commit. A temporary link is acceptable while validating the unreleased fix locally, but the tree that lands must resolve a published version (AGENTS.md: released `@gobing-ai/ts-*` by semver; `bun link` only while validating).

- [x] R10. Same-commit doc sync (T3): if `docs/04_DESIGN.md` or `plugins/sp/skills/spur-cli/references/agent.md` describes the doctor's auth probing behavior or its cost, update it; otherwise record explicitly in `## Solution` that no doc surface described it.

### Acceptance Criteria

Covers these feature B4 scenarios (titles are the traceability keys — byte-identical to `docs/features/B4_*.md`):

- [x] R8 — The doctor path spawns no authentication probe

### Q&A

**Q1. Does the release bump only `ts-ai-runner`, or the whole lockstepped family?**
**Closed — the whole family, to `0.4.43`.** All eight `~/xprojects/ts-libs/packages/*` are currently
at `0.4.42`, and Spur pins all eight in lockstep in both `workspaces.catalog` (root
`package.json:31-39`) and root `dependencies` (`:96-103`). Breaking that lockstep for a one-option
additive change buys nothing and makes every future "which versions are we on?" question harder to
answer. The change itself is confined to ai-runner; only the version number moves elsewhere.
Rejected: bumping ai-runner alone — the divergence would have to be explained in every subsequent
bump.

**Q2. How is "no auth probe was invoked" asserted without measuring time?**
**Closed — spy on the injected collaborators.** `isAuthenticated` reaches the outside world through
exactly two seams the runner already accepts: `options.runner` (subprocess probes, `auth-shims.ts:167`)
and `options.fileSystem` (credential-file reads). A ts-libs test constructs `DoctorRunner` with
recording stubs for both and asserts zero calls under `probeAuth: false`, and non-zero under the
default. A timing assertion would be flaky and would not prove the subprocess was absent.

**Q3. Why a runner option rather than a Spur-side workaround?** *(carried from the original design)*
**Closed — `probeAuth?: boolean`.** Three options were weighed; the table in `## Design` records the
verdicts. AGENTS.md is explicit: prefer fixing ts-libs facades over Spur workarounds. The option is
also the honest expression of what Spur wants — "do not probe auth" — rather than a trick that makes
probing cheap.

**Q4. What value does the suppressed path report?**
**Closed — `'unknown'`.** Not `'unauthenticated'`. `AuthState` is tri-state precisely so "no probe
ran" is distinguishable from "the probe said no"; `doctor-runner.test.ts:154-165` already pins that
meaning for the no-auth-verb case. Reporting `'unauthenticated'` would make the suppression
*fabricate* a negative claim — the same dishonesty task 0682 removed the field for.

**Q5. Why is this sequenced last?**
**Closed — cross-repo release, and performance-only value.** It is the only task in feature B4 that
needs a publish plus a dependency bump, and the only one whose value is purely latency. Sequencing it
behind the Spur-side work means every correctness fix ships without waiting on a release. It must
follow 0682 so no Spur consumer reads `authenticated` when it becomes a constant — recorded as a
`dependencies: ["0682"]` frontmatter edge (`spur task deps`), not as prose, so the batch topo-sort
enforces it.

**Deferred:** nothing. No open decision blocks implementation.

### Design

**WHAT:** One boolean option on a published facade, plus a family release, a dependency bump, and three call-site changes.

**WHERE (primary targets):**

| Repo / file | Change |
| --- | --- |
| `~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts:61-80`, `:96-106`, `:212-226` | `probeAuth?: boolean` option, field, and the `buildResult` branch |
| `~/xprojects/ts-libs/packages/ai-runner/tests/doctor-runner.test.ts` | Q2 spy tests: suppressed path, default path, `usable` unaffected |
| `~/xprojects/ts-libs` (all 8 packages) | version `0.4.42` → `0.4.43`; tag-driven Trusted Publishing |
| `package.json:31-39`, `:96-103` | catalog ranges + root pins → `0.4.43`; then `bun update` |
| `packages/app/src/services/agent-service.ts:411`, `:445`, `:761` | pass `probeAuth: false` |

**Frozen names:**

```ts
// DoctorRunnerOptions — one new field, defaulting true
/** Probe agent authentication during buildResult. Default `true`.
 *  `false` yields `authenticated: 'unknown'` with no subprocess and no credential-file read. */
probeAuth?: boolean;

// constructor, alongside the existing `?? ` defaults at doctor-runner.ts:96-106
this.probeAuth = options.probeAuth ?? true;
```

No new type, no new export, no Spur-side helper. Every other change in this task is a version number or a two-word call-site edit.

**Precedence / algorithm (`buildResult`, `doctor-runner.ts:212-226`):**

1. `probeAuth === false` → `authenticated = 'unknown'`. Evaluated **before** the installed/canonical check, so no probe path is reachable.
2. Otherwise the existing branch stands: `detected.installed && canonical !== null` → `await isAuthenticated(...)`, else `'unauthenticated'`.
3. `usable` is untouched in every case — it is `detected.installed && detected.version !== null` and has never consulted auth.

**WHY a runner option rather than a Spur-side workaround.** Three ways to stop the subprocess were weighed:

| Option | Verdict |
| --- | --- |
| Stop consuming `authenticated` in Spur only | Rejected — fixes the honesty half, none of the 4.6 s; the probe still runs. (This is task 0682, and it is correct on its own — but it is not this fix.) |
| Inject a stub `AiRunner` so `probeAuthOutput` returns instantly | Rejected — a Spur workaround for a facade defect, and a fragile one: it depends on the runner's internal call shape and would break silently on any ts-ai-runner refactor |
| Add `probeAuth?: boolean` to `DoctorRunnerOptions` | **Accepted** |

AGENTS.md is explicit: prefer fixing ts-libs facades over Spur workarounds. The option is also the honest expression of what Spur wants — "do not probe auth" — rather than a trick that makes probing cheap.

**WHY default `true`:** other ts-ai-runner consumers may rely on the auth field. Defaulting to the current behavior makes this a purely additive release, and `doctor-runner.test.ts:81`'s `toHaveProperty('authenticated')` stays true either way.

**WHY `'unknown'` and not `'unauthenticated'`:** a suppressed probe has made no claim. `AuthState` is tri-state for exactly this; returning `'unauthenticated'` would fabricate a negative — the dishonesty 0682 removed the field over. (Q4.)

**WHY this is sequenced last:** it is the only task in the feature requiring a cross-repo release, and the only one whose value is purely performance. Sequencing it behind the Spur-side work means every correctness fix ships without waiting on a publish, and the detection cache from task 0683 already bounds repeat interactive cost in the interim.

**Anti-patterns — do not implement:**

- Do not stub, monkey-patch, or subclass `AiRunner`/`DoctorRunner` inside Spur to make probing cheap. The rejected-options table exists so this is not re-litigated at implementation time.
- Do not leave `bun link` in the landed tree (R9). Validate locally with a link if useful, then land against the published version.
- Do not change `usable`, `tier`, or any other `DoctorResult` field.
- Do not remove `isAuthenticated` or the auth shims from ts-ai-runner — other consumers keep them (R8).
- Do not reintroduce a credential source anywhere: no provider API call, no local agent config read.
- Do not measure R6 without `--force-refresh` — task 0683's cache would flatter the number and the evidence would be worthless.
- Do not break the ts-libs version lockstep by bumping ai-runner alone (Q1).

**Cross-task handoff:**

- **Assumes from 0682:** zero Spur readers of `authenticated`. R7 makes this a pre-flight check, not an assumption — `rg -n "authenticated" packages apps plugins` must show no live consumer before this task starts.
- **Assumes from 0683:** `--force-refresh` exists, and is required for the R6 measurement. If 0683 has not landed, take the measurement with the cache file deleted and say so in the evidence.
- **Leaves for dependents:** none. This is the last task in feature B4.

### Plan

1. [x] **(R7) Pre-flight the dependency** — confirm task 0682 has landed: `rg -n "authenticated" packages apps plugins` returns no live Spur consumer (ts-libs type re-exports and history text are fine). If it has not, stop; this task is not startable.
2. [x] **Baseline capture** — with no cache file present, time `bun run apps/cli/src/index.ts agent doctor` and `… agent doctor --force-refresh` three times each against the 15-executor global config. Record the resolved `@gobing-ai/ts-ai-runner` version alongside the timings; that pairing is the evidence R6 asks for.
3. [x] **(R1, R2) Add the option in ts-libs** — `~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts`: `probeAuth?: boolean` in `DoctorRunnerOptions` (`:61-80`) with the doc comment from `## Design`; `private readonly probeAuth: boolean` + `this.probeAuth = options.probeAuth ?? true` in the constructor (`:96-106`); the short-circuit branch in `buildResult` (`:212-226`) yielding `'unknown'` **before** the installed/canonical check.
4. [x] **(R3, Q2) ts-libs tests** — in `~/xprojects/ts-libs/packages/ai-runner/tests/doctor-runner.test.ts`: (a) `probeAuth: false` with recording `runner` and `fileSystem` stubs asserts zero calls to both and `authenticated === 'unknown'`; (b) the same construction still reports `usable: true` for an installed, versioned agent; (c) the default construction still probes (one recorded call). Run `bun run check` in `packages/ai-runner`.
5. [x] **(R9) Validate unreleased, locally** — `bun link` ts-ai-runner into Spur, rebuild, and confirm `spur agent doctor --force-refresh` drops to roughly the `agent list` floor. This is a throwaway step; nothing from it lands.
6. [x] **(R4, Q1) Release the family** — bump all eight `~/xprojects/ts-libs/packages/*` from `0.4.42` to `0.4.43` via `spur builder bump-ver`, push the tag `@gobing-ai/ts-ai-runner-v0.4.43` (Trusted Publishing; manual `npm publish` is disabled at `packages/ai-runner/package.json:47`), and wait for the GitHub Actions release to complete before continuing.
7. [x] **(R4, R9) Bump Spur** — `workspaces.catalog` ranges at root `package.json:31-39` and root `dependencies` pins at `:96-103` → `0.4.43`; `bun update`; remove the link from step 5 and confirm `bun pm ls | rg ts-ai-runner` resolves the published `0.4.43`.
8. [x] **(R5) Pass `probeAuth: false` at all three call sites** — `packages/app/src/services/agent-service.ts:411` (public `resolve()`), `:445` (`doctor`), `:761` (run dispatch → `resolveAgent` → `checkUsable` → `runOne`). Add a Spur-side test asserting the doctor path constructs its runner with `probeAuth: false`.
9. [x] **(R8) Scope check** — `git diff` in both repos shows no new credential read, no provider API call, and `isAuthenticated` still exported from ts-ai-runner for other consumers.
10. [x] **(R6) Measure and record** — re-run step 2's `--force-refresh` timings (mandatory: 0683's cache would otherwise flatter the number) and paste before/after into `## Solution` with the command, the executor count, and the resolved ts-ai-runner version on both sides. If the drop is materially short of the ~1.6 s `agent list` floor, say so plainly and name the residual cost rather than rounding the claim.
11. [x] **(R10) T3 doc sync** — update any `docs/04_DESIGN.md` or `plugins/sp/skills/spur-cli/references/agent.md` text describing doctor auth probing or its cost; if none exists, record that explicitly in `## Solution` rather than leaving the obligation ambiguous.
12. [x] **Verification** — ts-libs: `bun run check` in `packages/ai-runner`. Spur: targeted `bun test packages/app/tests/services/agent-service.test.ts` first, then `bun run autofix && bun run spur-check`, then `bun run build`.

### Solution

Two-repo change per Q1 (full-family lockstep release).

**ts-libs (`~/xprojects/ts-libs`, commit 394ae67):**

- R1/R2: `DoctorRunnerOptions.probeAuth?: boolean` (default `true`); ctor assigns `?? true`; `buildResult` yields `'unknown'` without calling `isAuthenticated` when false (claim-vs-unknown comment inline). Not-installed branch still claims `'unauthenticated'`.
- R3: pins appended to `packages/ai-runner/tests/doctor-runner.test.ts` ("DoctorRunner probeAuth option (0684 R1-R3)"): probeAuth:false → `'unknown'`, zero non-`--version` executor calls, `usable:true` preserved; default path → not-unknown + ≥1 auth call. Package suite 183 pass; family monorepo suite 1980 pass / 0 fail.
- R4: all eight packages bumped 0.4.42→0.4.43 incl. root `package.json`; released via aggregate Trusted-Publishing tag `@gobing-ai/ts-libs-v0.4.43` (workflow `publish.yml` triggers on `@gobing-ai/ts-libs-v*`; per-package tags are traceability-only). Publish run 33018946083 SUCCESS; npm confirms `0.4.43` for ai-runner + family.

- **doctor path** passes `probeAuth: false` — packages/app/src/services/agent-service.ts:418
- **resolve/executors path** passes `probeAuth: false` — packages/app/src/services/agent-service.ts:494
- **run-dispatch path** passes `probeAuth: false` — packages/app/src/services/agent-service.ts:878
- R5: three constructions in `packages/app/src/services/agent-service.ts` (:418 doctor, :494 resolve/executors, :878 run-dispatch) now pass `probeAuth: false`.
- deps bump — root `package.json` catalog + dependencies pins moved 0.4.42→0.4.43; `bun install` resolves published artifacts (`bun pm ls`: `@gobing-ai/ts-ai-runner@0.4.43`). One-shot install instead of separate update; same resolution.
- R6: `bun apps/cli/src/index.ts agent doctor --force-refresh` (bundled CLI stale; source entrypoint per repo rule): **before 6.2 s → after 1.03 s**, at/below the `spur agent list` floor measured at ~1.0 s on this config. Resolved version `0.4.43`. Cache (0683) deliberately bypassed via flag.
- R7: preflight `rg -n "authenticated" packages apps plugins --type ts` — only prose comments, the eval-SKIPPED note, and 0682's `withoutAuthenticated` strip remain; no live consumer of a doctor auth claim (verified again post-implementation).
- R8: no credential source reinstated anywhere; ts-libs keeps `isAuthenticated` for other consumers; only Spur's doctor path opts out.
- R9: landed tree resolves published versions only — temporary source symlink used during measurement was removed before `bun install`; `bun pm ls` shows registry artifact.
- R10 (T3): `docs/04_DESIGN.md` precheck-auth-gate sentence updated (doctor runs `probeAuth:false`, so `authenticated` is always `unknown` and FAIL rests on exit status). `plugins/sp/skills/spur-cli/references/agent.md` contains no description of auth probing behavior or cost — recorded here as the conditional's explicit no-op arm.

Doctor health surface no longer spawns per-executor auth probes on any path (list / resolve / run-dispatch); warm latency target met with headroom (1.03 s vs ~6.2 s baseline). CLI doctor JSON shape unchanged; `authenticated` reports `unknown` under the new default wiring.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | ts-libs commit 394ae67: DoctorRunnerOptions.probeAuth (default true) + ctor '?? true' + buildResult short-circuit to 'unknown' before installed/canonical check |
| R2 | MET | suppressed path yields 'unknown', never 'unauthenticated'; pinned by doctor-runner.test.ts probeAuth describe block (claim-vs-unknown comment inline) |
| R3 | MET | packages/ai-runner/tests/doctor-runner.test.ts: probeAuth:false -> zero non---version executor calls + usable:true; default path -> auth call present; package suite 183 pass, monorepo 1980 pass / 0 fail, tsc clean |
| R4 | MET | aggregate tag @gobing-ai/ts-libs-v0.4.43 -> Publish run 33018946083 SUCCESS; npm serves 0.4.43 for all eight packages; Spur root package.json catalog+deps moved to 0.4.43 via bun install (lockfile refreshed) |
| R5 | MET | agent-service.ts:418/:494/:878 all pass probeAuth:false (rg 'new DoctorRunner' shows exactly three non-test constructions) |
| R6 | MET | 'bun apps/cli/src/index.ts agent doctor --force-refresh': before 6.2s -> after 1.03s with @gobing-ai/ts-ai-runner@0.4.43 resolved (bun pm ls); agent list floor measured ~1.0s on same config |
| R7 | MET | rg authenticated packages apps plugins --type ts: only prose comments, eval-SKIPPED note, and 0682 withoutAuthenticated strip remain; re-run post-implementation with identical result |
| R8 | MET | no new credential read or provider call in either repo; isAuthenticated untouched and still exported from ts-ai-runner for other consumers |
| R9 | MET | temporary source symlink removed pre-install; bun pm ls resolves registry artifact ts-ai-runner@0.4.43 in landed tree; no bun link remains |
| R10 | MET | docs/04_DESIGN.md precheck-auth-gate sentence updated (probeAuth:false makes authenticated always unknown; FAIL rests on exit status); spur-cli/agent.md has no auth-probe description - explicit no-op arm recorded in Solution |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-R8 | MET |  | doctor path spawns no authentication probe on any of the three constructions under default wiring; verified by zero non---version executor calls under probeAuth:false pin and by construction-site inspection agent-service.ts:418/:494/:878 |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | ts-libs ai-runner suite | — | 183 tests pass incl. 3 new pins; tsc --noEmit clean after strictness fix |
| P4 | ts-libs monorepo suite | — | 1980 tests / 172 files, 0 fail |
| P4 | spur app suite | — | packages/app tests/services/agent-service.test.ts 177 pass / 0 fail |
| P4 | full spur-check gate | — | bun run format && bun run spur-check green: 6498 tests / 349 files, coverage thresholds met, link/shim/script-contract checks pass |
| P4 | publish verification | — | npm view returns 0.4.43 for ai-runner and family; runtime smoke uses published artifact |
| P4 | cli surface parity | — | no CLI flags changed; doctor JSON shape unchanged except authenticated now reports unknown under suppressed probe |

### References

- Parent feature: `docs/features/B4_agent-doctor-as-the-routing-inspection-surface-capability-tier-rendering-full-eligible-ladder-auth-removal-and-cached-probes.md` (scenario R8)
- Design: `docs/design/agent-doctor-inspection-surface.md` §4.1 (where the probe suppression lives — the one cross-repo hop)
- **Depends on:** task 0682 (auth field removal from Spur's surface) — R7 pre-flight
- Siblings: 0681 (rendering), 0683 (`--probe-health` / detection cache — supplies the `--force-refresh` the R6 measurement requires)
- ts-libs surfaces: `~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts:61-80` (options), `:96-106` (constructor), `:212-226` (`buildResult`); `~/xprojects/ts-libs/packages/ai-runner/src/agents/auth-shims.ts:93` (`isAuthenticated`), `:167` (`probeAuthOutput`); `~/xprojects/ts-libs/packages/ai-runner/tests/doctor-runner.test.ts:81`, `:154-165`
- Release: `~/xprojects/ts-libs/packages/ai-runner/package.json:47` (manual publish disabled — tag-driven Trusted Publishing); `spur builder bump-ver` / `drop-tags` (ADR-051)
- Spur surfaces: `packages/app/src/services/agent-service.ts:411`, `:445`, `:761`, `:1857-1871` (`checkUsable`); root `package.json:31-39` (catalog), `:96-103` (pins); `packages/app/package.json:23` (`catalog:` consumer, no edit)
- AGENTS.md contracts: prefer fixing ts-libs facades over Spur workarounds; released `@gobing-ai/ts-*` by semver, `bun link` only while validating

### History

- 2026-08-26T22:31:36.138Z todo → wip (system)
- 2026-08-26T22:31:58.282Z wip → testing (system)
- 2026-08-26T22:32:02.916Z testing → done (system)
