---
title: Spur codebase review and simplification assessment
status: advisory
created_at: 2026-11-05
updated_at: 2026-11-05
baseline_commit: 3a1f675f1c1834b6236e980dfae71b01712a321c
related:
  - docs/plans/2026-11-05-simplification-and-product-enhancement.md
  - docs/reports/2026-11-05-codebase-review-inventory.json
tags: [audit, cli, web]
---

# Spur codebase review and simplification assessment

## 1. Recommendation

Keep the current architecture and concentrate on making its capabilities work together. The highest
return is a smaller, more dependable daily loop: configure a project, choose ready work, execute it,
understand a failure, recover, and inspect verified results. More commands or another execution engine
would increase the problem before resolving it.

Run simplification and product improvement in the same work packages. For example, consolidating corpus
reads should also expose incomplete-project diagnostics; consolidating Board query state should also
make navigation and live updates dependable. Avoid a separate refactoring program whose benefit is
measured only in deleted lines.

The [implementation proposal](../plans/2026-11-05-simplification-and-product-enhancement.md) contains
ordered packages, concrete solutions, alternatives, preservation requirements, acceptance checks,
estimates, and existing feature owners. It is a proposal, not an approved scope or delivery commitment.

## 2. Scope, method, and limitations

Baseline: clean working tree at `3a1f675f1c`, Bun 1.4.3. Scope: tracked files under `apps`, `packages`,
`plugins/sp`, `scripts`, and relevant rules/workflows and documentation. This is a repository-wide
inventory plus a risk-based source review of representative boundaries and large modules. It is not
a line-by-line inspection of every file, a penetration test, or certification of every installed agent.

Applied the path-review and architecture-survey methods: check correctness/security/efficiency/usability,
trace callers and contracts, distinguish defects from structural candidates, and require evidence for
recommendations. No task/feature records were modified, and no new feature roots were created.

Inspected the CLI registration/config/init boundaries, planning read/write services and lifecycle
consumers, workflow dispatch surfaces, history rollups/marts and service ownership, Board query/SSE
paths, server middleware and raw/typed API seams, database browsing, Worker composition, desktop
ownership conventions, plugin safety classification, manifests, and test discovery/gate infrastructure.

Reproductions use fixtures and injected failures. They do not modify real task files or real history.
Session probe code/logs are under `.spur/run/2026-11-05-review/`; that scratch is disposable. Durable
observations, procedures, and inventory are recorded here and in the linked proposal.

## 3. What grew

The [inventory JSON](2026-11-05-codebase-review-inventory.json) records exact commits, categories,
workspace counts, and largest files. It counts physical lines in tracked blobs. Implementation includes
application/package source, plugin runtime glue, and developer command code; tests are separate.
Fixtures, documentation/corpus, vendored code, generated distribution bundles, and lockfiles are excluded.
Comments, source-embedded SQL, and source test-support modules remain in implementation counts.

| Snapshot | Implementation files | Implementation lines | Test/support files | Test/support lines |
| --- | ---: | ---: | ---: | ---: |
| 2026-09-05 | 423 | 115,253 | 422 | 143,204 |
| 2026-10-05 | 570 | 171,565 | 614 | 216,823 |
| HEAD, last commit 2026-11-04 | 725 | 188,960 | 831 | 249,475 |

Implementation grew approximately 64% and test/support lines approximately 74% from September 5.
These numbers establish growth, not a capability/productivity ratio. No comparable user-outcome
baseline exists in this review. Recent commits also contain real additions; growth is not itself proof
of waste. October bytes decrease by HEAD despite increasing lines, so file size alone is misleading too.

Examples worth investigating, rather than imposing an arbitrary file-length rule:

| File | Physical lines at baseline | Responsibility to examine |
| --- | ---: | --- |
| `packages/app/src/workflow/actions/agent-run.ts` | 2,293 | Host, fleet, subprocess, admission, contracts, budgets, independence, partial work |
| `packages/app/src/services/task-check.ts` | 2,000 | Planning validation and evidence policy |
| `packages/app/src/services/history-service.ts` | 1,961 | History operations and orchestration |
| `packages/app/src/services/history-board-service.ts` | 1,874 | Read-path selection and DTO assembly |
| `packages/domain/src/analytics/history-board-rollup.ts` | 2,446 | Materialized analytics and query semantics |
| `packages/app/src/services/event-names.ts` | 2,076 | Event catalog, safe projection and presentation |
| `scripts/commands/fleet-e2e.ts` | 4,044 | Test orchestration, process ownership, proof collection |

