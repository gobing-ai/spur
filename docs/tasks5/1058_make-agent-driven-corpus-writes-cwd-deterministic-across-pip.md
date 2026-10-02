---
schema_version: 1
name: Make agent-driven corpus writes cwd-deterministic across pipeline surfaces
status: todo
template: issue
created_at: 2026-10-02T22:50:39.301Z
updated_at: "2026-10-02T23:26:50.081Z"

feature_id: D63
ac_altitude: task-local
---

## 1058. Make agent-driven corpus writes cwd-deterministic across pipeline surfaces

### Background

During inline pipeline run `95522d21` (task 1057) the shell working directory drifted between tool calls three times, silently landing corpus writes (`feature update` AC rewrite, `task update` AC rewrite) in the invoking tree instead of the run worktree; each required manual spill-revert. Root cause: commands assumed an inherited cwd — undefined input for agent-driven shells, where every bash call may start in an arbitrary directory. Blast radius is any CLI that resolves the corpus from `process.cwd()`: silent wrong-tree writes with no error. Fix layers: pin the tree explicitly at the tool layer, fail fast when the pin mismatches, and codify the protocol where pipeline drivers are defined.

### Requirements

- [x] R1. Add a global `--cwd <dir>` tree-pinning option to the corpus-mutating nouns (`task`, `feature`, `rule`, `workflow`), wired into the existing `MainOptions.cwd` seam (`apps/cli/src/index.ts:56`) with precedence flag > process cwd and loud validation (missing project markers → exit 2 naming the resolved path). Migrate the P0/P1 `process.cwd()` sites from the 45-site audit (Design D2) in the same change. Public-surface addition — operator consent + ADR entry before implementation.
- [x] R2. Codify the cwd protocol in `config/workflows/task-pipeline.yaml`, `config/workflows/wrapup-pipeline.yaml`, and `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`: self-contained commands (subshell / `git -C` / the R1 flag), fail-fast tree assert `[ "$PWD" = "<abs-tree>" ] || exit 91` before any corpus write, and post-write verification of the absolute target file for section-editing verbs.
- [x] R3. Regression coverage: a corpus write executed with a stale process cwd and the pinning flag lands in the pinned tree with the stale tree byte-identical; a missing/invalid pin exits nonzero. The test fails without the R1 wiring.
- [x] R4. Document the harness-layer residual in the driver reference plus a drafted upstream issue text: the pi bash tool exposes no `cwd` parameter (coordination item, no repo code).

### Acceptance Criteria

- [ ] AC1: Every corpus-mutating `spur` command accepts `--cwd <dir>`; `--help`, `docs/help*`, and `plugins/sp/skills/spur-cli` references updated in the same change set; invalid/missing tree exits 2 naming the resolved path. (req: R1)
- [ ] AC2: Both pipeline YAMLs and the inline-pipeline-driver reference carry the mandated protocol with working examples (subshell + tree-assert idiom); no driver step relies on inherited cwd. (req: R2)
- [ ] AC3: A regression test proves stale-cwd writes are pinned or rejected loudly (exit nonzero), failing without the fix. (req: R3)
- [ ] AC4: Driver reference contains the upstream-residual note and a drafted pi bash tool `cwd` issue text exists in this task's Q&A/References. (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T22:57:00.898Z

- Q: Flag name — `--cwd` vs `--project`? A: `--cwd` — matches `MainOptions.cwd` (`index.ts:56`), no new vocabulary; `--project` implies profile selection, not tree pinning.
- Q: Why exit 91 for the tree assert? A: Distinct, greppable code far from CLI exit conventions (0/1/2); a loud wrong-tree abort beats a silent write; drivers can detect it distinctly.
- Q: Why is 1058 unbound to a feature (DD-07 WARN accepted)? A: Scope spans CLI + workflows + upstream pi; binding to a mismatched feature imports DD-09 subset pressure. Bind during refine or wrap into a feature via /sp:dev-idea when scheduled.
- Q: Why skip-ready? A: Backlog capture per operator request; model-ready refinement deferred to /sp:dev-refine 1058.
- Q: Why replace wholesale instead of --append for these sections? A: Dogfood note — 1057 shipped `--append` for extend-mode; initial authoring of empty template sections is replace semantics by design.

#### Q&A entry — 2026-10-02T23:26:50.081Z

#### Q&A entry — feature binding (2026-10-02)

- Q: Which feature owns 1058 now that it is scheduled? A: **D63 (Reliable and measured daily-workflow adoption)**. Same origin inline run `95522d21` as sibling task 1057 (already D63); D63's scope covers the supporting CLI transports and wrapup/pipeline completion-reliability integration this task hardens (`--cwd` pinning, task-pipeline/wrapup-pipeline protocol, inline-pipeline-driver).
- Q: Why not D3? A: D3 is deliberately scoped to three reproduced `workflow run` engine defects (0431–0433); corpus-write cwd determinism is not one of them.
- Q: What about the earlier DD-09 subset-pressure concern? A: Resolved with `--ac-altitude task-local` — 1058's ACs are task-local hardening (CLI flag, driver protocol, regression test, upstream note), intentionally not D63 feature ship criteria. `spur task check 1058` passes with zero findings.

