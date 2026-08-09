---
name: remediation-routing
description: "Confirmed, owner-routed remediation for sp:conflict-finding — audit-mode write guard, --resolve proposal/confirmation workflow, freshness revalidation, owner routing table, partial-failure and idempotency semantics."
see_also:
  - conflict-finding
---

# Remediation routing — confirmed, owner-routed repair

`sp:conflict-finding` is, first and foremost, an **audit** capability. Remediation is a separate,
opt-in, gated workflow. This file is the SSOT for *when a write is allowed*, *who may perform it*,
*how the operator confirms it*, and *what happens when a repair fails midway*.

The governing rule, carried through everything below: **no mutation in audit mode, and no automatic
mutation merely because `--resolve` is present.** Every write requires (a) a presented repair set,
(b) explicit operator confirmation, (c) a freshness revalidation of the supporting evidence, and
(d) dispatch through the artifact owner's verified harness surface. Ambiguity or partial failure is
reported, never silently continued.

## Core invariants

| Invariant | Guarantee |
|-----------|-----------|
| Audit mode is read-only | Without `--resolve`, no source, corpus (task/feature), or numbered-document mutation of any kind. |
| `--resolve` is not a write | It only *opens* the proposal → confirmation → owner-routed workflow. It never authorizes automatic repair. |
| Confirmation precedes every write | No repair executes until the operator explicitly approves the specific proposed repair set. |
| Freshness precedes mutation | The supporting evidence anchors are re-read and compared against the finding's fingerprint before any write. |
| Owner surface, not raw edits | Each approved repair routes through the artifact's owner (Spur CLI, `sp:doc-evolve`, Spur dev lifecycle, Superskill lifecycle) — never a direct file write where an owner surface exists. |
| Idempotent and partial-failure aware | Already-matching artifacts resolve without a write; one repair's failure neither marks others successful nor silently rolls forward. |

## 1. Audit mode — the read-only guarantee

Without `--resolve`, the run performs **no mutation** of:

- **Source** — implementations, contracts, tests, config, registrations.
- **Corpus** — task files and feature files.
- **Numbered docs and projections** — `docs/00`–`05`, `docs/99_PROJECT_CONSTITUTION.md`, and
  `AGENTS.md` / template projections.

Everything the audit produces — findings, evidence, authority provenance, coverage, unresolved
items, proposed repairs, recommended owner — is an **envelope**, not a change. The report may
describe what *would* be repaired and by whom, but nothing is applied.

The only permitted writes in audit mode are transient and internal (temp files for composing a
repair payload, `.spur/context/` note files when the operator explicitly opts into indexed-context
reuse). These never touch governed artifacts.

## 2. The `--resolve` workflow — proposal, confirm, revalidate, route

`--resolve` changes one thing: it enables the remediation workflow. It does **not** change the
write guard. The full workflow is:

```text
--resolve
  → 1. PRESENT REPAIR SET   enumerate proposed repairs keyed by finding ID + evidence fingerprint,
                            each with repair_owner and the owner surface that will apply it
  → 2. OBTAIN CONFIRMATION  operator explicitly approves the selected set (or a subset, or none)
  → 3. REVALIDATE FRESHNESS re-read each artifact anchor; compare against the finding fingerprint;
                            stale anchors return to audit (see §4)
  → 4. ROUTE BY OWNER       dispatch each approved repair through its owner surface (§3)
  → 5. REPORT OUTCOMES      completed / failed / untouched sets; never silently roll forward (§5)
```

### 2.1 Present the repair set

Before anything is applied, present a complete, itemized repair set. Each item is keyed by its
finding `id` plus an **evidence fingerprint** — a stable digest of the artifact anchors (path +
line/heading/symbol/WBS/feature ID) and the claim paraphrase that the finding was built on. The
fingerprint lets the workflow detect that the world changed between audit and remediation.

Each proposed item states:

- **Finding ID** — links back to the audit report.
- **Claim type + conflict type** — e.g. `stale` / `source↔authority`.
- **Artifact(s) to change** — exact path and anchor.
- **Repair owner + surface** — the owner and the exact command/skill that will apply it (§3).
- **Proposed change** — the concrete edit the owner surface is expected to perform.

Nothing in §2.1 is a mutation; it is a proposal. Only the confirmed subset in §2.2 proceeds.

### 2.2 Obtain explicit confirmation

The operator must explicitly approve the repair set — in whole, in part, or decline. Confirmation
is:

- **Explicit** — a clear affirmative ("yes", "apply these N", selection of specific findings), never
  inferred from the mere presence of `--resolve`.
- **Per-set** — the operator confirms the specific artifacts and changes presented, not a blanket
  "fix everything."
- **Recorded** — the chosen subset (approved / declined / deferred) is carried into the
  remediation report so the audit trail shows exactly what was authorized.

A declined or deferred repair is left **untouched** and reported as such; it is not re-attempted
implicitly in the same run.

### 2.3 Revalidate evidence freshness

Between the audit and any write, the world may have changed. Immediately before dispatching each
approved repair:

1. Re-read the artifact at the anchor the finding recorded.
2. Recompute (or re-compare) the evidence fingerprint.
3. If the anchor content still matches the fingerprint → proceed to route.
4. If the anchor has moved, the text changed, the file was deleted, or the referenced symbol/WBS/AC
   no longer resolves → mark the item `stale-evidence` and **return to audit**. Do not "repair" a
   stale finding on hunches; re-run the relevant audit step to re-establish evidence.

Freshness is per-finding, checked at dispatch time — not once up front. This is what closes the gap
between "the audit said X" and "the file now says Y."

## 3. Owner routing table

Each approved repair is dispatched through the artifact's **owner surface** — the harness path that
owns writes to that artifact — not a direct file write. Authority for a repair is the same
authority model as the audit ([./authority-resolution.md](./authority-resolution.md)): for a given
subject + claim type, one artifact is normative; derived projections are updated only after their
authority.

| Owner | Repair route | Never |
|-------|--------------|-------|
| Task/feature corpus | `sp:spur-cli` — `spur task` / `spur feature` (with `--section`, `--from-file`, `--json` as needed) | Direct file writes to task/feature files. |
| Numbered docs and AGENTS projections | `sp:doc-evolve` — **authority first, derived projections second** (see below) | Editing `docs/05_FEATURES.md` or an `AGENTS.md` projection before its authoritative source is fixed. |
| Source / tests | Create or use a **Spur task** and route through `sp:spur-dev` / build competencies (`sp:code-implementation`, `sp:code-testing`), **unless** the active session already has explicit implementation authority for the change. | Bare in-place edits to source/tests without a task or explicit authority. |
| Command/skill capability source | Superskill command/skill **lifecycle** (`superskill command …` / `superskill skill …` scaffold/validate/evaluate/refine) in the owning plugin source. | Hand-editing capability source outside the Superskill lifecycle. |
| Ambiguous authority | **Stop for an operator decision.** Do not mutate either side. | Choosing a winner, editing both sides, or forcing a global ranking. |

### 3.1 Task/feature corpus

Corpus writes go through Spur CLI verbs — `spur task` / `spur feature` with the appropriate
sub-verb (`update`, `--section`, `--from-file`, `--json`). This keeps task/feature files under the
harness's write-guard and section/schema contracts. Never `Write`/`Edit` a task or feature file
directly; the corpus is CLI-gated.

**`--section` is not addressable at every heading level.** It resolves **`##` sections in feature
files** and **`###` sections in task files**. A repair proposing `--section Tasks` against a feature
whose roster sits at `###` fails with `does not contain section` and lists the `##` headings it did
find. Before proposing a section-scoped repair, confirm the target heading exists **at the
addressable level** — `spur feature show <id> --json` / `spur task show <wbs> --json` enumerate what
is actually addressable. When the content is a subsection, the repair is either the enclosing `##`
section (which rewrites the whole body, so weigh it against blast radius and any load-bearing
evidence inside) or a different owner verb; do not silently widen the write to make the flag fit.

