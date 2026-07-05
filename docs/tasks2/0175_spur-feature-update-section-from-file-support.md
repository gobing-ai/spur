---
template: feature-impl
schema_version: 1
name: spur feature update --section --from-file support
status: done
type: task
feature_id: I
parent_wbs: "0167"
created_at: 2026-07-02T00:13:34.396Z
updated_at: 2026-07-02T00:54:46.294Z
---

## 0175. spur feature update --section --from-file support

### Background
Task 0174 (0167 follow-ups) R6-S2b identified that the `ac-generate` state in `config/workflows/idea-pipeline.yaml` cannot be refactored to the capture+shell pattern because `spur feature update` lacks section-editing support. Currently `spur feature update <id> [status] [--field k --value v]` only supports frontmatter field updates; there is no `--section <name> --from-file <path>` option (unlike `spur task update` which already has this). Implementing feature section editing would unblock the ac-generate capture+shell refactor and provide surface symmetry with the task update command.
### Requirements
R1. `spur feature update <id> --section <name> --from-file <path>` writes the body content from `path` into the named section of the feature file. The heading line is NOT included in the body file — the CLI derives the heading from the section name (matching the task update contract in `cross-cutting.md`).

R2. The command works without a status change (section-only update, same as task update).

R3. Section names match the canonical heading text (e.g. "Acceptance Criteria", "Goal", "Background").

R4. The feature file path is resolved from the feature id using the existing feature resolution logic.

R5. The update uses the same body-only format and validation as `spur task update --section` (no heading line in the body file).
### Acceptance Criteria
AC1. `spur feature update <id> --section "Acceptance Criteria" --from-file <path>` writes the body file to the existing Acceptance Criteria section and exits 0.

AC2. Unknown feature ids fail through existing feature resolution.

AC3. Missing or non-existent feature section names fail with an error that lists available sections.

AC4. Section writes compose with status changes in one invocation.

AC5. The updated feature section remains compatible with `spur feature check`.

AC6. `spur feature update --help` documents `--section` and `--from-file`.

AC7. `idea-pipeline.yaml` `ac-generate` now uses the capture+shell pattern with `spur feature update --section "Acceptance Criteria" --from-file`.
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
Mirror the existing `spur task update --section --from-file` implementation in the feature command. The section-editing logic is a gap in the feature CLI surface; the service layer already handles feature file parsing and markdown document manipulation (via `MarkdownDocument` in `@gobing-ai/spur-domain`).

Key implementation points:

1. **CLI** (`apps/cli/src/commands/feature.ts`): Add `--section <name>` and `--from-file <path>` options to the `update` subcommand. The options are mutually independent of `--field`/`--value` and the positional `[status]` — all three update paths (section body, frontmatter field, status) can be composed in one invocation.

2. **Service** (`packages/app/src/services/feature-service.ts` or equivalent): Add an `updateSection(featureId, sectionName, bodyFilePath)` method that reads the feature markdown file, locates the target section by heading name, replaces the section body with the file content, and writes back.

3. **Section body format**: Heading line excluded (the CLI derives it from the section name). This is the same contract as `spur task update --section --from-file` documented in `cross-cutting.md`.

4. **Error handling**: Feature not found → exit 1 with message. Section not found → exit 1 with message listing the available section headings found in the file. Body file not found or unreadable → exit 1 with message.

5. **No new ADR**: This is a surface change adding parity to an existing verb, not a cross-cutting decision. ADR-020 already governs command/schema shapes landing in `04_DESIGN.md`.

