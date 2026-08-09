---
name: finding-contract
description: "Finding classifications, evidence rules, severity/confidence semantics, and the stable Markdown/JSON result envelope for sp:conflict-finding."
see_also:
  - conflict-finding
  - authority-resolution
  - comparison-protocol
  - remediation-routing
---

# Finding and result contracts

`sp:conflict-finding` reports every asserted conflict as a **finding** carrying a fixed field
envelope, and packages the whole audit run into a **result** with a fixed top-level shape. This
file is the SSOT for both: what a finding may say, what evidence must back it, how severity and
confidence are graded, and how Markdown and `--json` stay the same information in two renderings.

Two rules bind everything below:

1. **A conflict is a claim about claims, not about text.** Only `contradiction`, `stale`,
   `duplicate`, `omission`, `orphan`, or `ambiguous-authority` supported by reproducible evidence
   count. Wording or abstraction-level differences are never asserted as conflicts (R2).
2. **The envelope is stable, the reasoning is not.** `--json` stabilizes the evidence envelope so
   results can be inspected or composed; it never implies deterministic semantic reasoning.

## 1. Finding classifications

### `conflict_type`

Exactly one of six values. The value states _what kind of disagreement_ the evidence establishes —
not what the auditor suspects, and never merely what text differs.

| `conflict_type`       | Meaning                                                                                                                                  | Minimum evidence posture                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `contradiction`       | Two live claims about the same subject + claim type assert incompatible facts and neither is superseded.                                 | ≥ 2 opposing anchors, both current                                            |
| `stale`               | A projection (derived doc, feature/task status, doc surface) describes a state that its authority or observed reality has moved past.    | ≥ 2 opposing anchors (current authority/observation vs. the stale projection) |
| `duplicate`           | The same claim is stated in ≥ 2 places as if independent, risking drift and split edits.                                                 | ≥ 2 anchors for the same subject+claim                                        |
| `omission`            | A required claim is absent where the authority or an explicit link implies it must exist.                                                | 1 anchor proving the obligation + 1 anchor showing the gap                    |
| `orphan`              | A claim references a subject, symbol, WBS, feature ID, or command that no longer exists or is no longer reachable.                       | 1 anchor for the dangling reference + 1 anchor showing the target is gone     |
| `ambiguous-authority` | Two or more authorities claim the same subject+claim but are incomparable (or authority is missing), so no precedence edge can be drawn. | ≥ 2 candidate authorities, none provably dominant                             |

Rules:

- A `contradiction` between a normative source and observed reality is recorded as _both_ sides —
  the precedence reason names which side is normative and which is observed, without deleting the
  observed one (see [./authority-resolution.md](authority-resolution.md)).
- A `stale` finding never mutates the source of truth; it names which projection lags and which
  artifact is authoritative.
- When classification is uncertain, default to `ambiguous-authority` (an unresolved HITL item) or
  to a low-confidence candidate — never to a definitive `contradiction` you cannot defend.

### `status`

Exactly one of six lifecycle states. It tracks where the finding sits between discovery and
resolution, and it is what the remediation workflow reads to decide the next action.

| `status`                   | Meaning                                                                                                | Who advances it                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `open`                     | Reported with evidence; no decision or repair yet.                                                     | default after audit                           |
| `needs-authority-decision` | Authority is incomparable/missing; requires a human decision before any repair is proposed as settled. | audit, when authority ambiguity is unresolved |
| `confirmed`                | Evidence revalidated (freshness recheck) and the finding is accepted as real.                          | confirmation gate                             |
| `repairing`                | A repair is in flight through the owner surface.                                                       | remediation routing                           |
| `resolved`                 | Repair applied, or the artifacts now match (idempotent), and freshness revalidated.                    | remediation completion                        |
| `failed`                   | A repair attempt failed or hit ambiguous authority mid-repair and was not silently rolled forward.     | remediation failure                           |

Transition rules:

- `open` → `needs-authority-decision` happens during audit when no precedence edge can be drawn.
- `open`/`needs-authority-decision` → `confirmed` only through the explicit confirmation step in
  `--resolve` mode after a freshness recheck.
- A `failed` finding may be re-audited (back to `open`) but is never silently reported as
  `resolved`.

## 2. Required finding fields

Every finding carries all of these fields, in **both** Markdown and JSON. The field set is fixed;
absent information is represented by an explicit sentinel (`null`, `"unknown"`, or `[]`), never by
dropping the key.

