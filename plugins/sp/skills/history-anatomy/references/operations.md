# Operations — `sp:history-anatomy` (HA-S1, 0658)

The skill exposes exactly two operations, invoked by `history-anatomy.yaml` (0660):

- `enrich` — the model is given the rendered forensics artifacts (current + baseline) and authors
  the model half of the report.
- `validate` — the model is given a candidate report and independently checks its evidence claims
  against the artifacts.

Both are **skill operations**, not workflows. **Neither operation launches a workflow** — that is
the recursion guard. This is why the rubric lives here, single-sourced, rather than being
duplicated into the YAML: the rubric cannot recurse.

## Invocation contract

| Operation | Input | Output |
| --- | --- | --- |
| `enrich` | current forensics artifact + baseline artifact (plain `HistoryArtifact` JSON) | the model-authored report sections (Baseline comparison, Findings, Recurrence ledger, Remediation options, Performance analysis, Workflow and process improvements, Report-only advisories, Positive patterns) meeting the report contract |
| `validate` | a candidate report + the current/baseline artifacts | a PASS / FAIL verdict with per-finding and per-section evidence checks, naming any failing rule |

Freeze these operation names and this input/output contract — 0660 consumes them verbatim.

## `enrich` rubric

Given the current and baseline artifacts, author the model half of the report. Apply, in order:

1. **Scope and provenance** + **Executive summary** + **Evidence ledger** are populated from the
   artifact and rendered deterministically (or stated as the artifact's own data). The model
   authors only the sections listed as model-authored.
2. **Baseline comparison** — apply the comparison semantics: daily → immediately preceding local
   calendar day; ad-hoc → immediately preceding equal-duration window. If baseline coverage is
   insufficient or materially different, emit `not comparable` and **no** trend/delta/percentage.
3. **Findings** — each with the full per-finding field set (key, category, impact, trend,
   observation, inference, confidence, contradictions, evidenceAnchor, severity, reproCommand,
   ownerSurface). Categories from the closed vocabulary; stable keys of the form
   `<category>:<owner-surface>:<signal>`. Severity is the closed P1/P2/P3 vocabulary and is
   orthogonal to confidence; reproCommand reproduces the observation verbatim; ownerSurface names
   the concrete owning surface (file/package/command), consistent with the key's middle segment.
4. **Recurrence ledger** — classify every finding against the baseline on the **stable key**.
5. **Telemetry gaps** — every dimension the artifact cannot support, rendered `not available`.
6. **Remediation options** — proposals only (owner surface, expected impact, verification method,
   reversibility), plus the printed `spur task create` handoff invocation carrying the finding's
   stable key for accepted proposals. No applied change/diff/auto-write to the corpus.
7. **Report-only advisories** — repeated identical tool-and-argument signatures surfaced with
   repetition counts; proposes no automatic interruption (report-only, 0680 R5).
8. **Positive patterns** — same evidence standard as problems.

Run-cost note (0680 R6): Performance analysis reports what this run's chained `agent.run`
stages cost using the pairing analytics fold (totalCostUsd / meanDurationMs per pairing); a
pairing without cost signal renders `not available`, never zero.

Never fabricate a value, a trend, an anchor, or an applied fix. Never launch a workflow.

## `validate` rubric

Given a candidate report and the artifacts, independently verify:

- **Twelve-section completeness and order** — all twelve section names present in the frozen
  order; none renamed/omitted.
- **Per-finding fields** — every finding (problem and positive) carries key, category, impact,
  trend, observation, inference, confidence, contradictions, evidenceAnchor, severity (P1/P2/P3),
  reproCommand, ownerSurface; category in the closed vocabulary; stable-key grammar. A finding
  missing any triage field FAILs (the deterministic gate enforces the same set).
- **Remediation handoff** — each accepted-proposal handoff carries a `spur task create`
  invocation naming the finding's stable key; no auto-written tasks.
- **Evidence anchors** — every finding has at least one verifiable anchor; no anchor → FAIL.
- **Causality gate** — a causal claim with one signal must be labelled a hypothesis with a
  confirmation path; otherwise FAIL.
- **Inference names observations** — an inference that does not name its supporting observations
  FAILs.
- **Comparability** — a `not comparable` baseline must state no trend/delta/percentage; a stated
  trend must be supported by a comparable baseline.
- **Recurrence integrity** — classification is consistent with the stable keys (a rewording must
  not flip a recurring finding to new).
- **Positive patterns** — held to the same standard; an anchor-less entry FAILs.
- **Remediation** — proposals only; any applied change, diff, or command the report claims to have
  run FAILs.

Emit `PASS` only when every rule holds. On FAIL, name the section, the finding key, and the rule
violated. Never launch a workflow.
