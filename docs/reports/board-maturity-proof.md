# Board maturity browser artifacts

Run from `apps/web`:

```sh
bun test tests/modules/board-maturity-browser.heavy.test.ts
```

Fresh output is written to `.spur/run/board-maturity-proof/`: the stable
`board-maturity-e2e-receipt.json`, ten light-theme 1280×800 module screenshots,
and supplemental document-layout screenshots/measurements at 1280px and 375px.
The test also checks a wide Tasks body and deliberately injects failed assets and
an uncaught exception to prove that the error detectors are failure-sensitive.

The ten-module sweep serves a static production build and permits only data-path
request failures. Document-layout cases use contract-shaped read fixtures; backend
data flows are covered by their owning module tests.

The sibling `board-maturity-*.png` files and receipt are a deliberately published
preview of a successful run. Refresh them from the live output only after its
receipt says ten passed and zero failed. Heavy tests never rewrite this tracked
snapshot: changing tracked reports during a feature verification pass changes its
proof inputs and invalidates the completion receipt. The existing L4 digest rules
are preserved.

After copying a preview, format its JSON with the repository's Biome formatter
before starting feature verification. The live receipt remains the raw run output.