| Field                  | Type           | Content                                                                                                                                                                                   |
| ---------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | string         | Stable identifier for this finding in this run, e.g. `F-0001`. Used to key remediation and stale-evidence checks.                                                                         |
| `subject`              | string         | The shared identity the conflicting claims are about (path, WBS, feature ID, symbol, command, config key, or normalized domain term).                                                     |
| `claim_type`           | string         | The claim dimension being judged (process, structural-decision, product-scope, feature-ac, task-obligation, architecture-mechanism, command/api/schema-surface, implementation-behavior). |
| `conflict_type`        | string         | One of the six values in §1.                                                                                                                                                              |
| `pillars`              | string[]       | The pillar(s) involved, from `source`, `tasks`, `features`, `authority`.                                                                                                                  |
| `artifacts`            | string[]       | Repo-relative paths of every artifact participating in the conflict.                                                                                                                      |
| `normative_authority`  | string \| null | The artifact/rule that defines what _should_ be true for this subject+claim, if resolvable.                                                                                               |
| `observed_reality`     | string \| null | What currently _is_ true (runtime behavior, code topology, gate output), if observable.                                                                                                   |
| `precedence_reason`    | string         | The project rule or documented fallback that justifies the authority edge — or an explicit statement that none exists (for `ambiguous-authority`).                                        |
| `evidence`             | array          | Reproducible evidence items per §3.                                                                                                                                                       |
| `freshness`            | object         | Per-anchor staleness: `{ revalidated: bool, rechecked_at: ISO8601\|null, anchors_stale: string[] }`.                                                                                      |
| `severity`             | string         | Impact grade: `critical` \| `high` \| `medium` \| `low` (§4).                                                                                                                             |
| `confidence`           | string         | Evidence-strength grade: `high` \| `medium` \| `low` (§4).                                                                                                                                |
| `false_positive_check` | string         | The explicit reasoning that rules out lifecycle, supersession, abstraction-level, and intentional-deprecation explanations before asserting conflict (R2).                                |
| `proposed_repair`      | string \| null | The minimal repair that would reconcile the claims, when one can be proposed without forcing ambiguous authority.                                                                         |
| `repair_owner`         | string \| null | The artifact owner / route responsible for the repair (`spur task/feature`, `sp:doc-evolve`, source lifecycle, command/skill superskill).                                                 |
| `status`               | string         | One of the six values in §1.                                                                                                                                                              |

### The `false_positive_check` is mandatory

Every finding must show its work against the four challenge classes (R2). The check is a short
statement, not a placeholder:

| Challenge               | Ask                                                                                    | If it explains the difference |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| Lifecycle               | Is one claim planned/future work rather than a present contradiction?                  | Not a conflict                |
| Supersession            | Is the older artifact superseded/historical?                                           | Not a current conflict        |
| Abstraction level       | Are the claims at different intended levels (design intent vs. implementation detail)? | Not a conflict                |
| Intentional deprecation | Is the divergence deliberate and documented?                                           | Not a conflict                |

A finding with an empty or hand-wavy `false_positive_check` must be demoted to low-confidence
candidate or dropped — it has not met the bar for a definitive conflict.

## 3. Evidence rules

Each item in `evidence` is a reproducible, self-contained anchor. The same shape appears in
Markdown (as a bulleted evidence block) and JSON (as an object in the `evidence` array).

```json
{
  "path": "docs/04_DESIGN.md",
  "anchor": { "kind": "line", "value": 141 },
  "claim_paraphrase": "DESIGN says the flag default is --mode adaptive",
  "provenance": { "source": "git blame", "freshness": "2026-08-08" },
  "reproduced_by": "rg '--mode' docs/04_DESIGN.md; read docs/04_DESIGN.md:141"
}
```

### Anchor kinds

`anchor.kind` is one of a fixed set — never a bare, unverifiable line number.

| `kind`    | `value` example                | When to use                                                            |
| --------- | ------------------------------ | ---------------------------------------------------------------------- |
| `line`    | `141`                          | A specific line, when a stable line number exists in the current tree. |
| `heading` | `## Design`                    | A section that can move line numbers across edits.                     |
| `symbol`  | `findconflict`                 | A function/type/command/flag/config-key name.                          |
| `wbs`     | `0486`                         | A task WBS identifier.                                                 |
| `feature` | `H11`                          | A feature ID.                                                          |
| `command` | `/sp:dev-find-conflict --json` | A command or flag invocation / contract.                               |

### Mandatory rules

1. **Repo-relative path.** `path` is always relative to the repository root; never an absolute
   path, never an invented location.
2. **Claim paraphrase.** Every anchor restates the claim it supports in the auditor's own words so
   the reader need not re-open the artifact to know what was asserted.
3. **Provenance and freshness.** Record where the value came from (`git`, `rg`, `spur task --json`,
   `sp:doc-evolve` audit, direct read) and when it was observed, so revalidation can detect drift.
