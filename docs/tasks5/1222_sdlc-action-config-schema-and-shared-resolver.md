---
schema_version: 1
name: SDLC action config schema and shared resolver
status: todo
template: feature-impl
created_at: 2026-10-17T04:04:39.228Z
updated_at: "2026-10-17T04:16:41.518Z"
feature_id: A92
priority: P1
tags:
  - config
  - builder
estimate_hours: 4

---

## 1222. SDLC action config schema and shared resolver

### Background

Feature A92 (ADR-139, docs/design/sdlc-actions.md §3.1–3.2). Spur needs a closed reserved-action vocabulary bound per project through .spur/config.yaml builder.preset + builder.actions, resolved by one service shared by the CLI and the quality gate. Covers R2 and the resolution half of R11.

**Refine corrections (2026-10-16)**
- Design said the bun preset binds rules-pre/rules-post to the stack-neutral `spur rule run` bodies → today's light tier runs `bun run test-pre-check` / `bun run test-post-check` (packages/app/src/services/quality-gate.ts:557-558), and spur-new's test-post-check also runs coverage-provenance-check first (package.json:82) → the bun preset binds them to `bun run test-pre-check` / `bun run test-post-check`; the `spur rule run` bodies become the preset `none` defaults (satellite §3.1 corrected).
- formatCmd (config/workflows/task-pipeline.yaml:195) is a fourth bun default not listed earlier → the `format` reserved action and its preset entry cover it (consumed in 1224).

### Requirements

- [ ] R1. BuilderConfigSchema (packages/config/src/index.ts:917) accepts `preset: bun|none` (default `bun`) and `actions: Record<name, string | string[]>`; `bump-ver` is unchanged.
- [ ] R2. Load rejects a malformed action name, a composite step that resolves to no action, a composite cycle (error names the cycle path), a placeholder outside lint-changed/typecheck-changed/test-changed, and an empty string or empty list; each error names the key path (`builder.actions.<name>`).
- [ ] R3. `packages/app/src/services/sdlc-actions.ts` exports `RESERVED_ACTIONS`, `BUN_PRESET`, `resolveAction`, `listActions` and `renderScoped`; `renderScoped` quotes each substituted item with `shQuote` (quality-gate.ts:520).
- [ ] R4. With no builder block, every reserved action resolves to today's exact command (bun preset, satellite §3.1 table), including `rules-pre` → `bun run test-pre-check` and `rules-post` → `bun run test-post-check`.
- [ ] R5. Under `preset: none`, `rules-pre`/`rules-post` resolve to `spur rule run --preset recommended-pre-check|recommended-post-check --fail-on warning --no-logo`, and every other undeclared reserved action is `unbound`.
- [ ] R6. config.example.yaml and the generated config JSON schema document `builder.preset` and `builder.actions`.

Out of scope: the CLI verb (1223), engine/workflow consumers (1224), init seeding (1225), any runtime stack detection.

### Acceptance Criteria

- [ ] AC1 — Project config binds actions to stack-specific commands
- [ ] AC2 — Existing bun projects keep working without config changes

Requirement map: AC1 → R1, R2, R3, R5, R6; AC2 → R4. Test layer: packages/config schema tests + packages/app resolver table test (pure functions, no mocked collaborators).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:52.387Z

- Action names drop the operator's `cmd-` prefix: the `actions` map already scopes them (ADR-139).
- Custom names are allowed and exec-only; the reserved set is closed in code.
- Composites list action names, not raw commands, so each command is defined once.

#### Q&A entry — 2026-10-17T04:16:41.327Z

- Action names drop the operator's `cmd-` prefix: the `actions` map already scopes them (ADR-139).
- Custom names are allowed and exec-only; the reserved set is closed in code.
- Composites list action names, not raw commands, so each command is defined once.
- Bun preset keeps rules-pre/rules-post on the legacy scripts (closed 2026-10-16: byte-identity and coverage-provenance precondition outrank stack-neutral defaults under `bun`).

### Design

WHAT: config schema + one pure resolver module shared by the CLI verb (1223) and the quality gate (1224).
WHERE: `packages/config/src/index.ts` (schema, next to BuilderBumpVerConfigSchema), `packages/app/src/services/sdlc-actions.ts` (new), `config.example.yaml`.

Frozen names:
- `RESERVED_ACTIONS: readonly ReservedAction[]` = build, dev, clean, format, autofix, lint, typecheck, test, test-full, test-heavy, rules-pre, rules-post, check, check-full, check-feature, lint-changed, typecheck-changed, test-changed.
- `type ActionSource = 'config' | 'preset' | 'default' | 'unbound'`.
- `type ResolvedAction = { name: string; reserved: boolean; source: ActionSource } & ({ kind: 'command'; command: string } | { kind: 'composite'; steps: string[] } | { kind: 'unbound' })`.
- `resolveAction(builder: BuilderConfig | undefined, name: string): ResolvedAction`
- `listActions(builder: BuilderConfig | undefined): ResolvedAction[]` (reserved first in vocabulary order, then declared custom names sorted).
- `renderScoped(command: string, values: { files?: string[]; paths?: string[]; workspace?: string }): string` — `{files}`/`{paths}` → space-joined shQuote'd items; `{workspace}` → one shQuote'd item.
- `BUN_PRESET: Readonly<Record<ReservedAction, string>>` — the satellite §3.1 bun column verbatim; `typecheck-changed` = `cd {workspace} && bun run typecheck`, `test-changed` = `cd {workspace} && bun test {paths}`, `lint-changed` = `bunx biome check {files}`.

Algorithm: `builder.actions[name]` → (preset bun) `BUN_PRESET[name]` → (preset none) stack-neutral rules default → unbound. Cycle detection: DFS over composite steps at schema superRefine time; report the first cycle as `a → b → a`.

Why: one table holds every bun literal, so 1224 can delete them from the engine; byte-identity under the bun preset is what keeps superskill/knowledge-kit green with no config edit.

Anti-patterns: do not shell out or touch the filesystem in the resolver (pure); do not merge preset and declared composites (a declared entry replaces the preset entry whole); do not accept raw commands inside composite lists; do not import sdlc-actions from packages/config (dependency direction is app → config).

Handoff: 1223 and 1224 consume `resolveAction`/`listActions`/`renderScoped` unchanged; 1225 writes config that this schema validates.

### Plan

1. Write the failure-mode list (malformed name, dangling step, self-cycle, 2-cycle, stray placeholder, empty value, wrong type) as test cases in packages/config/tests (isolated schema parsing is the one permitted unit layer here).
2. Extend BuilderConfigSchema with preset + actions + superRefine (R1, R2).
3. Add sdlc-actions.ts with RESERVED_ACTIONS, BUN_PRESET, resolver, lister, renderScoped (R3–R5).
4. Pin R4 with a table test asserting every BUN_PRESET entry equals the satellite §3.1 bun column and today's quality-gate literals.
5. Document both keys in config.example.yaml; regenerate the config JSON schema (R6).
6. `(cd packages/config && bun test)`, `(cd packages/app && bun test)`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
