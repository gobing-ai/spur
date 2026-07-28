import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, RunDao, TaskRunLinkDao } from '@gobing-ai/spur-domain';
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

        // A bundled workflow declares `$schema: "@gobing-ai/spur/schemas/<name>.json"`.
        // On CI the cwd is a temp dir outside the package tree, so `Bun.resolveSync`
        // cannot find `@gobing-ai/spur` and `$schema` resolution throws → exit 1. Injecting
        // `embeddedSchemas` must serve the schema from memory so validate is cwd-independent.
        test('resolves a package-specifier $schema from embeddedSchemas (CI cwd-independence)', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-embedded-'));
            const path = join(dir, 'pkg-schema.yaml');
            await writeFile(
                path,
                [
                    '"$schema": "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"',
                    'name: embedded-flow',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: done',
                    'terminalStates: [done]',
                ].join('\n'),
            );

            const schema = JSON.stringify({
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
            });
            const embeddedSchemas = new Map([['schemas/state-machine-workflow.schema.json', schema]]);

            const svc = new WorkflowAppService({ ...makeCtx(dir), embeddedSchemas: () => embeddedSchemas });
            const result = await svc.validate(path);
            expect(result.valid).toBe(true);

            // A schema that rejects the workflow proves the embedded copy is actually
            // applied, not silently skipped or falling back to disk resolution.
            const rejecting = new Map([
                [
                    'schemas/state-machine-workflow.schema.json',
                    JSON.stringify({ type: 'object', properties: { name: { enum: ['other'] } } }),
                ],
            ]);
            const svcReject = new WorkflowAppService({ ...makeCtx(dir), embeddedSchemas: () => rejecting });
            const rejected = await svcReject.validate(path);
            expect(rejected.valid).toBe(false);
            await rm(dir, { recursive: true });
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

        test('recordSelfPid stamps the running process pid onto the run row at creation', async () => {
            // The async worker self-records its own pid the instant the engine
            // creates the run row (SelfPidRecordingAdapter), eliminating the
            // launcher-side race where the pid was written before the row existed.
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-selfpid-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const ctx = makeCtx(dir);
            const result = await new WorkflowAppService(ctx).run(path, { runId: 'svc-pid-1', recordSelfPid: true });
            expect(result.status).toBe('done');

            const db = await ctx.getDb();
            const pid = await new RunDao(db).getPid('svc-pid-1');
            expect(pid).toBe(process.pid);
            await rm(dir, { recursive: true, force: true });
        });

        test('a run without recordSelfPid leaves pid null (sync runs are not cancellable by group)', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-nopid-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const ctx = makeCtx(dir);
            await new WorkflowAppService(ctx).run(path, { runId: 'svc-nopid-1' });

            const db = await ctx.getDb();
            const pid = await new RunDao(db).getPid('svc-nopid-1');
            expect(pid).toBeNull();
            await rm(dir, { recursive: true, force: true });
        });

        test('recordSelfPid is transparent across an action+transition+pause+resume run', async () => {
            // Drive a richer run (note action, transitions, HITL pause, resume)
            // through the pid-recording adapter to confirm it delegates every
            // persistence hook unchanged while still stamping the pid.
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-pidpause-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            const wfPath = join(wfDir, 'pauser.yaml');
            await writeFile(
                wfPath,
                [
                    'name: pid-pauser',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '    onEnter:',
                    '      - kind: note',
                    '        options:',
                    '          message: go',
                    '  - id: gate',
                    '    pause: true',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: gate',
                    '    guard: { kind: always }',
                    '  - from: gate',
                    '    to: done',
                    '    guard: { kind: always }',
                    'terminalStates:',
                    '  - done',
                ].join('\n'),
            );

            const ctx = makeCtx(dir);
            const svc = new WorkflowAppService(ctx);
            const paused = await svc.run(wfPath, { runId: 'pid-pause-1', recordSelfPid: true });
            expect(paused.status).toBe('paused');

            // pid stamped at creation, before the pause.
            const db = await ctx.getDb();
            expect(await new RunDao(db).getPid('pid-pause-1')).toBe(process.pid);

            // Resume completes the run — the adapter delegated reseed/load hooks fine.
            const resumed = await svc.continuePaused('pid-pause-1');
            expect(resumed.status).toBe('done');
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
        test('surfaces terminal failure reason in trace entry (R7 of 0366)', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-reason-'));
            const path = join(dir, 'fail.yaml');
            // Outbound transition exists but its shell guard always exits non-zero,
            // so no transition passes → engine fails with `no-passing-transition`.
            await writeFile(
                path,
                [
                    'name: fail-flow',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: done',
                    '    guard:',
                    '      kind: shell',
                    '      options:',
                    "        command: 'test no = yes'",
                    'terminalStates: [done]',
                ].join('\n'),
            );
            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'trace-reason-1' });

            const result = await svc.trace('trace-reason-1');
            expect('events' in result).toBe(true);
            if ('events' in result) {
                expect(result.run.failureReason).toBe('no-passing-transition');
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
    // R8 (0366): WorkflowAppService.run() injects __runId into workflow vars so
    // discovery artifacts can stamp run provenance. The var must be observable
    // by shell actions and survive the full run.
    describe('run — __runId injection (R8 of 0366)', () => {
        const RUNID_YAML = `name: runid-inject
kind: state-machine
initialState: start
vars:
  __runId: ""
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: 'mkdir -p .spur/run && printf "%s" "\${vars.__runId}" > .spur/run/captured-runid.txt'
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

        test('injects the runId as vars.__runId, observable by shell actions', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-runid-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, RUNID_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path, { runId: 'inject-test-1' });
            expect(result.status).toBe('done');

            const captured = await readFile(join(dir, '.spur', 'run', 'captured-runid.txt'), 'utf8');
            expect(captured).toBe('inject-test-1');
            await rm(dir, { recursive: true, force: true });
        });

        test('__runId is injected even when caller passes no vars', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-runid-novars-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, RUNID_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'auto-runid-1' });

            const captured = await readFile(join(dir, '.spur', 'run', 'captured-runid.txt'), 'utf8');
            expect(captured).toBe('auto-runid-1');
            await rm(dir, { recursive: true, force: true });
        });

        test('caller-provided vars are preserved alongside __runId', async () => {
            // Separate workflow that also captures a caller-provided var alongside __runId.
            const MIX_YAML = RUNID_YAML.replace('vars:\n  __runId: ""', 'vars:\n  __runId: ""\n  taskId: ""').replace(
                // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — matches ${vars.*} literal in the YAML template
                'printf "%s" "${vars.__runId}"',
                // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — matches ${vars.*} literal in the YAML template
                'printf "%s|%s" "${vars.__runId}" "${vars.taskId}"',
            );
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-runid-vars-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MIX_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'mix-1', vars: { taskId: '0099' } });

            const captured = await readFile(join(dir, '.spur', 'run', 'captured-runid.txt'), 'utf8');
            expect(captured).toBe('mix-1|0099');
            await rm(dir, { recursive: true, force: true });
        });
    });

    // R9 (0366): End-to-end integration proving the pause/resume var-persistence
    // fix (R1–R3) works at the Spur service layer. A paused state's onEnter
    // action mutates vars via setVars (hitl.confirm → __hitlAnswer); those vars
    // must survive the pause→resume boundary and be observable in subsequent
    // states AND in transition guards.
    describe('run — pause/resume var persistence (R9 of 0366)', () => {
        // Workflow exercises the full path: caller vars → pause with setVars →
        // resume → guard reads paused vars → shell captures all vars.
        const PERSIST_YAML = `name: pause-resume-vars
kind: state-machine
initialState: start
vars:
  __hitlAnswer: ""
  __runId: ""
  seedVar: ""
states:
  - id: start
  - id: gate
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: approve?
  - id: after
    onEnter:
      - kind: shell
        options:
          command: 'mkdir -p .spur/run && printf "%s|%s|%s" "\${vars.__hitlAnswer}" "\${vars.__runId}" "\${vars.seedVar}" > .spur/run/captured-vars.txt'
  - id: done
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: after
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
  - from: after
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

        /** Seed a project with the persist workflow under `.spur/workflows/` (so name→file resolves on resume). */
        async function seedPersist(): Promise<{ dir: string; wfPath: string }> {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-persist-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            const wfPath = join(wfDir, 'persist.yaml');
            await writeFile(wfPath, PERSIST_YAML);
            return { dir, wfPath };
        }

        test('setVars from a paused state survive resume and reach downstream states + guards', async () => {
            const { dir, wfPath } = await seedPersist();
            const svc = new WorkflowAppService(makeCtx(dir));
            // Run-level vars (__runId injected, seedVar caller-provided).
            const paused = await svc.run(wfPath, { runId: 'persist-1', vars: { seedVar: 'seeded' } });
            expect(paused.status).toBe('paused');
            expect(paused.finalState).toBe('gate');

            // Resume — the gate→after guard reads __hitlAnswer (set during pause).
            const resumed = await svc.continuePaused('persist-1');
            expect(resumed.status).toBe('done');
            expect(resumed.finalState).toBe('done');

            // All three var classes captured in the downstream state:
            // - __hitlAnswer: set by hitl.confirm during gate.onEnter (setVars mutation)
            // - __runId: injected by WorkflowAppService.run()
            // - seedVar: caller-provided run-level var
            const captured = await readFile(join(dir, '.spur', 'run', 'captured-vars.txt'), 'utf8');
            expect(captured).toBe('yes|persist-1|seeded');
            await rm(dir, { recursive: true, force: true });
        });

        test('resume without the persisted var snapshot degrades gracefully (backward compat)', async () => {
            // Simulates resuming a run whose snapshot predates the R1–R3 fix
            // (no effectiveVars in data_json). extractEffectiveVars returns {},
            // so \${vars.__hitlAnswer} interpolates to '' — the guard fails,
            // and the run terminates with no-passing-transition rather than
            // crashing. This is acceptable degradation for old snapshots.
            const { dir, wfPath } = await seedPersist();
            const db = await createMigratedDb({ url: ':memory:' });
            const ctx = {
                cwd: dir,
                getDb: async () => db,
                agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
                ruleService: () =>
                    ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
                hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
            };
            const svc = new WorkflowAppService(ctx);

            // Run to pause.
            const paused = await svc.run(wfPath, { runId: 'old-snap-1', vars: { seedVar: 'seeded' } });
            expect(paused.status).toBe('paused');

            // Strip effectiveVars from the latest workflow_states row, simulating
            // a snapshot written by the pre-R3 engine (no effectiveVars field).
            await db.run(
                `UPDATE workflow_states SET data_json = json_remove(data_json, '$.effectiveVars') WHERE run_id = ?`,
                'old-snap-1',
            );

            const resumed = await svc.continuePaused('old-snap-1');
            // Guard `test "\${vars.__hitlAnswer}" = yes` fails (empty string),
            // no transition passes → run fails with no-passing-transition.
            expect(resumed.reason).toBe('no-passing-transition');
            await rm(dir, { recursive: true, force: true });
        });
    });

    // R5 + AC "Recovery does not duplicate side effects" (0366): resuming a paused
    // run must not re-execute the onEnter of states already left behind. In the
    // idea pipeline those onEnters are the expensive/irreversible ones — discovery
    // (a 5-6 minute agent.run) and feature-create (allocates a real feature id).
    // The states here stand in for exactly those two, each appending a line to a
    // side-effect log so re-execution is counted, not inferred.
    describe('run — resume does not duplicate prior side effects (R5 of 0366)', () => {
        const RECOVERY_YAML = `name: recovery-no-dup
kind: state-machine
initialState: discovery
vars:
  __hitlAnswer: ""
states:
  - id: discovery
    onEnter:
      - kind: shell
        options:
          command: 'mkdir -p .spur/run && echo discovery >> .spur/run/side-effects.log'
  - id: gate
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: approve?
  - id: feature-create
    onEnter:
      - kind: shell
        options:
          command: 'mkdir -p .spur/run && echo feature-create >> .spur/run/side-effects.log'
  - id: done
transitions:
  - from: discovery
    to: gate
    guard: { kind: always }
  - from: gate
    to: feature-create
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
  - from: feature-create
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

        /** Count how many times a given side effect fired. */
        function occurrences(log: string, marker: string): number {
            return log.split('\n').filter((line) => line.trim() === marker).length;
        }

        test('discovery runs once and feature-create runs once across pause + resume', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-recovery-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            const wfPath = join(wfDir, 'recovery.yaml');
            await writeFile(wfPath, RECOVERY_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const paused = await svc.run(wfPath, { runId: 'recovery-1' });
            expect(paused.status).toBe('paused');
            expect(paused.finalState).toBe('gate');

            // Discovery already fired; feature-create is still gated behind the pause.
            const atPause = await readFile(join(dir, '.spur', 'run', 'side-effects.log'), 'utf8');
            expect(occurrences(atPause, 'discovery')).toBe(1);
            expect(occurrences(atPause, 'feature-create')).toBe(0);

            const resumed = await svc.continuePaused('recovery-1');
            expect(resumed.status).toBe('done');

            // The whole point: resume re-entered neither discovery nor the gate,
            // and allocated exactly one feature.
            const afterResume = await readFile(join(dir, '.spur', 'run', 'side-effects.log'), 'utf8');
            expect(occurrences(afterResume, 'discovery')).toBe(1);
            expect(occurrences(afterResume, 'feature-create')).toBe(1);
            await rm(dir, { recursive: true, force: true });
        });

        // Design claim 2 (0366): vars are persisted atomically with the state
        // snapshot, so a crash can never pair a new state with stale vars. Proven
        // structurally: the paused phase and its effectiveVars live in the SAME
        // workflow_states row, so there is no window where one is written without
        // the other.
        test('the paused snapshot carries state and effectiveVars in one row', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-atomic-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            const wfPath = join(wfDir, 'recovery.yaml');
            await writeFile(wfPath, RECOVERY_YAML);

            const db = await createMigratedDb({ url: ':memory:' });
            const svc = new WorkflowAppService({
                cwd: dir,
                getDb: async () => db,
                agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
                ruleService: () =>
                    ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
                hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
            });
            await svc.run(wfPath, { runId: 'atomic-1', vars: { seedVar: 'seeded' } });

            const row = (await db.queryFirst(
                `SELECT state, data_json FROM workflow_states WHERE run_id = ? ORDER BY rowid DESC LIMIT 1`,
                'atomic-1',
            )) as { state: string; data_json: string } | undefined;

            expect(row).toBeDefined();
            const snapshot = JSON.parse(row?.data_json ?? '{}') as {
                effectiveVars?: Record<string, string>;
            };
            // Same row: the paused state AND the vars that were live at that state.
            expect(row?.state).toBe('gate');
            expect(snapshot.effectiveVars?.__hitlAnswer).toBe('yes');
            expect(snapshot.effectiveVars?.seedVar).toBe('seeded');
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('run — pipeline link (R1, task 0071)', () => {
        const PIPELINE_YAML = `name: task-pipeline
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

        test('a task-pipeline run with vars.wbs writes exactly one kind=pipeline row', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-pipeline-link-'));
            const path = join(dir, 'task-pipeline.yaml');
            await writeFile(path, PIPELINE_YAML);

            const ctx = makeCtx(dir);
            const svc = new WorkflowAppService(ctx);
            await svc.run(path, { runId: 'pipe-1', vars: { wbs: '0042' } });

            const db = await ctx.getDb();
            const dao = new TaskRunLinkDao(db);
            const rows = await dao.listByRun('pipe-1', 10);
            expect(rows.length).toBe(1);
            expect(rows[0]?.kind).toBe('pipeline');
            expect(rows[0]?.wbs).toBe('0042');
            expect(rows[0]?.run_id).toBe('pipe-1');
            await rm(dir, { recursive: true, force: true });
        });

        test('two pipeline runs for the same wbs each get exactly one pipeline link', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-pipeline-multi-'));
            const path = join(dir, 'task-pipeline.yaml');
            await writeFile(path, PIPELINE_YAML);

            const ctx = makeCtx(dir);
            const svc = new WorkflowAppService(ctx);
            await svc.run(path, { runId: 'pipe-a', vars: { wbs: '0042' } });
            await svc.run(path, { runId: 'pipe-b', vars: { wbs: '0042' } });

            const db = await ctx.getDb();
            const dao = new TaskRunLinkDao(db);
            const linksA = (await dao.listByRun('pipe-a', 10)).filter((r) => r.kind === 'pipeline');
            const linksB = (await dao.listByRun('pipe-b', 10)).filter((r) => r.kind === 'pipeline');
            expect(linksA.length).toBe(1);
            expect(linksB.length).toBe(1);
            await rm(dir, { recursive: true, force: true });
        });

        test('a non-pipeline workflow writes no pipeline link even with vars.wbs', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-no-link-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const ctx = makeCtx(dir);
            const svc = new WorkflowAppService(ctx);
            await svc.run(path, { runId: 'no-link-1', vars: { wbs: '0042' } });

            const db = await ctx.getDb();
            const dao = new TaskRunLinkDao(db);
            const rows = (await dao.listByRun('no-link-1', 10)).filter((r) => r.kind === 'pipeline');
            expect(rows.length).toBe(0);
            await rm(dir, { recursive: true, force: true });
        });

        test('a task-pipeline run without vars.wbs writes no pipeline link', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-no-wbs-'));
            const path = join(dir, 'task-pipeline.yaml');
            await writeFile(path, PIPELINE_YAML);

            const ctx = makeCtx(dir);
            const svc = new WorkflowAppService(ctx);
            await svc.run(path, { runId: 'no-wbs-1' });

            const db = await ctx.getDb();
            const dao = new TaskRunLinkDao(db);
            const rows = (await dao.listByRun('no-wbs-1', 10)).filter((r) => r.kind === 'pipeline');
            expect(rows.length).toBe(0);
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('clean (orphaned-run finalization)', () => {
        async function seedRun(
            db: Awaited<ReturnType<ReturnType<typeof makeCtx>['getDb']>>,
            id: string,
            status: string,
            startedAtIso: string,
        ) {
            await db.run(
                `INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at)
                 VALUES (?, 'task-pipeline', 'state-machine', ?, ?, '{}', 0, 0)`,
                id,
                status,
                startedAtIso,
            );
        }

        test('finalizes stale non-terminal runs as failed, leaving recent and terminal runs intact', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seedRun(db, 'run_stale', 'running', '2026-06-01T00:00:00.000Z');
            await seedRun(db, 'run_done', 'done', '2026-06-01T00:00:00.000Z');
            await seedRun(db, 'run_fresh', 'running', new Date().toISOString());

            const result = await new WorkflowAppService(ctx).clean(30, false);

            expect(result.cleaned.map((r) => r.runId)).toEqual(['run_stale']);
            const stale = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', 'run_stale');
            const fresh = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', 'run_fresh');
            expect(stale?.status).toBe('failed');
            expect(fresh?.status).toBe('running'); // too recent — untouched
        });

        test('dry-run reports stale runs without finalizing them', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seedRun(db, 'run_dry', 'running', '2026-06-01T00:00:00.000Z');

            const result = await new WorkflowAppService(ctx).clean(30, true);

            expect(result.dryRun).toBe(true);
            expect(result.cleaned.map((r) => r.runId)).toEqual(['run_dry']);
            const row = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', 'run_dry');
            expect(row?.status).toBe('running'); // dry-run wrote nothing
        });
    });

    describe('cancel (single-run finalization by id)', () => {
        async function seedRun(
            db: Awaited<ReturnType<ReturnType<typeof makeCtx>['getDb']>>,
            id: string,
            status: string,
            startedAtIso: string,
        ) {
            await db.run(
                `INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at)
                 VALUES (?, 'task-pipeline', 'state-machine', ?, ?, '{}', 0, 0)`,
                id,
                status,
                startedAtIso,
            );
        }

        test('finalizes a non-terminal run as failed (no pid recorded → not killed)', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seedRun(db, 'run_live', 'running', new Date().toISOString());

            const result = await new WorkflowAppService(ctx).cancel('run_live');

            expect(result).toEqual({ runId: 'run_live', finalized: true, status: 'failed', killed: false });
            const row = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', 'run_live');
            expect(row?.status).toBe('failed');
        });

        test('a terminal run is a no-op (idempotent, not re-transitioned, not killed)', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seedRun(db, 'run_done', 'done', new Date().toISOString());

            const result = await new WorkflowAppService(ctx).cancel('run_done');

            expect(result.finalized).toBe(false);
            expect(result.status).toBe('done');
            expect(result.killed).toBe(false);
            const row = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', 'run_done');
            expect(row?.status).toBe('done'); // unchanged
        });

        test('a missing run reports not_found', async () => {
            const ctx = makeCtx();

            const result = await new WorkflowAppService(ctx).cancel('no_such_run');

            expect(result).toEqual({ runId: 'no_such_run', finalized: false, status: 'not_found', killed: false });
        });

        test('SIGTERMs a recorded live pid via the single-process fallback, then finalizes', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seedRun(db, 'run_async', 'running', new Date().toISOString());
            // A plain Bun.spawn child is NOT a process-group leader, so the group
            // kill (`kill(-pid)`) fails and signalSubprocess falls back to the
            // single-process `kill(pid)`. (The group path is covered by the
            // detached-leader test below and the CLI end-to-end async-cancel test.)
            const child = Bun.spawn({ cmd: ['sleep', '30'], stdio: ['ignore', 'ignore', 'ignore'] });
            await new RunDao(db).setPid('run_async', child.pid);

            const result = await new WorkflowAppService(ctx).cancel('run_async');

            expect(result.killed).toBe(true);
            expect(result.finalized).toBe(true);
            // The SIGTERM was delivered: the child exits within a moment.
            const exitCode = await child.exited;
            expect(exitCode).not.toBe(0); // terminated by signal, not a clean 0
        });

        test('SIGTERMs the whole process group when the recorded pid is a group leader', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seedRun(db, 'run_group', 'running', new Date().toISOString());
            // A detached child (child_process.spawn detached:true → setsid) is its
            // own group leader, and the grandchild it spawns joins that group —
            // mirroring the async worker + its agent.run grandchild. The leader holds
            // the group open via a backgrounded `sleep` it waits on. signalSubprocess
            // hits `kill(-pid)` first and must reap the entire group, not just the
            // leader. (Bun.spawn does NOT create a new group, so node spawn is used.)
            const leader = spawn('sh', ['-c', 'sleep 30 & wait'], { stdio: 'ignore', detached: true });
            leader.unref();
            const leaderPid = leader.pid;
            expect(leaderPid).toBeDefined();
            if (leaderPid === undefined) return;
            await new RunDao(db).setPid('run_group', leaderPid);

            const result = await new WorkflowAppService(ctx).cancel('run_group');

            expect(result.killed).toBe(true);
            expect(result.finalized).toBe(true);
            // The whole group is gone — probing it throws ESRCH (the grandchild
            // `sleep`, not just the leader, was reaped by the group signal).
            let groupGone = false;
            for (let i = 0; i < 80 && !groupGone; i++) {
                try {
                    process.kill(-leaderPid, 0);
                    await Bun.sleep(25);
                } catch {
                    groupGone = true;
                }
            }
            expect(groupGone).toBe(true);
        });

        test('an already-dead recorded pid is tolerated (ESRCH), run still finalizes', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seedRun(db, 'run_dead', 'running', new Date().toISOString());
            // Spawn a child that exits immediately, wait for it, then record its pid.
            const child = Bun.spawn({ cmd: ['true'], stdio: ['ignore', 'ignore', 'ignore'] });
            await child.exited;
            await new RunDao(db).setPid('run_dead', child.pid);

            const result = await new WorkflowAppService(ctx).cancel('run_dead');

            expect(result.killed).toBe(false); // ESRCH — process already gone
            expect(result.finalized).toBe(true);
            expect(result.status).toBe('failed');
        });
    });
});
