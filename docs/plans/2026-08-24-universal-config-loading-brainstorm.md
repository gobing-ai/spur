---
needs_design: true
topic: universal-config-loading
date: 2026-08-24
run_id: d6592bfe-0f6c-4d10-a220-a0d2e9f106ad
---

# Brainstorm — Universal Config Loading After Config 1.2 Migration

## Overview

Config file format 1.2 shipped with a layering contract: global `~/.config/spur/config.yaml` is
the default layer, project `.spur/config.yaml` merges over it (project wins; `agent.executors`
merge by `name`; `rules.paths`/`workflows.paths` concatenate; the merged object is validated
once). The merged loader exists and is tested: `loadSpurConfig` in
`packages/config/src/loader.ts:247`, with layering coverage in
`packages/config/tests/loader-layers.test.ts`.

But the CLI's composition root never consumes the merged result. `apps/cli/src/index.ts:55-89`
resolves a single path via `resolveConfigFile` (`project ?? global`) and hands it to ts-infra's
`runNodeApplication` configLoader, which loads only that one file. `loadSpurConfig` runs at
line 66 as a fail-fast validator whose merged result is then discarded. Consequence: whenever a
project has its own `.spur/config.yaml`, the entire global layer is invisible to
`context.agentConfig` — `spur agent doctor coder --json` fails with
`No executors configured to serve role 'coder'` (reproduced live, exit 1) even though the global
layer defines 15 executors and `agent.roles.coder`. The project's `agent:` block is fully
commented out, which the 1.2 layering contract explicitly supports ("a project config only needs
to carry its delta" — global config header).

A second defect in the same surface: doctor's role/executor failure paths call
`output.error(message)` unconditionally, emitting plain text under `--json`. The established
CLI convention is `toJson({ error: { code, message } })` (`agent.ts:746/756`,
`message.ts:415`, `builder.ts:44`, `projects.ts:39`).

### Answering the idea's three questions

1. **Is the universal loader ready?** Yes, at the library level. `loadSpurConfig` merges and
   validates both layers with by-name executor merge, mtime-keyed caching, and hermetic-test
   support (`SPUR_SKIP_GLOBAL_CONFIG`).
2. **Is it the only way config loads?** No. The runtime config for every CLI command comes from
   ts-infra's single-file `ApplicationConfigLoader` (`configFile?: string` + `overrides`;
   `node_modules/@gobing-ai/ts-infra/dist/application/types.d.ts:207`), not from
   `loadSpurConfig`. Secondary readers (`workflow-service.ts` ×4, `team-service.ts:869`,
   `serve.ts:404`, `history-refresh.ts:35`, `workflow.ts:195`) do use `loadSpurConfig` — so one
   process currently holds two different config truths depending on which path a consumer takes.
   `resolveAgentRoles(options.agentConfig)` (`apps/cli/src/context.ts:158`) silently fell back
   to `DEFAULT_AGENT_ROLES`, masking the wiring bug for role lookup while executor resolution
   failed.
3. **The doctor bug** is the composition-root split-brain above, plus the missing `--json`
   error envelope.

## Approaches

### Approach 1: Composition-root single-load — inject the merged config ⭐ Recommended

**Description:** Load once in `main()` via `loadSpurConfig(cwd)` and thread the merged
`SpurConfig` into the dispatch context, replacing `appRt.appConfig?.agent` as the `agentConfig`
source. `runNodeApplication` keeps ownership of the `bootstrap` section only (bootstrap is
project-shaped per the 0641 split, so single-file bootstrap loading is correct). ts-infra gains
either a pre-parsed config input on `ApplicationConfigLoader` or Spur stops routing app-config
through it — decided in system design. Ship the `--json` error envelope fix in the same batch.

**Trade-offs:**

