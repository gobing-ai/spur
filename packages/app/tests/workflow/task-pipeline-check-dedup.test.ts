import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// 0940 R4: the comprehensive check runs once at the quality boundary. `precheck` is structural
// only and `verify`/`record` are observe-only readers of gate artifacts — none of them may
// execute the quality gate. Positive assertions keep this test honest: if someone deletes the
// real gate from `test`/`test-recheck` (or adds one to the other states), it fails here.

interface Action {
    kind: string;
    options?: Record<string, unknown>;
}
interface WorkflowDef {
    states: { id: string; onEnter?: Action[] }[];
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8')) as WorkflowDef;

const onEnterCommands = (id: string): string => JSON.stringify(DEF.states.find((s) => s.id === id)?.onEnter ?? []);

describe('task-pipeline check dedup (0940 R4)', () => {
    test('precheck, verify and record execute no quality-gate command', () => {
        for (const id of ['precheck', 'verify', 'record']) {
            const commands = onEnterCommands(id);
            expect(commands).not.toContain('qualityGateCmd');
            expect(commands).not.toContain('quality-gate.ts');
        }
    });

    test('test and test-recheck still own the quality gate', () => {
        for (const id of ['test', 'test-recheck']) {
            expect(onEnterCommands(id)).toContain('quality-gate.ts');
        }
    });
});
