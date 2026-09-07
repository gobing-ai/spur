/**
 * Task 0797: setProjectExecutorDisabled — exact-entry mutation, structured
 * no-ops for missing targets, per-path locking + atomic commit + cache
 * invalidation. Byte-level assertions use temporary files only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    statSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ExecutorUpdateError, loadSpurConfig, setProjectExecutorDisabled } from '../src/loader';

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'executor-update-'));
    mkdirSync(join(root, '.spur'));
    process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true'; // deterministic layering
});

afterEach(() => {
    delete process.env.SPUR_SKIP_GLOBAL_CONFIG;
    chmodSync(root, 0o700);
});

const PROJECT_YAML = [
    '# project layer',
    'planning:',
    '  tasks_folder: tasks4',
    'agent:',
    '  executors:',
    '    - name: alpha',
    '      agent: omp',
    '      model: gpt-5',
    '    - name: alphabet',
    '      agent: claude',
    '      model: claude-4',
    '      disabled: true',
    '    # trailing comment',
    '    - name: beta',
    '      agent: gemini',
    '      model: gemini-3',
    '',
].join('\n');

function writeProject(yaml: string): string {
    const path = join(root, '.spur', 'config.yaml');
    writeFileSync(path, yaml);
    return path;
}

async function expectInvalidConfig(run: () => Promise<unknown>): Promise<void> {
    try {
        await run();
        expect.unreachable();
    } catch (error) {
        expect(error).toBeInstanceOf(ExecutorUpdateError);
        expect((error as ExecutorUpdateError).code).toBe('INVALID_CONFIG');
    }
}

describe('setProjectExecutorDisabled (0797)', () => {
    test('R1: mutates only the exact entry — alpha does not touch alphabet', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setProjectExecutorDisabled(root, 'alpha', false);
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.map((e) => e.disabled)).toEqual([false, true, undefined]);
        expect(parsed.agent.executors.map((e) => e.model)).toEqual(['gpt-5', 'claude-4', 'gemini-3']);
    });

    test('R1: matching is case-sensitive and prefix-free', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setProjectExecutorDisabled(root, 'ALPHA', false);
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-executor' });
        expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
    });

    test('R1: an already-matching explicit value is a byte-stable no-op', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setProjectExecutorDisabled(root, 'alphabet', true);
        expect(result).toEqual({ status: 'unchanged', reason: 'already-set' });
        expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
    });

    test('R1: a valid name-only project fragment is updated in place', async () => {
        const path = writeProject('agent:\n  executors:\n    - name: alpha\n');
        const result = await setProjectExecutorDisabled(root, 'alpha', false);
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors).toEqual([{ name: 'alpha', disabled: false }]);
    });

    test('R1: comments, unrelated values and file mode survive', async () => {
        const path = writeProject(PROJECT_YAML);
        chmodSync(path, 0o640);
        const before = readFileSync(path, 'utf8');
        await setProjectExecutorDisabled(root, 'alpha', false);
        const text = readFileSync(path, 'utf8');
        expect(text).toContain('# project layer');
        expect(text).toContain('# trailing comment');
        expect(text).toContain('tasks_folder: tasks4');
        // Unchanged bytes outside the mutated entry: everything up to alpha's body.
        expect(text.startsWith(before.slice(0, before.indexOf('- name: alpha')))).toBe(true);
        expect(statSync(path).mode & 0o777).toBe(0o640);
    });

    test('R2: missing file is a structured no-op that creates nothing', async () => {
        const result = await setProjectExecutorDisabled(root, 'alpha', false);
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-file' });
        expect(existsSync(join(root, '.spur', 'config.yaml'))).toBe(false);
    });

    test('R2: missing executors section is a no-op', async () => {
        const path = writeProject('planning:\n  tasks_folder: tasks4\n');
        const result = await setProjectExecutorDisabled(root, 'alpha', false);
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-executors' });
        expect(readFileSync(path, 'utf8')).toBe('planning:\n  tasks_folder: tasks4\n');
    });

    test('R2: missing executor leaves the file byte-identical', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setProjectExecutorDisabled(root, 'gamma', false);
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-executor' });
        expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
    });

    test('R2: malformed YAML rejects INVALID_CONFIG and preserves contents', async () => {
        const path = writeProject('agent:\n  executors: [unclosed\n');
        await expectInvalidConfig(() => setProjectExecutorDisabled(root, 'alpha', false));
        expect(readFileSync(path, 'utf8')).toBe('agent:\n  executors: [unclosed\n');
    });

    test('R2: duplicate executor names reject as ambiguous', async () => {
        const path = writeProject('agent:\n  executors:\n    - name: alpha\n    - name: alpha\n');
        await expectInvalidConfig(() => setProjectExecutorDisabled(root, 'alpha', false));
        expect(readFileSync(path, 'utf8')).not.toContain('disabled');
        expect(existsSync(`${path}.lock`)).toBe(false);
    });

    test('R2: alias entries reject rather than rewrite speculatively', async () => {
        const path = writeProject('defaults: &d\n  name: alpha\nagent:\n  executors:\n    - *d\n');
        await expectInvalidConfig(() => setProjectExecutorDisabled(root, 'alpha', false));
        expect(readFileSync(path, 'utf8')).toContain('&d');
    });

    test('R2: symlinked project config rejects INVALID_CONFIG', async () => {
        const outside = join(root, 'outside.yaml');
        writeFileSync(outside, 'agent:\n  executors:\n    - name: alpha\n');
        const linkRoot = mkdtempSync(join(tmpdir(), 'executor-update-link-'));
        mkdirSync(join(linkRoot, '.spur'));
        symlinkSync(outside, join(linkRoot, '.spur', 'config.yaml'));
        try {
            await expectInvalidConfig(() => setProjectExecutorDisabled(linkRoot, 'alpha', false));
            expect(readFileSync(outside, 'utf8')).not.toContain('disabled');
        } finally {
            chmodSync(linkRoot, 0o700);
        }
    });

    test('R2: invalid arguments reject before any filesystem work', async () => {
        await expectInvalidConfig(() => setProjectExecutorDisabled(root, '', false));
        await expectInvalidConfig(() => setProjectExecutorDisabled(root, 'alpha', 'false' as unknown as boolean));
        expect(existsSync(join(root, '.spur', 'config.yaml'))).toBe(false);
    });

    test('R3: concurrent updater calls serialize — both edits survive', async () => {
        const path = writeProject(PROJECT_YAML);
        const results = await Promise.all([
            setProjectExecutorDisabled(root, 'alpha', false),
            setProjectExecutorDisabled(root, 'beta', true),
        ]);
        expect(results).toEqual([{ status: 'updated' }, { status: 'updated' }]);
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.map((e) => e.disabled)).toEqual([false, true, true]);
        expect(existsSync(`${path}.lock`)).toBe(false);
    });

    test('R3: a live lock owner is never reclaimed — exhaustion rejects', async () => {
        const path = writeProject(PROJECT_YAML);
        writeFileSync(`${path}.lock`, String(process.pid)); // kill(pid, 0) succeeds for our own pid
        try {
            await expect(setProjectExecutorDisabled(root, 'alpha', false)).rejects.toThrow(/held by a live process/);
            expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML); // untouched while the lock is held
        } finally {
            unlinkSync(`${path}.lock`);
        }
    });

    test('R3: a dead lock owner is reclaimed', async () => {
        const path = writeProject(PROJECT_YAML);
        writeFileSync(`${path}.lock`, '999999999'); // pid that cannot exist
        const result = await setProjectExecutorDisabled(root, 'alpha', false);
        expect(result).toEqual({ status: 'updated' });
        expect(readFileSync(path, 'utf8')).toContain('disabled: false');
    });

    test('R3: atomic commit failure preserves the original file', async () => {
        const path = writeProject(PROJECT_YAML);
        const spurDir = join(root, '.spur');
        chmodSync(spurDir, 0o500); // read-only config dir: temp write must fail
        try {
            try {
                await setProjectExecutorDisabled(root, 'alpha', false);
                expect.unreachable();
            } catch (error) {
                expect(error).toBeInstanceOf(ExecutorUpdateError);
                expect(['CONFIG_WRITE_FAILED', 'CONFIG_CONFLICT']).toContain((error as ExecutorUpdateError).code);
            }
            expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
        } finally {
            chmodSync(spurDir, 0o700);
        }
    });

    test('R3: success invalidates the loader cache — next load sees the new value', async () => {
        const path = writeProject(PROJECT_YAML);
        const before = await loadSpurConfig(root);
        expect(before.agent?.executors?.find((e) => e.name === 'alpha')?.disabled).toBe(false);
        const result = await setProjectExecutorDisabled(root, 'beta', false);
        expect(result).toEqual({ status: 'updated' });
        const after = await loadSpurConfig(root);
        expect(after.agent?.executors?.find((e) => e.name === 'beta')?.disabled).toBe(false);
        expect(existsSync(`${path}.lock`)).toBe(false);
    });
});
