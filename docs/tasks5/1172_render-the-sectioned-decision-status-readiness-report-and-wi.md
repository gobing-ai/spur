---
schema_version: 1
name: Render the sectioned decision status readiness report and wire --probe
status: done
template: feature-impl
created_at: 2026-10-11T23:23:17.914Z
updated_at: "2026-10-12T02:23:33.986Z"
feature_id: P11

done_forced: "false"
done_reason: unforced close; PASS artifact at tracked Testing section (scratch verdict not retained)
---

## 1172. Render the sectioned decision status readiness report and wire --probe

### Background

Slice of feature P11, closing it: the readiness facts and the probe exist (tasks 1169–1171), and the
operator-facing surface renders them.

Today `spur decision status` prints a flat `key: value` dump with two `JSON.stringify` blobs and a
headerless list of rows — the operator cannot tell what the columns are, and the human output omits
`configDecisionMakers` entirely while `--json` carries it. The house already has a readiness renderer
to match: `agent doctor`'s aligned `✓/✗` table (`packages/app/src/services/agent-service.ts:3158`).

### Requirements

- [x] R1. Render a sectioned report instead of the flat dump:
  - one status header line: `decision status — OK|FAILED (n errors)`, then the decision count, the
    maker count, the configured default maker and the total recorded invocations;
  - a `Makers` table with `ST / MAKER / CONFIGURED BY / SERVES / RECORDED / ACCEPTED / LAST SEEN`
    (`SERVES` is a count — the id list is the `MAKER` column of the table below, and `makers[].serves`
    in JSON — because inlining every served id makes the table wider than the report);
  - a `Decisions (n)` table with `ST / DECISION / TYPE / MAKER / SOURCE / MIN / LAYER / RECORDED /
    ACCEPTED / LAST SEEN`;
  - a `Catalog` block with the per-layer file counts, `duplicates` and configured `overrides`;
  - an `Errors (n)` block above the tables, printed only when there are errors, so a failing run
    reads top-down.
  - Columns pad to the widest cell; empty cells render `—`; status glyphs are `✓`/`✗`; no cell is a
    JSON blob (layer counts and duplicates read as `name value` pairs).
- [x] R2. Add `--probe` (opt-in). It runs `probeDecisionMakers` over the distinct registered effective
  makers, adds a `PROBE` column, and streams each result to stderr as it lands so a slow maker is
  visible before the tables. It never changes the exit code. Combined with `--reliability` it is
  refused as a caller mistake (message, exit 1) before any maker call. Without `--probe` the renderer
  constructs no maker.
- [x] R3. Extend `--json` additively: `{ ...status, makers, perDecision (+type/layer/minConfidence/evidence), probes? }`.
  Every existing field keeps its name and meaning; under `--probe --json` stdout stays one parseable
  document (progress goes to stderr, never stdout).
- [x] R4. Update `docs/design/decision-observability-and-adoption.md` §3.4.1 (readiness marks, layout
  contract, probe semantics) and §6 (probe tradeoffs), and the `status` rows plus the catalog file
  inventory in `docs/design/decision-catalog.md`, in the same commit (T3). The `sp:spur-cli`
  reference `references/decision.md` lands in the same change, per the parity rule.
- [x] R5. Update `apps/cli/tests/commands/decision.test.ts`: the layout assertions replacing the flat
  dump assertions, the readiness marks in JSON, recorded evidence in both the JSON and the human row,
  `--probe` (exit 0, PROBE column, streamed line, no recorded row written), `--probe --json` staying
  one document, and the `--probe` + `--reliability` conflict.
- [x] R6. Add `packages/app/tests/decision/decision-status-readiness.test.ts` covering the mapping and
  the probe loop, with the failure-mode table written before the assertions.

### Acceptance Criteria

- [x] AC1 — The readiness report renders as labelled sections instead of a flat key dump
- [x] AC2 — Recorded evidence separates registered and configured from actually working
- [x] AC3 — Mutually exclusive status flags are refused as a caller mistake

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:24:39.979Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:20:00.000Z

- Operator request (this session): `spur decision status` output should be clearer, and should show
  the registered / configured / actually-working markers. Accepted the recommended layout: labelled
  sections with aligned `✓/✗` tables (the `spur agent doctor` renderer shape) over the smaller
  "keep flat lines, add one aligned table" alternative.
- Public-surface consent: `--probe` is a new public flag on the existing `decision status` verb. The
  operator asked for exactly this marker, which is the consent; the rejected alternative (an internal
  `scripts/commands` entry) is recorded in Design.
