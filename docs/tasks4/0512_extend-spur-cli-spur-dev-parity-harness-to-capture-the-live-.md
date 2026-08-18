---
template: feature-impl
schema_version: 1
name: "Extend spur-cli/spur-dev parity harness to capture the live CLI surface"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T20:41:23.615Z"
updated_at: "2026-08-18T04:42:48.688Z"
---

## 0512. Extend spur-cli/spur-dev parity harness to capture the live CLI surface

### Background
Phase 1a of feature I2 (parity-first drift audit). This task owns the capture layer: a fixture-backed source-local CLI helper with provenance, and the npm-skew scope documentation. The assertion and scope slices moved to 0516 (exclusions + ADR-054 boundary) and 0517 (focused parity test wiring) by the 2026-08-11 decomposition; 0513 consumes 0517's finding set.

Implements feature I2 scenarios: R13 (surface capture proves source-local provenance), R9 (published npm skew is documented). Per the design doc (`docs/design/plugin-surface-parity.md`): invoke `bun run apps/cli/src/index.ts <noun> --help` directly — never a bare PATH `spur` — and record a provenance header (resolved binary + `@gobing-ai/spur` version) in every capture. Human `--help` parsing is a narrow adapter with fixtures and explicit exclusions, not a general parser; `--json` only where the noun actually exposes a machine-readable inventory.

Rubric: E3 D1 L1 C0 R0 = 5 → split (size gate: 6 R-items > cap 5); helper slice kept here.
### Requirements
- [ ] R1. Add `plugins/sp/tests/helpers/cli-surface.ts` with exported `captureCliSurface(commandPath?)` and `parseCommanderHelp(text)` helpers. Capture must invoke the repository's `apps/cli/src/index.ts` through Bun for root, noun, or noun+verb help, return stable sorted command/flag arrays, fail loudly on a non-zero command, and attach `{ entryPath, packageName, packageVersion }` provenance read from `apps/cli/package.json`.
- [ ] R2. Document in `docs/design/plugin-surface-parity.md` and the helper contract that published npm `spur` may lag and is outside this deterministic source-local parity gate.

Non-goals: no runtime CLI behavior, public command or flag, dependency, schema, transport, generic help parser, or bare PATH `spur` execution. Assertion wiring and fixture coverage belong to 0517; explicit exclusion and boundary parsing belong to 0516.
### Acceptance Criteria
```gherkin
Feature: Source-local CLI parity harness

  Scenario: R1 — Surface capture proves source-local provenance
    Given a stale global spur binary may be on PATH
    When the helper captures a CLI surface
    Then it invokes the monorepo CLI entry directly and records the entry path and package version

  Scenario: R2 — Published npm skew is documented
    Given an installed npm Spur may lag the monorepo
    When a maintainer reads the harness contract
    Then it states that the gate validates only the source-local monorepo CLI
```
### Q&A
- **Capture surface:** `--help` is authoritative; use `--json` only for nouns that already expose a machine inventory.
- **Test placement:** one helper plus at most one focused parity test. Existing tests are changed only when the assertion belongs to their current contract.
- **Provenance:** record `apps/cli/src/index.ts` resolution and the workspace package version; never execute a bare PATH `spur`.
- **Deferred:** validation of arbitrary published npm installations is explicitly outside this gate.
### Design
Create the test-only adapter at `plugins/sp/tests/helpers/cli-surface.ts`. Freeze these exports for downstream tasks:

- `parseCommanderHelp(text: string): { commands: string[]; flags: string[] }` parses only the current Commander `Commands:` and `Options:` blocks, deduplicates, and sorts results.
- `captureCliSurface(commandPath: string[] = []): CliSurfaceCapture` runs `[process.execPath, 'run', <repo>/apps/cli/src/index.ts, ...commandPath, '--help']` with the repository root as `cwd`; the path supports root (`[]`), noun (`['task']`), and noun+verb (`['task', 'update']`) capture. `CliSurfaceCapture` contains the parsed arrays plus provenance `{ entryPath, packageName: '@gobing-ai/spur', packageVersion }`.

Resolve the repository root from `import.meta.dir`; read version `0.3.43` dynamically from `apps/cli/package.json` rather than pinning it. Treat non-zero exit, missing help blocks required by the caller, or unreadable package metadata as test failures with the invoked argv in the message. Do not shell out to a bare `spur`, add a production abstraction, or attempt to parse arbitrary help formats.

