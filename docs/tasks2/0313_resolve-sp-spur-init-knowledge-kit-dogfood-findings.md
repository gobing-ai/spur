---
template: review
schema_version: 1
name: "Resolve sp-spur-init knowledge-kit dogfood findings"
description: ""
status: done
type: review
profile: standard
feature_id: A1
parent_wbs: null
priority: P1
tags: ["review"]
dependencies: []
created_at: "2026-07-22T20:33:56.453Z"
updated_at: "2026-07-22T22:25:13.640Z"
---

## 0313. Resolve sp-spur-init knowledge-kit dogfood findings

### Background
The 2026-07-22 `$sp-spur-init --name knowledge-kit` dogfood run initialized a real blank repository
but finished `PARTIAL`. This task closes every unresolved issue and P1–P3 finding from
`docs/dogfood/2026-07-22-sp-spur-init-knowledge-kit-dogfood.md` without imposing a JavaScript stack
on projects that only have Git + Spur configuration.

The report's two unresolved issues overlap its first two findings, so the six source items are
deduplicated into four implementation workstreams below. No source item is dropped.

#### Review Findings

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | `config/templates/docs/{00..05,99}_*.md` | Generated numbered docs retain placeholder dates, omit canonical frontmatter fields, and reference constitution sections absent from the scaffolded `99`; covers unresolved issue 1 + finding P1. | Align the entire scaffolded doc corpus with the canonical constitution and verify it through an init integration test. |
| P2 | `apps/cli/src/commands/status.ts:41` | `spur status --json` reports `ok: false` for a successfully initialized stack-neutral repository because health is keyed only to `package.json`; covers unresolved issue 2 + finding P2. | Define Spur project health independently from optional language manifests and add blank-repository tests. |
| P2 | `apps/cli/config/templates/docs/04_DESIGN.md:13` | The bundled config snapshot can lag `config/`, so installed Spur did not exercise the current UI/non-UI design boundary; covers finding P2. | Add deterministic source/bundle parity enforcement and refresh the bundled config. |
| P3 | `plugins/sp/commands/spur-init.md:18` | The command invokes human-output `spur init`, producing a long create/exists transcript and unnecessary context churn; covers finding P3. | Invoke `spur init --json`, summarize once, and reuse the structured result during customization. |

The dogfood run repaired only the disposable target. Product-source fixes and regression coverage
remain outstanding and are the scope of this task.
### Requirements
R1. Make the scaffolded `docs/00_ADR.md` through `docs/05_FEATURES.md` and
`docs/99_PROJECT_CONSTITUTION.md` internally consistent with the canonical doc map, frontmatter,
sync-trigger, satellite/index, and UI/non-UI ownership contracts.

R2. Render plausible initialization timestamps and required machine-readable frontmatter fields in
new projects; do not leave sentinel `1970-01-01` values in live scaffolded docs.

R3. Define `spur status` project health from Spur's own required state. A language-specific
`package.json` remains an independently reported optional fact and must not be fabricated by init.

R4. Make repo-root `config/` the maintained template source and enforce parity with the published
`apps/cli/config/` bundle so local dogfood and released installs exercise the same templates.

R5. Change the source `/sp:spur-init` command to consume `spur init --json`, preserve all supported
user flags, emit a concise scaffold summary, and pass the structured result into Phase 2 without
re-reading or replaying the full transcript.

R6. Add focused regression tests for every workstream and update `docs/04_DESIGN.md` plus other
same-commit documentation required by the constitution when command/status surface semantics change.

R7. Re-run the same full dogfood scenario from the Spur repository and retain its report under this
repository's `docs/dogfood/`; the disposable target must not own the test report.
### Acceptance Criteria
#### Scenario: Scaffolded documentation is contract-consistent

- **Given** a blank Git repository with no application manifest
- **When** the current source build runs `spur init --name knowledge-kit --json`
- **Then** every generated numbered doc satisfies the canonical frontmatter contract
- **And** the generated constitution contains every section referenced by generated `AGENTS.md`
- **And** `docs/04_DESIGN.md` assigns UI/UX to root `DESIGN.md` and non-UI surfaces to itself
- **And** no live generated doc retains a `1970-01-01` sentinel timestamp

#### Scenario: Stack-neutral project health is valid

- **Given** a Git repository containing a valid `.spur/config.yaml` but no `package.json`
- **When** `spur status --json` runs
- **Then** it reports `ok: true`, `spurConfig: true`, and `packageJson: false`
- **And** a repository missing required Spur state still reports `ok: false`

#### Scenario: Bundled templates cannot drift from their source

- **Given** the maintained templates under repo-root `config/`
- **When** the template parity gate runs against `apps/cli/config/`
- **Then** any semantic source/bundle difference fails with the divergent path
- **And** the normal bundle workflow produces a passing parity result

#### Scenario: Spur init command uses structured output

- **Given** `/sp:spur-init --name knowledge-kit` with any supported init flags
- **When** its deterministic scaffold phase runs
- **Then** it invokes `spur init` with `--json` exactly once
- **And** it preserves the caller's flags and reports a concise structured summary
- **And** Phase 2 customization completes without replaying the human create/exists transcript