4. **Reproduction step.** `reproduced_by` names the exact command or reasoning step that produced
   the anchor, so a fresh session can re-run it.
5. **Two opposing anchors for `contradiction`/`stale`.** These conflict types are not asserted on a
   single artifact: `evidence` must contain at least two anchors on opposite sides, each with its
   own path/paraphrase/reproduction.
6. **Never fabricate line numbers.** If a line number is unavailable or unstable, use a stable
   structural anchor (`heading`, `symbol`, `wbs`, `feature`, `command`). A made-up line number is a
   hard violation; prefer a structural anchor and note `line` as `null`.
7. **Opposing anchors must be current.** For `contradiction`, both sides must be live; a superseded
   or historical anchor is not opposition. For `stale`, the current authority/observation is one
   side and the lagging projection the other.

### Unavailable anchors

When a claim cannot be pinned to a stable anchor, record the best structural anchor and set
`confidence` accordingly — never fabricate, never silently drop the evidence item. An evidence item
with no reproducible anchor cannot support a `contradiction`/`stale` finding.

## 4. Severity and confidence

Severity and confidence answer two different questions and must never be conflated:

- **`severity`** = impact _if the conflict is real_ (blast radius, wrongness, cost of not fixing).
- **`confidence`** = strength of the evidence that the conflict _is real_.

### Severity — impact-based

| `severity` | Meaning                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `critical` | The conflict misdirects or corrupts a load-bearing decision/contract: e.g. an AC that contradicts shipped behavior of a core command, or an ADR superseded while derived docs still assert it as current. |
| `high`     | A materially wrong projection that likely causes incorrect work (stale task status, feature AC drift, surface doc contradicting a schema).                                                                |
| `medium`   | A real but bounded divergence; correctable with local, confirmed repair.                                                                                                                                  |
| `low`      | A cosmetic or low-blast-radius inconsistency; tracked but not urgent.                                                                                                                                     |

Severity is judged from impact, _not_ from how easy the conflict was to spot. A `critical` finding
with weak evidence still reports `severity: critical` but `confidence: low` (see below).

### Confidence — evidence strength

| `confidence` | Meaning                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `high`       | ≥ 2 reproducible, current, opposing anchors; precedence edge is explicit and challenge-free.                                   |
| `medium`     | Reproducible anchor(s) present, but one side is weaker (stale provenance, single indirect anchor, or a non-trivial inference). |
| `low`        | A plausible candidate supported by partial/indirect evidence; could not be fully defended.                                     |

### Low confidence never disappears

A low-confidence candidate is **never promoted to a definitive conflict**, and it is **never
dropped**:

- It is reported with `confidence: low` and `status: open` (or `needs-authority-decision`), placed
  after higher-confidence findings in the report.
- It is NOT given `status: confirmed` and is NOT routed for repair in `--resolve` mode without
  human revalidation.
- The report lists it under **candidates / unresolved**, distinct from confirmed findings, so
  nothing is silently lost.

## 5. Top-level result envelope

The whole run is a single result object. Top-level keys are fixed:

```text
schema_version, command, scope, mode, pillars, authority_map,
inventory, findings, unresolved, coverage, cost, remediation, errors
```

```json
{
  "schema_version": 1,
  "command": "dev-find-conflict",
  "scope": "docs/00_ADR.md",
  "mode": "adaptive",
  "pillars": ["authority"],
  "authority_map": {},
  "inventory": [],
  "findings": [],
  "unresolved": [],
  "coverage": { "complete": true },
  "cost": {},
  "remediation": {},
  "errors": []
}
```

| Key              | Content                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | integer, `1`. The envelope contract version — not a semantic-reasoning version.                                                                                             |
| `command`        | string, `dev-find-conflict`.                                                                                                                                                |
| `scope`          | string. The resolved audit scope (path, WBS, feature ID, symbol, command, or `"<project>"`).                                                                                |
| `mode`           | string, `adaptive` \| `full`.                                                                                                                                               |
| `pillars`        | string[]. The pillars actually audited (subset of `source`, `tasks`, `features`, `authority`).                                                                              |
| `authority_map`  | object. Claim-type → authoritative artifact/rule, with each precedence edge citing its project rule or fallback (see [./authority-resolution.md](authority-resolution.md)). |
| `inventory`      | array. Four-pillar inventory entries: `{ pillar, identity, path, anchor, freshness, scan_status }`.                                                                         |
| `findings`       | array. Confirmed findings with the fixed field set of §2.                                                                                                                   |
| `unresolved`     | array. Ambiguous-authority and low-confidence candidates awaiting a human decision; never empty-hiding real uncertainty.                                                    |
| `coverage`       | object. Intended/discovered/scanned/skipped per pillar, skipped reasons, reused context, change cone, `complete: boolean` (§6).                                             |
| `cost`           | object. Estimated files/claims/tokens inspected vs. skipped; never claims "comprehensive" when `coverage.complete` is false (§6).                                           |
| `remediation`    | object. The confirmed/declined repair set keyed by finding ID + evidence fingerprint, with per-item outcome (see [./remediation-routing.md](remediation-routing.md)).       |
| `errors`         | array. Distinctly typed failures — see below.                                                                                                                               |

