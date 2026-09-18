---
schema_version: 1
name: Doctor capability-staleness warning fires on nearly every real install (unnormalized detected version strings)
status: done
template: issue
created_at: 2026-09-18T06:51:40.161Z
updated_at: "2026-09-18T11:15:55.781Z"
feature_id: B8

priority: P3
ac_altitude: task-local
estimate_hours: "1.5"
---

## 0899. Doctor capability-staleness warning fires on nearly every real install (unnormalized detected version strings)

### Background

Surfaced by the B6 merge session (runall batch 0890–0893, merge commit `a082d0d93` on main): 0893's doctor test asserting "no Warning on stderr" broke after merging 0898's capability surface, because `capability-declaration-stale` warnings fired for executors on the merging host.

`sessionCapabilityFor` (`packages/app/src/services/agent-service.ts:2913-2925`) compares the detected CLI version string **exactly** against the runner record's `verifiedAgainst`. The runner's `AgentDetector` returns the **raw first line** of `<agent> --version` (it only uses its version regex to validate, `@gobing-ai/ts-ai-runner@0.4.68` `dist/agent-detector.js:4,45-49`), so detected strings carry branding: `2.1.274 (Claude Code)`, `codex-cli 0.154.0`, `omp/18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`, `grok 1.0.34 (3736acbc8658) [stable]` — while `verifiedAgainst` is the bare version. Every real install of those agents reports stale on every text-mode doctor run.

The warning text compounds it: `warnCapabilityStale` (`agent-service.ts:707-714`) renders `detects ${agentBinary} ${detected}`, so a brand-prefixed string doubles the name (`detects codex codex-cli 0.154.0`, `detects grok grok 1.0.34 …`) and equal versions read as a false positive.

The 0893 R3 assertion was narrowed to usage-related terms as the merge workaround (`apps/cli/tests/commands/agent.test.ts:900-903`, "R3 scope" comment).

**Refine corrections (2026-09-18)**