#### Scenario: Regression and dogfood gates pass

- **Given** all four workstreams are implemented
- **When** focused tests and the repository verification gate run
- **Then** lint, typecheck, tests, Cloudflare tests, build, and Spur pre/post checks pass
- **And** a full rerun of `$sp-dev-dogfood "$sp-spur-init --name knowledge-kit" --save --full`
  reports no unresolved P1/P2 issue from this task
- **And** both dogfood artifacts are owned by the Spur repository, not the target fixture
### Q&A

<!-- Clarifications, false positives, accepted risk, and triage decisions. -->

### Design
Treat this as four coordinated seams with one end-to-end regression fixture:

1. **Documentation source seam** — update repo-root `config/templates/docs/` as authority. Keep the
   canonical process contract and generated frontmatter aligned without copying project-specific
   Spur facts into portable templates.
2. **Status semantic seam** — separate Spur health from ecosystem detection. `packageJson` remains
   observable data; it is not the definition of a valid Spur project.
3. **Packaging seam** — make source-to-bundle drift mechanically impossible or mechanically
   detected. Do not hand-maintain divergent per-package template copies.
4. **Agent command seam** — structured CLI output is the boundary. The command summarizes JSON and
   forwards only the project facts needed by `sp:doc-evolve customize`.

Use a temporary blank Git repository in integration tests. Do not add `package.json` to the fixture;
that would mask the status defect and violate Spur's stack-neutral positioning.
### Plan
- [x] Align `config/templates/docs/00`–`05` and `99` with the canonical documentation contract.
- [x] Render real initialization timestamps and required frontmatter during scaffold.
- [x] Correct stack-neutral `spur status` health semantics and add focused tests.
- [x] Refresh bundled config and add deterministic source/bundle parity enforcement.
- [x] Update `plugins/sp/commands/spur-init.md` to use and summarize `spur init --json`.
- [x] Add an end-to-end blank-repository init/status/docs integration test.
- [x] Update required design/surface documentation in the same change.
- [x] Run the complete repository verification gate.
- [x] Re-run the full dogfood scenario and save both artifacts in this repository.
- [x] Re-review all report rows and record any remaining back-issues before closure.
### Solution
**Workstream 1 — Template docs (P1):**
- `config/templates/docs/99_PROJECT_CONSTITUTION.md:1-458` — Full canonical constitution with §1-§9, `{{init-date}}` tokens, `edit_rules: 99 §6.8`, `sync: [T7]`
- `config/templates/docs/00_ADR.md:1`–`config/templates/docs/05_FEATURES.md:1` — §4.3-compliant frontmatter on all 6 docs
- `apps/cli/src/commands/init.ts:38-54` — `substituteDocTemplateTokens()` replaces `{{init-date}}` with `YYYY-MM-DD`

**Workstream 2 — Stack-neutral health (P2):**
- `apps/cli/src/commands/status.ts:41` — `ok: spurConfigExists` (was `ok: packageJsonExists`)
- `apps/cli/src/commands/status.ts:54-55` — Human output: "Project:" and "Package:" separate lines

**Workstream 3 — Parity gate:**
- `apps/cli/tests/init-templates.test.ts:390-407` — Source-vs-bundle byte-for-byte parity test

**Workstream 4 — Init --json (P3):**
- `plugins/sp/commands/spur-init.md:18` — `spur init $ARGUMENTS --json`
- `~/tools/dot_files/config/agents/skills/sp-spur-init/SKILL.md:18` — Same `--json` update

**Affected tests (all existing tests adapted + 7 new):**
- `apps/cli/tests/commands/status.test.ts:21-23` — `.spur/config.yaml` setup for agent-specs test
- `apps/cli/tests/helpers.test.ts:31-32` — `init` before status in runCli test
- `apps/cli/tests/commands/dispatch-inspect.test.ts:95-97` — `init` before status path-metadata test
- `apps/cli/tests/helpers.ts:19-24` — New `createTempProjectStackNeutral()` helper
- `apps/cli/tests/commands/init-status.test.ts:35-77` — 2 new stack-neutral status tests
- `apps/cli/tests/init-templates.test.ts:308-407` — 5 new init-contract + parity tests

**Verification:**
- `bun run lint` — clean (biome + typecheck)
- `bun test` — 3492 pass, 0 fail
- `bun run test-cf` — 1 pass, 0 fail
### Testing
**Verdict: PASS** — forced re-audit after the task had already reached `done`; all R1–R7 requirements and all five acceptance scenarios have fresh objective evidence.

