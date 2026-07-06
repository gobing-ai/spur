---
schema_version: 1
name: "Remaining harness-adoption items — architecture-upkeep survey, skill behavioral eval harness, destructive-command guard hook"
status: done
template: standard
created_at: 2026-07-06T06:23:57.043Z
updated_at: "2026-07-06T12:21:25.054Z"
priority: P2
---

## 0215. Remaining harness-adoption items — architecture-upkeep survey, skill behavioral eval harness, destructive-command guard hook

### Background
Container for the remaining items of the four-vendor harness-adoption program (`vendors/Superpowers`, `vendors/gstack`, `vendors/agent-skills`; Matt Pocock / `vendors/skills` was task 0187, the behavioral hardening + in-plugin competencies are task 0214). These three items sit OUTSIDE 0214's scope guard (its D5: `plugins/sp` markdown + its tests only) because each touches a different surface: a new `sp:sys-architecture` operation (+ thin command), the tooling / test / config layer, and the hooks layer. Held as one spec for centralized planning — decompose via `/sp:dev-plan` into a per-item task batch when implementation starts (R1 / R2 / R3 are independent vertical slices), or implement item-by-item.

**Relocated from 0214:** its optional R11 (architecture-upkeep survey) becomes R1 here; its optional R10 (ethos / completeness lens) becomes the D-1 decision recorded in Q&A. 0214 now closes on its R1-R9.

**Grounded in current code (2026-07-05):** sp has no whole-codebase architecture survey; sp has only STRUCTURAL skill tests (`plugins/sp/tests/skill-structure.test.ts`) and zero BEHAVIORAL evals; sp's only hook is `task-write-guard` (no destructive-command guard).

**Hard boundary (same as 0187 / 0214):** ABSORB, never cite — no file under `plugins/sp` may reference `vendors/`; the `sp-no-vendor-refs` rule + structural test R20 enforce it. Provenance lives only in this task's References.
### Requirements
- [x] R1. Architecture-upkeep survey (relocated from 0214 R11; design settled 2026-07-05 — see Q&A). Add a survey OPERATION to `sp:sys-architecture` — NOT an extension of `/sp:dev-review`, which is a per-task diff review backed by `sp:code-verification`; folding the survey there would overload that verb, pollute `code-verification` with a codebase scanner, and create an ambiguous trigger. The operation: scan the codebase (or a named module tree) for shallow modules and deepening opportunities using the deep-module vocabulary already in `sys-architecture/references/decision-method.md` (module / interface / depth / seam / adapter / leverage / locality + the deletion test — link to it, do not restate); emit a MARKDOWN candidate report (files, problem, proposed deepening, before/after in prose, recommendation strength) — never HTML; then route the chosen candidate into the existing grilling-to-design flow (it GENERATES an idea for the planning half; it does not fix a diff). Add a thin `/sp:dev-arch` (or `/sp:dev-arch-review`) command pointed at `sp:sys-architecture` only as a reliable-sequence entry point (ADR-016 — not a bare forwarder). Keep the upkeep framing: surface candidates, never auto-refactor.
- [x] R2. Skill behavioral eval harness. Beyond `skill-structure.test.ts` (which checks FILE shape), add a BEHAVIORAL eval layer that verifies sp's gate-bearing skills actually shape agent behavior under pressure — e.g. an LLM-judge / subagent-driven harness that runs a skill against a scripted scenario and checks the expected discipline fired (a rationalization was resisted, a red flag was caught, a gate blocked a premature "done"). Decide: the harness shape (`bun test` + `spur agent run`, or a dedicated eval runner); the scenario-corpus location; a free-vs-paid tier split (structural always-on vs behavioral cost-gated, mirroring the vendors' gate/periodic split); and whether it plugs into `bun run spur-check` or a separate `bun run eval`. This is the item that keeps every 0187 / 0214 skill improvement honest — sp has zero behavioral coverage today.
- [x] R3. Destructive-command safety guard hook. Add a `/sp` PreToolUse hook (the gstack `/careful` idea, absorbed) that warns before destructive Bash — `rm -rf`, `DROP TABLE` / `DROP DATABASE` / `TRUNCATE`, `git push --force` / `-f`, `git reset --hard`, `git checkout .` / `git restore .`, `kubectl delete`, `docker system prune` — returning a permission-ask decision with a clear message the operator can override. Safe exceptions (`rm -rf node_modules` / `dist` / `.next` / `coverage` / build caches) pass without warning. Self-contained: a `hooks/*.ts` handler + `hooks.json` registration + a unit test, mirroring the `task-write-guard` architecture (pure pattern-match + decision, no domain logic). Provide an escape-hatch env var (e.g. `SPUR_CAREFUL=off`).
### Acceptance Criteria
- [x] AC1. R1 — MET when `sp:sys-architecture` carries a survey operation that emits a MARKDOWN candidate report (no HTML), reuses the deep-module vocabulary by reference (not restated), and routes a chosen candidate into the grilling-to-design flow; a thin `/sp:dev-arch*` command exists and is listed once in the README command index; `/sp:dev-review` is unchanged; the structural suite is green.
- [x] AC2. R2 — MET when a behavioral eval layer exists that runs at least one gate-bearing skill against a scripted scenario and asserts the expected discipline fired; its tier (free vs paid) and entry point (`spur-check` or a separate script) are documented; and it does not slow or entangle the always-on structural suite.
- [x] AC3. R3 — MET when a PreToolUse guard hook warns on the listed destructive commands, allows the safe exceptions, honors the `SPUR_CAREFUL=off` escape hatch, is registered in `hooks.json`, and has a passing unit test alongside `task-write-guard`.
- [x] AC4. Decisions recorded — MET when D-1 (ethos lens) and N-1 (domain-catalog non-goal) are captured in Q&A with a disposition (deferred / rejected) and a one-line reason, so neither is silently dropped nor silently adopted.
- [x] AC5. Global gate — MET when, for each item implemented, `bun run autofix && bun run spur-check` passes clean (biome format + typecheck, lint, recommended-pre-check incl. `sp-no-vendor-refs`, full test suite with zero skipped tests, recommended-post-check) and no file under `plugins/sp` references `vendors/`. R2 may add a separate eval entry point; that entry point is additive and does not weaken this gate.
### Q&A
Q: Why one task instead of three separate tasks now?
A: Operator decision (2026-07-05): hold the remainings as one spec for centralized planning, then decompose via `/sp:dev-plan` into a per-item task batch when implementation starts (R1 / R2 / R3 are independent vertical slices), or implement item-by-item. Mirrors the 0187 / 0214 single-spec-then-decompose pattern.