- Closed: `--json` grows additively (`makers`, per-decision `evidence`, `probes?`). No existing field
  is renamed or removed, so machine consumers and the existing CLI tests keep working.
- Closed: `--since` keeps its current contract (only valid with `--reliability`). The readiness
  evidence window is the whole ledger; narrowing it was not requested and would break a documented
  caller mistake.

#### Q&A entry — 2026-10-12T02:23:27.472Z

Closed decisions retained from the original refinement and implementation session:

- Operator request (this session): `spur decision status` output should be clearer, and should show
  the registered / configured / actually-working markers. Accepted the recommended layout: labelled
  sections with aligned `✓/✗` tables (the `spur agent doctor` renderer shape) over the smaller
  "keep flat lines, add one aligned table" alternative.

- Public-surface consent: `--probe` is a new public flag on the existing `decision status` verb. The
  operator asked for exactly this marker, which is the consent; the rejected alternative (an internal
  `scripts/commands` entry) is recorded in Design.

- Closed: `--json` grows additively (`makers`, per-decision `evidence`, `probes?`). No existing field
  is renamed or removed, so machine consumers and the existing CLI tests keep working.

- Closed: `--since` keeps its current contract (only valid with `--reliability`). The readiness
  evidence window is the whole ledger; narrowing it was not requested and would break a documented
  caller mistake.

### Design

**Chosen: sectioned aligned tables in the CLI, readiness mapping in the app, `--probe` opt-in.**

Layout — aligned tables with a header row, `✓`/`✗`, `—` for empty cells and a padded column width,
matching `renderDoctorTable` / `renderRoleLadder` (`apps/cli` renders by hand today; the renderer stays
a local function in `apps/cli/src/commands/decision.ts` because no other command renders this shape
yet — a shared table helper is premature for one caller).

Marker semantics, per row:

| Marker | Source | Reads as |
| --- | --- | --- |
| registered | `DecisionService.status().registeredMakers` | the registry holds this maker |
| configured | `decisions.maker` / `decisions.makers.<id>` | config names this maker (or `—` for the catalog floor) |
| recorded | `decision.end` ledger rows | the maker has served at least once |
| proven | `--probe` result | the maker answered one live liveness decision |

Keeping the four distinct is the point: `registered + configured + no recorded rows` is "never used",
and `recorded with accepted: 0` is "registered and configured but never once succeeded" — the state
this repository is currently in, where the previous output read as healthy.

**Rejected:**
- Printing the readiness overlay as a second command (`decision readiness`): a new public verb needs
  operator consent and the operator asked for this in `status`.
- Replacing the JSON shape with the overlay: a breaking change for machine consumers for no gain;
  additive fields carry the same information.
- Folding `--reliability` into the default output: that report is the adoption evidence bar with
  percentiles per id, and it is deliberately a separate, explicit read.

**Known limits (recorded, not hidden):**

- A probe that hits its deadline abandons the call rather than cancelling it: the in-process
  `mlx-native` core exposes no cancellation, so a wedged weight load can keep the process open after
  the report is printed. The probe's own side effects are nil (no event, no log row), so nothing is
  written after the deadline. Upstream gap, recorded in the design satellite §6.
- The `PROBE` column reflects one liveness decision, not the real decision's prompt shape: it proves
  resolution, validation, the maker call and the fallback route, not answer quality. `decision run
  <id> --evidence <file>` remains the way to measure a real decision.

### Plan

- [x] Render one summary header, aligned maker/decision tables and labelled catalog/errors.
- [x] Wire opt-in probes, named stderr progress and additive JSON with isolated stdout.
- [x] Preserve timestamps and document the surface; run CLI, parity and feature gates.

### Solution

- **R1 — the renderer** (`apps/cli/src/commands/decision.ts`): `renderDecisionStatus(status, readiness)`
  emits the single status line carrying counts and the configured default, the `Errors` block (only when there are errors, above the tables), the `Makers`
  table, the `Decisions (n)` table and the `Catalog` block, using a local `alignTable` that pads each
  column to its widest cell. `✓`/`✗` glyphs, `—` for empty cells, `renderProbe` for the probe cell
  (`glyph value via reason · duration`). No cell renders JSON: `layers`, `duplicates` and `overrides`
  read as `name value` pairs.
- **SERVES as a count**: inlining every served id widened the Makers table past the report; the ids are
  the `MAKER` column of the Decisions table and stay on `makers[].serves` in `--json`. The feature AC
  scenario was amended to state the count, not the list.
