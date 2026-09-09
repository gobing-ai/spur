# Key-document responsibility audit — 2026-09-09

Scope: the repository's entry/UI guides, numbered key documents, init templates, and the
instructions/tests that maintain or consume them. Robin authorized evaluation, condensation,
responsibility corrections and template alignment while preserving issued ADR numbers.

## Findings and repairs

| Severity | Finding | Repair |
| --- | --- | --- |
| High | Constitution §8 and doc-evolve encouraged routine lesson appends and automatic promotion into governance. | Keep the constitution as document metadata; route lessons to existing context/learning storage and require a specific authorized governance correction. |
| High | T3/T9 required index/entry edits even when their facts were unchanged. | Update the owning contract; touch indexes and AGENTS only when their own content changes. |
| High | ADRs contained shipment receipts, consent applications, large measurements and task sweeps. | Condense those sections, retain architectural choices/tradeoffs/amendments, identify legacy nonarchitectural records, and preserve every ID/title. |
| High | 04 had become a detailed specification book despite its index contract; 05 duplicated the generated status ledger. | Move detailed non-UI contracts into nine topic references with forwarding headings; route 05 to the existing feature index. |
| Medium | Architecture mixed mechanisms with per-task delivery history; UI prose repeated token values. | Keep mechanisms and invariants, link contract detail, remove UI repetition while retaining token/component values. |
| Medium | Init templates pre-accepted a documentation ADR, claimed a completed phase and invented a feature row. | Seed unfilled project facts and the same governance body; keep actual decisions/status tool-owned. |
| Medium | The portable-entry satellite claimed the template constitution was abbreviated and had unstable section numbers. | Align it with shared governance and stable section IDs. |
| Medium | PRD still deferred the local Board after its documented cutover. | Remove the stale deferral and retain the Board in capability scope. |

These are document-governance corrections under constitution §6.8, not new product architecture.
The implementation record belongs here; no ADR was added to certify this cleanup.

## Size changes

| Entry | Before (lines) | After (lines) |
| --- | ---: | ---: |
| AGENTS.md | 271 | 256 |
| DESIGN.md | 582 | 493 |
| 00_ADR | 2,367 | 1,593 |
| 02_ROADMAP | 194 | 109 |
| 03_ARCHITECTURE | 1,465 | 977 |
| 04_DESIGN | 3,306 | 380 |
| 05_FEATURES | 182 | 65 |
| 99_PROJECT_CONSTITUTION | 646 | 248 |

The 04 reduction primarily relocates contract detail into linked owners; it does not discard
those contracts. Other reductions remove repetition and misplaced execution history.

## Preservation and scope limits

- All 113 ADR IDs and original titles remain, as do original status/date lines. Decision reversals
  remain identifiable; metadata-only and delivery-only receipts are omitted from the register.
- Original headings in the roadmap, architecture, non-UI index, feature entry and UI guide remain
  addressable. The non-UI index retains 72 forwarding headings.
- CLAUDE.md and GEMINI.md remain symlinks to AGENTS.md. UI token/component values are unchanged.
- Feature satellites, generated feature index and existing task records were not rewritten.
- Historical measurements/receipts remain available in Git and their task records. No duplicate
  archive was added to the governing documents.
- This is a responsibility/reference audit, not a new verification of every historical feature
  status or every CLI contract. Existing-project docs remain protected from forced init overwrite.

## Verification

- `bun run spur-check`: PASS — lint/typecheck, contract gates, 45 pre-rules, 2 post-rules,
  and 7,960 tests across 439 files.
- Focused template/alignment/CLI-consistency/output-envelope regression checks: 81 passed.
  Contract consumers now read the extracted design owners; their semantic assertions remain intact.
- `bun run test-cf`: PASS — one Workers test file/test.
- Script, CLI, server and web build targets, plus CLI `build:bundle`: PASS. Bundled doc templates
  match all seven source templates byte for byte.
- Superskill validation: root/template AGENTS and the repository doc-evolve skill all valid,
  with no findings.
- Structural checks: 113 unchanged ADR headings/IDs, preserved forwarding headings, valid YAML,
  resolved local Markdown links/fragments, and every design satellite indexed. Symlinks and UI
  token/component preservation checks passed; `git diff --check` passed.
- A separate read-only semantic review identified stale proof-status receipts and an incorrectly
  labeled active-session decision; both were corrected before completion.

Checks exercised repository sources and bundled init assets. No global plugin install, downstream
project rewrite, publication or deployment was performed. Logs are in the local `.spur/tmp/` directory.
