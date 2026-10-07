/**
 * Display-annotation integration tests (task 1104): the bundled pipeline YAMLs
 * carry a complete `display` phase table, `workflow validate` enforces it, and
 * `workflow show --format todo --json` projects the two-layer A-Z/1-9 plan.
 * Behavioral unit coverage for the projection functions lives in
 * packages/app/tests/workflow/plan-projection.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const CONFIG_WORKFLOWS = join(REPO_ROOT, 'config', 'workflows');

/** Run `spur workflow <args...>` in-process from the repo root and parse --json stdout. */
async function runWorkflowJson(
    args: string[],
): Promise<{ code: number; json: unknown; output: CommandOutput & { messages: string[]; errors: string[] } }> {
    const output = createCapturedOutput();
    const code = await main(['workflow', ...args], { output, cwd: REPO_ROOT, dbUrl: ':memory:' });
    return { code, json: JSON.parse(output.messages.join('\n')), output };
}

describe('display annotations on the bundled pipelines (1104 AC1)', () => {
    test('workflow validate reports every bundled workflow file valid', async () => {
        const files = readdirSync(CONFIG_WORKFLOWS)
            .filter((f) => f.endsWith('.yaml'))
            .sort();
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const { code, json } = await runWorkflowJson(['validate', join('config', 'workflows', file), '--json']);
            const result = json as { valid: boolean; errors?: string[] };
            expect([file, code]).toEqual([file, 0]);
            expect([file, result.valid]).toEqual([file, true]);
            if (!result.valid) {
                expect([file, result.errors]).toEqual([file, []]);
            }
        }
    });
});

describe('todo projection carries the phased plan (1104 AC2)', () => {
    test('task-pipeline plan: prepare rows, four phase rows, show-plan digits only', async () => {
        const { code, json } = await runWorkflowJson([
            'show',
            join('config', 'workflows', 'task-pipeline.yaml'),
            '--format',
            'todo',
            '--json',
        ]);
        expect(code).toBe(0);
        const { plan, steps } = json as {
            plan: Array<{ label: string; id: string; text: string }> | null;
            steps: Array<{ id: string }>;
        };
        expect(plan).not.toBeNull();
        const rows: Array<{ label: string; id: string; text: string }> = plan ?? [];
        expect(rows.length).toBeGreaterThan(0);

        // The projection opens with the prepare row and its three children.
        expect(rows.slice(0, 4).map((i) => i.text)).toEqual([
            'A Prepare',
            'A1 Quick readiness',
            'A2 Prepare Git',
            'A3 Publish plan',
        ]);
        // Phase rows B..E follow in first-appearance order.
        expect(rows.filter((i) => i.id.startsWith('phase.')).map((i) => i.text)).toEqual([
            'B Implement',
            'C Test',
            'D Review',
            'E Verify & record',
        ]);
        // Only show: plan states appear as digits — on-entry and terminal states never do.
        const ids = rows.map((i) => i.id);
        expect(ids).toEqual([
            'prepare',
            'prepare.1',
            'prepare.2',
            'prepare.3',
            'phase.implement',
            'precheck',
            'implement',
            'phase.test',
            'test',
            'phase.review',
            'triage',
            'review',
            'phase.verify',
            'verify',
            'record',
        ]);
        for (const hidden of [
            'escalate',
            'test-fix',
            'test-recheck',
            'test-fail-triage',
            'review-fail-triage',
            'approve',
            'done',
            'failed',
            'cancelled',
        ]) {
            expect(ids).not.toContain(hidden);
        }
        // The flat declared-step projection is unchanged by the annotation (additive R4).
        expect(steps.map((s) => s.id)).toEqual([
            'precheck',
            'implement',
            'escalate',
            'test',
            'test-fix',
            'test-recheck',
            'triage',
            'test-fail-triage',
            'review',
            'review-fail-triage',
            'approve',
            'verify',
            'record',
            'done',
            'failed',
            'cancelled',
        ]);
    });
});

describe('validate rejects incomplete phase tables (1104 AC3)', () => {
    const VIOLATION_YAML = `name: plan-violation
kind: state-machine
$schema: "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"
initialState: a
states:
  - id: a
    display:
        phase: p1
        phaseTitle: P1
        title: A state
  - id: b
  - id: done
    display:
        phase: p1
transitions:
  - from: a
    to: b
  - from: b
    to: done
terminalStates:
  - done
`;

    test('a half-annotated table fails validation, naming the offending states', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await Bun.write(wf, VIOLATION_YAML);
        const output = createCapturedOutput();
        const code = await main(['workflow', 'validate', wf, '--json'], { output, cwd: dir, dbUrl: ':memory:' });
        expect(code).toBe(1);
        const result = JSON.parse(output.messages.join('\n')) as { valid: boolean; errors: string[] };
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('"b"'))).toBe(true); // non-terminal without display
        expect(result.errors.some((e) => e.includes('"done"'))).toBe(true); // terminal with display
    });

    test('a fully annotated table with display passes validation end-to-end', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await Bun.write(
            wf,
            `name: plan-ok
kind: state-machine
$schema: "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"
initialState: a
states:
  - id: a
    display:
        phase: p1
        phaseTitle: P1
        title: A state
  - id: fix
    display:
        phase: p1
        phaseTitle: P1
        title: Fix
        show: on-entry
  - id: done
transitions:
  - from: a
    to: done
terminalStates:
  - done
`,
        );
        const output = createCapturedOutput();
        const code = await main(['workflow', 'validate', wf, '--json'], { output, cwd: dir, dbUrl: ':memory:' });
        expect(code).toBe(0);
        expect((JSON.parse(output.messages.join('\n')) as { valid: boolean }).valid).toBe(true);
    });
});
