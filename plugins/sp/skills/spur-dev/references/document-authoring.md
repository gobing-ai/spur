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

## Revise an existing file

Read the whole file and its inbound links first. Preserve the filename, meaningful headings,
anchors, dates, decisions, and historical status. Add missing metadata from evidence; label
unknowns instead of guessing. Restructure only where clarity improves, and keep a forwarding
heading when an anchor cannot be migrated safely. Update `updated_at` only for a substantive edit.
Do not turn an old proposal into a claim about current behavior without checking the owning source.

For a bounded, read-only review of legacy files, use `sp:spur-doctor`. Apply accepted document
proposals in place using this guide, then use `sp:doc-evolve` to check affected key-document sync.
No bulk conversion or strict format check is required to read or maintain existing documents.
