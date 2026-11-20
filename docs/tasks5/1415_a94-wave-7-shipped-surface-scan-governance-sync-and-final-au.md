---
schema_version: 1
name: "A94 wave 7: shipped-surface scan, governance sync and final audit"
status: done
template: feature-impl
created_at: 2026-11-20T07:58:05.086Z
updated_at: "2026-11-20T23:15:07.665Z"
feature_id: A94
priority: P1
tags:
  - A94
  - tooling

dependencies: ["1410", "1411", "1412", "1413", "1414"]
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1415. A94 wave 7: shipped-surface scan, governance sync and final audit

### Background

Implements: R13 — Shipped surfaces do not reference repository-only scripts; R15 — Source, packed and standalone proofs precede route retirement.

Shipped skills, rules and references still name repository-only aliases; the feature closes with a scan and source/packed/standalone audit.

Design authority: docs/design/downstream-tooling-absorption.md (consent C1–C10 granted 2026-11-19).

**Refine corrections (2026-11-20)**

- R1 "no shipped file invokes scripts/ or a repo alias" → the shipped set is `apps/cli/package.json` `files`: `config`, `plugins/` (staged minus `tests`, `evals` and `*.test.ts` by the bundle-plugins EXCLUDE), `spur.js`, `README.md`, etc. Current hits (rg 2026-11-20) fall into three kinds:
  - (a) an **executable invocation** in a marker-guarded repo rule (`config/rules/boundary/sp-script-placement.yaml:17-18`);
  - (b) **stale citations** that A94 makes false: `fleet-join/SKILL.md:109` and `spur-cli/references/agent.md:247` (`bun run fleet-e2e --host-probe`, fixed by 1414), `spur-cli/references/builder.md:65` ("`scripts/commands/build-*.ts` are thin forwarders", false after 1410/1411), `config/rules/quality/coverage-gate.yaml:8` (`run-tests.ts --publish-coverage`), `config/rules/structure/test-location.yaml:46` (`emit-migration-sql.test.ts`, moved by 1410);
  - (c) **accurate prose citations** of retained repo-only gates: `plugins/sp/README.md:295,429,445,596`, `flag-glossary.md:26,54`, `cross-cutting.md:33`, `dispatch-surface.md:170`, `builder.md:13` (history).

  → The test fails on (a) unless the rule is allowlisted with a marker guard and reason. It fails on (b): any shipped citation of a path the A94 inventory marks `done`. It allows (c): citations of `retain` entries.
- "Repository-only package alias" → shipped text legitimately says `bun run spur-check` because the bun preset binds `check`/`check-full`/`check-feature` to `spur-check*` (`packages/app/src/services/sdlc-actions.ts:35-37`). → Alias set = root `package.json` script names **minus** the commands that the bun preset map references. It is computed at test time, not hardcoded.
- R3 "help text and spur-cli references in sync" → there is a live parity gate, `plugins/sp/tests/cli-surface-parity.test.ts` (per-noun verb/flag inventories vs the live program, cited in `spur-cli/SKILL.md:131`). It fails as soon as a wave registers a verb without a reference row. → Each wave 1410–1414 must add its rows to `references/{builder,rules,workflows,agent}.md` and `docs/help/cmd_{builder,rule,workflow,agent}.md` in the same commit (cross-task handoff). 1415 audits; it does not author them.
- ADR status → the ADR-130 amendment of 2026-11-19 is already in the working tree (`docs/00_ADR.md:2253`), still worded "design approved". → 1415 updates it to "implemented (1409–1415)". The satellite status changes from "Proposed" to "Implemented", along with the `docs/04_DESIGN.md` index row.
- R2 Superskill note → satellite §2 retains six sp-plugin gates (`validate-commands`, `validate-flag-contracts`, `surface-drift-inventory`, `skill-eval`, `plugin-install-smoke`, `script-contract-check`). The note goes in the A94 inventory `downstreamReason` (must mention Superskill) and in one `plugins/sp/README.md` paragraph.
- Surface list → 1412 amendment 2 adds no new verb (only the `-- <command…>` argv). The R5 list stays at 13 verbs.

