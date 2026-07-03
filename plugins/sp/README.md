# Spur Dev Plugin (`sp`)

The spec-pipeline plugin for Spur's planning→execution lifecycle. It wraps the `spur` CLI (task,
feature, rule, workflow, agent) with a thin orchestration spine (`sp:spur-dev`) that dispatches
deep competency skills for each unit of work, plus scenario-specific slash commands that give each
lifecycle step a deterministic entry point.

Read this file first for the map; read [skills/spur-dev/SKILL.md](skills/spur-dev/SKILL.md) for the
spine itself, and [skills/spur-dev/references/glossary.md](skills/spur-dev/references/glossary.md)
for sp's own vocabulary (spine, competency, facade, corpus, gate, verdict, half, HITL, WBS, ...).

## The main flow

One feature, start to finish — see the Command index below for exact command names:

```
idea/plan  vague description → feature + AC + decomposed task batch
     ↓
run        <wbs>  → pipeline: precheck → implement → test → review → approve(HITL) → verify → record → done
     ↓
verify     <wbs>  → traceability + AC verdict (PASS clears the gate; this also runs inside the run step)
     ↓
wrap       <wbs>  → learnings, metrics, doc-sync, feature transition, branch cleanup
```

The idea entry and the plan entry both land at a validated, decomposed feature — the former adds a
grilling discovery interview first; the latter starts from an already-written description. Pick one,
not both. The verify entry is independently invocable (its `--force` flag re-audits an already-`done`
task), but the full pipeline already runs the same verification as one of its stages.

## On-ramps

Entry points that feed the main flow above, or run independently of it — see the index for names:

- The **rule-authoring scan** mines recent history for a recurring anti-pattern worth codifying as a
  constraint rule, before it costs another review cycle.
- The **dogfood driver** exercises any skill/command/CLI surface end-to-end with bounded auto-fix and
  self-monitoring; use it to validate a change to this plugin itself.
- The **fix-everything sweep** cleans lint/type/test errors across the working tree, independent of
  any single task.
- Two small git helpers generate a conventional commit message from staged changes, and a changelog
  from git history.
- The **project bootstrapper** scaffolds a brand-new Spur project (config + docs), then tailors it
  to the target stack.

## Batch and parallel paths

The main flow is one task/feature at a time. Two entries widen the aperture (see the index for exact
names): a **batch pipeline runner** drives a whole set of tasks through their pipelines in
dependency-correct order — resolve the set, topologically sort, run each one, emit a single batch
report, sequential by default — and a **parallel fan-out** spreads independent tasks or
investigations across subagents when explicitly requested and the independence checks (dependency,
file-overlap, token-budget) clear, falling back to sequential otherwise. A batch sibling of the
single-task wrap-up closes out a whole set of completed tasks in one pass.

## Crossing a session boundary

Two different problems, two different tools:

- **The harness compacts your context mid-task.** That's normal. Keep the *planning* half in one
  unbroken context window, because HITL gates and decomposition state don't survive a context reset;
  *execution* is designed to survive it — pick a fresh session, reload task state via the CLI, and
  resume. Prefer a fresh context per task execution over carrying a long history forward.
- **You're blocked and need to hand off** — to another session, another agent, or a human. That's
  what the **handover generator** is for: it captures goal, progress, the blocker, rejected
  approaches, and next steps as a structured document, so whoever picks this up next doesn't have to
  re-derive what's already been ruled out.

Rule of thumb: a fresh session is for *continuing the same work*; a handover document is for
*someone else picking it up cold*.

## Command index

Every file in `commands/`, grouped by the noun it operates on, one line each — the canonical name
list this README is checked against.

### Lifecycle — planning

| Command | What it does |
|---|---|
| `dev-idea` | Turn a vague idea into a feature with AC and a decomposed task batch — discovery, feature-create, AC, feature-check, system-design, decompose, batch-create, handoff |
| `dev-plan` | Plan a feature from a written description — intake → feature create → AC generation → feature check gate → decomposition → batch-create |
| `dev-brainstorm` | Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring |
| `dev-refine` | Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria |

### Lifecycle — execution

| Command | What it does |
|---|---|
| `dev-run` | Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement) |
| `dev-review` | Review code for a task — SECUA framework review across Security, Efficiency, Correctness, Usability, and Architecture |
| `dev-verify` | Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence |
| `dev-unit` | Generate or extend tests until the unit target is met |
| `dev-wrap` | Wrap up a single completed task — learnings, metrics, doc-sync, optional feature transition and branch cleanup |

### Lifecycle — batch and parallel

| Command | What it does |
|---|---|
| `dev-runall` | Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report |
| `dev-parallel` | Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results |
| `dev-wrapall` | Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup |

### Lifecycle — operations and hygiene

| Command | What it does |
|---|---|
| `dev-handover` | Generate a structured handover document when blocked — captures goal, progress, blocker, rejected approaches, and next steps |
| `dev-dogfood` | Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report |
| `dev-fixall` | Fix all lint, type, and test errors systematically across the working tree |
| `dev-gitmsg` | Generate conventional commit message(s) from staged changes via per-file summarization, optionally commit |
| `dev-changelog` | Generate changelog from git commits |

### Rule authoring

| Command | What it does |
|---|---|
| `rule-scan` | Discover recurring anti-patterns worth codifying as rules |
| `rule-add` | Author a validated, smoke-tested constraint rule |
| `rule-refine` | Refine a constraint rule or preset, then re-verify it |

### Workflow authoring

| Command | What it does |
|---|---|
| `workflow-add` | Author a validated, dry-run-verified workflow in the right execution mode |
| `workflow-refine` | Refine an existing workflow, then re-validate and re-dry-run it |

### Project bootstrap

| Command | What it does |
|---|---|
| `spur-init` | Initialize a new Spur project — scaffold config + docs, then customize for this project's stack and scope |

## Skills, not commands

Commands above are thin wrappers; the actual logic lives in `skills/`. The spine
(`sp:spur-dev`) dispatches five competency skills by function — design (`sp:sys-architecture`),
decomposition (`sp:spec-decomposition`), implementation (`sp:code-implementation`), testing
(`sp:code-testing`), and verification (`sp:code-verification`) — plus a CLI facade (`sp:spur-cli`,
one reference per `spur` noun) and standalone technique skills (`sp:spur-tdd`, `sp:brainstorm`,
`sp:sys-debugging`, `sp:code-review`, `sp:parallel-execution`, `sp:doc-evolve`,
`sp:dogfood-testing`). See [skills/spur-dev/SKILL.md](skills/spur-dev/SKILL.md)'s Step routing table
for which skill owns which pipeline step.
