---
schema_version: 1
name: Align RunDao.traceRowById return type with queryFirst SQL-NULL semantics
status: todo
template: issue
created_at: 2026-09-09T01:51:22.437Z
updated_at: "2026-09-09T16:28:34.418Z"

priority: P2
---

## 0815. Align RunDao.traceRowById return type with queryFirst SQL-NULL semantics

### Background

Deferred P4 from task 0809 (verify + re-review findings tables), **retargeted after evaluation
(2026-09-08)**: the original framing blamed `RunDao.traceRowById`'s declared return type. That was
the symptom. The declared type is correct at every layer — the *adapter implementation* lies.

`BunSqliteAdapter.queryFirst` is declared `Promise<T | undefined>` but passes `bun:sqlite`'s
`Statement.get()` straight through with a cast. `get()` returns **`null`** when no row matches, so
every no-row lookup through the bun-sqlite driver resolves to `null` while its type says
`undefined`. The D1 adapter already normalizes (`?? undefined`); the two adapters disagree on the
same interface, which is the actual defect.

The task title still names `RunDao.traceRowById` (no CLI rename surface); read the scope below as
authoritative over the title.

**Scope:** normalize the no-row result to `undefined` in the ts-db bun-sqlite adapter, ship the
`@gobing-ai/ts-db` bump into Spur, then delete the two Spur-side `?? undefined` workarounds and
repair the weakened test assertion that hid this.

**Out of scope:** changing refusal behavior — the `no authoritative row` refusal contract from
0809 R3 must stay exact; the deletions below are behavior-preserving because the adapter now
supplies what the call sites were compensating for. Sweeping every `=== undefined` row comparison
into `== null` style is also out of scope: the adapter fix makes them correct as written.

### Requirements

**R1 — Normalize at the adapter.** `BunSqliteAdapter.queryFirst` returns `undefined`, never `null`,
when no row matches, making its runtime behavior match its declared `Promise<T | undefined>` and
match the D1 adapter. Fix lands in the `@gobing-ai/ts-db` source
(`ts-libs/packages/db/src/adapters/bun-sqlite.ts:99-102`), not in a Spur-side wrapper.

**R2 — Adapter-level regression check in ts-db.** A ts-db test asserts `toBeUndefined()` (not
`toBeFalsy()`) on a no-row `queryFirst` for the bun-sqlite adapter, and fails without the R1 change.

**R3 — Ship the bump.** Spur's `@gobing-ai/ts-db` dependency is raised to the release carrying R1
and the full `bun run spur-check` gate passes on the bumped tree.

**R4 — Remove the compensating workarounds.** With R3 landed, the two `?? undefined` normalizations
and their explanatory comments are deleted — `packages/app/src/workflow/actions/run-artifact.ts:323-327`
and `packages/app/src/services/inline-run-setup.ts:158-160` — with the surrounding refusal /
attach branches byte-for-byte unchanged in behavior.

**R5 — Repair the assertion that hid the defect.** `packages/domain/tests/dao/run-dao.test.ts:215-222`
asserts `toBeUndefined()` instead of `toBeFalsy()`, so the Spur side also fails if a future ts-db
regression reintroduces `null`.

**R6 — Correct the one wrong guard, not the whole class.** `packages/app/src/services/workflow-service.ts:213`
is left semantically correct after R3 (its `=== undefined` now matches reality). No sweep of other
`=== undefined` row comparisons; `packages/domain/src/analytics/run-cost.ts:111` is documented as
unreachable and untouched.

**R7 — Refusal contract preserved.** The `no authoritative row` refusal string and its trigger
condition at `packages/app/src/workflow/actions/run-artifact.ts:328-332` are unchanged (0809 R3),
and the malformed-metadata branch is still reached only for a present-but-unparseable row.

### Acceptance Criteria

- [x] AC1 (R1, R2) — ts-db adapter returns undefined
- [x] AC2 (R1) — D1 parity holds
- [x] AC3 (R3, R5) — Spur sees undefined end to end
- [x] AC4 (R4, R7) — workarounds removed without behavior change
- [x] AC5 (R3, R6) — full gate green

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-09T06:17:57.261Z

