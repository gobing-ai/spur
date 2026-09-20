---
schema_version: 1
name: Audit post-delivery CLI-plugin-workflow contract adoption and existing backlog ownership
status: done
template: brainstorm
created_at: 2026-09-20T00:51:02.732Z
updated_at: "2026-09-20T05:58:01.521Z"
feature_id: I31

priority: P1
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "2"
---

## 0903. Audit post-delivery CLI-plugin-workflow contract adoption and existing backlog ownership

### Background

Type: `wayfinder:research`. This is the first independent investigation on map I31. It audits the post-delivery contract across the live `spur` CLI, plugin source, installed Superskill adapters, and workflow callers, then assigns confirmed drift and evidence gaps to existing owners. B6, B7, B8, and G66 are inputs; their completion is not re-verified here. This ticket produces an inventory and routing artifact, not a code fix.

**Refine corrections (2026-09-19)**
- An open feature status implied unfinished implementation → sync dry-run proposes 35 done transitions, including D62/E6/P-adjacent deliveries → distinguish bookkeeping from residual work using complete task rosters.
- P was treated as wholly unimplemented → task-pipeline already documents auto selection and guards mutationPolicy; resilience tests exist → inventory only remaining behavioral or evidence gaps.
- Source/installed drift inventory had no denominator or output contract → freeze the reachable surface set, precise evidence rows, and owned artifacts below.

### Requirements

- [ ] R1. Freeze an explicit surface inventory reachable from dev-run, dev-runall, dev-parallel, super-planner, super-coder, super-reviewer, spur agent, spur message, and every model-bearing workflow action. Include each directly referenced runtime contract and installed adapter target that can be located; list missing installed targets without inventing paths.
- [ ] R2. Compare CLI flags/output/selector semantics, quota ownership, role pins, reuse/fresh sessions, capability fallback, receipt identity, and mutation policy across the frozen surfaces; each mismatch cites current source and asserted guidance.
- [ ] R3. Capture feature sync --all --dry-run once; use its proposed statuses only in the report. Resolve archived linked tasks through task show before calling a feature empty or terminal. Cover I7, P, D62, E6, B1, B3, G1, G4, G65, and I4 without modifying them.
- [ ] R4. Map four journeys—inspect/select executor, dispatch one task, send/wait for a request, and recover an interrupted member—to existing commands, identity keys, receipts, and failure outcomes. Propose simplification only for demonstrated redundant steps.
- [ ] R5. Assign each confirmed finding an existing owner or explicit unowned disposition; separate shipped behavior, stale prose, absent adoption, unverified behavior, and already-owned work. No new feature/task allocation in this investigation.
- [ ] R6. Deliver 0903-contract-adoption.md and 0903-contract-adoption.json with the schema and coverage accounting below; enumerate concrete scenarios for dependent task 0905.
- [ ] R7. Validate row IDs, source anchors, inventory coverage, dispositions, and scenario references with a repeatable local check; report all unknowns and execution constraints.

### Acceptance Criteria

- [ ] AC1 — Every frozen surface has an observed result or a named unavailable reason; installed-target coverage is explicit. (req: R1)
- [ ] AC2 — Session, quota, selector, capability, receipt, and mutation-policy comparisons carry source-versus-guidance evidence. (req: R2)
- [ ] AC3 — Status/ownership conclusions use one sync capture and complete roster lookup, with zero status mutations. (req: R3)
- [ ] AC4 — All four journeys have steps, identity/receipt semantics, error paths, and evidence-backed simplification dispositions. (req: R4)
- [ ] AC5 — Each finding has exactly one disposition and owner or unowned marker; existing deliveries are not proposed anew. (req: R5)
- [ ] AC6 — Both named artifacts parse/read and scenario IDs provide a deterministic handoff to 0905. (req: R6)
- [ ] AC7 — The report includes the checker command/result, provenance, unknowns, and no unsupported completion claims. (req: R7)

### Q&A

Closed for this investigation: local evidence first; no new public API; no production mutations; no live provider refresh or new benchmark runs; missing evidence is explicit; bounded 90-minute session and 60-second process deadlines. Operator decisions on future CLI compatibility, refresh cadence, and unattended execution budgets remain owned by Robin on map I31 and do not block these evidence-only deliverables. They are not delegated to the investigator to invent.

Preparation is ready-to-investigate, not proof the product behavior passes. Follow the wayfinder research route, one ticket per session. Any later source fix gets its own planned implementation task.

### Design

Type: wayfinder:research. Execute one ticket per session through the sp-wayfinder work-through-map procedure and its wayfinder-resolution research route. Do not use task-pipeline, dev-run, dev-runall, or eval-pipeline to resolve this ticket. Claim the selected ticket before investigation; verification and completion use the existing wayfinder verdict/record route. Preparation here is not execution or verification of its findings.

mutationPolicy: none