0516 extends this same helper with structured scope parsers; 0517 supplies the single focused fixture/live parity suite. No production package changes.
### Plan
- [ ] Implement `parseCommanderHelp` and path-array `captureCliSurface` in `plugins/sp/tests/helpers/cli-surface.ts` (R1).
- [ ] Update `docs/design/plugin-surface-parity.md` only if its existing provenance/npm-skew text needs the frozen helper names added (R2).
- [ ] Run a source-local helper smoke import that captures root help and asserts non-empty commands plus `apps/cli/src/index.ts` / `@gobing-ai/spur@<version>` provenance; fixture/live assertions are completed by 0517.
- [ ] Run `bun test plugins/sp/tests/command-flag-parity.test.ts` to ensure the existing parity layer remains green, then hand the frozen helper API to 0516.
### Solution
**New: `plugins/sp/tests/helpers/cli-surface.ts`** — frozen capture layer for the parity harness.

| Location | What | Why |
| --- | --- | --- |
| `plugins/sp/tests/helpers/cli-surface.ts:25-39` (`CliSurfaceProvenance` / `CliSurfaceCapture`) | Typed capture result: sorted `commands`/`flags` arrays plus `{ entryPath, packageName: '@gobing-ai/spur', packageVersion }`. | Freezes the shape downstream tasks 0516/0517 consume; `packageName` is a literal (line 28), version is dynamic. |
| `plugins/sp/tests/helpers/cli-surface.ts:42-59` (`commanderBlock`) | Collects indented lines under a `Commands:`/`Options:` header; returns null when absent. | Narrow adapter — block membership = 2-space-indented lines after the header; stops at the first non-indented line (`Lifecycle:`/`Usage:`/blank). |
| `plugins/sp/tests/helpers/cli-surface.ts:61-79` (`parseCommanderHelp`) | Parses only Commander `Commands:`/`Options:` blocks; dedupes + sorts; absent block → empty array; throws when neither block exists. | Not a general help parser (per design §3): a non-Commander capture fails loudly instead of silently parsing garbage. |
| `plugins/sp/tests/helpers/cli-surface.ts:83-113` (`captureCliSurface(commandPath = [])`) | Runs `[process.execPath, 'run', <repo>/apps/cli/src/index.ts, ...commandPath, '--help']` (argv built at line 96) with the repo root as cwd; supports `[]` / `['task']` / `['task','update']`. | Source-local by construction — never a bare PATH `spur`, so a stale global binary cannot validate the wrong surface (design §2, R13). |
| `plugins/sp/tests/helpers/cli-surface.ts:84-92` | Reads `packageVersion` dynamically from `apps/cli/package.json` (currently `0.3.43`); unreadable/invalid metadata throws. | Provenance version must track the source tree, never a pinned constant. |
| `plugins/sp/tests/helpers/cli-surface.ts:98-101` | Non-zero exit → throw with the invoked argv + stderr in the message. | Fail loudly per the 0512 contract; the failing argv is directly actionable. |
| `plugins/sp/tests/helpers/cli-surface.ts:1-18` (doc comment, esp. lines 8-11) | npm-skew scope note (R2): published npm `spur` may lag the source-local CLI; the gate is deterministic only for the monorepo surface and cannot catch skew on end-user installs. | R2 documentation lives in both the helper contract and `docs/design/plugin-surface-parity.md` §2/§3. |

**New: `plugins/sp/tests/helpers/cli-surface.test.ts`** — focused helper test (5 tests):
fixture parsing (blocks, dedupe/sort, missing-`Commands:` block, non-Commander throw) and live captures
(root/noun/noun+verb) asserting non-empty sorted commands, known nouns/verbs/flags, and full
provenance (`apps/cli/src/index.ts` entry + `@gobing-ai/spur@<version>`). Deeper fixture/live
assertions are 0517's scope per the 2026-08-11 decomposition.

**Modified: `docs/design/plugin-surface-parity.md` §3** — added the frozen helper names
(`captureCliSurface` / `parseCommanderHelp` at `plugins/sp/tests/helpers/cli-surface.ts`) and a
one-line restatement that the gate validates only the source-local surface. The npm-skew text
already existed in §2 (R9/R13); §3 now points the frozen API at the same scope note (R2).

**Not changed:** production packages, CLI surface, runtime behavior — test-only adapter + docs, per the task's non-goals and design §8 (constraint R10).
### Testing
**Testing**