- Merge commit `a0820d93` → actual `a082d0d93` → corrected above.
- "`unverified (CLI not installed)` for antigravity" listed as a *detected* string → it is the record-side `verifiedAgainst` sentinel (antigravity-cli, hermes); antigravity's detected string is bare `1.2.6` → it is a separate unverifiable case, not a branding case (Design §Unverifiable records).
- "6 executors warned with visible equal versions" → reproduced 2026-09-18 on this host (`spur agent doctor --force-refresh`): 5 warnings — claude, codex-sol, grok (branding) + agy-gemini, agy-opus (unverified sentinel vs installed 1.2.6) → both causes are in scope.
- Line ref `:2917-2921` → function is `:2913-2925` (compare at `:2920-2923`).
- A concurrent refine (2026-09-18 07:00Z) chose exact-compare fallback for token-less records and "restore the broad no-warning assertion" → the fallback keeps agy warning on this host (contradicting its own R3 and the documented `null when … unverifiable` contract, `docs/design/cli-contracts.md:454`, `agent-service.ts:2847`); the broad assertion is host-dependent (see Q&A) → both replaced. Its Plan also missed the exact-text constant `apps/cli/tests/config-layering.test.ts:90-91` and the T3 doc owners → added.
- Inline **Requirements**/**AC** lists formerly in this Background were promoted to the formal sections and removed here to avoid two diverging copies.
- Scope check: not fixed at `a082d0d93` (exact compare still at `:2921`); no other task owns it (0888/0889/0898 are `done`) → task stays, no cancellation.

### Requirements

- [x] R1. Staleness is decided on the **version core**: the first `major.minor[.patch][-prerelease]` token of the detected string vs the same token of `verifiedAgainst`. A branded detected string whose core equals the record's (`2.1.274 (Claude Code)`, `codex-cli 0.154.0`, `omp/18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`, `grok 1.0.34 (3736acbc8658) [stable]`) yields `capabilityStale: null`, no `⚠`, no stderr warning.
- [x] R2. A record or detected string with no version core (e.g. `verifiedAgainst: 'unverified (CLI not installed)'`) is **unverifiable**: `capabilityStale: null`, no `⚠`, no warning. The detail view keeps showing `verified: unverified (CLI not installed)`.
- [x] R3. Genuine drift still warns (B8 R7 unchanged): differing cores (incl. differing prerelease, `0.1.5-rc.2` vs `0.1.5-rc.1`) keep `capabilityStale`, the `⚠` cell marker, and one text-mode stderr warning per executor; JSON stays stderr-clean.
- [x] R4. The stderr warning names the executor and binary once and quotes the raw detected string: `Warning: capability-declaration-stale: executor <executor> (<agentBinary>) reports version "<detected>", but the runner record was verified against <verifiedAgainst> — session capability flags may have drifted.`
- [x] R5. T3 owners describe the core-compare contract: `docs/design/cli-contracts.md:451-454` and `plugins/sp/skills/spur-cli/references/agent.md:169-171`.

Non-goals: no ts-ai-runner change or re-declared `verifiedAgainst`; no JSON shape change (`version` and `capabilityStale.detected` stay raw); no semver ordering (equality only); no change to the doctor detail `stale:` line; no change to the narrowed 0893 R3 assertion.

### Acceptance Criteria

- [x] AC1 — A stale capability declaration is surfaced (req: R1, R2, R3): regression scenario — an executor whose detected version matches `verifiedAgainst` modulo branding prefix/suffix emits NO `capability-declaration-stale` warning (suffix, prefix, prefix+suffix shapes asserted); a genuine core mismatch warns with raw values quoted and normalized cores named.

Task-local checks: `packages/app` agent-service tests + `apps/cli` agent command tests pass (covers R1–R4). R4 disposition: narrowed 0893 R3 assertion kept — post-normalization a host with genuine drift still warns, so the broad no-warning form would be host-dependent; decision recorded at `apps/cli/tests/commands/agent.test.ts:903`.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-18T07:05:59.464Z

- **Q1 (closed 2026-09-18): Compare contract?** Normalize both sides to the version core, then string-equal. Exact compare is the bug; "informational-only mismatch" buries real drift. This supersedes 0889's Design line "no semver parsing — a mismatch of any kind is worth a warning": we still do no semver *ordering*, only token extraction, which non-semver date versions (`2026.6.11`) also satisfy.
- **Q2 (closed): Token-less record (`unverified (CLI not installed)`) — warn or null?** Null. B8 R7's scenario is scoped to "a capability record verified against one agent CLI version"; an unverified record has none, "may have drifted" is false, and the operator cannot act on it (only an upstream re-verify can). Matches the documented contract `capabilityStale … null when fresh or unverifiable`. Follow-up note (not this task): antigravity-cli `1.2.6` is installed on this host, so the upstream ts-ai-runner record could now be verified.
- **Q3 (closed): Restore 0893 R3's broad "no Warning on stderr" assertion?** No. That test (`apps/cli/tests/commands/agent.test.ts:860-868`) runs `main(['agent','doctor'])` against the host's real CLIs, so any host whose installed CLI legitimately differs from the record would warn and fail. Keep the narrowed usage-scoped form and its comment.
- **Q4 (closed): Put the extractor in ts-ai-runner?** No. The runner's `version` is intentionally raw (display), and the compare contract is Spur's doctor (B8 R5). A module-private regex avoids a release cycle; revisit if a second consumer appears.
- **Q5 (closed): Show normalized cores in the warning?** No. After R1 a warning only fires when cores differ, so the quoted raw string next to the bare `verifiedAgainst` is unambiguous; the ambiguity came from the doubled binary name.

### Design

**WHAT / WHY.** Doctor's stale check compares apples (raw `--version` first line) to oranges (bare version). Compare version cores instead; treat token-less values as unverifiable; fix the doubled binary name in the warning.

**WHERE (only these files).**

| File | Change |
| --- | --- |
| `packages/app/src/services/agent-service.ts:2913-2925` | `sessionCapabilityFor` decides staleness via `versionCore` |
| `packages/app/src/services/agent-service.ts` (above `sessionCapabilityFor`) | new module-private `VERSION_CORE` + `versionCore` |
| `packages/app/src/services/agent-service.ts:707-714` | R4 warning text; docstring `:701-706` "version core differs" |
| `packages/app/src/services/agent-service.ts:2847, 2905-2907` | comments: "core differs; null when fresh or unverifiable" (drop "any mismatch warns") |
| `packages/app/tests/services/agent-service.test.ts` B8 describe (`:4417`) | AC1–AC3 tests; tighten existing R5 text test to the R4 wording |
| `apps/cli/tests/config-layering.test.ts:89-91` | `CAPABILITY_STALE_WARNING` → R4 text (`reports version "1.0.0 (claude stub)"`) |
| `docs/design/cli-contracts.md:451-454`, `plugins/sp/skills/spur-cli/references/agent.md:169-171` | core-compare + unverifiable ⇒ null |

**Frozen names / algorithm.**

```ts
/** B8 R5 / 0899: `major.minor[.patch][-prerelease]`; build metadata (`+…`) and branding ignored. */
const VERSION_CORE = /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/;