- **R2 — `--probe`**: opt-in; runs `probeDecisionMakers` over the distinct registered effective makers,
  adds the `PROBE` column, and streams `probing <maker>: <cell>` to stderr as each result lands (including under
  `--json`, whose stdout stays one parseable document). `--probe` + `--reliability` is refused before any
  maker call; probe outcomes never change the exit code.
- **R3 — additive JSON**: `{ ...status, makers, perDecision (+type/layer/minConfidence/evidence), probes? }`.
- **R4 — same-commit docs** (T3): `docs/design/decision-observability-and-adoption.md` §3.4.1 (marks,
  layout contract, probe semantics) and §6 (probe surface, no audit trail, probe deadline); the `status`
  rows and catalog inventory in `docs/design/decision-catalog.md`; the parity surface
  `plugins/sp/skills/spur-cli/references/decision.md`; and the two help trees
  (`docs/help/cmd_decision.md`, `docs/help2/decision.md`) that the parity tests enforce.
- **R5/R6 — tests**: the CLI suite's flat-dump assertions were replaced by layout and readiness
  assertions (31 pass); the new app suite covers the mapping and the probe loop (11 pass).
- **Generated artifact**: `plugins/sp/lib/inline-run.generated.mjs` regenerated via
  `bun run scripts/commands/bundle-plugin-lib.ts` — the determinism test diffs it against a fresh build.

- **Citations**: `apps/cli/src/commands/decision.ts:380` (`renderDecisionStatus`), `apps/cli/src/commands/decision.ts:453` (`renderProbe`), `apps/cli/src/commands/decision.ts:460` (`alignTable`), `apps/cli/src/commands/decision.ts:275` (`--probe`), `apps/cli/src/commands/decision.ts:283` (the `--probe` + `--reliability` refusal).


- Re-audit corrections: preserve full LAST SEEN timestamps, identify the maker in every stderr progress line (also with JSON), and put counts and the configured default on the first status line. CLI regressions now inspect stdout and stderr separately.

### Testing

- `(cd apps/cli && bun test tests/commands/decision.test.ts)` → 31 pass, 0 fail, including the
  sectioned layout, the readiness marks in JSON, recorded evidence in both the JSON and the human
  row, `--probe` (exit 0, PROBE cell, streamed stderr line, no recorded row written),
  `--probe --json` staying one parseable document, and the `--probe` + `--reliability` refusal.
- Manual render in a throwaway project (source-local CLI): header, `Makers`, `Decisions`,
  `Catalog` blocks aligned; `--probe` printed `probing ✗ unclear via error · 0.2s` on stderr and
  filled the PROBE column; a second `status` still reported `RECORDED 0` for every row.
- Docs parity: `apps/cli/tests/help-doc-parity.test.ts` and `plugins/sp/tests/help-docs-parity.test.ts`
  pass with `--probe` documented in `docs/help/cmd_decision.md` and `docs/help2/decision.md`.
- `bun run lint` (biome + every workspace typecheck) clean; `bun run spur-check` run on the final
  tree (see the wrap report for the one flaky, unrelated `rule run` envelope timeout).
- Per-file coverage: `apps/cli/src/commands/decision.ts` 94.29 % functions / 100 % lines.

### Review

Current audit found three mismatches with the written contract: JSON progress was suppressed, the first line lacked the summary facts, and LAST SEEN discarded the time. The renderer now preserves the full timestamp and puts all summary facts on the first line. Progress identifies its maker and goes to stderr in human and JSON modes; separate-stream CLI assertions prove JSON stdout remains parseable.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | usability | apps/cli/src/commands/decision.ts | JSON probes suppressed the promised progress channel. | FIXED — named stderr progress in both modes; stdout checked independently. |
| P3 | contract | apps/cli/src/commands/decision.ts | Header facts occupied a second line and timestamps were truncated to dates. | FIXED — one summary line and complete timestamps; CLI assertions pass. |

The local table renderer is appropriate for the existing CLI boundary. Additive catalog fields are required by this report and compatibility is checked against the old JSON keys. The prior duplication and additive-field rows did not establish a defect. The probe-only hub's external cancellation limit is documented under task 1171 and the owning satellite.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-11T23:25:04.612Z backlog → todo (system)
- 2026-10-12T01:39:53.337Z todo → wip (system)
- 2026-10-12T01:39:54.321Z wip → testing (system)
- 2026-10-12T01:44:14.600Z testing → done (system)
- 2026-10-12T01:57:04.563Z done → wip (system)
- 2026-10-12T01:57:05.207Z wip → testing (system)
- 2026-10-12T01:57:05.874Z testing → done (system)

