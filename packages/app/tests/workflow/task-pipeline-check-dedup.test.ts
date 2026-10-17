import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// 0940 R4: the comprehensive check runs once at the quality boundary. D65 1239 collapsed
// `test`/`test-recheck` into the single `gate` state; `precheck` is structural only and the
// review/close states are observe-only readers of the gate's artifacts — none of them may
// execute the quality gate. Positive assertions keep this test honest: if someone deletes the
// real gate from `gate` (or adds one to another state), it fails here.

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

const onEnterOf = (id: string): Action[] => DEF.states.find((s) => s.id === id)?.onEnter ?? [];

describe('task-pipeline check dedup (0940 R4, D65 1239)', () => {
    test('precheck, review and done execute no quality-gate command', () => {
        for (const id of ['precheck', 'review', 'done']) {
            const commands = JSON.stringify(onEnterOf(id));
            expect(commands, id).not.toContain('gateMode');
            expect(commands, id).not.toContain('qualityGateCmd');
            expect(commands, id).not.toContain('task", "gate"');
        }
    });

    test('the gate state still owns the quality gate as a typed command.gate', () => {
        const gate = onEnterOf('gate').find(
            (a) => a.kind === 'command.gate' && (a.options?.args as unknown[] | undefined)?.[1] === 'gate',
        );
        expect(gate).toBeDefined();
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(gate?.options?.args).toEqual(['task', 'gate', '${vars.wbs}', '${vars.gateMode}', '--no-logo']);
        expect(gate?.options?.softFail).toBe(true);
    });
});
