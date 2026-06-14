import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';

const MINIMAL_WORKFLOW_YAML = `name: test-flow
kind: state-machine
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

function makeCtx(cwd = process.cwd()) {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    return {
        cwd,
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    };
}

describe('WorkflowAppService', () => {
    describe('validate', () => {
        test('returns valid=true for a well-formed workflow YAML', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-svc-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.workflow.name).toBe('test-flow');
            }
            await rm(dir, { recursive: true });
        });

        test('returns valid=false with File not found error for missing file', async () => {
            const svc = new WorkflowAppService(makeCtx());
            const result = await svc.validate('/tmp/no-such-workflow-svc.yaml');
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors[0]).toContain('File not found');
            }
        });

        test('returns valid=false with error details for workflow with unknown transition target', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-bad-svc-'));
            const path = join(dir, 'bad.yaml');
            await writeFile(
                path,
                [
                    'name: broken',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: ghost',
                    'terminalStates: [done]',
                ].join('\n'),
            );
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors[0]).toContain('ghost');
            }
            await rm(dir, { recursive: true });
        });

        test('ok field mirrors valid field', async () => {
            const svc = new WorkflowAppService(makeCtx());
            const result = await svc.validate('/tmp/nonexistent-svc.yaml');
            expect(result.ok).toBe(result.valid);
        });
    });

    describe('run', () => {
        test('runs a workflow with an explicit runId and per-run vars', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-run-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path, { runId: 'svc-run-1', vars: { taskId: '0042' } });

            expect(result.status).toBe('done');
            expect(result.runId).toBe('svc-run-1');
            expect(result.finalState).toBe('done');
            await rm(dir, { recursive: true, force: true });
        });

        test('dryRun walks transitions to done without executing actions', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-dry-'));
            const marker = join(dir, 'marker.txt');
            const path = join(dir, 'dry.yaml');
            // The shell action would create a side effect AND fail the run if executed;
            // a dry run must do neither.
            await writeFile(
                path,
                [
                    'name: dry-flow',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '    onEnter:',
                    '      - kind: shell',
                    '        options:',
                    `          command: touch ${marker} && exit 1`,
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: done',
                    'terminalStates: [done]',
                ].join('\n'),
            );

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path, { runId: 'svc-dry-1', dryRun: true });

            expect(result.status).toBe('done');
            expect(result.finalState).toBe('done');
            expect(await Bun.file(marker).exists()).toBe(false);
            await rm(dir, { recursive: true, force: true });
        });

        test('defaults the runId and runs with no options', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-run-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path);

            expect(result.status).toBe('done');
            expect(result.runId.length).toBeGreaterThan(0);
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('list', () => {
        test('returns empty entries when no workflow files exist', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-'));
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.list([join(dir, '.spur', 'workflows')]);
            expect(Array.isArray(result.entries)).toBe(true);
            expect(result.entries.length).toBe(0);
            expect(result.totalFiles).toBe(0);
            expect(result.layers.length).toBeGreaterThanOrEqual(1);
            await rm(dir, { recursive: true, force: true });
        });

        test('discovers workflow files and extracts name + kind', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(
                join(wfDir, 'basic.yaml'),
                'name: test-flow\nkind: state-machine\ninitialState: start\nstates:\n  - id: start\n  - id: done\ntransitions:\n  - from: start\n    to: done\nterminalStates:\n  - done\n',
            );
            await writeFile(
                join(wfDir, 'ci.yaml'),
                'name: ci-pipeline\nkind: transition-flow\nstates: []\ntransitions: []\n',
            );

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.list([join(dir, '.spur', 'workflows')]);

            expect(result.totalFiles).toBe(2);
            const names = result.entries.map((e) => e.name).sort();
            expect(names).toEqual(['ci-pipeline', 'test-flow']);
            const kinds = result.entries.map((e) => e.kind).sort();
            expect(kinds).toEqual(['state-machine', 'transition-flow']);
            for (const entry of result.entries) {
                expect(entry.valid).toBe(true);
                expect(entry.source).toBe('project');
            }
            await rm(dir, { recursive: true, force: true });
        });

        test('skips unparseable YAML files gracefully', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'bad.yaml'), 'not: valid: yaml: [[');

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.list([join(dir, '.spur', 'workflows')]);

            expect(result.totalFiles).toBe(1);
            expect(result.entries[0]?.valid).toBe(false);
            expect(result.entries[0]?.error).toBeDefined();
            await rm(dir, { recursive: true, force: true });
        });

        test('tolerates missing directories', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-'));
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.list([join(dir, 'nonexistent')]);
            expect(result.totalFiles).toBe(0);
            await rm(dir, { recursive: true, force: true });
        });

        test('follows symlinked workflow directories', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-'));
            // Real directory with the YAML file
            const realDir = join(dir, 'real-workflows');
            await mkdir(realDir, { recursive: true });
            await writeFile(join(realDir, 'test.yaml'), MINIMAL_WORKFLOW_YAML);
            // Symlinked .spur/workflows → real-workflows
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(join(dir, '.spur'), { recursive: true });
            await symlink(realDir, wfDir, 'dir');

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.list([join(dir, '.spur', 'workflows')]);

            expect(result.totalFiles).toBe(1);
            expect(result.entries[0]?.valid).toBe(true);
            expect(result.entries[0]?.name).toBe('test-flow');
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('trace', () => {
        test('returns empty listing when no runs exist', async () => {
            const svc = new WorkflowAppService(makeCtx());
            const result = await svc.trace({});
            expect('entries' in result).toBe(true);
            if ('entries' in result) {
                expect(Array.isArray(result.entries)).toBe(true);
                expect(result.entries.length).toBe(0);
                expect(result.total).toBe(0);
            }
        });

        test('lists runs after execution with default last=20', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-trace-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'trace-run-1' });

            const result = await svc.trace({});
            expect('entries' in result).toBe(true);
            if ('entries' in result) {
                expect(result.entries.length).toBeGreaterThanOrEqual(1);
                const entry = result.entries.find((e) => e.runId === 'trace-run-1');
                expect(entry).toBeDefined();
                expect(entry?.workflowName).toBe('test-flow');
                expect(entry?.status).toBe('done');
            }
            await rm(dir, { recursive: true, force: true });
        });

        test('filters by workflow name', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-trace-'));
            await writeFile(join(dir, 'a.yaml'), MINIMAL_WORKFLOW_YAML);
            await writeFile(join(dir, 'b.yaml'), MINIMAL_WORKFLOW_YAML.replace('test-flow', 'other-flow'));

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(join(dir, 'a.yaml'), { runId: 'trace-a' });
            await svc.run(join(dir, 'b.yaml'), { runId: 'trace-b' });

            const result = await svc.trace({ workflow: 'test-flow' });
            expect('entries' in result).toBe(true);
            if ('entries' in result) {
                expect(result.entries.length).toBeGreaterThanOrEqual(1);
                for (const e of result.entries) {
                    expect(e.workflowName).toBe('test-flow');
                }
            }
            await rm(dir, { recursive: true, force: true });
        });

        test('retrieves per-run timeline', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-trace-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'trace-timeline-1' });

            const result = await svc.trace('trace-timeline-1');
            expect('events' in result).toBe(true);
            if ('events' in result) {
                expect(result.run.runId).toBe('trace-timeline-1');
                expect(result.run.workflowName).toBe('test-flow');
                expect(result.events.length).toBeGreaterThan(0);
            }
            await rm(dir, { recursive: true, force: true });
        });

        test('throws for unknown run-id', async () => {
            const svc = new WorkflowAppService(makeCtx());
            await expect(svc.trace('nonexistent-run')).rejects.toThrow('Run not found');
        });

        test('labels dry runs', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-trace-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'trace-dry-1', dryRun: true });

            const result = await svc.trace('trace-dry-1');
            expect('events' in result).toBe(true);
            if ('events' in result) {
                expect(result.run.isDryRun).toBe(true);
            }
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('continue — HITL resume (0063, E3)', () => {
        // A workflow that PAUSES at `gate` (E3) so there is a paused run to resume.
        const PAUSING_YAML = `name: pauser-svc
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: gate
    pause: true
  - id: done
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

        /** Seed a project with the pausing workflow under `.spur/workflows/` (so name→file resolves). */
        async function seedPausing(): Promise<{ svc: WorkflowAppService; dir: string }> {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-continue-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'pauser.yaml'), PAUSING_YAML);
            return { svc: new WorkflowAppService(makeCtx(dir)), dir };
        }

        test('R1: run pauses at the gate, latestPausedRun discovers it, continuePaused resumes to done', async () => {
            const { svc, dir } = await seedPausing();
            const runResult = await svc.run(join(dir, '.spur', 'workflows', 'pauser.yaml'), { runId: 'p1' });
            expect(runResult.status).toBe('paused');
            expect(runResult.finalState).toBe('gate');

            const latest = await svc.latestPausedRun();
            expect(latest?.runId).toBe('p1');
            expect(latest?.workflowName).toBe('pauser-svc');

            const resumed = await svc.continuePaused('p1');
            expect(resumed.status).toBe('done');
            expect(resumed.finalState).toBe('done');

            // No longer paused after resume.
            expect(await svc.latestPausedRun()).toBeNull();
            await rm(dir, { recursive: true, force: true });
        });

        test('R1: latestPausedRun returns null when nothing is paused', async () => {
            const { svc, dir } = await seedPausing();
            expect(await svc.latestPausedRun()).toBeNull();
            await rm(dir, { recursive: true, force: true });
        });

        test('R1: with MULTIPLE paused runs, latestPausedRun discovers the most-recent (ordering)', async () => {
            const { svc, dir } = await seedPausing();
            const wf = join(dir, '.spur', 'workflows', 'pauser.yaml');
            await svc.run(wf, { runId: 'older' }); // paused first
            await new Promise((r) => setTimeout(r, 10)); // ensure a distinct updated_at
            await svc.run(wf, { runId: 'newer' }); // paused second → most recent
            const latest = await svc.latestPausedRun();
            expect(latest?.runId).toBe('newer'); // most-recent-first, not 'older'
            // Resuming 'newer' leaves 'older' still paused → discovery now returns 'older'.
            await svc.continuePaused('newer');
            expect((await svc.latestPausedRun())?.runId).toBe('older');
            await rm(dir, { recursive: true, force: true });
        });

        test('continuePaused on a non-paused / unknown run is a clear error', async () => {
            const { svc, dir } = await seedPausing();
            await expect(svc.continuePaused('no-such-run')).rejects.toThrow(
                /not paused|does not exist|nothing to continue/i,
            );
            await rm(dir, { recursive: true, force: true });
        });
    });
});
