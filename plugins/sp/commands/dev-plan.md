---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create (Design by default)
role: planner
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>] [--skip-design] [--agent <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Plan

Wraps the **sp:spur-dev** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `"<description>"` | Feature description to plan. | required |
| `--feature` `<id>` | Attach to an existing feature. | omitted |
| `--parent` `<feature-id>` | Create under a parent feature. | omitted |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing planning. Omission and `inline` run `idea-pipeline.yaml` on the engine with `executor=host`, so each stage pauses with a work item this session performs; `auto` tier-resolves an executor and a name pins one, both dispatched as child processes. | inline |
| `--skip-design` | Omit the system-design hop. | off |
| `--auto` | Accept the pipeline's recommendation at every operator gate (same gate table as `/sp:dev-idea`). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-plan "<description>"
  [--feature <id>] [--parent <feature-id>]
  [--skip-design]                # design package off (satellite + task Design)
  [--agent <inline|auto|name>]
  [--auto]                       # no operator pauses; follow each gate's recommendation
```

**Design package (unified with `/sp:dev-idea`):** Design is **on by default**. Default fills
per-task `### Design` in the batch and the feature satellite when the seam heuristic fires
(ties lean **design**). There is **no** `--design` force flag — only **`--skip-design`** opts out.

**Removed flags:** `--approve-taste` and `--design-approved` are folded into `--auto` (same
contract as `/sp:dev-idea`). If passed, ignore them with a one-line notice.

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
  `spur workflow run idea-pipeline.yaml --vars '{"executor":"host",...}' --json` (plus `idea`, or
  `--from-file`; `--feature`/`--parent` as the flag table says, `--skip-design` → `design=skip`,
  `--auto` → `profile=auto` + `idea_approved=true` + `design_approved=true`).
  A host stage returns `{status: "paused", pause: {workItem: {runId, state, skill, prompt, inputs,
  expectFiles, ownedSections}}}`. Perform that work item natively (or through a native subagent), write
  its receipt, and advance with `spur workflow continue <run-id> --answer-text <receipt> --json`;
  repeating the same receipt is refused as not-paused, so the resume is idempotent. Repeat until the
  run is terminal.
- `auto`/name — same definition, no `executor` var: the subprocess executor runs each work item.
  Launch `spur workflow run idea-pipeline.yaml --async`, observe with one `workflow trace --follow`,
  and only report cancellation as stopped when `workflow cancel --json` returns `killed: true`.
- `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`
- Full Design package + batch `design` field contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § plan and `planning-workflow.md` Step 5.5.
