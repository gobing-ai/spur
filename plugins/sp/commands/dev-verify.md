---
description: Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence
argument-hint: "<wbs> [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <inline|auto|name>] [[`--fix`](../skills/spur-dev/references/flag-glossary.md#flag-fix) <none|blockers-first|all>] [[`--focus`](../skills/spur-dev/references/flag-glossary.md#flag-focus) <lens>] [[`--bdd`](../skills/spur-dev/references/flag-glossary.md#flag-bdd)] [[`--auto`](../skills/spur-dev/references/flag-glossary.md#flag-auto)] [[`--force`](../skills/spur-dev/references/flag-glossary.md#flag-force)] [--next] [--skip-shippable]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Verify

Wraps the **sp:code-verification** skill.

## Usage

```
/sp:dev-verify <wbs> [--agent <inline|auto|name>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--skip-shippable]
```

**Shippable readiness** (feature-level): when `--fix all` and the task has a `feature_id`, the
skill runs `spur feature check <id>` after the per-task verdict and emits `Shippable: PASS|FAIL|N/A`.
Default **on** with `--fix all`. Opt out only with **[`--skip-shippable`](../skills/spur-dev/references/flag-glossary.md#flag-skip-shippable)** (alias `--skip-shipable`).
See `sp:code-verification` § Shippable readiness gate.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-verification", args="verify $ARGUMENTS")`

**Flags:**

[`--next`](../skills/spur-dev/references/flag-glossary.md#flag-next): chain-to-completion with
propagation — on a PASS verdict, hand the task back to `sp:next-router` to advance and re-invoke
until done or a gate stops it. The `testing → done` transition is the chain's first hop. A PARTIAL
or FAIL verdict halts the chain (task stays `testing` as review-pending). **was: `--next` chain-ish (undefined formally).**
