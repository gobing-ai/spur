---
schema_version: 1
name: Dedup inert-var cells in idea-pipeline routing parity truth table
status: todo
template: feature-impl
created_at: 2026-09-26T07:23:28.154Z
updated_at: "2026-09-26T07:31:45.679Z"
feature_id: D64

---

## 0974. Dedup inert-var cells in idea-pipeline routing parity truth table

### Background

Found during the 2026-09-26 `/sp:dev-review-session --triage`. The test
`packages/app/tests/workflow/idea-pipeline-routing.test.ts:256`, "live route guards match the frozen pre-refactor
oracle over the full cross product", dominates this file's runtime.

- **Measured 2026-09-26** (bun 1.3.14, macOS): `(cd packages/app && bun test
  tests/workflow/idea-pipeline-routing.test.ts)` reports 5 pass, 3526 `expect()` calls, **24.74 s** wall time.
  An earlier run under load took about 34 s. The test overrides its timeout to `60000` (`:316`).

**Root cause** (`:256-316`):
1. The loops enumerate `profile` (3 values), the answer var `__hitlAnswer` (4), `DESIGN_VALUES` (2),
   `NEEDS_VALUES` (4), `STATUS_VALUES` for ac (3) and for cov (3), then 4 edge `cases`. That gives
   `expect(cells).toBe(3456)`.
2. Each case pins its **inert** var at `:297`. The `ac-generate→*` oracle guards (`:77-82`) read `$profile`,
   so they pin `__hitlAnswer` to `'yes'`. The `feature-check→*` guards (`:83-88`) read `$__hitlAnswer`, so
   they pin `profile` to `'auto'`.
3. After pinning, the loop value of the inert var has no effect. The ac-generate cells therefore repeat 4× and
   the feature-check cells 3×.
4. Every cell runs `evaluatePair` (`:126`), which costs one `spawnSync('/bin/sh', …)` (`:161`). The writer spawn at
   `:151` is already memoised per file state through `stateDirs`.

**Arithmetic:** there are 3456 / (3 profiles × 4 answers × 4 cases) = 72 file-state combos. Per combo,
48 evaluations run but only 14 are unique (2 ac-generate edges × 3 profile values + 2 feature-check edges × 4 answer
values). That makes **1008 unique cells of 3456 (29%)**, so the expected runtime after the fix is roughly 7–8 s.

### Requirements

- **R1** Restructure the parity loop so each case enumerates only its **live** var:
  - Give each case a `liveVar` (`'profile'` or `'__hitlAnswer'`) and its `liveValues`.
  - Keep `inertVar`/`fixed` as they are.
  - The outer loops cover only the file-state dimensions (design × needs × ac × cov).
  - For each case, iterate its `liveValues`, set `{ [c.liveVar]: v, [c.inertVar]: c.fixed }`, and call
    `evaluatePair` once.
  - Keep `evaluatePair`, `ORACLE_GUARDS`, `guardCommand` and the writer memo unchanged.
- **R2** Keep the parity semantics:
  - Assert every unique cell's oracle-vs-live comparison with the same `describeState` failure message.
  - Update the inert-var comment (`:293-294`) to explain that the inert var is pinned *and not enumerated*.
- **R3** Change the tripwire to `expect(cells).toBe(1008)`, with a one-line derivation comment:
  `// 72 file states × (2 ac-generate edges × 3 profiles + 2 feature-check edges × 4 answers)`.
- **R4** Remove the `60000` timeout override if the measured runtime is under 2.5 s. Otherwise set it to about
  3× the measured runtime, rounded up to 5 s.
- **R5** Do not memoise or batch spawns (the rejected alternatives in `### Design`). Scope is the loop
  restructure only.

### Acceptance Criteria

- [ ] `(cd packages/app && bun test tests/workflow/idea-pipeline-routing.test.ts)` shows 5 pass, 0 fail.
      Its wall time is ≤ 40% of a pre-change run measured on the same machine in the same session. Record both
      numbers in `### Testing`; the filing-time baseline was 24.74 s.
