/**
 * `spur builder check-deps` and the generic `build-binaries` transport (A94 1411).
 *
 * Failure modes first — each one would make the check lie or block a downstream build:
 *   - an empty scope reporting success without checking anything (the skip must be visible)
 *   - findings exiting 0, so a preset that enables the check never fails
 *   - an input error (unreadable lockfile) read as "clean"
 *   - `--entry` requiring a Spur checkout, which is exactly what the generic build drops
 *   - an unknown target compiling the valid ones first
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src';

const T0 = 1_700_000_000;

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

/** A project with one stale `bun link`ed package and one lockfile drift. */
function scaffold(): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-checkdeps-cli-'));
    const linked = `${root}-linked`;
    mkdirSync(join(linked, 'src'), { recursive: true });
    mkdirSync(join(linked, 'dist'), { recursive: true });
    writeFileSync(join(linked, 'package.json'), JSON.stringify({ version: '1.0.0', exports: './dist/index.js' }));
    writeFileSync(join(linked, 'src', 'index.ts'), 'export const a = 1;');
    writeFileSync(join(linked, 'dist', 'index.js'), 'export const a = 1;');
    utimesSync(join(linked, 'src', 'index.ts'), T0 + 500, T0 + 500);
    utimesSync(join(linked, 'dist', 'index.js'), T0, T0);

    mkdirSync(join(root, 'node_modules', '@acme'), { recursive: true });
    symlinkSync(linked, join(root, 'node_modules', '@acme', 'ui'));
    writeFileSync(join(root, 'bun.lock'), JSON.stringify({ packages: { '@acme/core': ['@acme/core@2.0.0'] } }));
    mkdirSync(join(root, 'node_modules', '@acme', 'core'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '@acme', 'core', 'package.json'), JSON.stringify({ version: '1.9.0' }));
    return root;
}

describe('spur builder check-deps', () => {
    test('an empty scope prints the skip and exits 0', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-checkdeps-skip-'));
        try {
            const text = await run(['builder', 'check-deps'], cwd);
            expect(text.code).toBe(0);
            expect(text.messages.join('\n')).toContain('no dependencyScope configured — skipped');

            const json = await run(['builder', 'check-deps', '--json'], cwd);
            expect(json.code).toBe(0);
            expect(json.json).toEqual({ ok: true, findings: [], skipped: 'no dependencyScope configured' });
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('--scope findings exit 1 and name the package and the remedy', async () => {
        const cwd = scaffold();
        try {
            const result = await run(['builder', 'check-deps', '--scope', '@acme/*'], cwd);
            expect(result.code).toBe(1);
            const text = result.messages.join('\n');
            expect(text).toContain('stale-link\t@acme/ui');
            expect(text).toContain('bun run build');
            expect(text).toContain('drift\t@acme/core');
            expect(text).toContain('bun install');
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(`${cwd}-linked`, { recursive: true, force: true });
        }
    });

    test('--json emits the findings envelope with ok false', async () => {
        const cwd = scaffold();
        try {
            const result = await run(['builder', 'check-deps', '--scope', '@acme/*', '--json'], cwd);
            expect(result.code).toBe(1);
            const payload = result.json as { ok: boolean; findings: { kind: string; package: string }[] };
            expect(payload.ok).toBe(false);
            expect(payload.findings.map((finding) => `${finding.kind}:${finding.package}`).sort()).toEqual([
                'drift:@acme/core',
                'stale-link:@acme/ui',
            ]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(`${cwd}-linked`, { recursive: true, force: true });
        }
    });

    test('an unreadable lockfile is an input error (exit 2), never a clean report', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-checkdeps-badlock-'));
        try {
            writeFileSync(join(cwd, 'bun.lock'), 'not json at all');
            const result = await run(['builder', 'check-deps', '--scope', '@acme/*'], cwd);
            expect(result.code).toBe(2);
            expect(result.messages.join('\n')).toContain('check-deps');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });
});

describe('spur builder build-binaries (generic mode)', () => {
    test('--entry refuses an unknown target with exit 1 before compiling', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-binaries-cli-'));
        try {
            writeFileSync(join(cwd, 'main.ts'), 'console.log(1);\n');
            const result = await run(
                ['builder', 'build-binaries', '--entry', 'main.ts', '--targets', 'linux-x64,beos-mips', '--json'],
                cwd,
            );
            expect(result.code).toBe(1);
            expect(JSON.stringify(result.json)).toContain('unknown target: beos-mips');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('the legacy build still validates the checkout first', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-binaries-legacy-'));
        try {
            const result = await run(['builder', 'build-binaries', '--json'], cwd);
            expect(result.code).toBe(1);
            expect(JSON.stringify(result.json)).toContain('not a Spur source checkout');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });
});
