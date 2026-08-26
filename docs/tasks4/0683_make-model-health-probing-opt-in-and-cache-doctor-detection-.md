---
schema_version: 1
name: "Make model health probing opt-in and cache doctor detection with a dated cache and --force-refresh"
status: todo
template: feature-impl
created_at: 2026-08-26T18:52:01.265Z
updated_at: "2026-08-26T19:32:29.288Z"
feature_id: B4
priority: P2
tags: ["cli", "agent", "doctor", "performance"]
dependencies: ["0681"]
---

## 0683. Make model health probing opt-in and cache doctor detection with a dated cache and --force-refresh

### Background
`spur agent doctor` takes 6.20 s against the 15-executor global config (boot floor 0.28 s; `spur agent list`, which does detection only, 1.62 s). Measured 2026-08-26 at HEAD `212972e74`.

The cost is **not** provider traffic, contrary to appearance: `DoctorRunner.probeModel` short-circuits to `{status:'unknown', detail:"API key not found for provider '<p>'"}` before issuing any HTTP when `{PROVIDER}_API_KEY` is absent (`~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts` → `probeModel`, verified in the installed build at `node_modules/@gobing-ai/ts-ai-runner/dist/doctor-runner.js:96-117`) — which is also why all 15 MODEL cells read `unknown`. The ~4.6 s is per-executor auth probing, owned by sibling task 0684. What remains after that lands is detection (~1.3 s of `--version` subprocesses), which this task caches.

Two separate hazards are addressed here. First, `probeModel` fires the moment a provider key happens to be exported, making the command's latency and network behavior a function of the operator's shell — invisible, and the hidden automation AGENTS.md rules out. Second, without a cache the command re-runs full detection on every invocation.

`spur agent doctor` currently accepts only `--json` (`apps/cli/src/commands/agent.ts:40-49`), and `AgentService.doctor` only `{ json, agent }` (`packages/app/src/services/agent-service.ts:443`) — both signatures widen here. `AgentServiceContext` carries `cwd` but no injected `FileSystem`; the established in-service pattern is `createNodeFileSystem(this.ctx.cwd)` (`agent-service.ts:1875`, `:1945`).

Design: `docs/design/agent-doctor-inspection-surface.md` §5.
### Requirements
- [ ] R1. A `--probe-health` flag gates model health probing. Without it, **no** model health request is issued regardless of environment. With it, health is probed and reported as today. Implementation needs no `DoctorRunner` change: the runner probes iff `executor.model` is set (`doctor-runner.js:75`, `:89`), so Spur passes a `model`-stripped copy of the `executors` array to the `DoctorRunner` constructor unless the flag was given.

- [ ] R2. The MODEL *column* is unaffected by `--probe-health` — it reads Spur's own config, not the probe result (sibling task 0681 owns the column). The stripped array goes **only** to the `DoctorRunner` constructor; `renderDoctor` keeps receiving the unmodified `this.ctx.agentConfig?.executors`.

- [ ] R3. Detection results are cached at `.spur/run/agent-doctor.json`, keyed on an **executor-set fingerprint** (name + agent + model + capability tier, over the full configured set in a stable order) so a config edit invalidates the cache, with a **60 s TTL**.

- [ ] R4. A cache hit prints its age in the footer. A readiness report is only useful if the reader knows whether it is live; a silently cached `usable` for a dead executor is a worse failure than a slow command. Under `--json` the same fact is carried structurally (`cache: { hit, ageMs, path }`), never only in prose.

- [ ] R5. `--force-refresh` bypasses the cache, re-runs detection for every executor, rewrites the cache file, and its output is **not** marked as cached.

- [ ] R6. An unreadable, malformed, or stale-schema cache file degrades to a live run, succeeds, and rewrites the file with a valid result. It never fails the command. A cache *write* failure is likewise non-fatal — the command still prints a live result.

- [ ] R7. `--probe-health` results are **never** cached — a health probe is a liveness question by definition. With the flag set the cache is neither read nor written.

