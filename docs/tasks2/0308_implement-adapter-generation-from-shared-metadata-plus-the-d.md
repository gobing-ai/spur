---
template: feature-impl
schema_version: 1
name: "Implement adapter generation from shared metadata plus the drift-test contract"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-2", "adapters", "drift-test", "feature-O"]
dependencies: []
created_at: "2026-07-20T03:32:22.469Z"
updated_at: "2026-07-21T18:39:44.925Z"
---

## 0308. Implement adapter generation from shared metadata plus the drift-test contract

### Background

Wave-2 of feature O (0283 R4/R8, dependency tier 2). Generate/validate Claude Code slash and Codex dollar-skill adapters from common command metadata, plus the drift-test contract that keeps them honest. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0283) and docs/tasks2/0283_*.md.

### Requirements
R1. Implement generation/validation of Claude Code `/sp:dev-*` slash and Codex `$sp-dev-*` skill wrappers from shared command metadata (name, argument-hint, allowed-tools, skill target) (0283 R4).
R2. Enforce that wrappers carry invocation syntax + the delegation line only — no domain workflow prose; lifecycle semantics live in the dispatched skill (0283 R4).
R3. Implement the drift-test contract: (a) contract test — every wrapper's skill target exists and resolves; (b) metadata-parity test — slash vs dollar-skill wrappers over the same command carry identical name/argument-hint; (c) no-prose test — wrapper bodies contain no lifecycle prose beyond the delegation line (grep gate) (0283 R8).
R4. Implement platform/skill snapshot invalidation (a command's `.md` snapshotted at session start runs the stale body; adapters version the snapshot and a fresh session is required to trust an in-session dogfood of a just-edited command) (0283 R7).
### Acceptance Criteria
Derived from 0283 R4/R7/R8 (feature O wave-2). Each scenario maps to an executable gate in
`plugins/sp/tests/adapter-drift.test.ts` or the generator CLI.

**Scenario: AC1 — Both surfaces generate from one metadata source (R1)**
- **Given** `plugins/sp/scripts/command-registry.ts` holds the shared `CommandMeta` entries
- **When** `bun plugins/sp/scripts/generate-adapters.ts` runs
- **Then** every Claude slash wrapper in `commands/` and every Codex wrapper in `adapters/codex/`
  is rendered from that registry, and the run reports the full wrapper count.

**Scenario: AC2 — Drift check is a CI-usable gate (R1, R3)**
- **Given** the wrappers on disk are in sync with the registry
- **When** `bun plugins/sp/scripts/generate-adapters.ts --check` runs
- **Then** it exits 0; when any wrapper is hand-edited it exits non-zero and names the drifted file.

**Scenario: AC3 — Wrappers carry no domain workflow prose (R2)**
- **Given** a generated wrapper on either surface
- **When** the no-prose gate runs
- **Then** the file matches a fresh render byte-for-byte, and its heading set is exactly
  `['Usage', 'Implementation']` beyond the title — lifecycle prose lives in the dispatched skill.

**Scenario: AC4 — Every wrapper's dispatch target resolves (R3a)**
- **Given** each registry entry declares a target (skill / skill-routed / composite / workflow / procedure)
- **When** the contract test runs
- **Then** every referenced skill, workflow, or procedure target exists on disk.

**Scenario: AC5 — Slash and dollar-skill wrappers stay in metadata parity (R3b)**
- **Given** a command with both a Claude and a Codex wrapper
- **When** the parity test runs
- **Then** both carry identical name and argument-hint metadata.

**Scenario: AC6 — Snapshot markers make staleness detectable (R4 / 0283 R7)**
- **Given** each wrapper embeds an `adapter:generated v<n> snapshot:<hash>` marker
- **When** any registry metadata field changes
- **Then** the recomputed hash differs from the embedded one, and the marker states that a fresh
  session is required before trusting an in-session dogfood of a just-edited wrapper.

**Scenario: AC7 — The change clears the repo quality gate**
- **Given** the generator, registry, wrappers, and drift tests are in place
- **When** `bun run lint`, `bun run test-pre-check`, and the `plugins/sp` suite run
- **Then** all pass, with 100% function coverage on both new scripts.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Core artifacts — generator + registry + drift-test**

| File | What |
|------|------|
| `plugins/sp/scripts/command-registry.ts:1` | 28 `CommandMeta` entries, `CommandTarget` union (5 variants: skill/single-routed/composite/workflow/procedure). SSOT for all wrapper metadata: name, argument-hint, allowed-tools, target kind, skill references, delegation line generation. |
| `plugins/sp/scripts/generate-adapters.ts:25` | Generator + `--check` validator. `TEMPLATE_VERSION=1`, `snapshotHash():45`, `wrapsLine():66`, `claudeDelegation():92`/`codexDelegation():124`, `renderClaudeWrapper():161`/`renderCodexWrapper():187`, `checkAdapters():223`/`writeAdapters():243`, `runCli:292`/`bootMain:331` seam pattern for 100% function coverage. |
| `plugins/sp/commands/*.md` (28 files) | Regenerated Claude Code slash wrappers — frontmatter + thin delegation only; no domain prose. Each carries `adapter:generated v1 snapshot:<hash>` marker (R7). |
| `plugins/sp/adapters/codex/sp-*.md` (28 files) | Codex dollar-skill wrappers (`disable-model-invocation: true`). `Skill()` is Claude-specific; skill dispatches render as prose invocation. `../../skills/` link prefix depth. |
| `plugins/sp/tests/adapter-drift.test.ts:1` | Full drift-test contract: R3(a) target resolution, R3(b) metadata-parity, R3(c) no-prose byte-exact regeneration + forbidden-heading grep gate, R4 snapshot freshness. Plus generator unit tests: `wrapsLine`, `claudeDelegation`, `codexDelegation`, yaml quoting, path helpers, `checkAdapters`/`writeAdapters`, `parseCliArgs`, `renderHelp`, `runCli`, `bootMain`. |

**Prose migration (pre-generation — HAS-UNIQUE semantics moved into skill references)**

| Skill / reference file | What moved | Where from |
|------------------------|------------|------------|
| `plugins/sp/skills/brainstorm/references/grilling-interview.md:1` | Discovery interview workflow (§Arguments) | `plugins/sp/commands/dev-brainstorm.md` |
| `plugins/sp/skills/next-router/references/messages.md:1` | Message-id catalog (U1–U4, U-HITL, U-GUARD, P1–P3, W-FULL) (R52) | `plugins/sp/commands/dev-next.md` §Operator messages |
| `plugins/sp/skills/spur-cli/references/init.md:1` | `spur init` bootstrap workflow | `plugins/sp/commands/spur-init.md` |
| `plugins/sp/skills/dogfood-testing/SKILL.md:1` | Monitor ledger, live/report templates (§Arguments) | `plugins/sp/commands/dev-dogfood.md` |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:1` | +91 lines: Task execution pipeline walkthrough | `plugins/sp/commands/dev-run.md` |
| `plugins/sp/skills/spur-dev/references/gate-checklists.md:89` | +55 lines: `testing → done` three-layer gate | `plugins/sp/commands/dev-next.md` + `plugins/sp/commands/dev-verify.md` |
| `plugins/sp/skills/spur-dev/references/implementation-patterns.md:1` | +16 lines: Implement-step patterns | `plugins/sp/commands/dev-run.md` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:1` | +105 lines: Daily ops guide | Multiple commands |
| `plugins/sp/skills/spur-dev/references/ac-style-guide.md:1` | AC → CLI command mapping | `plugins/sp/commands/dev-plan.md` |
| `plugins/sp/skills/spur-cli/references/tasks/verbs.md:1` | Answer-file shape reference | Cross-ref from gate-checklists |

**Test adaptations**

| File | What |
|------|------|
| `plugins/sp/tests/skill-structure.test.ts:1` | R52: message-id assertions moved from `commands/dev-next.md` to `references/messages.md`. R22: dogfood template assertions moved from command to SKILL.md. R16c/R21/R29/R45/R49 retargeted to thin-wrapper contract. |
| `plugins/sp/tests/adapter-drift.test.ts:98` | `sp-runtime-path` compliance: workflow assertions use `.spur/workflows` path. |

**Docs (T3 same-commit)**

| File | What |
|------|------|
| `plugins/sp/README.md:333` | §2 Commands: "Generated adapters (feature O, task 0308)" paragraph — SSOT, generator CLI, no-prose invariants, snapshot marker. Tree listing shows `commands/` as "GENERATED", `adapters/codex/` line. Orphaned pre-0308 bullet removed (P2 fix). |
| `docs/04_DESIGN.md:1` | §1.3 "Agent command surface — generated adapters" — artifact table, 0283 invariants. |
| `plugins/sp/skills/next-router/SKILL.md:87` | §Operator messages: removed stale `dev-next.md` mirror claim (P2 fix). |

**Design decisions**

- **Thin-wrapper contract (0283 R4/R7/R8):** Wrappers carry frontmatter + invocation syntax + one delegation line only. No domain workflow prose. Snapshot hash markers version each wrapper. Byte-exact regeneration = no-prose drift gate.
- **5 CommandTarget variants:** `skill`, `skill-routed`, `composite`, `workflow`, `procedure`.
- **Codex adapters:** `plugins/sp/adapters/codex/sp-<name>.md`, `disable-model-invocation: true`. `Skill()` is Claude-specific; codex uses prose invocation.
- **Coverage seam:** `runCli`/`bootMain` extraction enables 100% function coverage on both new scripts.
### Testing
**Re-audit 2026-07-21** (`/sp:dev-verify 0308 --force --focus all --fix all`) — all evidence below
re-run this session against the working tree; every `file:line` anchor re-read at the cited lines.

- Verdict: PASS

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Generate/validate Claude slash + Codex skill wrappers from shared metadata | MET | `plugins/sp/scripts/command-registry.ts` (28 `CommandMeta` entries, 5-variant `CommandTarget` union); `plugins/sp/scripts/generate-adapters.ts:45` `snapshotHash`, `renderClaudeWrapper`/`renderCodexWrapper`. Command: `bun plugins/sp/scripts/generate-adapters.ts --check` → `all adapters in sync (56 files, registry v1)`, exit 0. Disk count verified: 28 `commands/*.md` + 28 `adapters/codex/*.md`. |
| R2 — Wrappers carry invocation + delegation only, no domain prose | MET | `plugins/sp/tests/adapter-drift.test.ts:148` `(c) no-prose`: byte-exact re-render (`:151-152`) **plus** a heading whitelist (`:164-165`) asserting the heading set equals exactly `['Usage','Implementation']`, and a forbidden-heading regex (`:157`). Whitelist is the binding gate; byte-exactness alone would be tautological. Enabled by the prose migration into skill references (see Solution §"Prose migration"). |
| R3 — Drift-test contract (a) target resolution (b) metadata parity (c) no-prose | MET | `plugins/sp/tests/adapter-drift.test.ts:83` `(a) contract — every wrapper target resolves`; `:122` `(b) metadata parity — slash vs dollar-skill wrappers`; `:148` `(c) no-prose`. Command: `bun test plugins/sp/tests/adapter-drift.test.ts` → 28 pass / 0 fail, 604 expect() calls. |
| R4 — Platform/skill snapshot invalidation (0283 R7) | MET | `plugins/sp/scripts/generate-adapters.ts:45` `snapshotHash()` — sha256 over `{TEMPLATE_VERSION, ...meta}`, first 12 hex. Marker on disk (`plugins/sp/commands/dev-verify.md:19`, `plugins/sp/adapters/codex/sp-dev-verify.md:19`): `adapter:generated v1 snapshot:802e4d08ca85 — … a fresh session is required to trust an in-session dogfood of a just-edited wrapper`. Gates: `plugins/sp/tests/adapter-drift.test.ts:172` `(d) snapshot invalidation` — embedded hash === recomputed (`:173`), hash changes on any metadata edit (`:181`), marker mandates fresh session (`:189`). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — Both surfaces generate from one metadata source | MET | command | `bun plugins/sp/scripts/generate-adapters.ts --check` → `all adapters in sync (56 files, registry v1)`, exit 0 |
| AC2 — `--check` exits 0 in sync, non-zero on drift | MET | test + command | exit 0 observed above; drift path covered by `adapter-drift.test.ts:263` `checkAdapters / writeAdapters` |
| AC3 — Wrappers carry no domain workflow prose | MET | test | `adapter-drift.test.ts:164-165` heading set === `['Usage','Implementation']`; `:151-152` byte-exact re-render |
| AC4 — Every wrapper's dispatch target resolves | MET | test | `adapter-drift.test.ts:83` `(a) contract — every wrapper target resolves` |
| AC5 — Slash/dollar-skill metadata parity | MET | test | `adapter-drift.test.ts:122` `(b) metadata parity` |
| AC6 — Snapshot markers make staleness detectable | MET | test + static-ref | `adapter-drift.test.ts:172-194`; marker on disk at `plugins/sp/commands/dev-verify.md:19` |
| AC7 — Change clears the repo quality gate | MET | command | `bun run lint` → biome 524 files clean + 7/7 workspace typechecks exit 0; `bun run test-pre-check` → `All 33 rules passed`; `bun test plugins/sp/tests/` → 280 pass / 0 fail |

- Coverage: `plugins/sp/scripts/command-registry.ts` 100.00% funcs / 100.00% lines;
  `plugins/sp/scripts/generate-adapters.ts` 100.00% funcs / 99.56% lines (measured this run via
  `bun test plugins/sp/tests/adapter-drift.test.ts`).

**Fix-pass record (`--fix all`)** — two evidence-integrity defects found in the prior verdict and
repaired this run; no production code changed:

1. `docs/tasks2/0308_*.md` `### Acceptance Criteria` was an empty template placeholder while the
   prior Testing table asserted AC1–AC6. Those AC rows had no corpus provenance (invented at verify
   time). Fixed: the section now holds 7 derived Gherkin scenarios, and the AC table above traces
   to them.
2. The prior R4 row described "HAS-UNIQUE prose migrated into skill references" — the wrong
   subject. Task R4 is snapshot invalidation (0283 R7); the real implementation
   (`snapshotHash`, the marker, gate `(d)`) was never cited. Fixed above; the prose-migration work
   is retained as R2-supporting evidence, which is what it actually is.

No `.spur/run/**` artifact was mutated by the fix pass beyond `.spur/run/0308-verdict.json`
(rewritten at Step 11 with the corrected requirement/AC rows).
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-21T15:20:38.110Z todo → wip (system)
- 2026-07-21T15:20:38.353Z wip → testing (system)
- 2026-07-21T18:34:54.884Z testing → done (system)