Production source, plugin/workflow definitions, installed adapters, real configuration, credentials, and real databases are read-only. Allowed deliverables are this task's CLI-owned evidence sections and the named report/JSON artifacts under docs/reports/i31/. Use an OS temporary directory for executable reproduction snippets and disposable fixture files; include the exact snippet and command in the report so it remains reproducible. No new public API, CLI verb, service, schema, dependency, scheduler, or production fix. No network probes or paid agent invocations inside the investigation; the surrounding delegated research/review session is the only model execution.

At start record git HEAD, git status, git worktree list, source-local CLI provenance, and task list --status wip --json. Use the current checkout; do not reset other work. If competing work changes a sampled source, refresh that row's evidence and record both revisions. Parallel delegates require separate worktrees; task 0905 starts only after 0903 is done and its artifact is available.

Bound one investigation to 90 minutes. Give any child shell/process a 60-second deadline, permit at most one retry for a read-only transient failure, and checkpoint partial artifacts at the budget boundary. A timeout or absent evidence is unknown, never success and never permission to rerun a pipeline. Do not mark the ticket done with unmet required deliverables. Report-only negative findings can be a valid investigation result when all specified observations and missing-data dispositions are recorded.

Choose a bounded comparison matrix over a wholesale plugin rewrite: it exposes adoption gaps with no runtime blast radius. Reuse plugins/sp/scripts/surface-drift-inventory.ts, validate-flag-contracts.ts, and the CLI parity tests as evidence sources; inspect their entrypoints before invoking because scripts with workflow/spawn/write side effects are excluded from the default read-only route.

Start at plugins/sp/commands/dev-{run,runall,parallel}.md, plugins/sp/agents/super-{planner,coder,reviewer}.md, plugins/sp/skills/spur-dev/references/{cross-cutting,execution-workflow,execution-batch,inline-pipeline-driver}.md, plugins/sp/skills/spur-cli/references/{agent,message}.md, config/workflows/, apps/cli/src/commands/agent.ts, packages/app/src/workflow/actions/agent-run.ts, and docs/design/session-pinned-dispatch.md. Follow direct references/callers needed to prove each comparison, not a full repository reread. Inspect installed skill/adapter metadata through existing Superskill read-only surfaces; never install/sync as part of the audit.

Verified seeds: wayfinder/SKILL.md:123 still uses --section tags; execution-workflow.md:278 still describes doctor auth checks; task-pipeline.yaml:199 resolves role pins and :233/:376/:442/:505 declares reuse/fresh policy; :355 guards mutationPolicy and plugins/sp/tests/task-pipeline-resilience.test.ts covers it. Resolve actual line numbers at execution. These seeds are not an exhaustive defect list.

Use source-local `bun run apps/cli/src/index.ts feature sync --all --dry-run --json` once, `feature show <id> --json`, and `task list --feature <id> --json`. If no frontier is visible, search only feature_id metadata in configured task folders, extract WBS, then use task show; do not derive WBS from sync prose. Current readiness audit found I7/P/E7 with zero linked tasks across folders; the execution snapshot can differ.

JSON contract: {schemaVersion:1, task:"0903", sourceCommit, capturedAt, surfaces:[{id,path,kind,status,reason}], findings:[{id,category,assertion,observed,evidence:[{path,line}],owner,disposition}], journeys:[{id,steps,identityKeys,receipt,failures,suggestion}], scenarios:[{id,mode,question,evidenceSources,findingIds}], unknowns:[]}. Modes are inline|pipeline|fleet; every row references existing inventory/finding IDs. Categories/dispositions use the vocabulary in R5; no forced bug classification. Markdown explains the smallest follow-up per confirmed finding.

Output feeds 0905 via the scenario IDs, source commit, and evidence source list. 0904 is independent and has separate artifacts. No upstream task prerequisite.

### Plan

- [ ] Step 1 (R1, AC1): Freeze an explicit surface inventory reachable from dev-run, dev-runall, dev-parallel, super-planner, super-coder, super-reviewer, spur agent, spur message, and every model-bearing workflow action. Include each directly referenced runtime contract and installed adapter target that can be located; list missing installed targets without inventing paths.
- [ ] Step 2 (R2, AC2): Compare CLI flags/output/selector semantics, quota ownership, role pins, reuse/fresh sessions, capability fallback, receipt identity, and mutation policy across the frozen surfaces; each mismatch cites current source and asserted guidance.
- [ ] Step 3 (R3, AC3): Capture feature sync --all --dry-run once; use its proposed statuses only in the report. Resolve archived linked tasks through task show before calling a feature empty or terminal. Cover I7, P, D62, E6, B1, B3, G1, G4, G65, and I4 without modifying them.
- [ ] Step 4 (R4, AC4): Map four journeys—inspect/select executor, dispatch one task, send/wait for a request, and recover an interrupted member—to existing commands, identity keys, receipts, and failure outcomes. Propose simplification only for demonstrated redundant steps.
- [ ] Step 5 (R5, AC5): Assign each confirmed finding an existing owner or explicit unowned disposition; separate shipped behavior, stale prose, absent adoption, unverified behavior, and already-owned work. No new feature/task allocation in this investigation.
- [ ] Step 6 (R6, AC6): Deliver 0903-contract-adoption.md and 0903-contract-adoption.json with the schema and coverage accounting below; enumerate concrete scenarios for dependent task 0905.
- [ ] Step 7 (R7, AC7): Validate row IDs, source anchors, inventory coverage, dispositions, and scenario references with a repeatable local check; report all unknowns and execution constraints.