Re-audited 2026-08-11 via `/sp:dev-verifyall --feature I2 --force`: evidence re-run — cli-surface-parity + skill-structure 73 pass / 0 fail. Verdict artifact regenerated at `.spur/run/0512-verdict.json` (gitignored). Prior verdict evidence below remains accurate.

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/tests/helpers/cli-surface.ts` exports `captureCliSurface(commandPath = [])` (cli-surface.ts:84-112) and `parseCommanderHelp(text)` (cli-surface.ts:61-79). Capture invokes the monorepo entry via `[process.execPath, 'run', CLI_ENTRY, ...commandPath, '--help']` with `REPO_ROOT` as cwd (cli-surface.ts:96-97), supporting root/noun/noun+verb; returns sorted+deduped `commands`/`flags` arrays (cli-surface.ts:76-79); throws on non-zero exit with argv+stderr (cli-surface.ts:98-101); attaches `{ entryPath, packageName: '@gobing-ai/spur', packageVersion }` provenance (cli-surface.ts:24-32, 107-112) with version read dynamically from `apps/cli/package.json` (cli-surface.ts:84-92). Verified live: `bun test plugins/sp/tests/helpers/cli-surface.test.ts` → 8 pass / 0 fail, 100% line coverage on cli-surface.ts; `apps/cli/package.json` reports name `@gobing-ai/spur`, version `0.3.43`; entry `apps/cli/src/index.ts` exists. |
| R2 | MET | npm-skew scope documented in the helper contract (cli-surface.ts:8-11: "published npm `spur` may lag the source-local monorepo CLI... validates the monorepo CLI as built in this repository and cannot catch skew on end-user npm installs") and in `docs/design/plugin-surface-parity.md` §2 line 29 ("npm skew (R9) is a documented drift source: published `spur` can lag the monorepo CLI... validate the monorepo surface only") and §3 lines 36-37 (frozen helper names + "npm-skew scope (R2): published `spur` may lag the monorepo CLI (§2); this gate validates only the source-local surface"). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Surface capture proves source-local provenance | MET | test | `bun test plugins/sp/tests/helpers/cli-surface.test.ts` → 8 pass / 0 fail, 100% line coverage on cli-surface.ts. Live root capture (cli-surface.test.ts:44-52) asserts `provenance.entryPath.endsWith('apps/cli/src/index.ts')`, `packageName === '@gobing-ai/spur'`, `packageVersion` matches semver; noun/noun+verb capture (cli-surface.test.ts:56-61) asserts verb/noun surfaces. The helper constructs argv as `process.execPath bun run apps/cli/src/index.ts ... --help` (cli-surface.ts:96) with repo-root cwd — never a bare PATH `spur` — so a stale global binary cannot validate the wrong surface (doc comment cli-surface.ts:4-6). |
| Scenario: R2 — Published npm skew is documented [docs-only] | MET | static-ref | `docs/design/plugin-surface-parity.md:29` (§2: "published `spur` can lag the monorepo CLI, and the tests validate the monorepo surface only — they cannot catch skew on end-user installs"), `docs/design/plugin-surface-parity.md:36-37` (§3 frozen helper + "this gate validates only the source-local surface"), and helper contract `plugins/sp/tests/helpers/cli-surface.ts:8-11` (scope note R2: deterministic only for the source-local surface; arbitrary published installations outside the gate). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Severity | Dimension | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | Correctness (latent) | `cli-surface.ts:64-66` flags regex scans option descriptions, not just flag tokens — masked today by dedupe, but a description referencing a non-block flag would inject a phantom flag into the parity surface. | Accept for 0512; anchor regex to line start in 0516's scope-parser pass. |
| P4 | Correctness (latent) | `cli-surface.ts:71` empty-block guard uses substring `includes('Options:')`, so a hypothetical `Command Options:`-only output silently returns empty arrays instead of failing loudly. | Accept; harden guard to exact header presence when 0516 touches the helper. |

**Verdict: PASS with findings** — 0× P1, 0× P2, 0× P3, 2× P4. Traceability R1/R2 fully met; non-goals respected (test-only adapter + docs; no production change, no bare PATH `spur`). Verified live: helper suite 8/8 pass (100% line coverage on `cli-surface.ts`), existing parity layer 75/75 pass, live captures return sorted/deduped arrays with correct provenance (`apps/cli/src/index.ts` entry, `@gobing-ai/spur@0.3.43` read dynamically).

**Residual risk:** `## Testing` unfilled until the pipeline's record step; each capture spawns a fresh Bun process (~250–800 ms), fine for a helper but 0517 should batch captures; `--json` assertion is live-format-sensitive but fails loudly by design.

**Disposition:** PASS — no blockers; 2 latent P4s deferred to 0516 (which owns structured scope parsers on this same helper) with a documented cheap fix each. Approve for handoff to 0516/0517.
### References
- Feature: I2, scenarios R9 and R13
- Design: `docs/design/plugin-surface-parity.md` §§2–3, 7–8
- Decisions: ADR-053, ADR-054, ADR-055
- Source-local entry/version: `apps/cli/src/index.ts`; `apps/cli/package.json`
- Existing parity tests: `plugins/sp/tests/{command-flag-parity,flag-contract-parity,routing-table-parity,skill-structure}.test.ts`
- Dependent task: 0516 (scope parsers), then 0517 (focused assertions)
### History
- 2026-08-11T23:55:15.439Z todo → wip (system)
- 2026-08-12T00:05:40.439Z wip → testing (system)
- 2026-08-12T00:06:53.671Z testing → done (system)
