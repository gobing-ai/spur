# Essential workflow checks and observable execution

**Feature:** D61 · **Status:** accepted design, not implemented · **Decision:** ADR-108.
Operator approval covers the [discovery proposal and Design Summary](../plans/2026-09-04-workflow-upgrade-brainstorm.md).
These contracts elaborate that approved design. They do not authorize skipping current gates before
the replacement implementation lands.

## Completion integrity

Keep `TaskCheckService`, `FeatureCheckService`, planning write services, the lifecycle adapter and
done-transition guard as the owners. Change shared policy instead of adding per-caller guards.
Target-state checks (`--as testing/done`) remain distinct from current-state checks. Task
`--strict-core` remains a compatibility alias; explicit `--strict` remains an opt-in diagnostic.

| Finding class | Routine / completion treatment |
| --- | --- |
| Invalid identity, frontmatter, required reference, ambiguous lookup or illegal lifecycle | Fail at the affected boundary |
| Missing task/AC contract required by the consuming stage | Fail; malformed unparseable AC is not a style warning |
| Unfinished linked work, missing/unverified required scenarios, stale/non-PASS proof | Diagnose pending work before implementation; fail completion |
| Heading order, prose length, checkbox presentation, lexical/line-anchor resemblance | Advisory where actual consumer semantics remain intact |
| Missing required evidence artifact or explicit contradiction of completion | Fail completion independently of stylistic presentation |

Use actual consumer requirements, not L3/L4 prefixes, to classify findings. Codify the selected
finding-code behavior in existing check tests. No new policy DSL or blanket `off` overrides.
Feature done callers drop `--strict` only when normal `--as done` proves incomplete/unverified
features cannot pass. Task verdict recomputation, provenance and proof guards remain mandatory.
Essential errors cannot be hidden by old baseline readers or default completion severity overrides.

Run each logical read/check once; sibling guards inspect that result. Relevant writes invalidate
it. No persistent validation cache: cheap checks rerun at later write/transition boundaries.
Never certify post-record completion using a pre-record task check.

## Corpus-check contract

0775 retired `bun run corpus-check`, `task check --corpus --json`, and the accepted-debt snapshot;
corpus checks live on as the per-task gate plus the unit-tested corpus-gate behavior inside
`spur-check` (`packages/app/tests/services/corpus-check.test.ts`). The retired scope — active task
folder sweep, feature checks, cross-folder identity/reference resolution, `--since` fog comparison —
is not reinstated; archived prose scanning stays unexpanded. Failed required integrity checks
cannot produce a clean result. Fog prose heuristics are advisory unless a concrete broken required
reference is established.

- Exit 0: no essential error; warnings may exist.
- Exit 1: essential integrity error or failed required check; preserve CLI usage-error behavior.
- No suppression: all findings remain visible; no accept-all regeneration.
- Remove routine iteration, batch wrap and ordinary corpus-touch commit sweep callers.
- Existing `spur-check-new` compositions may remain explicit audit entrypoints; routine defaults
  must not select them. This is a deliberate audit, not a renamed hidden sweep.
- Constitution T10 keeps one audit for checker-policy changes; T11 becomes affected-input ordinary
  commit validation. Newly introduced essential failures must be reconciled without accepting debt.

Keep the current JSON field structure during migration: `observed` counts all findings, `baselined`
and per-severity baselined counts become zero, `newErrors`/`newWarnings` contain all unsuppressed
findings, `newCount` contains corresponding counts, and `duplicateKeys` is empty. `ok` depends on
essential errors, not warnings. Document these legacy names as compatibility fields. Human output
describes errors/warnings rather than accepted debt. Full JSON remains available; agents capture
large diagnostics once and display counts plus the artifact path.

Remove `loadAcceptedFindings` from CLI task checks, the fallback done gate and application exports,
then remove unused accepted-map filtering. Removing the sweep alone would otherwise leave individual
checks suppressed. Delete the corpus snapshot, regenerator and regeneration-only script contracts
after classifying the 299 keys and repairing real affected integrity defects through Spur CLI.
No historical document-formatting campaign and no permanent exception framework.

