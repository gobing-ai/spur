---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, idea-eval, feature-create, AC, feature-check, system-design, decompose, batch-create (Design by default), handoff
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
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing ideation. Omission and `inline` drive `idea-pipeline.yaml` in this session with zero external agent/workflow processes; `auto` tier-resolves an executor and a name pins one, both through the async workflow worker. | inline |
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

**Operator gates.** Every gate is asked as one `AskUserQuestion` [decision brief](../skills/spur-dev/references/decision-brief.md):
the recommended option first, then options with their reasoning. The operator picks; they never
type a yes/no. `--auto` takes the recommended option at each gate without asking.

| Gate | Pauses when | Recommendation comes from | `--auto` takes |
| --- | --- | --- | --- |
| idea-eval | after discovery | eval report `## Recommendation` (`proceed` / `reshape` / `drop`) | `proceed`/`reshape` → continue; `drop` → cancel; missing → still asks |
| feature-check | after AC | recorded AC check + requirement coverage | PASS → continue; FAIL → revise AC (cap 3) |
| design-approval | after system-design (skipped by `--skip-design`) | recorded design check | PASS → approve; FAIL → still asks |
| batch-create | after decompose | batch schema + task-order sidecar validation | create the batch |

Flag → vars: `--auto` sets `profile=auto`, `idea_approved=true`, `design_approved=true`;
`--skip-design` sets `design=skip`.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Omitted/`inline`: drive `idea-pipeline.yaml` through the [inline pipeline driver](../skills/spur-dev/references/inline-pipeline-driver.md). Do not launch `spur workflow run`, `spur agent run`, or a native subagent unless the operator explicitly requests delegation.
- `auto`/name: launch `spur workflow run idea-pipeline.yaml --async`, observe with one `workflow trace --follow`, and only report cancellation as stopped when `workflow cancel --json` returns `killed: true`.
- `Skill(skill="sp:spur-dev", args="idea $ARGUMENTS")`
- Pass the idea text through every hop **verbatim** — never paraphrase or shorten it in the nested
  `Skill` call or stage prompts; long ideas lose their trailing asks when summarized at the hop.
- Before executing the pipeline's `start` state, persist the operator's idea argument (or the
  `--from-file` contents) **unmodified** to `.spur/run/<run-id>-idea-input.md` (0887 R1); every
  model-bearing stage prompt treats that file as the authoritative ask, and the precheck fails
  the run when it is empty or missing.
- Stage contract (discovery → idea-eval → feature-create → AC → feature-check → system-design →
  decompose → batch-create → ready-prepare → handoff): `plugins/sp/skills/spur-dev/references/dev-operations.md` § idea.
