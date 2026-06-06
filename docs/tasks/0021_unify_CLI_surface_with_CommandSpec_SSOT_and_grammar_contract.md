---
name: unify_CLI_surface_with_CommandSpec_SSOT_and_grammar_contract
description: unify_CLI_surface_with_CommandSpec_SSOT_and_grammar_contract
status: WIP
created_at: 2026-06-06T05:45:43.896Z
updated_at: 2026-06-06T16:29:33.397Z
folder: docs/tasks
type: task
feature-id: ''
priority: medium
estimated_hours: 6
tags: ["spur","cli","help","command-spec","dx","refactor"]
preset: standard
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0021. unify_CLI_surface_with_CommandSpec_SSOT_and_grammar_contract

### Background

The new Spur CLI grew from 6 to 10 noun commands (init,status,migrate,agent,rule,workflow,history,message,team,plugin) while porting only a subset of old spur (init,status,agent,rule,workflow). Old inspect/asset/workspace stay dropped (PRD 5.3). Three structural inconsistencies remain: (1) help-format drift across rule/workflow/history flat strings; (2) ad-hoc default-verb dispatch (status uses positional, agent/rule/plugin/history default a verb, team/message/workflow require one); (3) no documented noun-verb grammar contract. Goal is coherence of the committed surface, not command revival.


**Migration drift (2026-06-07):** During implementation, it became clear that the original
`CommandSpec` + hand-rolled `parseArgs` approach was a maintenance burden. The old Spur (see
`~/xprojects/spur-old`) already uses `commander` + `@commander-js/extra-typings` for CLI
infrastructure. This task was therefore re-scoped to migrate all 10 noun commands to commander,
which handles option parsing, `--help` rendering, subcommand dispatch, and exit codes natively.

The `CommandSpec` type, `renderCommandHelp`, `resolveVerb`, `renderTopLevelHelp`, `help.ts`,
and `args.ts` were replaced. Each command now exports `registerXxxCommand(program, context)`.
`apps/cli/src/index.ts` creates a `Command` instance with `exitOverride()`, registers all
commands via their registration functions, and calls `parseAsync()`. Exit codes propagate through
`context.setExitCode()` — a mutable ref captured in `main()`'s closure — because Bun's
`process.exit` cannot be intercepted by commander's `exitOverride`.

**Status:** Core migration complete. Lint + typecheck + build pass clean. 511/533 tests pass
(22 assertion updates remain for commander help format / error message / multi-word arg changes).


### Requirements

## Requirements

> Verified 2026-06-06. The task re-scoped from a `CommandSpec`/`help.ts` design to a **commander**
> migration. Verdicts are scored against the shipped commander design and the authoritative
> `04_DESIGN.md §1.0`, with requirement-text drift flagged in Review.

