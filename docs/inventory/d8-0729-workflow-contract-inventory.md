# D8 Workflow Contract Inventory — ADRs, Gates, Baselines, Capability Ownership

- **Task**: 0729 (`audit-workflow-adrs-gates-baselines-and-capability-ownership`)
- **Provenance**: audit run on commit `86fd36978` (worktree `sp/runall-d8-6869`), 2026-09-02, all live probes run with the source-local CLI (`bun run apps/cli/src/index.ts`). No repo state mutated; probe fixture under `/tmp` removed.
- **Method**: ADR chain read (docs/00_ADR.md §050–§102) → claim cross-checked against tasks4 lifecycle (`done` = code existed at verify time) → code anchors verified by reading the named sites → gates/baselines re-executed live → behavioral probes for schema claims (omitted `kind`, empty `version`).

---

## A. ADR claim matrix (R1)

Statuses: **implemented** (code matches AC), **partial** (some ACs), **drifted** (implemented but invariant no longer true), **dead** (implemented but unreachable in real flow), **stale-doc** (derived docs contradict shipped reality).

| ADR | Claim | Status | Anchor evidence |
| --- | --- | --- | --- |
| 050 | Split check gate (spur-check / spur-check-new, corpus opt-in) | implemented | package.json `spur-check` / `spur-check-new` chains |
| 051 | Four-surface placement governance + consent ledger | partial | `script-contract-check` PASS live (17 scripts); but only the plugin-script surface is mechanically enforced (§G gap 2) |
| 060 | Cost/token columns, no $ prices | implemented (sampled) | task 0559 `done`; typed cost joins in trace/history |
| 062 | Discipline sweep, warning ratchet | implemented-as-amended | superseded in scope by 092 (recorded in 090 amendment) |
| 065 | Script manifest + .mjs twins + shipped-surface invocation ban | implemented | gate PASS live: 7 standard twins, 10 repo-only, 0 violations |
| 069 | Composition advisory, ≥6-line shell actions carry dispositions | **drifted** | **42 unsuppressed findings across 11 shipped workflows** (was "0 findings, 25 suppressed" on 2026-08-21); `workflow validate config/workflows/task-pipeline.yaml` → 14 advisories incl. `record:onEnter:1 — 21 shell lines` |
| 070 | Progress projection, digest diagnostics, event wake | implemented | progress-projection.ts (incl. `definition-drift` diagnostic :293) |
| 071 | Proof-chain symmetry (verify measures, record compares digest) | implemented | 0703/0704 `done`; task-pipeline.yaml proof hops; only enforcement gap is a stale `expectFile` (§F-8) |
| 072 | Delete planning-pipeline + pipeline2 | implemented | not present in config/workflows (11 files, no planning-pipeline/pipeline2) |
| 076 | Retire task-pipeline2 + modelQueries budgets | implemented | pipeline-budgets.json records the 538s-fixture retirement; eval-pipeline retained as measurement |
| 083 | corpus-snapshot gate as waiver | superseded-in-practice | recorded supersession by 090 in ADR chain |
| 087 | Agent var substitution warnings | implemented (sampled) | resolveAgent warning path (0687 R10 comment, workflow.ts makeSvc) |
| 088 | Reconcile no-op (warning only) | implemented-as-amended | severity stays warning; practice retired under 090 |
| 090 | Machine-regenerated corpus snapshot, severity contract | **implemented, gate failing by design** | `task check --corpus` → **exit 1**: snapshot has 272 accepted entries but lacks the D8/E81 wave — 24 findings incl. 0729–0734 + E81 are NEW; regeneration + ADR-093 waiver migration pending |
| 092 | Single-sided snapshot ratchet (new fails, vanished silent) | implemented | corpus-check.ts:630–700 loadAcceptedFindings; sweep scoped to active folder |
| 093 | Every PASS-changing waiver carries owner/review-date/removal condition | **partial** | pipeline-budgets.json complies (reference sensors, not waivers; silent-raise check vs git HEAD). Corpus snapshot (waiver-role) still has **no owner/review-date/removal fields** — the migration 093 names "pending" has not happened |
| 094 | requiresCapabilities axis in workflow YAML | implemented | 0706 `done`; agent-run parse + agent-service pre-spawn gate (agent-service.ts:987–990) |
| 095 | Budget fields parse + fail closed | implemented | 0707 `done`; `budget-unverifiable` refuses pre-execution |
| 096 | Tripwire catalog + evidence-bound events | implemented | 0708 `done`; evaluateTripWires fired at proof boundary (proof-fingerprint.ts) |
| 097 | Reviewer session/executor independence | implemented | 0710 `done`; freshSession + compareExecutorWith + review-independence.ts; unknown fails closed |
| 098 | Escalation packets | implemented | 0709 `done`; escalation-packet.ts + sink wired in CLI run/continue |
| 099 | Correction checkpoints, freshness-bound resume | **partial** | 0711 `done`: checkpoint write is an advisory shell step in the done state; but `continuePaused` never reads the checkpoint → **resume-side freshness validation absent** |
| 100 | Verified-outcome + correction-cost metrics | implemented | 0712 `done`; packages/app/src/services/verified-outcome.ts + history wiring |
| 102 | Capability attestation (executor/agent/working tree) | implemented, **stale-doc** | 0706 `done`; but ADR-102's detail pointer "docs/04 §agent-capability-attestation" is **dead** — the section does not exist in docs/04_DESIGN.md |

