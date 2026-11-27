---
schema_version: 1
name: Enforce a governance consent row for every builder verb in the CLI surface parity test
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:44.690Z
updated_at: "2026-11-27T16:54:12.447Z"
feature_id: A95

estimate_hours: 3
priority: P2
---

## 1464. Enforce a governance consent row for every builder verb in the CLI surface parity test

### Background

Feature A95 R1 requires the registered `spur builder` verbs to match the governance consent record. Today nothing enforces this:

- `docs/design/harness-surface-governance.md` §3 records consent as table rows (0616/0617, A93) plus prose amendments (PR-7 `pr`, PR-9 `publish` + `bump-ver --check`, A951 `show-branches`, A951 `pr-*`).
- §3 closes with "the current frozen list is those fourteen verbs". That is stale: §2 (ADR-130, ~line 95) adds `bundle-plugins`, `bundle-laya-worker`, `emit-board-types`, `emit-migration-sql` and `check-deps`, so 19 verbs are registered in `apps/cli/src/commands/builder/index.ts`.
- `plugins/sp/tests/cli-surface-parity.test.ts` already checks registered verbs against `plugins/sp/skills/spur-cli/references/builder.md` `## Verb map` through `REFERENCE_LAYOUT.builder` and the helpers `firstTableUnderHeading` / `verbTable` / `documentedVerbs`. It does not check the governance record.

Refine correction: prose amendments cannot be parsed reliably. The record needs one machine-readable table.

**Refine corrections (2026-11-27)**

- "§3 records consent as table rows (0616/0617, A93)" → the A93 consent row is in the §4 table (2026-11-16 row), not §3 → table rows are cited from §3 and §4.
- "§2 (ADR-130, ~line 95) adds the five extra verbs" → they are consented in the §2 "A94 (2026-11-20)" block (`harness-surface-governance.md:88-95`); the stale "fourteen verbs" sentence is at `:231` → cite A94 for those five rows; replace the sentence at `:231`.
- Live check: `spur builder --help` lists 19 verbs (build-cli, bundle-config, bundle-web, bundle-plugins, bundle-laya-worker, emit-board-types, emit-migration-sql, verify-pack, build-server, build-binaries, check-deps, bump-ver, drop-tags, publish, show-branches, pr-status, pr-check, pr-open, pr-review) → premise holds.
- Parity test seams: live verbs come from `captureCliSurface` (`plugins/sp/tests/helpers/cli-surface`), `firstTableUnderHeading` is at `cli-surface-parity.test.ts:122`, `REFERENCE_LAYOUT.builder` at `:187` → reuse them; no new helper.
- AC row used the non-canonical `R1 —` form → rewritten as `AC1 — … (req: …)` with its test layer.

### Requirements

- [ ] R1. `docs/design/harness-surface-governance.md` §3 gains one `| Verb | Consent entry |` table listing every registered builder verb, with the entry that consented to it (task WBS, ADR or feature id). It replaces the stale "fourteen verbs" sentence; the prose history stays.
- [ ] R2. `plugins/sp/tests/cli-surface-parity.test.ts` asserts, both ways, that the registered `spur builder` subcommands equal that table's `Verb` keys. It reuses `firstTableUnderHeading`, and its failure names each missing or extra verb.
- [ ] R3. The test fails when a verb is registered without a consent row, and when a row names an unregistered verb.

Out of scope: adding, renaming or removing any builder verb; consent rows for other nouns.

### Acceptance Criteria

- [ ] AC1 — The builder verb set matches the governance consent record (req: R1; R2; R3) — unit: `plugins/sp/tests/cli-surface-parity.test.ts` asserts set equality both ways between `captureCliSurface` builder verbs and the `### Frozen builder verb set` table, with failure messages naming each missing/extra verb.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:53:56.498Z

- **Q: Parse the prose amendments instead of adding a table?** A: No. Prose is free-form and changes wording; one table is the only stable key set.
- **Q: Where does the table live?** A: At the end of §3 under the heading `### Frozen builder verb set`, so the parity test anchors on one heading.
- **Q: Do the 19 verbs need re-consent?** A: No. Each row cites the entry already in §2/§3, and the table records existing consent.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: Which sections hold the consent entries the table cites?** A: §2 A94 block (five ADR-130 verbs), §3 (0616/0617, PR-7, PR-9, A951) and §4 (A93 row). The table lives in §3 only.

### Design

- **Chosen:** add a `### Frozen builder verb set` table in governance §3, plus one parity test case that reads it through `firstTableUnderHeading` and compares it with the commander registration the test already enumerates.
- **Rejected:** a JSON consent file under `config/`, which would put a second source of truth next to the governance doc; regex over the §3 prose, which is brittle.
- **Frozen names:** heading `### Frozen builder verb set`; columns `Verb`, `Consent entry`.
- **Invariants:** set equality in both directions; the existing `builder.md` verb-map check stays unchanged.
- **Anti-patterns:** auto-generating the table from the registry, which would make the test a tautology.
- **Handoff:** a future builder verb must add its consent row in the same change, or the parity test fails.

### Plan

1. Failure modes first: in the parity test, add a case that fails on (a) a registered verb missing from the table and (b) a table row naming no registered verb. Watch it fail against the current doc, which has no table.
2. Enumerate the registered verbs: `bun run apps/cli/src/index.ts builder --help`, cross-checked with `apps/cli/src/commands/builder/index.ts` (19 verbs on 2026-11-27).
3. Write the 19-row table at the end of governance §3 under `### Frozen builder verb set`. Cite each verb's consent entry from §2 (A94 block, `:88-95`), §3 (0616/0617, PR-7, PR-9, A951) and §4 (A93 row). Replace the "fourteen verbs" sentence (`:231`) with a pointer to the table.
4. Run the test green: `(cd plugins/sp && bun test tests/cli-surface-parity.test.ts)`.
5. Real proof: temporarily delete one table row locally, confirm the failure names that verb, then restore the row.
6. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/design/harness-surface-governance.md` §2 (ADR-130 verbs) and §3 (consent record)
- `plugins/sp/tests/cli-surface-parity.test.ts` (`REFERENCE_LAYOUT.builder`, `firstTableUnderHeading`)
- `apps/cli/src/commands/builder/index.ts`
- Feature A95

### History

- 2026-11-27T07:54:32.644Z backlog → todo (system)