- **Pros:**
  - Kills the split-brain at the root: one load, one validated object, every consumer agrees.
  - Matches the documented 1.2 contract byte-for-byte; no new config semantics invented.
  - Bootstrap stays with ts-infra (project-shaped), app sections come from the merged load —
    respects the existing project/global key split.
  - AGENTS.md guidance: "prefer fixing ts-libs facades over Spur workarounds" — the upstream
    input-shaping option is on the table here.
- **Cons:**
  - Touches two repos if the ts-infra input is added (release + version bump coupling).
  - Must preserve the pre-init/no-config path (`configFile === undefined` branch) and CF-safe
    core boundary (no fs in `packages/config` core).
  - Needs CLI-level layering regression tests, not just package-level ones (the existing
    loader-layers tests never exercised the composition root — that's why the bug shipped).

**Implementation Notes:**

- Primary edit: `apps/cli/src/index.ts` (`main()`), `apps/cli/src/context.ts` (`resolveAgentRoles`
  input). Consumers of `this.ctx.agentConfig` in `packages/app` need no change — the fix is at
  the seam.
- Doctor `--json`: route `resolveRole` / unknown-agent failures through
  `toJson({ error: { code, message } })` when `args.json` is set; keep exit codes.
- Sweep task (part of this approach, not separate work): audit every `appRt.appConfig` read and
  every config slice re-load; decide which per-slice `loadSpurConfig` calls in services should
  instead receive the already-loaded config from their context.
- Silent-fallback review: with a config file present, falling back to `DEFAULT_AGENT_ROLES`
  masked this bug; design should decide whether the CLI (non-CF) path warns when `agent.roles`
  resolves from the constant while a config file exists.

**Confidence:** HIGH
**Sources:** `packages/config/src/loader.ts:148-250` (layered loader + merge contract, read
2026-08-24); `apps/cli/src/index.ts:55-89` (split-brain site, read 2026-08-24);
`packages/app/src/services/agent-service.ts:438-460,1760-1766` (doctor + error site, read
2026-08-24); ts-infra `application/types.d.ts:207-218` (file-path-only loader, read 2026-08-24);
live reproduction of `bun run apps/cli/src/index.ts agent doctor coder --json` → plain-text
error, exit 1 (2026-08-24); both live config files read directly (2026-08-24).

### Approach 2: Push layering into ts-infra (`configFiles: string[]` + merge hook)

**Description:** Extend ts-infra's `ApplicationConfigLoader` to natively accept an ordered list
of config files plus an optional caller-supplied merge function. Spur passes
`[global, project]` and its merge semantics; every `runNodeApplication` consumer gets layering
for free.

**Trade-offs:**

- **Pros:**
  - Layering becomes a platform capability — no future app can re-create this split-brain.
  - Single load path everywhere, including bootstrap if desired.
- **Cons:**
  - Spur's merge is not generic last-wins (executors by `name`, team members by `id ?? executor`,
    paths concatenate) — ts-infra needs a merge-hook API, which is more surface to design,
    version, and support.
  - Larger upstream change with release coupling; slower to land.
  - YAGNI risk: Spur is the only known `runNodeApplication` consumer needing two layers today.

**Implementation Notes:**

- Blocked on ts-libs design + release; Spur-side change afterward is small.
- Can be a later evolution of Approach 1 — 1 does not preclude it.

**Confidence:** MEDIUM
**Sources:** ts-infra loader API surface (read 2026-08-24); merge semantics in
`packages/config/src/loader.ts:225-250` (read 2026-08-24). Effort/coupling assessment is
synthesized judgment, not a verified fact.

### Approach 3: Minimal spot-fix (patch the wiring, keep the split)

**Description:** One-line-class change: in `index.ts`, replace
`agentConfig: appRt.appConfig?.agent` with the `agent` slice of the already-called
`loadSpurConfig(cwd)` result; fix the doctor `--json` envelope; audit remaining
`appRt.appConfig` reads by hand.

**Trade-offs:**