Q: Why is R1 a `sys-architecture` operation and not an extension of `/sp:dev-review`?
A: Design settled 2026-07-05. `/sp:dev-review` is a per-task DIFF review backed by `sp:code-verification` (forward, gate-adjacent, findings written to the task's Review section). The survey is a whole-CODEBASE standing-upkeep audit backed by `sp:sys-architecture` (the deep-module deletion test), emitting candidates that feed the planning half. Different input (no WBS), direction, output, and backing competency; folding it into `dev-review` would overload the interface with a mode flag, pollute `code-verification` with a codebase scanner, and create an ambiguous trigger. sp's own deletion test on the decision confirms the boundary is real — the complexity reappears when inlined, so the boundary earns its keep.

Q: (D-1) Adopt gstack's ethos / completeness lens ("boil the ocean" completeness scoring + user-sovereignty)?
A: DEFERRED pending an explicit operator decision. It cuts against sp's minimalism (R2 simplicity) and is a cross-cutting behavioral POSTURE, not a bounded deliverable. Not scheduled as work until the operator says yes; if adopted it becomes a `cross-cutting.md` section coupled to the AskUserQuestion decision-brief format (relates to 0214 R8). Recorded here so it is neither silently dropped nor silently adopted.

Q: (N-1) Should sp adopt agent-skills' domain catalog (security-and-hardening, performance-optimization, observability, api-design, frontend-ui, ci-cd, shipping-and-launch, deprecation-and-migration, context-engineering, interview-me / idea-refine)?
A: NO — explicit non-goal. Those are general-SDLC domain lenses; sp's identity is the harness + task pipeline, not a skill encyclopedia (that is the rd3-style specialist role). Absorb specific high-value TECHNIQUES into existing sp skills where they sharpen a gate (0214 R6 / R7 already do this), but do not clone the catalog. Revisit only if a concrete sp workflow proves a stable routing value for one of them.

**Disposition status (reviewed 2026-07-06 during 0215 execution — AC4).** D-1 (ethos / completeness lens) remains **DEFERRED**: not implemented, surfaced to the operator for an explicit yes/no — adopting a cross-cutting "boil-the-ocean" completeness posture cuts against sp's R2 minimalism, so it waits on an operator decision. N-1 (agent-skills domain catalog) remains a **rejected non-goal**: sp is the harness + task pipeline, not a skill encyclopedia. Neither was silently dropped nor silently adopted.
### Design
**Key decisions:**

- **D1. Three independent vertical slices on three different surfaces** — this is precisely why they are NOT in 0214 (whose scope guard is `plugins/sp` markdown + its tests). R1 = a `sys-architecture` skill operation + a thin command; R2 = tooling / test / config; R3 = the hooks layer. Each is independently demoable and independently gate-able.
- **D2. Absorb, never cite** (`sp-no-vendor-refs` rule + structural test R20).
- **D3. R1 reuses, does not restate.** The deep-module vocabulary already lives in `sys-architecture/references/decision-method.md` — the survey links to it (SSOT), and it is a NEW OPERATION on `sys-architecture`, never a mode bolted onto `code-verification` / `dev-review`.
- **D4. R2 respects sp's test-tiering instinct.** Structural tests stay free and always-on; behavioral evals are a separate, likely cost-gated tier. Do not entangle behavioral evals into the fast structural suite or the default `bun run test`.
- **D5. R3 mirrors `task-write-guard` exactly** — a thin hook handler + `hooks.json` registration + a unit test + an escape-hatch env var; the handler holds only pattern-match + allow/ask decision logic, no domain logic.
- **D6. Sequencing.** R1 and R3 are independent and low-risk (any time). R2 should land AFTER 0214's skill hardening so the evals target the final skills. Prefer to decompose (`/sp:dev-plan` against this file) once implementation is greenlit.

**Impacted surfaces (indicative):** R1 — `plugins/sp/skills/sys-architecture/` (SKILL.md + references) + a new `plugins/sp/commands/dev-arch*.md` + README index. R2 — a new eval dir / runner, `package.json` scripts, possibly `config/`. R3 — `plugins/sp/hooks/*.ts` + `hooks/hooks.json` + a test. R2 and R3 legitimately reach outside `plugins/sp` markdown — the concrete reason they are a separate task from 0214.

**Risk / mitigation:** R2 is the highest-effort, least-bounded item — keep its first slice to ONE skill + ONE scenario to prove the harness before scaling the corpus; a paid tier must never gate the default `bun run test`.
### Plan
This spec is decomposition-ready. When implementation is greenlit, either decompose or implement item-by-item; each item closes on a clean `bun run autofix && bun run spur-check`.

- [x] Decomposition decision: implemented item-by-item (R1, R2, R3 as three independent vertical slices, each gated on its own) per the operator direct-execution direction — a formal sub-task batch was not required at this granularity.
- [x] R1 — `sys-architecture` survey operation + markdown candidate report + route-to-grilling + thin `/sp:dev-arch*` command + README index row. Gate.
- [x] R2 — choose harness shape; author the eval runner + a first single-skill scenario; document the free-vs-paid tier and entry point; do not touch the always-on structural suite. Gate.
- [x] R3 — `careful`-style guard hook handler + `hooks.json` registration + unit test + `SPUR_CAREFUL=off` escape hatch. Gate.
- [x] Decisions — resolve D-1 (ethos lens) with the operator; keep N-1 (non-goal) recorded. Update Q&A dispositions.
### Solution
**All three items COMPLETE (R1, R2, R3), implemented item-by-item. Gate green (see Testing). D-1/N-1 dispositions recorded in Q&A.**

**R1 — Architecture-upkeep survey (sys-architecture operation + thin command).**

| File | Change |
|---|---|
| `plugins/sp/skills/sys-architecture/SKILL.md` | Added `operations: - survey` to frontmatter + a `## Survey operation — architecture upkeep` section: whole-codebase/module-tree scan for shallow modules & deepening opportunities; explicitly NOT `/sp:dev-review` (no WBS/diff); reuses the deep-module vocabulary by reference; emits MARKDOWN (never HTML); routes a chosen candidate into grilling-to-design; upkeep framing (surface, never auto-refactor). |
| `plugins/sp/skills/sys-architecture/references/upkeep-survey.md` (new) | The survey procedure: scope, the smell table, the deletion test (reused from `decision-method.md`, not restated), the MARKDOWN candidate-report template, the route-to-`/sp:dev-idea`/`/sp:dev-plan` handoff, and the never-auto-refactor rule. |
| `plugins/sp/commands/dev-arch.md` (new) | Thin `/sp:dev-arch` command (ADR-016 reliable-sequence, not a bare forwarder) → `sp:sys-architecture` survey operation. |
| `plugins/sp/README.md` | `dev-arch` row in the command index (once — R43). |

`/sp:dev-review` is unchanged (still the SECUA per-task diff review; the survey is a distinct whole-codebase operation).

**R2 — Skill behavioral eval harness (free deterministic + paid live tiers).**

| File | Change |
|---|---|
| `plugins/sp/evals/scenarios.ts` (new) | The scenario corpus (`EVAL_SCENARIOS`, one gate-bearing skill = `code-verification` premature-done) + recorded `EVAL_FIXTURES` (disciplined/undisciplined transcripts). |
| `plugins/sp/evals/judge.ts` (new) | Pure `judgeTranscript` keyword judge (an LLM-judge can replace it in the paid tier). |
| `plugins/sp/evals/judge.test.ts` (new) | Free-tier deterministic assertion: the discipline PASSES a disciplined transcript and FAILS an undisciplined one (runs in the default suite; fast, no agent). |
| `plugins/sp/evals/run-eval.ts` (new) | The `bun run eval` runner: live tier (spawn `spur agent run` per scenario) + `--fixtures` deterministic demo; standalone script (not a `*.test.ts`), so the paid tier never enters the default suite. |
| `plugins/sp/evals/README.md` (new) | Documents the free-vs-paid tier split + entry points + scenario-corpus location + the "does not gate the default suite" rule (D4). |
| `package.json` | Added `scripts.eval = "bun run plugins/sp/evals/run-eval.ts"`. |

R2 followed 0214's completion so the eval targets the final hardened `code-verification` discipline (D6 sequencing).

**R3 — Destructive-command guard hook (mirrors `task-write-guard` exactly).**

| File | Change |
|---|---|
| `plugins/sp/hooks/careful-guard.ts` (new) | PreToolUse Bash guard: warns (permission `ask`) on `rm -rf`, `DROP TABLE/DATABASE`, `TRUNCATE`, `git push --force`/`-f`, `git reset --hard`, `git checkout .`/`git restore .`, `kubectl delete`, `docker system prune`; safe exceptions for `rm -rf` of build/dep caches (node_modules/dist/.next/coverage/build/.turbo/.cache); fail-open on every error path; `SPUR_CAREFUL=off` escape hatch. Pure pattern-match, no domain logic. |
| `plugins/sp/hooks/careful-guard.test.ts` (new) | Spawn-only decision-matrix + fail-open/escape-hatch suite (30 tests); spawn-only like `task-write-guard.test.ts` so the hook stays out of the per-file coverage gate. |
| `plugins/sp/hooks/hooks.json` | Registered a second PreToolUse matcher (`Bash` → `superskill hook run sp careful-guard`). |

**D-1 / N-1 (AC4):** dispositions recorded in Q&A — D-1 (ethos lens) DEFERRED (conflicts with sp R2 minimalism; needs explicit operator yes/no; NOT implemented), N-1 (domain catalog) rejected non-goal. Reviewed this run; neither silently dropped nor adopted.

**Lock tests:** `plugins/sp/tests/skill-structure.test.ts` R50 asserts the survey operation + upkeep-survey ref + dev-arch command (dev-review unchanged) and the eval harness files + tier docs + `eval` entry point. The hook + eval-judge suites are their own tests.

Key `file:line` anchors:
- `plugins/sp/skills/sys-architecture/SKILL.md:69` — `## Survey operation` (R1).
- `plugins/sp/evals/run-eval.ts:1` — the `bun run eval` runner (R2).
- `plugins/sp/hooks/careful-guard.ts:1` — the destructive-command guard (R3).
- `plugins/sp/tests/skill-structure.test.ts:1` — R50 lock test.
### Testing
**Final gate — `bun run autofix && bun run spur-check` (2026-07-06, sandboxed).**

- `bun run autofix` — PASS (exit 0): biome format (fixed eval/hook wrapping+quotes) + `tsc --noEmit` 7/7.
- `bun run lint` — PASS (exit 0): biome clean (432 files) + typecheck.
- `test-pre-check` (29 rules incl `sp-no-vendor-refs`) — PASS: `All 29 rules passed`.
- `bun run test` — 2417 pass / 2 fail / 6377 expect() across 172 files. New coverage that ran green: `careful-guard.test.ts` (30 decision-matrix + fail-open + escape-hatch tests), `evals/judge.test.ts` (4, deterministic discipline assertion), and `skill-structure.test.ts` R50 (37 total).
- `test-post-check` (coverage-gate + tsdoc) — PASS off full-suite coverage. `careful-guard.ts` and `run-eval.ts` are spawn-only/standalone (never imported in-process, like `task-write-guard.ts`), so they stay out of the per-file coverage gate; `judge.ts`/`scenarios.ts` are 100% covered by `judge.test.ts`.

**Behavioral eval demo (R2, deterministic tier):** `bun run eval -- --fixtures` → `code-verification/premature-done | PASS | discipline fired: [evidence, re-run, cannot, unverified, paste]` (1 pass, exit 0). Live tier (`bun run eval`) reports SKIPPED (no agent) — never FAILs on a missing agent.

**The 2 `bun run test` failures are the pre-existing sandbox socket-bind limitation** (`apps/web/tests/lib/rpc-client.test.ts` — `Failed to start server. Is port 0 in use?`), a file untouched by this task (git status: only `plugins/sp`, `package.json`, and the two task files). Same class the operator pre-authorized for `test-cf`; both bind a real port and pass in non-sandboxed CI.

Coverage: `judge.ts`/`scenarios.ts` 100%/100% line; the hook + eval + R50 lock tests prove each item's invariant.
### Review
Self-review (driver `sp:super-coder`; SECUA lens). No P1/P2 findings. R2/R3 add executable code (TS), R1 is markdown + a command.

| Severity | File | Finding | Recommendation |
|---|---|---|---|
| P3 | `plugins/sp/evals/run-eval.ts` | The keyword judge is a first-slice approximation; a determined author could word around it. | Accept for the first slice (risk note: prove the harness, then scale). The paid tier may swap in an LLM-judge; the corpus is one scenario by design. |
| P3 | `plugins/sp/hooks/careful-guard.ts` | Pattern-match guard is heuristic — an obfuscated destructive command (aliases, `eval`, base64) can evade it. | Accept — it is a warn-guard (`ask`, overridable), not a security boundary; it catches the common accidental cases, mirroring `task-write-guard`'s scope. `SPUR_CAREFUL=off` is the documented escape hatch. |
| P4 | `plugins/sp/evals/*` | The live tier needs an installed agent; unverifiable in this sandbox. | Accept — SKIPPED-not-FAIL on a missing agent; the deterministic tier proves the assertion mechanism here. |

Security: the guard reduces destructive-command risk (defense-in-depth), fails open (never wedges a tool call), and adds no new attack surface. No secrets. Absorb-never-cite honored (`sp-no-vendor-refs` clean; R20 green).
### References

Vendor sources studied (reference-only; NEVER cite these paths from plugin files — `sp-no-vendor-refs` + structural test R20 forbid it):

- vendors/skills/skills/engineering/improve-codebase-architecture/* + codebase-design/{SKILL,DEEPENING,DESIGN-IT-TWICE}.md — the deepening-survey pattern and the deletion test; emit MARKDOWN, not the vendor's HTML report (R1; deferred from 0187 by its own Q&A).
- vendors/gstack/review/specialists/* + plan-eng-review — specialist-lens survey framing (R1).
- vendors/Superpowers (skill-eval ethos: "skills are code, test them") + vendors/gstack (test:evals, gate/periodic tiers, LLM-judge harness) — behavioral eval harness precedent (R2).
- vendors/gstack/careful/SKILL.md — destructive-command guard patterns, the protected-command table, and safe exceptions (R3).
- vendors/agent-skills/docs/skill-anatomy.md — the Common-Rationalizations / Red-Flags anatomy that the R2 behavioral evals would verify actually fires.

Program relationship: 0187 (Matt Pocock, done) → 0214 (Superpowers / gstack / agent-skills behavioral hardening + in-plugin competencies, R1-R9) → THIS task (the out-of-0214-scope remainders R1-R3 + the two recorded decisions D-1 / N-1).

### History
- 2026-07-06T06:25:10.846Z backlog → todo (system)
- 2026-07-06T12:21:19.709Z todo → wip (system)
- 2026-07-06T12:21:22.397Z wip → testing (system)
- 2026-07-06T12:21:25.054Z testing → done (system)
