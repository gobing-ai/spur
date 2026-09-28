---
schema_version: 1
name: Derive inline-run plugin-lib exports and declarations from one table
status: done
template: feature-impl
created_at: 2026-09-26T06:35:37.358Z
updated_at: "2026-09-28T15:53:10.433Z"
feature_id: A33

priority: P2
estimate_hours: 3
---

## 0972. Derive inline-run plugin-lib exports and declarations from one table

### Background

This came from the architecture pass of `/sp:dev-review scripts` (2026-09-25). The candidate was "duplicated export list", rated minor, on the tight-coupling / weak-locality lenses.

`bundleInlineRunLib()` in `scripts/commands/bundle-plugin-lib.ts` (around `:108-185`) keeps the inline-run bundle's public surface in **two hand-maintained lists**:

1. The generated entry module: `export { … } from '../packages/…'` lines written to `.inline-run-bundle/entry.ts` (around `:119-134`). This decides what `plugins/sp/lib/inline-run.generated.mjs` actually exports at runtime.
2. The generated declarations: `export declare const X: typeof import('@gobing-ai/spur-app').X;` lines written to `plugins/sp/lib/inline-run.generated.d.mts` (around `:152-178`). The name lists are repeated in three `.map()` arrays plus two literal lines.

The list has grown over tasks 0915 and 0941. Each addition had to touch both places, and nothing checks that they match. An export added only to the entry gives plugin scripts an untyped import; a declaration added only to `.d.mts` type-checks a name that is `undefined` at runtime. The existing test (`scripts/commands/bundle-plugin-lib.test.ts`, the last test) checks determinism and builtin-only imports. It does not check export/declaration parity.

### Requirements

- [x] R1. One module-level table in `bundle-plugin-lib.ts` defines the inline-run surface. It is typed with an `interface InlineRunExport { name: string; from: string; declare: string }`:
  - `from` is the repo-relative source module without extension (e.g. `packages/app/src/services/inline-run-setup`).
  - `declare` is the full `.d.mts` line for that name.
  - Small helpers build the common forms, e.g. `const appType = (name) => \`export declare const ${name}: typeof import('@gobing-ai/spur-app').${name};\``, plus the equivalents for `@gobing-ai/spur-domain` and `@gobing-ai/spur-config/loader`.
  - The two bespoke declarations (`EMBEDDED_SPUR_SCHEMAS`, `splitLaunchCommand`) carry their literal text in `declare`.
- [x] R2. The entry file is generated from the table: rows are grouped by `from`, preserving first-seen order, into one `export { a, b } from '../<from>';` line per module. The table order and grouping MUST reproduce today's entry export lines exactly, meaning the same modules in the same order with the same names in the same order, so `inline-run.generated.mjs` stays **byte-identical** after regeneration. The explanatory comments currently inline in the entry array (the 0915 receipt note and the 0941 decide-enabled note) move onto the corresponding table rows as `//` comments.
- [x] R3. The `.d.mts` is generated from the table: the existing header line, then one `declare` line per row in table order, then a trailing `''`. Declaration order may change from today's; the **set** of declaration lines must be identical to the current committed `inline-run.generated.d.mts`.
- [x] R4. A parity test in `scripts/commands/bundle-plugin-lib.test.ts` imports the committed `plugins/sp/lib/inline-run.generated.mjs` (bun supports `bun:sqlite` externals). It collects `Object.keys(module)` and extracts declared names from `inline-run.generated.d.mts` with `/^export declare (?:const|function) (\w+)/gm`, then asserts the two sets are equal. This test is the tripwire for future drift and must fail if either side gains a name alone.
- [x] R5. Nothing else changes: `bundlePluginLib`/`DECLS` and `bundleIdeaHandoffLib`/`IDEA_HANDOFF_DECLS` stay as they are, since their declarations are hand-written signatures, not re-exports. The fixed scratch path `.inline-run-bundle` and the `minify`/`external`/`define` build options stay as they are too.

### Acceptance Criteria

Graduates feature A33 scenario R4 (exact title below).

- [x] AC1 — R4 — Inline-run bundle exports and declarations come from one table (req: R1, R2, R3, R4)

**Verify lens**

- **AC1**:
  - `bun run build:plugin-lib` followed by `git diff --exit-code plugins/sp/lib/inline-run.generated.mjs` exits 0: the runtime bundle is byte-identical (R2).
  - `diff <(git show HEAD:plugins/sp/lib/inline-run.generated.d.mts | sort) <(sort plugins/sp/lib/inline-run.generated.d.mts)` is empty: the declaration set is unchanged (R3).
  - The new R4 parity test passes.
  - **Negative proof**, recorded in Testing: temporarily add a row whose `declare` names `bogusExport` but whose `from`/`name` point at a real module export that isn't in the list, regenerate, and confirm the parity test fails. Then revert and regenerate.