### Solution

Investigation artifact for R1–R6. Provenance: all live evidence captured this pass with the source-local CLI (`bun apps/cli/src/index.ts … --json`, exit 0) in worktree `spur-new-runall-feature-i31-20260919-180944`; bare `spur` was not used for evidence. No source, plugin, workflow, adapter, or config edits were made; no statuses changed; no feature closed.

## A. Contract matrix (R1)

| # | Surface | Source assertion | Live / installed behavior | Evidence | Confidence |
|---|---------|------------------|---------------------------|----------|------------|
| A1 | `spur agent` verb set | 8 verbs + hidden `loop` — `plugins/sp/skills/spur-cli/references/agent.md:15-27` | Live help exposes exactly `list, status, usage, doctor, run, wait, start, stop`; `loop` hidden | `agent --help --json` | high — match |
| A2 | `agent run --agent` headless semantics | Substitute tier resolution + warn once, never reject (0687 R3) — `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-46`, `plugins/sp/skills/spur-dev/references/flag-glossary.md:51` | Behavior substitutes + warns (`packages/app/src/services/agent-service.ts:1766-1778`) but help string says "host-session-only; errors on headless surfaces" (`apps/cli/src/commands/agent.ts:290`) | help + source read | high — help string stale (F2) |
| A3 | `agent usage` surface | Run-once codexbar capture, external schedule — `agent.md:26`, `docs/design/session-pinned-dispatch.md:113-118` | Live: `--dry-run --source <name> --json --json-envelope`, ADR-051 consented verb present | `agent usage --help --json` | high — match (B6 shipped) |
| A4 | `agent doctor` provenance | Availability `owner/since/reason` + snapshot `age` columns — design §3.5 (`session-pinned-dispatch.md:71-73`); B8 `capabilities` per row | Live `--json` rows carry B8 `capabilities` (+`verifiedAgainst`) and every row carries `availability{disabled,owner,since,reason}` with `owner:"operator"` on the 6 disabled rows ✔; gap: `since`/`reason` are **null** on all rows and top-level `usage` is **null** — no snapshot/`age` on this machine, so §3.5 provenance is only partially populated | `agent doctor --json` (captured) | high for shape, gap repro named (H2) |
| A5 | `message send` identity/idempotency | `--to` XOR `--role`; `--request-key` replay (0832) — `plugins/sp/skills/spur-cli/references/message.md:44-63` | Live flags identical incl. replay wording "(0832)", `--until injected\|invoke-exit` | `message send --help --json` | high — match |
| A6 | wait-family receipt/error vocabulary | `occupant_gone/run_replaced/wait_stalled/timeout`; `selector_unmatched/selector_ambiguous` — `agent.md:129-130`, `message.md:50-77` | Flag surface matches live; runtime receipt behavior not reproduced here (needs `spur serve` + occupant) | `agent wait --help --json` | medium — flags verified, runtime deferred (G4/G1) |
| A7 | workflow layering | project > registered > shared (ADR-113) — `packages/app/src/workflow/workflow-resolver.ts:16-21` | All 9 definitions resolve from BOTH `registered` (`~/node_modules/@gobing-ai/spur/config/workflows`, published 0.3.90) AND `shared` (checkout); 0 project-layer overrides → registered shadows the checkout for bare-`spur` runs | `workflow list --json` | high — dual-copy shadowing confirmed (F7) |
| A8 | role routing SSOT | Layer-1 roles; command `role:` frontmatter honored — `plugins/sp/references/roles.md:1-6`, `packages/app/src/services/slash-commands-service.ts:304` | Live `doctor --json` returns `rolesSource: config`; scan roots are `plugins/sp/commands` + `.claude/commands` (`slash-commands-service.ts:161-179`, `:185-188`) — installed `~/.agents/skills` is **not** scanned | source read + doctor capture | high |
| A9 | B7 session policy in pipelines | Resolve-once pins + role defaults — design §4 (`session-pinned-dispatch.md:79`) | Adopted: precheck `doctor.probe` pins `__executor.<role>` (`config/workflows/task-pipeline.yaml:199-213`, `config/workflows/idea-pipeline.yaml:95-97`); implement/fix `role: coder` + `session: reuse` + `requireDiff` + `requiresCapabilities` (`task-pipeline.yaml:229-241`, `:372-376`); review/verify `role: reviewer` + `freshSession: true` + `session: fresh` (`:423-442`, `:494-505`); planner stages `session: fresh` (`idea-pipeline.yaml:128-131`); pin read with no per-stage doctor call (`packages/app/src/workflow/actions/agent-run.ts:248`, `actions/doctor-probe.ts`) | YAML + source read | high — adopted |
| A10 | B7 session policy in plugin prose | Same-commit obligation: cross-cutting "Inline-default execution surface" gains the session-policy paragraph — design §8 (`session-pinned-dispatch.md:136`) | **Missing**: zero matches for `session: reuse\|fresh` or `__executor.`/`__session.` in all of `plugins/sp` prose; only pointer is `plugins/sp/skills/spur-cli/references/agent.md:257` (§6 fleet) | repo-wide grep | high — adoption gap (F3) |
| A11 | installed generated adapters | Superskill installs `sp-*` skills from `plugins/sp` | 83 `sp-*` dirs in `~/.agents/skills`; frontmatter `role:`/`argument-hint`/`allowed-tools` stripped from **every** installed SKILL.md (source commands carry them, e.g. `plugins/sp/commands/dev-run.md:1-6`); `/sp:x`→`/sp-x` naming conversion; content otherwise equal (diffs naming-only for `execution-workflow.md`, `cross-cutting.md`, `agent.md`); installed `sp-dev-run` mtime 17:28 vs source 18:09 Sep 19 — installed is stale-by-date but not semantically drifted | file diff + frontmatter sweep | high (difference), hypothesis (impact, F4) |

