import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed Node twin records identity, fingerprint, action and closure without a checkout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-inline-installed-'));
    const plugin = join(root, 'installed plugin');
    const project = join(root, 'project');
    try {
        mkdirSync(join(plugin, 'scripts'), { recursive: true });
        mkdirSync(join(plugin, 'lib'), { recursive: true });
        mkdirSync(project);
        cpSync(
            resolve(import.meta.dir, '../scripts/inline-run-setup.mjs'),
            join(plugin, 'scripts/inline-run-setup.mjs'),
        );
        cpSync(
            resolve(import.meta.dir, '../lib/inline-run.generated.mjs'),
            join(plugin, 'lib/inline-run.generated.mjs'),
        );
        const cli = join(root, 'cli-fixture.mjs');
        const definition = join(root, 'selected.yaml');
        writeFileSync(
            definition,
            `"$schema": "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"
kind: state-machine
name: installed-smoke
initialState: start
terminalStates: [end]
states:
  - id: start
  - id: end
transitions:
  - from: start
    to: end
    guard: { kind: always }
`,
        );
        // Fixture supplies only the existing CLI projection. The detached child loads real app code.
        const projection = spawnSync(
            'bun',
            [
                resolve(import.meta.dir, '../../../apps/cli/src/index.ts'),
                'workflow',
                'show',
                definition,
                '--format',
                'todo',
                '--json',
            ],
            { cwd: project, encoding: 'utf8', timeout: 30_000 },
        );
        expect(projection.status, projection.stderr).toBe(0);
        const inventory = JSON.parse(projection.stdout);
        inventory.source.layer = 'shared';
        writeFileSync(cli, `console.log(${JSON.stringify(JSON.stringify(inventory))});`);
        const invoke = (...args: string[]) =>
            spawnSync('node', [join(plugin, 'scripts/inline-run-setup.mjs'), ...args, '--spur-bin', `node ${cli}`], {
                cwd: project,
                encoding: 'utf8',
                timeout: 30_000,
            });
        const setup = invoke('--run-id', 'installed-run', '--file', 'installed-smoke');
        expect(setup.status, setup.stderr).toBe(0);
        const shellAttempt = spawnSync(
            'node',
            [
                join(plugin, 'scripts/inline-run-setup.mjs'),
                '--run-id',
                'shell-attempt',
                '--file',
                'installed-smoke',
                '--spur-bin',
                `node ${cli}; touch shell-marker`,
            ],
            { cwd: project, encoding: 'utf8', timeout: 30_000 },
        );
        expect(shellAttempt.status).toBe(1);
        expect(shellAttempt.stderr).toContain('must not contain shell metacharacters');
        expect(existsSync(join(project, 'shell-marker'))).toBe(false);
        const outcome = JSON.parse(readFileSync(join(project, '.spur/run/installed-run-inline-setup.json'), 'utf8'));
        expect(outcome).toMatchObject({ ok: true, layer: 'shared', definitionDigest: inventory.definitionDigest });
        expect(invoke('--run-id', 'installed-run', '--file', 'installed-smoke').status).toBe(0);

        expect(spawnSync('git', ['init', '-q'], { cwd: project }).status).toBe(0);
        writeFileSync(join(project, 'source.txt'), 'tracked\n');
        expect(spawnSync('git', ['add', 'source.txt'], { cwd: project }).status).toBe(0);
        expect(
            spawnSync(
                'git',
                ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'],
                { cwd: project },
            ).status,
        ).toBe(0);
        writeFileSync(join(project, 'task.md'), '## 0914. Fixture\n\n### Requirements\n\n- [ ] R1. Fixture\n');
        const fingerprint = invoke('--fingerprint', '--task-file', 'task.md');
        expect(fingerprint.status, fingerprint.stderr).toBe(0);
        expect(fingerprint.stdout.trim()).toMatch(/^sha256:[a-f0-9]{64}$/);
        const action = invoke(
            '--action',
            '--run-id',
            'installed-run',
            '--node',
            'start',
            '--kind',
            'note',
            '--status',
            'done',
            '--ok',
            'true',
            '--duration-ms',
            '12',
        );
        expect(action.status, action.stderr).toBe(0);
        expect(JSON.parse(action.stdout).ok).toBe(true);
        const close = invoke('--close', '--run-id', 'installed-run', '--status', 'done');
        expect(close.status, close.stderr).toBe(0);
        const db = new Database(join(project, '.spur/spur.db'), { readonly: true });
        try {
            expect(db.query('SELECT status FROM runs WHERE id = ?').get('installed-run')).toEqual({ status: 'done' });
            expect(db.query('SELECT COUNT(*) AS count FROM action_runs WHERE run_id = ?').get('installed-run')).toEqual(
                { count: 1 },
            );
        } finally {
            db.close();
        }
        const missingAction = invoke(
            '--action',
            '--run-id',
            'missing-run',
            '--node',
            'start',
            '--kind',
            'note',
            '--status',
            'done',
            '--ok',
            'true',
            '--duration-ms',
            '1',
        );
        expect(missingAction.status).toBe(0);
        expect(JSON.parse(missingAction.stdout).ok).toBe(false);
        expect(invoke('--close', '--run-id', 'missing-run', '--status', 'done').status).toBe(1);
        writeFileSync(definition, readFileSync(definition, 'utf8').replace('installed-smoke', 'drifted'));
        const drift = invoke('--run-id', 'drifted-run', '--file', 'installed-smoke');
        expect(drift.status).toBe(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 60_000);