**Triage (2026-09-08): KEEP, retargeted.** Operator asked whether this agent-generated deferral is
valid, fixable, and worth keeping.

- **Valid?** Yes, and reproduced. `bun:sqlite` `Statement.get()` returns `null` on no match;
  `BunSqliteAdapter.queryFirst` casts it to `T | undefined` without normalizing, so the declared
  type is a lie at runtime for every bun-sqlite consumer. Proven at the driver level and end to end
  through Spur's own `createDbAdapter` factory — see Root Cause.
- **Direction correct?** No — the original scope ("retype `RunDao.traceRowById`") targets the
  symptom. The root cause is one line in `@gobing-ai/ts-db`, and the sibling D1 adapter already
  normalizes, so this is adapter divergence, not a DAO contract question. Retargeted accordingly;
  the DAO signature needs no change.
- **Worth fixing?** Yes. One line at the root retires two hand-written Spur workarounds that
  `AGENTS.md` explicitly forbids, corrects a wrong guard at `workflow-service.ts:213`, and unhides a
  weakened test assertion. No known shipped path is broken today, so this is P2 hygiene with real
  latent risk — not a P1 outage.
- **Title mismatch:** `spur task update` exposes no rename flag, so the frontmatter name still reads
  "Align RunDao.traceRowById return type…". Background and Requirements are authoritative over the
  title. Rename if a rename surface appears.
- **References section is untouched** — it remains the durable parking spot for the 2026-09-08 A21
  session-review residuals (items 1–6), which are unrelated to this fix and outlive it. If this task
  closes, those six items need a new owner surface first.
- **Not reproduced as a live failure:** no existing test fails today. AC1 is therefore written to
  require the new ts-db test fail against 0.4.60, which is what makes this a regression fix rather
  than a refactor.

#### Q&A entry — 2026-09-09T06:20:00.988Z

**Evidence confidence ledger (2026-09-08 triage).** Separating what was executed from what was
reasoned, so the implementer knows which claims still need proving.

**HIGH — directly executed or read from source:**

- `bun:sqlite` `Statement.get()` returns `null` on no match (executed, bun 1.3.14).
- `RunDao.traceRowById` returns `null` end to end via `createDbAdapter({driver:'bun-sqlite'})`
  (executed as a throwaway probe under `packages/domain/tests/dao/`).
- `bun-sqlite.ts:99-102` lacks the normalization; `d1.ts:72-78` has it (both read).
- `run-dao.test.ts:215-222` asserts `toBeFalsy()` and passes today (read + executed).
- The two `?? undefined` workarounds exist as described (read).
- ts-db is consumed as a **published registry package** — `"@gobing-ai/ts-db": "^0.4.60"` via root
  catalog, resolved to bun's global cache, NOT a workspace link to `~/xprojects/ts-libs` (verified:
  `node_modules/@gobing-ai/ts-db -> ../.bun/@gobing-ai+ts-db@0.4.60+…`). **Plan steps 4–5
  (publish, then bump) are therefore required — a local edit to ts-libs will not reach Spur.**

**MEDIUM — code read and reasoned, not executed:**

- `workflow-service.ts:213` guard inversion. Traced that `createRun` stamps unconditionally and
  `inline-run-setup.ts:254` writes identity inline, hence "latent, not shipped-broken". No test was
  written to prove a fresh-id `createOrAttachRun` skips stamping. **Implementer: confirm or refute
  before relying on the "latent" label.**
- `escalation-packet-sink.ts:171/:272` throw-then-swallow path — reasoned from the guard shape and
  the enclosing `try/catch`, not executed.
- `run-cost.ts:111` unreachable because the query is a bare aggregate (standard SQL semantics;
  not executed against the live schema).

**LOW / unverified:**

- ts-libs release + publish convention was not inspected; Plan step 4 assumes that repo has one.
- "No shipped path is broken today" is an absence claim from partial call-graph tracing across two
  stamping branches, not an exhaustive audit of all 48 `queryFirst` call sites. It is the basis for
  the P2 rating — if the implementer finds a broken shipped path, re-rate to P1.