## B. Findings and dispositions (R2)

- **F1 — confirmed mismatch.** `plugins/sp/skills/wayfinder/SKILL.md:123` still documents `feature update <id> --section tags --from-file …`; live `feature update` exposes `--field/--value` for frontmatter and a closed-world `--section` body set (`feature update --help`). This is exactly I7 R1's scope; I7 is still `backlog`, so the fix has not landed. Smallest slice: one-line recipe correction + I7 R2 semantic parity layer.
- **F2 — stale guidance.** `agent run` help string contradicts code + two plugin SSOTs (A2). Smallest slice: align `apps/cli/src/commands/agent.ts:290` wording with 0687 R3; add help-vs-behavior parity assertion. Public-surface-adjacent → owner decision first (U2).
- **F3 — adoption gap.** B7 session-policy paragraph absent from `cross-cutting.md` (A10). Smallest slice: one paragraph (role defaults, `session:` option, pin vars) + link to design §4.
- **F4 — confirmed difference, hypothesis on impact.** Installed adapters strip `role:` frontmatter (A11). No audited consumer reads roles from `~/.agents/skills`, so impact is **not established**. Reproduction: invoke an installed-adapter command with `--agent auto` and inspect the `resolved` block. Owner candidates: B3 (projection) + I4 (fan-out propagation).
- **F5 — no drift.** `execution-workflow.md:278` "Known diagnostic gap" prose remains accurate (doctor still cannot detect quota/model unavailability; B6 `usage` is the separate quota surface). Partial-artifact resume prose (`:299-317`) agrees with the live action split (subprocess writes the artifact; inline path has none — `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:415`).
- **F6 — adoption gap (operator data, not code).** No agent-usage snapshot exists on this machine: doctor `usage` key null (A4). Matches I31's charting note; the producer is run-once by design. Routed to 0904.
- **H1 — hypothesis (not a bug).** doctor `--json` rows already carry `availability{disabled,owner,since,reason}` — `owner:"operator"` on disabled rows — but `since`/`reason` are **null** on every row and no snapshot `age`/`usage` exists on this machine (A4); provenance may populate only after a real availability event or usage snapshot. Reproduce in 0904 with a usage-snapshot fixture.

## C. D62 callers, evidence, ownership (R3)

- Definitions: 9 total; dual resolution registered + shared, none project-local (A7). Real-run counts quoted in D62's goal (task-pipeline 31 done / 177 failed / 3 paused; `agent.run` 96% of machine time) are inputs, not re-verified here.
- Live callers found: `task-pipeline` — `/sp:dev-run --mode full` host driver and `spur workflow run` (`plugins/sp/commands/dev-run.md:67-68`, recursion guard `apps/cli/src/commands/workflow.ts:72`); `idea-pipeline` — `/sp:dev-idea`, `/sp:dev-plan` (host driver inline; `auto`/name → `workflow run --async`, `dev-idea.md:46-47`, `dev-plan.md:46-47`); `wrapup-pipeline` via `/sp:dev-wrap`. Callers for `pr-review`, `wayfinder-resolution`, `history-anatomy`, `feature-verification` were **not enumerated** this pass — named gap for 0905 scenario selection.
- Status/evidence question: D62 is `active` while its child band 0866–0882 reads done (sampled `task show 0866|0874|0882 --json`, all `done`). Recorded as a closure/evidence question only — D62 not closed, no status touched.
- Adoption markers live in the task pipeline: contract-first guards (`requiresCapabilities` before spawn), `requireDiff` no-op guard, route-reason log, doctor.probe role pins (A9) — D62's contract-first/traceability intent is visibly adopted in the task pipeline.