### `errors` — tool failure vs. semantic uncertainty

`errors` distinguishes two failure classes so a consumer never mistakes a broken tool for a
genuinely ambiguous claim:

| Error type             | Meaning                                                                                                                                           | Example |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `tool_failure`         | A deterministic step (git, rg, `spur task --json`, check) failed or was unavailable. Recorded as coverage evidence; degrades `coverage.complete`. |
| `semantic_uncertainty` | The model could not defensibly classify/comparify a subject+claim. Recorded as an unresolved candidate, never forced to a definitive conflict.    |

Both types carry `{ kind, subject, message }`. A `tool_failure` never becomes a finding; a
`semantic_uncertainty` never becomes a confirmed conflict.

### `coverage` — honesty contract

```json
{
  "complete": false,
  "pillars": {
    "source": {
      "intended": 120,
      "discovered": 120,
      "scanned": 80,
      "skipped": 40,
      "skipped_reasons": ["stale_context", "unlinked_symbols"]
    },
    "tasks": {
      "intended": 60,
      "discovered": 60,
      "scanned": 60,
      "skipped": 0,
      "skipped_reasons": []
    }
  },
  "reused_context": [".spur/context/anatomy.md"],
  "change_cone": "git diff main..HEAD -- src/",
  "complete": false
}
```

- `complete: true` is claimed **only** when every intended pillar entry was scanned and every
  tool step succeeded.
- Adaptive mode must disclose `skipped` and `skipped_reasons` (stale context, unverifiable
  provenance, unlinked symbols) and, when reuse is used, the `reused_context` paths plus the
  `change_cone` it relied on.
- Absent/stale/unverifiable context degrades to a cold full scan **or** an explicit
  `complete: false` result — never a silent reduced-coverage claim.

### Markdown carries the same information

The Markdown report is the same envelope rendered as readable sections, with no information loss:

- A **Coverage** section mirrors `coverage` (per-pillar scanned/skipped + reasons, reused context,
  change cone, completeness statement).
- A **Findings** section lists every finding with all fields of §2; ordering by `severity` then
  `confidence`.
- An **Unresolved / candidates** section mirrors `unresolved`, including low-confidence candidates
  and ambiguous authority.
- An **Errors** section distinguishes `tool_failure` from `semantic_uncertainty`.
- An **Authority** section mirrors `authority_map` with each precedence edge's rule citation.
- **Cost** is reported plainly and never overstated when coverage is incomplete.

## 6. Stable JSON vs. non-deterministic reasoning

`--json` emits the same envelope as Markdown, but stability is scoped deliberately:

- **Stable:** the _evidence envelope_ — schema_version, field names and shapes, evidence anchor
  kinds, classification vocabulary (`conflict_type`, `status`), coverage accounting, error typing.
- **Not stable / never implied deterministic:** the _semantic reasoning_ — which candidates were
  generated, how subject clustering was done, which comparisons were drawn, and the prose
  justifications. Two runs over the same tree may name different candidates; that is expected and
  must not be presented as a classifier regression.

Consumers (tests, automation, downstream tools) may rely on the envelope contract and on
reproducible anchors; they must not rely on candidate-set identity or on any claim of
deterministic semantic output. This is why `schema_version` is an envelope version only.

## 7. Cross-cutting rules (R2)

- Only the six `conflict_type` values are asserted; everything else is a candidate or unresolved.
- Every finding names the subject, claim type, artifacts, authority path, and reproducible
  anchors (R4).
- A selected pillar is never silently omitted; absence of an optional authority file is reported
  but does not block the audit (R1).
- No unbounded all-pairs comparison; candidates come only from the explicit-link candidate graph
  (see [./comparison-protocol.md](comparison-protocol.md)).
- Audit mode produces findings only; mutation requires `--resolve` + confirmation + freshness
  recheck, routed by owner (see [./remediation-routing.md](remediation-routing.md)).

## Related

- Skill entry: [../SKILL.md](../SKILL.md)
- Authority matrix + fallback: [./authority-resolution.md](authority-resolution.md)
- Candidate graph + comparison protocol: [./comparison-protocol.md](comparison-protocol.md)
- Confirmed remediation routing: [./remediation-routing.md](remediation-routing.md)
- Verification of findings against requirements: `sp:code-verification`