- [ ] R8. Cache scope is the full-set detection path (`runAll`). A single-executor or role selector is **served** from a fresh cache when one exists, but a miss on those paths runs only what the selector needs (`runOne`) and writes nothing — a partial row set must never be persisted under a full-set fingerprint. Q&A Q2 records why, and corrects the design doc's §5.2 claim that `doctor.probe` hits warm.

- [ ] R9. Same-commit doc sync (T3): both flags in `docs/04_DESIGN.md` and `plugins/sp/skills/spur-cli/references/agent.md:28`; a row for `agent-doctor.json` in the `.spur/run/` artifact-kind disposition (`docs/design/run-record-contract.md`), which today lists only per-run and per-WBS artifacts — this is the first run-id-independent one; and the corrected §5.2 rationale in `docs/design/agent-doctor-inspection-surface.md`.

- [ ] R10. ADR-051 consent for both flags is recorded: they are flags on the existing `doctor` verb (expansion via flags, not a new noun/verb), consented by the operator in the B4 planning session 2026-08-26.
### Acceptance Criteria
Covers these feature B4 scenarios (titles are the traceability keys — byte-identical to `docs/features/B4_*.md`):

- [ ] R9 — Model health probing is opt-in
- [ ] R10 — Detection results are cached and the cache is visibly dated
- [ ] R11 — --force-refresh bypasses the cache and rewrites it
- [ ] R14 — A corrupt or unreadable cache file degrades to a live run
### Q&A
**Q1. Where does the cache I/O seam live, so it is testable without disk?**
**Closed — `AgentRunDeps`.** `AgentServiceContext` carries `cwd` but no `FileSystem`, and the
in-service pattern is `createNodeFileSystem(this.ctx.cwd)` (`agent-service.ts:1875`, `:1945`).
Widening the *context* would touch every construction site; `AgentRunDeps` already exists as the
doctor path's test seam (`doctorRunner` is injected there). Add optional `fileSystem?: FileSystem`
and `now?: () => number` to `AgentRunDeps`, defaulting to `createNodeFileSystem(this.ctx.cwd)` and
`Date.now`. Rejected: a module-level singleton (untestable TTL), and faking the clock globally.

**Q2. Does the detection cache actually make `doctor.probe` cheaper?**
**Closed — no, and the design doc's §5.2 rationale is corrected in this task.** `doctor.probe` runs
`spur agent doctor <exe> --json` (`doctor-probe.ts:141-147`) — a single-executor selector, which takes
`runOne`, not `runAll`. Caching only the full-set path means the precheck hits warm solely when a full
`spur agent doctor` ran within the TTL, which in a pipeline it has not. The two alternatives were
weighed and rejected: (a) populating the full cache from a single-executor miss makes a narrow query
pay ~1.3 s of detection it did not ask for, to warm a 60 s window a pipeline crosses minutes apart;
(b) persisting a partial row set under a full-set fingerprint would let a later full run read a cache
missing most of its executors. The precheck's real cost is the auth probe, and 0684 removes it —
so §5.2's "1–2 calls per pipeline precheck hit warm" is replaced with the honest statement that the
cache serves repeated interactive `doctor` runs and 0684 serves the precheck.

**Q3. Why 60 s?**
**Closed — kept from the design.** Short enough that a human debugging a routing failure sees fresh
data on their second look; long enough to absorb a burst of consecutive `doctor` invocations. The
tradeoff is deliberately biased toward freshness because the cached value is a readiness claim, and
the fingerprint (not the TTL) is what catches the common invalidation case — a config edit.

**Q4. `.spur/run/agent-doctor.json` is not addressed by a run id — is that acceptable?**
**Closed — yes, with a disposition row.** Every artifact in `docs/design/run-record-contract.md`'s
inventory is `<RUNID>`- or `<wbs>`-keyed; this is the first global one. `.spur/run/` is gitignored
process scratch, the file is self-invalidating on both fingerprint and TTL, and inventing a second
directory for one 60 s cache is not worth the surface. R9 obliges adding the row so the inventory
stops implying that everything under `.spur/run/` belongs to a run.