### Design

**Approach: one-line normalization in the ts-db bun-sqlite adapter.**

```ts
// ts-libs/packages/db/src/adapters/bun-sqlite.ts
async queryFirst<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const stmt = this.getStatement(sql);
    // bun:sqlite's get() returns null on no match; the DbAdapter contract (and D1) say undefined.
    return ((stmt as unknown as { get: (...p: unknown[]) => T | null }).get(...params) ?? undefined) as T | undefined;
}
```

Note the inner cast changes to `T | null` — that is the part that makes the type honest; the
`?? undefined` is what makes the runtime honest. Doing only the latter leaves the next reader
believing `get()` returns `undefined`.

**Alternatives rejected:**

| Option | Verdict |
| --- | --- |
| Retype `RunDao.traceRowById` as `\| null \| undefined` (0815 as originally written) | Rejected. Pushes the lie into 15 DAO signatures and every caller, and leaves 47 other `queryFirst` sites still returning an undeclared `null`. |
| Normalize inside each DAO method | Rejected. Same symptom-level fix, 15 copies, and it does not cover the direct `db.queryFirst` calls in `analytics/`, `migrations.ts`, `retention.ts`. |
| Wrap `createDbAdapter` in `packages/domain/src/db.ts` | Rejected. Exactly the "Spur workaround instead of a facade fix" `AGENTS.md` forbids, and it would not fix D1/other ts-db consumers. |
| Change the `DbAdapter` contract to `T \| null` | Rejected. `undefined` is the established contract that D1 and all 48 call sites already assume; flipping it is a breaking change with no benefit. |

**Tradeoff:** the fix requires a cross-repo release (ts-libs → `@gobing-ai/ts-db` publish → Spur
dependency bump) for a one-line change. That coordination cost is the whole cost of the task, and
the repo already runs this flow routinely (`67d3df340 chore(deps): bump @gobing-ai/ts-* to ^0.4.60`).

**Blast-radius note:** every existing `?.` / `??` / truthiness call site is unaffected (both `null`
and `undefined` behave identically there). Only strict `=== undefined` comparisons change behavior,
and every one of them changes from wrong to right.

### Plan

1. **ts-libs — reproduce at the adapter.** In `ts-libs/packages/db/tests/adapters/`, add a
   no-row `queryFirst` case asserting `toBeUndefined()`. Confirm it FAILS on current source (R2).
2. **ts-libs — apply the fix.** Edit `packages/db/src/adapters/bun-sqlite.ts:99-102` per Design:
   inner cast to `T | null` plus `?? undefined` (R1). Re-run the new test — now passes.
3. **ts-libs — full gate.** Run the `packages/db` suite plus the repo's lint/typecheck/build; confirm
   D1 adapter tests unchanged and green (AC2).
4. **ts-libs — release.** Version-bump and publish `@gobing-ai/ts-db` per that repo's release
   convention. Record the published version here. *Requires operator approval — publishing is an
   external action.*
5. **Spur — bump.** Raise `@gobing-ai/ts-db` in the root `workspaces.catalog` to the published
   version, `bun install`, and **restart the TS server** before trusting diagnostics
   (References item 4: stale LSP module cache after dependency bumps).
6. **Spur — prove the bump end to end.** Fix `packages/domain/tests/dao/run-dao.test.ts:215-222` to
   `expect(row).toBeUndefined()` and drop the now-true comment's parenthetical if it still misleads
   (R5, AC3). Run `cd packages/domain && bun test tests/dao/run-dao.test.ts`.
7. **Spur — delete the workarounds.** Remove the `?? undefined` and the 4-line explanatory comment at
   `packages/app/src/workflow/actions/run-artifact.ts:323-327`, and the same pair at
   `packages/app/src/services/inline-run-setup.ts:158-160` (R4). Leave the `=== undefined` /
   `!== undefined` guards immediately below them untouched.
