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

test('plugin large-task thresholds stay aligned with the application defaults', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const app = readFileSync(join(repoRoot, 'packages/app/src/services/task-size-precheck.ts'), 'utf8');
    const plugin = readFileSync(join(repoRoot, 'plugins/sp/scripts/task-size-precheck.ts'), 'utf8');

    expect(plugin.match(/LARGE_TASK_REQS = (\d+)/)?.[1]).toBe(app.match(/maxReqs: (\d+)/)?.[1]);
    expect(plugin.match(/LARGE_TASK_PLAN_ITEMS = (\d+)/)?.[1]).toBe(app.match(/maxPlanItems: (\d+)/)?.[1]);
});
