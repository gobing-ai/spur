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
    test('passes against the current repo: documented set matches the union across all 9 workflows', () => {
        const res = runCheck(REPO_ROOT);
        expect(res.status).toBe(0);
        expect(res.stdout).toContain('inline-pipeline-parity-check: ok');
        // 9 = the catalogue after task 0946 retired decision-routing-example.yaml (the 0911
        // authoring example moved to packages/app/tests/services/fixtures/); before that: 0866
        // retired basic / docs-pipeline / feature-dev and 0872 added feature-verification, and
        // 0911's example made it 10. Its retirement dropped `hitl.select` from the live union,
        // so the documented set and the driver mirror dropped it with it (parity contract:
        // "remove the entry when the corresponding kind is dropped from the YAML").
        expect(res.stdout).toMatch(/9 workflows/);
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

    test('0881 R7: a kind deleted from the driver markdown reference is caught', () => {
        const fs = require('node:fs') as typeof import('node:fs');
        const tmp = join('/tmp', `t0881-ref-${Date.now()}`);
        const workflowsDir = join(tmp, 'config', 'workflows');
        fs.mkdirSync(workflowsDir, { recursive: true });
        fs.writeFileSync(
            join(workflowsDir, 'ok.yaml'),
            `kind: state-machine\ninitialState: s1\nterminalStates: [s1]\nstates:\n  - id: s1\n    onEnter:\n      - kind: shell\n        options: { command: 'true' }\ntransitions:\n  - from: s1\n    to: s1\n    guard:\n      kind: always\n`,
        );
        // Real driver doc, minus the `shell` action — the deleted reference.
        const real = fs.readFileSync(
            join(REPO_ROOT, 'plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md'),
            'utf8',
        );
        const refDir = join(tmp, 'plugins/sp/skills/spur-dev/references');
        fs.mkdirSync(refDir, { recursive: true });
        fs.writeFileSync(join(refDir, 'inline-pipeline-driver.md'), real.replace('`shell` · `note`', '`note`'));
        try {
            const res = runCheck(tmp);
            expect(res.status).toBe(1);
            expect(res.stderr).toContain('deleted from the driver markdown reference');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('0881 R7: a spurious dependencies[] edge is caught', () => {
        const fs = require('node:fs') as typeof import('node:fs');
        const tmp = join('/tmp', `t0881-dep-${Date.now()}`);
        const workflowsDir = join(tmp, 'config', 'workflows');
        const tasksDir = join(tmp, 'docs', 'tasks5');
        fs.mkdirSync(workflowsDir, { recursive: true });
        fs.mkdirSync(tasksDir, { recursive: true });
        fs.writeFileSync(
            join(workflowsDir, 'ok.yaml'),
            `kind: state-machine\ninitialState: s1\nterminalStates: [s1]\nstates:\n  - id: s1\n    onEnter:\n      - kind: shell\n        options: { command: 'true' }\ntransitions:\n  - from: s1\n    to: s1\n    guard:\n      kind: always\n`,
        );
        fs.writeFileSync(join(tasksDir, '0001_real.md'), '---\ntitle: real\ndependencies: ["9999"]\n---\n\nbody\n');
        try {
            const res = runCheck(tmp);
            expect(res.status).toBe(1);
            expect(res.stderr).toContain('spurious dependency edge');
            expect(res.stderr).toContain('9999');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
