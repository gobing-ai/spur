---
description: "GitHub Codex PR review — prepare/reuse a PR, request `@codex review`, collect findings, and validate/fix/re-review them. Triggers: \"PR review\", \"codex review\", \"@codex review\", \"review my PR\", \"codex findings\"."
role: reviewer
argument-hint: "[<mode>] [--base <branch>] [--no-wait] [--agent <inline|auto|name>] [<focus>]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev PR Review

Wraps the **sp:pr-reviewing** skill. The review itself runs on the GitHub PR through Codex
(`@codex review`) — never through a local Codex review mechanism; the invoking agent orchestrates
and (in `fix` mode) implements.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<mode>` | `full\|submit\|collect\|fix\|rerun\|status\|rules` — full: request (deduped) + wait + report; submit: request and stop at pending; collect: report the latest review; fix: validate findings, fix legitimate ones, re-review; rerun: force a fresh review of the pushed HEAD; status: read-only composite; rules: author the repo's `AGENTS.md` `## Code Review Rules`. | full |
| `--base` `<branch>` | Base branch when a new PR must be created. | existing PR base, else repo default |
| `--no-wait` | Return pending right after the review request instead of polling. | off |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing triage/fix and on which surface the spine executes. Omit/`inline`: host session, spine steps run inline via the pr-reviewing script in workflow-YAML order. `auto`/name: spine dispatched as a `spur workflow run` subprocess (durable run record); fix triage goes to the named executor. | omit |
| `<focus>` | Remaining free text — extra review focus appended to the Codex request (e.g. `security boundaries and transaction idempotency`). | none |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-pr-review [full|submit|collect|fix|rerun|status|rules] [--base <branch>] [--no-wait] [--agent <inline|auto|name>] [review focus]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Delegate everything: `Skill(skill="sp:pr-reviewing", args="$ARGUMENTS")`. The skill owns mode
  routing, finding triage, fix, and rules authoring; `.spur/workflows/pr-review.yaml` is the SSOT
  for the review spine's state order and guards; `plugins/sp/scripts/pr-reviewing.ts` is the
  deterministic git/gh core every spine step shells out to.
- The external review goes through the GitHub PR and an `@codex review` comment only — never local
  Codex review commands. Never force-push, rewrite history, merge the PR, or discard unrelated
  changes; outside `fix` mode, ask before creating any commit.