## D. Operator journeys (R4)

- **agent run:** selector (`role | executor | binary | auto | inline`) → resolution (`agent-service.ts:1762-1778`; unknown selector error names accepted vocabulary `:2334`) → occupant addressing (`--spec`/`--drain`, legacy `--agent <spec-id>` fallback per `agent.md:57`) → persisted run record under `.spur/run/` → `--json` `resolved` block `{role, tier, executor, agent, source}`. Exit codes 0/1/2 + propagated agent exit.
- **message send:** addressing (`--to` XOR `--role`; zero/multi-match hard errors) → idempotency (`--request-key` replay/conflict, 0832) → receipt wait (`--wait` occupant snapshot before enqueue; `--until` OR; wait failure never rolls back enqueue) → reconciler hold reasons (`delivery-failed`, `attempts-exhausted`, `outcome-unknown`, `run-exit-only`; `outcome-unknown` never auto-released — `message.md:78-93`).
- **Simplification candidates (recorded, not proposed as surface changes):** (1) F2 help-string alignment; (2) finish the ADR-091 `--json-envelope` deprecation window — every verb carries the dual-output ceremony; (3) deduplicate the wait-error vocabulary tables across `agent.md`/`message.md` (same codes, two ledgers). Identity, idempotency, and receipt constraints preserved; compatibility tolerance remains the map's open decision (U1) — no removal proposed.

## E. Owner register (R5)

| Finding | Owner (status) | Note |
|---------|----------------|------|
| F1 `--section tags` recipe | **I7** (backlog) | Exactly I7 R1 scope; confirmed live |
| F2 help-string drift | **B1** (verifying) candidate; class owner decision = U2 | I7's semantic layer covers plugin parity only, not CLI help strings |
| F3 B7 prose gap | plugin prose surface (spur-dev), tracked under **I31** program | No existing single owner; smallest-slice listed |
| F4 installed frontmatter strip | **B3** (verifying) + **I4** (verifying) | Cross-linked; do not open a parallel owner |
| F6/H1 usage snapshot + provenance rows | **0904** (usage-to-availability validation) | I31's own second investigation |
| F7 registered/shared shadowing + D62 closure evidence | **D62** (active) | Includes dual-copy divergence diff (U5) |
| Watcher freshness / run identity / receipts | **P** (active, 0 linked tasks) | No new finding this pass; stays a 0905 input |
| Run/session/cost correlation | **E6** (active) | Deferred to 0905 by design |
| G1/G4/G65/I4 | verifying | G1/G4: parity rows only (A5/A6), no drift found; G65 `agent.fleet` not exercised (needs `spur serve`) — named gap; I4 via F4 |

No duplicates created; no new backlog subsystem proposed.

## F. Unresolved questions and inputs for 0905 (AC3/AC4)