### Design

**D1 — Pinning flag (R1).** Add a global `--cwd <dir>` option to the corpus nouns (`task`, `feature`, `rule`, `workflow`) that feeds the existing `MainOptions.cwd` seam (`apps/cli/src/index.ts:56`) — thin argv wiring, no new plumbing. Precedence: flag > process cwd. Validation: the target must contain the project markers the resolver already requires (`.spur/` or config); a missing/invalid tree exits 2 with the resolved path named — never a silent fallback to process cwd. Public-surface addition: needs operator consent + an ADR entry (AGENTS.md surface rule) before implementation.

**D2 — cwd audit (R1 support).** Tier the 45 `process.cwd()` sites: P0 = corpus write/read services (task/feature/rule/workflow) must thread the materialized cwd; P1 = pipeline drivers + run scripts; P2 = non-corpus surfaces (history, fleet, slash-commands) may keep process cwd this task — recorded as known remaining sites, not silently converted.

**D3 — Protocol mandate (R2).** Codify in `config/workflows/task-pipeline.yaml` + `wrapup-pipeline.yaml` shell steps and `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`: (a) one self-contained command per call — subshell `(cd <abs-tree> && …)`, `git -C <abs>`, or the D1 flag; (b) fail-fast tree assert before any corpus write: `[ "$PWD" = "<abs-tree>" ] || exit 91`; (c) post-write verification against the absolute target file (grep the section heading) for section-editing verbs.

**D4 — Regression test (R3).** Service-level test in `packages/app/tests/services/` (planning-write-service or a new cwd test): execute a section write with a stale process cwd and `--cwd` pointed at a fixture tree; assert the write lands in the pinned tree, the stale tree is byte-identical, and missing pin exits nonzero. Fails without D1 wiring.

**D5 — Upstream residual (R4).** pi bash tool has no `cwd` parameter; document as upstream coordination in the driver reference + a drafted issue text under Q&A/References — out of this repo's code scope.

**Non-goals:** no shell-persistence guarantees (harness-owned), no rewriting P2 surfaces, no behavior change for interactive (human) use.

### Plan

1. ADR entry in `docs/00_ADR.md` (flag semantics, precedence, validation, scope) — before code.
2. Global `--cwd` wiring through `apps/cli/src/index.ts` into `MainOptions.cwd`; corpus nouns only (D1).
3. P0/P1 audit of the 45 sites; migrate corpus services (D2); leave P2 documented.
4. Protocol sections + examples in both pipeline YAMLs and `inline-pipeline-driver.md` (D3).
5. Regression test per D4; focused run: `(cd packages/app && bun test tests/services/)` + `(cd apps/cli && bun test tests/commands/)`.
6. Gates: `bun run spur-check` (task-local), `task check 1058 --as done` before close.

### Root Cause

**Mechanism.** The CLI materializes one cwd at the composition root — `apps/cli/src/index.ts:56` (`const cwd = options.cwd ?? process.cwd()`, `MainOptions.cwd` exists for programmatic runs) — but 45 call sites across `packages/app/src` + `apps/cli/src` still resolve paths from `process.cwd()` directly (top: `services/inline-run-setup.ts` 9, `slash-commands-service.ts` 5, `history-service.ts` 4, `anchor-qualifier.ts` 4). Agent-driven shells (pi bash tool) do not guarantee cwd carry-over between tool calls, so any command relying on inherited cwd is undefined-input.

**Incidents (run `95522d21`, task 1057).** (1) Corrective trace `e215681d…`: corpus edit landed in the invoking tree, reverted, gate re-run. (2) A late-session `feature update` (D63 AC additions R9–R11) and `task update` (1057 AC rewrite) both landed in `/Users/robin/xprojects/spur-new` instead of the worktree; reverted via `git -C <invoking> checkout --`. Root pattern each time: a bare `bun apps/cli/src/index.ts …` call without an explicit `cd`, relying on the previous call's directory.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `apps/cli/src/index.ts:56` — composition-root cwd seam (`MainOptions.cwd`).
- `config/workflows/task-pipeline.yaml` — qualityGateCmd/gateProbeCmd `sh -c` surfaces (lines ~129–159).
- `config/workflows/wrapup-pipeline.yaml` — `kind: shell` steps (lines ~131, 167), TRUSTED CONFIG `sh -c` notes (lines ~111–118).
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — driver protocol + SETUP_SCRIPT portable layout.
- `packages/domain/src/bdd/coverage.ts` — n/a; corpus-write path owners: `packages/app/src/services/planning-write-service.ts`, `task-service.ts`.
- Run evidence: `95522d21-31ac-4af0-a03e-f74775319ee3` (corrective trace `e215681d…`); commits `1250941a7`, `afb9f8629` (1057 close).
- Upstream: `@earendil-works/pi-coding-agent` bash tool — no `cwd` option today (D5).

### History
