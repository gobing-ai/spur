---
schema_version: 1
name: "Align plugins/sp scripts to the superskill entrypoint contract and record the ADR"
status: todo
template: feature-impl
created_at: 2026-08-19T00:06:00.238Z
updated_at: "2026-08-19T00:17:14.588Z"
feature_id: I
ac_numbering: task-local
---

## 0600. Align plugins/sp scripts to the superskill entrypoint contract and record the ADR

### Background
**Blocked on a superskill release** carrying the `script convert` Bun-globals fix (superskill task
**0121** under feature H1). Do not start the twin build until that CLI ships; step 1 below is
independent and may proceed earlier.

#### What's wrong today
`plugins/sp` ships 14 scripts to ten install targets. None of them can run on a target without Bun,
and the skill docs tell agents to invoke them by repo-relative path — the superskill guide's #1
anti-pattern. Verified 2026-08-18 against superskill `752d839` (v0.3.16).

| Defect | Evidence | Confidence |
| --- | --- | --- |
| **No portable twins** | `find plugins/sp/scripts -name '*.mjs'` → **0** of 14 scripts | HIGH (ran it) |
| **16 anti-pattern call sites** | `bun plugins/sp/scripts/…` across 8 shipped files: `skills/dogfood-testing/SKILL.md` (4), `skills/daily-summary/SKILL.md` (3), `skills/spur-dev/references/execution-batch.md` (3), `README.md` (2), `commands/dev-daily.md`, `commands/dev-history-load.md`, `agents/super-planner.md`, `skills/dogfood-testing/references/report-template.md` (1 each) | HIGH (exact count) |
| **House style codifies it** | `skills/pr-reviewing/SKILL.md:136` — *"Installed targets resolve the staged TypeScript source and execute it with Bun, matching the rest of `plugins/sp/scripts`"*. It uses the correct `$(superskill script path sp …)` form but runs a `.ts` with `bun`. | HIGH (read it) |
| **5 of 7 shipping scripts use Bun globals** | `batch-preflight` (`Bun.argv`); `feature-sync-bounded` (`Bun.argv`, `Bun.file`, `Bun.spawnSync`); `daily-summary/daily-summary` (`Bun.spawn`, `Bun.spawnSync`); `dogfood-testing/detect-pipeline-driving` (`Bun.argv`); `dogfood-testing/validate-report` (`Bun.argv`) | HIGH (grepped) |
| **Unguarded workflow call** | `config/workflows/task-pipeline.yaml:248` runs `bun plugins/sp/scripts/task-size-precheck.ts` with no `[ -f ]` guard, while its sibling at `:528` **is** guarded and falls back to `spur feature sync`. The guard pattern was known and not applied. | HIGH (read both) |
| **No twin regeneration wired** | `package.json` has no `build:scripts`; superskill's own `build` runs `script convert` for its `cc` twin. | HIGH (checked both) |

**Not defects — do not "fix" these:**
- `plugins/sp/hooks/hooks.json` already uses `superskill hook run sp <id>` for all four hooks. Correct.
- `#!/usr/bin/env bun` on the `.ts` sources is the **sanctioned dev-only** form; the generated `.mjs`
  twin carries `#!/usr/bin/env node`. Removing shebangs fixes nothing.
- `surface-drift-inventory.ts:443,481` `#!/bin/sh` are inside template literals writing fake `spur`
  binaries for that script's own self-tests. Not file shebangs.

#### Why `superskill script run` is not the answer here
Read from source (`apps/cli/src/commands/script-run.ts`, v0.3.16): `ScriptRunner.run({stdinText, env})
→ ScriptRunResult` is **argv-less and synchronous**, and `SCRIPT_RUNNERS` is a hardcoded const with a
static import into superskill's own tree — there is no dynamic registration. `sp`'s *hooks* are
registered there only because `runSpTaskWriteGuard` was **reimplemented inside superskill's
`hook-run.ts`**, not imported from this repo.

Every shipping `sp` script is flag-driven (`--wbs`, `--date`, `--file`, and `pr-reviewing`'s
`preflight|wait|collect` subcommands) and several shell out to `spur`. Porting them to the registry
would mean smuggling argv through env vars, moving the logic into another repo, and coupling every
`sp` script fix to a superskill release. **Standard contract (staged `.mjs` twin + `script path`) is
the correct contract for these.** The registry stays right for pure validators like
`cc/validate-response`.

