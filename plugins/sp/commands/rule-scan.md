---
description: Discover recurring anti-patterns worth codifying as rules
argument-hint: "[<path-or-glob>]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Rule Scan

Wraps the **sp:spur-cli** facade (rule noun) (`scan` operation).

Proactive rule discovery: surveys code for **repeated** smells that should be enforced as rules,
clusters them by concern, filters out concerns already in the catalog, and reports ranked candidates.
**Propose-only** — it authors nothing. Each accepted candidate hands off to `/sp:rule-add` (which
reconciles against the catalog) or `/sp:rule-refine` (to extend an existing rule).

## When to use

- Get the constraint catalog ahead of defects instead of only reacting to noticed problems.
- After a feature lands, scan the diff for patterns worth codifying.
- Periodically audit the codebase for systematic smells (untested modules, ad-hoc boundary breaks,
  inconsistent conventions) that no rule yet catches.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `path-or-glob` | Bound the survey to a path/glob (positional) | changed / working-tree code |

## Behavior

Thin wrapper: pass the optional scope through. The skill scopes the survey (heavy scans fork a
sub-context), hunts recurring patterns with `rg`/`sg` (a one-off is not a rule — evidence is hit
count across files), clusters them into candidate concerns, runs `find-existing-coverage` per
candidate to drop already-covered ones, and returns a ranked list. It **does not** author rules.

Output: ranked candidates, each `{ concern, evidence (hits + sample files), proposed evaluator,
route: add-new | refine-extend | already-covered }`. You decide which to act on.

## Implementation

Delegates to **sp:spur-cli** facade (rule noun):

```
Skill(skill="sp:spur-cli", args="rule scan $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-cli`  skill's `scan` operation directly and pass the optional scope as an argument in chat.
