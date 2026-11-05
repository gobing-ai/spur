# How to Use Spur with Grok Bot

> **Captured against spur `0.4.3` on Bun `1.4.3` (2026-11-05).** Every `spur <noun> <verb>`
> pair named below and in `docs/help/examples/grok-bot-notify.yaml` is verified against the
> live commander tree by `apps/cli/tests/grok-bot-recipe-surface.test.ts` (feature I14 R4).
> Routine/webhook-behaviour claims against docs.x.ai carry the `unverified` label until a
> real-Bot receipt is recorded (§5).

Grok Bot can operate on this repository as an **outer-loop maintainer** (clone → bootstrap →
triage tasks → open issues/PRs through the GitHub connector) and as a **routine webhook
target** (a spur workflow posts its run summary to the Bot's routine when a workflow run
completes or fails). This guide covers both; it adds no new public `spur` noun or verb.

## 1. Bootstrap — one-time toolchain install on the Bot host

The Bot's cloud computer needs four CLIs: `bun` (runtime) plus `spur`, `superskill` and
`kk` (toolchain). The Bot gets its sp-plugin capabilities — the `cli:spur` provider (it can
shell out to `spur … --json`) and the `local-fs` provider (it can read this repo's files) —
from the `superskill install sp` line below, then follows the
[`sp-bot-bootstrap`](../../plugins/sp/skills/sp-bot-bootstrap/SKILL.md) skill for the host
toolchain. The skill is idempotent: it runs a check first, installs only what is missing,
and is safe to re-run after a computer recreate.

```sh
superskill install sp --targets grok-bot --bot-provides cli:spur --bot-provides local-fs
```

Then, inside the Bot's routine or skill surface, bootstrap the toolchain with
`sp-bot-bootstrap`: run its **check** block, and only if check exits nonzero run the
**setup** block, then re-check (`missing: <tool>` lines report what setup installed).
If the installation is instead owned by a team operator, the skill's
**Team Setup Script** variant covers the same four tools in one script — hand it the same
tool list; the Bot still confirms with the check block afterwards.

## 2. Outer loop — a read-only maintenance routine

Give the Bot a routine with a prompt like the template below. It stays **read-only on the
corpus**: every `spur` step is a `--json` read. Findings become issues or PRs through the
GitHub connector, which puts the operator's review gate between the Bot and the repo; task
or feature *writes* happen only if the operator explicitly opts in.

```text
Routine: spur — outer loop (read-only)

1. Clone the repository through your GitHub connector.
2. Bootstrap: follow the sp-bot-bootstrap skill.
3. Run:  spur task list --status todo --json
4. For promising entries:
       spur task show <wbs> --json
       spur task check <wbs> --json
5. File concrete defects or sharpened requirements as issues or PRs via the connector.
6. Stop. Leave the corpus untouched; report one-line findings only.
```

Surface facts (verified): spur has no "next-step" CLI verb — next-step routing lives in the
slash-command layer (`/sp-dev-next`), which a Bot routine does not load — so the triage loop
composes plain reads: `spur task list`, then `show`/`check` per entry.

## 3. Webhook notify — the `grok-bot-notify` recipe

`docs/help/examples/grok-bot-notify.yaml` is a **state-machine wrapper** over any target
workflow: it soft-runs `spur workflow run "$target" --json` into a postbox file, then POSTs
that JSON document (the run summary; `status` is `done` or `failed`) to a routine webhook
authenticated with `Authorization: Bearer <key>` (referenced:
https://docs.x.ai/grok-bot/skills-routines-and-automations — **unverified** payload handling
until a real receipt, §5).

### Run command

```sh
GROK_ROUTINE_URL="https://<routine-host>/<hook>" GROK_ROUTINE_KEY="<your-key>" \
  spur workflow run docs/help/examples/grok-bot-notify.yaml \
  --vars '{"target":"<workflow-file>","out":".spur/run/grok-bot-notify.json"}' \
  --json
```

`vars.out` defaults to `.spur/run/grok-bot-notify.json`; override per run when schedules or
tests drift between invocations. The postbox file holds the **last** run summary only — the
recipe is a notification postbox, not a history store (use `spur history` for that).

### Env contract

| Env var            | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `GROK_ROUTINE_URL` | routine webhook endpoint, read by the notify step            |
| `GROK_ROUTINE_KEY` | bearer key for `Authorization: Bearer <key>`, never into YAML |

Both are read by the recipe's **shell**, not by Spur product code, so they are not part of
the product env inventory ([Environment Variables](./environment_variables.md), ADR-120 gate)
— they are the recipe's documented contract. The **no-secrets-in-YAML** rule: keys exist only
as env vars; the recipe never embeds a key value, and the bearer header travels by **stdin**
(`printf 'Authorization: Bearer %s\n' "$GROK_ROUTINE_KEY" | curl -H @- …`), so the key value
appears in neither `argv`/`ps` output nor in the engine's persisted command string or run log.

### Failure semantics

- Target passes (rc 0): the summary (body `status: done`) is POSTed and the recipe run
  itself ends `status: done`.
- Target fails (rc ≠ 0): the probe **always continues** (soft probe — it records the exit
  code instead of aborting, because fail-fast would stop the run before a notify-on-failure
  step could fire), the summary (body `status: failed`) is still POSTed, and the recipe run
  then routes to its `failed` state with terminal reason `failed-check`.
- Notify step fails: missing env → stderr `GROK_ROUTINE_KEY is not set` /
  `GROK_ROUTINE_URL is not set`, exit 2; webhook error → `curl --fail-with-body` fails.
  The recipe run ends `status: failed` inside `notify`; no request went out for that run.

### How the probe runs the target despite the nested-run refusal

The engine refuses any nested `spur workflow run` when the run-depth marker
`SPUR_WORKFLOW_RUN_ACTIVE=1` is inherited (feature D5, task 0610 R4 — mechanically refused,
before forking anything). Because this wrapper's own engine run sets that marker, its probe
could never start the target. The shipped probe carries the sanctioned one-leg clearance
(task 1293 Q&A, citing 0610 R4): it drops exactly that variable for its own single leg —
`env -u SPUR_WORKFLOW_RUN_ACTIVE spur workflow run …` — so the leg runs as a clean top-level
run, which is what the refusal's own error text prescribes. Depth stays bounded: the leg run
re-exports the marker for anything deeper, so no farther nesting slips through.

## 4. What this does NOT cover

- No new `spur` noun/verb, no Grok `spur agent` executor, no scheduled/cron driver of the
  recipe (the routine's own scheduler triggers the run command above).
- No direct leads: no host-allowlist `http.request` variant, no fanout to multiple routines,
  no board/DB wiring — the recipe is one file plus one doc plus their tests.

## 5. Limits (unverified until a real-Bot receipt)

- **Payload handling.** The recipe POSTs the target's run-summary JSON verbatim; how a real
  routine names and reshapes that payload on the Bot side is unverified until the operator
  fires the wrapper at a real routine and records the receipt in Testing.
- **Webhook URL shape.** `https://<routine-host>/<hook>` is a placeholder; the docs.x.ai
  URL-path shape is unverified. The recipe accepts anything curl accepts and surfaces
  non-2xx replies through `--fail-with-body` as the failed state.
- **`spur` resolution on the Bot host.** The run command calls `spur` from `PATH`; bootstrap
  sets that up, but the routine runner's shell snapshot is unverified until first run.
