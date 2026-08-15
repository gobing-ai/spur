import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('task-size-precheck passes executor names as argv, not shell source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = join(dir, 'spur');
        const injected = join(dir, 'injected');
        writeFileSync(
            fakeSpur,
            `#!/bin/sh
if [ "$1" = task ]; then
    printf '%s\\n' '{"content":"### Requirements\\n- [ ] R1. x\\n- [ ] R2. x\\n- [ ] R3. x\\n- [ ] R4. x\\n- [ ] R5. x\\n- [ ] R6. x\\n### Plan\\n- [ ] x"}'
else
    printf '%s\\n' '{"agents":[{"capabilityTier":"standard"}]}'
fi
`,
        );
        chmodSync(fakeSpur, 0o755);

        execFileSync(
            'bun',
            [
                join(import.meta.dir, '..', 'scripts', 'task-size-precheck.ts'),
                '0487',
                '--spur-bin',
                fakeSpur,
                '--max-reqs',
                '10',
                '--max-plan-items',
                '12',
                '--executor',
                `standard; touch ${injected}`,
            ],
            { cwd: dir, stdio: 'pipe' },
        );

        expect(existsSync(injected)).toBe(false);
        expect(readFileSync(join(dir, '.spur/run/0487-precheck-size.status'), 'utf8')).toBe('FAIL\n');
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

test('plugin large-task thresholds stay aligned with the application defaults', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const app = readFileSync(join(repoRoot, 'packages/app/src/services/task-size-precheck.ts'), 'utf8');
    const plugin = readFileSync(join(repoRoot, 'plugins/sp/scripts/task-size-precheck.ts'), 'utf8');

    expect(plugin.match(/LARGE_TASK_REQS = (\d+)/)?.[1]).toBe(app.match(/maxReqs: (\d+)/)?.[1]);
    expect(plugin.match(/LARGE_TASK_PLAN_ITEMS = (\d+)/)?.[1]).toBe(app.match(/maxPlanItems: (\d+)/)?.[1]);
});

/** Within-limits task body: 4 R-items, 2 Plan items — under default caps. */
const WITHIN_LIMITS_BODY =
    '### Requirements\\n- [ ] R1. a\\n- [ ] R2. b\\n- [ ] R3. c\\n- [ ] R4. d\\n### Plan\\n- [ ] p1\\n- [ ] p2';

/** Above large-task thresholds: 6 R-items, 0 Plan — triggers capability gate. */
const LARGE_TASK_BODY =
    '### Requirements\\n- [ ] R1. a\\n- [ ] R2. b\\n- [ ] R3. c\\n- [ ] R4. d\\n- [ ] R5. e\\n- [ ] R6. f\\n### Plan\\n';

function writeFakeSpur(dir: string, opts: { tier?: string; body?: string }): string {
    const fakeSpur = join(dir, 'spur');
    const body = opts.body ?? WITHIN_LIMITS_BODY;
    const tier = opts.tier ?? 'standard';
    writeFileSync(
        fakeSpur,
        `#!/bin/sh
if [ "$1" = task ]; then
    printf '%s\\n' '{"content":"${body}"}'
else
    printf '%s\\n' '{"agents":[{"capabilityTier":"${tier}"}]}'
fi
`,
    );
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

test('multi-token spurBin resolves on task-fetch call site (R1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = writeFakeSpur(dir, {});
        // Two-token form: /bin/sh <stub> — mirrors resolveSpurBin() runtime launch
        const multiToken = `/bin/sh ${fakeSpur}`;
        const { status, stderr } = runPrecheck(dir, ['0501', '--spur-bin', multiToken]);
        expect(status).toBe('PASS\n');
        expect(stderr).not.toContain('could not fetch task');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('multi-token spurBin resolves on capability-tier call site (R2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = writeFakeSpur(dir, { tier: 'capable-1', body: LARGE_TASK_BODY });
        const multiToken = `/bin/sh ${fakeSpur}`;
        // Raised caps so size limits alone do not FAIL; capability gate is the path under test
        const { status } = runPrecheck(dir, [
            '0501',
            '--spur-bin',
            multiToken,
            '--max-reqs',
            '10',
            '--max-plan-items',
            '12',
            '--executor',
            'capable-exec',
        ]);
        // Pre-fix: ENOENT on doctor → tier 'standard' → FAIL "requires a capable executor"
        expect(status).toBe('PASS\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('single-token spurBin (compiled binary shape) still works (R3)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = writeFakeSpur(dir, {});
        const { status, stderr } = runPrecheck(dir, ['0501', '--spur-bin', fakeSpur]);
        expect(status).toBe('PASS\n');
        expect(stderr).not.toContain('could not fetch task');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('single-token spurBin resolves capability-tier call site (R3/R4)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-size-precheck-'));
    try {
        const fakeSpur = writeFakeSpur(dir, { tier: 'capable-1', body: LARGE_TASK_BODY });
        const { status } = runPrecheck(dir, [
            '0501',
            '--spur-bin',
            fakeSpur,
            '--max-reqs',
            '10',
            '--max-plan-items',
            '12',
            '--executor',
            'capable-exec',
        ]);
        expect(status).toBe('PASS\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