Do not count deleting task history, ADRs, test assertions, or documentation as implementation savings.
Do not split these files solely to reduce their individual line counts.

## 4. Findings by priority

P1 means address before broader capability expansion; P2 means a concrete reliability/usability defect;
P3 means a bounded quality gap. No P0 exploit or data-loss incident was established.

### R1 — P1: planning reads silently omit unreadable input

Evidence: `packages/app/src/services/task-query-ops.ts:118` catches both read and parse failures at
line 144; `packages/app/src/services/feature-service.ts:892` similarly suppresses folder/file failures
while collecting the inputs used by feature sync. The existing `TaskLocator` already distinguishes
missing directories from other failures (`packages/app/src/services/task-locator.ts:42`).

Reproduced with two tasks linked to F1: readable task 0001 is done, unreadable task 0002 is todo.
Injecting EACCES into the second read makes both `TaskService.list()` and `collectTasksByFeature()`
return only 0001 without a warning. This proves incomplete inputs are presented as complete; it does
not prove that the independent done gates can be bypassed. Feature-state derivation and Board counts
nevertheless become misleading.

Solution: distinguish ENOENT from permission/I/O/parse failures, expose read diagnostics, and refuse
lifecycle derivation from an incomplete snapshot. A tolerant display can show valid rows with an
explicit incomplete indicator. Do not change shared read/write contracts in a quick patch.

### R2 — P1: real-renderer Markdown security regressions are orphaned

Evidence: `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:2` says a wrapper runs it
in isolation; lines 10–12 deliberately avoid normal test discovery. The named wrapper does not exist.
The only external code reference is a comment in `apps/web/tests/lib/markdown-safety.test.ts:10`.
The package/root scripts contain no explicit invocation of this file.

Explicit execution passed: 12 tests, 1,203 assertions, including real editor/read previews and Mermaid.
The defect is missing routine execution, not a demonstrated sanitizer bypass. Helper-level tests still run.

Solution: restore one discoverable wrapper using the existing member-terminal isolated-process pattern.
Require nonzero expected case/assertion counts and child success, so a child collecting zero tests
cannot pass. Retain real-renderer isolation; changing sanitizer production logic is unnecessary.

### R3 — P2: Board feature sync defaults to an unsupported direction

Evidence at baseline: `apps/web/src/modules/features/FeatureDetail.tsx:95` initializes `push`, and
line 871 offers it as a normal option. `apps/server/src/modules/feature/handlers.ts:131` explicitly
rejects push with 501. The CLI sync implementation derives feature state from tasks; it is not a
working push alternative. The server's diagnostic suggesting the CLI is therefore imprecise too.

Solution: default to pull and visibly disable the unavailable push option. Keep the HTTP enum and
server refusal for compatibility. Verify the rendered dialog dispatches pull and reports success.
This is a bounded direct-fix candidate; implementation/evidence are recorded in §7.

### R4 — P2: old task requests overwrite a newer folder selection

Evidence: `apps/web/src/modules/task-kanban/useTasks.ts:86` changes the list source, but the async
refresh at line 113 has no generation check or cancellation before committing its result at line 119.

Reproduced by starting request A, changing the list function, completing B, then completing A.
The store first contains B's new-folder tasks, then changes back to A's old-folder tasks. Polling and
SSE can create overlapping requests too. This is a visible stale-data defect, not just redundant work.

Solution: add request-generation ownership at the existing store boundary first; use the feature
detail's load-token pattern (`apps/web/src/modules/features/FeatureDetail.tsx:133`) as local precedent.
Cover stale success, stale error, source switch, and final unsubscription. A query-library migration
can follow; the correctness fix should not depend on adopting a new dependency.

### R5 — P2: exact search can silently return no hits after output overflow