**Q5. What happens on a cache write failure (read-only FS, race)?**
**Closed — non-fatal.** The command prints the live result and continues (R6). A readiness check must
not fail because a cache could not be persisted. Write atomically (temp + rename), matching the
`.state.json` convention in the run-record contract.

**Deferred:** nothing. No open decision blocks implementation.
### Design
**WHAT:** Two independent cost controls on the same command, sharing one code path.

**WHERE (primary targets):**

| File | Change |
| --- | --- |
| `apps/cli/src/commands/agent.ts:40-49` | two `.option()` declarations; thread into `svc.doctor(...)` |
| `packages/app/src/services/agent-service.ts:443-478` | widen `doctor()` args; strip `model` for the runner; cache read/write around `runAll()` |
| `packages/app/src/services/agent-service.ts` (`AgentRunDeps`) | optional `fileSystem?` and `now?` test seams (Q1) |
| `apps/cli/tests/commands/agent.test.ts`, `packages/app/tests/services/agent-service.test.ts` | flag plumbing, cache hit/miss/corrupt/force, `--probe-health` suppression |
| `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/agent.md`, `docs/design/run-record-contract.md`, `docs/design/agent-doctor-inspection-surface.md` | T3 same-commit doc sync |

**Frozen names (do not rename during implementation):**

```ts
// CLI flags
'--probe-health'    // opt into model health probing
'--force-refresh'   // bypass and rewrite the detection cache

// service signature
doctor(args: { json: boolean; agent?: string; probeHealth?: boolean; forceRefresh?: boolean }, deps?: AgentRunDeps): Promise<number>

// cache
const DOCTOR_CACHE_REL = '.spur/run/agent-doctor.json';
const DOCTOR_CACHE_TTL_MS = 60_000;

interface DoctorCacheFile {
    schemaVersion: 1;
    fingerprint: string;   // executorFingerprint(executors)
    capturedAt: string;    // ISO-8601
    results: DoctorResult[];
}

function executorFingerprint(executors: readonly AgentExecutorConfig[] | undefined): string;

// AgentRunDeps additions (test seams, Q1)
fileSystem?: FileSystem;
now?: () => number;
```

`--json` gains a sibling of `agents`: `cache: { hit: boolean; ageMs: number | null; path: string }`.

**Precedence / algorithm:**

1. `--probe-health` set → skip the cache entirely (neither read nor write, R7) and pass the executors array **with** `model` to `DoctorRunner`.
2. Otherwise pass a `model`-stripped copy (`{ name, agent }`) to the `DoctorRunner` constructor. `renderDoctor` still receives the unmodified config array (R2).
3. Full-set path (no selector): `--force-refresh` → skip the read. Else read `DOCTOR_CACHE_REL`; serve when `schemaVersion === 1` **and** `fingerprint` matches **and** `now() - Date.parse(capturedAt) < DOCTOR_CACHE_TTL_MS`. Any other outcome (missing, unreadable, malformed, wrong schema, wrong fingerprint, expired) → live `runAll()`.
4. After a live `runAll()` on the full-set path, write the cache atomically (temp + rename). A write failure is swallowed after a stderr note; the command still returns its result (R6, Q5).
5. Selector paths (`doctor <executor>` / `doctor <role>`): served from a *fresh, fingerprint-matching* cache when one exists; otherwise run what the selector needs and write nothing (R8, Q2).
6. Fingerprint input: for each executor in `name`-ascending order, `name|agent|model ?? ''|getExecutorTier(executor)`, joined by `\n`, hashed with `node:crypto` `createHash('sha256')` → hex. Sorting makes the key independent of config ordering; including the tier makes a tier-inference change invalidate too.
7. Footer on a cache hit: `… · cached 12s ago (.spur/run/agent-doctor.json) — --force-refresh to re-detect`. Absent on a live run.

**WHY `--probe-health` needs no runner change:** `DoctorRunner` decides to probe with `executor.model ? await this.probeModel(...) : null` (`doctor-runner.js:75`, `:89`). Spur builds the `executors` array it hands the runner, so omitting `model` from that array suppresses the probe without touching the published package. The MODEL column reads Spur's config directly and is unaffected — the two uses of `model` were only ever coupled by accident.

