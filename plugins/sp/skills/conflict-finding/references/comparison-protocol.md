---
name: comparison-protocol
description: "Four-pillar inventory, candidate graph construction, within-pillar and cross-pillar audit protocol, and token/cost controls for sp:conflict-finding."
see_also:
  - conflict-finding
  - spur-cli
  - spur-dev
  - doc-evolve
  - code-verification
---

# Comparison protocol — inventories, subject clustering, and token controls

This file is the SSOT for **Design §4 steps 4–8** of task 0486 (inventory → candidate graph →
within-pillar audit → cross-pillar audit → classify-and-challenge) and **Design §6** (token and cost
controls), satisfying Requirements **R4** (cross-pillar comparison with reproducible anchors and no
all-pairs explosion) and **R5** (honest, token-aware scan protocol with freshness-verifiable context
reuse). Authority reasoning itself lives in
[authority-resolution.md](authority-resolution.md); finding shapes and evidence rules live in
[finding-contract.md](finding-contract.md); repair routing lives in
[remediation-routing.md](remediation-routing.md). Skill entry point: [../SKILL.md](../SKILL.md).

**Governing principle:** the audit is _subject- and claim-driven_, never _text-driven_ and never
_file-vs-file_. The hard problem is deciding which artifacts are semantically related to the same
subject + claim type, then comparing only those — not computing a similarity over every pair in the
corpus.

## Four-pillar inventory (Design §4 step 4)

Discovery materializes an **inventory** of exactly the selected pillars. Every inventory entry is a
row with six mandatory fields. An entry records **what was found and how fresh it is** — absence of
an _optional_ file is a reported fact, not an error, but a _selected_ pillar that produced no
entries is never silently dropped.

| Pillar      | Identity                                                     | Path                          | Anchor                               | Provenance / freshness                  | Scan status                       |
| ----------- | ------------------------------------------------------------ | ----------------------------- | ------------------------------------ | --------------------------------------- | --------------------------------- |
| `source`    | module / symbol / command / flag / DTO / schema / config key | repo-relative file            | symbol, heading, line, command name  | git commit/date, blame, change cone     | `scanned` / `sampled` / `skipped` |
| `tasks`     | WBS id, task file id                                         | `docs/tasks3/<wbs>_<slug>.md` | WBS number, Requirement/AC heading   | `git log` mtime, spur lifecycle verdict | `scanned` / `sampled` / `skipped` |
| `features`  | feature id (e.g. `H11`)                                      | feature file path             | feature id, AC title, status section | git mtime, feature-tree status          | `scanned` / `sampled` / `skipped` |
| `authority` | document id (e.g. `00_ADR`, `99_CONSTITUTION`)               | `AGENTS.md`, `docs/0*.md`     | heading, ADR entry, decision id      | git mtime, last-touched commit          | `scanned` / `sampled` / `skipped` |

Rules:

1. **Optional absence is reported, not fatal.** An authority set is `AGENTS.md`,
   `docs/00_ADR.md`, `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`,
   `docs/05_FEATURES.md`, `docs/99_PROJECT_CONSTITUTION.md` _when present_. A missing optional file
   yields an inventory row with scan status `absent` and does not block the audit.
2. **A selected pillar is never silently omitted.** If `--pillar tasks` yields no entries, that is
   itself a finding (an empty/absent pillar) with an explicit inventory row — never a gap in the
   report.
3. **Anchors must be stable and real.** Unavailable line numbers are replaced by a stable
   structural anchor — heading, symbol, WBS number, feature id, command name, ADR entry. Anchors are
   **never fabricated**: if no anchor is verifiable, the entry records `anchor: unavailable` with an
   explicit note rather than inventing one.
4. **Freshness is provenance, not presence.** Every entry carries how the fact was obtained (git
   mtime, blame, `spur … --json`, `rg` hit line) so the reader can judge whether the entry can be
   reused or must be re-read.

## Building the candidate graph (Design §4 step 5)

The candidate graph is the set of **semantically related subject pairs** to compare. It is built
from _explicit_ links and _shared identifiers_ — never from an unbounded all-pairs comparison.

Join keys, in priority order:

| Key                        | Source → target                                              | Example                                              |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Explicit links             | markdown links / cross-refs between artifacts                | task file links a feature id; doc cites an ADR entry |
| WBS / feature ids          | `0486`, `H11`                                                | task ↔ task deps, feature tree rollup, doc scope     |
| Dependencies               | declared deps in task/feature                                | task depends-on another task                         |
| AC titles                  | acceptance-criteria titles shared between task/feature       | feature AC title repeated in task AC                 |
| Paths                      | same file or dir referenced in multiple pillars              | `docs/04_DESIGN.md` mentioned in task Solution       |
| Symbols / commands / flags | same symbol, command, flag name                              | `dev-find-conflict`, `--resolve`                     |
| DTO / schema / config keys | same key name across config + source + docs                  | `--pillar`, a config field                           |
| Normalized domain terms    | a normalized term (case/plural-insensitive) shared by claims | `authority`, `freshness`, `coverage`                 |

Construction protocol:

1. **Seed from scope.** If `<scope>` is a path/WBS/feature-id/symbol/command/config-key, seed the
   graph with every artifact whose identity or content references that scope.
2. **Grow by shared keys.** For each seed, add an edge to any artifact sharing one of the keys
   above for the _same subject_. A key matches only when it refers to the same subject, not merely
   the same string in an unrelated context (see normalize).
3. **Normalize before matching.** Domain terms are matched after lowercasing and plural/case
   folding (e.g. `AC`/`ac`, `WBS`/`wbs`); identifiers (`0486`, `H11`) and paths are matched
   verbatim. Do not fuzzy-match identifiers.
4. **Bound the graph.** The graph is the union of seed-reachable edges. Artifacts that share no key
   and are not seed-reachable are excluded. **An unbounded all-pairs comparison is explicitly
   forbidden** — if a scope would touch every artifact, that is a _coverage_ concern, not license to
   compare everything.
5. **Record edge provenance.** Each edge records which key(s) joined it so the candidate set is
   reproducible (a reviewer can rerun the join and get the same pairs).

## Within-pillar audit (Design §4 step 6)

For each pillar, compare only claims that share a subject within the pillar.

### Source code (`--pillar source`)

| Claim cluster               | Compare                                                         | Conflict types       |
| --------------------------- | --------------------------------------------------------------- | -------------------- |
| contracts / implementations | exported signature vs body; interface vs impl                   | contradiction, stale |
| tests                       | test expectation vs implementation                              | contradiction, stale |
| config / registrations      | config key vs parser; registered command/flag vs parsed surface | omission, orphan     |
| symbols / commands          | command wrapper vs its delegation target                        | stale, duplicate     |

### Task files (`--pillar tasks`)

| Claim cluster     | Compare                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| requirements / AC | Requirement vs AC text; AC title vs body                                      |
| dependencies      | declared dependency vs referenced WBS existing                                |
| status / solution | `status` field vs what Solution/Testing describe; lifecycle verdict vs status |
| orphans           | task whose parent feature is gone, or WBS referenced nowhere                  |

### Feature files (`--pillar features`)

| Claim cluster | Compare                                                       |
| ------------- | ------------------------------------------------------------- |
| hierarchy     | child feature id vs parent references                         |
| AC / status   | AC titles vs status section; index projection vs actual files |
| orphans       | feature referenced by no task and no doc                      |

### Authority files (`--pillar authority`)

| Claim cluster    | Compare                                      |
| ---------------- | -------------------------------------------- |
| ownership        | who owns a subject vs who is referenced      |
| decision / scope | ADR decision vs its scope statement          |
| process          | process rule vs referenced workflow/template |

Within-pillar finding rules: a claim must have **at least two opposing anchors** for
contradiction/stale. Low-confidence differences become candidates, never definitive conflicts (see
[finding-contract.md](finding-contract.md)).

## Cross-pillar audit (Design §4 step 7)

Audit every boundary applicable to the selected scope. Default scope (`all`) audits all six:

| Boundary            | What is compared                            | Typical conflict                                |
| ------------------- | ------------------------------------------- | ----------------------------------------------- |
| source ↔ task       | task AC/requirements vs implemented surface | stale projection (code shipped, task says todo) |
| source ↔ feature    | feature AC vs shipped surface               | feature AC unmet or over-shipped                |
| source ↔ authority  | authority "should" vs source "is"           | architecture/design doc vs module topology      |
| task ↔ feature      | task AC/deps vs feature AC/status           | AC mismatch, orphan task                        |
| task ↔ authority    | task obligation vs PRD/ADR scope            | task outside documented scope                   |
| feature ↔ authority | feature goal vs PRD/ADR bounds              | feature contradicts PRD non-goal                |

Per-boundary protocol:

1. Restrict to candidate-graph edges that cross the two pillars.
2. For each edge, resolve the **normative authority** and **observed reality** for the _subject +
   claim type_ (authority matrix: [authority-resolution.md](authority-resolution.md)).
3. Compare only **comparable** claims. Incomparable, missing, or ambiguous authority yields an
   unresolved `needs-authority-decision` item — never a forced winner.
4. Emit reproducible anchors from **both** sides (at least two opposing anchors for
   contradiction/stale).

## Classify and challenge (Design §4 step 8)

Before asserting any candidate as a conflict, run the **four-challenge filter**. A candidate that
survives all applicable challenges is a real finding; one explained by any challenge is not a
conflict (or is a _different_ conflict type).

| Challenge               | Question                                                                                              | If true                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| Lifecycle               | Is the difference planned work (todo task/feature whose lifecycle says not-yet-done)?                 | Not a conflict — planned work |
| Supersession            | Is one artifact superseded (accepted ADR beats derived doc; superseded ADR is historical)?            | Not a conflict — supersession |
| Abstraction-level       | Is the difference merely a different level of abstraction (design doc generalizes, code specializes)? | Not a conflict                |
| Intentional deprecation | Is one side explicitly marked deprecated / intentionally divergent?                                   | Not a conflict — intentional  |

Rules:

1. **Mere wording or abstraction-level difference is NOT a conflict.** Only
   `contradiction`, `stale`, `duplicate`, `omission`, `orphan`, or `ambiguous-authority` supported by
   evidence counts.
2. **A todo task/feature differing from current code is planned work**, not stale code, unless its
   lifecycle or supersession metadata says otherwise.
3. **Challenge before classify, then classify exactly.** Run the challenges first; only survivors
   get a conflict type and severity/confidence.
4. **Never promote.** A low-confidence candidate stays a candidate or unresolved item; it is never
   promoted to a definitive conflict (see [finding-contract.md](finding-contract.md)).
5. **Every asserted finding names the challenge that failed** in its false-positive check, so the
   reader sees why lifecycle/supersession/abstraction/deprecation did not excuse it.

## Token and cost controls (Design §6)

The audit is **token-aware**: it reads the minimum to be honest, and it reports what it did not
read. It never claims comprehensiveness it cannot defend.

### Read order (cheap first)

1. **Authority rules and indexes first.** Read `AGENTS.md`, `docs/99_PROJECT_CONSTITUTION.md`, and
   any reusable index (`.spur/context/anatomy.md`, task/feature metadata) before any full artifact.
   These establish the claim-specific authority matrix and the candidate seed set without opening
   bodies.
2. **Deterministic discovery, batched.** Batch `git`, `rg`, `spur task/feature … --json`, relevant
   `spur … check`, and `sp:doc-evolve` audit surfaces into as few calls as possible. Retain results
   in a compact **in-memory evidence manifest** for the run — never persist it.

   > **`rg` skips dot-directories and ignored paths by default.** A bare `rg <pattern> .` will not
   > search `.spur/context/`, `.github/`, or anything matched by `.gitignore`, and returns **no
   > hits** rather than an error — a silent false negative that reads exactly like a clean boundary.
   > When the scan must cover indexed context, dotted config, or ignored trees, use `rg -uu`
   > (or `--hidden --no-ignore`) and say which you used. A "no conflicts found" result produced by a
   > default-scoped `rg` over a dotted path is not evidence of absence, and must not be reported as
   > a cleared boundary.

3. **Open full artifacts only for candidate subjects.** A file is read in full only when it is a
   seed or a candidate-graph subject that survived the classify-challenge filter (or when coverage
   demands it). Non-candidates are inventoried by metadata, not read.

