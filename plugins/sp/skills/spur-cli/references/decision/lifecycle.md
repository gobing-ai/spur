---
name: spur-cli-decision-lifecycle
description: "spur decision lifecycle: author a catalog entry, wire it into a workflow, evaluate a maker with recorded evidence, triage fallbacks and catalog errors, and tune criteria, floors and makers."
see_also:
  - spur-cli
  - spur-composer
---

# Decision lifecycle — create, evaluate, triage, enhance

The verb catalog is [../decision.md](../decision.md). This file is the per-noun procedure: how a
decision point is born, proven, diagnosed and improved. Contracts it links rather than restates:
[decision catalog design](../../../../../../docs/design/decision-catalog.md) (§3.1 SSOT, §3.2 layers,
§3.6 maker precedence) and
[decision observability](../../../../../../docs/design/decision-observability-and-adoption.md) (§3.4
reliability, §4 workflow audit, §5 staged adoption). The upstream format authority is the
`@gobing-ai/ts-ai-decision` README and its `schemas/decision-catalog.schema.json`.

## 1. Decide it is a decision at all

A catalog decision is a **total classification**: a closed vocabulary, a declared fallback, and a
recorded outcome. Use the §4 audit classes before authoring anything:

| Class | Use when | Shape |
| --- | --- | --- |
| **keep-deterministic** | An exact check answers it (status file, exit code, count, regex) | No decision; a shell guard or rule |
| **rescue-only** | A deterministic parse answers most inputs; free-form output sometimes defeats it | Parse first, call the decision only on what the parse cannot classify |
| **adopt** | The input is judgement over prose/diff evidence and a safe default exists | Catalog-reference `decide` step |
| **keep-human** | It is an operator taste gate | `hitl.confirm`/`hitl.select`; opt-in `decision.mode: evidence` routes through `gate-evidence` |

A model is a regression wherever an exact check exists. A decision with no safe fallback is a gate,
not a decision.

## 2. Create

1. **Select first.** `spur decision list --json` across every layer; `spur decision show <id> --json`
   on near matches. An existing id whose criteria fit is reused, never cloned under a new id.
2. **Pick the layer** (the composer ladder, [spur-composer](../../../spur-composer/SKILL.md)):
   scratch → `.spur/decisions/<file>.yaml` (project) → shared `config/decisions/<file>.yaml` (spur
   repository only, recorded operator consent + `build:bundle`). Winners are chosen **per file
   basename** before the hub loads, so a project file named like a shipped one replaces that whole
   shipped file — copy every id you still need, or use a new basename.
3. **Author the entry** (format version 1; unknown keys are rejected at every level):

```yaml
version: 1
defaults:
    minConfidence: 0.8            # repo convention for pipeline decisions; upstream default is 0.7
decisions:
    review-scope:                 # ^[a-z][a-z0-9_-]*$ — stable id, it keys the ledger
        type: choice              # choice | score | noul
        description: Which review depth does this diff need?   # documentation only, never sent
        parameters:
            wbs:
                type: string      # string | number | boolean | enum | json
                description: Task WBS the diff belongs to.
        criteria:                 # choice: >= 2 labels, each label's meaning in one sentence
            light: Docs-only or test-only diff with no runtime surface.
            full: Any runtime, contract, schema or security-relevant change.
        fallback: full            # must be a declared label; the safe answer on any backend failure
```

   - A parameter with no `default` is **required**. `instructions` is reserved: it is the implicit
     channel `--evidence` and workflow `evidence:` feed. Never declare it.
   - `fallback` is the outcome on `no-backend`, `timeout`, `error` and `low-confidence`. Choose the
     answer that is **safe when wrong** (`full`, `fix`, `defer`, `standard`), not the most common one.
   - Leave `maker` out of shipped catalogs. Operator config outranks the catalog
     (`flag → decisions.makers.<id> → decisions.maker → catalog`) because only the machine owner
     knows which backends exist there.
   - Spur's `DecisionService` resolves the effective maker as one name. Upstream maker chains
     (`maker: [a, b]`) and `shadow` exist in the schema but are not surfaced by `decision show`
     or `status` today; prove them with `run` before relying on them.
4. **Gate it:** `spur decision status --json` must show no `loadErrors` / `duplicateIds` and exit 0;
   `spur decision show <id> --json` must render the parameters, criteria and fallback you meant.

## 3. Wire into a workflow (optional)

Use the catalog-reference `decide` form; the inline `question`/`method`/`default` form is
deprecated (composition lint and the runner warn once per site):

```yaml
- kind: decide
  options:
      id: review-scope                       # step id; one resultFile per step
      decision: review-scope                 # catalog id
      params: { wbs: '${vars.wbs}' }
      evidence:                              # redacted + bounded to 2000 chars, joined into instructions
          - .spur/run/${vars.wbs}-diffstat.json
      resultFile: .spur/run/${vars.wbs}-review-scope.decision
```

- Guards read the schemaVersion-1 `resultFile` row (`value`, `source`, `degraded`, `confidence`).
  Route on `source == "model"` only where a degraded fallback must be distinguishable.
- `workflows.decideDecisionMaker` gates the workflow action. Off (the default) → every `decide`
  serves its fallback with no model call. `spur decision run` ignores the switch.