#### Classification — which scripts ship
**Ship (7, need twins):** `batch-preflight.ts`, `feature-sync-bounded.ts`, `history-load.ts`,
`pr-reviewing.ts`, `daily-summary/daily-summary.ts`, `dogfood-testing/detect-pipeline-driving.ts`,
`dogfood-testing/validate-report.ts`.

**Repo-only (7, leave on `bun`, never staged):** `transition-shim-check.ts` (package.json gate),
`validate-commands.ts`, `validate-flag-contracts.ts` (named in prose only, never invoked from a
shipped doc), `surface-drift-inventory.ts` (imports `../tests/helpers/cli-surface`),
`stage-registry-adapter.ts` (library, not an entrypoint), `task-size-precheck.ts` (workflow-invoked;
see the open question below), `daily-summary/logger.ts` (library).

#### Open question to settle before step 2
**Does `sp` actually install to any Bun-less target in practice?** If `sp` only ever reaches Claude
Code, the portability work is theoretical and this task shrinks to steps 1, 5, and 6. Settle it by
running a real `superskill install sp --targets codex --dry-run` and inspecting what is staged.
**Confidence that this matters: LOW until measured** — an earlier attempt to test `spur init` seeding
was invalid (sandbox denied `mktemp`, so the probe listed this repo's own symlink).
### Requirements
- R1 — Replace Bun globals with Node equivalents in the 7 shipping scripts: `Bun.argv` → `process.argv.slice(2)`, `Bun.spawn`/`Bun.spawnSync` → `node:child_process`, `Bun.file` → `node:fs`. Required by either contract, so it lands independently of the superskill release.
- R2 — Settle whether `sp` installs to any Bun-less target, by running a real staged install and inspecting the result; record the answer with evidence before doing R3.
- R3 — Build and commit a `.mjs` twin for each of the 7 shipping scripts via `superskill script convert sp <rel>`, and verify each twin executes under bare `node` — not merely that convert exited 0.
- R4 — Rewrite all 16 anti-pattern call sites to `node "$(superskill script path sp <rel>)"`, including `pr-reviewing/SKILL.md:136`, whose prose currently documents running staged `.ts` under Bun as the house style.
- R5 — Add a `build:scripts` npm script that regenerates every twin, and wire it into `build` so a stale twin cannot ship.
- R6 — Guard `config/workflows/task-pipeline.yaml:248` the way `:528` already guards its sibling, so a seeded end-user project degrades instead of failing.
- R7 — Add a gate that fails when a shipped surface (`plugins/sp/{commands,skills,agents}`, `README.md`) contains `bun plugins/sp/scripts/`, or when a shipping script has no twin — two-sided, in the style of `transition-shim-check`.
- R8 — Record the contract as a new ADR in `docs/00_ADR.md`: which contract each `sp` script uses, the mandatory twin + `$(superskill script path sp <rel>)` invocation form, the forbidden repo-relative form, and the gate from R7. Cite superskill's ADR-015/ADR-022 as upstream authority rather than restating them.
### Acceptance Criteria
```gherkin
Feature: plugins/sp script entrypoint contract alignment

  Scenario: R1 — shipping scripts carry no Bun-only globals
    Given the seven shipping scripts under plugins/sp/scripts
    When they are grepped for Bun globals
    Then no occurrence of Bun.argv, Bun.file, Bun.spawn, or Bun.spawnSync remains
    And each script still passes its existing tests

  Scenario: R2 — the portability premise is measured, not assumed
    Given it is unknown whether sp installs to a Bun-less target
    When a real staged install is run and inspected
    Then the answer is recorded with the command and its output as evidence

  Scenario: R3 — every twin actually runs under bare node
    Given a .mjs twin has been generated for a shipping script
    When it is executed with node and no Bun present
    Then it runs its normal entrypoint rather than throwing a ReferenceError
    And convert exiting zero is not accepted as proof on its own

  Scenario: R4 — no shipped surface names a repo-relative script path
    Given the shipped commands, skills, agents, and README
    When they are searched for "bun plugins/sp/scripts/"
    Then there are no matches
    And each former call site invokes node with a superskill script path substitution

  Scenario: R5 — a stale twin cannot ship
    Given a shipping script's source has changed
    When build runs
    Then build:scripts regenerates that script's twin

  Scenario: R6 — a seeded project degrades instead of failing
    Given a project seeded by spur init where plugins/sp is absent
    When the task pipeline reaches the size precheck
    Then the step is guarded and the pipeline continues

  Scenario: R7 — the contract is enforced mechanically
    Given a shipped surface reintroduces a repo-relative script invocation
    When the gate runs
    Then it fails naming the file and the offending line
    And it also fails when a shipping script has no twin

  Scenario: R8 — the contract is recorded as a decision
    Given the alignment has landed
    When docs/00_ADR.md is read
    Then a new ADR states the per-script contract, the required invocation form, the forbidden form, and the gate
    And it cites superskill ADR-015 and ADR-022 as upstream authority
```
### Q&A
**Closed during refine (premise verification, 2026-08-18).**
- Ship vs repo-only is **measured**, not inferred: the 7 ship scripts each have ≥1 reference from
  `plugins/sp/{commands,skills,agents,hooks}`; the 7 repo-only have exactly 0.
- The anti-pattern count is **16** across 8 files (re-counted at refine time).
- `superskill script run` is disqualified for these scripts — argv-less, synchronous, and
  first-party-only. Not a preference; read from `script-run.ts` at v0.3.16.
- The `.ts` shebangs stay. Removing them fixes nothing and breaks direct execution.

**Deferred — owner: operator.**
Whether `sp` is ever installed to a Bun-less target. R2 measures it; if the answer is "Claude Code
only", the operator decides whether R3/R4/R5 are still worth doing or the task shrinks to R1, R6, R7,
R8. **Do not skip R2 and assume either answer** — the earlier `spur init` probe was invalid (sandbox
denied `mktemp`, so it listed this repo's own symlink) and nothing has measured it since.

**Open, resolvable by the implementer.**
- What `task-pipeline.yaml:248` should do when the script is absent. There is no `spur` verb
  equivalent to the size precheck, so the fallback is to skip with a notice rather than substitute —
  confirm no guard already exists upstream of that line before adding one.
- Whether the gate's rule 4 should also scan `config/workflows/*.yaml`. Those are monorepo self-dev
  and legitimately run `bun` in-repo, so scanning them would produce false failures — but
  `spur init` may seed them into user projects, which is exactly what R2 settles. Decide after R2.

#### Two check warnings that are expected — do not "fix" them
Both were investigated during refine; acting on either would make the corpus worse.

**`L4.uncovered-task-scenario` ×8 (DD-09 subset rule).** R1–R8 are task-local criteria; feature `I`'s
AC is its ship contract, at a coarser altitude. The exemption exists — `task-check.ts:1431` returns
early when `ac_altitude === 'task-local'`, and task 0584 R3 landed
`ac_altitude: graduating | task-local` on the frontmatter schema — but **no CLI verb writes that
field**: `rg -n 'ac_altitude' apps/cli/src` returns nothing, and `--ac-numbering` sets a *different*
field (`ac_numbering`, which gates the Requirements↔AC coverage check at `task-check.ts:621`, not
DD-09). Since raw frontmatter edits are hook-blocked, the exemption is currently unreachable through
the CLI-gated write path. These stay as warnings until that gap is closed. **Do not** invent matching
scenarios in feature `I`'s AC to silence them — that fabricates ship-level criteria.

**`L4.prose-prerequisite-unlisted` ×1 (the 0121 reference).** `0121` is a **superskill** WBS
(feature H1). **Do not add it to `dependencies[]`** — spur-new has its own unrelated task 0121
(`docs/tasks/0121_parent-task-roll-up-gate-…`), so the edge would resolve to the wrong task and
silently assert a dependency that does not exist. A cross-repo prerequisite has no representation in
this corpus; the prose is the correct carrier and the warning is a known false positive.
### Design
**WHAT.** Move the 7 shipping `plugins/sp` scripts onto superskill's **standard contract** (portable
`.mjs` twin + `script path` invocation), leave the 7 repo-only scripts on `bun`, and lock the split
behind a two-sided gate and an ADR.

**WHY.** `plugins/sp` installs to ten targets; only Claude Code, omp, and grok receive the plugin tree
natively, and none of the ten is guaranteed to have Bun. Today every shipped invocation is a
repo-relative `bun plugins/sp/scripts/…` path that cannot resolve off this monorepo.

#### Ship vs repo-only — measured, not inferred
Counted by references from shipped surfaces (`plugins/sp/{commands,skills,agents,hooks}`) on
2026-08-18. The split is clean — every ship script has ≥1, every repo-only script has exactly 0:

| Ship (needs twin) | refs | Repo-only (stays on `bun`) | refs |
| --- | --- | --- | --- |
| `batch-preflight.ts` | 3 | `task-size-precheck.ts` | 0 |
| `daily-summary/daily-summary.ts` | 2 | `transition-shim-check.ts` | 0 |
| `dogfood-testing/validate-report.ts` | 2 | `validate-commands.ts` | 0 |
| `feature-sync-bounded.ts` | 1 | `validate-flag-contracts.ts` | 0 |
| `history-load.ts` | 1 | `surface-drift-inventory.ts` | 0 |
| `pr-reviewing.ts` | 1 | `stage-registry-adapter.ts` (library) | 0 |
| `dogfood-testing/detect-pipeline-driving.ts` | 1 | `daily-summary/logger.ts` (library) | 0 |

`task-size-precheck.ts` is repo-only **but workflow-invoked** (`task-pipeline.yaml:248`), which is why
R6 guards it rather than giving it a twin.

#### Frozen names and paths
| Thing | Value |
| --- | --- |
| Twin location | beside the source: `plugins/sp/scripts/<rel>.mjs` (committed) |
| Manifest | `config/plugin-scripts.json` |
| Gate script | `plugins/sp/scripts/script-contract-check.ts` (repo-only; mirrors `transition-shim-check.ts`) |
| npm scripts | `build:scripts` (regenerates all twins), `script-contract-check` (runs the gate) |
| Gate wiring | into `spur-check` **before** `lint`, beside `transition-shim-check` — sub-second checks fail fast |

#### Frozen invocation form
```sh
node "$(superskill script path sp <rel>.mjs)" <args>
```
The `<rel>` resolves the **`.mjs`**, never the `.ts`. `pr-reviewing/SKILL.md:136` currently reads
`bun "$(superskill script path sp pr-reviewing.ts)"` — right helper, wrong runtime and wrong
extension; it becomes `node "$(superskill script path sp pr-reviewing.mjs)"`, and its surrounding
prose ("execute it with Bun, matching the rest of `plugins/sp/scripts`") must be rewritten, since it
currently documents the anti-pattern as house style.

#### Frozen Bun→Node replacement map (R1)
| Bun global | Node replacement | Scripts affected |
| --- | --- | --- |
| `Bun.argv` | `process.argv.slice(2)` | `batch-preflight`, `feature-sync-bounded`, `dogfood-testing/detect-pipeline-driving`, `dogfood-testing/validate-report` |
| `Bun.file` | `node:fs` (`readFileSync`/`existsSync`) | `feature-sync-bounded` |
| `Bun.spawnSync` | `node:child_process` `spawnSync` | `feature-sync-bounded`, `daily-summary/daily-summary` |
| `Bun.spawn` | `node:child_process` `spawn` | `daily-summary/daily-summary` |

`history-load.ts` and `pr-reviewing.ts` use no Bun globals (`pr-reviewing` already routes every
subprocess through the injectable `run()` seam added 2026-08-18), so they convert as-is.

#### Gate contract (R7) — two-sided, mirroring `transition-shim-check`
`config/plugin-scripts.json` records one entry per script: `rel`, `contract`
(`standard` | `repo-only`), and for standard entries the `twin` path. The gate fails on **any** of:
1. a `standard` entry whose `.mjs` twin is missing or older than its `.ts` source;
2. a committed `.mjs` with no manifest entry, or one belonging to a `repo-only` entry;
3. a script file present under `plugins/sp/scripts/` with no manifest entry at all;
4. the string `bun plugins/sp/scripts/` appearing anywhere in `plugins/sp/{commands,skills,agents}` or `plugins/sp/README.md`.

Rule 3 is what makes it two-sided: a new script cannot be added without declaring its contract.

#### Anti-patterns — do not do these
- Do not remove the `#!/usr/bin/env bun` shebangs from the `.ts` sources. They are the sanctioned
  dev-only form; the generated twin carries `#!/usr/bin/env node`.
- Do not port any script to `superskill script run`. That registry is argv-less, synchronous, and
  first-party-only (see Background).
- Do not give the 7 repo-only scripts twins — rule 2 of the gate fails on exactly that.
- Do not accept `script convert` exit 0 as proof (R3). Run the twin under `node`.
- Do not touch `plugins/sp/hooks/hooks.json` — already correct.
- Do not change `config/workflows/task-pipeline.yaml` beyond adding the R6 guard.
- Do not write the ADR before the alignment lands; R8 records what was done, not what is planned.

#### Cross-task
**Depends on superskill task 0121** (feature H1) *only for R3*: until `script convert` rejects Bun
globals, a twin can be generated that fails under Node while convert reports success. R1, R2, R6 and
the gate's rule-4 half are independent and may land first. Nothing here modifies the superskill repo.
### Plan
- [ ] Replace `Bun.argv` with `process.argv.slice(2)` in `batch-preflight`, `feature-sync-bounded`, `dogfood-testing/detect-pipeline-driving`, `dogfood-testing/validate-report` (R1)
- [ ] Replace `Bun.file` with `node:fs` and `Bun.spawnSync` with `node:child_process` in `feature-sync-bounded` (R1)
- [ ] Replace `Bun.spawn`/`Bun.spawnSync` with `node:child_process` in `daily-summary/daily-summary` (R1)
- [ ] Run the existing plugin test suite after each conversion; no behavior change is intended (R1)
- [ ] Run a real staged install (e.g. `superskill install sp --targets codex --dry-run`) and record what is staged, as evidence for whether Bun-less targets are real (R2)
- [ ] If R2 shows sp only ever reaches Claude Code, stop and re-scope with the operator before R3 (R2)
- [ ] Generate the 7 twins with `superskill script convert sp <rel>`, using a CLI that carries the 0121 fix (R3)
- [ ] Execute each twin under bare `node` and assert it reaches its own entrypoint — do not accept convert's exit code (R3)
- [ ] Rewrite the 16 call sites to `node "$(superskill script path sp <rel>.mjs)"` across the 8 shipped files (R4)
- [ ] Rewrite `pr-reviewing/SKILL.md:136` and its surrounding prose, which currently documents running staged `.ts` under Bun as house style (R4)
- [ ] Add `build:scripts` to `package.json` and wire it into `build` so a stale twin cannot ship (R5)
- [ ] Guard `config/workflows/task-pipeline.yaml:248` the way `:528` guards its sibling; skip the precheck with a notice when the script is absent, since no CLI verb replaces it (R6)
- [ ] Write `config/plugin-scripts.json` with one entry per script and its contract (R7)
- [ ] Write `plugins/sp/scripts/script-contract-check.ts` implementing the four failure rules, with a sibling test (R7)
- [ ] Wire the gate into `spur-check` before `lint`, beside `transition-shim-check` (R7)
- [ ] Add the ADR to `docs/00_ADR.md` recording the per-script contract, invocation form, forbidden form, and the gate; cite superskill ADR-015/ADR-022 as upstream (R8)
- [ ] Verification: `bun run lint`, `bun run test`, `bun run build` green; the new gate green; `rg 'bun plugins/sp/scripts/' plugins/sp/{commands,skills,agents} plugins/sp/README.md` returns nothing
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: [I — sp plugin](../features/I_sp-plugin.md)
- Upstream blocker: superskill task **0121** (feature H1, `portable-plugin-scripts-via-install-time-staging`) — `script convert` Bun-globals hardening
- Upstream guide: `/Users/robin/xprojects/superskill/docs/help/how_to_organize_scripts_for_plugin_development.md` (patched 2026-08-18 with the Bun-globals precondition and the registry's first-party/argv-less constraints)
- Upstream source read for this design: `apps/cli/src/commands/script-run.ts`, `script-convert.ts`, `script-path.ts`, `hook-run.ts` @ superskill `752d839` (v0.3.16)
- Superskill ADR-015 (plugin script layout) and ADR-022 (binary registry / version coupling) — cite as upstream authority in the R8 ADR; do not restate
- Gate precedent: `plugins/sp/scripts/transition-shim-check.ts` + `config/transition-shims.json` (task 0541, ADR-058) — the two-sided manifest pattern R7 mirrors
- `AGENTS.md` § Verification gate — where `script-contract-check` wires in
- Related: [0594] (dev-* spine cost + drift inventory) will re-encounter these invocation sites
### History
