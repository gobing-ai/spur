# I31 next implementation batch

Prepared 2026-09-20 against source commit `1c8572339`. I31 investigations **0903, 0904 and 0905 are done**; their findings now support four implementation-ready tasks. This handoff is planning evidence, not an implementation or verification verdict.

## Delegate in this order

| Task | Feature | Scope | Estimate |
| --- | --- | --- | --- |
| 0906 | I7 | [Wayfinder tagging + semantic operand parity](../../tasks5/0906_fix-wayfinder-tagging-and-detect-semantic-section-operand-dr.md) | 3 h |
| 0907 | B61 | [Conservative usage decisions + truthful outcomes](../../tasks5/0907_make-usage-preview-and-apply-outcomes-conservative-and-truth.md) | 5 h |
| 0908 | B61 | [Bounded Codexbar capture](../../tasks5/0908_bound-codexbar-capture-with-the-existing-runtime-timeout.md) | 2 h |
| 0909 | I32 | [Shipped dispatch/session guidance](../../tasks5/0909_align-plugin-and-cli-guidance-with-shipped-dispatch-session-.md) | 3 h |

All four tasks are `todo`. Requirements, Design, Plan, AC and Q&A are frozen; each has seven passing ready-check rows in [next-batch-readiness.json](next-batch-readiness.json). Estimates are planning estimates, not time limits. There are no unfinished semantic prerequisites.

Start one fresh coding-agent session per task:

```text
/sp:dev-run 0906
/sp:dev-run 0907
/sp:dev-run 0908
/sp:dev-run 0909
```

For a CLI-only host, load the installed `sp-spur-dev` backing skill with the corresponding `run <wbs>` argument and follow the same pipeline. These lines are handoff instructions; no implementation pipeline was launched during preparation.

Use a clean branch/worktree for each task and commit per task. Prefer the serial order above: 0907/0908 share the session-pinned-dispatch design file, and CLI/plugin tasks share gate surfaces. Parallel work is possible only in isolated worktrees with serial integration. Save/commit this planning batch before creating isolated execution worktrees so they contain the new task corpus.

## Frozen choices and ownership

- **0906 / I7:** fix the existing recipe and extend the existing invocation scanner. A metadata-only operand is drift; a real body heading such as feature `Scope` is valid. Do not use the historical sibling sweep as a blind denylist.
- **0907 / B61:** no named-window signal means no observation, not recovery. Operator-owned disables remain protected in preview and apply. Reconcile exact observation IDs after drain; `applied` means acknowledged desired state, while additive `skipped`/`pending` actions report other outcomes. Retain the existing writer and delivery-ack counters.
- **0908 / B61:** use the installed runtime's `timeout` and outcome handling, with a 180-second default and a short internal test override. A timed-out capture is unusable even if partial stdout parses. Normal nonzero exits with usable provider arrays remain supported. No competing watchdog or new CLI configuration.
- **0909 / I32:** correct source CLI help and plugin guidance for shipped headless fallback, session defaults, resume capability and availability. Workflow YAML already carries these policies. Generated installed adapters are not task-owned.

B61 is a corrective child of delivered B6; I32 is a corrective child of delivered I3. Existing I7 owns the tagging/parity correction. I31 remains the investigation map and does not duplicate these implementation owners.

## Verification and limits

Preparation checks: four `task check <wbs> --as todo --json` results pass with no findings; feature checks for I7/B61/I32/I31 pass. All ten implementation feature scenarios have linked task coverage. Their unverified warnings are expected until implementation produces real PASS/MET evidence.

Recheck the saved preparation evidence from the repository root:

```bash
bun run docs/reports/i31/next-batch-check.ts
```

Implementation agents must run the focused tests and task-local gate specified in each task, then a real verify PASS. Run the feature-wide gate once per feature, after both B61 tasks for that feature. CLI source changes require linking and bundling. I32 needs a real bounded dogfood artifact before completion.

A pre-existing check of completed parent **I3** fails `L4.dogfood-missing`. It was recorded without fabricating historical evidence or changing its status. No production source, workflow, executor configuration or installed adapter changed in this preparation; no runtime test suite or production verification is claimed.

## Evidence frontier after this batch

| Candidate / owner | Required next evidence | Current disposition |
| --- | --- | --- |
| Run receipts, identity and recovery / **P** | Reproduce a lifecycle mismatch with an actual persisted workflow identity; distinguish manually driven task evidence from workflow traces. | Investigate before filing runtime fixes. |
| Run/session/cost joins / **E6** | Import/correlate an eligible source session and demonstrate the precise missing join. Missing cost is unknown, not zero. | Reuse existing ownership. |
| Workflow adoption and gate economy / **D62** | A representative code-changing cohort and concrete registered-versus-source workflow comparison. | No blanket workflow rewrite or gate reduction. |
| Installed role propagation / **I4 + Superskill boundary** | Source role metadata, installed target/version and a reproducible lost-propagation path. | Missing installed frontmatter alone is not proof of a defect. |
| Usage freshness / **B6** | Define admission age and missing-timestamp policy separately from doctor display freshness; then obtain a regression fixture. | Deferred policy; not silently added to the correctness fix. |
| Agent/message journey simplification | Concrete redundant steps and compatibility impact, followed by operator consent for any public noun/verb change. | No speculative rename/removal. |
| Status/evidence closure | Verify actual receipts for B1/B3/G1/G4/G65/I4/D62 and the I3 dogfood gap. | Evidence audit, not automatic closure. |
| External refresh scheduling / selection optimization | Approved cadence/budget and evidence of a material routing problem. | Defer until correctness and observability support it. |

0905 sampled only two docs-only pipeline runs, no fleet runs and no usable cost join. It cannot justify general runtime reliability or cost claims. Those missing dimensions remain explicit follow-up evidence work.

Sources: [0903 contract adoption](0903-contract-adoption.md), [0904 availability](0904-availability.md), [0905 baseline](0905-run-baseline.md). The task Designs also cite the current source seams; implementation begins with executable regressions, not trust in report reconstruction.