- **Pros:**
  - Smallest diff; fixes the reported failure today; zero ts-libs coupling.
- **Cons:**
  - Leaves two config truths in one process (`context.agentConfig` merged vs
    `appRt.appConfig` single-layer) — the next surface reading `appRt.appConfig` reintroduces
    the bug class.
  - Does not deliver the idea's actual goal (universal, only-way loading); the "comprehensive
    review" finding remains unaddressed debt.
  - Per-slice re-loads and the silent role fallback stay as-is.

**Implementation Notes:**

- Valid as an emergency patch if a release is needed before Approach 1 lands; otherwise skip.

**Confidence:** HIGH
**Sources:** same files as Approach 1; diff size is directly observable in
`apps/cli/src/index.ts:66,89`.

## Recommendation

**Approach 1.** It is the smallest change that actually delivers the universal-loading contract:
the merged loader already exists and is tested — the work is wiring the composition root to it,
honoring the existing project/global key split (bootstrap stays single-file and project-shaped),
and normalizing doctor's error output to the CLI's own `--json` envelope convention. Approach 2
is a possible later hardening of ts-infra, not a prerequisite. Approach 3 is a patch that leaves
the bug class alive.

## Design Summary

**Problem:** Config 1.2 defined layered loading (global defaults + project override, merged and
validated once) and shipped the merged loader (`loadSpurConfig`), but the CLI composition root
still feeds every command from ts-infra's single-file load (`resolveConfigFile` →
`runNodeApplication`), discarding the merged result. Global-layer-only config (executors, roles,
`agent.default`) is invisible to agent dispatch whenever a project config exists; role lookup was
masked by the `DEFAULT_AGENT_ROLES` fallback while executor resolution failed loudly but
opaquely, and doctor's failure paths ignore the `--json` error-envelope convention.

**Chosen direction (subject to operator approval):** Composition-root single-load
(Approach 1). `main()` keeps the `loadSpurConfig` result; the merged config — not
`appRt.appConfig` — becomes the source for `context.agentConfig` and role resolution.
`runNodeApplication` retains the project-shaped `bootstrap` section only. The exact ts-infra
seam (new pre-parsed-config input vs Spur-side split of bootstrap/app loading) is deferred to
`sp:sys-architecture`; ADR-worthy. Doctor and sibling agent-command failure paths emit
`toJson({ error: { code, message } })` under `--json` with unchanged exit codes.

**Scope boundaries:** In scope — CLI bootstrap wiring, `--json` error envelopes on the agent
surface, a consumer audit (every `appRt.appConfig` read + per-slice `loadSpurConfig` call), and
CLI-level layering regression tests (global-only executors + commented project `agent:` block →
`agent doctor coder` resolves; `--json` failures parse as JSON). Out of scope — changing merge
semantics, the `version` field becoming a migrator key, CF/web config paths (already core-only),
approach 2's upstream layering API.

**Risks:** pre-init/no-config path must keep working (`configFile === undefined` branch); CF-safe
core must stay fs-free; ts-infra change (if chosen) needs a ts-libs release before Spur lands;
role-fallback masking needs an explicit decision (warn vs keep silent at CLI level).

**`needs_design: true` rationale:** multiple subsystems touched (`apps/cli` bootstrap,
`packages/config`, `packages/app` services, possibly ts-infra upstream); cross-cutting convention
(config loading is process-wide); potential new API surface in an external package. Meets three
`true` criteria outright; ties lean design anyway.

## Next Steps

1. Operator review of this artifact + the idea-evaluation report (idea-eval gate).
2. Feature-create + AC generation (idea-pipeline continues on approval).
3. `system-design` state runs (`needs_design: true`): decide the ts-infra seam, record ADR,
   author the consumer-audit checklist into the feature's decomposition.
4. Decompose into a task batch: composition-root wiring, doctor `--json` envelope, consumer
   sweep, CLI layering regression tests.
