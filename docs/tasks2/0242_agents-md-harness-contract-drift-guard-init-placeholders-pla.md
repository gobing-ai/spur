---
template: standard
schema_version: 1
name: "AGENTS.md harness contract: drift guard, init placeholders, platform fallback, long-tail routing"
description: ""
status: done
type: task
profile: standard
feature_id: A1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-12T05:45:32.524Z"
updated_at: "2026-07-12T05:52:59.668Z"
---

## 0242. AGENTS.md harness contract: drift guard, init placeholders, platform fallback, long-tail routing

### Background
## Why

Root `AGENTS.md` was reorganized to make the Spur harness first-class (CLI + `/sp:dev-*` + `sp:*` subagents). Portable harness wording was extracted into `config/templates/AGENTS.md` (seeded by `spur init`). That left four implementation follow-ups that are easy to skip and easy to implement incorrectly:

1. **Dual-source drift** — root `AGENTS.md` and `config/templates/AGENTS.md` must stay aligned on portable contract structure, or `spur init` customers get a different harness contract than this monorepo dogfoods.
2. **Unfilled placeholders** — the template uses `{project-name}`, `{stack-and-layout}`, `{build-test-lint-commands}`, `{cli-invoke-notes}`, `{project-conventions}`. `spur init` copies the file as-is; `sp:doc-evolve` customize still documents `{{ NAME }}`-style markers. New projects can ship literal brace stubs.
3. **Platform coverage** — routing tables assume Claude-style slash commands and subagents. Codex / OpenCode / other platforms often only have skills + CLI; without an explicit fallback line, agents invent process or ignore the harness.
4. **Long-tail / incomplete noun docs** — routing is deliberately short; agents still invent flags for nouns not fully covered by `sp:spur-cli` (`agent`, `history`, `message`, `team`, `serve`, …). Need an explicit “help + 04 only” rule and a single long-tail pointer.

## Scope

In scope: automated drift guard (structure), placeholder contract + init/customize fill path, one platform-fallback line (root + template), long-tail + non-`spur-cli` noun guidance (root + template), tests and same-commit doc pointers if surface changes.

Out of scope: expanding `sp:spur-cli` with full `agent`/`team`/… noun references (can be a follow-up task); rewriting constitution; reintroducing the full CLI dump into AGENTS.md.

## Related paths

- `AGENTS.md` (repo root; dogfood instance)
- `config/templates/AGENTS.md` (portable template; `SCAFFOLD_MANIFEST` → `spur init`)
- `apps/cli/src/config/scaffold-manifest.ts`
- `apps/cli/src/commands/init.ts` (AGENTS preserve + Indexed context inject)
- `plugins/sp/skills/doc-evolve/SKILL.md` (customize operation)
- `apps/cli/tests/init-templates.test.ts`
- Constitution: `docs/99_PROJECT_CONSTITUTION.md` §4.4, §6.7
### Requirements
R1. **Drift guard (structure SSOT).** Add an automated test (location: prefer `apps/cli/tests/` or `plugins/sp/tests/`, match existing patterns) that fails when portable structure diverges between root `AGENTS.md` and `config/templates/AGENTS.md`.

R1.1. Assert these H2 headings exist in **both** files (exact match, order not required unless noted):
- `## Project`
- `## Harness-first contract`
- `## Documentation`
- `## Stack & layout` **or** template may use the same title with a placeholder body
- `## Spur CLI surface`
- `## Conventions & boundaries`
- `## Indexed context`

R1.2. Assert the **Harness tool routing** table’s first-column “Need” keys match between root and template (normalize whitespace). Canonical need-keys (must be present in both; additional rows allowed only if present in both or documented as project-only in root with a `<!-- PROJECT-ONLY -->` comment on that table row):