Derived-doc drift (AC item): **docs/03 §24 header still says "accepted design — ADR-094–100; not yet built"** while tasks 0703–0712 are all `done` and the code is live. ADRs 094–100 appear in docs/03 (1–2 mentions each) and **zero times in docs/04_DESIGN.md**.

## B. Implementation-task claim matrix (R2)

| Task | Claim | Lifecycle | Code check |
| --- | --- | --- | --- |
| 0559/0603/0604/0605/0606/0607/0608/0609/0610/0614/0616/0617 | core engine + baselines + CLI | all `done` | sampled: composition digest infra live; budgets gate live (with §F-3 defect); surface inventory live (with §F-11 drift) |
| 0611/0612/0613 | D7 chain | `done` | not re-verified this pass |
| 0618–0626 | D7b chain | `done` | not re-verified this pass |
| 0703–0712 | autonomy contracts (proof symmetry, budgets, tripwires, checkpoints, packets, independence, metrics, capabilities) | all `done` | verified live/by anchor: 094–100 confirmed (§A); 0703/0704/0706/0707/0708/0709/0710/0712 anchors above |
| 0723 | deterministic prechecks | `done` | task-pipeline.yaml size/evidence precheck hops present with fallback resolution |

No task was found `done` without corresponding code, except where §F records a runtime defect in the delivered behavior. Lifecycle state is otherwise consistent with shipped reality.

## C. Baseline field register (R3)

Owner/removal-criteria columns: per R3, the owner of each traced field is the sole consumer named in its row, and the removal criterion is that consumer's exit — per-field owner/review-date/removal columns land with the ADR-093 waiver-field migration (Decision 8), which owns that schema change.

| File | Field/path | Enforced? | Consumer | Disposition |
| --- | --- | --- | --- | --- |
| config/workflow-composition-baseline.json | `terminalStates`, `modelQueries`, `actions[].kind/invocation` | **two-sided** | checkWorkflowComposition (bun test gate) | keep |
| config/workflow-composition-baseline.json | `actions[].disposition` | input only | ADR-069 advisory suppression (workflow-service.ts:1591); regen preserves surviving keys | keep — the one non-compared field with a real consumer |
| config/workflow-composition-baseline.json | per-workflow `boundary`, `disposition`, `callers`, `artifacts`, `failurePolicy`, `digest` | **inert** | zero code consumers; `regen --check` flags all 49 as drift; regen deletes them | dead weight — let regen delete, or add a checker |
| config/workflow-composition-baseline.json | top-level `proofInputs` | **inert** | zero code consumers | dead weight |
| config/pipeline-budgets.json | `budgets.<name>.modelQueries/wallClockMs` | enforced | scripts/spur-dev.ts check-pipeline-budgets (median-of-sane vs ceiling) | keep; `null` = unenforced-until-measured debt (recorded, ADR-compliant). **Currently FAILING: docs-pipeline modelQueries measured 2 > ceiling 1, gate exit 1 at audit HEAD — recorded, not waived; the raise/fix decision lands with 0730's real-run cost measurement** |
| config/pipeline-budgets.json | `source`, `decision` | provenance | silent-raise gate requires fresh `decision` on numeric raise vs git HEAD | keep |
| config/corpus-baseline.json | `entries` (`kind:id:code` → severity) | one-sided | corpus-check.ts:630–700: new-vs-accepted fails; vanished-accepted silent | 272 entries; gate fails on the 24 not-yet-accepted findings (D8/E81 wave) pending regeneration |
| plugins/sp/scripts (plugin-scripts.json) | 17 entries, `contract: standard/repo-only` + twins | two-sided | script-contract-check → PASS live | keep |

## D. Gate reproduction log (live, this audit)

