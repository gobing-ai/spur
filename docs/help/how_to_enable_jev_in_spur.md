# How to enable Jev in Spur

Spur can optionally use `DecisionMaker` to answer executed workflow confirmation and selection
questions. Enable it explicitly in Spur config and provide the TypeSafe API key through the
environment. Supplying a key alone does not enable it.

This guide describes the implementation delivered by task 0910, verified on 2026-09-20.
The authoritative contract is [Optional DecisionMaker for executed HITL actions](../design/cli-contracts.md#optional-decisionmaker-for-executed-hitl-actions).

## 1. Prerequisites

- Use a Spur build containing task 0910 and an upstream `@gobing-ai/ts-ai-runner` release with
  `createDecisionMaker`. The installed `0.5.1` artifact has it; the previously released `0.5.0`
  artifact does not. Updating config cannot add a missing export to an older binary.
- Provide a TypeSafe API key with access to the System One API and network access to the backend.
  Spur calls `DecisionMaker`, whose default driver calls the TypeSafe SDK; Jev is the backend
  decision model. This does not select or replace the coding agent used by `agent.run`.

## 2. Enable it for one project

Merge this into `<project>/.spur/config.yaml`; preserve the rest of the file and any existing
`workflow` keys. The singular `workflow` section is different from `workflows.paths`.

```yaml
workflow:
  hitlDecisionMaker: true
```

Provide credentials to the process that launches Spur, using your shell or secret manager:

```bash
export TYPESAFE_API_KEY='<your TypeSafe API key>'
```

The value above is a placeholder. Do not put the real key in project YAML, workflow variables,
task records, or committed files. A background worker needs the key in its inherited process
environment; exporting it later in another shell does not update an already-running worker.

## 3. Global default and project override

The same YAML can live in `~/.config/spur/config.yaml`. The merged loader applies project values
over global values:

| Global value | Project value | Effective setting |
| --- | --- | --- |
| absent | absent | Disabled |
| `true` | absent | Enabled |
| `true` | `false` | Disabled |
| `false` | `true` | Enabled |

Prefer project opt-in initially: enabling the global default affects projects without an explicit
override. Both layers use a YAML boolean, not the string `"true"`.

## 4. Disable it

Set the project override explicitly:

```yaml
workflow:
  hitlDecisionMaker: false
```

Removing the project key is not sufficient if the global value is `true`. Disabled operation
returns the original responder without constructing DecisionMaker or making decision-provider
requests. It does not require credentials or workflow YAML changes.

The setting applies when configuration is loaded and the responder is composed. Start a new CLI
invocation to use the changed setting; this is not a hot-reload or cancellation mechanism for an
in-flight request or existing worker. Removing the API key is not the preferred off switch: with
the feature enabled, it produces provider-unavailable fallback instead.

## 5. What each control means

| Control | Purpose |
| --- | --- |
| `workflow.hitlDecisionMaker` | Explicit project/global activation; absent means off unless inherited |
| `TYPESAFE_API_KEY` | Provider credentials; does not activate the feature |
| `TYPESAFE_BASE_URL` | Optional API base URL override read by the upstream SDK; normally leave unset |
| `SPUR_HITL_AUTO_APPROVE=1` | Existing headless confirm fallback policy; not a Jev switch |

There is no dedicated DecisionMaker enablement environment variable or CLI flag. Spur does not
currently expose model, confidence threshold, timeout, or retry overrides for this integration.
Use the default endpoint unless intentionally targeting a compatible service: questions and selected
workflow outputs will be sent to that destination.

## 6. Answers, evidence, and fallback

When enabled, the responder can answer `hitl.confirm` and `hitl.select`. It delegates
`hitl.input` to the existing responder. It uses at most the latest 20 completed non-HITL outcomes
from the same run: node, action kind, success, and bounded error/stdout/stderr/summary text.
It excludes environment, workflow variables, commands, arbitrary result fields, and files.
Known credential patterns and configured secret values are redacted before transmission.
Enabling it authorizes sending that selected evidence plus the question and options to the provider.

The default request timeout is 15 seconds, with zero retries. Both confidence and the selected
option's probability must be at least `0.9`; rival probabilities must be strictly lower.
These thresholds are policy, not proof that a decision is correct.

Missing evidence, missing credentials/exports, API failures, malformed answers, uncertainty, and
an explicit defer all use the existing responder. In a terminal this normally prompts the operator.
Headless/JSON defaults are confirm `no`, select first option, and input empty string;
`SPUR_HITL_AUTO_APPROVE=1` changes the confirm fallback to `yes`. Thus provider failure does not
always imply a human prompt or rejection.

## 7. Execution-path limits

| Path | Current effect |
| --- | --- |
| Engine executes an eligible confirm/select with evidence | DecisionMaker may supply the answer |
| Stock task pipeline with `profile=auto` | Approval state is skipped; no decision call there |
| Approval state declares `pause: true` | It still pauses after the answer, including a model answer |
| Headless `workflow continue` | Requires explicit `--answer yes\|no\|cancel`; `--yes` only skips resume confirmation |
| Default inline `sp:dev-*` driver | Handles operator approvals itself; does not invoke this responder |

Enabling Jev therefore does not make every workflow autonomous. Existing action names, answer
variables, cancellation behavior, pause semantics, and deterministic verification gates remain in
force. The follow-up task 0911 covers routing policy, diagnostics, and execution-path guidance;
its proposed behavior is not available merely by setting this switch.

## 8. Troubleshooting

| Observation | Check |
| --- | --- |
| Setting appears ignored | Global/project precedence, correct `workflow` key, and whether a new process loaded it |
| No API call | Disabled setting, inline driver, skipped auto-profile gate, input action, or missing usable prior outcomes |
| Provider-unavailable warning | Key in the launching process, compatible installed upstream export, endpoint, and connectivity |
| Answer recorded but run paused | The YAML state's `pause: true`; answer generation does not resume it |
| Headless resume rejects `--yes` alone | Supply an explicit gate answer; `--yes` is a separate confirmation control |
| Uncertainty still returns `yes` | Check whether the existing `SPUR_HITL_AUTO_APPROVE` fallback was enabled |

Existing workflow traces show action outcomes, but do not yet establish whether the model or
fallback supplied an answer. There is no dedicated readiness report or live provider-health probe
in this feature. The task 0910 regression suite uses fake providers; it does not certify your API
key or live service availability.

## Implementation references

- [Config schema](../../packages/config/src/index.ts) and [merged loader](../../packages/config/src/loader.ts)
- [Decision responder](../../packages/app/src/workflow/decision-hitl-responder.ts)
- [Workflow service composition](../../packages/app/src/services/workflow-service.ts)
- [Headless fallback](../../apps/cli/src/workflow/hitl/default-responder.ts)
- [Inline driver contract](../../plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md)
