/**
 * `spur rule certify-coverage` transport (A94 1412): a missing command is a usage error, and a failing
 * child keeps its own exit code instead of being flattened to 1.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src';

interface Captured {
    code: number;
    messages: string[];
    json: unknown;
}

async function run(args: string[], cwd: string): Promise<Captured> {
    const messages: string[] = [];
    const code = await main(args, {
        cwd,
        env: getEnvVars(),
        output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
    });
    let json: unknown;
    try {
        json = JSON.parse(messages.at(-1) ?? '{}');
    } catch {
        json = undefined;
    }
    return { code, messages, json };
}

describe('spur rule certify-coverage', () => {
    test('a missing command is a usage error (exit 2)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-certify-usage-'));
        try {
            const result = await run(['rule', 'certify-coverage'], root);
            expect(result.code).toBe(2);
            expect(result.messages.join('\n')).toContain('missing command');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a failing child keeps its own exit code and certifies nothing', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-certify-child-'));
        try {
            // The two-phase window fingerprints the tree first, so the fixture must be a git repo.
            writeFileSync(join(root, '.gitignore'), '.coverage/\n');
            writeFileSync(join(root, 'README.md'), '# fixture\n');
            for (const argv of [
                ['init', '-q', '.'],
                ['add', '.'],
                ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'init'],
            ]) {
                expect(Bun.spawnSync(['git', ...argv], { cwd: root }).exitCode).toBe(0);
            }
            // A real child: `sh -c 'exit 3'` — the verb must forward 3, never 1.
            const result = await run(['rule', 'certify-coverage', '--', 'sh', '-c', 'exit 3'], root);
            expect(result.code).toBe(3);
            expect(result.messages.join('\n')).toContain('exited 3; nothing certified');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('spur rule certify-coverage — certified and envelope branches', () => {
    /** A git project whose child writes the isolated LCOV it is asked for. */
    function project(): string {
        const root = mkdtempSync(join(tmpdir(), 'spur-certify-ok-'));
        writeFileSync(join(root, '.gitignore'), '.coverage/\n');
        writeFileSync(join(root, 'README.md'), '# fixture\n');
        for (const argv of [
            ['init', '-q', '.'],
            ['add', '.'],
            ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'init'],
        ]) {
            expect(Bun.spawnSync(['git', ...argv], { cwd: root }).exitCode).toBe(0);
        }
        return root;
    }

    /** A child that writes a valid LCOV into `{coverageDir}` (the token the verb expands). */
    const CHILD = [
        'sh',
        '-c',
        'printf "SF:src/ok.ts\\nDA:1,1\\nLF:100\\nLH:90\\nend_of_record\\n" > "$SPUR_COVERAGE_DIR/lcov.info"',
    ];

    test('a passing child certifies and reports it (text, then the envelope)', async () => {
        const root = project();
        try {
            const text = await run(['rule', 'certify-coverage', '--', ...CHILD], root);
            expect(text.code, text.messages.join('\n')).toBe(0);
            expect(text.messages.join('\n')).toContain('certified');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
        const envelopeRoot = project();
        try {
            const envelope = await run(
                ['rule', 'certify-coverage', '--json', '--json-envelope', '--', ...CHILD],
                envelopeRoot,
            );
            expect(envelope.code).toBe(0);
            const payload = envelope.json as { data?: { certified?: boolean } };
            expect(payload.data?.certified).toBe(true);
        } finally {
            await rm(envelopeRoot, { recursive: true, force: true });
        }
    });

    test('a refusing child is reported as a coverage-artifact finding in JSON', async () => {
        const root = project();
        try {
            // Exit 0 but produce no tracefile: certification is refused.
            const result = await run(['rule', 'certify-coverage', '--json', '--', 'sh', '-c', 'exit 0'], root);
            expect(result.code).toBe(1);
            const payload = result.json as { ok: boolean; findings: { kind: string }[] };
            expect(payload.ok).toBe(false);
            expect(payload.findings[0]?.kind).toBe('coverage-artifact');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a failing child reports its code in JSON too', async () => {
        const root = project();
        try {
            const result = await run(['rule', 'certify-coverage', '--json', '--', 'sh', '-c', 'exit 4'], root);
            expect(result.code).toBe(4);
            expect((result.json as { childExitCode: number }).childExitCode).toBe(4);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
