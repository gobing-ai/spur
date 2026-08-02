# Design — Dev-command argument contract

Feature: [`H81`](../features/H81_dev-command-argument-contract-clarity.md).  
Decision: `docs/00_ADR.md` ADR-032 amendment (2026-08-01).  
Working evidence: [`2026-08-01-dev-command-argument-flags-brainstorm.md`](../plans/2026-08-01-dev-command-argument-flags-brainstorm.md).  
Status: accepted design; not yet built.  
Depends on: task **0413** / feature [`H82`](../features/H82_unified-agent-execution-surface-selector.md)
— collapses `--agent` / `--inline` / `--subprocess` into a single
`--agent <inline|auto|<agent>|<executor>>` selector on 19 of these 28 commands. **Land 0413 first**;
this design's tables and hints assume the collapsed selector, and migrating first would document a
contract 0413 deletes.

## Surface

Every `plugins/sp/commands/dev-*.md` file has this body order:

```markdown
# Dev Command

<one-line wrapper description>

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<positional>` | <command-local meaning> | `required` or deterministic fallback |
| `--flag <value>` | <command-local effect> | <literal, `off`, or `omitted`> |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

<invocation syntax and examples>

## Implementation

<delegation or inline-procedure pointer>
```

The canonical glossary link from a command file is
`../skills/spur-dev/references/flag-glossary.md`; the relative link above illustrates the rendered
destination from this satellite only.

## Frontmatter contract

`argument-hint` is one-line canonical syntax. Allowed content:

- positional tokens and literals;
- `--flag` tokens and value placeholders;
- optional brackets, alternatives, quoting, and whitespace.

Markdown links and prose definitions are invalid. Compatibility aliases and deprecated spellings
are omitted unless they remain canonical public syntax.

## Argument Flags table

| Rule | Contract |
| --- | --- |
| Columns | Exactly `Flag`, `Description`, `Default` |
| Positionals | Included in `Flag`; required positionals use default `required` |
| Alternatives | Separate rows when alternatives have different behavior or defaults |
| Defaults | Explicit literal, `required`, `off`, `omitted`, or deterministic derived value |
| Coverage | Bidirectional with canonical hint tokens |
| Glossary | Exactly one command-level reference to the canonical file |
| Compatibility | Mapping, deprecation, or no-op behavior belongs in the owning row/contract and tests |

## Semantic classification

| Class | Canonical surface |
| --- | --- |
| Required positional | Hint + table; default `required` |
| Optional positional | Bracketed hint + table with fallback |
| Supported public flag | Hint + table; shared meaning in glossary when applicable |
| Compatibility alias | Omit from hint; document mapping and regression behavior |
| Deprecated no-op | Omit from canonical hint unless the compatibility policy requires visibility |
| Obsolete candidate | Remove only with replacement, consumer, history, and migration evidence |
| Missing public flag | Add only when an existing backing capability consumes it |
| Missing capability | Do not advertise; create separate follow-up work |

## Validation

`plugins/sp/scripts/validate-commands.ts` retains its JSON result envelope and adds checks for dev
commands:

1. exact heading set and order;
2. syntax-only `argument-hint`;
3. one table with the exact columns;
4. one canonical glossary reference;
5. canonical hint-to-table positional/flag parity;
6. diagnostics naming the command and offending heading or token.

`plugins/sp/tests/command-flag-parity.test.ts` derives shared-flag membership from all 28 dev
commands. Numbered-operation parity remains a separate bidirectional check for commands cataloged
in `dev-operations.md`. Compatibility aliases use explicit owning-contract assertions instead of
canonical hint counts.

## Audited reconciliation set

The implementation audit must resolve these evidenced inconsistencies before changing public
syntax:

| Surface | Required disposition |
| --- | --- |
| `dev-review` target | Keep optional; correct the detailed operation contract |
| `dev-runall --next` | Retain; remove stale detailed prose denying the flag |
| `dev-wrap* --dry-run` | Retain and add to detailed inputs/defaults |
| `dev-fixall` validation command / `--max-retry` | Retain and add to detailed inputs/defaults |
| `dev-debug` input flags | Retain; add the missing backing-skill input contract |
| `dev-dogfood --full` / `--save` | Document `--full`; retain `--save` as compatibility no-op until evidenced retirement |
| Glossary membership | Reconcile `--keep-going`, `--tasks`, `--output`, `--description`, and `--scope` against declaring commands |
| Contextual `--full` / `--task` | Document per-command meanings or propose a separate compatible rename |

Recognized aliases include `dev-idea --idea-approved|--design-approved`,
`dev-plan --design-approved`, `dev-verify* --skip-shipable`, `dev-review --fix`, and dogfood's
accepted single-dash forms. They are compatibility evidence, not canonical hint syntax.

## Rollout

Land the validator, all 28 wrappers, parity tests, glossary, operation/backing contracts, README,
and authoritative/derived docs as one change. Validate platform projection with
`superskill install sp --targets codex --dry-run --verbose`; generated adapters remain uncommitted.
Rollback is one cohesive revert; no data or schema migration exists.

## Rejected designs

- Tables inside `## Usage`: mixes the input contract with examples and preserves ad hoc structure.
- Central metadata and generated commands: conflicts with ADR-032 and duplicates Superskill's
  projection ownership.