### Requirements

- [x] R1. `repo-wide-tests/a94-shipped-surface.test.ts` scans the shipped tree: `config/**` plus `plugins/sp/**` minus the bundle-plugins EXCLUDE (imported from `packages/app/src/builder/bundle-plugins.ts`, not re-declared). It fails on:
  - (a) an executable `bun [run] [../]*scripts/…` or `bun run <repo-alias>` outside `ALLOWLIST: {path, marker, reason}[]`. Each allowlisted file must contain its marker guard (`[ -f scripts/… ] || … exit 0`).
  - (b) a citation of any path whose A94 inventory entry is `disposition: "done"`.

  Repo aliases = root `package.json` scripts minus the bun-preset bindings in `sdlc-actions.ts`. Citations of `retain` entries pass.
- [x] R2. Every A94 inventory `retain` entry in the sp-plugin gate group has a `downstreamReason` naming Superskill (asserted by `a93-script-ownership.test.ts`). `plugins/sp/README.md` has one paragraph:
  - these gates guard Spur's own plugin source;
  - downstream plugin authors use `superskill <skill|command|agent> evaluate` / `superskill install`.
- [x] R3. Docs reach final state:
  - `docs/00_ADR.md` ADR-130 amendment 2026-11-19 marked implemented, with tasks 1409–1415;
  - the satellite status set to Implemented, with a §6 receipt index;
  - the `docs/04_DESIGN.md` row is no longer "Proposed";
  - `harness-surface-governance.md` §2 and `cli-contracts.md` list the 13 verbs, the `builder.dependencyScope` key and the `builder.actions` parallel form;
  - `docs/help/environment_variables.md` lists `SPUR_COVERAGE_DIR`.

  `cli-surface-parity.test.ts` passes.
- [x] R4. Final receipt `.spur/run/1415-receipt.md`. For each of the 13 verbs it runs `--help` (exit 0) from:
  - the source CLI (`bun run apps/cli/src/index.ts`);
  - the packed tarball (`npm pack` in `apps/cli`, extract, `bun package/spur.js`);
  - the standalone binary (`spur builder build-cli` output).

  It also records `bun run spur-check-feature` and `bun run build:all`. No workflow edit, publish or deploy.
- [x] R5. `repo-wide-tests/a94-surface-shape.test.ts` builds the program with `buildProgram` (`apps/cli/src/index.ts:192`). It asserts that each surface below is a registered leaf (`commands.length === 0`) directly under its noun, and that each A94 verb declares no option outside its consented flag set plus `--json`/`--json-envelope`/`--source-root`:
  - `builder bundle-plugins`, `bundle-laya-worker`, `emit-board-types`, `emit-migration-sql`, `check-deps`;
  - `rule check-shims`, `certify-coverage`, `check-coverage-cert`;
  - `workflow eval`, `promote-check`, `promote-evaluate`, `promote-resolve`;
  - `agent doctor-hosts`.
- [x] R6. The A94 inventory has no `pending` entries. `scripts/spur-dev.ts` dispatches only retained entries. Every retired name exits 2 with its replacement (spawn assertion over `RETIRED` keys).

**Out of scope:** authoring per-wave reference rows (each wave owns its own), new verbs, `.github/workflows`, publishing.

### Acceptance Criteria

