/**
 * `spur builder bundle-plugins|bundle-laya-worker|emit-board-types|emit-migration-sql` transport
 * (A94 1410): the four verbs that moved out of `scripts/commands/` onto the shared `runVerb`
 * contract — `--source-root` validation, the JSON envelope, and a nonzero exit on failure.
 *
 * The generator behaviour itself is owned by `packages/app/tests/builder/*` and the subprocess E2E
 * (`artifacts.e2e.test.ts`); this suite drives the transport in-process so its branches are measured.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src';

/** Repo root: apps/cli/tests/commands/builder → repo. */
const REPO_ROOT = join(import.meta.dir, '../../../../..');

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

/** A minimal Spur checkout: the two markers `resolveSourceRoot` requires. */
function checkout(root: string): string {
    const repo = join(root, 'checkout');
    mkdirSync(join(repo, 'apps', 'cli'), { recursive: true });
    mkdirSync(join(repo, 'packages', 'app'), { recursive: true });
    writeFileSync(join(repo, 'apps', 'cli', 'package.json'), '{"name":"cli"}');
    writeFileSync(join(repo, 'packages', 'app', 'package.json'), '{"name":"app"}');
    return repo;
}

const VERBS = ['bundle-plugins', 'bundle-laya-worker', 'emit-board-types', 'emit-migration-sql'] as const;

describe('the four staging/generator verbs share one transport grammar', () => {
    test('each exposes --source-root and the shared JSON flags', async () => {
        for (const verb of VERBS) {
            const result = await run(['builder', verb, '--help'], tmpdir());
            const help = result.messages.join('\n');
            expect([verb, result.code]).toEqual([verb, 0]);
            expect(help).toContain('--source-root <dir>');
            expect(help).toContain('--json');
            expect(help).toContain('--json-envelope');
        }
    });

    test('each refuses a non-checkout source root with exit 1 and a structured error', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-artifact-transport-'));
        try {
            writeFileSync(join(dir, 'package.json'), '{"name":"not-spur"}');
            for (const verb of VERBS) {
                const result = await run(['builder', verb, '--source-root', dir, '--json'], dir);
                expect([verb, result.code]).toEqual([verb, 1]);
                const payload = result.json as { error: { code: string; message: string } };
                expect(payload.error.code).toBe('build');
                expect(payload.error.message).toContain('not a Spur source checkout');
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('the human-readable rendering of the same transport', () => {
    test('a success prints one line per artifact plus the verb summary', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-artifacts-text-'));
        try {
            const repo = checkout(dir);
            mkdirSync(join(repo, 'plugins', 'sp'), { recursive: true });
            writeFileSync(join(repo, 'plugins', 'sp', 'plugin.json'), '{"name":"sp"}');
            mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
            writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), '{"name":"demo"}');

            const result = await run(['builder', 'bundle-plugins', '--source-root', repo], dir);
            const text = result.messages.join('\n');
            expect(result.code, text).toBe(0);
            expect(text).toContain(`plugins\t${join(repo, 'apps', 'cli', 'plugins')}`);
            expect(text).toContain('bundle-plugins: ok');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('a failure prints the actionable message and no artifact lines', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-artifacts-text-fail-'));
        try {
            const result = await run(['builder', 'emit-board-types', '--source-root', dir], dir);
            expect(result.code).toBe(1);
            expect(result.messages.join('\n')).toContain('not a Spur source checkout');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('bundle-plugins and emit-migration-sql succeed on a checkout', () => {
    test('bundle-plugins stages both trees and answers with the envelope', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-artifacts-ok-'));
        try {
            const repo = checkout(dir);
            mkdirSync(join(repo, 'plugins', 'sp'), { recursive: true });
            writeFileSync(join(repo, 'plugins', 'sp', 'plugin.json'), '{"name":"sp","version":"0.1.0"}');
            mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
            writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), '{"name":"demo"}');

            const result = await run(['builder', 'bundle-plugins', '--source-root', repo, '--json'], dir);
            expect(result.code, result.messages.join('\n')).toBe(0);
            const payload = result.json as { ok: boolean; artifacts: { kind: string }[] };
            expect(payload.ok).toBe(true);
            expect(payload.artifacts.map((artifact) => artifact.kind)).toEqual(['plugins', 'marketplace']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('emit-migration-sql writes the module from the checkout’s released SQL', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-migration-ok-'));
        try {
            const repo = checkout(dir);
            await mkdir(join(repo, 'drizzle'), { recursive: true });
            await writeFile(
                join(repo, 'drizzle', '0037_spur_cli_history_dimension_marts.sql'),
                'CREATE TABLE demo (id TEXT);\n',
            );
            const result = await run(['builder', 'emit-migration-sql', '--source-root', repo, '--json'], dir);
            expect(result.code, result.messages.join('\n')).toBe(0);
            const payload = result.json as { artifacts: { path: string; kind: string }[] };
            expect(payload.artifacts[0]?.kind).toBe('migration-sql:changed');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('the generator verbs against this checkout', () => {
    test('emit-board-types regenerates the committed declarations unchanged', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-board-transport-'));
        try {
            const result = await run(['builder', 'emit-board-types', '--source-root', REPO_ROOT, '--json'], dir);
            expect(result.code, result.messages.join('\n')).toBe(0);
            const payload = result.json as { artifacts: { kind: string }[] };
            expect(payload.artifacts).toHaveLength(2);
            for (const artifact of payload.artifacts) expect(artifact.kind).toEndWith(':unchanged');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    // The worker package is darwin-only (ADR-041); Linux CI cannot resolve it.
    const hasLayaMlx = (() => {
        try {
            Bun.resolveSync('@gobing-ai/ts-laya-mlx', join(REPO_ROOT, 'packages', 'app'));
            return true;
        } catch {
            return false;
        }
    })();

    test.skipIf(!hasLayaMlx)('bundle-laya-worker stages the worker into an explicit out-dir', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-worker-transport-'));
        try {
            const out = join(dir, 'worker');
            const result = await run(['builder', 'bundle-laya-worker', out, '--source-root', REPO_ROOT, '--json'], dir);
            expect(result.code, result.messages.join('\n')).toBe(0);
            const payload = result.json as { artifacts: { path: string; kind: string }[] };
            expect(payload.artifacts[0]).toEqual({ path: join(out, 'laya_worker.py'), kind: 'worker' });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
