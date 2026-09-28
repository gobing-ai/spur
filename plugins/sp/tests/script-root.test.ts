import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars, setEnvVar } from '../lib/env';
import {
    digestScriptSet,
    main,
    PROJECT_SCRIPTS_DIR,
    runScriptRoot,
    SCRIPT_ROOT_USAGE,
    SOURCE_REPO_MARKER,
} from '../scripts/script-root';

/**
 * Task 0960 R2/R3: run-start script-resolution identity. These exercise the exported
 * `runScriptRoot`/`main` entry points (the same ones the spawned script and its node twin
 * run under `import.meta.main`), so the source-repo/installed/unresolved split is pinned
 * without spawning the pipeline.
 */

function cleanup(cwd: string): void {
    rmSync(cwd, { recursive: true, force: true });
}

test('source-repo mode: the marker selects the project tree and never probes superskill', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'script-root-src-'));
    try {
        mkdirSync(join(cwd, 'config'), { recursive: true });
        writeFileSync(join(cwd, SOURCE_REPO_MARKER), '{}\n');
        mkdirSync(join(cwd, PROJECT_SCRIPTS_DIR), { recursive: true });
        writeFileSync(join(cwd, PROJECT_SCRIPTS_DIR, 'a.ts'), 'export const a = 1;\n');

        const result = runScriptRoot(
            { __runId: 'r-src' },
            {
                cwd,
                resolveScript: () => {
                    throw new Error('source-repo mode must not resolve the installed twin');
                },
            },
        );

        expect(result.mode).toBe('source-repo');
        expect(result.source).toBe('project');
        expect(result.dir).toBe(PROJECT_SCRIPTS_DIR);
        expect(result.exitCode).toBe(0);
        const row = JSON.parse(readFileSync(join(cwd, result.resultFile), 'utf8'));
        expect(row.mode).toBe('source-repo');
        expect(row.scriptSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
        cleanup(cwd);
    }
});

test('installed mode: resolves the twin dir and warns once about a dead vendored tree', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'script-root-installed-'));
    try {
        // A vendored tree with no marker — the shadowing dir this task stops executing.
        mkdirSync(join(cwd, PROJECT_SCRIPTS_DIR), { recursive: true });
        writeFileSync(join(cwd, PROJECT_SCRIPTS_DIR, 'stale.ts'), 'stale\n');
        const installed = join(cwd, 'staging', 'sp');
        mkdirSync(installed, { recursive: true });
        writeFileSync(join(installed, 'script-root.mjs'), 'x\n');

        const warnings: string[] = [];
        const result = runScriptRoot(
            { __runId: 'r-installed' },
            {
                cwd,
                resolveScript: () => ({ path: join(installed, 'script-root.mjs'), source: 'global' }),
                warn: (message) => warnings.push(message),
            },
        );

        expect(result.mode).toBe('installed');
        expect(result.source).toBe('global');
        expect(result.dir).toBe(installed);
        expect(result.exitCode).toBe(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(PROJECT_SCRIPTS_DIR);
        expect(warnings[0]).toContain(SOURCE_REPO_MARKER);
    } finally {
        cleanup(cwd);
    }
});

test('installed mode resolves through a fake superskill on PATH (real resolver)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'script-root-path-'));
    const previousPath = getEnvVars().PATH;
    try {
        const bin = join(cwd, 'bin');
        mkdirSync(bin, { recursive: true });
        const installed = join(cwd, 'staging');
        mkdirSync(installed, { recursive: true });
        writeFileSync(join(installed, 'script-root.mjs'), 'x\n');
        const stub = join(bin, 'superskill');
        writeFileSync(
            stub,
            `#!/bin/sh\necho '{"plugin":"sp","rel":"script-root.mjs","path":"${join(installed, 'script-root.mjs')}","source":"global"}'\n`,
        );
        chmodSync(stub, 0o755);
        setEnvVar('PATH', `${bin}:${previousPath ?? ''}`);

        const result = runScriptRoot({ __runId: 'r-path' }, { cwd, warn: () => {} });
        expect(result.mode).toBe('installed');
        expect(result.dir).toBe(installed);
    } finally {
        setEnvVar('PATH', previousPath);
        cleanup(cwd);
    }
});

test('unresolved mode: nothing resolves → error recorded, exit 0, run never aborted', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'script-root-unresolved-'));
    try {
        const result = runScriptRoot({ __runId: 'r-none' }, { cwd, resolveScript: () => null, warn: () => {} });
        expect(result.mode).toBe('unresolved');
        expect(result.error).toBeTruthy();
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(readFileSync(join(cwd, result.resultFile), 'utf8')).mode).toBe('unresolved');
    } finally {
        cleanup(cwd);
    }
});

test('scriptSetDigest is non-recursive and changes when one resolved file changes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'script-root-digest-'));
    try {
        mkdirSync(join(cwd, 'd', 'nested'), { recursive: true });
        writeFileSync(join(cwd, 'd', 'a.ts'), 'a\n');
        writeFileSync(join(cwd, 'd', 'nested', 'ignored.ts'), 'nested\n');
        const before = digestScriptSet('d', cwd);
        // The nested file is not part of the set.
        writeFileSync(join(cwd, 'd', 'nested', 'ignored.ts'), 'changed\n');
        expect(digestScriptSet('d', cwd)).toBe(before);
        // A top-level file change moves the digest.
        writeFileSync(join(cwd, 'd', 'a.ts'), 'b\n');
        expect(digestScriptSet('d', cwd)).not.toBe(before);
    } finally {
        cleanup(cwd);
    }
});

test('main reads --run-id and rejects an unknown flag', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'script-root-main-'));
    try {
        mkdirSync(join(cwd, 'config'), { recursive: true });
        writeFileSync(join(cwd, SOURCE_REPO_MARKER), '{}\n');
        mkdirSync(join(cwd, PROJECT_SCRIPTS_DIR), { recursive: true });
        expect(main(['--run-id', 'r-main'], { __runId: '' }, { cwd })).toBe(0);
        expect(JSON.parse(readFileSync(join(cwd, '.spur', 'run', 'r-main-script-root.json'), 'utf8')).mode).toBe(
            'source-repo',
        );
        expect(main(['--bogus'], { __runId: 'r' }, { cwd })).toBe(2);
        expect(SCRIPT_ROOT_USAGE).toContain('--run-id');
    } finally {
        cleanup(cwd);
    }
});