Evidence: `packages/app/src/services/search.ts:59` buffers up to 2 MiB; the process-result mapping
drops execution outcomes other than timeout. `runExact` at line 223 uses per-file `--max-count`,
collects all process output, and silently ignores incomplete JSON at line 252 before applying the
global hit limit. The installed process executor maps maxOutput to execa maxBuffer.

Reproduced using two `.ts` files, each with a physical line containing `needle` and three million
other characters. Exact search with limit 1 returned success with zero hits although both files match.
This is a correctness problem on generated/minified sources, as well as unnecessary work on many files.

Solution: preserve timeout/output-limit/error outcomes; never convert incomplete output into an empty
successful result. Consume complete bounded events incrementally and stop after the global limit,
or fail explicitly at the cap as the initial correctness fix. Do not merely increase the buffer.

### R6 — P2: feature action “Skip dependencies” control is inert

Evidence: `apps/web/src/modules/features/FeatureDetail.tsx:899` renders a controlled checkbox with
`checked={false}` and an empty onChange. Dispatch at line 424 sends only id/action/channel even though
the feature handler accepts skipDeps. The displayed option cannot affect the action.

Solution: choose whether this option belongs on this surface. If retained, use controlled state, reset
it between actions, and forward the value through the existing contract. The safe default remains false.
Verify both values and inspect runner semantics before promising that queue metadata bypasses anything.
This is separate from the sync-default fix.

### R7 — P2: safety classification blocks literal text in read-only searches

Evidence: `plugins/sp/lib/destructive-policy.ts:190` scans the entire command string. During this
review, searches containing destructive-command vocabulary in quoted patterns were rejected. A direct
classifier probe confirms a ripgrep search for a literal removal command is classified as removal.

Solution: classify executable command positions and arguments with quote-aware lexical handling;
retain inspection of shell substitutions and nested interpreters. Add false-positive and destructive
positive-control cases first. Do not whitelist every rg invocation or disable the guard: substitutions
inside arguments can still execute. This needs a safety-focused design/test pass, not regex tweaking
under time pressure. The review continued with narrower search patterns and kept the guard enabled.

### R8 — P3: coverage diagnostics parse only one TOML spelling

Evidence: `packages/app/src/services/quality-gate.ts:172` uses a regex for an inline coverageThreshold
table; the standard TOML table spelling returns null. A local probe confirmed Bun.TOML.parse reads
the equivalent thresholds correctly. `scripts/commands/run-tests.ts:228` already uses the native parser.

Impact: the extra coverage-shortfall diagnostic scan disappears for valid alternative TOML. Bun's own
coverage enforcement remains in force; this is not evidence that the gate can pass a coverage failure.

Solution: reuse Bun.TOML.parse and validate the small resulting threshold object, preserving the
documented missing-setting behavior. No TOML dependency is needed.

### R9 — P3: registry advertises a registration operation that does nothing

Evidence: `apps/web/src/modules/registry.ts:28` promises runtime root registration and immediate
rescanning; line 73 implements a no-op. `apps/web/tests/modules/registry.test.ts` explicitly tests
that no-op. Project contribution composition exists elsewhere, so implementing another loader here
would duplicate it.

Solution: trace consumers and route them to existing contribution composition. Deprecate/remove the
unused internal operation when compatibility permits, or document unsupported behavior explicitly.
Do not expand an extension framework to satisfy a speculative stub.

### R10 — P2: skipped fuzzy search becomes an empty successful group in auto mode

Evidence: `packages/app/src/services/search.ts:189` coalesces `fuzzy.hits` from null to an empty
array before returning it. A failed fuzzy route is consequently represented differently in auto mode
than in fuzzy-only mode and in the early unavailable-backend branch. Consumers can display a
zero-match group for a route listed as skipped.

The full gate exposed the existing assertion in `apps/cli/tests/commands/self/search.test.ts:230`:
expected null, received an empty array. Running that unchanged file independently reproduced the
failure (18 pass, 1 fail). An injected unknown status format followed by a failed zg query reproduces
the same result without depending on host tool availability: fuzzy is empty while skipped says zg-failed.

