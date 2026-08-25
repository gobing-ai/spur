---
name: history-anatomy
description: "Independent owner of diagnostic interpretation over already-imported history — the daily/ad-hoc mode contract, a closed finding taxonomy, the eleven-section report contract, and the enrich/validate rubrics. Triggers: history-anatomy, run the daily report, ad-hoc diagnosis, find issues over history."
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: analysis-core
  interactions:
    - pipeline
    - inversion
  pipeline_steps:
    - report
    - identify
    - propose
    - generate
  openclaw:
    emoji: "🩺"
see_also:
  - sp:issue-finding
  - sp:spur-cli
  - sp:spur-dev
---

# sp:history-anatomy

Owns **interpretation only** over already-imported history. It decides which arguments are legal
in which mode, what counts as evidence, how findings are keyed and graded, and what a published
report must contain, plus the rubrics its `enrich` and `validate` operations follow. It never
launches a workflow, never reprocesses raw history files, and never mutates the corpus, docs, or sources —
all orchestration lives in `history-anatomy.yaml` (0660), not here.

This body routes to the three references; the procedure lives there (the BODY_BUDGET shape — a
fresh skill cannot be added to the BASELINE exemption map).

**Choose the mode first.** The single entry is `--mode daily|ad-hoc` (default `daily`):
`references/modes.md`.

**Then hold the report to the contract.** Every report must contain the eleven sections and every
finding the full field set, with evidence rules and an explicit comparability verdict:
`references/report-contract.md`.

**Then apply the operations.** The workflow calls `enrich` to author the model half, and
`validate` to gate a candidate report; neither operation launches a workflow:
`references/operations.md`.

## Primary directive

- The artifact is the only evidence plane. A dimension the forensics artifact cannot support is a
  **telemetry gap** reported as `not available` — never a raw history-file fallback.
- Every causal claim needs **two independent signals** (or one labelled hypothesis with a
  confirmation path). Every finding carries at least one evidence anchor. No anchor, no finding.
- The report never states a trend, delta, or percentage it cannot support — an insufficient or
  materially different baseline renders `not comparable`, with no fabricated comparison.
- Findings are keyed on a **stable key**, never the prose title, so rewording never reclassifies
  recurrence.
- Remediation options are **proposals only**: an owner surface, expected impact, a verification
  method, and reversibility. No applied change, diff, or command the report claims to have run.

## Read the references

| Reference | Owns |
| --- | --- |
| [`references/modes.md`](references/modes.md) | The daily/ad-hoc mode matrix, bounds normalization, the DST-aware calendar-day rule, and the fail-loud message shape. |
| [`references/report-contract.md`](references/report-contract.md) | The eleven sections (in order), the per-finding field set, the closed category vocabulary, the stable-key grammar, the evidence rules, comparison semantics, recurrence classes, and the positive-pattern / remediation standards. |
| [`references/operations.md`](references/operations.md) | The `enrich` and `validate` operation rubrics; neither launches a workflow. |
