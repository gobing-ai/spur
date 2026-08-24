---
name: feature-link-helper
description: "Opt-in, strictness-triggered feature-link helper for sp:spur-dev. Resolves a deferred feature_id edge when the operator explicitly invokes --strict rigor or asks to link a task to a feature. Single-task mode (LLM-judge match + confirm) and batch-sweep mode (audit all orphan tasks). Never gate-time, never automatic, always confirm before applying."
see_also:
  - spur-dev
  - cross-cutting
---

# Feature-Link Helper

**Scope:** opt-in, strictness-triggered — never gate-time, never automatic.

This helper resolves a deferred `feature_id` edge when the operator explicitly invokes or intends
`--strict` rigor, or asks to "link this task to a feature." It is **NOT** part of the `--strict-core`
done-gate, NOT in any `--next` chain, and NOT triggered automatically. Invoking it is always an
explicit operator choice.

**Design boundaries (enforced):**

- `feature_id: null` is a valid, supported state under the default done-gate (`--strict-core`). Deferral is legitimate.
- This helper fires only when the operator opts in — it does NOT change the L4 warning severity.
- It NEVER creates a new feature without operator confirmation.
- It ALWAYS prefers matching an **existing** feature before proposing creation.
- Declining leaves `feature_id` blank — deferral preserved.

## When to use

- The operator runs (or intends to run) `spur task check <wbs> --strict` and the `feature_id` error surfaces.
- The operator explicitly asks to "link this task to a feature" or "assign a feature to this task."
- A deliberate traceability audit: `spur task check --strict` across the corpus reveals N orphan tasks.

**Do NOT invoke from:**
- The `--strict-core` done-gate (it must stay feature_id-agnostic)
- Any `--next` chain or automated pipeline step
- Any context where the operator has not explicitly requested strict rigor or linking

## Post-PASS Verification Feature Sync & Deferral

When `/sp:dev-verify <wbs>` produces a `PASS` verdict:

1. **Task has `feature_id`**:
   - Run `spur feature sync <id> --dry-run --json` to generate the proposed status transition.
   - Present the derivation proposal to the operator (showing current status, target status, and derivation reason).
   - Confirm with the operator before executing `spur feature sync <id>` (in `--auto` mode, apply forward-only proposals).

2. **Task missing `feature_id`**:
   - Check the task content for the Q&A marker `feature_link_declined: true` (`spur task show <wbs> --json`).
   - If `feature_link_declined: true`: skip linking prompt — explicit operator deferral is preserved.
   - If unlinked and not declined: propose candidate existing features via single-task mode.
   - If operator explicitly declines: preserve the existing Q&A body, append the marker, and write it through
     `spur task update <wbs> --section Q&A --from-file <body-file>`.

## Single-task mode

Use when the operator has a specific task in mind.

### Step a — Read the task

```bash
spur task show <wbs> --json
```

Read the task's Background, Requirements, and Acceptance Criteria to understand what it does.

### Step b — List existing features (candidate set)

```bash
spur feature list --json
```

Get the list of active/planning features (typically ~19 real features in this corpus). Read any
plausible candidate with `spur feature show <id> --json` to compare AC scope.

### Step c — LLM-judge match (prefer existing)

Reason about which **existing** feature this task belongs to:

- Map the task's purpose to the feature set.
- Identify the best-fit existing feature with explicit reasoning.
- Rank alternatives if multiple are plausible.

If no existing feature is a reasonable fit, state that clearly — do not force a weak link.

### Step d — Propose to the operator (ALWAYS show before mutating)

```
Proposed link: task 0148 → feature F-TRACE ("Traceability hardening")
Reasoning: the task adds the feature-link helper, scoped to the traceability feature.
Alternatives: F-PLAN (planning workflow), F-OPS (operator tooling)

Apply this link? [y/n/override <id>]
```

Wait for operator confirmation. If the operator says no or skips, **leave `feature_id` blank** —
deferral remains valid. Do not re-propose the same link.

### Step e — Create only if necessary (and confirmed)

If no existing feature fits AND the operator confirms they want to create one:

```bash
spur feature create "<feature name>" --json
```

**This is a last resort.** The feature tree has ~19 real features; orphan creation pollutes it with
synthetic single-task nodes. Prefer linking to an existing feature.

### Step f — Apply the confirmed link

```bash
spur task update <wbs> --feature <id>
```

Verify:

```bash
spur task show <wbs> --json | grep feature_id
```

## Batch-sweep mode

Use when the operator wants to resolve `feature_id` edges across multiple orphan tasks in one pass —
typically a deliberate traceability audit.

### Step 1 — Enumerate orphan tasks

```bash
spur task list --json
```

Filter to tasks where `feature_id` is null or empty. Or run `spur task check --strict` and collect
tasks with the L4 "Missing feature_id" error.

### Step 2 — List existing features (once, cache for all proposals)

```bash
spur feature list --json
```

Do not re-query per orphan — use this result for all matching.

### Step 3 — LLM-judge match per orphan

Apply Step c from single-task mode to each orphan. Build the full proposal list before presenting:

```
Batch feature-link proposals (3 orphan tasks):
  0148 → F-TRACE ("Traceability hardening")     [match: task implements the feature-link helper]
  0139 → F-PLAN  ("Planning workflow")           [match: task adds BDD AC generation step]
  0141 → (no good match found — skip)

Review each proposal:
  0148 → F-TRACE: [y/n/override <id>]
  0139 → F-PLAN:  [y/n/override <id>]
  0141:            [skip — no proposal]
```

### Step 4 — Per-orphan confirm/skip/override

For each orphan, the operator can:
- **`y`** — apply the proposed link
- **`n` / skip** — leave `feature_id` blank (deferral preserved, no mutation)
- **`override <id>`** — use a different feature id

### Step 5 — Apply confirmed links (only the confirmed ones)

```bash
spur task update <wbs> --feature <id>
```

Skip declined/skipped orphans with no mutation. Do not re-prompt declined entries.

### Step 6 — Report

```
Batch sweep complete:
  Applied: 0148 → F-TRACE, 0139 → F-PLAN
  Skipped (deferred): 0141
  Declined: (none)
```

## CLI primitives

| Verb | Purpose |
|------|---------|
| `spur feature list --json` | List all features (candidate set for matching) |
| `spur feature show <id> --json` | Read a specific feature's AC and description |
| `spur feature create "<name>" --json` | Create a new feature (last resort, confirm first) |
| `spur task list --json` | List all tasks (filter for `feature_id: null` orphans) |
| `spur task show <wbs> --json` | Read task context for LLM-judge matching |
| `spur task update <wbs> --feature <id>` | Apply the feature link |
| `spur task check <wbs> --strict` | Verify the link resolves the L4 error |