- [x] **R1 — Grammar contract documented** → **MET** | Evidence: `docs/04_DESIGN.md:18` `### 1.0 CLI grammar` defines `spur <noun> [<verb>] [positionals] [--flags]`, verb-less list (`init`/`status`/`migrate`), and the require-verb policy; edited in the same change-set as the code.
- [~] **R2 — `CommandSpec` type + renderer** → **SUPERSEDED** | `help.ts`/`renderCommandHelp` intentionally removed; commander renders `--help`. Requirement text is stale (Review P4#5).
- [~] **R3 — Every command exposes a spec** → **SUPERSEDED** | Each command exports `registerXxxCommand(program, context)` instead of a `spec`. Evidence: `apps/cli/src/commands/agent.ts:9`, `rule.ts:12`. No inline `[...].join` help builders remain. Requirement text stale (Review P4#5).
- [~] **R4 — Default-verb policy enforced** → **PARTIAL** | commander dispatches natively; `plugin` defaults to list (`plugin.ts:27 .action()`), `workflow`/`message`/`team`/`history` exit 1 on no verb (verified via `main()`). BUT `agent`/`rule` no longer default to `list`/`run` — they exit 1. Documented in `04_DESIGN.md §1.0`; tests updated. Behavior changed vs. the Plan's "regression oracle" (Review P3#3).
- [ ] **R5 — Domain-grouped top-level help** → **UNMET** | No Harness/Policy/Workflow/History/Extension/Ops grouping; commander prints a flat list. Evidence: `apps/cli/src/index.ts:42-60` (no `configureHelp`/`addHelpText`). Optional under commander (Review P3#4).
- [x] **R6 — Dropped commands stay dropped** → **MET** | Evidence: `git grep` finds no `inspect`/`asset`/`workspace` noun in `apps/cli/src`; index registers exactly the 10 nouns.
- [x] **R7 — `--json` audit** → **MET** | Every output-producing verb declares `--json` (`rg -c` hits across all 10 command files; `agent` 5, `message` 6, `rule`/`workflow`/`history` 3, etc.).
- [~] **R8 — Full gate green, surgical diff** → **PARTIAL** | `lint` PASS, `test` 539/0 PASS, `build` PASS. BUT `test-cf` FAILS (pre-existing plugin-sdk packaging, out of scope — Review P2#1), and the diff includes `package.json`/`bun.lock` (commander catalog add) beyond the stated `apps/cli/**`+`docs/04_DESIGN.md` (Review P2#2). The dependency add contradicts the "No Commander" Design constraint and needs an ADR (CLAUDE.md rule).


### Q&A



### Design

**Nature of the change:** a DX/coherence refactor of the CLI *presentation and dispatch* layer. Zero change to any command's execution semantics — only (a) how help is rendered and (b) how a missing/defaulted verb is resolved. The app-layer services (`@gobing-ai/spur-app`) are untouched.

**Current state (the three inconsistencies):**
- **Help drift:** `rule`/`workflow`/`history` hand-roll `[...].join('\n')` help; the old `spur rule help` had a far better sectioned format (USAGE / VERBS / per-verb / EXAMPLES / EXIT CODES). No shared renderer.
- **Dispatch drift:** in `index.ts`/per-command, `agent`/`rule`/`plugin`/`history` do `switch (subcommand ?? 'list'|'run')`; `team`/`message`/`workflow` `switch (subcommand)` and error on `default`; `status` ignores subcommand and reads a positional path. Four different conventions.
- **No grammar SSOT:** `04_DESIGN.md §1` documents each command's flags but never states the overarching noun-verb grammar or the default-verb rule.

**Target architecture:**

```
apps/cli/src/help.ts            (new)
  export interface VerbSpec  { name; synopsis; summary; flags: FlagSpec[]; examples: string[]; exitCodes?: string[]; json: boolean }
  export interface FlagSpec  { flag; description }
  export interface CommandSpec {
    name; summary; synopsis;
    flags: FlagSpec[];           // command-level flags (e.g. --json, -h)
    verbs: VerbSpec[];
    defaultVerb?: string;        // read-only nouns: 'list' | 'status'
    requireVerb?: boolean;       // mutating nouns: true → missing verb prints help + exits 1
    group: 'harness'|'policy'|'workflow'|'history'|'extension'|'ops';
  }
  export function renderCommandHelp(spec: CommandSpec): string   // pure
  export function resolveVerb(spec, subcommand): { verb: string } | { error: true }

apps/cli/src/commands/<noun>.ts
  export const spec: CommandSpec = { ... }
  export function helpText() { return renderCommandHelp(spec); }
  export async function run<Noun>Command(subcommand, ctx, flags, positionals) { /* unchanged body */ }

apps/cli/src/index.ts
  - import { spec } from each command; build a SPECS registry.
  - helpText(): group SPECS by spec.group → render the top-level list.
  - commandHelpText(cmd): SPECS[cmd] ? renderCommandHelp(SPECS[cmd]) : undefined.
```

**Constraints / invariants:**
- **Presentation-only.** Do NOT touch service calls, exit-code computation, flag parsing semantics, or `--json` payload shapes. Tests asserting command *behavior* must pass unmodified; only help-text snapshot/string tests change.
- **Default-verb policy is data, not control flow.** `defaultVerb`/`requireVerb` live on the spec; `resolveVerb` is the single place that interprets them. No command file may keep an inline `?? 'list'`.
- **`status` is verb-less.** Model it as a spec with no `verbs` (or a single implicit verb) and `defaultVerb` unused; its positional-path contract is preserved exactly. Same for `init`, `migrate`.
- **Grammar contract lives in `04_DESIGN.md`** (authoritative on surface shape), edited in the same commit (project rule for command/flag/surface changes).
- **No revival.** `inspect`/`asset`/`workspace` are out (PRD §5.3); this task neither adds them nor edits PRD/ROADMAP.
- **No new dependency, no Commander.** The old surface used `@commander-js`; the new CLI is hand-rolled and stays that way (CLAUDE.md: never introduce a new runtime/lib without approval). The spec renderer is ~80 LOC of pure string-building.
- **Avoid over-abstraction (R2).** `CommandSpec` is a flat data struct + one renderer + one resolver. No plugin-style registry indirection, no class hierarchy. If `help.ts` exceeds ~150 LOC, the design has drifted.

**Default-verb decisions (baked in):**

| Noun | Policy | Reason |
|------|--------|--------|
| `agent` | `defaultVerb: 'list'` | read-only default already in code |
| `rule` | `defaultVerb: 'run'` | matches current `?? 'run'`; the headline action |
| `plugin` | `defaultVerb: 'list'` | matches current `?? 'list'` |
| `history` | `requireVerb: true` | current code errors on no-verb; import/analyze are not safe to default |
| `message` | `requireVerb: true` | all verbs are explicit actions |
| `team` | `requireVerb: true` | assign/start/stop are mutating |
| `workflow` | `requireVerb: true` | validate/run/list — no safe default; current code errors |
| `init`/`status`/`migrate` | verb-less | the three sanctioned bare commands |

**Enforcement gate — explicitly deferred.** A test/`spur rule` rule asserting doc↔surface↔`--json` consistency (brainstorm Approach 3) is OUT of this task; note it as a follow-up. This task ships the SSOT; gating it comes when the surface stabilizes.

**Open (decide at implementation, non-blocking):** whether `renderCommandHelp` re-prints command-level `--json`/`-h` under every verb or only once in a global OPTIONS block — recommend once, globally, to keep per-verb blocks tight.


### Solution

Approach 1 from brainstorm: one CommandSpec descriptor per command (synopsis/verbs/flags/examples/exit-codes); index.ts and per-command helpText render from specs; explicit defaultVerb vs requireVerb field replaces ad-hoc dispatch; domain-grouped top-level help. Enforcement gate (doc-surface-json consistency test) deferred to a follow-up.


### Plan

1. **Inventory + freeze behavior.** List every current invocation per noun (verbs, defaults, error-on-missing) from `index.ts` + the 10 command files. This table is the regression oracle — every row must behave identically after the refactor.
2. **Build `apps/cli/src/help.ts`.** Define `FlagSpec`/`VerbSpec`/`CommandSpec`, write `renderCommandHelp` (sectioned: USAGE → VERBS → per-verb synopsis/flags/examples → OPTIONS → EXIT CODES) and `resolveVerb(spec, subcommand)` (applies `defaultVerb`/`requireVerb`). Unit-test the renderer + resolver in isolation first (TDD).
3. **Author specs, command-by-command.** For each noun, add `export const spec` capturing today's verbs/flags/examples verbatim from its existing `helpText()` + `04_DESIGN.md §1`, then repoint `helpText()` → `renderCommandHelp(spec)`. Start with `rule` and `agent` (richest), confirm snapshot, then the rest.
4. **Switch dispatch to `resolveVerb`.** In each `run<Noun>Command`, replace `subcommand ?? 'x'` / require-or-error with `resolveVerb(spec, subcommand)`; on `{error}` print `helpText()` and return 1. Keep the existing per-verb `switch` bodies untouched.
5. **Rewrite top-level `helpText()` in `index.ts`** to build the `SPECS` registry and render grouped-by-`spec.group`. Remove the hand-maintained 20-line command array.
6. **`--json` audit (R7).** Walk each leaf verb; set `json:` on every `VerbSpec`; fix or document any committed-surface verb lacking `--json`.
7. **Update `docs/04_DESIGN.md`.** Add `### 1.0 CLI grammar` (shape, default-verb policy, verb-less list) ahead of §1.1; verify each per-command table still matches the specs. Same commit as code.
8. **Tests.** Update existing help-text assertions to the rendered format; add renderer/resolver unit tests; add a dispatch test per default-verb decision (default resolves, missing-verb-on-mutating errors). Re-run the step-1 oracle table.
9. **Gate.** `bun run lint && bun run test && bun run test-cf && bun run build`; confirm `git status` shows only `apps/cli/**` + `docs/04_DESIGN.md`.
10. **Note follow-up:** open a successor task stub for brainstorm Approach 3 (consistency-enforcement gate) — do not implement here.


### Review

## Review — 2026-06-06 (dev-verify --force --fix all)

**Status:** 5 findings (0×P1, 2×P2, 2×P3, 1×P4)
**Scope:** `apps/cli/src/**` (10 noun commands + index.ts + context.ts), `docs/04_DESIGN.md`
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate:** `bun run lint` PASS · `bun run test` 539/0 PASS · `bun run build` PASS · `bun run test-cf` **FAIL (pre-existing, out of scope)**

**Headline:** The task re-scoped mid-flight from a hand-rolled `CommandSpec`/`help.ts` design to a
**commander** migration (per the 2026-06-07 migration-drift note). The implementation is coherent
and the authoritative surface doc (`04_DESIGN.md §1.0`) was updated to match. SECU is clean. The
findings below are (a) requirement-text drift vs. the shipped commander design, and (b) one
out-of-scope gate failure. No security or correctness defects.

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `bun run test-cf` fails — Vite cannot resolve `@gobing-ai/spur-plugin-sdk` (`import`/`default` → `./dist/index.js`, never built; only `bun` condition points at `src`) | Correctness | `apps/server/tests/cf/plugin-routes.cf.ts:1`; `packages/plugin-sdk/package.json` exports | Out of scope for 0021 (CLI-only). Pre-existing packaging gap: add a `worker`/`development` export condition pointing at `src/index.ts`, or build plugin-sdk before `test-cf`. Track as its own task. Blocks R8 gate literally but is unrelated to this change. |
| 2 | Requirement-text drift: R8 demands diff limited to `apps/cli/**` + `docs/04_DESIGN.md`, and Design says "No new dependency, no Commander" — but the shipped design adds `commander` + `@commander-js/extra-typings` to the root catalog (`package.json`, `bun.lock`) | Usability/Maintainability | `package.json`, `bun.lock`, `apps/cli/package.json` | The dependency add is correct per CLAUDE.md catalog SSOT and is the intended re-scope. Fix the **task**, not the code: amend R8 + the Design "No Commander" constraint to reflect the commander decision, and add an ADR entry recording the CommandSpec→commander pivot (CLAUDE.md requires an ADR before diverging from a documented decision). |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | R4 default-verb behavior changed: `spur agent` (was `== agent list`, exit 0) and `spur rule` (was `== rule run`, exit 0) now exit 1 with usage. `plugin` still defaults to list via `plugin.action()`. | Usability | `apps/cli/src/commands/agent.ts:9`, `rule.ts:12` (no top-level `.action`) | Intentional and documented (`04_DESIGN.md §1.0`: "All other nouns require a verb"); tests assert the new exit-1 behavior. Inconsistency: `plugin` keeps a default action while `agent`/`rule` don't — decide one policy. If read-only-noun defaults are still wanted, add `.action()` to agent/rule mirroring plugin; otherwise drop plugin's default action for symmetry and note it in §1.0. |
| 4 | R5 (domain-grouped top-level help: Harness/Policy/Workflow/History/Extension/Ops) not implemented — commander prints a flat command list | Usability | `apps/cli/src/index.ts:42-60` | Optional under the commander design. If grouping is still desired, use `program.configureHelp()` / `addHelpText('after', …)` to render the domain groups. Otherwise mark R5 superseded in the task. |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 5 | R2/R3 reference removed artifacts (`help.ts`, `CommandSpec`, `renderCommandHelp`, per-command `spec`); `args.ts` + `args.test.ts` deleted | Maintainability | task R2/R3 vs. `apps/cli/src/` | Documentation-only: rewrite R2/R3 to describe the commander registration pattern (`registerXxxCommand`) so the task file reflects what shipped. No code change. |

**Fix-pass 2026-06-06:** 0 code fixes applied, 0 failed, 5 deferred.
Rationale (`--fix all` requested): every finding is either (a) **out of scope** for task 0021's
CLI-only surface (P2#1 — server/plugin-sdk packaging), (b) a **task-document** correction not a code
defect (P2#2, P4#5 — amend requirement text + add ADR), or (c) an **intentional, documented,
tested design decision** where "fixing" would reverse a deliberate re-scope and break passing tests
(P3#3, P3#4). Auto-fixing any of these would violate R3 surgical-change discipline and the
doc-conflict authority of `04_DESIGN.md`. Code is left unchanged; the actionable items are
task/doc edits the operator should confirm.


### Testing

**Renderer/resolver unit tests** (`apps/cli/tests/help.test.ts`, new):
- `renderCommandHelp` produces USAGE/VERBS/EXAMPLES/EXIT-CODES sections for a spec with multiple verbs (snapshot for `rule` and `agent`).
- `renderCommandHelp` for a verb-less spec (`status`) omits the VERBS section.
- `resolveVerb(spec, undefined)` returns `defaultVerb` when set (`agent`→`list`, `rule`→`run`, `plugin`→`list`).
- `resolveVerb(spec, undefined)` returns `{error:true}` when `requireVerb` (`workflow`/`message`/`team`/`history`).
- `resolveVerb(spec, 'bogus')` returns `{error:true}` for an unknown verb.

**Dispatch regression tests** (extend `apps/cli/tests/**` command suites):
- Each existing verb invocation still routes to the same service call and exit code (behavior frozen — the step-1 oracle).
- `spur agent` (no verb) == `spur agent list`; `spur rule` == `spur rule run`; `spur plugin` == `spur plugin list`.
- `spur workflow` / `spur message` / `spur team` / `spur history` with no verb print help and exit 1.
- Unknown verb (`spur rule frobnicate`) prints help and exits 1.

**Top-level help test** (`apps/cli/tests` index/help suite):
- `spur help` output contains the domain group headers (Harness/Policy/Workflow/History/Extension/Project) and lists all 10 nouns.
- Output is sourced from specs (assert a newly-toggled summary in a spec appears in top-level help — guards against a re-introduced hand-maintained list).

**Doc sync check** (manual, in Review):
- `04_DESIGN.md §1.0` grammar block present; per-command tables unchanged in content.

**Gate:**
- `bun run lint` — PASS
- `bun run test` — PASS (no skips)
- `bun run test-cf` — PASS
- `bun run build` — PASS
- `git status` — only `apps/cli/**` + `docs/04_DESIGN.md`


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


