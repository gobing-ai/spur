# Report contract — `sp:history-anatomy` (HA-S1, 0658)

The published report is the skill's contract. This reference owns the eleven sections (in order),
the per-finding field set, the closed category vocabulary, the stable-key grammar, the evidence
rules, comparison semantics, recurrence classes, and the positive-pattern / remediation standards.

## Eleven required sections (in order, frozen)

1. Scope and provenance
2. Executive summary
3. Baseline comparison
4. Findings
5. Recurrence ledger
6. Telemetry gaps
7. Remediation options
8. Performance analysis
9. Workflow and process improvements
10. Positive patterns
11. Evidence ledger

These names are consumed verbatim by 0659's structure gate and 0660's validation stage. Do not
rename, reorder, omit, or restate them.

## Closed category vocabulary (frozen)

- Categories: `reliability` | `repetition` | `workflow` | `performance` | `coverage` |
  `telemetry` | `positive`.

Every finding's category is drawn from this closed set. No category is invented.

## Stable finding key (frozen)

Each finding carries a stable key of the form:

```
<category>:<owner-surface>:<signal>
```

- `category` — one of the closed vocabulary above.
- `owner-surface` — the surface that would own a change (e.g. a module, command, or skill; free
  text is allowed but must be stable across runs).
- `signal` — a concise, stable machine-readable identifier of the finding.

The key is the recurrence identity. Rewording a finding's title must **never** reclassify it.

## Per-finding field set

Every finding — problem and positive alike — carries the full field set:

| Field | Requirement |
| --- | --- |
| `key` | Stable `<category>:<owner-surface>:<signal>` key. |
| `category` | From the closed vocabulary, matching the key's first segment. |
| `impact` | What the situation costs or enables (qualitative, or a concrete number where supported). |
| `trend` | `new` / `recurring` / `regressed` / `improved` / `resolved` / `not-comparable` (see recurrence). |
| `observation` | What the artifacts show — evidence, not interpretation. |
| `inference` | What the observation is reasoned to mean; names its supporting observations. |
| `confidence` | Per-finding: `high` / `medium` / `low`. Never one blanket report-level score. |
| `contradictions` | Any contradicting signal shown beside the finding, not silently reconciled. |
| `evidenceAnchor` | At least one anchor to the forensics artifact or cited `file:line`. An entry with no anchor is invalid. |

## Evidence rules

Enforcement rail for every claim:

1. **Causality needs two independent signals.** A causal claim supported by two or more
   independent signals passes. Exactly one signal is not causation — it must be labelled a
   **hypothesis** with a stated confirmation path.
2. **A process/workflow change needs recurrence** across two independent sessions, or a single
   **high-impact contract violation cited at `file:line`**.
3. **Unsupported dimensions read `not available`** and are mirrored into the telemetry-gaps
   section. Never a fabricated value, never a raw history-file fallback.
4. **Focus biases ranking, not collection.** A focus string changes finding ranking and emphasis;
   it never suppresses material off-topic findings within the window.
5. **Every inference names its supporting observations.** An inference that does not name its
   observations fails validation.
6. **Every finding has an evidence anchor.** No anchor, no finding — no row may be dropped because
   it "lacks evidence" while still appearing in a summary.

## Comparison semantics

The baseline comparison states an explicit comparability verdict.

- **Daily** compares against the **immediately preceding local calendar day**.
- **Ad-hoc** compares against the **immediately preceding equal-duration window**.
- **Insufficient or materially different coverage** renders **`not comparable`**.
- A `not comparable` baseline states no trend, no delta, and no percentage. An unsupported
  comparison is never fabricated.

## Recurrence ledger

Every finding is classified against the baseline using the **stable key**:

- `new` — not present in the baseline.
- `recurring` — present in the baseline with comparable severity.
- `regressed` — present but worse (severity, count, or impact increased).
- `improved` — present but better.
- `resolved` — present in the baseline but absent now.
- `not-comparable` — the baseline was `not comparable`.

Matching is on the stable key, never the prose title. Rewording a title between two runs must not
reclassify a recurring finding as new.

## Positive patterns

Positive entries are held to the **same evidence standard as problems**: they carry observation,
inference, confidence, and at least one evidence anchor. An entry without an anchor is invalid. The
section renders successful workflows, resolved past issues that stay resolved, and healthy,
repeating behavior worth keeping.

## Remediation options (proposals only)

Each option is a **proposal** that names:

- **owner surface** — who would apply it.
- **expected impact** — what it is expected to change.
- **verification method** — how the change would be confirmed.
- **reversibility** — whether and how it can be rolled back.

The report must contain **no applied change, no diff, and no command it claims to have run**. The
skill never applies a fix; it proposes one.

## Evidence ledger

The final section lists, for every finding, the artifact anchor(s) and any cited `file:line`,
so a reader can verify the report's claims against the evidence plane.

## Truthfulness invariants

- `not available` is the true rendering for an unsupported dimension, never a masked gap.
- `not comparable` is the true rendering for an unsupported comparison, never a computed delta.
- No bounded leaderboard length is presented as a population total (see 0657 / ADR-080: the
  coverage section reads `artifact.population` and renders `top N of M`).