- `evidence` and `instructions` are mutually exclusive; `params.instructions` fails the action.
- Validate with `spur workflow validate <file> --json` and `spur workflow run <file> --dry-run`.

## 4. Evaluate

Evidence before adoption — the S4a–c slices each landed only with recorded `run` evidence for the
effective maker (observability §5).

| Question | Evidence (read-only unless noted) |
| --- | --- |
| Does the contract say what I meant? | `spur decision show <id> --json` |
| Does the catalog load cleanly? | `spur decision status --json` → `ok`, `loadErrors`, `duplicateIds`, `errors` |
| Is the maker registered / configured / ever used? | `spur decision status` readiness marks (`ST`, `CONFIGURED BY`, `RECORDED`, `ACCEPTED`) |
| Does the maker answer right now? | `spur decision status --probe` (calls each effective maker once; writes nothing) |
| How well has it served? | `spur decision status --reliability [--since <iso>] --json` → per `decisionId × maker`: `samples`, `acceptedRate`, `fallbacks{reason}`, `medianConfidence`, p50/p95 duration |
| Does it classify known cases correctly? | `spur decision run <id> --param … --evidence <fixture> --json` per labelled fixture (records a ledger row) |

Build a small labelled fixture set — at least one clear case per label plus one ambiguous case — and
run it against each candidate maker with `--maker <name>`. Compare `value` to the label, not just
`source: model`: an accepted wrong answer is worse than a fallback.

**Read confidence per maker type.** Probability-native makers (`typesafe`, `laya-local`, `clef`)
return a model distribution. Sampled makers (`fm-local`) return agreement over k samples, so
`accepted` means "all samples agreed" and 1.0 is unanimity, not calibration. Choose a
probability-native maker where the floor must discriminate.

## 5. Triage

| Symptom | Likely cause | Next step |
| --- | --- | --- |
| `status` exits 1, `loadErrors` names a file | Schema violation (unknown key, fallback not a declared label, bad `${params.*}` ref) | Fix the file; the whole catalog file is skipped until it loads |
| `duplicateIds` non-empty | Same id in two winning files of different basenames | Rename or delete one; any `run`/`decide` of that id fails meanwhile |
| `run` exits 1 | Caller mistake: unknown id, undeclared/missing/invalid param, unregistered `--maker`, unreadable evidence | Read the message; nothing reached a backend |
| `source: default`, `reason: no-backend` | Maker cannot be constructed (missing credentials, wrong host) | `status --probe`; set credentials or override `decisions.makers.<id>` |
| `reason: timeout` | Cold local model or unreachable host | Re-probe; prefer a warm or hosted maker for pipeline-critical ids |
| `reason: error` | Backend rejected the call or returned an invalid answer | Check `decision_logs.error`; on `typesafe`, parameterless decisions hit the known `state: null` 422 until the ts-libs bump (design §5) |
| `reason: low-confidence`, repeated | Criteria labels overlap, evidence is too thin, or a sampled maker disagrees with itself | Sharpen criteria (§6), add evidence, or switch to a probability-native maker |
| `RECORDED > 0`, `ACCEPTED 0` | Maker is wired but has never once succeeded | Treat as broken, not healthy; triage by `fallbacks` reason |
| Config names a maker `status` calls unregistered | Typo, or `clef` without `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_AUTH_TOKEN` | Loud by design — fix the name or the environment |
| A `decide` step always degrades | `workflows.decideDecisionMaker` is off | Intended default; enable only after §4 evidence |

## 6. Enhance

Tune one lever at a time and re-run the same fixture set; a change with no before/after evidence
pair is a preference.

| Lever | When | Where |
| --- | --- | --- |
| **Criteria wording** | Low confidence or wrong labels on clear cases | Make labels mutually exclusive and observable ("touches runtime code"), not evaluative ("risky") |
| **Evidence** | The model cannot see what decides the answer | Add or trim workflow `evidence` files; keep each well under the 2000-char bound |
| **Parameters** | The answer depends on a structured fact | Declare a typed parameter instead of burying it in evidence |
| **`minConfidence`** | Fallback rate is too high with correct answers, or too low with wrong ones | Per-decision field; lower only with fixture evidence that low-confidence answers were right |
| **Maker** | Reliability differs by backend | Operator config `decisions.makers.<id>` (not the shipped catalog) |
| **Fallback** | The safe-when-wrong answer changed | Change only with the owning workflow's guard reviewed in the same change |
| **Adoption class** | A deterministic parse now covers the input | Demote to rescue-only or keep-deterministic |

Never rename a shipped id: the ledger, Board Decisions tab and workflow `decision:` references all
key on it. Add a new id and retire the old one through the workflow change.

## 7. Best practices

- **Determinism first, model second.** Every adopted decision keeps a deterministic route or a safe
  fallback so the pipeline behaves identically with the switch off.
- **One question per id.** A decision that needs "and" in its description is two decisions.
- **Labels are a contract.** Guards and downstream shell read the label strings; treat a label
  rename as a breaking change.
- **Probe is not evidence.** `--probe` proves liveness; only `--reliability` and labelled `run`
  results prove quality, and the probe never writes the rows it would inflate.
- **Never route pipeline correctness on `maker-liveness`.** It serves only `status --probe`.
- **Measure before you migrate.** Land the catalog entry, gather `run` evidence, then adopt in a
  workflow — one decision point per change.