8. **Spur — assert the refusal contract survived.** Run the `run.artifact` and inline-run-setup tests
   covering the no-row refusal and the malformed-metadata refusal; confirm the exact message strings
   are unchanged (R7, AC4).
9. **Spur — full gate.** `bun run autofix && bun run spur-check && bun run test && bun run build`
   (AC5). If `importer-schema-check` fails on recorded-vs-installed drift, run `spur migrate`
   (References item 6) — that is environment, not a regression.
10. **Record.** Fill Solution (file:line change map), Testing (commands + outcomes), and Review.
    Note in Solution that the task title still names `traceRowById` while the fix is in the adapter.

### Root Cause

`BunSqliteAdapter.queryFirst` casts `bun:sqlite`'s `Statement.get()` result to `T | undefined`
without normalizing, but `get()` returns `null` on no match.

Adapter source (ts-libs) — `packages/db/src/adapters/bun-sqlite.ts:99-102`:

```ts
async queryFirst<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const stmt = this.getStatement(sql);
    return (stmt as unknown as { get: (...p: unknown[]) => T | undefined }).get(...params) as T | undefined;
}
```

The inner cast `{ get: (...) => T | undefined }` is the lie — `get()` is `T | null`.

The sibling D1 adapter already does it right — `packages/db/src/adapters/d1.ts:72-78` ends with
`?? undefined`. Both implement the same `DbAdapter.queryFirst` contract
(`packages/db/src/adapter.ts:43`), so the interface is fine and only bun-sqlite diverges.

**Evidence — driver level:**

```
$ bun -e "import {Database} from 'bun:sqlite'; const d=new Database(':memory:');
  d.run('CREATE TABLE t (id TEXT)');
  console.log(d.prepare('SELECT id FROM t WHERE id = ?').get('nope'));"
null
```

**Evidence — end to end through Spur's own factory** (throwaway probe under
`packages/domain/tests/dao/`, bun 1.3.14, ts-db 0.4.60):

```
createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' })
  → new RunDao(adapter).traceRowById('missing')
  → actual: null | ===undefined: false | ===null: true
```

**Why it stayed hidden:** the not-found regression test asserts `toBeFalsy()`, not
`toBeUndefined()` — `packages/domain/tests/dao/run-dao.test.ts:215-222`. Its own comment claims
"queryFirst returns undefined for no row (SQLite null → undefined)", which the assertion cannot
prove. A weakened assertion sat directly on top of the defect.

**Blast radius:** 48 files call `queryFirst`; 15 call sites are in `packages/domain/src/dao/`.
Optional-chained and `??` call sites are unaffected. Strict `=== undefined` comparisons on
bun-sqlite rows are the exposed class:

- `packages/app/src/services/workflow-service.ts:213` — `if (existing === undefined) await stamp(result.id)`.
  With `null`, a genuinely-new row never gets its identity stamp, inverting the 0784 R1 intent.
  Latent today: `inline-run-setup.ts:254` writes identity inline in the insert and the `createRun`
  branch stamps unconditionally, so no shipped path is known broken — but the guard is wrong and
  the E1 durable named-run path (`packages/app/src/workflow/lifecycle-adapter.ts:171`) routes here.
- `packages/app/src/observability/escalation-packet-sink.ts:171` and `:272` — the null row passes the
  `!== undefined` / `=== undefined` guard, then the property access throws; the surrounding
  `try/catch` swallows it and silently degrades to the generic reason / "not a probe".
- `packages/domain/src/analytics/run-cost.ts:111` — same shape, but the query is a bare aggregate
  that always returns one row, so it is unreachable. Left as-is.

Two call sites already carry hand-written `?? undefined` workarounds with explanatory comments —
`packages/app/src/workflow/actions/run-artifact.ts:323-327` and
`packages/app/src/services/inline-run-setup.ts:158-160` — the exact "Spur workaround instead of a
facade fix" that `AGENTS.md` (Stack & layout) forbids.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

Inline review (run 20260908-2330-devrun-0815-52b8babf, FSM `review`, /sp:dev-review dimensions; fresh-session deviation logged — executed inline per dispatch-eligibility condition 4).

**Functional traceability — PASS.**

