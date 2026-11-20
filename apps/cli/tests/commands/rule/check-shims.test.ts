/**
 * `spur rule check-shims` transport (A94 1412): the ledger's exit contract.
 *
 * 0 pass (including a missing manifest) / 1 findings / an unreadable manifest refuses instead of passing.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

/** A project with a shim ledger and one source root. */
function shimProject(entry: unknown[], source: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-shims-cli-'));
    mkdirSync(join(root, 'config'), { recursive: true });
    mkdirSync(join(root, 'apps'), { recursive: true });
    writeFileSync(join(root, 'config', 'transition-shims.json'), JSON.stringify({ entries: entry }));
    for (const [file, text] of Object.entries(source)) writeFileSync(join(root, 'apps', file), text);
    return root;
}

describe('spur rule check-shims', () => {
    const entry = {
        id: 'ok-shim',
        wbs: '0536',
        file: 'apps/a.ts',
        keepsWorking: 'x',
        removalCondition: 'y',
    };

    test('a matching ledger passes with exit 0', async () => {
        const root = shimProject([entry], { 'a.ts': '// @transition-shim(ok-shim) — keeps working\n' });
        try {
            const result = await run(['rule', 'check-shims'], root);
            expect(result.code, result.messages.join('\n')).toBe(0);
            expect(result.messages.join('\n')).toContain('PASS');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('an unregistered marker exits 1 and the envelope carries the finding', async () => {
        const root = shimProject([], { 'a.ts': '// @transition-shim(ghost) — orphan\n' });
        try {
            const json = await run(['rule', 'check-shims', '--json'], root);
            expect(json.code).toBe(1);
            const payload = json.json as { ok: boolean; findings: { kind: string; id: string }[] };
            expect(payload.ok).toBe(false);
            expect(payload.findings).toEqual([expect.objectContaining({ kind: 'unregistered', id: 'ghost' })]);

            const text = await run(['rule', 'check-shims'], root);
            expect(text.code).toBe(1);
            expect(text.messages.join('\n')).toContain('unregistered\tghost');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a project without a ledger passes (nothing declared, nothing to track)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-shims-none-'));
        try {
            const result = await run(['rule', 'check-shims'], root);
            expect(result.code).toBe(0);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('an unreadable manifest refuses at exit 1 rather than passing', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-shims-bad-'));
        try {
            mkdirSync(join(root, 'config'), { recursive: true });
            writeFileSync(join(root, 'config', 'transition-shims.json'), '{ not json');
            const result = await run(['rule', 'check-shims'], root);
            expect(result.code).toBe(1);
            expect(result.messages.join('\n')).toContain('manifest unreadable');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('spur rule check-shims — envelope and text branches', () => {
    const lint = { id: 'ok-shim', wbs: '0536', file: 'apps/a.ts', keepsWorking: 'x', removalCondition: 'y' };

    test('the --json-envelope form reports the same finding inside the envelope', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-shims-env-'));
        try {
            mkdirSync(join(root, 'config'), { recursive: true });
            mkdirSync(join(root, 'apps'), { recursive: true });
            writeFileSync(join(root, 'config', 'transition-shims.json'), JSON.stringify({ entries: [lint] }));
            writeFileSync(join(root, 'apps', 'a.ts'), '// @transition-shim(ok-shim) — keeps working\n');

            const result = await run(['rule', 'check-shims', '--json', '--json-envelope'], root);
            expect(result.code).toBe(0);
            const payload = result.json as { ok: boolean; data?: { ok: boolean } };
            expect(payload.ok).toBe(true);
            expect(payload.data?.ok).toBe(true);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a manifest path that cannot be read is a named usage error (exit 2)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-shims-usage-'));
        try {
            // A directory where the manifest should be: readFileSync throws EISDIR.
            mkdirSync(join(root, 'config', 'transition-shims.json'), { recursive: true });
            const result = await run(['rule', 'check-shims', '--json'], root);
            expect(result.code).toBe(2);
            expect(JSON.stringify(result.json)).toContain('usage');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