Ready-depth decision: delete the regenerator directly after consumer migration. No surviving waiver
requires a transitional pruning/expiry/acceptance tool; do not build one. Required evidence failures
must be repaired or truthfully reported, never accepted into another snapshot.

## Composition snapshot retirement

Derive inventory, action facts and static model-bearing states from loaded definitions. Keep
measured budgets as policy and focused behavior tests as the regression contract. Static state
counts do not claim to measure model invocations on branched/retried runs.

Migrate `pipeline-budgets`, `eval-pipeline`, `real-run-cost`, composition advisory and proof-chain
tests before deleting the snapshot, equality checker/tests and regeneration entrypoint. Inventory
covers all eleven definitions. Preserve canonical serialization and `computeDefinitionDigest`
behavior/imports; moving that helper is not permission to change the digest algorithm.

Zero current dispositions means no replacement advisory waiver ledger is needed. Advisories remain
non-blocking. Keep `packages/app/tests/fixtures/json-raw-baseline.json`, a response compatibility
fixture. Rebuild the CLI bundle and assert retired baseline assets do not survive generated copies.

## Planning and version identity

Reuse `resolveWorkflowDefinition` for show as well as run/validate/continue. Plan generation does
not execute guards, actions, executor probes or mutate run records. List exposes consistent identity;
invalid version data must not be mislabeled as valid unversioned input.

Both dialects retain the optional non-empty opaque version string. Each upgraded canonical workflow
sets quoted `version: "1"`; later behavior revisions change the tag by convention. Unknown literals
are accepted verbatim. Missing means unversioned. The digest, not the tag, protects resume/proof.

Preserve existing show JSON fields and add `version` (literal or null), `definitionDigest` and step
descriptions. Run/list/trace report the same identity through their existing result/metadata owners.
Store workflow version at run start. Older records with unrecoverable original identity remain
unknown, rather than borrowing a changed current definition. Distinguish workflow version from
steering counters and envelope schema versions. No new noun, planner verb, registry or dependency.

| Surface | Plan | Progress |
| --- | --- | --- |
| Inline host | CLI declared-step projection; native todo or Markdown fallback | Active actions and stage-boundary reconciliation |
| Foreground CLI | Same declared inventory with branch/loop markers | Existing step reporter and bounded summaries |
| Async | Definition-derived plan artifact identified with run ID before actions | Existing trace/follow; reference artifact through run metadata |
| Resume | Persisted identity/progress; reject digest drift | Recorded state visits and retry attempts |

Replace arrow-joined inventories that imply an inevitable linear path. Plans do not predict runtime
guards; pending/failed/cancelled are not completed, and unvisited branches are not falsely marked
done. JSON emits no human-plan prose; quiet/silent/no-plan retain existing meaning. Preserve full
redacted logs in existing artifacts, avoiding automatic full YAML/success-log echoing to the model.

## Packages and acceptance mapping

The discovery proposal's eleven-row matrix defines the workflow-specific refinements. Each row is
assigned once below. Every package includes focused positive/negative checks and same-change docs.

| Package | AC | Owned outcome | Dependencies |
| --- | --- | --- | --- |
| P1 | R1 | Shared essential finding policy; normal/alias parity; false completion denied without stylistic blockers | None |
| P2 | R2, R3, R4 corpus | Explicit audit without suppressions; retire automatic callers; reconcile T10/T11 and check guidance | P1 |
| P3 | R4 composition | Live-definition inventory/budget/eval/advisory migration; preserve digest/JSON fixture; verify combined retirement after corpus migration | P2 |
| P4 | R5, R6 | Side-effect-free shared plan/version identity and host fallback; cross-surface progress/metadata tests | P1 |
| P5 | R7, R11 subset | idea-pipeline, docs-pipeline, wayfinder-resolution: repeated-check removal, evidence and batch-schema parity | P2, P3, P4 |
| P6 | R8, R11 subset | task-lifecycle, feature-lifecycle, feature-dev, wrapup-pipeline: single-edge transitions, honest review/sync outcomes | P2, P3, P4 |
| P7 | R9, R11 subset | basic, history-anatomy, pr-review: command execution, evidence/cache safety, head-pinned pending review | P3, P4 |
| P8 | R10, R11 whole, R12 | task-pipeline last; unchanged proof floor; bundle/skills/templates parity and comparable savings evidence | P5, P6, P7 |

