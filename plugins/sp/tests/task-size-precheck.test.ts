import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Within the default ceiling: 3 R-items, 1 Plan item. */
const WITHIN_LIMITS_BODY = '### Requirements\\n- [ ] R1. x\\n- [ ] R2. x\\n- [ ] R3. x\\n### Plan\\n- [ ] x';

test('task-size-precheck stays argv-clean and writes PASS for a within-ceiling task', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = join(dir, 'spur');
        const injected = join(dir, 'injected');
        writeFileSync(
            fakeSpur,
            `#!/bin/sh
printf '%s\\n' '{"content":"${WITHIN_LIMITS_BODY}"}'
printf '%s\\n' "$@" > ${injected}
`,
        );
        chmodSync(fakeSpur, 0o755);

        execFileSync(
            'bun',
            [
                join(import.meta.dir, '..', 'scripts', 'task-size-precheck.ts'),
                '0723',
                '--spur-bin',
                fakeSpur,
                '--max-reqs',
                '5',
                '--max-plan-items',
                '4',
            ],
            { cwd: dir, stdio: 'pipe' },
        );

        // Arguments travel as argv to the spur bin, never through a shell source.
        const argv = readFileSync(injected, 'utf8').trim().split(/\s+/);
        expect(argv).toContain('0723');
        expect(existsSync(injected.replace('injected', 'injected '))).toBe(false);
        expect(readFileSync(join(dir, '.spur/run/0723-precheck-size.status'), 'utf8')).toBe('PASS\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('task-size-precheck honors SPUR_BIN when --spur-bin is absent (0539)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-env-'));
    try {
        const fakeSpur = join(dir, 'spur');
        const marker = join(dir, 'env-rung-used');
        writeFileSync(
            fakeSpur,
            `#!/bin/sh
printf '%s\\n' '{"content":"### Requirements\\n- [ ] R1. x\\n### Plan\\n- [ ] x"}' > ${marker}
printf '%s\\n' '{"content":"### Requirements\\n- [ ] R1. x\\n### Plan\\n- [ ] x"}'
`,
        );
        chmodSync(fakeSpur, 0o755);

        execFileSync('bun', [join(import.meta.dir, '..', 'scripts', 'task-size-precheck.ts'), '0539'], {
            cwd: dir,
            stdio: 'pipe',
            env: { ...process.env, SPUR_BIN: fakeSpur },
        });

        // The fake bin ran (marker) and the status file was written from its within-limits body.
        expect(existsSync(marker)).toBe(true);
        expect(readFileSync(join(dir, '.spur/run/0539-precheck-size.status'), 'utf8')).toBe('PASS\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('script defaults stay aligned with the application ceiling (0723: 10/16)', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const app = readFileSync(join(repoRoot, 'packages/app/src/services/task-size-precheck.ts'), 'utf8');
    const plugin = readFileSync(join(repoRoot, 'plugins/sp/scripts/task-size-precheck.ts'), 'utf8');

    expect(app.match(/maxReqs: (\d+)/)?.[1]).toBe('10');
    expect(app.match(/maxPlanItems: (\d+)/)?.[1]).toBe('16');
    // Script env/flag fallbacks (parses `Number(...) || <n>` and `Number(argv[i+1]) || <n>`).
    const fallbacks = [...plugin.matchAll(/\|\| (\d+);/g)].map((m) => m[1]);
    expect(fallbacks).toEqual(['10', '16', '10', '16']);
});

test('count-only since 0723: no executor flag, no doctor call site remains', () => {
    const plugin = readFileSync(join(import.meta.dir, '..', 'scripts', 'task-size-precheck.ts'), 'utf8');
    expect(plugin).not.toContain('--executor');
    expect(plugin).not.toContain('agent doctor');
    expect(plugin).not.toContain('capabilityTier');
    expect(plugin).not.toContain('stage-registry-adapter');
    expect(plugin).not.toContain('LARGE_TASK');
});

/** Above the doubled ceiling: 11 R-items, 0 Plan — FAIL with default limits. */
const OVER_CEILING_BODY = `### Requirements\\n${Array.from({ length: 11 }, (_, i) => `- [ ] R${i + 1}. x`).join(
    '\\n',
)}\\n### Plan\\n`;

function writeFakeSpur(dir: string, body: string): string {
    const fakeSpur = join(dir, 'spur');
    writeFileSync(fakeSpur, `#!/bin/sh\nprintf '%s\\n' '{"content":"${body}"}'\n`);
    chmodSync(fakeSpur, 0o755);
    return fakeSpur;
}

function runPrecheck(cwd: string, args: string[]): { status: string; stderr: string } {
    const r = Bun.spawnSync({
        cmd: ['bun', join(import.meta.dir, '..', 'scripts', 'task-size-precheck.ts'), ...args],
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stderr = new TextDecoder().decode(r.stderr ?? new Uint8Array());
    const wbs = args[0] ?? '0000';
    const statusPath = join(cwd, '.spur/run', `${wbs}-precheck-size.status`);
    const status = existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : '';
    return { status, stderr };
}

test('multi-token spurBin resolves on the task-fetch call site (R1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = writeFakeSpur(dir, WITHIN_LIMITS_BODY);
        // Two-token form: /bin/sh <stub> — mirrors resolveSpurBin() runtime launch
        const multiToken = `/bin/sh ${fakeSpur}`;
        const { status, stderr } = runPrecheck(dir, ['0501', '--spur-bin', multiToken]);
        expect(status).toBe('PASS\n');
        expect(stderr).not.toContain('could not fetch task');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('single-token spurBin (compiled binary shape) still works (R3)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = writeFakeSpur(dir, WITHIN_LIMITS_BODY);
        const { status, stderr } = runPrecheck(dir, ['0501', '--spur-bin', fakeSpur]);
        expect(status).toBe('PASS\n');
        expect(stderr).not.toContain('could not fetch task');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a task above the doubled ceiling fails closed with default limits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-over-'));
    try {
        const fakeSpur = writeFakeSpur(dir, OVER_CEILING_BODY);
        const { status, stderr } = runPrecheck(dir, ['0723', '--spur-bin', fakeSpur]);
        expect(status).toBe('FAIL\n');
        expect(stderr).toContain('11 R-items (max 10)');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a task within the default ceiling passes without any limit flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-defaults-'));
    try {
        const fakeSpur = writeFakeSpur(dir, WITHIN_LIMITS_BODY);
        const { status } = runPrecheck(dir, ['0723', '--spur-bin', fakeSpur]);
        expect(status).toBe('PASS\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