**WHY opt-in rather than automatic:** today the probe fires on the presence of an environment variable, so latency and network egress vary with the operator's shell in a way nothing surfaces. AGENTS.md: deterministic over implicit, no hidden automation. Opt-in makes the default path deterministically zero-network.

**WHY the cache is fingerprinted, not just timed:** a TTL alone would serve a stale answer across a config edit, which is exactly when an operator is most likely to be running `doctor` to check their work. Keying on the executor set makes a config change invalidate immediately, and the TTL then only bounds staleness against the *world* (an agent installed or removed).

**WHY 60 s:** short enough that a human debugging a routing failure sees fresh data on their second look; long enough to absorb a burst of consecutive invocations. The tradeoff is deliberately biased toward freshness because the cached value is a readiness claim. (Q2 corrects the design doc's separate claim about pipeline prechecks — they are 0684's win, not the cache's.)

**WHY the age line is a requirement, not a nicety:** it is what makes caching a readiness report acceptable at all. Without it the command can assert `usable` about a dead executor with no way for the reader to tell.

**Anti-patterns — do not implement:**

- Do not add a config knob for the TTL or the cache path. One constant each; a value that never varies is a constant, not a knob.
- Do not write the cache from a single-executor or role selector — a partial row set under a full-set fingerprint poisons later full runs (R8).
- Do not cache anything when `--probe-health` is set (R7).
- Do not let a cache read or write error fail the command, and do not swallow it silently either — a stderr note, then continue.
- Do not mutate `this.ctx.agentConfig.executors` in place to strip `model`; build a copy. The same array is read by `renderDoctor` for the MODEL column.
- Do not touch `DoctorRunnerOptions` or `~/xprojects/ts-libs` — that is 0684.
- Do not add a new CLI noun or verb; both are flags on the existing `doctor` verb (ADR-051).

**Cross-task handoff:**

- **Assumes from 0681:** the MODEL column already reads `AgentExecutorConfig.model` rather than `modelStatus`. Without that, stripping `model` for the runner would blank the column. If 0683 lands before 0681 for any reason, that coupling must be re-checked first.
- **Leaves for 0684:** the cache bounds repeat cost for interactive runs; it does **not** address the pipeline precheck. 0684's `probeAuth: false` is the only thing that does, and its R5 timing measurement must be taken with `--force-refresh` so a warm cache cannot flatter the number.
### Plan
1. [ ] **Baseline capture** — time `bun run apps/cli/src/index.ts agent doctor` three times against the 15-executor global config with and without a provider key exported; record both in `## Solution` as the before-state for R1 and R3.
2. [ ] **(R1, R10) Declare the flags** — add `--probe-health` and `--force-refresh` to `apps/cli/src/commands/agent.ts:40-49` and thread them into `svc.doctor({ json, agent, probeHealth, forceRefresh })`. Widen the `doctor()` signature at `agent-service.ts:443`.
3. [ ] **(R1, R2) Strip `model` for the runner** — at `agent-service.ts:444-445`, build `const runnerExecutors = probeHealth ? executors : executors?.map(({ name, agent }) => ({ name, agent }))` and pass that to the `DoctorRunner` constructor. Leave every `renderDoctor(results, executors, …)` call site reading the unmodified array.
4. [ ] **(R1) Pin the suppression** — test that without `--probe-health` the `DoctorRunner` constructor receives executors carrying no `model` key, and with it receives the full config. Assert on the constructor argument, not on network traffic — that is the observable Spur controls.
5. [ ] **(R2) Pin the decoupling** — test that the MODEL column still renders the pinned model string with `--probe-health` absent. This is the assertion that fails if step 3 strips the wrong array.
6. [ ] **(R3) Add the fingerprint** — `executorFingerprint(executors)` per the Design step-6 algorithm (`name`-ascending, `name|agent|model ?? ''|tier`, `\n`-joined, sha256 hex via `node:crypto`). Unit-test that reordering config entries yields the same hash and that changing any one field does not.
7. [ ] **(Q1) Add the test seams** — optional `fileSystem?: FileSystem` and `now?: () => number` on `AgentRunDeps`, defaulting to `createNodeFileSystem(this.ctx.cwd)` and `Date.now` at the call site (the existing pattern at `agent-service.ts:1875`).
8. [ ] **(R3, R4) Cache read on the full-set path** — before `runAll()` at `agent-service.ts:459`, attempt the read and serve on `schemaVersion === 1` && fingerprint match && age < `DOCTOR_CACHE_TTL_MS`. Carry `{ hit, ageMs, path }` through to rendering.
9. [ ] **(R4) Surface the age** — append the cache clause to the table footer on a hit, and emit the `cache` object under `--json`. A live run emits `cache: { hit: false, ageMs: null, path }` — the key is always present so a consumer never has to distinguish absent from false.
10. [ ] **(R3, R6) Cache write** — after a live full-set `runAll()`, write atomically (temp + rename). Wrap read and write in try/catch: on failure emit one stderr note and continue with the live result. Never throw out of the cache layer.
11. [ ] **(R5) `--force-refresh`** — skip the read, run detection, rewrite the file, and render with `cache.hit === false`. Test that the file's `capturedAt` advances and the output carries no cached marker.
12. [ ] **(R6) Corruption edge tests** — four cases, each asserting exit code 0, a live result, and a rewritten valid file: malformed JSON; `schemaVersion: 0`; a fingerprint from a different executor set; `capturedAt` older than the TTL. Plus a fifth: an unwritable cache path still returns a live result.
13. [ ] **(R7) `--probe-health` bypasses the cache** — test that with the flag set no cache file is read and none is written, even when a fresh valid one exists.
14. [ ] **(R8) Selector-path behavior** — test that `doctor <executor>` served from a fresh matching cache does not invoke `runOne`, and that on a miss it invokes `runOne` and writes **no** cache file.
15. [ ] **(R9) T3 doc sync in the same commit** — both flags and the `cache` JSON field in `docs/04_DESIGN.md` and `plugins/sp/skills/spur-cli/references/agent.md:28`; an `agent-doctor.json` row in the `.spur/run/` disposition table in `docs/design/run-record-contract.md` noting it is the first run-id-independent artifact; and replace the "1–2 calls per pipeline precheck hit warm" line in `docs/design/agent-doctor-inspection-surface.md` §5.2 per Q&A Q2.
16. [ ] **Verification** — targeted first: `bun test packages/app/tests/services/agent-service.test.ts` and `bun test apps/cli/tests/commands/agent.test.ts`. Then `bun run autofix && bun run spur-check`. Re-run the step-1 timings cold (`--force-refresh`) and warm; paste both into `## Solution` and state plainly that the auth probe still dominates until 0684 lands.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/B4_agent-doctor-as-the-routing-inspection-surface-capability-tier-rendering-full-eligible-ladder-auth-removal-and-cached-probes.md` (scenarios R9, R10, R11, R14)
- Design: `docs/design/agent-doctor-inspection-surface.md` §5 (cost control), §5.1 (`--probe-health`), §5.2 (detection cache — §5.2's precheck rationale is corrected by this task, Q&A Q2)
- `.spur/run/` artifact inventory: `docs/design/run-record-contract.md` (R9 adds the `agent-doctor.json` row)
- Siblings: 0681 (MODEL column decoupling — assumed), 0682 (auth field removal), 0684 (ts-libs `probeAuth` — the actual fix for the 4.6 s)
- ADR-051 (CLI surface governance — flags on an existing verb; operator consent recorded 2026-08-26)
- Upstream behavior verified in: `node_modules/@gobing-ai/ts-ai-runner/dist/doctor-runner.js:75`, `:89`, `:96-117` (source `~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts`)
- Surfaces touched: `apps/cli/src/commands/agent.ts`, `packages/app/src/services/agent-service.ts`, `apps/cli/tests/commands/agent.test.ts`, `packages/app/tests/services/agent-service.test.ts`, `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/agent.md`, `docs/design/run-record-contract.md`
### History
