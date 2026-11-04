---
schema_version: 1
name: Grok Bot outer-loop and routine webhook notify recipes with E2E receipt
status: todo
template: feature-impl
created_at: 2026-11-04T23:00:26.825Z
updated_at: "2026-11-04T23:53:46.471Z"
feature_id: I14

dependencies: ["1292"]
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 5
---

## 1293. Grok Bot outer-loop and routine webhook notify recipes with E2E receipt

### Background

Task 1293 delivers feature I14 scenarios R3 and R4 (`docs/features/I14_grok-bot-interop-for-spur-and-the-sp-plugin.md`). It is documentation plus one example workflow plus E2E proof, and it adds no new public spur noun or verb.

- **Outer loop:** a Grok Bot routine clones the repo through its GitHub connector, follows `sp-bot-bootstrap` (1292), triages with existing `spur … --json` reads, and turns findings into issues/PRs.
- **Notify:** a spur workflow posts its run summary to a Grok Bot routine webhook. Routines accept webhook triggers authenticated with `Authorization: Bearer <key>` (https://docs.x.ai/grok-bot/skills-routines-and-automations).

Engine facts verified 2026-11-04 by probe workflows run with `spur workflow run` (scratch `gb/1293/wf*.yaml`, engine `@gobing-ai/ts-dual-workflow-engine@0.7.1`):

- Shell actions inherit the parent process env (`spawnShellCommand` uses `envMode: 'merge'`, `dist/host.js:117-141`), so `$GROK_ROUTINE_KEY` resolves without `env.allow`.
- Any `${…}` in a shell `command:` is parsed as an engine template and fails validation (`Unknown template reference "${PROBE_KEY:+set}"`). The recipe must use bare `$NAME` only (`plugins/sp/skills/spur-cli/references/workflows/authoring-workflows.md:167-183`).
- With the default fail-fast `onError`, a failing shell action halts the run in that state (`status: failed, finalState: work`), so a `failed` state's onEnter never runs. Notify-on-failure needs the soft-probe shape (record rc, always continue, guard on rc). The probe proved it: success → `done`, failure → `failed`, both posting once; missing key → notify step fails, zero posts.
- Transitions into a `failureStates` member need `terminalReason` (0937 R3).

**Refine corrections (2026-11-04)**

- The feature says "when the workflow completes or fails". An in-workflow `failed` state cannot notify under fail-fast, so the recipe is a **wrapper** workflow that runs the target with `spur workflow run "$target" --json` as a soft probe, then always notifies, then routes on rc.
- The feature says "E2E receipt against a local stub". This is a heavy test (nested CLI spawns) with a `Bun.serve` stub on port 0, not a manual curl.
- `spur` has no "next-step" CLI verb (`/sp:dev-next` is a slash command). The outer loop's triage uses `spur task list --status todo --json`, `spur task show <wbs> --json` and `spur task check <wbs> --json`. The test asserts their existence.

### Requirements

- [ ] R1. Add `docs/help/examples/grok-bot-notify.yaml`, a state-machine wrapper. It takes `vars.target` (a workflow file) and `vars.out` (default `.spur/run/grok-bot-notify.json`) and has these states:
  - `run`: soft probe, `spur workflow run "$target" --json > "$out"; echo $? > "$out.rc"`, always exit 0.
  - `notify`: fail with stderr `GROK_ROUTINE_KEY is not set` and exit 2 if the key is empty, and likewise for `GROK_ROUTINE_URL`. Otherwise POST `$out` as `application/json` with curl `--fail-with-body`, passing the bearer header via `-H @-` from `printf`, so the key never appears in argv or in the command string.
  - `done` / `failed`: routed by a shell guard on `$out.rc`, with `terminalReason: failed-check`.

  Shell commands use bare `$NAME` only, with no `${…}`. Each shell command stays within the 5-unit simplicity budget. `spur workflow validate` is clean.

- [ ] R2. Add `docs/help/how_to_use_spur_with_grok_bot.md`, linked from `docs/help/index.md`, with four sections:
  - (a) **Bootstrap**: point to the `sp-bot-bootstrap` skill, give the install line `superskill install sp --targets grok-bot --bot-provides cli:spur --bot-provides local-fs`, and note the Team Setup Script option.
  - (b) **Outer loop**: a routine prompt template covering clone via GitHub connector → bootstrap → `spur task list --status todo --json` → `spur task show <wbs> --json` / `spur task check <wbs> --json` → open an issue or PR via the connector. It is read-only on the corpus unless the operator opts in.
  - (c) **Webhook notify**: env names `GROK_ROUTINE_URL` / `GROK_ROUTINE_KEY`, the run command, the failure semantics, and a no-secrets-in-YAML rule.
  - (d) **Limits**: the routine's payload handling and the webhook URL shape are `unverified` until a real-Bot receipt.

- [ ] R3. Add `apps/cli/tests/workflow/grok-bot-notify-recipe.heavy.test.ts`. It starts a `Bun.serve({port: 0})` stub that records method, path, `authorization` and body, then runs the source-local CLI on the example with fixture targets `apps/cli/tests/fixtures/grok-bot/{pass,fail}.yaml`. It proves:
  - (a) A passing target ends in run `status: done` with exactly one POST carrying `Bearer test-key` and a JSON body whose `status` is `done`.
  - (b) A failing target ends in run `status: failed` with exactly one POST whose body `status` is `failed`.
  - (c) With the key unset, the run fails, stderr or the trace contains `GROK_ROUTINE_KEY is not set`, and the stub receives zero requests.
  - (d) The key value `test-key` appears in no CLI stdout/stderr or persisted trace output.

- [ ] R4. Add `apps/cli/tests/grok-bot-recipe-surface.test.ts` (light). It extracts every `spur <noun> <verb>` named in the help doc and the example YAML. Each pair must resolve in the live commander tree and advertise `--json`; build the tree the same way `apps/cli/tests/help-doc-parity.test.ts` does. The noun set must be a subset of the existing registered nouns, so no new noun or verb can sneak in.

- [ ] R5. Gates: `bun run lint`, `bun run spur-check`, `bun run test:heavy` (which includes R3), and `(cd apps/cli && bun test tests/grok-bot-recipe-surface.test.ts)` pass.

Out of scope:
- new spur nouns/verbs or an `http.request`-based variant;
- running against a real Grok Bot in the gate;
- `gh` installation;
- GitHub connector configuration;
- a Grok `spur agent` executor;
- payload schema negotiation with the routine.

### Acceptance Criteria

```gherkin
Scenario: R3 — Webhook notify recipe delivers a run summary (req: R1, R3)
  Given a workflow using the documented shell curl step and a local webhook stub
  When the workflow completes or fails
  Then the stub receives one authenticated POST with the run summary and a missing key fails the step with an actionable error

Scenario: R4 — Outer-loop recipe uses only existing surfaces (req: R2, R4)
  Given the recipe documentation
  When it is reviewed against the spur CLI surface
  Then every command it names exists with --json and no new public noun or verb is introduced

Scenario: AC1 — Successful target notifies once with bearer auth (req: R1, R3)
  Given a local webhook stub and GROK_ROUTINE_URL/GROK_ROUTINE_KEY=test-key exported
  When `spur workflow run docs/help/examples/grok-bot-notify.yaml --vars '{"target":"<pass.yaml>"}' --json` runs
  Then the run status is done and the stub received exactly one POST with `Authorization: Bearer test-key` and a JSON body whose status is done

Scenario: AC2 — Failing target still notifies and the run fails (req: R1, R3)
  Given the same stub and env
  When the wrapper runs with the failing fixture target
  Then the stub received exactly one POST whose body status is failed and the wrapper run status is failed

Scenario: AC3 — Missing key fails actionably without posting (req: R1, R3)
  Given GROK_ROUTINE_KEY unset
  When the wrapper runs
  Then the run status is failed, the output names `GROK_ROUTINE_KEY is not set`, and the stub received zero requests

Scenario: AC4 — Secret never surfaces (req: R1, R3)
  Given GROK_ROUTINE_KEY=test-key
  When AC1 and AC2 runs complete
  Then `test-key` is absent from CLI stdout/stderr and the persisted run trace

Scenario: AC5 — Recipes use only existing --json surfaces (req: R2, R4)
  Given the help doc and the example YAML
  When the recipe-surface test extracts every `spur <noun> <verb>`
  Then each resolves in the live commander tree, advertises --json, and no unregistered noun appears

Scenario: AC6 — Gates pass (req: R5)
  Given the change set
  When lint, spur-check, test:heavy and the surface test run
  Then all pass
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-04T23:38:23.072Z

- **CLOSED — wrapper, not in-workflow notify.** The probe showed fail-fast stops the run in the failing state, so the `failed` onEnter never fires (Background). A wrapper over `spur workflow run "$target"` notifies for any workflow without editing it.
- **CLOSED — shell + curl, not `http.request`.** The feature names shell + curl. `http.request` is default-deny on hosts and needs host-allowlist config; it can come later as a variant.
- **CLOSED — key via `-H @-`.** `printf 'Authorization: Bearer %s\n' "$GROK_ROUTINE_KEY" | curl -H @- …` keeps the key out of argv (process list) and out of the YAML/trace command string. This is supported by curl ≥7.55 (https://curl.se/docs/manpage.html#-H).
- **CLOSED — env names** `GROK_ROUTINE_URL`, `GROK_ROUTINE_KEY`. They are inherited by shell actions without `env.allow` (verified).
- **CLOSED — payload** is the target's `spur workflow run --json` document as-is. No `jq` dependency on the Bot.
- **CLOSED — heavy test.** Nested CLI spawns exceed light-suite timing, so it gets the `.heavy.test.ts` suffix and runs under `bun run test:heavy`.
- **DEFERRED — real routine receipt.** How the routine receives the payload is unverified until the operator fires the wrapper at a real routine and records the result in Testing. It is not gate-blocking.

### Design

**WHAT.** One example wrapper workflow, one help doc, one heavy E2E test with a stub, one light surface-parity test, and two fixture workflows.

**WHERE.**
- `docs/help/examples/grok-bot-notify.yaml` (new)
- `docs/help/how_to_use_spur_with_grok_bot.md` (new)
- `docs/help/index.md` (one link entry)
- `apps/cli/tests/workflow/grok-bot-notify-recipe.heavy.test.ts` (new)
- `apps/cli/tests/grok-bot-recipe-surface.test.ts` (new)
- `apps/cli/tests/fixtures/grok-bot/{pass,fail}.yaml` (new)

**Frozen names.**

| Kind | Value |
| --- | --- |
| workflow name | `grok-bot-notify` |
| states | `run`, `notify`, `done`, `failed` |
| vars | `target`, `out` (default `.spur/run/grok-bot-notify.json`) |
| env | `GROK_ROUTINE_URL`, `GROK_ROUTINE_KEY` |
| error strings | `GROK_ROUTINE_KEY is not set`, `GROK_ROUTINE_URL is not set` |

**Wrapper shape** (proven by scratch `gb/1293/wf2.yaml`):

```yaml
kind: state-machine
name: grok-bot-notify
initialState: run
terminalStates: [done, failed]
failureStates: [failed]
vars: { target: "", out: .spur/run/grok-bot-notify.json }
states:
  - id: run
    onEnter: [{ kind: shell, options: { command: 'spur workflow run "$target" --json > "$out"; echo $? > "$out.rc"' } }]
  - id: notify
    onEnter: [{ kind: shell, options: { command: 'test -n "$GROK_ROUTINE_KEY" || { echo "GROK_ROUTINE_KEY is not set" >&2; exit 2; }; test -n "$GROK_ROUTINE_URL" || { echo "GROK_ROUTINE_URL is not set" >&2; exit 2; }; printf "Authorization: Bearer %s\n" "$GROK_ROUTINE_KEY" | curl -sS --fail-with-body -H @- -H "Content-Type: application/json" --data-binary @"$out" "$GROK_ROUTINE_URL"' } }]
  - { id: done }
  - { id: failed }
transitions:
  - { from: run, to: notify }
  - { from: notify, to: done, guard: { kind: shell, options: { command: 'test "$(cat "$out.rc")" = 0' } } }
  - { from: notify, to: failed, terminalReason: failed-check }
```

If the notify command exceeds the 5-unit budget per `workflow-fit-and-tuning.md` §3, split the key/URL checks into a `preflight` state placed before `run`. This also skips running the target when the key is missing (AC3 still holds).

**Test harness.**
- The heavy test spawns `bun run apps/cli/src/index.ts workflow run <example> --run-id <unique> --vars '{"target":…,"out":<tmp>}' --json` with `cwd` set to a temp project or the repo root, and with env `{...process.env, GROK_ROUTINE_URL: stub.url, GROK_ROUTINE_KEY: 'test-key'}`.
- The nested `spur` must resolve: prepend a temp bin with a `spur` shim that runs `exec bun run <repo>/apps/cli/src/index.ts "$@"`. Do not rely on a global link.
- Fixtures: `pass.yaml` is a one-state shell `true` workflow; `fail.yaml` is a shell `false` workflow.

**Invariants.**
- Exactly one POST per wrapper run when the key is present, and zero when it is absent.
- The key never appears in YAML, argv, stdout or the trace.
- The wrapper's terminal status mirrors the target's rc.

**Anti-patterns.**
- `${GROK_ROUTINE_KEY}` (template parse error / injection).
- A key literal in YAML or `vars`.
- `curl -H "Authorization: Bearer $KEY"` (exposes the key in argv).
- Adding a spur verb.
- Hitting the network in tests.

**Handoff.** The outer-loop section links 1292's skill. Superskill 0162's `--bot-provides` line comes from 1291's README subsection.

### Plan

- [ ] 1. Add fixtures `apps/cli/tests/fixtures/grok-bot/{pass,fail}.yaml` and the heavy test with the stub and spur shim for AC1–AC4, and confirm it fails because the example is absent (R3).
- [ ] 2. Author `docs/help/examples/grok-bot-notify.yaml` per Design. Run `spur workflow validate` and fix to clean, then iterate the heavy test to green (R1).
- [ ] 3. Write the surface test, then the help doc and index link, and iterate to green (R2, R4).
- [ ] 4. Run `bun run lint`, `bun run spur-check`, `bun run test:heavy`; check `git status --short` (R5).
- [ ] 5. Optional operator step: fire at a real routine and record the response in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/I14_grok-bot-interop-for-spur-and-the-sp-plugin.md` (R3, R4)
- https://docs.x.ai/grok-bot/skills-routines-and-automations — routine webhook bearer auth
- https://curl.se/docs/manpage.html#-H — `-H @file`/`@-` header input
- `plugins/sp/skills/spur-cli/references/workflows/authoring-workflows.md:167-183` (bare `$NAME` in shell)
- `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/host.js:117-141` (shell env merge)
- Upstream: 1292 (bootstrap skill), 1291 (install line)

### History

- 2026-11-04T23:03:29.488Z feature_id Q → I14 (system)
- 2026-11-04T23:38:25.653Z backlog → todo (system)

