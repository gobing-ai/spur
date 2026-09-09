---
name: Project Constitution
doc: 99_PROJECT_CONSTITUTION
owns: PROCESS — how the key files are maintained
authority: authoritative-on-process
version: 1.6.0
created_at: {{init-date}}
updated_at: {{init-date}}
edit_rules: 99 §6.8
sync: [T7]
read_before: editing key project documents
---

# Project Constitution — How to Organize the Project

## 1. What this is & what this is not

This file defines document responsibilities, authority, edit rules, and synchronization.
It is stable project metadata. Product facts, implementation guidance, task outcomes, review
reports, and accumulated lessons belong elsewhere (§4.2, §8).

The same responsibilities apply to new-project templates. Project tool bindings belong in
`AGENTS.md`; this constitution does not require unrelated repositories to be byte-identical.

## 2. Authority model

Host instructions and the operator's request retain their native precedence.
Within project documentation, authority is scoped to the question:

| Question | Owner |
| --- | --- |
| Architectural choice and its rationale | `00_ADR` |
| Product intent and scope | `01_PRD` |
| Document responsibilities and maintenance | This constitution |
| Visual and interaction design | Root `DESIGN.md`, when present |
| Delivery sequence, current mechanisms, non-UI contracts, feature state | `02`–`05`, derived within their respective responsibilities |

Lower numbers win content conflicts within the same subject; `99` governs maintenance across
all key files. Neither an ADR nor a task can silently change the constitution. An ADR is not
a universal override for unrelated scope or UI facts. Fix the authoritative statement first,
then affected projections; never average conflicting statements. Keep document numbers stable.

## 3. Shared tools

Use the configured domain tools for records they own. Tasks, feature files, and generated
indexes are tool-owned; never modify them with raw file writes. `AGENTS.md` names the project's
CLI bindings and gates. Skills explain how to operate them; they do not redefine this document map.

## 4. Common file layout

### 4.1 The doc map (canonical template)

| File | Owns | Excludes |
| --- | --- | --- |
| `AGENTS.md` | ENTRY — repo orientation, essential commands, constraints, and links to owners | Detailed designs, command catalogs, progress logs, duplicated runbooks |
| `DESIGN.md` (root, optional) | UI/UX — visual language, tokens, typography, components, layout, motion, accessibility, responsive behavior | CLI/API/schema contracts, delivery status, general agent instructions |
| `docs/00_ADR.md` | WHY — lasting architectural choices, context, alternatives/tradeoffs, consequences | Feature approvals, task updates, bugfix logs, verification receipts, implementation walkthroughs |
| `docs/01_PRD.md` | WHAT — product vision, users, principles, scope and exclusions | Delivery state, schedules, implementation details |
| `docs/02_ROADMAP.md` | WHEN — phase goals, sequence, dependencies, exit criteria | Per-task work logs, API details, repeated feature acceptance criteria |
| `docs/03_ARCHITECTURE.md` | HOW — current module boundaries, data flow, runtime, invariants | Command catalogs, schema dumps, task completion narratives |
| `docs/04_DESIGN.md` + `docs/design/` | SURFACE — index and detailed non-UI contracts: CLI, APIs, config, schemas, DTOs, boundary behavior | UI design rules, duplicated architecture, delivery receipts |
| `docs/05_FEATURES.md` + `docs/features/` | STATUS — entry to tool-owned feature decomposition, acceptance criteria, lifecycle state | A second manually maintained status ledger |
| `docs/99_PROJECT_CONSTITUTION.md` | PROCESS — responsibilities, authority, maintenance and synchronization of these files | Product decisions, tool catalogs, project history, routine lessons |

A fact has one owner. Link from other documents. A feature may change architecture, but its
size, approval, task count, or completion alone does not qualify it for an ADR (§6.1).

### 4.2 Working layers (outside the authority chain)

- Dated `docs/plans/` and `docs/reports/` files hold proposals, investigations, audits and evidence.
  They record work; accepted conclusions take effect only in their proper owner.
- Configured task folders hold requirements, implementation plans, results and verification,
  maintained through the task tool. Resolve their paths through that tool.
- Existing project context or learning storage holds reusable lessons (§8).
- `docs/design/` and `docs/features/` are governed detail layers (§4.5), not scratch storage.

Preserve historical evidence and its dates. It may be linked for provenance, but current
contracts must be understandable without treating an old plan or report as governing policy.

### 4.3 Standard frontmatter (the doc's machine-readable contract)

Numbered documents carry `doc`, `owns`, `authority`, `version`, `updated_at`, `read_before`,
`edit_rules`, and `sync`; derived documents also identify `derived_from`. Keep existing
owner/creation metadata. `edit_rules` points to §6; `sync` names applicable §5 trigger IDs.