### Adaptive vs full mode

| Mode                 | Behavior                                                                                                                                                                                                                                                       | Coverage guarantee                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `adaptive` (default) | Always scan the complete authority/task/feature metadata surfaces needed for traceability; narrow source reads to the Git change cone and linked symbols. Reuse `.spur/context/` **only** when freshness + provenance are verifiable against the current tree. | Disclosed change cone + skipped areas; `complete` only when defensible |
| `full`               | Cold comprehensive scan; no reuse of indexed context; read every selected-pillar artifact needed to establish completeness.                                                                                                                                    | Intended `complete: true` unless a tool fails                          |

Adaptive reuse decision:

1. **Verify provenance.** The `.spur/context/` artifact must state its source tree (paths, commit,
   or mtime) and that source must match the current tree.
2. **Verify freshness.** Compare the artifact's recorded freshness against current git state. If any
   authority/task/feature metadata it relies on is newer, the reused index is **stale**.
3. **Verify the change cone.** In adaptive mode, always scan the full authority/task/feature
   metadata surfaces; only _source_ reads are narrowed to the change cone. If the cone is empty or
   unverifiable, escalate to the full source scan.
4. **Degrade honestly.** Absent, stale, or unverifiable context → **cold full scan** **or** an
   **explicit incomplete-coverage result**. Never silent omission. When links are missing, context
   is stale, or coverage cannot be defended, escalate to the full scan.

### Reporting cost and coverage

The report (Markdown and `--json`) records:

- **Files inspected / skipped** per pillar, with skip reasons.
- **Claims inspected / skipped** (candidate edges examined vs left unexamined).
- **Tokens** (estimated) consumed by reads.
- **Change cone** (in adaptive mode): which paths were narrowed.
- **Reused context**: which `.spur/context/` artifact, and the provenance/freshness evidence.
- **`coverage.complete`**: `true` only when every selected pillar was scanned without a tool failure
  that prevented coverage.

Rules:

1. **Do not claim "comprehensive" when `coverage.complete` is false.** If a tool failed, coverage is
   degraded and reported in `errors` (tool failure is distinct from semantic uncertainty).
2. **Tool failures are coverage evidence, not silence.** A failing `git`/`rg`/`spur` call is
   recorded; the affected pillar's scan status is `skipped` with the reason, and `coverage.complete`
   reflects it.
3. **No hidden state.** Adaptive reuse is a read of an existing `.spur/context/` artifact; the audit
   itself creates no persistent cache, database, vector index, embedding pipeline, background
   daemon, or custom parser in v1. The in-memory evidence manifest dies with the run.

## Anti-patterns and boundaries

| Anti-pattern                                              | Correct behavior                                                |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| Unbounded all-pairs comparison                            | Compare only candidate-graph edges joined by explicit keys      |
| Asserting conflict from wording alone                     | Run the four-challenge filter; only evidence-backed types count |
| Forcing ambiguous authority through a global ranking      | Emit unresolved `needs-authority-decision` HITL item            |
| Silently omitting a selected pillar or a tool failure     | Record scan status `absent`/`skipped` and degrade coverage      |
| Claiming "comprehensive" with `coverage.complete=false`   | Report incomplete coverage explicitly                           |
| Reusing any context without freshness/provenance check    | Verify provenance+freshness against the current tree or degrade |
| Reading full artifacts for non-candidates                 | Open full files only for candidates / coverage demands          |
| Fabricating a line-number anchor                          | Use a stable structural anchor or `anchor: unavailable`         |
| Creating persistent cache / index / daemon / parser in v1 | Keep the in-memory evidence manifest run-local only             |

## Related

- Skill entry: [../SKILL.md](../SKILL.md)
- Authority matrix and ambiguity protocol: [authority-resolution.md](authority-resolution.md)
- Finding schema, severity, confidence, coverage: [finding-contract.md](finding-contract.md)
- Confirmed repair routing and freshness recheck: [remediation-routing.md](remediation-routing.md)
- Deterministic discovery: `spur task … --json`, `spur feature … --json`, `sp:spur-cli`,
  `sp:spur-dev`, `sp:doc-evolve`, `sp:code-verification`
