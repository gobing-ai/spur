---
name: decision-points
description: "The lifecycle's catalog decision points: which workflow state asks which `spur decision` id, its fallback, the row it writes and the guard that reads it — plus the rules for consuming, diagnosing and adding one."
see_also:
  - spur-dev
  - execution-workflow
  - spur-cli
  - spur-composer
---

# Decision points

A **decision point** is a closed-vocabulary judgment the workflow asks through `spur decision`
instead of through an agent's prose. It names a catalog id, carries a deterministic fallback, and
writes a schemaVersion-1 row (`value`, `source: model|default`, `degraded`, `confidence`,
`confidenceLevel`, `reason`) that the next guard or projection reads. The verb catalog, maker
resolution and the authoring lifecycle live in `sp:spur-cli`
([decision.md](../../spur-cli/references/decision.md),
[decision/lifecycle.md](../../spur-cli/references/decision/lifecycle.md)); this file is the
lifecycle's map of where each one sits.

## Inventory

| Workflow · state | Decision id | Values (fallback) | Row | Consumer |
| --- | --- | --- | --- | --- |
| task-pipeline · `gate` | `task-triage` | low · standard · high (`standard`) | `.spur/run/<wbs>-triage.decision` | lane projection → `<wbs>-mode.txt` → review focus. Runs only after the deterministic floor (caller `mode`, sensitive path, > 400 lines) has not already pinned the lane |
| task-pipeline · `gate` | `failure-class` | fix · stop (`fix`) | `.spur/run/<wbs>-failure-class.decision` | red gate: `stop` → `failed`, `fix` → `remediate` (under the attempt cap) |
| task-pipeline · `review` | `review-failure-class` | fix · stop (`fix`) | `.spur/run/<wbs>-review-failure-class.decision` | non-PASS review: `stop` → `failed`, `fix` → `remediate` (same cap) |
| task-pipeline · `review` | `gate-evidence` (approval `hitl.confirm`) | yes · no · defer (`defer`) | `.spur/run/<wbs>-approval.status` (APPROVED · DENIED) | `done` requires APPROVED; DENIED → `failed` (`cancelled`) |
| idea-pipeline · discovery | `idea-recommendation` | proceed · reshape · drop · unknown (`unknown`) | `.spur/run/<runId>-idea-recommendation.decision` | rescue only: consulted when the awk parse says `unknown`; only a `source: model` answer is projected |
| idea-pipeline · discovery | `needs-design` | design · skip (`design`) | `.spur/run/<runId>-idea-needs-design.decision` | rescue only: used when the report's boolean is missing; anything but a model `skip` keeps `design` |
| idea-pipeline · `idea-eval`, `design-approval` | `gate-evidence` | yes · no · defer (`defer`) | `__hitlAnswer` → `<runId>-idea-eval-answer.txt` etc. | a deferred answer is a denial there |
| wrapup-pipeline · `branch-cleanup` | `gate-evidence` | yes · no · defer (`defer`) | `branchCleanupStatus` | consent record only; wrap-up performs no git operation |
| history-anatomy · validate | `anatomy-validation-verdict` | PASS · FAIL (`FAIL`) | shell `spur decision run` (not a `decide` row) | rescue for an unparseable validation verdict; a deterministic FAIL is never overturned |

`maker-liveness` is served only by `spur decision status --probe`. `spur decision list --json` is
the live inventory; when it and this table disagree, the CLI wins and this table is stale.

## Switches

- **`workflows.decideDecisionMaker`** (default off) gates every `decide` action. Off, the action
  makes no model call and writes the fallback row (`source: default`). The pipeline still routes:
  a red gate is `fix` and goes to the bounded repair, the lane is `standard`.
- **`workflows.hitlDecisionMaker`** (default off) gates the evidence-mode HITL gates. Off,
  interactive gates ask the operator; under `profile=auto` the gate's answer is deferred, which
  task-pipeline treats as no objection and idea-pipeline treats as a denial.
- **`spur decision run` ignores both switches.** A workflow that shells out to it calls a model
  even with the switches off. That is why the typed `decide` action is the preferred form.

## Rules for the lifecycle

1. **Read the row; never re-judge it.** When a run reports `failed`, `remediate` or a lane, the
   reason is the recorded `.decision` row or the approval token. Quote its `value`, `source` and
   `reason`. Do not overrule a `stop` by hand-driving `remediate`, and do not treat a `source:
   default` row as a model verdict.
2. **A fallback row is a real outcome.** `source: default` (switch off, `no-backend`, low
   confidence, invalid answer) is what the run acted on. Report it as degraded, not as an error.
3. **Outside a pipeline, ask the catalog.** For a question a catalog id already owns (is this
   red gate fixable? which lane does this diff need?), run `spur decision show <id>` and then
   `spur decision run <id> --param … --evidence … --json` instead of improvising an answer. Never
   let a `spur decision run` answer substitute for a gate the workflow owns.
4. **Recurring judgment → a decision point, not prose.** A judgment that has a closed set of
   answers and a safe default, recurs across runs, and currently lives in an agent prompt or a
   `case` over free text belongs in a catalog entry plus a `decide` step. Author it through the
   decision lifecycle (decision/lifecycle.md) and `sp:spur-composer`. A new shared catalog id
   needs recorded operator consent (composition ladder §7) and `build:bundle`.
5. **Keep deterministic floors first.** A decision point rescues or refines a deterministic
   check; it never replaces one. task-triage runs after the sensitive-path/size floor, and the
   idea-pipeline decides run after the parse they rescue.

## Reporting a run

After a task-pipeline run settles, `/sp:dev-run`, `/sp:dev-runall` and `sp:super-planner` report
its decision points under the execution summary, one line per row, plus the approval token:

```bash
for f in .spur/run/<wbs>-{triage,failure-class,review-failure-class}.decision; do
  [ -f "$f" ] && jq -r --arg f "${f##*/}" '"\($f): \(.value) — \(.source // (if .degraded then "default" else "model" end)) \(.backend // "-") \(.reason)"' "$f"
done
printf 'approval: %s\n' "$(cat .spur/run/<wbs>-approval.status 2>/dev/null || echo none)"
```

Rows outlive their run: a row's presence does not prove this run reached that state (the run's
trace does). Rows written before `source` existed carry only `degraded`; the fallback above reads it.

## Diagnosis

| Question | Evidence |
| --- | --- |
| Why did this run take that route? | The row file in the table above; `spur workflow trace <run-id> --json` |
| Is a maker serving at all? | `spur decision status --probe` |
| How reliable is a decision in practice? | `spur decision status --reliability [--since <date>] --json` — per decision × maker: samples, acceptedRate, fallbacks by reason, median confidence, p50/p95 latency |
| Which runs asked it? | Board → Decisions tab (`decision_logs`) |
| Is the catalog healthy? | `spur decision status --json` → `loadErrors`, `makers[]` |

A decision whose rows are almost all `source: default` while its switch is on has a maker
problem, not a workflow problem. Hand it to `sp:spur-doctor`, which owns the proposal.