| Command | Result |
| --- | --- |
| `bun run scripts/commands/regen-composition-baseline.ts --check` | FAIL — **49 drifted facts**; every workflow entry carries the 6 inert fields regen would delete |
| `workflow validate config/workflows/<each of 11>.yaml` | all `valid: yes`; **42 `composition advisory` findings** unsuppressed across the set (task-pipeline 14, idea-pipeline 9, pr-review 5, history-anatomy 4, wrapup 4, wayfinder 3, basic/docs/feature-dev 1 each); exit 0 (advisory posture per 069 amendment holds) |
| `bun scripts/commands/pipeline-budgets.ts` | **silent no-op** — exits 0 with no output (no `import.meta.main` bootstrap; only reachable via `bun scripts/spur-dev.ts check-pipeline-budgets`). Budgets gate itself was anchored, not live-reproduced this pass |
| `task check --corpus` | FAIL exit 1 — snapshot has 272 accepted entries; 24 NEW findings including D8's own wave (0729–0734, E81) |
| `bun plugins/sp/scripts/script-contract-check.ts` | PASS — 17 scripts baselined (7 standard / 10 repo-only), 0 violations |
| `bun run scripts/spur-dev.ts check-pipeline-budgets` | FAIL exit 1 — **BUDGET EXCEEDED: docs-pipeline modelQueries measured 2 > ceiling 1** (live at audit HEAD; recorded per AC2, resolution owned by 0730/0732 cost work) |
| `bun plugins/sp/scripts/surface-drift-inventory.ts` | **3 confirmed mismatches** — captured help surface stale vs live CLI: `spur database` noun gone; `task create --section` / `--body` flags gone (live roots now include `builder`, `projects`, `self`) |
| `workflow validate /tmp/probe (state-machine, no kind, version: "")` | **valid** — omitted `kind` defaults accepted by state-machine schema (probe-verified; kind optionality is proven by the JSON schemas' top-level `required` lists — state-machine omits `kind`, transition-flow requires it; `packages/domain/src/stage-registry/schema.ts` covers stage-schema versioning, not kind); empty-string `version` accepted (no minLength) |

## E. Surface parity matrix (R4)

| Surface pair | Parity | Notes |
| --- | --- | --- |
| `workflow validate` vs `run` vs `continue` | **divergent** | validate/run: `validateSchema: true` (workflow-service.ts:627, 640); continue: `false` (:1076) and re-resolves def by *name* from current search paths — a paused run silently resumes on the current file; digest never compared (stamped best-effort at createRun, :171–176); drift is only a progress diagnostic (progress-projection.ts:293) |
| state-machine vs transition-flow schema | divergent (accepted) | `kind` optional in state-machine (:76), required in transition-flow (:119) — cross-dialect invisible |
| `version` field | schema-only | `z.string().optional()` both dialects; zero consumers; not rendered by list/show/trace; **included in `computeDefinitionDigest`** (canonical whole-def JSON, composition-baseline.ts:110) → version-only edits change digests with no behavior change |
| Source precedence: CLI run/continue vs agent `workflow` tool | **divergent** | `resolveWorkflowFile` (workflow-service.ts:1696): project-first then bundled; `make-lifecycle-adapter.ts` `resolveWorkflowPath`: bundled-first. Same name can resolve to different YAML depending on entry surface |
| help-captured surface inventory vs live CLI | **stale** | 3 mismatches (§D); drift is reported **and gated**: `surface-drift-inventory.ts:923` sets `process.exitCode = 1` (live re-run: exit 1 with the 3 mismatches) |
| extensions/`onError` axis | **asymmetric** | `extensions` declared in both JSON schemas and threaded to the host (workflow-service.ts:647, :1029; 0533 R1); `onError` absent from both schemas and unhandled in the service — failure policy is `failureStates`/`terminalNodes` only |
| CLI show/list/projection-status exposure | **indirect** | covered via §H version/digest observation only; dedicated divergence sweep deferred to 0731 graph-facts (its R3 explicitly owns projection + dry-run limits) |
| composition baseline vs shipped workflows | drifted | advisory findings (42) prove actions were added post-08-21 without dispositions; inert fields rot silently |

## F. Runtime & evidence defect register (R5/R8, severity-ranked)

| # | Sev | Defect | Anchor | Effect |
| --- | --- | --- | --- | --- |
| 1 | **S1** | `command.gate` timeout forwarded under wrong key | command-gate.ts:157 spreads `timeoutMs`; ProcessExecutor contract is `timeout` (external dep `@gobing-ai/ts-runtime`, `dist/process-executor.d.ts:58`, consumed at command-gate.ts:269); conditional spread bypasses excess-property check | **All command.gate `timeoutMs` values are silently ignored** — feature-dev.yaml's integration-review 1800000ms is dead config; gates hang or use executor defaults |
| 2 | **S1** | Nested feature-dev review structurally dead | feature-dev.yaml:156–169 `integration-review` command.gate runs `spur workflow run .spur/workflows/pr-review.yaml`; sync path sets `SPUR_WORKFLOW_RUN_ACTIVE=1` (workflow.ts:656); nested-run guard (workflow.ts:402–414, 0610 R4) refuses the child | gate always FAILs (refusal) and `softFail: true` lets the parent reach `done` anyway — **the feature integration review has never been able to run via feature-dev** |
| 3 | **S1** | CLI never passes `spurConfig` to WorkflowAppService | makeSvc (apps/cli/src/commands/workflow.ts:253–286) omits it; context doc says spurConfig is "the only app-config source" (workflow-service.ts:433) | `resolveDefaultAgentVar` (:668) always sees null on CLI paths → **`agent.default` config silently ignored** for `workflow run`/`continue` |
| 4 | **S2** | Continue ignores definition drift | continuePaused (workflow-service.ts:1007, 1076) — see §E | Edited/reschema'd YAML resumes mid-run; no digest comparison anywhere on resume |
| 5 | **S2** | Fail-open proof fingerprints | `createGitAlternateTree` returns `''` on any git failure (proof-input-fingerprint.ts:99,105,110,118) | digest over an empty tree compares equal to other empty-tree digests → proof bracket silently degrades to spec-only, still "verifies" |
| 6 | **S2** | Run-id path confinement | `--run-id` unvalidated (`options.runId \|\| crypto.randomUUID()`, apps/cli/src/commands/workflow.ts:512, same fallback on the async path :424); used in log path (packages/app/src/observability/workflow-run-log-sink.ts:70 `join(dir, runId + '.log')`) and trace dirs | `--run-id ../../x` writes outside `.spur/run/`; asymmetric with command.gate/run.artifact which enforce the prefix |
| 7 | **S2** | Suppressed task lookup weakens proof | test onEnter[0]: `task path … 2>/dev/null \|\| true … exit 0` (task-pipeline.yaml) writes empty taskpath file on failure | `taskSpecPath=""` → readOptional skips spec → **digest = tree-only, silently** (no error, no mark) |
| 8 | **S2** | Stale verifier expectFile | verify hop checks `.spur/run/<wbs>-verify-answer.txt` existence post-exit (agent-run.ts:553+); no step removes a prior run's file | a stale answer file from a previous run satisfies the verifier's file assertion |
| 9 | **S3** | `run.artifact` proof binding decorative | proofBinding option only echoed into result data (run-artifact.ts:88–101); never validated/bound; DAO record is `{path,kind,runId}` only | no enforcement behind the "bound to run proof" claim |
| 10 | **S3** | Whole-worktree Solution attribution | `gitDiffU0` = `git diff -U0 HEAD -- '*.ts' '*.tsx' '*.js'` over the entire tree (task-record.ts:609); `--solution-from-diff` backfills from it (task-service.ts:1157) | multi-task trees attribute every uncommitted TS change to whichever task is being recorded (correct only in single-task worktrees — today's runall mode) |
| 11 | **S3** | pipeline-budgets direct invocation no-op | no `import.meta.main` bootstrap in pipeline-budgets.ts; only `scripts/spur-dev.ts check-pipeline-budgets` (:106) calls `run()` | operators running the obvious filename get silent success |
| 12 | **S3** | Composition baseline documentation rot | 6 inert fields per workflow + `proofInputs` (§C); 42 unadjudicated advisory findings | baseline reads as a contract but enforces only part of itself; ADR-069 steady-state invariant false |
| 13 | **S3** | Surface inventory stale + check scope narrow | 3 live mismatches (§D); manifest covers plugins/sp/scripts only (script-contract-check header :9) | help-captured SSOT no longer describes the CLI; scripts/commands + package.json surfaces have no mechanical placement check |
| 14 | **S3** | Dry-run validity is stage-local, not run-readiness | live probe: `workflow run task-pipeline.yaml --dry-run` executes real guard shells (precheck→implement→test→test-fix→test-recheck→failed, run a84c72a3) — absent stage evidence fails it | `--dry-run` validates schema + reachability only; it neither simulates dispatch nor proves guards would pass — treat it as a smoke check; pipeline readiness evidence comes from the pipeline itself |

## G. Script/capability ownership reconciliation (R6)

Four surfaces, current owners:

1. **Public CLI** (`apps/cli/src/commands/`): 12 nouns (`agent, builder, feature, help, history, message, projects, rule, self, task, team, workflow`). Consent ledger: 8 recorded consents in ADR-051 amendments (self, builder, task/feature `--fix`, workflow show, doctor flags, refresh `--all`, show `--format`/`--json`) — all verified present in live help via the surface inventory.
2. **scripts/commands** (spur-dev.ts modules): 26 modules, ADR-051 naming + test-sibling discipline; surfaced into spur-check via package.json chain (link-check, transition-shim-check, script-contract-check, corpus-check).
3. **package.json composition entrypoints**: `task-pipeline` / `tasks` / `features` (workflow runners), `corpus-check`, `regen-composition-baseline`, `transition-shim-check`, `script-contract-check`, `validate-commands`, `load-history`, `spur-check`/`spur-check-new` chains. Gap: `regen-corpus-baseline` has **no package.json entry** (invoked as `bun run scripts/commands/regen-corpus-baseline.ts` in gate output text).
4. **plugins/sp/scripts**: 17 baselined entries, twins fresh (gate PASS). Workflow YAML callers: task-pipeline → task-size-precheck.ts / task-evidence-precheck.ts / verify-answer-lint.ts / feature-sync-bounded.ts; history-anatomy → history-anatomy-cache **.mjs via node**; pr-review → pr-reviewing.**ts via bun** (`superskill script path sp pr-reviewing.ts`). Note: pr-review invokes the `.ts` while the twin contract ships `.mjs` — verify superskill stages the `.ts` (unverified; if it stages only twins, pr-review breaks on plugin-only machines). Mixed runtimes (bun vs node) across shipped workflows.

Ownership conflicts: none found — each surface has a single writer and a named gate, except the placement of `scripts/commands` vs `package.json` decisions, which has no mechanical check (defect 13).

## H. Workflow `version` contract trace (R7)

- **Schema**: `version: {"type":"string"}` (JSON Schema) / `z.string().optional()` (Zod) in both dialects — no minLength, empty string valid, omitted valid.
- **Probe (live)**: state-machine YAML with `kind` omitted and `version: ""` → `workflow valid` (exit 0).
- **Consumers**: zero. No `def.version` reader; not rendered in list/show/trace; not in the progress projection. Only side effect: inclusion in `computeDefinitionDigest`'s canonical whole-def JSON (composition-baseline.ts:110) — a version-only edit changes run digests with zero behavior change (visible solely as a `definition-drift` diagnostic in progress).
- **Recommended contract (F5)**: `absent` → `unversioned`; non-empty quoted literal → `explicit(<literal>)`, opaque, no registry, no mandatory requirement. **Evidence needed before any future major version mandates it**: a consumer branching on version, or a real drift incident where the digest diagnostic could not disambiguate. Neither exists today (defect 4 is a *resume* problem, not a version problem — fixing the digest comparison subsumes it).

## I. Prioritized decisions (from §F/§A)

1. Fix `command-gate.ts:157` key (`timeoutMs` → `timeout`) — one-line, restores every gate timeout.
2. Decide nested-review policy: either allow one level of nested `workflow run` (guarded) or replace feature-dev's integration-review gate with a non-spawning check; today it is dead weight that always FAILs.
3. Thread `spurConfig` through makeSvc so `agent.default` works from the CLI.
4. Enforce digest comparison at `continuePaused` (block or loudly confirm on drift) — closes the resume hole and subsumes the version question (§H).
5. Fail closed in `createGitAlternateTree` (no empty-tree digest).
6. Validate run-id (reject `/`, `..`, absolute) at CLI entry.
7. Re-baseline ADR-069 dispositions (42 findings) and let regen delete the inert fields, or write a checker for them.
8. Regenerate the corpus snapshot (272 entries today; the D8/E81 wave is unaccepted → gate fails those findings) and migrate it to ADR-093 waiver fields (owner/review-date/removal).
9. Refresh the surface inventory; add scripts/commands + package.json placement to a mechanical check; confirm superskill stages `.ts` entries for pr-review.
10. Update docs/03 §24 header ("not yet built" → built) and add the missing docs/04 §agent-capability-attestation section.
11. Budgets gate is live and RED at audit HEAD (docs-pipeline modelQueries 2 > 1): record it (done — §C/§D) and resolve the raise-vs-fix with 0730's measured costs rather than silently widening the ceiling.

## Unknowns (honest gaps)

- `superskill script path sp pr-reviewing.ts` staging behavior (§G-4) — needs one operator-machine run to confirm.
- ADR-060/087 sampled via task lifecycle + code comments, not re-executed end-to-end this pass.
- tasks 0611–0626 chains sampled by lifecycle only (per audit contract: defect claims focused on D8 workflow contract).