- The existing determinism test (`'inline application bundle regenerates deterministically…'`) stays green.
- If any `plugins/sp/lib/*.generated.*` file changed, run `bun run build:scripts` and then `git status --short plugins/sp/scripts` to confirm no standard twin changed.
- `bun run spur-check` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Chosen approach**: one data table plus two derivations (entry text and `.d.mts` text). This is the smallest change that makes drift impossible to write, and the R4 parity test catches drift in the generated artifacts too.

Sketch:

```ts
interface InlineRunExport {
    name: string;
    from: string; // repo-relative module, no extension
    declare: string; // full .d.mts line
}
const appType = (n: string) => `export declare const ${n}: typeof import('@gobing-ai/spur-app').${n};`;
const domainType = (n: string) => `export declare const ${n}: typeof import('@gobing-ai/spur-domain').${n};`;
const app = (from: string, ...names: string[]) => names.map((name) => ({ name, from, declare: appType(name) }));

const INLINE_RUN_EXPORTS: readonly InlineRunExport[] = [
    ...app('packages/app/src/services/inline-run-setup', 'createOrAttachInlineRun', 'openInlineRunProjectDb'),
    ...app('packages/app/src/workflow/proof-input-fingerprint', 'computeProofInputFingerprint', 'readProofInputContents'),
    ...app('packages/app/src/workflow/action-trace', 'createWorkflowActionTraceWriter'),
    { name: 'splitLaunchCommand', from: 'packages/app/src/workflow/split-launch-command', declare: 'export declare function splitLaunchCommand(value: string, label: string): { command: string; leadingArgs: string[] } | { error: string };' },
    // Feature verification receipt (D63 task 0915): …
    ...app('packages/app/src/workflow/feature-verification-receipt', 'captureFeatureReceiptDigest', 'completeFeatureVerificationReceipt', 'DEFAULT_FEATURE_VERIFICATION_CMD', 'featureReceiptPaths', 'startFeatureVerificationReceipt', 'validateFeatureVerificationReceipt'),
    ...app('packages/app/src/workflow/workflow-resolver', 'resolveWorkflowDefinition'),
    // Decide-enabled switch (task 0941 gate fix): …
    { name: 'resolveDecideDecisionMakerEnabled', from: 'packages/config/src/loader', declare: "export declare const resolveDecideDecisionMakerEnabled: typeof import('@gobing-ai/spur-config/loader').resolveDecideDecisionMakerEnabled;" },
    ...['ArtifactDao', 'RunDao'].map((name) => ({ name, from: 'packages/domain/src/dao', declare: domainType(name) })),
    { name: 'EMBEDDED_SPUR_SCHEMAS', from: 'apps/cli/src/config/embedded-schemas', declare: 'export declare const EMBEDDED_SPUR_SCHEMAS: ReadonlyMap<string, string>;' },
];
```

**Invariant**: the row order above must mirror the **current** entry array order exactly. Re-read `bundle-plugin-lib.ts` at implementation time; the sketch is indicative, not authoritative. Byte-identical `.mjs` output (R2) is the proof.

**Rejected**:
- Generating the `.d.mts` with `tsc --emitDeclarationOnly`: it adds a build step and pulls transitive types into a file the plugin twin only needs names from.
- A parity test alone, without the table: it catches drift but keeps two lists for every edit. The table removes the second edit, and the test guards the generated artifacts.

### Plan

1. Snapshot: `cp plugins/sp/lib/inline-run.generated.{mjs,d.mts} "$TMPDIR"/`.
2. Add `InlineRunExport`, the helpers, and `INLINE_RUN_EXPORTS` (Design) to `bundle-plugin-lib.ts`.
3. Replace the hand-written entry array with a group-by-`from` derivation, and the `.d.mts` array with `[header, ...INLINE_RUN_EXPORTS.map((e) => e.declare), ''].join('\n')`.
4. Run `bun run build:plugin-lib` and verify R2/R3 against the snapshot (`cmp` on the `.mjs`, sorted `diff` on the `.d.mts`).
5. Add the R4 parity test and run the negative proof (AC1).
6. `bun test ./scripts/commands/bundle-plugin-lib.test.ts`, then `bun run spur-check`.

### Solution

