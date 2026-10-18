---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, idea-eval, feature-create, AC, system-design, decompose, batch-create (Design by default), handoff
role: planner
argument-hint: "\"<idea>\" | --from-file <path> [--skip-design] [--agent <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Idea

Wraps the **sp:spur-dev** skill; the machine is **idea-pipeline.yaml** — the stage
contract below maps to that workflow's transitions.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `"<idea>"` | Vague idea to turn into a feature with AC and tasks. | required (or `--from-file`) |
| `--from-file` `<path>` | Read the idea from a file instead of the positional argument. Mutually exclusive with `"<idea>"` — exactly one must be present. The file's contents become the verbatim idea text (trimmed of surrounding whitespace only). Useful for long or multiline asks that are awkward to quote. | off |
| `--skip-design` | Omit system-design (and its approval gate) and per-task Design. | off |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing ideation. Omission and `inline` run `idea-pipeline.yaml` on the engine with `executor=host`, so each stage pauses with a work item this session performs; `auto` tier-resolves an executor and a name pins one, both dispatched as child processes. | inline |
| `--auto` | Accept the pipeline's recommendation at every operator gate (see below). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-idea "<idea>" | --from-file <path>
  [--skip-design]                # design package off (system-design + task Design)
  [--agent <inline|auto|name>]   # inline is the current session; auto/name are async workers
  [--auto]                       # no operator pauses; follow each gate's recommendation
```

There is **no** `--design` force flag. Design is default-on; only `--skip-design` opts out.

**Removed flags:** `--approve-taste`, `--idea-approved`, and `--design-approved` are folded into
`--auto`. If passed, ignore them with a one-line notice; do not treat them as `--auto`.

**Operator gates.** Every gate is a decision point: interactively the gate asks the operator one
[decision brief](../skills/spur-dev/references/decision-brief.md) — the recommended option first, then
options with their reasoning; the operator picks, they never type a yes/no. Under `--auto`
(`profile=auto`) the recorded guard route or the gate's declared evidence binding decides, and the
trace records the answering source. `--auto` takes the recommended option at each gate.

| Gate | Pauses when | Recommendation comes from | `--auto` takes |
| --- | --- | --- | --- |
| idea-eval | after discovery | eval report `## Recommendation` (`proceed` / `reshape` / `drop`) | `proceed`/`reshape` → continue; `drop` → cancel; missing → still asks |
| design-approval | after system-design (skipped by `--skip-design`) | recorded design check | PASS → approve; FAIL → still asks |

The AC check and the batch create are deterministic pipeline steps, not gates: `ac-generate`
runs `spur feature check` and routes on the recorded result (a FAIL retries the AC loop, cap 3),
and `batch-create-run` runs `spur task batch-create` and routes on its own recorded result.
Neither ever pauses, under any profile.

Flag → vars: `--auto` sets `profile=auto`, `idea_approved=true`, `design_approved=true`;
`--skip-design` sets `design=skip`.

## Implementation

- **Publish the generated plan first (1105):** your first tool call — before invoking the skill or
  reading any reference — is `spur workflow show idea-pipeline.yaml --no-logo --format todo --json`
  (the CLI resolves the project→registered→shared layer); then publish every `.plan` row's `text`
  verbatim as the host todo list (the `steps[]` inventory when `.plan` is `null`) before the
  pipeline's first stage.
- **The loop is three moves** (D65 / ADR-140, design `workflow-execution-foundation` §3):
  `spur workflow run` → perform the returned work item → `spur workflow continue`. The engine owns
  every guard, transition and deterministic action; this session never re-executes them.
- Omitted/`inline` — the run dispatches to this host session:
  `spur workflow run idea-pipeline.yaml --vars '{"idea":"<idea>","executor":"host",...}' --json`.
  A host stage returns `{status: "paused", pause: {workItem: {runId, state, skill, prompt, inputs,
  expectFiles, ownedSections}}}`. Perform that work item natively (or through a native subagent), write
  its receipt, and advance with `spur workflow continue <run-id> --answer-text <receipt> --json`;
  repeating the same receipt is refused as not-paused, so the resume is idempotent. Repeat until the
  run is terminal.
- `auto`/name — same definition, no `executor` var: the subprocess executor runs each work item.
  Launch `spur workflow run idea-pipeline.yaml --async`, observe with one `workflow trace --follow`,
  and only report cancellation as stopped when `workflow cancel --json` returns `killed: true`.
- `Skill(skill="sp:spur-dev", args="idea $ARGUMENTS")`
- Pass the idea text through every hop **verbatim** — never paraphrase or shorten it in the nested
  `Skill` call or stage prompts; long ideas lose their trailing asks when summarized at the hop.
- The `start` state persists the operator's idea argument (or the `--from-file` contents)
  **unmodified** to `.spur/run/<run-id>-idea-input.md` (0887 R1); every model-bearing stage prompt
  treats that file as the authoritative ask, and the precheck fails the run when it is empty or missing.
- Stage contract (discovery → idea-eval → feature-create → ac-generate → system-design
  (conditional) → design-approval → decompose → batch-create-run → ready-prepare →
  handoff-finalize → handoff): `plugins/sp/skills/spur-dev/references/dev-operations.md` § idea.