- **U1** — compatibility/deprecation tolerance for any `agent`/`message` simplification (map open question; unchanged).
- **U2** — who owns code-side help-text-vs-behavior drift (plugin parity harness does not see CLI strings).
- **U3** — does any live consumer resolve roles from installed adapters (F4 reproduction named in B).
- **U4** — capture `agent doctor --json` provenance with a real usage snapshot + a fixture that populates `since`/`reason` (H1/H2; 0904).
- **U5** — content diff `~/node_modules/@gobing-ai/spur/config/workflows` vs checkout `config/workflows` (registered copy is published 0.3.90; out-of-tree, not read this pass).
- **0905 scenario inputs:** reuse-vs-fresh session effect on coder→test-fix continuity (A9 pins) vs reviewer isolation; registered-vs-shared definition divergence as a run-environment variable; usage-absent doctor behavior as an availability scenario (F6); wait/receipt runtime semantics with a live serve occupant (A6).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Matrix rows A1-A11 at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:60-70`, each carrying source path/line, asserted shape, live behavior, evidence command, confidence; re-sampled live this run: A1 `bun apps/cli/src/index.ts agent --help` exit 0 = exactly list,status,usage,doctor,run,wait,start,stop with loop hidden (verb map re-read at `plugins/sp/skills/spur-cli/references/agent.md:15-27`); A4 fresh `agent doctor --json` exit 0 = 16 rows, 16/16 carry availability{disabled,owner,since,reason}, exactly 6 disabled rows all owner "operator", since/reason null on all rows, top-level usage null — matches remediated A4 wording field-for-field (round-1 PARTIAL driver resolved); A7 `workflow list --json` exit 0 = 18 entries = 9 defs x registered(9)+shared(9), 0 project, layer vocabulary `packages/app/src/workflow/workflow-resolver.ts:16-21`; A9 pins re-read at `config/workflows/task-pipeline.yaml:199-213`, `:229-241`, `:423-442`, `:494-505` and `config/workflows/idea-pipeline.yaml:95-97`, `:128-131` |
| R2 | MET | Dispositions F1-F6+H1 at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:74-80`; re-confirmed live this run: F1 (`plugins/sp/skills/wayfinder/SKILL.md:123` stale --section tags recipe; Tags absent from FEATURE_CANONICAL_SECTIONS `packages/domain/src/planning/markdown-document.ts:51-57`), F2 (`apps/cli/src/commands/agent.ts:290` help string contradicts substitute+warn-never-reject at `packages/app/src/services/agent-service.ts:1766-1778`, SSOT `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-46`), F3 (grep plugins/sp *.md = 0 matches for session-policy prose), F5 (`plugins/sp/skills/spur-dev/references/execution-workflow.md:278` Known diagnostic gap prose accurate); H1 (:80) labeled hypothesis and matches the fresh doctor capture |
| R3 | MET | Section C at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:82-87`; D62 recorded as evidence/status question without change — `feature show D62` exit 0 status=active this run while children 0866/0874/0882 all done (task show exit 0 each, re-run this run); caller anchors re-read: `plugins/sp/commands/dev-run.md:67-68`, `dev-idea.md:46-47`, `dev-plan.md:46-47`; 4-definition caller gap honestly named for 0905 |
| R4 | MET | Section D at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:89-93`; anchors re-read: `plugins/sp/skills/spur-cli/references/message.md:44-47` wait-before-enqueue + enqueue never rolled back, `:78-93` distinct durable hold reasons with outcome-unknown never auto-released; legacy `--agent <spec-id>` fallback at `plugins/sp/skills/spur-cli/references/agent.md:57`; unknown-selector accepted vocabulary at `packages/app/src/services/agent-service.ts:2334`; compatibility open at U1 :113; no new public verb proposed |
| R5 | MET | Owner register at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:95-109`; statuses fresh-pulled via feature show exit 0 this run: I7=backlog, B1=verifying, B3=verifying, I4=verifying, D62=active, P=active, E6=active — all match the register cells; no duplicates, no new backlog subsystem (git status --porcelain lists only the task file) |
| R6 | MET | Matrix + command provenance + U1-U5 at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:113-117` + smallest follow-up slice per confirmed finding in section B (:74-77); observe-only holds: `git status --porcelain` lists only `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md` — no source/plugin/workflow/adapter/config edits; this run wrote only the answer file, no section writes, no status transitions, no commits |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Five surfaces re-sampled live this run with path/line evidence — live CLI (agent --help, agent doctor --json, workflow list --json, agent usage --help, all exit 0), plugin source (`apps/cli/src/commands/agent.ts:290`), installed adapters (83 sp-* dirs recounted; 0/83 installed SKILL.md carry role: in frontmatter vs source `plugins/sp/commands/dev-run.md:1-6`; mtime 17:28 installed vs 18:09 source), workflow YAML (`config/workflows/task-pipeline.yaml:494-505` verify fresh pins), session policy (`docs/design/session-pinned-dispatch.md:71-73` section 3.5 Doctor provenance); round-1's A4 accuracy defect resolved and re-verified field-for-field against a fresh doctor capture |
| AC2 | MET | command | Every finding at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:74-80` carries a disposition class; H1 (:80) explicitly "hypothesis (not a bug)" and F4 (:77) impact-hypothesis — no hypothesis reported as a bug, re-verified against fresh evidence (F1 recipe live at wayfinder:123; H1 corrected text matches the fresh doctor capture field-for-field); residual dangling "H2" token (:63, :116) is a label nit (P3 below), not a mislabeled hypothesis |
| AC3 | MET | command | `bun apps/cli/src/index.ts message send --help` exit 0 this run: --to mutually exclusive with --role, --request-key replay wording (0832), --wait/--until injected or invoke-exit; prose re-read at `plugins/sp/skills/spur-cli/references/message.md:44-47` and `:78-93`; public-surface compatibility recorded open at U1 `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:113` |
| AC4 | MET | command | Owner register names the next owner/follow-up per confirmed finding at `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md:95-109`; D62 evidence gap recorded without status change — feature show D62 exit 0 status=active this run, children 0866/0874/0882 all done; git status shows no edits by this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0903 (re-review after remediation, fresh digest bracket)

**Scope:** WBS 0903 — remediation delta on `docs/tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md` (A4/H1 availability-schema wording, four re-pointed anchors, A11 count/mtime, 0904-input rescope; docs-only, uncommitted working tree on d8ff752b2). Dimensions: functional, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS — the prior P2 is resolved and re-verified against a fresh `agent doctor --json` capture this pass; R1–R6 and AC1–AC4 remain MET; residual findings are two P3 precision defects plus advisories, none gate-blocking.

##### Prior-findings disposition (re-verified with fresh evidence this pass)

| Prior # | Was | Disposition | Fresh evidence (this pass) |
|----------|----------|----------|----------|
| 1 | P2 (major) — A4/H1 misdescribed the `agent doctor --json` availability schema | RESOLVED | Fresh capture (exit 0): 16 rows, **every** row carries `availability{disabled,owner,since,reason}`; exactly **6** rows disabled with `owner:"operator"`; `since`/`reason` null on all 16; top-level `usage: null`; B8 `capabilities` + `verifiedAgainst` present on 16/16; `rolesSource: config`. A4/H1's corrected wording matches the capture field-for-field, and H1 remains labeled "hypothesis (not a bug)" with the 0904 reproduction rescoped to the null since/reason + snapshot-age gap |
| 2 | P3 (minor) — four stale line anchors | RESOLVED | All four re-pointed anchors verified in-source: legacy `--agent <spec-id>` fallback text at `plugins/sp/skills/spur-cli/references/agent.md:57`; design §3.5 Doctor provenance at `docs/design/session-pinned-dispatch.md:70-72` (cited 71-73 covers the body); `.claude/commands` scan root at `packages/app/src/services/slash-commands-service.ts:184-196` (cited 185-188); `occupant_gone`/`run_replaced` rows exactly at `agent.md:129-130` |
| 3 | P3 (minor) — A11 environment-state drift (85 vs 83; mtime) | RESOLVED | Recount **83** `sp-*` dirs (two methods agree); cited mtime 17:28 matches the installed `~/.agents/skills/sp-dev-run/SKILL.md` **file** (directory mtime is 17:38 — the file-vs-dir ambiguity resolves in the artifact's favor; source `plugins/sp/commands/dev-run.md` is 18:09 Sep 19 as stated). "Stripped from **every** installed SKILL.md" now holds on a full sweep: 0 of 83 installed files carry `role:` in frontmatter; sampled reference diff (installed vs source `agent.md`) is byte-identical, consistent with "naming-only" |
| 4 | P4 (advisory) — inline the captured JSON shape for schema-sensitive claims | ADOPTED | A4/H1 now carry the captured `availability{...}` shape inline — the change that made them verifiable and correct |

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|----------|----------|----------|----------|----------|
| 1 | P3 (minor) | correctness | A3 carries two stale anchors — same defect class as prior finding 2, outside last pass's audited set: the design citation `session-pinned-dispatch.md:113-118` lands on the G66 fleet capability table, while §3.4 Usage producer is `:57-69` (heading :57, ADR-051 public surface :67); and `agent.md:26` is the `list` verb row, while the `usage` row is `agent.md:29`. Claim substance verified true both times: live `agent usage --help` shows `--dry-run --source <name> --json --json-envelope`, and the verb row reads "Run-once provider usage capture (codexbar) … scheduled externally". ~2-line anchor edit, no conclusion change | artifact §A row A3 |
| 2 | P3 (minor) | correctness | Dangling hypothesis label: "H2" is referenced twice — A4's confidence cell ("gap repro named (H2)") and §F U4 ("(H1/H2; 0904)") — but defined nowhere: §B defines only H1, and neither the I31 map nor 0905 contains an H2. AC2's disposition/label discipline implies every referenced label resolves; drop "H2" or define it (one-word edit) | artifact §A A4 confidence cell + §F U4 |
| 3 | P4 (advisory) | architecture | Hand-off pointer: 0903 §B H1/§F U4 now correctly scope 0904's input to the null `since`/`reason` + snapshot-`age` gap, but 0904's own charter is untouched since creation (single commit d8ff752b2) and its R1 fixture list covers operator-owned records without an explicit doctor-provenance/since-reason-populating fixture row. When 0904 opens, its implementer should lift the U4 fixture into R1/plan; non-blocking for this task | `docs/tasks5/0904_validate-usage-to-availability-decisions-with-sanitized-fixt.md` R1 vs artifact §F U4 |
| 4 | P4 (advisory) | — | Housekeeping carried from the prior review for the record stage: Requirements/AC checkboxes R1–R6/AC1–AC4 remain unchecked in the task body; status remains `wip` with an honest History row. This review made no lifecycle transition and no reviewed-content edit | task body Requirements/AC sections |

##### Functional Traceability

| Req | Status | Evidence |
|----------|----------|----------|
| R1 | MET | Matrix A1–A11 re-sampled live this pass, all matches: verb set via `agent --help` (exactly `list, status, usage, doctor, run, wait, start, stop`; `loop` hidden); doctor capture per prior-finding-1 row; `workflow list --json` = 18 entries = 9 defs × registered(9)+shared(9), 0 project-layer; `agent usage --help` flags; `rolesSource: config`; `agent.md:15-27` verb-map anchor holds |
| R2 | MET | Dispositions intact and re-verified: F1 live (`plugins/sp/skills/wayfinder/SKILL.md:123` recipe; `Tags` absent from `FEATURE_CANONICAL_SECTIONS`, `packages/domain/src/planning/markdown-document.ts:51-57`; closed-world `--section` confirmed in `feature update --help`); F2 live (`apps/cli/src/commands/agent.ts:290` stale help string vs substitute+warn at `packages/app/src/services/agent-service.ts:1766-1778`, SSOT prose `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-46` + `flag-glossary.md:51`); F3 live (0 grep matches for `session: reuse|fresh` and `__executor.`/`__session.` across `plugins/sp` *.md); H1/F4-impact remain labeled hypothesis |
| R3 | MET | §C callers re-anchored (`plugins/sp/commands/dev-run.md:67-68`, `dev-idea.md:46-47`, `dev-plan.md:46-47`, recursion-guard comment `apps/cli/src/commands/workflow.ts:68-76`); owner statuses re-pulled live: I7 `backlog`, B1/B3/I4 `verifying`, D62 `active`, P `active`, E6 `active` — §E matches exactly; four-definition caller gap honestly named for 0905 |
| R4 | MET | §D journeys hold: `message.md:44-63` wait-before-enqueue/no-rollback + error-code sharing, hold-reasons block `:78-93`; selector/legacy-fallback rows `agent.md:52-57`; unknown-selector vocabulary `agent-service.ts:2334`; identity/idempotency/receipt constraints preserved; compatibility stays open (U1); no removal proposed |
| R5 | MET | §E register covers I7, B1, B3, I4, G1, G4, G65, P, D62, E6 + 0904 routing; live statuses match every owner-status cell; no parallel subsystem; G65/serve gap named |
| R6 | MET | Matrix + provenance + U1–U5 + smallest-slice per confirmed finding all present; `git status --porcelain` shows only the task file modified — no source/plugin/workflow/adapter/config edits; this re-review wrote only the Review section via `task update --section Review` |

##### AC traceability (AC1–AC4)

| AC | Status | Evidence |
|----------|----------|----------|
| AC1 | MET | All five surfaces covered with path/line evidence; re-sampled live this pass (`agent --help`, `agent doctor --json`, `agent usage --help`, `workflow list --json`, `feature update --help`, source reads) |
| AC2 | MET | Every finding carries a disposition; H1/F4 labeled hypothesis, none reported as bug; new finding 2 is a dangling reference, not a mislabeled hypothesis |
| AC3 | MET | §D preserves identity/idempotency/receipt constraints; U1 records compatibility as an open decision |
| AC4 | MET | §E names the next owner per confirmed finding; D62 re-confirmed `active` live this pass — no status change |

##### Review-mandate checks and SECUA notes

- Installed-versus-source drift evidenced: YES — full-sweep frontmatter check (0/83 installed `role:` carriers), byte-identical sampled reference diff.
- Hypotheses remain labeled: YES — H1/F4 labels intact and now factually accurate.
- Existing ownership not duplicated: YES — §E routes only to existing features/tasks; live statuses match §E cells.
- No public surface or lifecycle status changed: YES — working-tree diff is the task file only; D62 still `active`; no commits made.
- Security: no findings — docs-only artifact; captures contain executor names/config paths only, no credentials or tokens; all evidence verbs run were read-only (`--help`, `doctor --json`, `list --json`, `show --json`).
- Efficiency: no findings — evidence commands are one-shot reads; no test/build execution claimed.
- Architecture: artifact keeps the one-matrix/one-owner-register contract; prior P4 advisory adopted; remaining advisories are hand-off housekeeping only.

**Next:** Fix A3's two anchors and drop/define the dangling "H2" (~3 line edits, non-blocking, no conclusion change); feed the §F U4 since/reason-populating fixture into 0904's R1 when it opens. Cleared for the 0904/0905 hand-off.

### References

- `plugins/sp/skills/wayfinder/SKILL.md`
- `plugins/sp/skills/spur-dev/references/execution-workflow.md`
- `plugins/sp/skills/spur-dev/references/cross-cutting.md`
- `plugins/sp/skills/next-router/references/routing-table.md`
- `config/workflows/task-pipeline.yaml`
- `plugins/sp/tests/task-pipeline-resilience.test.ts`
- `docs/design/session-pinned-dispatch.md`
- Feature I31, via `spur feature show I31 --json`.
- Readiness provenance: HEAD d8ff752b2; one local worktree; no wip tasks at audit. Recheck on execution.

### History

- 2026-09-20T01:31:57.811Z todo → wip (system)
- 2026-09-20T03:00:53.723Z wip → testing (system)
- 2026-09-20T03:00:55.498Z testing → done (system)