- [x] AC1 — Shipped surfaces do not reference repository-only scripts (req: R1, R2, R3)
- [x] AC2 — Source, packed and standalone proofs precede route retirement (req: R4, R5, R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-20T08:41:58.815Z

- **Q:** Are prose citations of retained repo gates in shipped plugin docs violations? **A (closed):** no. They are accurate and describe Spur's own plugin. Only invocations and citations of removed (`done`) paths fail.
- **Q:** Is `bun run spur-check` in shipped text a repo alias? **A (closed):** no. It is the bun-preset binding for `check`, so the alias set excludes preset-bound scripts.
- **Q:** Who writes the spur-cli and help rows for the new verbs? **A (closed):** each wave, in its own commit, since the parity gate fails otherwise. 1415 audits.

### Design

**WHAT/WHY.** The closing audit turns A94's promises into durable tripwires:
- nothing shipped points at repo-only tooling;
- every new surface has exactly the consented shape;
- docs and dispositions reach the final state.

**WHERE (frozen).**
- `repo-wide-tests/a94-shipped-surface.test.ts`: new.
  - Walk with `Bun.Glob`.
  - The invocation regex is `/\bbun\s+(?:run\s+)?(?:\.\.\/)*scripts\//` plus `/\bbun run ([\w:-]+)/` checked against the alias set.
  - Citations: for each `done` inventory path `p`, a literal `p` hit fails. The basename alone does not count, to avoid false hits.
  - Initial ALLOWLIST: `config/rules/boundary/sp-script-placement.yaml` (marker `scripts/commands/script-contract-check.ts`, reason "ADR-130 placement gate, SKIPs outside the Spur repo"), plus the 1412 rules if they keep the marker-guarded source-CLI branch.
- `repo-wide-tests/a94-surface-shape.test.ts`: new. Reads `CONSENTED: Record<string, string[]>` from one literal table that mirrors satellite §5 C1–C10 plus amendments.
- Fix stale citations: `builder.md:65`, `coverage-gate.yaml:8`, `test-location.yaml:46` (repoint to the moved paths). `fleet-join`/`agent.md` are verified as fixed by 1414.
- Docs: `docs/00_ADR.md:2253`, satellite, `docs/04_DESIGN.md`, `harness-surface-governance.md` §2, `cli-contracts.md`, `plugins/sp/README.md`.

**Handoff in (precondition).** 1410–1414 are done, each with its inventory entries `done` and its reference/help rows present. If one is missing, 1415 reports it as an upstream defect; it does not silently author it.

**Anti-patterns.**
- No per-file hardcoded hit lists, except ALLOWLIST with reasons.
- Do not weaken `cli-surface-parity.test.ts`.
- Don't scan `tests/`, `evals/` or `CHANGELOG.md` (not shipped, history).
- No edits to A93 records.
- No publish or `.github/workflows` edit.

### Plan

- [x] 1. Write both repo-wide tests first. Confirm they fail on the current stale citations or a missing surface, whichever is still present. (R1, R5)
- [x] 2. Fix the stale citations and add the README Superskill paragraph. Assert inventory `downstreamReason` in `a93-script-ownership.test.ts`. (R1, R2)
- [x] 3. Sync the ADR, satellite, 04 index, governance and cli-contracts docs. Run `cli-surface-parity.test.ts`. (R3)
- [x] 4. Assert the final inventory and dispatcher state: no `pending`, RETIRED spawns exit 2. (R6)
- [x] 5. Final receipt: three-way `--help` proof for the 13 verbs, `bun run spur-check-feature`, `bun run build:all`, `git status --short`. (R4)

### Solution

**WHAT.** Two permanent guards plus the governance close-out: a shipped-surface scan over `config/**` and `plugins/sp/**`, and a surface-shape test that builds the real program and pins all 13 A94 verbs as leaves with only their consented flags.

**WHY.** Retention has a downstream test, so a shipped preset must not send an agent to a repository command — and the consented grammar must survive later edits.

**Change map.**

| Area | Anchor | Change |
| --- | --- | --- |
| shipped-surface guard | repo-wide-tests/a94-shipped-surface.test.ts:1 | script refs, repo aliases, retired-path citations; `EXCLUDE` imported from bundle-plugins |
| surface-shape guard | repo-wide-tests/a94-surface-shape.test.ts:1 | 13 verbs × (leaf, consented flags) via `buildProgram` |
| inventory reasons | docs/reports/A94-script-ownership.json:1 | sp-plugin gates name Superskill (asserted) |
| plugin README | plugins/sp/README.md:432 | repository-only gates paragraph + Superskill handoff |
| ADR | docs/00_ADR.md:2253 | amendment marked implemented 1409–1415 |
| satellite | docs/design/downstream-tooling-absorption.md:4 | `status: implemented` + §6 receipt index |
| design index | docs/04_DESIGN.md:30 | row no longer Proposed |
| governance | docs/design/harness-surface-governance.md:85 | §2 records the 13 verbs, `dependencyScope`, parallel actions |
| CLI contracts | docs/design/cli-contracts.md:18 | same surface recorded |
| shipped data | config/pipeline-budgets.json:10 | re-measure command points at `spur workflow eval` |
| shipped data | config/workflow-candidates.json:3 | promotion routes point at the verbs |
| shipped manifest | config/transition-shims.json:2 | gate named as `spur rule check-shims` |
| shipped rules | config/rules/quality/coverage-gate.yaml:11 | recovery text no longer names a repo alias |
| shipped rules | config/rules/boundary/sp-script-placement.yaml:5 | repo gate named as prose |
| shipped rules | config/rules/boundary/sp-plugin-standalone.yaml:16 | same |
| shipped skills | plugins/sp/skills/fleet-join/SKILL.md:109 | probe named as `spur agent doctor-hosts` |
| shipped skills | plugins/sp/skills/code-implementation/SKILL.md:153 | repo gate named as prose |
| reference | plugins/sp/skills/spur-cli/references/agent.md:248 | probe named as prose |
| reference | plugins/sp/skills/spur-cli/references/builder.md:78 | retirement note no longer executable |
| receipt | .spur/run/1415-receipt.md | 13 verbs × 3 routes, `build:all`, feature-suite result |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | repo-wide-tests/a94-shipped-surface.test.ts:1 — 6 cases over the shipped tree (script refs, aliases, retired citations), EXCLUDE imported from bundle-plugins |
| R2 | MET | plugins/sp/README.md:432 paragraph + inventory reasons asserted (a94-shipped-surface.test.ts, "names Superskill") |
| R3 | MET | docs/00_ADR.md:2253 amendment marked implemented 1409–1415; satellite `status: implemented` + §6 receipt index; docs/04_DESIGN.md:30 row; harness-surface-governance.md §2 and cli-contracts.md list the 13 verbs + `builder.dependencyScope` + the parallel form; environment_variables.md carries `SPUR_COVERAGE_DIR` |
| R4 | MET | .spur/run/1415-receipt.md — 13 verbs × source/packed/binary `--help`, 0 failures; `build:all` exit 0; `spur-check-feature` ran 12,979 tests green (certification refused only by a concurrent writer) |
| R5 | MET | repo-wide-tests/a94-surface-shape.test.ts:1 — 26 cases (13 verbs × leaf + consented flags) |
| R6 | MET | inventory has no `pending` entries (asserted); dispatcher usage + RETIRED exit 2 covered by a93-script-ownership.test.ts |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Shipped surfaces do not reference repository-only scripts (req: R1, R2) | MET | test | `bun test repo-wide-tests/a94-shipped-surface.test.ts` — 6 pass |
| AC2 — Final audit, surface shape and governance sync (req: R3, R4, R5, R6) | MET | command | `bun run gate` exit 0; `.spur/run/1415-receipt.md` (13 verbs × 3 routes, 0 failures) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Satellite §2, §5 (C1–C10 plus amendments 1 and 2), §6.
- Code: `apps/cli/package.json` `files`, `packages/app/src/services/sdlc-actions.ts:35-37`, `apps/cli/src/index.ts:192`, `plugins/sp/tests/cli-surface-parity.test.ts`, `config/rules/boundary/sp-script-placement.yaml:17`.
- Upstream: 1410–1414 (all must be done).

### History

- 2026-11-20T23:15:04.909Z todo → testing (system)
- 2026-11-20T23:15:07.417Z testing → done (system)

