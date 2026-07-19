---
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
argument-hint: "<testee> [--agent <name|auto>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Skill"]
---

# Dev Dogfood

Wraps the **sp:dogfood-testing** skill.

Drive an agent skill, slash command, or CLI invocation **end-to-end** as a real user would, fix what
breaks along the way (within a bounded retry budget), monitor the whole run, and emit a comprehensive
report of what happened, what broke, was fixed, and should be improved.

## When to use

- Debugging or hardening an agent skill / slash command you are actively developing.
- Validating that a command works end-to-end before shipping it.
- Producing a structured findings report (and optionally a fix task) from a real run, instead of
  re-typing the same dogfood instructions every session.

> ⚠️ **Repo mutation warning.** The default is **fix mode (`--max-retry 2`)** — this command applies
> `Edit`/`Write` fixes to the working tree as it finds breakages. For a non-mutating run that only
> monitors and reports, opt into **observe-only** with `--max-retry 0`. Use observe-only against an
> unfamiliar testee — or a pipeline-driving testee that launches long, mutating runs — so it cannot
> mutate anything by accident; it still produces the full findings report. Default fix mode assumes
> you are dogfooding a testee you own and want fixed in place.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `testee` | What to exercise — a slash command, agent skill, or CLI invocation (positional, required). Quote it if it contains flags. | (required) |
| `--agent <name\|auto>` | **Testee-scoped:** the agent the **testee** runs under (forwarded into the testee invocation). The driver always runs in the current session. **Omit it** to forward nothing — the testee runs under its own default. | (omitted → forward nothing) |
| `--max-retry <n>` | Fix attempts per failed step. The **default is `2`** (fix mode): apply `Edit`/`Write` fixes to the working tree, up to 2 attempts per step. Omission is **refused** for two independent mutation sources, each gated on `--max-retry` being explicitly passed: (a) **pipeline-driving testees** (word-boundary match via [`detectPipelineDriving`](../scripts/dogfood-testing/detect-pipeline-driving.ts): `--next`, `dev-run`/`run`, `dev-runall`/`runall`, `dev-wrap`/`wrap`, `dev-wrapall`/`wrapall`, `dev-idea`/`idea`) and (b) **mutating `--fix` modes** (`--fix all`, `--fix blockers-first`; boundary-guarded via `hasMutatingFixMode`, never matching `--fix none` / `--focus all` / `--prefix all`). Pass `--max-retry 0` for observe-only, or explicit `--max-retry N` to acknowledge mutation risk. **Note:** for a mutating-`--fix` testee, `--max-retry 0` bounds **the driver only** — the testee's own `--fix` pass still mutates the tree. | `2` unless the testee is pipeline-driving or carries a mutating `--fix` mode |
| `--save` | **Back-compat no-op for delivery.** Reports are **always** written to `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md` and a live file under `.spur/run/dogfood/<run_id>.md`. The flag still documents/prints the report path. | always-on (flag optional) |
| `--task` | File the findings as a review-template task via `spur task create --template review`. | off |
| `--chain-follow` | **Operator override for `--next` chains.** Permits the driver to follow the chain past the testing boundary and attribute chained-leg outcomes normally. Licenses reading chained-leg artifacts; does NOT license executing the chained leg. See [SKILL.md §`--next` chain stop-at-testing](../skills/dogfood-testing/SKILL.md#next-chain-stop-at-testing). | off |
| `--full` | Include **all** severity findings (P1–P4) in the report and `--task` output. Default filters to P1+P2 only. | off |

> **Single-dash lenient parsing (R6b).** The argument parser accepts `-flag value` as equivalent to
> `--flag value` for `--max-retry`, `--agent`, `--save`, `--task`, `--full` (and their `--fix`/
> `--steps` siblings). This is intentional back-compat for terminal ergonomics, but it collides with
> the mutating-fix refuse-gate, which keys on `--max-retry` presence: an operator typing
> `-max-retry 3` on a pipeline-driving testee would bypass the refuse message if the gate ran on
> the raw string. It does not — the gate runs on the **normalized** token after parse. The driver
> MUST echo the normalized flag in its Phase-1 plan output (`Plan: testee invoked as …
> --max-retry 3 …`), not the operator's original spelling, so the operator sees which form was
> honored. A run that silently parsed `-max-retry 3` without echoing the normalized form is a P4
> finding (verify-0293) — the parsing is allowed, the silent treatment is not.

`--task` is independent and composable with always-on report files. A **mandatory dual-path write**
(live + `docs/dogfood/`), **Monitor Ledger**, **Cost block**, and **summary footer** (result +
issues + findings + `[Live:]` + `[Report:]`) are always emitted — not gated on `--save`.

> **Testee-scoped `--agent`.** Unlike the other `/sp:dev-*` commands (where `--agent` picks the agent
> doing the work), here the driver is always the current session; `--agent` sets the agent the
> **testee** runs under. Example: `/sp:dev-dogfood "/sp:dev-run 0125 --auto" --agent codex` runs the
> testee as `/sp:dev-run 0125 --auto --agent codex` while this session monitors and reports. See the
> skill's [§Testee-scoped agent](../skills/dogfood-testing/SKILL.md).

## Behavior

Thin wrapper: the 4-phase protocol (Plan → Execute+fix → Monitor → Report), dual-path always-on
artifacts, on-disk live ledger, cache/Cost calculation, report template, finalize-or-abort terminal
gate, and the `--task` sink are all owned by the skill. This command parameterizes the testee, the
retry budget, the testee agent, and optional sinks.

Pipeline-driving ambiguity is rejected by the backing skill **before planning** via a **live CLI
gate** (not agent-only prose):

```bash
bun plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts \
  --testee "<testee>" [--max-retry-present] [--steps "s1||s2"] [--json]
```

Detection is word-boundary, not leading-space substring (contract unit-checked by
`tests/dogfood-testing/pipeline-detect.test.ts`). Exit **2** without `--max-retry-present` when
**either** condition holds — (a) pipeline-driving (`--next`, `dev-run`, …) **or** (b) a mutating
`--fix` mode (`--fix all` / `--fix blockers-first`, no pipeline token required — task 0293) → refuse
with the matching message:

- pipeline-driving: `⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)`;
- mutating `--fix`: `⚠ mutating --fix mode detected (--fix all | --fix blockers-first); pass --max-retry 0 (observe-only for the driver; the testee still mutates the tree) or --max-retry N (fix mode, driver + testee both mutate)`.

Any explicit `--max-retry` proceeds. After step derivation, the same CLI with `--steps` may emit the
implement-heavy advisory (W8); prefer observe-only or step-split (see skill §Step-splitting recipe),
operator override still proceeds. Phase 4 must self-validate with
`bun plugins/sp/scripts/dogfood-testing/validate-report.ts --file <report>` before `status: complete`.

## Implementation

Delegates to **sp:dogfood-testing** skill:

```
Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation, argument substitution, and the
  `Edit`/`Write`/`Bash` toolset work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:dogfood-testing`
  skill's protocol directly and run the `spur` CLI for the `--task` sink.

## See Also

- **`sp:dogfood-testing`** — the backbone skill that owns the protocol, ledger, and report template.
- **`/sp:dev-verify`** — requirements-traceability verdict for a coded task (PASS/PARTIAL/FAIL).
- **`/sp:dev-review`** — SECU code review of a task's diff.
- **`/sp:dev-run`** — runs a task (e.g. the one produced by `--task`) through the fix pipeline.