**Frontmatter is validated before the write.** `spur task update` rejects the whole operation when
required frontmatter (`schema_version`, `created_at`, `updated_at`, a valid `status` enum) is
missing — the file is left byte-identical. That is an **owner-surface failure**, not
`stale-evidence`: the finding stands and stays re-dispatchable. Report it as `failed` and stop that
item; never route around it with a direct write.

### 3.2 Numbered docs and AGENTS projections

Documentation repairs follow **authority first, derived projections second**. If a derived
projection (`docs/04_DESIGN.md`, `docs/05_FEATURES.md`, `AGENTS.md`, templates) has drifted from its
authority (`docs/00_ADR.md`, `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`,
`docs/99_PROJECT_CONSTITUTION.md`), the repair fixes the **authority** first, then re-derives the
projection via `sp:doc-evolve`. Editing a projection without its authority is a prohibited
anti-pattern (see §6).

`sp:doc-evolve` owns the numbered-doc/projection lifecycle: sync checks, contract verification,
frontmatter checks, and derived-doc refresh. A doc repair is dispatched to it; it is not hand-applied.

### 3.3 Source / tests

Source and test repairs are **real implementation work**. By default they are dispatched as a Spur
task routed through `sp:spur-dev` and the build competencies (`sp:code-implementation`,
`sp:code-testing`) — so the change gets a Requirements/AC envelope, a lifecycle, and verification.

The one exception: if the **active session already has explicit implementation authority** for the
change (e.g. the operator is already inside a task implementation, or explicitly delegated the
source edit), the repair may be applied directly in that session. When in doubt, prefer the Spur
task route.

### 3.4 Command/skill capability source

A repair to a command or skill's own source (the capability being audited) goes through the
**Superskill lifecycle** in the owning plugin source — `superskill command …` / `superskill skill …`
for scaffold/validate/evaluate/refine. This keeps capability artifacts canonical and validated.
Do not commit generated per-platform adapters.

### 3.5 Ambiguous authority

If routing cannot determine an owner — authority is ambiguous, incomparable, or missing for the
subject + claim type — the workflow **stops for an operator decision**. It does not pick a winner,
does not edit both sides, and does not fall back to a global ranking. The item remains
`needs-authority-decision` (or `stale-evidence`/`unresolved` as appropriate) and is reported as
untouched.

## 4. Repairs keyed by finding ID + evidence fingerprint

Every repair in the set is keyed by two things:

- **Finding `id`** — the stable identifier from the audit report.
- **Evidence fingerprint** — the digest of the anchors (path + line/heading/symbol/WBS/feature ID)
  and the claim paraphrase the finding rests on.

This key drives the freshness check (§2.3) and the outcome bookkeeping (§5). Concretely:

| Condition at dispatch | Outcome |
|-----------------------|---------|
| Anchor content matches the fingerprint | Route the repair through its owner surface. |
| Anchors changed (moved, edited, deleted; symbol/WBS/AC gone) | Mark `stale-evidence`, **return to audit** — re-run the affected audit step to re-establish evidence before any further repair. |
| Artifact already matches the proposed outcome | **Resolved without a write** (idempotent). The finding is marked `resolved`; no mutation occurs. |
| Owner surface reports a failure | Mark the item `failed`; do not mark siblings successful or roll forward (§5). |

### 4.1 Idempotent resolution

If, at dispatch time, the artifact already matches the repair's target state — the drift was already
fixed by someone else, or the finding was stale in the "no longer wrong" direction — the item is
**resolved without a write**. Idempotency is an explicit outcome, not an accident: the workflow
recognizes "already correct" and records it as `resolved` rather than re-applying a no-op edit or
worse, applying an edit that re-introduces a conflict.

## 5. Partial failure, retry, and outcome reporting

Remediation is **per-item**, not all-or-nothing. A failure in one repair:

- Does **not** mark other repairs successful.
- Does **not** silently roll forward to the remaining repairs as if nothing happened.
- Is **reported** as a distinct outcome.

The final remediation report always separates the outcome sets:

| Set | Meaning |
|-----|---------|
| **Completed** | Owner surface confirmed the repair applied (or artifact already matched — idempotent `resolved`). |
| **Failed** | The owner surface rejected/errored, or dispatch could not complete. |
| **Untouched** | Declined/deferred by the operator, or blocked on `stale-evidence` / `needs-authority-decision`. |

These sets are mutually exclusive and together account for every item in the approved set. The
report surfaces the exact failed items and the reason, so the operator can decide to retry — in a
fresh run with re-validated evidence — rather than being told, or assuming, that everything was
applied.

### 5.1 Retry

Retry is the operator's decision after reading the failed set. The workflow never auto-retries
within a run; it stops, reports, and lets the operator re-invoke with a fresh audit (and thus a
fresh freshness check). A retry must revalidate evidence rather than blindly re-attempting the same
stale repair.

## 6. Anti-patterns

These are the explicit boundaries for remediation. Each is a hard violation, not a style choice.

| Anti-pattern | Why it is prohibited |
|--------------|----------------------|
| **Automatic mutation merely because `--resolve` is present** | `--resolve` only opens the workflow; it never authorizes automatic repair. Confirmation + freshness + owner surface are all required. |
| **Editing a derived projection before its authority** | A projection (`docs/04`/`docs/05`, `AGENTS.md`, templates) is not the source of truth; fixing it without its authority (`ADR`/`PRD`/constitution) leaves the real conflict in place. Authority first. |
| **Broad cleanup outside confirmed findings** | Only the artifacts named by confirmed, freshness-checked findings are touched. No opportunistic refactors or doc "improvements" while repairing. |
| **Ambiguity silently resolved** | Ambiguous/missing authority stops for an operator decision; it is never forced through a global ranking or a guessed owner. |
| **Partial failure silently continued** | A failed repair is reported, not papered over; siblings are not marked successful and the run does not roll forward silently. |
| **Direct corpus writes** | Task/feature files are CLI-gated (`spur task`/`spur feature`); never raw `Write`/`Edit`. |
| **Direct numbered-doc or capability edits** | Numbered-doc/projection writes go through `sp:doc-evolve`; capability source through the Superskill lifecycle. |
| **Source edits without authority** | Source/test repairs default to a Spur task + dev lifecycle unless the active session already has explicit implementation authority. |
| **Repairing stale evidence** | Changed anchors return to audit; never "repair" a finding whose evidence is no longer current. |

## 7. Checklist — safe remediation

Before dispatching any write, confirm each of the following:

- [ ] Audit mode performed **no** governed mutation; the report is a pure envelope.
- [ ] `--resolve` was present, and the **repair set was presented** (keyed by finding ID + fingerprint).
- [ ] The operator **explicitly confirmed** the specific selected repair set.
- [ ] Evidence **freshness revalidated** per finding at dispatch; `stale-evidence` items returned to audit.
- [ ] Each approved repair routed through its **owner surface** (§3), never a raw write where an owner exists.
- [ ] **Idempotent** already-matching items marked `resolved` without a write.
- [ ] **Completed / failed / untouched** sets reported; failures surfaced, not silently continued.
- [ ] Ambiguous authority **stopped for an operator decision**; neither side mutated.
- [ ] No broad cleanup outside confirmed findings.

## Related

- Skill entry: [../SKILL.md](../SKILL.md) (Step 10 — Remediate)
- Authority model and ambiguity protocol: [./authority-resolution.md](./authority-resolution.md)
- Finding schema, status values, and evidence rules: [./finding-contract.md](./finding-contract.md)
- Comparison and candidate-graph construction: [./comparison-protocol.md](./comparison-protocol.md)
- Owner surfaces: `sp:spur-cli`, `sp:spur-dev`, `sp:doc-evolve`
