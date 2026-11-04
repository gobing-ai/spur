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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    // Throwaway root outside the repo tree: a nested `.git/` inside the checkout is both dirt in
    // `git status` when cleanup is skipped and unwritable under a sandboxed run.
    cwd = mkdtempSync(join(tmpdir(), 'spur-feature-test-'));
    await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
    // Real repos ignore `.spur/` — keeps recorded receipts out of the digest tree.
    writeFileSync(join(cwd, '.gitignore'), '.spur/\n');
    // Fixture commits HEAD first so `git read-tree HEAD` resolves for tree-digest paths.
    const init = Bun.spawnSync(
        [
            'sh',
            '-c',
            'git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -q -m init',
        ],
        { cwd },
    );
    if (init.exitCode !== 0) throw new Error(`fixture git init failed: ${init.stderr.toString()}`);
}, 20000);

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

    test('check reports an unclosed code fence as an L2 error; --fix never auto-closes (task 1008 R2, 1009 R2)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Fence Feature'], { cwd, output: cOut });
        const id = createdId(cOut);
        const featurePath = cOut.messages.join('\n').match(/Created feature \S+: (\S+)/)?.[1];
        if (!featurePath) throw new Error('no feature file path in create output');
        try {
            const raw = await Bun.file(featurePath).text();
            await Bun.write(featurePath, `${raw}\n## Stray\n\n\`\`\`text\nnever closed\n`);

            const output = createCapturedOutput();
            const exitCode = await main(['feature', 'check', id, '--json'], { cwd, output });
            expect(exitCode).toBe(1);
            const parsed = JSON.parse(lastMessage(output));
            const fence = parsed[0].findings.find((f: { code: string }) => f.code === 'L2.unclosed-code-fence');
            expect(fence).toBeDefined();
            expect(fence.severity).toBe('error');

            // --fix repairs structural findings only — it must not auto-close fences.
            await main(['feature', 'check', id, '--fix'], { cwd, output: createCapturedOutput() });
            expect(await Bun.file(featurePath).text()).toContain('never closed');
            const rechecked = createCapturedOutput();
            const recheckCode = await main(['feature', 'check', id, '--json'], { cwd, output: rechecked });
            expect(recheckCode).toBe(1);
            const reparsed = JSON.parse(lastMessage(rechecked));
            expect(
                reparsed[0].findings.find((f: { code: string }) => f.code === 'L2.unclosed-code-fence'),
            ).toBeDefined();
        } finally {
            // This file shares one corpus cwd across all tests; the feature must
            // not linger — dropping the file frees its top-level letter (A-Z
            // allocation is finite) for the later move/refresh tests.
            rmSync(featurePath);
        }
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

describe('spur feature check branch coverage (per-verb split)', () => {
    test('check --fix reopens a verifying feature with a live linked task through the guarded transition', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-check-reopen-'));
        const featuresDir = join(root, 'features');
        try {
            const cOut = createCapturedOutput();
            await main(['feature', 'create', 'Reopen Me', '--folder', featuresDir], { cwd: root, output: cOut });
            const id = createdId(cOut);
            // Fixture: place the feature at `verifying` directly — the reopen path is what is under test.
            const file = join(featuresDir, readdirSync(featuresDir).find((f) => f.startsWith(`${id}_`)) ?? '');
            writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: backlog$/m, 'status: verifying'));
            mkdirSync(join(root, 'docs', 'tasks'), { recursive: true });
            writeFileSync(
                join(root, 'docs', 'tasks', '0001_live.md'),
                `---\nname: live\nstatus: wip\nfeature_id: ${id}\n---\n\n# live\n`,
            );

            const output = createCapturedOutput();
            await main(['feature', 'check', id, '--fix', '--folder', featuresDir], { cwd: root, output });
            expect(output.messages.join('\n')).toContain(`reopened feature ${id} (verifying -> active)`);
            expect(readFileSync(file, 'utf8')).toMatch(/^status: active$/m);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('check against an unreadable features folder exits 1 with a structured error', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'check', '--json', '--folder', join(cwd, 'no-such-dir')], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('no-such-dir');
    });
});