Use `authoritative` for `00`, `authoritative-on-scope` for `01`,
`authoritative-on-process` for `99`, and `derived` for `02`–`05`.
`owns` must match §4.1 in meaning. Bump the minor version for substantive edits and refresh
`updated_at` when content changes. Do not touch unrelated documents just to update a date.
Keep one metadata block. Root entry/UI files may use their established native format.

### 4.4 AGENTS.md synchronization

Keep the responsibility map and essential repo instructions aligned with this constitution.
Update `AGENTS.md` only when its own facts or routing change. A new flag, finished task, or
unchanged governance contract does not require an entry-file edit.
Keep supported aliases such as `CLAUDE.md` and `GEMINI.md` pointing to the same entry;
do not maintain divergent copies. Propagate portable changes to the init templates in scope.

### 4.5 Index + satellite docs (`04`/`05` and their folders)

- `04` is a compact surface map pointing to `docs/design/<slug>.md`; detail lives in the satellite.
  Existing stable filenames remain valid. Prefer updating an existing owner over adding a duplicate.
- `05` points to the feature tool's generated index when it has one; otherwise the tool owns
  its generated region. Feature satellites and generated indexes remain CLI-gated.
- Update detail first. Update an index only if its pointer, title, or indexed state changes.
  An unchanged pointer needs no ceremonial edit. New satellites must be discoverable from the index.
- Preserve heading/ID references when condensing or moving detail. Retain a short forwarding
  section at a referenced old heading when callers cannot be migrated safely.

## 5. Sync triggers — same-commit obligations

Update the documents whose owned facts changed, in the same change. This table routes edits;
it does not require touching every key file for each feature or task.

| ID | Change | Required synchronization |
| --- | --- | --- |
| T1 | New architectural choice passing §6.1, or reversal | Record `00` before divergence; update affected `03`/`04`; `01` only if scope changes |
| T2 | Implementation would contradict an existing ADR | Record the decision amendment or superseding ADR before implementing the contradiction |
| T3 | CLI/API/config/schema/DTO or non-UI behavior changes | Update the owning `04` satellite; index and `AGENTS.md` only if their own facts change |
| T4 | Feature lifecycle or acceptance changes | Update through the feature tool and refresh its generated projection; `01` only for scope changes |
| T5 | Phase goal, order, dependency, or exit changes | Update `02`; task completion alone does not trigger a roadmap entry |
| T6 | Product scope added, removed, or deferred | Update `01`; `02` if sequencing changes |
| T7 | Authorized change to document responsibilities, authority, or maintenance rules | Update `99`, affected entry/routing instructions, and in-scope init templates |
| T8 | Multi-wave batch planned | Include the applicable document synchronization in the plan |
| T9 | Design/feature satellite added, moved, or its indexed facts changed | Detail first, then the affected index; features use their tool |
| T10 | Corpus checking policy added or tightened | Run focused policy tests and an explicit unsuppressed corpus audit; reconcile exposed failures without waivers or acceptance snapshots |
| T11 | Ordinary task/feature edits | Check affected records and required linked evidence; do not turn routine work into a corpus-wide audit |

UI design changes update root `DESIGN.md` or its owning UI reference. If the same change affects
non-UI contracts or system boundaries, apply T3 or T1 separately.

## 6. Edit principles per file

### 6.0 Writing rules (all key files)

Lead with the useful fact. Remove repeated rules, stale inventories, narration and redundant
examples. Prefer links to existing owners. Preserve stable IDs, meaningful qualifications,
security/accessibility requirements and evidence; brevity must not change semantics.
Do not append to a key file merely to prove work happened.

### 6.1 `docs/00_ADR.md`

Admit a decision only if it selects among meaningful alternatives and establishes or changes
a lasting architecture boundary or invariant across features/modules: dependency direction,
persistence ownership, trust model, protocol, runtime or shared execution model. Record the
choice, context/reason, material tradeoff/consequence, status/date, and a detail pointer.

Single-feature design, public-surface consent, task progress, test results and implementation
receipts go to their design/task records. Bug fixes that restore an existing contract need no ADR.
Doc-map and maintenance changes belong in `99`, not an ADR certifying a constitution edit.

- One architectural decision per entry. New choices append; reversals name the superseded ADR.
- Never renumber, reuse or delete an ADR ID. Preserve original titles/anchors and dates.
- Corrections to the decision use dated amendments; amendments record a decision delta only.
- Editorial condensation may remove repetition and misplaced detail while preserving the choice,
  rationale, material alternatives, consequences and amendment history. It must not silently
  reverse a decision or present a historical choice as current.
