import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'transition-shim-check.ts');

/** A manifest entry with every field present — R1 requires all five. */
function entry(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        id: 'ok-shim',
        wbs: '0536',
        file: 'apps/cli/src/commands/agent.ts',
        keepsWorking: 'the legacy binary-name form of --agent still resolves',
        removalCondition: 'no bare-binary --agent value remains in workflows/ and apps/cli/src',
        ...overrides,
    };
}

interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

function run(dir: string, extra: string[] = []): RunResult {
    const r = Bun.spawnSync({
        cmd: [
            'bun',
            SCRIPT,
            '--manifest',
            join(dir, 'config', 'transition-shims.json'),
            '--roots',
            join(dir, 'src'),
            ...extra,
        ],
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        code: r.exitCode ?? -1,
        stdout: new TextDecoder().decode(r.stdout),
        stderr: new TextDecoder().decode(r.stderr),
    };
}

/** Temp project: config/transition-shims.json + src/ source files. Returns the dir. */
function setup(manifestEntries: unknown[], sourceFiles: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'transition-shim-'));
    mkdirSync(join(dir, 'config'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
        join(dir, 'config', 'transition-shims.json'),
        JSON.stringify({ note: 'test', entries: manifestEntries }),
    );
    for (const [file, text] of Object.entries(sourceFiles)) {
        writeFileSync(join(dir, 'src', file), text);
    }
    return dir;
}

test('R1 — every manifest field is required; a missing field fails naming it', () => {
    const dir = setup([{ id: 'broken', wbs: '0536', file: 'x.ts', keepsWorking: 'x' }], {});
    try {
        const { code, stderr } = run(dir);
        expect(code).toBe(1);
        expect(stderr).toContain('removalCondition');
        expect(stderr).toContain('broken');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('R1 — an id that is not lowercase-kebab is rejected', () => {
    const dir = setup([entry({ id: 'Not_Kebab' })], { 'a.ts': '// @transition-shim(Not_Kebab)\n' });
    try {
        const { code, stderr } = run(dir);
        expect(code).toBe(1);
        expect(stderr).toContain('lowercase-kebab');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('R2 — an unregistered marker fails the gate, naming the id and the file', () => {
    const dir = setup([], { 'compat.ts': '// @transition-shim(ghost) — keeps the old thing working\n' });
    try {
        const { code, stderr, stdout } = run(dir);
        expect(code).toBe(1);
        expect(stderr).toContain('@transition-shim(ghost)');
        expect(stderr).toContain('compat.ts');
        expect(stderr).toContain('unregistered');
        expect(stdout).toContain('1 new');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('R2 — a manifest entry whose marker no longer appears fails as a stale entry, distinct from unregistered', () => {
    const dir = setup([entry({ id: 'gone', wbs: '0537' })], { 'clean.ts': 'export const ok = 1;\n' });
    try {
        const { code, stderr, stdout } = run(dir);
        expect(code).toBe(1);
        expect(stderr).toContain('stale manifest entry gone');
        expect(stderr).toContain('0537');
        expect(stdout).toContain('1 stale');
        // The stale entry must not be misreported as a new unregistered marker.
        expect(stderr).not.toContain('unregistered');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('R2 — registered marker with matching manifest entry passes both directions', () => {
    const dir = setup([entry()], { 'compat.ts': '// @transition-shim(ok-shim) — keeps working\n' });
    try {
        const { code, stdout } = run(dir);
        expect(code).toBe(0);
        expect(stdout).toContain('PASS');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('R3 — a missing manifest degrades to no entries, so any marker fails as unregistered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'transition-shim-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), '// @transition-shim(orphan)\n');
    try {
        const { code, stderr } = run(dir);
        expect(code).toBe(1);
        expect(stderr).toContain('orphan');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('R2 — duplicate markers of one id in two files report one unregistered violation naming both', () => {
    const dir = setup([], {
        'a.ts': '// @transition-shim(twice)\n',
        'b.ts': '// @transition-shim(twice)\n',
    });
    try {
        const { code, stderr } = run(dir);
        expect(code).toBe(1);
        expect(stderr).toContain('@transition-shim(twice)');
        expect(stderr).toContain('a.ts');
        expect(stderr).toContain('b.ts');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
