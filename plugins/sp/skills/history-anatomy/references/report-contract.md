# Report contract — `sp:history-anatomy` (HA-S1, 0658)

The published report is the skill's contract. This reference owns the twelve sections (in order),
the per-finding field set, the closed category vocabulary, the stable-key grammar, the evidence
rules, comparison semantics, recurrence classes, and the positive-pattern / remediation standards.

## Twelve required sections (in order, frozen)

1. Scope and provenance
2. Executive summary
3. Baseline comparison
4. Findings
5. Recurrence ledger
6. Telemetry gaps
7. Remediation options
8. Performance analysis
9. Workflow and process improvements
10. Report-only advisories (0680 R5)
11. Positive patterns
12. Evidence ledger

These names are consumed verbatim by 0659's structure gate and 0660's validation stage. Do not
rename, reorder, omit, or restate them.

## Closed category vocabulary (frozen)

- Categories: `reliability` | `repetition` | `workflow` | `performance` | `coverage` |
  `telemetry` | `positive`.

Every finding's category is drawn from this closed set. No category is invented — explicit
`category` values outside it fail the structure gate (`finding-invalid-category:<value>`), and so
do stable keys whose first segment falls outside it (`finding-invalid-key-category:<value>`,
task 0686). Environment-lens retro category names are encoded only in `<signal>` or the
owner-surface segment — never as a category. The authoritative seven-name projection table lives
in the [environment-improvement mapping](../../../references/environment-lens.md), which this
reference defers to rather than restates.

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
| `severity` | Closed vocabulary `P1` / `P2` / `P3` — how much the finding matters. Orthogonal to `confidence`: severity orders work, confidence says how sure we are (0680 R1). The structure gate fails a finding without one. |
| `reproCommand` | The invocation that reproduces the observation — one command a reader can run verbatim (0680 R2). Gate-enforced. |
| `ownerSurface` | The concrete surface that owns the fix (a file path, package, or command), consistent with the key's `<owner-surface>` segment but named as a target rather than a slug (0680 R3). Gate-enforced. |

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

### Remediation handoff route (0680 R4)

For each proposal an operator accepts, the report supplies — printed in the report itself, never
executed — the `spur task create` invocation that lands it, carrying the proposal's finding
`key` in the task body so the next report classifies that finding as `resolved`. Auto-writing
to the task corpus from a model-authored report would bypass the CLI-gated write contract; the
operator remains the gate.

### Report-only advisories (0680 R5)

Section 10 is the standing home for observations that inform workflow hygiene but must never
trigger automatic interruption: repeated identical tool-and-argument signatures are surfaced
here with their repetition counts, proposing at most human-decided process changes. Nothing in
this section may drive automated behavior.

### Run-cost reporting (0680 R6)

Performance analysis states what the run itself cost: per-pairing `totalCostUsd` /
`meanDurationMs` figures flow from the pairing analytics fold (0679 repaired the payload
paths), so chained `agent.run` stages are reportable instead of "~unknown". Where no cost
signal exists for a pairing it renders `not available`, never zero.

## Projected candidates — section 9 (environment lens, task 0686)

Section 9 (Workflow and process improvements) stays additive report grammar: unprojected numbered
prose remains valid and gains no required fields. A candidate **projected** through the
[environment-improvement lens](../../../references/environment-lens.md) is a bullet beginning with
a backticked stable key (retro name in `<signal>` or owner surface, closed category first — e.g.
`workflow:agents-md:navigation`) and carries four bold fields, the same names remediation options
use:

```text
- `workflow:agents-md:navigation` — **owner surface:** `AGENTS.md` see_also. **expected impact:**
  shorter file hunt. **verification method:** subsequent daily report key `resolved` or absent.
  **reversibility:** revert the pointer.
```

A projected candidate cites its section-4 finding `key` when one exists. Reports remain
proposal-only: no applied change, no diff, and no command the report claims to have run.

## Evidence ledger

The final section lists, for every finding, the artifact anchor(s) and any cited `file:line`,
so a reader can verify the report's claims against the evidence plane.

## Truthfulness invariants

- `not available` is the true rendering for an unsupported dimension, never a masked gap.
- `not comparable` is the true rendering for an unsupported comparison, never a computed delta.
- No bounded leaderboard length is presented as a population total (see 0657 / ADR-080: the
  coverage section reads `artifact.population` and renders `top N of M`).
