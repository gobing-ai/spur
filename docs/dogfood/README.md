# Dogfood Reports

This directory holds dogfood run reports for the Spur plugin ecosystem. Each report is named
`YYYY-MM-DD-<testee-slug>-dogfood.md`, where `<testee-slug>` identifies the skill or operation
under test (e.g. `dev-run-0110-auto`, `super-coder-0143`).

## Always-on delivery (protocol `sp:dogfood-testing@1.1`)

Every `/sp:dev-dogfood` (or `sp:dogfood-testing`) run **always** writes:

| Artifact | Path |
|----------|------|
| **Report** (this directory) | `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md` |
| **Live** (mid-run SSOT) | `.spur/run/dogfood/<run_id>.md` |

`--save` is **not required** for a file to appear here; it is a back-compat flag that still
documents the report path. Reports capture planning, execution, gate results, the Monitor Ledger,
the Cost block (estimate + optional meters), and the mandatory summary footer.

Reports are local-only (this directory is gitignored). They are not committed evidence unless an
operator deliberately promotes them.

## Contract markers

A conforming report includes:

- YAML frontmatter with `status: running | aborted | complete` and `protocol: sp:dogfood-testing@1.1`
- Six sections: Testee, Execution Summary (with Cost), Monitor Ledger, What We Did, Issues, Findings
- Summary footer with `[Live: …]` and `[Report: …]`

See `plugins/sp/skills/dogfood-testing/references/report-template.md`.
