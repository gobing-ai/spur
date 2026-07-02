---
schema_version: 1
name: "spur feature update --section --from-file support"
status: todo
template: feature-impl
created_at: 2026-07-02T00:13:34.396Z
updated_at: "2026-07-02T00:15:02.820Z"
feature_id: I
parent_wbs: "0167"
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
AC1. `spur feature update I --section "Acceptance Criteria" --from-file .spur/run/idea-ac-content.md` writes the content to the Acceptance Criteria section of the feature file and exits 0.

AC2. Specifying a non-existent feature id exits non-zero with a clear error message.

AC3. Specifying a non-existent section name exits non-zero with a clear error message listing available sections.

AC4. The command works alongside status changes: `spur feature update I active --section Goal --from-file /tmp/goal.md`.

AC5. After a section update, `spur feature check <id>` passes on the updated section content.

AC6. `spur feature update --help` documents the `--section` and `--from-file` options.

AC7. After landing, the `ac-generate` state in `idea-pipeline.yaml` is refactored to the capture+shell pattern: agent.run with `answerFile` produces AC content to a temp file; a downstream `shell` step writes it through `spur feature update --section "Acceptance Criteria" --from-file <temp>`. The existing `expectFile` sentinel (0174 Option B) is preserved.
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

<!-- Change map — HOW/WHERE. A `file:line` table of every touched site, one sentence each; ≤8-line snippets only for non-obvious logic. NO full-function dumps. (Filled at `wip`/`testing`.) -->

### Testing

<!-- Test results + a numeric coverage claim, or explicit `N/A`. (Filled at `testing`.) -->

### Review

<!-- P1–P4 findings table (Severity / File / Finding / Recommendation). (Filled at `done`.) -->

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