- [ ] The tripwire asserts `1008`, and the derivation comment is present.
- [ ] Mutation check: temporarily replace `ORACLE_GUARDS['feature-check→decompose']`'s leading
      `test "$__hitlAnswer" = yes` with `test "$__hitlAnswer" = no`. The parity test must fail. Revert.
- [ ] Mutation check 2: temporarily change `ORACLE_GUARDS['ac-generate→decompose']`'s `test "$profile" = auto` to
      `test "$profile" = standard`. The parity test must fail. This proves the live var is still enumerated.
      Revert.
- [ ] `bun run spur-check` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T07:31:30.360Z

- **Q: Does dropping the inert-var enumeration lose coverage?** A: No. At `:297` the pinned value overwrote the
  enumerated one, so both guards already saw the same `c.fixed` value in every duplicate. The duplicates asserted
  identical things.
- **Q: Should the pinned value itself be enumerated?** A: No. It stays fixed at the value that lets the live
  var decide the route; this is the documented design of the 0945 parity test. Changing it is out of scope.

### Design

Sketch of the restructured loop (replaces `:257-315`):

```ts
const cases = [
    ...['system-design', 'decompose'].map((to) => ({
        edge: `ac-generate→${to}`, from: 'ac-generate', to,
        liveVar: 'profile' as const, liveValues: ['auto', 'standard', ''],
        inertVar: '__hitlAnswer' as const, fixed: 'yes',
    })),
    ...['system-design', 'decompose'].map((to) => ({
        edge: `feature-check→${to}`, from: 'feature-check', to,
        liveVar: '__hitlAnswer' as const, liveValues: ['yes', 'no', 'cancel', ''],
        inertVar: 'profile' as const, fixed: 'auto',
    })),
];
let cells = 0;
for (const design of DESIGN_VALUES)
    for (const needs of NEEDS_VALUES)
        for (const ac of STATUS_VALUES)
            for (const cov of STATUS_VALUES)
                for (const c of cases)
                    for (const v of c.liveValues) {
                        const cell: RouteState = {
                            vars: { design, [c.liveVar]: v, [c.inertVar]: c.fixed },
                            needs: needs.content, ac: ac.content, cov: cov.content,
                        };
                        // …same oracle/live lookup, evaluatePair, and expect as today…
                        cells++;
                    }
expect(cells).toBe(1008);
```

Keep Biome formatting (4-space indentation, braces on the `for` bodies); the sketch is compressed for reading.

Rejected alternatives:
- **Memoise `evaluatePair` by (edge, effective vars, state).** It gives the same speed-up but keeps a misleading
  3456 enumeration and adds a cache whose key must be kept correct forever.
- **Batch the cells for one cwd into a single `sh` spawn.** It could cut the time further, but it changes the
  harness's failure isolation and parse contract. Revisit only if R1 lands above the AC threshold.

### Plan

1. Baseline: run `(cd packages/app && bun test tests/workflow/idea-pipeline-routing.test.ts)` twice. Record the
   lower wall time.
2. Apply R1–R3 per the `### Design` sketch. Run the test file; expect 5 pass and a fall in the `expect()` count from
   3526 to about 1078.
3. Measure the wall time twice. Apply R4 based on the lower number.
4. Run both mutation checks from the AC, reverting each.
5. Run `bun run spur-check`. Commit as `test(app): enumerate only live vars in idea routing parity`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/tests/workflow/idea-pipeline-routing.test.ts:53` (`guardCommand`), `:76-102` (oracle guards, value sets), `:126-166` (`evaluatePair`), `:256-316` (parity test)
- Origin: task 0945 (idea-pipeline route-fact refactor) under D64
- `packages/app/bunfig.toml` (test preload; run the test inside `packages/app`)

### History

- 2026-09-26T07:31:45.679Z backlog → todo (system)

