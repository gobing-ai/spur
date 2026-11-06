import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { SectionMatrix } from '../../src/services/task-check';

/** A real, throwaway corpus shared by service, HTTP and Board journey proofs. */
export function readinessFixture() {
    const root = mkdtempSync(join(tmpdir(), 'spur-readiness-'));
    const tasksDir = join(root, 'docs/tasks');
    const otherDir = join(root, 'docs/other');
    const featuresDir = join(root, 'docs/features');
    for (const dir of [tasksDir, otherDir, featuresDir]) mkdirSync(dir, { recursive: true });
    const matrix: SectionMatrix = {
        variants: {
            standard: {
                todo: {
                    required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'],
                    optional: ['Requirements'],
                    forbidden: [],
                    gate: true,
                },
            },
        },
    };
    return {
        root,
        tasksDir,
        otherDir,
        featuresDir,
        matrix,
        fs: createNodeFileSystem(root),
        task(wbs: string, status = 'todo', dependencies: string[] = [], dir = tasksDir, background = 'Fixture work.') {
            writeFileSync(
                join(dir, `${wbs}_fixture.md`),
                `---
schema_version: 1
name: Fixture ${wbs}
status: ${status}
template: standard
dependencies: ${JSON.stringify(dependencies)}
created_at: "2026-11-05T00:00:00Z"
updated_at: "2026-11-05T00:00:00Z"
---
## ${wbs}. Fixture
${background ? `### Background\n\n${background}\n` : ''}
### Acceptance Criteria

\`\`\`gherkin
Feature: Fixture
  Scenario: Valid work
    Given prepared inputs
    When work starts
    Then the result is recorded
\`\`\`

### Design

Use the existing fixture boundary.

### Plan

- [ ] Perform the fixture work.
`,
            );
        },
        cleanup() {
            rmSync(root, { recursive: true, force: true });
        },
    };
}
