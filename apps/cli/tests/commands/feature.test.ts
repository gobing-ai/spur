/**
 * Thin-wrapper integration tests for apps/cli/src/commands/feature.ts.
 * Behavioral tests for FeatureService live in
 * packages/app/tests/services/feature-service.test.ts.
 *
 * These exercise the `spur feature` verb surface through the real `main()`
 * entry point: golden paths, the `--json` envelope, status/priority filters,
 * and exit codes 0/1/2 (design §7.2, §10).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', `.tmp-feature-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

/** The feature ID from the `feature create` confirmation line. */
function createdId(output: CapturedOutput): string {
    const msg = output.messages.find((m) => m.startsWith('Created feature'));
    if (msg === undefined) throw new Error(`no "Created feature" line in: ${output.messages.join(' | ')}`);
    const id = msg.replace('Created feature ', '').split(':')[0]?.trim();
    if (!id) throw new Error(`could not parse id from: ${msg}`);
    return id;
}

describe('spur feature CLI', () => {
    test('noun help lists subcommands', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', '--help'], { cwd, output });
        expect(exitCode).toBe(0);
        const allOut = output.messages.join('');
        expect(allOut).toContain('create');
        expect(allOut).toContain('show');
        expect(allOut).toContain('update');
        expect(allOut).toContain('list');
    });

    test('create allocates a top-level letter ID and exits 0', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'First Feature'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(createdId(output)).toMatch(/^[A-Z]$/);
    });

    test('create --json returns the write-result envelope', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'JSON Feature', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.kind).toBe('feature');
        expect(parsed.ref.id).toMatch(/^[A-Z][1-9]*$/);
        expect(parsed.eventName).toBe('feature.created');
    });

    test('create --parent allocates a child digit', async () => {
        const pOut = createCapturedOutput();
        await main(['feature', 'create', 'Parent For Child'], { cwd, output: pOut });
        const parentId = createdId(pOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'A Child', '--parent', parentId], { cwd, output });
        expect(exitCode).toBe(0);
        expect(createdId(output)).toMatch(new RegExp(`^${parentId}[1-9]$`));
    });

    test('show --json returns the feature with content', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Showable'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', id, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.id).toBe(id);
        expect(parsed.content).toContain('## Goal');
    });

    test('show unknown ID exits 1', async () => {
        const exitCode = await main(['feature', 'show', 'ZZZZZ'], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(1);
    });

    test('update --field sets a frontmatter value', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Prioritize Me'], { cwd, output: cOut });
        const id = createdId(cOut);

        const exitCode = await main(['feature', 'update', id, '--field', 'priority', '--value', 'P0'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);

        const shown = createCapturedOutput();
        await main(['feature', 'show', id, '--json'], { cwd, output: shown });
        expect(JSON.parse(lastMessage(shown)).frontmatter.priority).toBe('P0');
    });

    test('update --field without --value exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'No Value'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id, '--field', 'priority'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(2);
    });

    test('list --json returns features sorted by ID with status/priority', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
        const ids = parsed.map((f: { id: string }) => f.id);
        expect([...ids]).toEqual([...ids].sort());
    });

    test('list --priority filters by priority', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list', '--priority', 'P0', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        for (const f of parsed) {
            expect(f.priority).toBe('P0');
        }
    });

    test('create prints a human confirmation line (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'Human Output'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toMatch(/^Created feature [A-Z][1-9]*: /);
    });

    test('show prints content (non-JSON)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Human Show'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', id], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('## Goal');
    });

    test('list prints human rows (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.length).toBeGreaterThan(0);
    });

    test('update <status> transitions the feature lifecycle (human output)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Transition Me'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        // backlog → active is a valid feature-lifecycle transition.
        const exitCode = await main(['feature', 'update', id, 'active'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain(`${id}:`);
    });

    test('update with neither status nor --field exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Nothing To Do'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(2);
    });

    test('check validates a feature and returns a per-feature result (--json)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Checkable'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'check', id, '--json'], { cwd, output });
        // A freshly-created backlog feature has no required sections → passes.
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed[0].id).toBe(id);
        expect(parsed[0]).toHaveProperty('findings');
        expect(parsed[0]).toHaveProperty('pass');
    });

    test('check unknown ID exits 1', async () => {
        const exitCode = await main(['feature', 'check', 'ZZZZZ'], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(1);
    });

    test('check prints human PASS/FAIL lines (non-JSON)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Human Check'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'check', id], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toMatch(/PASS|FAIL/);
    });

    test('check with no id validates all features in the folder (--json)', async () => {
        // Exercises the validate-all branch (no <id>): every feature file is checked.
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'check', '--json'], { cwd, output });
        // Some earlier-created features may be active without required sections → may FAIL;
        // assert the result is a populated array regardless of pass/fail.
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(1);
        expect(exitCode === 0 || exitCode === 1).toBe(true);
    });
});
