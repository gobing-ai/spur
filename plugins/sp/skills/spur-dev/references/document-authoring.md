---
name: document-authoring
description: Light Markdown contracts for plan records and non-UI design satellites.
see_also:
  - spur-dev
  - planning-workflow
  - doc-evolve
---

# Plan and design document authoring

Use [plan.md](../templates/plan.md) for a new `docs/plans/*.md` working record and
[design.md](../templates/design.md) for a new `docs/design/*.md` non-UI contract satellite.
The project constitution owns their authority and maintenance; these templates are writing aids,
not parser schemas. Keep Markdown readable even when frontmatter is absent in a legacy file.

| Document | Job | Authority |
| --- | --- | --- |
| `docs/plans/` | Ordered work: intended outcome, premises, dependencies, execution sequence, verification, and follow-up. Older proposals and investigations remain working records. | Working record. Accepted conclusions take effect in their owner, such as an ADR, feature, roadmap, or design satellite. |
| `docs/design/` | Issue, context, solution, and its observable non-UI contract | Governed satellite of `docs/04_DESIGN.md`; label proposals and current behavior separately. |

## Compose a new file

1. Choose the owner before writing. Reuse an existing satellite when it already owns the surface.
   Keep root `DESIGN.md` for UI rules and `03_ARCHITECTURE.md` for current system topology.
2. Copy the relevant template. Replace placeholders. Keep `kind`, a descriptive `title`, a
   truthful `status`, `created_at`, `updated_at`, `related` links, and `tags` for categorization.
   Use ISO dates; leave `related` or `tags` empty when none apply. Keep one H1 matching the title.
3. Use headings for the reader's question. The template's prompts are a starting shape: remove
   inapplicable sections and keep specialized sections required by the producing workflow, such as
   a brainstorm's `## Design Summary`. Number new sections in reading order. Plans make the
   execution sequence and its premises usable; designs explain the issue, context, solution, and
   observable contract. Never fill empty boilerplate.
4. For a design satellite, write detail first, then add its pointer to `04_DESIGN.md` if missing.
   Update an existing index row only when its indexed facts change. Do not put task receipts there.

## Frontmatter vocabulary

Soft conventions for consistency and tag filtering, not a validator. Unknown values stay readable.

| Field | Values |
| --- | --- |
| `kind` | `plan` for any `docs/plans/` record, `design` for any `docs/design/` satellite. Nothing else. |
| `status` (plan) | `draft`, `proposed`, `approved`, `in-progress`, `done`, `superseded` |
| `status` (design) | `proposed`, `accepted`, `implemented`, `superseded` |
| `tags` | Ordered: one record-type tag, then owning feature ids (for example `H14`), then at most two area tags. |
| `related` | Repo-relative paths or feature/task ids; no prose. |

Record-type tags — plan: `brainstorm`, `proposal`, `investigation`, `audit`, `map`, `execution`,
`evidence`; design: `contract` (observable surface) or `system` (internal mechanism). Area tags:
`cli`, `server`, `web`, `workflow`, `planning`, `history`, `observability`, `agent`, `plugin`,
`docs`, `config`. A project may extend the area list; reuse a tag already in the corpus
(`rg -n '^tags:' docs/plans docs/design`) before adding one.

A producing workflow may keep its own keys beside these, such as a brainstorm's `needs_design` and
`run_id`, and its own section shape. The shared fields still apply.

## Revise an existing file

Read the whole file and its inbound links first. Preserve the filename, meaningful headings,
anchors, dates, decisions, and historical status. Add missing metadata from evidence; label
unknowns instead of guessing. Restructure only where clarity improves, and keep a forwarding
heading when an anchor cannot be migrated safely. Update `updated_at` only for a substantive edit.
Do not turn an old proposal into a claim about current behavior without checking the owning source.

Legacy metadata upgrade:

- **Map** `date` → `created_at` and `feature`/`feature_id`/`task_wbs`/`parent_task` → `related`.
  `title` is the H1 text; `topic` maps to `title` only when the file has no H1, otherwise drop it.
- **Owners:** when no owner key exists, a feature or task record that links the file
  (`rg -l <filename> docs/features <task dir>`) is evidence for `related`. Ids found only in body
  prose are not; requirement and priority labels look like feature ids.
- **Keep** workflow and provenance keys unchanged (`needs_design`, `run_id`, `doc`, `authority`,
  `owns`, `read_before`, `edit_rules`, `version`, `derived_from`).
- **Dates:** `created_at` comes from a legacy `date`, else the filename date prefix, else the first commit
  (`git log --follow --diff-filter=A --format=%as -- <file> | tail -1`), else leave it out and flag it.
  `updated_at` is the existing value or the last commit date; do not bump it for a metadata-only edit.
- **Status:** use the vocabulary value only when the legacy value or body states it unambiguously
  (`shipped`/`implemented`/`built …` → `implemented`; `approved-with-feedback` → `approved`).
  Otherwise keep the legacy value and flag it for the operator. No status is better than a guessed one.
- **Headings:** never renumber or rename legacy headings; numbering applies to new files only.

For a bounded, read-only review of legacy files, use `sp:spur-doctor`. Apply accepted document
proposals in place using this guide, then use `sp:doc-evolve` to check affected key-document sync.
No bulk conversion or strict format check is required to read or maintain existing documents.