| Canonical Need key (exact cell text after trim) |
|-------------------------------------------------|
| Plan a feature (intake → AC → tasks) |
| Drive one task end-to-end |
| Batch or parallel task runs **or** template synonym “Run a task batch / parallel set” — **pick one string and use it in both files** before enabling the test |
| Multi-step corpus CLI (tasks/features/rules/workflows) **or** longer template synonym — **unify string** |
| Look up `spur` verbs / flags / `--json` |
| Create/edit/list tasks or features |
| Verify requirements / AC |
| Review (SECUA + traceability + architecture) **or** “Review code …” — **unify** |
| Tests / coverage |
| Constraint gate / rule authoring |
| Workflow author / run |
| Docs drift / sync / lessons **or** “Docs drift / same-commit sync / lessons” — **unify** |
| Wrap completed work |
| Session index / memory **or** “Session file index / memory” — **unify** |

**Implementation note:** Before coding the test, unify wording in root and template so keys match byte-for-byte (after trim). Document the canonical list as a const array shared by the test (single source of truth for keys).

R1.3. Root may contain **project-only** H2 sections not in the template (`## Code style`, `## Build & repo commands`, `## Verification gate`, `## Testing`, `## oRPC`, `## Database / migrations`). Template may use `## Build & verification` instead of separate Build + Verification. Do **not** require project-only sections in the template.

R1.4. Test name must describe the contract (e.g. `AGENTS portable harness sections stay aligned with init template`). Failure message must print which file is missing which heading or need-key.

R2. **Placeholder contract + fill path.**

R2.1. Document the **only** allowed placeholder syntax in `config/templates/AGENTS.md` (HTML comments already mark PROJECT-SPECIFIC slots). Canonical placeholders (exact tokens):

| Token | Meaning | Filled by |
|-------|---------|-----------|
| `{project-name}` | Project display name | init `--name` / customize |
| `{one-line description}` wait — currently `{one-line description}` in template line 14 uses prose; standardize to `{project-description}` |
| `{stack-and-layout}` | Stack + directory tree block | customize (from package manifests) or manual |
| `{build-test-lint-commands}` | Shell block for lint/test/build | customize or manual |
| `{cli-invoke-notes}` | Optional monorepo/dev invoke notes | customize or manual |
| `{project-conventions}` | Extra convention bullets | customize or manual |

R2.2. Unify placeholder style: **`{kebab-case}` only** (no `{{ MUSTACHE }}` in AGENTS template). Update `sp:doc-evolve` customize section to reference these tokens, not invent a second syntax.

R2.3. Implement fill for at least:

- `{project-name}` — from `spur init --name` or directory basename when scaffolding a **new** AGENTS.md from template.
- Leave other `{…}` tokens as stubs **only if** customize is documented as required post-init; **or** fill safe defaults (`{stack-and-layout}` → “See package.json / README”; `{build-test-lint-commands}` → commented examples).

R2.4. Prefer filling in `apps/cli` init path when writing `AGENTS.md` from template so `spur init` alone never leaves `{project-name}` unsubstituted. `sp:doc-evolve` customize remains the path for stack/commands deep fill.

R2.5. Tests:

- After scaffold with `--name Foo`, created `AGENTS.md` must **not** contain the literal string `{project-name}`.
- Must still contain `## Indexed context` and harness routing heading.
- `--force` still **preserves** customized AGENTS.md (existing preserve behavior).

R3. **Platform fallback line.**

R3.1. Add (root + template) under Harness-first contract, after the routing table (or as a single paragraph under non-negotiable rules), this **semantic** requirement (wording may be edited for tone but must convey all three points):

1. Platforms without slash commands and/or subagents still use the harness.
2. Equivalent path: skills `sp:spur-dev`, `sp:spur-cli`, `sp:code-verification` (and related) + `spur` CLI.
3. Do not invent a parallel process because `/sp:dev-*` is unavailable.

R3.2. Both files must include a stable grep anchor so the drift test (or a sibling assertion) can check presence, e.g. a bold label **`Platform fallback:`** on that paragraph.

R4. **Long-tail index + non-`spur-cli` nouns.**

R4.1. Under Spur CLI surface (root + template), add:

- **Long-tail commands:** one sentence pointing to `plugins/sp/README.md` (or “project plugin README”) as the index of additional `/sp:dev-*` commands not listed in the routing table (e.g. handover, gitmsg, fixall, dogfood, reverse, arch).
- **Nouns outside `sp:spur-cli`:** explicit rule that `agent`, `history`, `message`, `team`, `status`, `migrate`, `serve`, `init` (and any future noun not in the four-noun facade) must be discovered via `spur <noun> --help` and `docs/04_DESIGN.md` only — **never guess flags**.

R4.2. Optional stable anchors for tests: `**Long-tail:**` and `**Outside spur-cli:**` labels.

R5. **No regression of harness-first intent.**

R5.1. Do not reintroduce a full CLI flag dump into AGENTS.md.
R5.2. Do not remove the constitution §4.1 doc map table from root AGENTS.md.
R5.3. Do not remove CLI-gated corpus write rule.
R5.4. Root remains self-contained (agents must not be required to open the template at session start).

R6. **Same-commit / verification.**

R6.1. If init CLI behavior changes, update `apps/cli/tests/init-templates.test.ts` (and any scaffold tests) in the same change.
R6.2. `bun test` for touched workspaces must pass; no skipped tests to go green.
R6.3. If `04_DESIGN` documents init/AGENTS scaffold, update in the same commit (T3) when init behavior changes.
### Acceptance Criteria
```gherkin
Feature: AGENTS.md harness contract hardening

  Scenario: Portable structure drift is detected
    Given root AGENTS.md and config/templates/AGENTS.md
    When the portable harness alignment test runs
    Then both files contain the required H2 headings
    And both files share the same canonical Harness tool routing Need keys
    And a missing heading or key fails the test with a message naming the file and missing item

  Scenario: Need-key wording is unified before the guard is green
    Given previously divergent Need cell strings between root and template
    When this task is complete
    Then each canonical Need key appears with identical trim-equal text in both files
    And the test asserts against a single exported/const list of those keys

  Scenario: spur init substitutes project name
    Given spur init scaffolds AGENTS.md from config/templates/AGENTS.md with --name MyApp
    When the file is written
    Then the file does not contain the literal token {project-name}
    And the file contains MyApp (or the documented substitution result)
    And the file still contains ## Indexed context and ## Harness-first contract

  Scenario: Placeholder syntax is single-source
    Given config/templates/AGENTS.md
    When placeholders are listed
    Then only {kebab-case} tokens from the R2.1 table remain for unfilled slots
    And sp:doc-evolve customize documents those tokens (not a conflicting {{ MUSTACHE }} scheme for AGENTS)

  Scenario: Platform fallback is documented for non-Claude agents
    Given root AGENTS.md and the portable template
    When an agent lacks slash commands and subagents
    Then both files contain a Platform fallback paragraph stating skills + spur CLI are the equivalent path
    And the paragraph is findable via the **Platform fallback:** anchor (or equivalent stable label)

  Scenario: Long-tail and outside-facade nouns are constrained
    Given root AGENTS.md and the portable template
    When an agent needs a command not in the routing table
    Then both files point to plugins/sp/README.md (or project plugin README) as the long-tail index
    And both files state that nouns outside sp:spur-cli use only spur <noun> --help and docs/04_DESIGN.md

  Scenario: Harness-first regressions are rejected
    Given the AGENTS.md rewrite goals
    When this task is reviewed
    Then AGENTS.md still has no full CLI flag dump
    And the constitution doc map table remains in root AGENTS.md
    And CLI-gated corpus writes remain a non-negotiable rule

  Scenario: Existing init preserve behavior still holds
    Given an existing customized AGENTS.md
    When spur init --force runs
    Then AGENTS.md content is preserved (SCAFFOLD preserve: true)
    And Indexed context is not duplicated if already present
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Four sequential slices. Prefer tests that lock contracts before wording churn.

**Slice 1 — Unify portable strings (no behavior change)**

1. Diff root `AGENTS.md` vs `config/templates/AGENTS.md` routing Need cells and H2 titles.
2. Edit **both** files so: canonical Need keys match R1.2 (single wording); shared H2 set matches R1.1.
3. Add `**Platform fallback:**`, `**Long-tail:**`, `**Outside spur-cli:**` (or agreed labels) with R3/R4 content in **both** files.
4. Standardize template placeholders to R2.1 `{kebab-case}` tokens (rename free-form description placeholder to `{project-description}`).

**Slice 2 — Drift guard test**

1. Add test module e.g. `apps/cli/tests/agents-md-portable-alignment.test.ts` (or `plugins/sp/tests/` — document choice in Solution).
2. Read both files from repo root using the same path-resolution style as `init-templates.test.ts`.
3. Keep `PORTABLE_AGENTS_H2` and `PORTABLE_ROUTING_NEED_KEYS` as const arrays in the test file (or tiny `apps/cli/tests/fixtures/agents-md-portable-contract.ts` if shared — avoid production code).
4. Parse H2 with `/^## .+$/m`. Parse routing Need column as markdown table rows under `### Harness tool routing` until the next heading.
5. Assert every required H2 is present in both files; assert Need-key sets are equal (order-independent).
6. Allowlist root-only H2s in test comments: `Code style`, `Build & repo commands`, `Verification gate`, `Testing`, `oRPC`, `Database / migrations` (exact titles as in root).
7. Failure messages must include: path, missing item type (heading | need-key), missing string.

