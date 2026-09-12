# Wayfinder resolution-pipeline authoring contract

Reference for the `wayfinder-resolution` workflow's `investigate` hop. The pipeline passes a
bounded pointer prompt; this page carries the full authoring contract the hop must follow.
Context variables (`${vars.wbs}`, `${vars.resolutionMode}`, `${vars.evidencePolicy}`) are
resolved by the engine before the hop runs.

## Research boundary (preserve the research boundary)

- Work only from the prepared local bundle `.spur/run/<runId>-wayfinder-input.json`, local
  shell/file reads, and the `spur` CLI. Do not use network search or MCP tools.
- Do not invoke `task-pipeline.yaml`, `/sp:dev-run`, `/sp:dev-runall`, or any code
  implementation pipeline. This hop authors research/specification sections — it never
  implements.

## Procedure

1. Read the task file for `<wbs>` and map its existing Requirements and Acceptance Criteria
   onto the existing Design/Plan/References sections.
2. Author concise Solution, Testing, and Review sections through
   `spur task update --section --from-file` (write each section to a file, then pass it).
3. Finish with a short summary and stop.

## Evidence-anchor contract (mandatory — 0299 R1 line-anchor rule)

When the task's evidence lives in a shared evidence file, anchor every Solution/Testing
`file:line` citation truthfully — resolve the section's real start line with
`grep -n "^## <wbs> " <evidence-file>` and cite that exact line. NEVER copy a line number
from another ticket's example; each WBS anchors to its own section. Before finishing, re-read
each cited line and confirm it names the requirement's subject.
