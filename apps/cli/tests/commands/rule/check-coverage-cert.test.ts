/**
 * `spur rule check-coverage-cert` transport (A94 1412): uncertified coverage evidence must exit 1 with
 * the coverage-artifact diagnostic and recovery, and a malformed `--lcov` value must exit 2.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { certifyCanonicalRun, startCanonicalRun } from '@gobing-ai/spur-app';
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

describe('spur rule check-coverage-cert', () => {
    test('uncertified evidence exits 1 with the coverage-artifact diagnostic and recovery', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-covcert-'));
        try {
            const result = await run(['rule', 'check-coverage-cert'], root);
            expect(result.code).toBe(1);
            const text = result.messages.join('\n');
            expect(text).toContain('coverage-artifact: missing');
            expect(text).toContain('bun run test:full');

            const json = await run(['rule', 'check-coverage-cert', '--json'], root);
            expect(json.code).toBe(1);
            const payload = json.json as { ok: boolean; findings: { kind: string; detail: string }[] };
            expect(payload.ok).toBe(false);
            expect(payload.findings[0]?.kind).toBe('coverage-artifact');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('an empty --lcov value is a usage error (exit 2), not a silent pass', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-covcert-usage-'));
        try {
            const result = await run(['rule', 'check-coverage-cert', '--lcov', ' '], root);
            expect(result.code).toBe(2);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('spur rule check-coverage-cert — certified and envelope branches', () => {
    /** A git project with a published certification, built through the app service. */
    async function certified(): Promise<string> {
        const root = mkdtempSync(join(tmpdir(), 'spur-covcert-ok-'));
        writeFileSync(join(root, '.gitignore'), '.coverage/\n');
        writeFileSync(join(root, 'README.md'), '# fixture\n');
        for (const argv of [
            ['init', '-q', '.'],
            ['add', '.'],
            ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'init'],
        ]) {
            expect(Bun.spawnSync(['git', ...argv], { cwd: root }).exitCode).toBe(0);
        }
        const start = await startCanonicalRun(root);
        writeFileSync(join(start.coverageDir, 'lcov.info'), 'SF:src/ok.ts\nDA:1,1\nLF:100\nLH:90\nend_of_record\n');
        expect((await certifyCanonicalRun(root, start)).ok).toBe(true);
        return root;
    }

    test('certified evidence exits 0 in text and in the envelope', async () => {
        const root = await certified();
        try {
            const text = await run(['rule', 'check-coverage-cert'], root);
            expect(text.code, text.messages.join('\n')).toBe(0);
            expect(text.messages.join('\n')).toContain('certified');

            const envelope = await run(['rule', 'check-coverage-cert', '--json', '--json-envelope'], root);
            expect(envelope.code).toBe(0);
            const payload = envelope.json as { ok: boolean; data?: { ok: boolean } };
            expect(payload.data?.ok).toBe(true);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('the refusal also renders inside the envelope', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-covcert-envfail-'));
        try {
            const result = await run(['rule', 'check-coverage-cert', '--json', '--json-envelope'], root);
            expect(result.code).toBe(1);
            const payload = result.json as { data?: { ok: boolean; findings: unknown[] } };
            expect(payload.data?.ok).toBe(false);
            expect(payload.data?.findings).toHaveLength(1);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