**Slice 3 — Init placeholder substitution**

1. On scaffold write of AGENTS.md from template, substitute:
   - `{project-name}` ← init `--name` or cwd basename
   - `{project-description}` ← short stub without braces if no description flag exists (e.g. empty or "local Spur project")
2. Never overwrite `preserve: true` existing AGENTS on re-init / `--force`.
3. Extend `apps/cli/tests/init-templates.test.ts` for R2.5.
4. Update `plugins/sp/skills/doc-evolve/SKILL.md` customize: document AGENTS `{kebab-case}` tokens; do not present `{{ NAME }}` as the AGENTS scheme (if mustache remains for other doc templates, say so explicitly).

**Slice 4 — No residual brace tokens after init**

**Locked decision:** After init writes a fresh AGENTS.md, `rg '\{[a-z0-9-]+\}' AGENTS.md` must return **empty**. Remaining project-specific slots use HTML comments + one-line human stubs (no `{tokens}`). Rationale: brace leftovers look like bugs and train agents to leave them.

**Rejected alternatives**

| Alternative | Why rejected |
|-------------|--------------|
| Generate root AGENTS from template at build time | Root must be self-contained for session start; monorepo has project-only sections |
| Full CLI flag dump in AGENTS again | Undoes harness-first rewrite |
| Docs-only R1 without automated test | Drift recurs |
| Expand `sp:spur-cli` to all nouns in this task | Scope explosion — separate task |

**Invariants**

- Constitution §4.4: root keeps instantiated doc map.
- Constitution §6.7: lean entry; link out for depth.
- SCAFFOLD `AGENTS.md` `preserve: true` unchanged.
- `init.ts` Indexed-context inject behavior unchanged (no duplicate markers).
- Root remains self-contained; template is portable seed + alignment target, not a runtime dependency for agents working in this monorepo.

**Touch map (expected)**