- `scripts/commands/bundle-plugin-lib.ts:109-115`: `InlineRunExport { name; from; declare }`.
- `:117-122`: the `appExports(from, ...names)` helper, for the common `@gobing-ai/spur-app` form.
- `:129-185`: `INLINE_RUN_EXPORTS`, the single table. Row order mirrors the previous entry array (including `persistWorktreeRuns`/`runDecideForInlineRun`, added by 0975, which the Design sketch predates). The 0975, 0915 and 0941 comments moved onto their rows. The domain `ArtifactDao`/`RunDao`, config-loader, `splitLaunchCommand` and `EMBEDDED_SPUR_SCHEMAS` rows keep their literal or domain `declare` text.
- `:188-194`: `inlineRunEntry()` groups rows by `from` in first-seen order, one `export { … } from '../<from>';` line per module. It replaces the hand-written entry array.
- `:225`: the `.d.mts` is the header, then `INLINE_RUN_EXPORTS.map((e) => e.declare)`, then `''`, replacing the hand-written declaration list.
- `scripts/commands/bundle-plugin-lib.test.ts:86-94`: the R4 parity test. It imports the committed `inline-run.generated.mjs` and asserts `Object.keys` equals the names declared in `inline-run.generated.d.mts`.
- `plugins/sp/lib/inline-run.generated.d.mts`: regenerated. Only the declaration order changed, and the set is identical. `inline-run.generated.mjs` is byte-identical (`cmp` against the pre-change snapshot).
- Untouched (R5): `bundlePluginLib`/`DECLS`, `bundleIdeaHandoffLib`/`IDEA_HANDOFF_DECLS`, the `.inline-run-bundle` scratch path, and the build options.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/bundle-plugin-lib.ts:109-115` `interface InlineRunExport { name; from; declare }`; `:117-122` `appExports` helper; `:129-185` `INLINE_RUN_EXPORTS` table with literal `declare` for `splitLaunchCommand`/`EMBEDDED_SPUR_SCHEMAS`, domain and config-loader forms |
| R2 | MET | `scripts/commands/bundle-plugin-lib.ts:188-194` `inlineRunEntry()` groups by `from` in first-seen order; `:205` entry written from it; `bun run build:plugin-lib` then `cmp` vs pre-change snapshot → byte-identical `inline-run.generated.mjs`; 0975/0915/0941 comments moved onto rows |
| R3 | MET | `scripts/commands/bundle-plugin-lib.ts:225` `.d.mts` = header + `INLINE_RUN_EXPORTS.map((e) => e.declare)` + `''`; `diff <(sort snapshot) <(sort plugins/sp/lib/inline-run.generated.d.mts)` empty (order-only change) |
| R4 | MET | `scripts/commands/bundle-plugin-lib.test.ts:86-94` parity test: `Object.keys(import(inline-run.generated.mjs))` equals names matched by `/^export declare (?:const |
| R5 | MET | `git diff scripts/commands/bundle-plugin-lib.ts` touches only `bundleInlineRunLib` entry/.d.mts derivation plus the new table; `DECLS`, `IDEA_HANDOFF_DECLS`, `.inline-run-bundle` scratch path and `Bun.build` options unchanged |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R4 — Inline-run bundle exports and declarations come from one table | MET | test | `bun test scripts/commands/bundle-plugin-lib.test.ts` 7 pass / 0 fail incl. parity test `scripts/commands/bundle-plugin-lib.test.ts:86` and determinism test; `.mjs` byte-identical (`cmp`), `.d.mts` sorted-set diff empty; negative proof: a row declaring `bogusExport` while exporting `BUNDLED_PATH_PREFIX` → parity test fails (`- "BUNDLED_PATH_PREFIX" + "bogusExport"`), reverted + regenerated → `.mjs` identical again; `bun run build:scripts` → no `plugins/sp/scripts` twin changed; `bun run spur-check` lint+typecheck+49 rules pass, 9342 pass / 1 fail (sandbox-only `apps/cli/tests/commands/feature.test.ts` fixture `git init` denial, file untouched) |
| AC1 | MET | test | same evidence as the `AC1 — …` scenario row above (bare id ticks the task AC box) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=2 housekeeping=0 |

### References

- `scripts/commands/bundle-plugin-lib.ts:108-185`: `bundleInlineRunLib`, the entry array and `.d.mts` array.
- `scripts/commands/bundle-plugin-lib.test.ts`: the last test (determinism + builtin-only imports).
- `plugins/sp/lib/inline-run.generated.mjs`, `plugins/sp/lib/inline-run.generated.d.mts`: generated, committed.
- `package.json:60`: `build:plugin-lib`. `package.json:61`: `build:scripts` chains it ahead of twin conversion.
- History of the list: tasks 0915 (D63 receipts) and 0941 (decide-enabled switch).

### History

- 2026-09-26T06:37:36.590Z backlog → todo (system)
- 2026-09-28T15:44:08.025Z todo → wip (system)
- 2026-09-28T15:52:06.765Z wip → testing (system)
- 2026-09-28T15:53:10.433Z testing → done (system)