Solution: preserve the null outcome in the response; use an empty array only locally when iterating
over overlap candidates. Add deterministic cases for absent, unknown-status, failed and successfully
empty fuzzy backends. Keep the existing assertion; weakening it would hide the contract disagreement.
The real-tool receipt also reports unknown index readiness and zg-failed; the test expects only a
missing index or missing executable. Investigate the installed-backend probe/error compatibility too,
rather than assuming the null correction alone makes the whole test pass. This predates the
Board-only production change and belongs with A34/W2.

## 5. Structural candidates

These are design recommendations, not correctness findings proven just by file size.

| ID / strength | Evidence and current shape | Proposed change and deletion test | User benefit |
| --- | --- | --- | --- |
| C1 / strong | `agent-run.ts:1` imports policies for host/fleet/subprocess; service methods implement different surfaces in one large action | Build one admission/contract/finalization path around existing surface execution methods. Preserve capabilities, independence, budgets, redaction, resume and freshness. Delete duplicated policy blocks; adding files without removing branches does not qualify. | Same failure explanations and recovery across execution surfaces |
| C2 / strong | `task-query-ops.ts:112`, `feature-service.ts:892`, and `feature-check.ts:271` separately walk/parse the corpus | One operation-scoped parsed snapshot with diagnostics and task/feature indexes, using TaskLocator and existing parsers. No persistent shadow store. Delete repeated scans while retaining Markdown authority. | Fast trustworthy readiness, blockers and feature summaries |
| C3 / strong | `feature-client.ts:33` through its mutation helpers hand-roll fetch/JSON errors despite existing contracts; `TraceTab.tsx:10` mirrors wire types and parsers | Migrate bounded procedure groups to existing oRPC contracts; add missing DTOs incrementally. Delete manual envelopes/guards only when runtime validation replaces them. | Consistent errors, cancellation and fewer broken Board actions |
| C4 / strong | `useTasks.ts:56` maintains SSE and polling; `FeaturesShell.tsx:103` opens another planning stream/refetch path; seven EventSource constructions exist | Share a planning subscription and explicit invalidation; coalesce bursts and suppress stale results. Evaluate a small TanStack Query pilot after the correctness fix. Keep process-output streams separate from planning events. | Reliable live updates with fewer background requests |
| C5 / moderate | `history-board-service.ts:1`, `history-board-rollup.ts:295`, `history-board-marts.ts:1` own real freshness/filter semantics | Reuse common selector and measure definitions only where proven identical. Preserve mart/rollup/raw fallbacks and golden query outputs. Extract a generic engine only after a second real consumer. | Explainable cost/outcome analytics without multiplying SQL definitions |
| C6 / moderate | `migrations.ts:20` explains mirrored upstream DDL; source is 2,087 lines | Resolve upstream ownership and generated embedded SQL at build time, preserving every historical migration identifier/checksum and offline binary behavior. Never squash released migrations to save lines. | Fewer install/upgrade failures |
| C7 / strong | Orphan renderer tests, global mock isolation (`member-terminal-identity.test.ts:9`), and 249k test/support lines | Restore behavioral discovery first; replace brittle source-text assertions only when stronger behavior proofs already cover their contract. Preserve useful boundary/source checks and coverage floors. | More credible gates with less maintenance |

Counterexamples matter: the shared TaskLocator, config-loader boundary, TaskService/WorkflowAppService
facades, existing run-store APIs, materialized history read paths, and released engine packages are
useful foundations. Do not remove them merely because they add indirection. Likewise, per-event
allowlists and presentation fields can be deliberate privacy controls, not accidental duplication.

## 6. Product gaps with the best return

1. **Cross-stack onboarding.** Init already seeds Bun and Make bindings (`apps/cli/src/commands/init.ts:65`),
   and `builder.actions` already makes execution stack-neutral (`packages/app/src/services/sdlc-actions.ts:1`).
   Extend discovery/proposals for the actual package managers/languages Robin uses; do not rebuild SDLC actions.
2. **Readiness as a daily view.** Bring together existing task dependencies, checks, executor readiness,
   project ownership, and paused work. A clear next action and its blockers are more useful than another dashboard.