- R1 (adapter no-row → undefined): shipped in ts-libs `db77d8a`, published as @gobing-ai/ts-db@0.4.62; worktree lockfile resolves ts-db@0.4.62.
- R3 (bump + gate): catalog `@gobing-ai/ts-*` ^0.4.60→^0.4.62 in full lockstep (ts-db-only bump was tried first and correctly rejected — it split the lockstep and produced dual EventBus identity, TS2345). Quality gate: environment-blocked, documented pre-existing flake (true-BASE fails identically; sets vary per run; standalone all green; CI green on pushed HEAD); proceed-on-evidence per operator decision 7. Task-scoped suites 100% green (run-dao 20/20, run-artifact+inline-run-setup 40/40, db.test 39/39).
- R4 (delete exactly two `?? undefined` workarounds): run-artifact.ts and inline-run-setup.ts — both deleted with their now-stale comments; surrounding refusal/attach branches byte-identical; 0809 R3 refusal contract intact (`runRow === undefined` branch unchanged and now correct as written).
- R5 (run-dao.test.ts toBeFalsy→toBeUndefined): applied at :220, comment preserved.
- db.test.ts:111 no-row toBeNull→toBeUndefined: required consequence of the adapter fix (test codified the old bug); not the out-of-scope `=== undefined` sweep.

**SECUA — PASS.** No security/auth/input/SQL surface touched (pure deletions + dep bump); correctness improved at the adapter layer (D1 parity); stale compensating comments removed.

**Architecture — PASS.** Normalization lives at the adapter (the layer that lies), deleting per-call-site compensation — deepening, not widening.

**Findings (informational, non-blocking):**

1. `bun install` synced BASE-stale bun.lock workspace versions 0.3.77→0.3.78 to the true HEAD manifests (pre-existing drift, benign).
2. Test-hermeticity candidate: worktree `.spur/config.yaml` (gitignored, absent in CI) leaks into CLI tests via cwd-discovery fallback — workflow-list tests fail in worktrees, pass in CI. Out of 0815 scope; candidate lesson/issue.

### References

Durable parking spot for session-review residuals (2026-09-08 A21 batch session). Items 1–3 are host-approved deferrals whose original records live in done task files (0812/0813); this list is the going-forward owner surface. Item 4–6 are process/environment findings.

1. **Deferred: importer timeout `Promise.race` fallback** — `packages/app/src/services/history-service.ts:432` wraps the import promise in a `Promise.race` timeout; A21 (0813) host-approved deferring the native-deadline replacement of this fallback. Direction: revisit once scheduler/history consumers fully run on shared native execution policies; verify no double-kill semantics.
2. **Deferred: ts-db README queue-delivery statement** — ts-libs repo README lacks an explicit at-least-once (no exactly-once) delivery statement for the queue-job lease path (P3b residual from A21 0812/0813). Direction: one-paragraph semantics note in the ts-db README next time that package ships.
3. **Deferred: P4 sweep-reason vocabulary** — user-facing sweep reason string retained deliberately at `apps/server/src/serve.ts:273` (asserted `apps/server/tests/serve.test.ts:1373`); only wrong code comments were fixed in 0813. Direction: rename alongside the next user-visible sweep-surface change, not standalone.
4. **Environment: TS server stale module cache after dependency bumps** — after `bun install` version changes, the LSP keeps serving pre-bump types (this session: 6 false positives on `bounded-child-run*`, all ledger-dispositioned). Direction: restart the TS server (or session) after dependency sync before trusting diagnostics.
5. **Process: cog rejects default merge-commit messages** — every merge needs the manual `chore: merge <branch> into main` rename (precedent `12c913716`, `f2265f4d7`). Direction: lefthook `prepare-commit-msg` rewrite or a documented convention in AGENTS.md.
6. **Process: importer-schema drift after dependency bumps** — `importer-schema-check` fails with recorded-vs-installed version drift in gitignored `.spur/spur.db`; remedy is a manual `spur migrate` per checkout. Direction: fold the migrate into the check's remedy path or a postinstall hook.

### History