- For a historical entry that never qualified, retain its number/title/date as a short legacy
  record pointing to the proper owner. It is not precedent for new feature/task ADRs.
- Distinguish accepted design from implemented behavior; delivery evidence lives in the feature/task.
- Use the next free number. Keep existing skipped-number stubs; reserve `ADR-000` for admission
  guidance if the register already uses it.

### 6.2 `docs/01_PRD.md`

Keep vision, users, principles and capability-level scope. States are in, supporting, deferred
(with a reactivation condition), or out. Do not enumerate every flag or duplicate delivery
status; point to `04` and `05`. Link enforcement config rather than copying numeric gate values.

### 6.3 `docs/02_ROADMAP.md`

Keep phase goals, sequence/dependencies, coarse deliverables and explicit exits. Preserve phase
identities; insert sub-phases rather than renumbering. Use real deliverable names and concise
evidence links. Consolidate completed waves; task WBS lists and implementation receipts stay
in their records. Do not claim a phase complete from a subset of its exit checks.

### 6.4 `docs/03_ARCHITECTURE.md`

Describe current topology, ownership, data flow, runtime and enforceable invariants. Mark
unbuilt accepted designs explicitly. Keep mechanism and essential rationale; link exact shapes
to `04`. Replace obsolete mechanisms in place. Do not accumulate per-task shipment paragraphs.

### 6.5 `docs/04_DESIGN.md` + `docs/design/<slug>.md`

Keep the index short. Satellites own non-UI signatures, schemas, defaults, errors, compatibility
and boundary behavior. Verify against registrations/contracts; prefer generated artifacts to
manual copies. UI rules belong in root `DESIGN.md`; architectural rationale belongs in `00`/`03`.
Separate proposed from current behavior. A completed task adds no delivery receipt here.

### 6.6 `docs/05_FEATURES.md` + `docs/features/<feature-id>_<slug>.md`

Maintain one feature status source through its tool. `05` is an entry to that source, not a
parallel hand-written status table. Requirements, acceptance and decomposition live in feature
records; execution evidence lives in task records. Verify status and acceptance against evidence
before relying on them. Never raw-edit satellites or generated regions.

### 6.7 `AGENTS.md`

Keep essential orientation, commands, boundaries and document routing. Verify facts from the
repository; avoid volatile version/catalog duplication and detailed runbooks. Link to deeper
owners. Preserve critical operational constraints inline. An entry-file size gate, if configured,
belongs to repo tooling, not a universal claim about agent limits.

### 6.8 This file (`99`)

Change only for an operator-authorized correction to document responsibility, authority,
maintenance or synchronization. The change record must name the governance defect, the rule
changed, and affected files/templates. Existing authorization for that scope is sufficient.

Feature delivery, task closure, a test result, an ordinary lesson, or editing another key file
is not a reason to edit this file or bump its metadata. Keep implementation-specific gate commands
and tool bindings in their owners. Do not automatically promote lessons into constitutional rules.
Update authorized templates/copies; do not mutate unrelated repositories without authorization.

## 7. Drift control

Audit the affected owners, using source/help, manifests, Git diffs, generated indexes and links:

- Responsibility: content belongs to the file's §4.1 row; no competing ledger or rule owner.
- Reality: current contracts/mechanisms match source; proposed/historical content is labeled.
- Scope/status: `01` covers capabilities; phase/feature claims have current evidence.
- References: IDs, heading anchors, index pointers and aliases still resolve.
- Synchronization: apply §5 to changed facts; unchanged owners need no edit.
- Metadata/templates: contracts and dates match actual edits; portable guidance agrees.

Repair authority first, then affected detail/index/entry files. Record findings and verification
in the task or a dated report, including unverified claims. Do not claim a repository-wide audit
from focused checks. An ADR content reversal follows §6.1; editorial cleanup preserves history.

## 8. Lessons learned per file

Lessons live in existing project learning/context storage or a dated report, outside this
constitution. Deduplicate useful lessons and link their evidence. Routine completion logs stay
in tasks. Do not import another project's lessons into a new project's governing documents.

A lesson may motivate a proposed §6.8 change when it reveals a document-governance defect;
recurrence alone does not authorize changing the constitution. Existing references to §8 mean
this routing rule, not an instruction to append lessons here.

## 9. Bootstrapping a new project

Seed `00`–`05`, this constitution and `AGENTS.md` through the project initializer. Fill project
facts from actual requirements and manifests; leave unknowns explicit. Do not pre-accept an
ADR, invent a completed phase, or create fictitious feature/status rows in a fresh project.
Use the feature tool for its index. Keep `DESIGN.md` optional; author it when UI work needs a
shared design language. Preserve existing customized docs and supported entry symlinks.
Read `AGENTS.md` first, then the owners relevant to the work.
