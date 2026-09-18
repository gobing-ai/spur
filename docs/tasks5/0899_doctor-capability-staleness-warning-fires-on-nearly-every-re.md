---
schema_version: 1
name: Doctor capability-staleness warning fires on nearly every real install (unnormalized detected version strings)
status: wip
template: issue
created_at: 2026-09-18T06:51:40.161Z
updated_at: "2026-09-18T07:06:41.464Z"
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

- [ ] R1. Staleness is decided on the **version core**: the first `major.minor[.patch][-prerelease]` token of the detected string vs the same token of `verifiedAgainst`. A branded detected string whose core equals the record's (`2.1.274 (Claude Code)`, `codex-cli 0.154.0`, `omp/18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`, `grok 1.0.34 (3736acbc8658) [stable]`) yields `capabilityStale: null`, no `⚠`, no stderr warning.
- [ ] R2. A record or detected string with no version core (e.g. `verifiedAgainst: 'unverified (CLI not installed)'`) is **unverifiable**: `capabilityStale: null`, no `⚠`, no warning. The detail view keeps showing `verified: unverified (CLI not installed)`.
- [ ] R3. Genuine drift still warns (B8 R7 unchanged): differing cores (incl. differing prerelease, `0.1.5-rc.2` vs `0.1.5-rc.1`) keep `capabilityStale`, the `⚠` cell marker, and one text-mode stderr warning per executor; JSON stays stderr-clean.
- [ ] R4. The stderr warning names the executor and binary once and quotes the raw detected string: `Warning: capability-declaration-stale: executor <executor> (<agentBinary>) reports version "<detected>", but the runner record was verified against <verifiedAgainst> — session capability flags may have drifted.`
- [ ] R5. T3 owners describe the core-compare contract: `docs/design/cli-contracts.md:451-454` and `plugins/sp/skills/spur-cli/references/agent.md:169-171`.

Non-goals: no ts-ai-runner change or re-declared `verifiedAgainst`; no JSON shape change (`version` and `capabilityStale.detected` stay raw); no semver ordering (equality only); no change to the doctor detail `stale:` line; no change to the narrowed 0893 R3 assertion.

### Acceptance Criteria

- [ ] AC1 — A stale capability declaration is surfaced (req: R1, R2, R3): regression scenario — an executor whose detected version matches `verifiedAgainst` modulo branding prefix/suffix emits NO `capability-declaration-stale` warning (suffix, prefix, prefix+suffix shapes asserted); a genuine core mismatch warns with raw values quoted and normalized cores named.

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

- `packages/app/src/services/agent-service.ts:2923` — new `versionCore()` extractor (first semver-shaped token, null when none).
- `packages/app/src/services/agent-service.ts:2929` — `sessionCapabilityFor` compares extracted cores (branding suffix/prefix no longer drift); falls back to exact compare when either side has no core (drift unknowable still warns).
- `packages/app/src/services/agent-service.ts:710` — `warnCapabilityStale` reworded: raw values quoted, normalized cores named; JSON `capabilityStale` shape unchanged (raw values) for contract stability.
- `packages/app/tests/services/agent-service.test.ts:4513,4538,4559` — +3 tests: branded-match no-staleness regression (claude suffix / codex prefix / openclaw prefix+suffix), unextractable-core fallback still warns (antigravity-cli), R2 warning shape (quoted raw + cores).
- `apps/cli/tests/config-layering.test.ts:90` — `CAPABILITY_STALE_WARNING` constant updated to the reworded text (stub `1.0.0 (claude stub)` vs record `2.1.274` still genuinely stale).
- `apps/cli/tests/commands/agent.test.ts:903` — R4 decision recorded: narrowed usage-scoped assertion kept; post-normalization a host with real drift still legitimately warns, so the broad form would be host-dependent.
Rationale: normalize-then-compare fixes the false-positive class at the single compare site; no upstream ts-ai-runner change.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-18T07:00:31.643Z todo → wip (system)