3. **Recovery from existing run inspection.** TraceTab and `/api/runs` already expose runs and records.
   Improve links from failures to evidence, the exact safe recovery command, and receipt validity. A new run store
   or inspector noun would duplicate existing capability.
4. **Useful outcomes from existing history.** Distinguish verified completed work, failed/reworked attempts,
   measured cost and unknown attribution. Show savings and regression trends with drill-through evidence;
   avoid treating token counts or raw task completion counts as productivity.

## 7. Verification and triage

Baseline checks completed successfully: `bun run lint` (Biome and all configured typechecks),
dependency-drift-check, script-contract-check, transition-shim-check, workflow-promotion-check.
Explicit Markdown renderer proof: 12 pass, zero fail, 1,203 assertions.

Session fixtures reproduced R1, R4, R5, R7, R8 and R10. R3/R6/R9 are direct source-and-caller findings.
The report deliberately separates those evidence types. Long-running performance, all agent platforms,
packaged desktop behavior, and real-history throughput were not benchmarked here.

Triage: R3 is the direct-fix candidate. R1/R2/R4–R7/R10 are proposed implementation work; R8/R9 are
small follow-ups after their callers/contracts are checked. C1–C7 are bounded architecture candidates.
No task is represented as filed or ready, and no pipeline verify PASS is claimed.

Direct fix completed for R3: default pull plus an unavailable disabled push option. The rendered
interaction regression was written first and failed with expected pull / received push. After the
fix, the focused Board/client/action run passed 43 tests and 122 assertions; focused server feature
handlers/guards passed 25 tests and 65 assertions. The HTTP push refusal remains covered by existing
server tests. The owning feature-sync contract was synchronized. This was review triage, so the diff
is left for review without a task/pipeline completion claim or a commit.

The new test also exposed a fetch-mock typing mismatch during the first final-gate attempt; its
test seam now uses the same fetch typing as neighboring tests. The next gate attempt passed lint,
all configured typechecks and all 51 pre-check rules, then reproduced R10 in the ordinary suite.
The ordinary suite completed with 11,836 passing tests and one failure across 789 files (45,337
assertions, 196.71 seconds). That failure is R10. `spur-check` therefore exited 1; post-check rules
were not reached. This is a failed gate, not a passing review certificate.

| Check | Result |
| --- | --- |
| New rendered sync regression, before production edit | FAIL as intended: expected pull, received push |
| Board sync + feature action/client tests after fix | PASS: 43 tests, 122 assertions |
| Server feature handlers and transition guards | PASS: 25 tests, 65 assertions |
| Explicit real-renderer Markdown proof | PASS: 12 tests, 1,203 assertions; routine discovery still needs R2 |
| Final lint and configured typechecks, through spur-check | PASS |
| Pre-check constraint rules | PASS: 51 rules |
| Ordinary suite through spur-check | FAIL: 11,836 pass, 1 existing search failure (R10) |
| Independent unchanged CLI search suite | FAIL: 18 pass, 1 fail; confirms R10 independently |
| Workers smoke (`bun run test-cf`) | PASS: one test |
| Web production build | PASS |
| Dependency drift, script contract, transition shim, workflow promotion, linked-package freshness | PASS |
| `git diff --check`, new document links, inventory arithmetic | PASS |

Repeat the changed interaction and its client tests from `apps/web`:

```sh
bun test tests/modules/features/feature-sync.test.ts tests/modules/features/feature-actions.test.ts tests/lib/feature-client.test.ts
```

Run the normally orphaned proof explicitly from `apps/web`:

```sh
bun test --isolate ./tests/modules/task-kanban/markdown-safety-pipeline.tsx
```

Reproduce the existing search-suite failure from `apps/cli`:

```sh
bun test tests/commands/self/search.test.ts
```

Session logs/JUnit receipts are in `.spur/run/2026-11-05-review/`. Scratch is disposable; the
committed test source, reproduction descriptions and historical inventory make the review repeatable.
The Board test uses a rendered DOM and mocked HTTP, with the real server guards tested separately;
no manual browser journey or claim of a real-agent E2E pass is made. Heavy process/browser proofs,
packaged desktop/full release build, and real-history performance checks were not run. No dependency
was added, no public CLI surface changed, and no production data or external service was mutated.