6. **After landing**: The `ac-generate` state in `idea-pipeline.yaml` can then be refactored to capture+shell (agent.run with `answerFile` → shell writes via `spur feature update --section`). This is a YAML-only change with no new code.
### Plan
- [ ] Study the existing `spur task update --section --from-file` implementation (`apps/cli/src/commands/task.ts`, `packages/app/src/services/task-service.ts`) to replicate the pattern.
- [ ] Add `--section <name>` and `--from-file <path>` options to the feature update command in `apps/cli/src/commands/feature.ts`.
- [ ] Implement the section-update service method (read feature file → locate section by heading → replace body → write).
- [ ] Add unit tests: write to existing section, non-existent feature id, non-existent section name, section + status change together.
- [ ] Update `apps/cli/src/commands/feature.ts` help text and argument-hint to document the new options.
- [ ] Verify: `spur feature update <id> --section "Acceptance Criteria" --from-file <path>` succeeds and the written content appears in the feature file.
- [ ] Sync `docs/04_DESIGN.md` (feature update command surface).
- [ ] Refactor `ac-generate` in `config/workflows/idea-pipeline.yaml` to the capture+shell pattern using the new verb.
### Solution
Implemented feature section updates through the existing planning write path.

| File | Change |
| --- | --- |
| `packages/app/src/services/feature-service.ts:124` | Added `FeatureService.updateSection(id, sectionName, sourceFile)`, feature resolution, existing-section validation with available-section errors, duplicate heading stripping, and delegation to `PlanningWriteService.updateSection`. |
| `apps/cli/src/commands/feature.ts:77` | Added `--section <name>` and `--from-file <path>` to `spur feature update`; section, field, and status updates can compose in one invocation and apply in that order. |
| `packages/app/tests/services/feature-service.test.ts:114` | Added service coverage for section replacement, duplicate heading stripping, and missing-section errors. |
| `apps/cli/tests/commands/feature.test.ts:128` | Added CLI coverage for section replacement, missing `--from-file`, and section+status composition. |
| `config/workflows/idea-pipeline.yaml:86` | Refactored `ac-generate` to capture AC into `.spur/run/idea-ac-content.md`, write via `spur feature update --section "Acceptance Criteria" --from-file`, run `spur feature check`, and then write the completion sentinel. |
| `docs/04_DESIGN.md:538` | Updated the `spur feature update` command surface and removed the stale “no feature section update” constraint. |
### Testing
Targeted behavioral tests:

- `bun test packages/app/tests/services/feature-service.test.ts apps/cli/tests/commands/feature.test.ts` — 59 pass, 0 fail. Bun exited nonzero because focused coverage applies the repo-wide threshold to unrelated loaded files; the behavioral assertions all passed. Full `bun run test` is the coverage gate.
- `bun run test` — 2046 pass, 0 fail; aggregate coverage passes.

Validation:

- `DATABASE_URL=:memory: dist/cli/spur workflow validate config/workflows/idea-pipeline.yaml --json` — valid.
- `DATABASE_URL=:memory: dist/cli/spur workflow validate config/workflows/wrapup-pipeline.yaml --json` — valid.
- `bun run lint` — pass (Biome + all workspace typechecks).
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `packages/app/src/services/feature-service.ts:124` | No blocking implementation findings. The section-update path reuses the existing write pipeline and validates the target section before writing. | Keep as-is. |

Residual risk: the focused `bun test ...feature...` command exits nonzero on aggregate coverage despite all targeted assertions passing. This matches the known focused-coverage behavior; the full `bun run test` gate remains the authoritative coverage check.
### References
- Parent: `docs/tasks2/0167_*.md` (feature I), `docs/tasks2/0174_*.md` (follow-ups — R6-S2b ac-generate blocker recorded in Q&A)
- Task update `--section --from-file` pattern: `apps/cli/src/commands/task.ts` (CLI option registration), `packages/app/src/services/task-service.ts` (updateSection implementation)
- Feature command: `apps/cli/src/commands/feature.ts` (update subcommand, updateField method)
- Feature service: `packages/app/src/services/feature-service.ts`
- Section body format contract: `plugins/sp/skills/spur-dev/references/cross-cutting.md` § "Section-editing body-only format"
- Markdown document manipulation: `packages/domain/src/planning/markdown-document.ts` (getSection, setSection)
- Design doc: `docs/design/e2e-workflow-for-system-development.md` § idea-pipeline
- ADR-020: Command/schema shapes land in 04_DESIGN in the same commit
### History
- 2026-07-02T00:52:49.826Z todo → wip (system)
- 2026-07-02T00:53:27.858Z wip → testing (system)
- 2026-07-02T00:54:08.544Z testing → done (system)