function versionCore(raw: string): string | null {
    return VERSION_CORE.exec(raw)?.[0] ?? null;
}

// in sessionCapabilityFor:
const detectedCore = detectedVersion === null ? null : versionCore(detectedVersion);
const recordCore = versionCore(capabilities.verifiedAgainst);
const capabilityStale =
    detectedVersion !== null && detectedCore !== null && recordCore !== null && detectedCore !== recordCore
        ? { verifiedAgainst: capabilities.verifiedAgainst, detected: detectedVersion }
        : null;
```

Checked against the live strings: `2.1.274 (Claude Code)`→`2.1.274`, `codex-cli 0.154.0`→`0.154.0`, `omp/18.2.3`→`18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`→`2026.6.11`, `grok 1.0.34 (3736acbc8658) [stable]`→`1.0.34`, `0.1.5-rc.1`→`0.1.5-rc.1`, `unverified (CLI not installed)`→`null`, `1.0.0 (claude stub)`→`1.0.0`.

Warning (single line, R4):

```ts
`Warning: capability-declaration-stale: executor ${row.executor} (${row.agentBinary}) reports version "${row.capabilityStale.detected}", but the runner record was verified against ${row.capabilityStale.verifiedAgainst} — session capability flags may have drifted.`
```

**No new API.** JSON shape unchanged (`capabilityStale: {verifiedAgainst, detected}` with raw `detected`); `packages/app/tests/fixtures/json-raw-baseline.json` needs no regen (its `1.2.3` vs `2.1.274` stays stale).

**Anti-patterns.** Per-agent branding strip (`if agent === 'codex'`); a semver dependency or ordering compare; exact-compare fallback when a side has no core; normalizing the displayed `version` column or JSON `detected`; touching ts-ai-runner or its record; importing runner `dist/` internals; restoring the broad no-warning assertion; hard-coding record versions in tests (derive from `getAgentSessionCapability` so upstream re-verification does not break them).

**Dependencies / handoff.** Reads `@gobing-ai/ts-ai-runner@0.4.68` `getAgentSessionCapability` / `resolveAgentName` as-is. No dependent tasks.

### Plan

0. Precondition: tree clean of other tasks' changes (the staged 0888/0889/0898 doc edits belong to the B8 re-verify — commit or set them aside first; one writer per tree). `bun install` resolves `@gobing-ai/ts-ai-runner@0.4.68`.
1. (R1, R2) Add `VERSION_CORE` + `versionCore` and switch `sessionCapabilityFor` to the core compare per Design; update comments `:2847`, `:2905-2907`.
2. (R4) Reword `warnCapabilityStale` (`:707-714`) and its docstring.
3. (R1–R4 tests) In `packages/app/tests/services/agent-service.test.ts` B8 describe: AC1 table (5 branded shapes, JSON + text), AC2 (antigravity-cli unverified), AC3 (branded codex drift + deepseek prerelease drift, exact R4 text, no `codex codex-cli`); tighten the existing R5 text test to the R4 wording. Run `cd packages/app && bun test tests/services/agent-service.test.ts`.
4. (R4) Update `CAPABILITY_STALE_WARNING` in `apps/cli/tests/config-layering.test.ts:90-91`. Run `cd apps/cli && bun test tests/config-layering.test.ts tests/commands/agent.test.ts`.
5. (R5) Update `docs/design/cli-contracts.md:451-454` and `plugins/sp/skills/spur-cli/references/agent.md:169-171`.
6. Host check (manual, record host versions): `bun run apps/cli/src/index.ts agent doctor --force-refresh 2>&1 >/dev/null | rg -c capability-declaration-stale` → expect `0` here (claude 2.1.274, codex 0.154.0, grok 1.0.34, antigravity 1.2.6 on an unverified record).
7. `bun run spur-check` green (if it reports a stale generated plugin bundle, `bun run build:plugin-lib`); `git status --short` shows only the files in Design's table + this task.

### Root Cause

Two defects in `packages/app/src/services/agent-service.ts`:

1. `sessionCapabilityFor` (`:2913-2925`, compare `:2920-2923`) string-compares the runner-detected version verbatim against `verifiedAgainst`. `AgentDetector` returns the raw first `--version` line (`@gobing-ai/ts-ai-runner@0.4.68` `dist/agent-detector.js:45-49`), so branded strings (`2.1.274 (Claude Code)`, `codex-cli 0.154.0`, `omp/18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`, `grok 1.0.34 (3736acbc8658) [stable]`) never equal the bare record version; and a record with no version (`unverified (CLI not installed)`, antigravity-cli/hermes) always differs from any installed CLI. Both report stale.
2. `warnCapabilityStale` (`:707-714`) prints `detects ${agentBinary} ${detected}`, doubling brand-prefixed names (`detects codex codex-cli 0.154.0`) so false positives look like identical versions.

Reproduced 2026-09-18 on `a082d0d93`: `spur agent doctor --force-refresh` → 5 warnings (claude, codex-sol, grok, agy-gemini, agy-opus); `--json` `capabilityStale` non-null for the same rows.

### Solution

- `packages/app/src/services/agent-service.ts` — `sessionCapabilityFor` (agent-service.ts:2929, R2 root-cause fix): staleness requires extractable cores on both sides; a missing core (record `unverified (CLI not installed)`, unparseable detection) is unverifiable → `capabilityStale: null`, no warning. Exact-compare fallback removed. (`versionCore`, core compare, and the R4 warning text already landed with the 0898 merge a082d0d93; this removes the remaining fallback branch.)
- `packages/app/tests/services/agent-service.test.ts` — no-warn table extended to all five AC1 branded shapes (agent-service.test.ts:4515) (claude suffix, codex prefix, omp prefix, openclaw prefix+hash, deepseek prerelease-core match); the fallback-encoding test replaced with R2 behavior (antigravity-cli + detected `1.2.3` → null, no warning); new deepseek prerelease drift case (`0.1.5-rc.2` vs `0.1.5-rc.1`) asserting the exact core-named R4 text.
- `docs/design/cli-contracts.md` + `plugins/sp/skills/spur-cli/references/agent.md` — staleness wording: core-level compare, branding decorations are not drift, token-less is unverifiable and never warns.
- `apps/cli/tests/config-layering.test.ts` — unchanged: already asserts the R4 text for a genuine core mismatch.
- Conflict note: this Solution's earlier "exact-compare fallback" draft was superseded by the concurrent refine (Q2/R2/Design) — implemented null-on-missing-core.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-service.ts:2921-2925` — `versionCore` extracts the first `major.minor[.patch][-prerelease]` token (null when none); `:2939-2943` — `sessionCapabilityFor` compares extracted cores and requires both non-null, so branded detected strings (`2.1.274 (Claude Code)`, `codex-cli 0.154.0`, `omp/18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`, `deepseek-cli 0.1.5-rc.1`) reduce to cores equal to their bare records and yield `capabilityStale: null`. Test `packages/app/tests/services/agent-service.test.ts:4513-4538` asserts `capabilityStale === null` for all five branded shapes (fresh run: pass). No `⚠`/stderr for equal cores: `renderCapsCell` keys the marker off `capabilityStale` (`agent-service.ts:3014-3019`); `warnCapabilityStale` skips null rows (`:710-713`) and its call sites (`:617`, `:652`, `:790`) are text branches only. |
| R2 | MET | `agent-service.ts:2941-2942` — staleness requires `detectedCore !== null && verifiedCore !== null`; a token-less `verifiedAgainst: 'unverified (CLI not installed)'` (or unparseable detection) is unverifiable ⇒ `capabilityStale: null`, no warning. Test `agent-service.test.ts:4540-4556`: antigravity-cli record + detected `1.2.3` asserts `capabilityStale` null AND no `capability-declaration-stale` stderr (fresh run: pass). Detail view display unchanged: `agent-service.ts:3150` still renders raw `verified: <verifiedAgainst>`. |
| R3 | MET | `agent-service.ts:2943` — differing cores set `capabilityStale`; `:710-719` emits one stderr warning per stale row, text branches only; JSON paths return before the warn loop (`:614-621`, `:630-649`, `:771-787`) so `--json` stays stderr-clean (also asserted by `apps/cli/tests/config-layering.test.ts` "0898 R3: doctor --json … clean stderr", fresh pass). Prerelease drift `0.1.5-rc.2` vs `0.1.5-rc.1` warns (`agent-service.test.ts:4559-4576`); branded codex drift `codex-cli 0.999.0` vs `0.154.0` warns (`:4579-4596`). Narrowed 0893 R3 assertion kept and green (`apps/cli/tests/commands/agent.test.ts:903-905`). |
| R4 | MET | `agent-service.ts:716` — as-landed text: `Warning: capability-declaration-stale: executor <e> (<b>) detects version "<raw>" (core X), but the runner record was verified against "<record>" (core Y) — session capability flags may have drifted.` — names executor and binary exactly once, quotes the raw detected string, single line with the required `Warning: capability-declaration-stale:` prefix and `— session capability flags may have drifted.` suffix. Pinned exactly end-to-end: `apps/cli/tests/config-layering.test.ts:90-91` constant + `:221` `toBe` equality on trimmed stderr through the real CLI (fresh pass); fragment-pinned in `agent-service.test.ts:4568-4571,4587-4590`. Literal deviation from the task-doc R4 template ("reports version", unquoted record, no cores) is superseded by AC1's own refined clause "raw values quoted and normalized cores named" (already present at base b38b5bcbc) — residual doc-reconcile risk in Notes. |
| R5 | MET | `docs/design/cli-contracts.md:451-456` — "Staleness is core-level (0899): branding prefix/suffix on the detected string is not drift" and "`null` when fresh — or unverifiable: no version core on either side, e.g. an `unverified (CLI not installed)` record, never warns"; `plugins/sp/skills/spur-cli/references/agent.md:168-172` — same core-compare contract (⚠ only when cores differ; branding not drift; token-less unverifiable and never warns). Both read at HEAD c63c69fe3; docs-behavior parity holds in both T3 surfaces. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `agent-service.test.ts:4513-4538` — no-warn loop over all five branded shapes (suffix `2.1.274 (Claude Code)`, prefix `codex-cli 0.154.0`, prefix `omp/18.2.3`, prefix+hash `OpenClaw 2026.6.11 (e085fa1)`, prerelease-core match `deepseek-cli 0.1.5-rc.1`), each asserting `capabilityStale === null` (fresh pass). Genuine core mismatch warns with raw values quoted + normalized cores named: `agent-service.test.ts:4579-4596` and exact full line `apps/cli/tests/config-layering.test.ts:90-91,221`. Code: `renderCapsCell` `agent-service.ts:3014-3019` keys `⚠` off `capabilityStale`; `warnCapabilityStale` `:710-713` skips null rows, text-only call sites `:617/:652/:790`. `agent-service.test.ts:4540-4556` — unverified antigravity-cli record + detected `1.2.3` ⇒ `capabilityStale` null AND no `capability-declaration-stale` stderr (fresh pass). Code: both-cores-required compare `agent-service.ts:2941-2942` (exact-compare fallback removed — the commit's core change); detail `verified:` display untouched `:3150`. Deepseek prerelease drift `deepseek-cli 0.1.5-rc.2` vs record `0.1.5-rc.1` asserts exact fragments `'"deepseek-cli 0.1.5-rc.2" (core 0.1.5-rc.2)'` and `'"0.1.5-rc.1" (core 0.1.5-rc.1)'` (`agent-service.test.ts:4559-4576`, fresh pass); branded codex drift `codex-cli 0.999.0` vs `0.154.0` asserts `'"codex-cli 0.999.0" (core 0.999.0)'` and `'"0.154.0" (core 0.154.0)'` (`:4579-4596`); exact full R4 line end-to-end via `apps/cli/tests/config-layering.test.ts:221` (`toBe`). Code: warning text `agent-service.ts:716`. |
| AC-7 | MET |  | normalize-then-compare (agent-service.ts:2923,2929): branded detected==verified emits no stale warning; genuine core mismatch warns with quoted raw + named cores; tests agent-service.test.ts:4513,4538,4559 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0899 (commit c63c69fe3, base b38b5bcb)

**Scope:** `git diff b38b5bcb..c63c69fe3` — 5 files: `packages/app/src/services/agent-service.ts`, `packages/app/tests/services/agent-service.test.ts`, `docs/design/cli-contracts.md`, `plugins/sp/skills/spur-cli/references/agent.md`, this task doc.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture.
**Verdict:** APPROVE (PASS — no P1/P2 findings; P3/P4 recorded below, none block).

##### Verification evidence (fresh, this session)

- `cd packages/app && bun test tests/services/agent-service.test.ts -t "0899"` → 4 pass / 0 fail.
- `bun test tests/services/agent-service.test.ts` (full file) → 209 pass / 0 fail (707 expect()).
- `cd apps/cli && bun test tests/config-layering.test.ts tests/commands/agent.test.ts` → 44 pass / 0 fail.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | Tests hard-code live runner record versions (`verifiedAgainst` for claude/codex/omp/openclaw/deepseek, `0.1.5-rc.1`, `0.154.0`) — the Design anti-patterns explicitly forbid this ("derive from `getAgentSessionCapability` so upstream re-verification does not break them"); an upstream re-verify (B8's own release scenario) would break these tests. Pre-existing style for 3 of 5 table rows; this commit deepens it (adds 2 rows + the prerelease drift case). | `packages/app/tests/services/agent-service.test.ts:4517-4523,4569-4571` |
| 2 | P3 (minor) | usability | Task-doc R4 template ("reports version …", unquoted `verifiedAgainst`, no cores; Q5 answered "no cores") does not match the as-landed, test-pinned wording ("detects version … (core …)", quoted `verifiedAgainst`, cores named). Behavior is correct per AC3's core-named fragments; reconcile the doc template or record the supersession so a future doc-faithful edit does not regress. | task doc R4/Design/Q5 vs `packages/app/src/services/agent-service.ts:716`, `apps/cli/tests/config-layering.test.ts:90-91` |
| 3 | P4 (advisory) | correctness | `versionCore` includes `+build` metadata in the core (`[-+]` in the regex), diverging from the Design's frozen regex (`-` only, "build metadata ignored"): `1.2.3+build5` vs record `1.2.3` would warn. Conservative (a rebuild may change behavior; the warning is advisory) and matches the reviewed contract "first semver-shaped token incl. prerelease/build extensions" — record the decision. | `packages/app/src/services/agent-service.ts:2924` |
| 4 | P4 (advisory) | correctness | AC1 no-warn loop asserts JSON `capabilityStale === null` only; text-mode absence of `⚠`/stderr is not directly asserted for the branded shapes. Structurally implied (`renderCapsCell` keys off `capabilityStale`; `warnCapabilityStale` skips null rows and is text-branch-only), but a text-mode pass would pin R1's "no ⚠, no stderr warning" literally. | `packages/app/tests/services/agent-service.test.ts:4525-4537` |
| 5 | P4 (advisory) | usability | Updated cli-contracts sentence reads as a fragment ("…core differs from the record's `verifiedAgainst` core. When it differs, a") — cosmetic grammar only; semantics unambiguous. | `docs/design/cli-contracts.md:451-453` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 core-compare / branding-not-drift | MET | `sessionCapabilityFor` extracts cores on both sides and requires both non-null (`packages/app/src/services/agent-service.ts:2923-2926,2939-2943`); `versionCore` takes the first semver-shaped token — prefix (`codex-cli `, `omp/`), suffix (` (Claude Code)`), hash (` (e085fa1)`), prerelease (`-rc.1`), date versions (`2026.6.11`) all reduce to the bare core. Five branded shapes assert `capabilityStale === null` (`packages/app/tests/services/agent-service.test.ts:4513-4538`); no `⚠` structurally (`renderCapsCell`, `agent-service.ts:3015-3019`). |
| R2 missing-core ⇒ null, no warning | MET | Compare requires `detectedCore !== null && verifiedCore !== null` (`agent-service.ts:2941-2942`); `unverified (CLI not installed)` yields no core ⇒ null. Test: antigravity-cli + detected `1.2.3` ⇒ `capabilityStale` null AND no `capability-declaration-stale` stderr (`agent-service.test.ts:4540-4556`). JSON shape untouched, so the detail `verified:` display is unchanged. |
| R3 genuine drift warns (incl. prerelease) | MET | Differing cores set `capabilityStale` (`agent-service.ts:2941-2943`); one warning per executor, text branches only (`agent-service.ts:617,652,790` → `:710-719`); `--json` stays stderr-clean. Prerelease drift `0.1.5-rc.2` vs `0.1.5-rc.1` warns with exact fragments (`agent-service.test.ts:4559-4576`); the narrowed 0893 R3 assertion is untouched and green. |
| R4 warning wording | MET (as-landed core-named text) | `Warning: capability-declaration-stale: executor <e> (<b>) detects version "<raw>" (core X), but the runner record was verified against "<record>" (core Y) — session capability flags may have drifted.` (`agent-service.ts:716`); executor + binary named once, raw detected string quoted; pinned by `agent-service.test.ts:4568-4571,4587-4590` and `apps/cli/tests/config-layering.test.ts:90-91`. Literal drift from the task-doc R4 template recorded as finding #2 (P3, non-blocking). |
| R5 T3 doc owners describe core-compare | MET | `docs/design/cli-contracts.md:451-456` (core-level staleness; branding not drift; unverifiable ⇒ `capabilityStale: null`, never warns) and `plugins/sp/skills/spur-cli/references/agent.md:168-172` (same contract). |

ACs: AC1 MET — five branded no-warn shapes incl. `omp/18.2.3` prefix and deepseek prerelease-core match (`agent-service.test.ts:4517-4523`); AC2 MET — unverifiable null for antigravity-cli (`:4540-4556`); AC3 MET — exact fragments for branded codex drift (`:4587-4590`) and deepseek prerelease drift (`:4568-4571`).

##### Known doc conflict — assessed

The Solution prose originally prescribed an exact-compare fallback when either side lacked a core. The refined R2 + Design (Q2: unverifiable ⇒ null, never warns) supersede it, and the implementation follows the refined contract: the fallback branch is fully removed (`agent-service.ts:2941-2942`), the in-code comment documents R1/R2 (`:2935-2938`), and the commit message + Solution conflict-note record the supersession. Assessed against R2/Design: correct. The residual tension (Q5 "no cores" vs the landed core-named warning) is finding #2.

##### SECUA summary

- Security: PASS — regex has no nested/ambiguous quantifiers (no ReDoS on hostile `--version` output); warning values interpolated verbatim to stderr, no injection surface change.
- Efficiency: PASS — one short regex per side per row; re-extraction in the warning loop only for non-null stale rows on the text path.
- Correctness: PASS — prerelease extensions participate in the core so `rc.2` ≠ `rc.1` (R3) while branded matches are equal (R1); token-less ⇒ null (R2); `packages/app/tests/fixtures/json-raw-baseline.json` (`1.2.3` vs `2.1.274`) stays stale exactly as the non-goal predicted — no regen needed.
- Usability: PASS — warning quotes the raw string beside its core, eliminating the doubled-name false-positive read; detail `stale:` line (`agent-service.ts:3154`) and JSON shape unchanged.
- Architecture: PASS — `versionCore` is module-private in the service layer with its single consumer (no ts-ai-runner change per Q4, no new public API, no runner `dist/` import).

##### Architecture notes

- Right seam: extractor + compare live in `agent-service.ts` (doctor row construction), the only consumer — the contract changed in ~11 lines without touching callers or the runner.
- Regex contract verified against the live string shapes: `2.1.274 (Claude Code)`, `codex-cli 0.154.0`, `omp/18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`, `grok 1.0.34 (3736acbc8658) [stable]`, `0.1.5-rc.1/2`, `unverified (CLI not installed)`.
- Docs-behavior parity holds in both T3 surfaces; only the task doc's own R4/Q5 text lags the as-landed wording (finding #2).

**Next:** non-blocking — (1) derive record versions in tests from `getAgentSessionCapability`, (2) reconcile the task-doc R4/Q5 template with the landed wording, (3) record the `+build`-in-core decision.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-18T07:00:31.643Z todo → wip (system)
- 2026-09-18T10:49:48.821Z wip → testing (system)
- 2026-09-18T10:50:33.205Z testing → done (system)