Task 0723 is done and its doctor-free, count-only precheck is present in the current source. P8
consumes that implementation; it has no unfinished 0723 prerequisite. D9 fast routes remain dormant without the existing ≥5 real terminal runs
and ≥80% mapped run coverage per workflow. No manufacturing runs to bypass that decision.

**Implemented (task 0772, 2026-09-06):** all eleven canonical definitions carry `version: "1"`,
canonical and bundled copies are byte-identical, and no retired corpus/composition asset remains
in generated output. The task-pipeline quality gate emits a bounded summary (green: status,
attempts, log path, bytes; red: last 40 lines plus path) with the full log preserved on disk.
Rollout evidence: `docs/plans/2026-09-04-d61-rollout-evidence.md`.

Use the actual batch schema's Design/Plan/AC fields, retain exact feature scenario titles, and apply
dependency ordering through CLI writes. Current YAML prose incorrectly excludes these schema fields;
P5 repairs that prose. The running YAML is not hot-edited. Task batch creation is planning only.

Measure invocation counts, elapsed time and output volume on matched before/after inputs; token and
cost values stay unknown unless measured. Run focused tests inside each workspace, then applicable
lint/type/rule/test gates for final inputs. Lifecycle definitions need transition-request tests, not
automatic walks; dry runs are not real verified outcomes. Use mocked PR publishing. All tasks require
their own real verification PASS during execution. Final bundle checks prove all eleven tags and
absence of retired generated assets. No release, merge or external deployment is part of D61.

## Authority migration

ADR-108 records the approved direction. P1/P2 reconcile applicable ADR-050/062/090/092/093 and
constitution T10/T11 before changing enforced behavior. P3 supersedes only exact composition mirroring
from ADR-069, preserving ownership and advisory rules. Update source skills/templates through their
canonical owners; Superskill remains the adapter installation path. Historical D6/0723 evidence is
not rewritten as though it used the new mechanism; amend live conflicting contracts through CLI/docs.

## Implementation-ready refinements

The [D61 handoff](../plans/2026-09-04-d61-implementation-ready.md) indexes the eight refined task
contracts. Their Design sections freeze code dispositions, file ownership, test intent and handoffs.

- Feature checks apply `asStatus` across matrix and status-dependent rules, matching task checks;
  normal completion explicitly blocks required evidence findings without elevating all warnings.
- New run metadata stores `workflowVersion` as a literal or null. Public `version` is absent for a
  legacy unknown run and null for a known unversioned definition. Async startup records
  `.spur/run/<runId>-workflow-plan.json` in `planArtifactPath` before actions; worker digest drift fails.
- `basic` keeps its existing valid `bun run check` default and fixes trusted compound-command
  execution. `### Testing` is a valid task heading; wayfinder removes length/scraping proxies.
- Docs and wayfinder derive current measured verdicts before final `task record`, compare proof
  before recording, and retain canonical fingerprint normalization of derived evidence sections.
- Strict integration review requires one collected current-HEAD `CLEAN`; requested/pending/findings
  cannot satisfy it. Advisory review preserves its actual outcome. Wrapup adds truthful failure
  routing and does not claim its consent-only branch-cleanup step performed git operations.
- Capture comparable measurements before each owned definition changes. Preserve history report
  comparison data and its consumed parser contract; they are unrelated to acceptance snapshots.