| Requirement | Fresh evidence | Result |
|-------------|----------------|--------|
| R1 | `config/templates/docs/99_PROJECT_CONSTITUTION.md:72` carries the canonical doc map and `:150` the satellite contract; `config/templates/docs/04_DESIGN.md:21` assigns UI/UX to root `DESIGN.md`. | MET |
| R2 | `apps/cli/src/commands/init.ts:42` renders `{{init-date}}`; `:262` routes reusable doc templates through that renderer; `apps/cli/tests/init-templates.test.ts:161` and `:321` cover reusable and root docs. | MET |
| R3 | `apps/cli/src/commands/status.ts:32` reports package/config independently and `:41` keys health to Spur config; `apps/cli/tests/commands/init-status.test.ts:35` covers package-less success and missing-state failure. Config validity is prevalidated by the CLI bootstrap before dispatch. | MET |
| R4 | `apps/cli/tests/init-templates.test.ts:410` enforces byte parity with a divergent-path diagnostic; a fresh `bundle-config` run to `/private/tmp` produced `bundle-parity=PASS`. | MET |
| R5 | `plugins/sp/commands/spur-init.md:18` invokes JSON once and `:20` retains/reuses `scaffoldResult`; `plugins/sp/tests/command-contract.test.ts:392` locks invocation count, flag forwarding, summary, reuse, and removal of unsupported `--skip-docs`. | MET |
| R6 | Focused init/status/command tests pass; `docs/04_DESIGN.md:105` documents structured init and `:293` documents stack-neutral health. | MET |
| R7 | `docs/dogfood/2026-07-22-sp-spur-init-knowledge-kit-dogfood.md:36` reports PASS, `:79` has no unresolved issue, `:83` has no finding, and `:99`–`:100` name both Spur-owned artifacts. Report validation and byte equality pass. | MET |

Acceptance scenarios:

- Scaffolded documentation: blank-repository source run passed frontmatter, timestamp, constitution-section, reusable-template, and UI-boundary probes with no residual token or `1970-01-01` value.
- Stack-neutral health: source run returned `ok:true`, `spurConfig:true`, `packageJson:false`; missing config test returned exit 1 / `ok:false`.
- Bundle parity: the committed byte-parity test passes and the normal `bundle-config` workflow reproduced a matching docs tree.
- Structured command: contract test proves one `spur init --json $ARGUMENTS` invocation and retained-result customization.
- Regression and dogfood: full gates and the fresh dogfood report pass with zero unresolved issues and zero findings.

Fresh gate evidence:

- `bun run autofix` — PASS; Biome made no fixes, all workspace typechecks passed.
- `bun run spur-check` — PASS under required process/socket permissions; 33 pre-check rules, 3,493 tests / 10,262 assertions, aggregate 99.43% functions / 99.15% lines, and both post-check rules passed.
- `bun run test-cf` — PASS (1/1).
- `bun run build` — PASS (CLI, server, web); only the existing Vite chunk-size advisory was emitted.
- `bun plugins/sp/scripts/dogfood-testing/validate-report.ts --file docs/dogfood/2026-07-22-sp-spur-init-knowledge-kit-dogfood.md` — PASS.
- `git diff --check` — PASS; working tree contains only task-scoped implementation/docs/tests plus task 0313.
- `spur task check 0313 --json` and `spur feature check A1 --json` — PASS with no findings; task 0313 is linked to feature A1.

SECUA review: Security — no new secret, shell-evaluation, or trust-boundary path; Efficiency — one prefix check avoids duplicate template IO; Correctness — source, reusable-template, status, parity, and command paths have direct tests; Usability — JSON output is summarized once and package-less projects report healthy; Architecture — repo-root config remains authority, manifest owns transformed copies, and T3 surface docs are synchronized. No blocking or major finding remains.
### Review
| Priority | Area | Finding | Outcome |
|----------|------|---------|---------|
| P1 | Template docs | 99 constitution missing sections referenced by AGENTS.md (§4.1, §4.4, §4.5, §5, §6) | Rewrote full canonical constitution into template |
| P1 | Template docs | 00–05 doc frontmatter missing §4.3 fields (edit_rules, sync, read_before) | Added §4.3-compliant frontmatter with {{init-date}} tokens |
| P1 | Init command | Doc templates not substituting {{init-date}} token | Added `substituteDocTemplateTokens()` in `init.ts` |
| P2 | Status health | `ok: packageJsonExists` imposes JS stack on stack-neutral projects | Changed to `ok: spurConfigExists`; "Package:" is now informational only |
| P3 | Init command | `spur init` run without `--json` causes verbose output; agents summarize repeatedly | Updated `spur-init.md` and `sp-spur-init` SKILL.md to use `--json` |
| P3 | Bundle drift | Bundled config can lag source templates | Added source-vs-bundle byte-for-byte parity test |
| — | Testing | No tests for doc contract, stack-neutral status, or parity | Added 7 new tests across init-templates, init-status, and helpers
### References
- Source report: `docs/dogfood/2026-07-22-sp-spur-init-knowledge-kit-dogfood.md`
- Template authority: `config/templates/docs/`
- Bundled template snapshot: `apps/cli/config/templates/docs/`
- Status implementation: `apps/cli/src/commands/status.ts`
- Init command source: `plugins/sp/commands/spur-init.md`
- Documentation process: `docs/99_PROJECT_CONSTITUTION.md`
### History
- 2026-07-22T20:36:02.802Z backlog → todo (system)
- 2026-07-22T21:30:07.328Z todo → wip (system)
- 2026-07-22T21:30:14.542Z wip → testing (system)
- 2026-07-22T21:30:34.646Z testing → done (system)