| Path | Change |
|------|--------|
| `AGENTS.md` | Unify keys; platform fallback; long-tail; outside-facade |
| `config/templates/AGENTS.md` | Same portable contract; placeholder cleanup |
| `apps/cli/src/commands/init.ts` and/or scaffold write helper | Substitute `{project-name}` / description |
| `apps/cli/tests/agents-md-portable-alignment.test.ts` (new) | R1 guard |
| `apps/cli/tests/init-templates.test.ts` | R2.5 cases |
| `plugins/sp/skills/doc-evolve/SKILL.md` | customize token docs |
| `docs/04_DESIGN.md` | Only if init public behavior is documented there (T3) |
### Plan
1. [ ] Unify Need-key and H2 wording between root AGENTS.md and config/templates/AGENTS.md (R1.2 prep).
2. [ ] Add Platform fallback, Long-tail, Outside spur-cli paragraphs to both files with stable anchors (R3, R4).
3. [ ] Normalize template placeholders to R2.1 `{kebab-case}`; remove residual free-form braces (R2).
4. [ ] Add `PORTABLE_AGENTS_*` const + alignment test; run red on intentional divergence then green (R1).
5. [ ] Implement init-time `{project-name}` / `{project-description}` substitution when scaffolding AGENTS.md (R2.3–R2.4).
6. [ ] Extend init-templates tests for substitution + no residual required tokens (R2.5).
7. [ ] Update sp:doc-evolve customize docs for AGENTS tokens (R2.2).
8. [ ] Ensure fresh template has no unknown `{tokens}` after init path (R2 decision).
9. [ ] If init public behavior / design surface changes, sync docs/04_DESIGN.md same commit (R6.3).
10. [ ] Run `bun test` for touched suites; fill Solution with file:line map; verify R5 non-goals still hold.
### Solution
| File | Change |
|------|--------|
| `AGENTS.md:34-72` | Unified routing Need keys; **Platform fallback:**; monorepo self-contained dogfood |
| `AGENTS.md:196-204` | **Long-tail:** + **Outside spur-cli:** under Spur CLI surface |
| `config/templates/AGENTS.md:26-56` | Same Need keys + Platform fallback; portable seed |
| `config/templates/AGENTS.md:108-124` | Long-tail + Outside spur-cli; no residual stack brace tokens |
| `apps/cli/src/commands/init.ts:32-38` | `substituteAgentsMdTemplate` — `{project-name}` / `{project-description}` |
| `apps/cli/src/commands/init.ts:250-259` | Scaffold loop applies substitution for `AGENTS.md` only |
| `apps/cli/tests/fixtures/agents-md-portable-contract.ts:10-46` | `PORTABLE_AGENTS_H2` / `PORTABLE_ROUTING_NEED_KEYS` / anchors SSOT |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:67-130` | R1 drift guard + R5 regression smoke |
| `apps/cli/tests/init-templates.test.ts` | R2.5: `--name MyApp` leaves no brace tokens |
| `plugins/sp/skills/doc-evolve/SKILL.md` | customize: AGENTS `{kebab-case}` only |
| `docs/04_DESIGN.md` (init ownership) | AGENTS init substitution contract (T3) |

**Locked decisions:** Need keys unified byte-for-byte; after init no `\{[a-z0-9-]+\}` in written AGENTS; `preserve: true` unchanged.
### Testing
**Verify run:** `/sp:dev-run 0242 --auto --next` implement + verify chain.

**Commands:**
```
bun test apps/cli/tests/agents-md-portable-alignment.test.ts apps/cli/tests/init-templates.test.ts
23 pass, 0 fail (full both files)

Filtered AGENTS/portable: 10 pass (alignment 4 + init AGENTS-related including 0242 substitute)
spur task check 0242 — pass (errors clear)
```

**Coverage:** N/A (docs + scaffold contract; no new runtime product path beyond init substitution).

**Per-requirement:** R1–R6 MET — see Solution table and `.spur/run/0242-verdict.json`.
### Review
| Priority | Finding | Status |
|----------|---------|--------|
| P1 | None | — |
| P2 | None | — |
| P3 | AC scenarios are task-local (not in feature A1 AC) — L4 warnings only; deferred feature AC update out of scope | OPEN / advisory |
| P4 | Template vs root remain dual sources; drift guard tests structure only, not full prose parity | DONE (by design) |

Disposition: implement complete; verify PASS artifact at `.spur/run/0242-verdict.json`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-12T05:46:24.319Z backlog → todo (system)
- 2026-07-12T05:52:10.424Z todo → wip (system)
- 2026-07-12T05:52:32.405Z wip → testing (system)
- 2026-07-12T05:52:59.668Z testing → done (system)
