import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '../../..');
const SCRIPT = join(REPO_ROOT, 'plugins/sp/scripts/inline-pipeline-parity-check.ts');

function runCheck(cwd: string): { status: number; stdout: string; stderr: string } {
    const res = spawnSync('bun', [SCRIPT], { cwd, encoding: 'utf8' });
    return {
        status: res.status ?? -1,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
    };
}

describe('inline-pipeline-parity-check (task 0755 R2/R3)', () => {
    test('passes against the current repo: documented set matches the union across all 11 workflows', () => {
        const res = runCheck(REPO_ROOT);
        expect(res.status).toBe(0);
        expect(res.stdout).toContain('inline-pipeline-parity-check: ok');
        expect(res.stdout).toMatch(/11 workflows/);
        expect(res.stderr).toBe('');
    });

    test('exits non-zero with a named divergence when the documented set disagrees with a workflow', () => {
        // Simulate a drift: copy a workflow, add an unknown action kind, point the check at it.
        const tmp = join('/tmp', `t0755-parity-${Date.now()}`);
        const fs = require('node:fs') as typeof import('node:fs');
        const workflowsDir = join(tmp, 'config', 'workflows');
        fs.mkdirSync(workflowsDir, { recursive: true });
        fs.writeFileSync(
            join(workflowsDir, 'drift.yaml'),
            `kind: state-machine
initialState: s1
terminalStates: [s1]
states:
  - id: s1
    onEnter:
      - kind: not.a.real.action
transitions:
  - from: s1
    to: s1
`,
        );
        try {
            const res = runCheck(tmp);
            expect(res.status).toBe(1);
            expect(res.stderr).toContain('not.a.real.action');
            expect(res.stderr).toContain('divergence');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
