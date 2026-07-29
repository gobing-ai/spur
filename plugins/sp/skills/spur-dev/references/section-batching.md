---
name: section-batching
description: Stage pipeline task sections together, apply them through Spur, and validate once per coherent batch.
see_also:
  - spur-dev
  - spur-cli
---

# Section batching protocol

Use this protocol when an in-session operation must author multiple pipeline sections. A workflow
`record` step should still prefer `spur task record` for verdict-derived `Testing` and `Review`.

1. Read `spur-cli/references/tasks/l3-guard-cheatsheet.md`.
2. Run `spur task sections <wbs> list --json` to learn which sections the current matrix permits.
3. Stage complete, body-only `Solution`, `Testing`, and `Review` files before the first task check.
4. Run `spur task check <wbs> --json` once, then apply every permitted staged section with
   `spur task update <wbs> --section <name> --from-file <path>`.
5. Run `spur task check <wbs> --json` once after the coherent write batch.
6. If the post-write check fails, group all findings by section, repair all affected staged bodies, re-apply them, and
   check once more.

Budget: no more than two section writes per section and two task checks per task unless a new
external failure changes the evidence. Do not use a write→check loop for each section.
