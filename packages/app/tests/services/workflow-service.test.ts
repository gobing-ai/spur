import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_ROLE_NAMES } from '@gobing-ai/spur-config';
import { createMigratedDb, RunDao, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import {
    resolveOutputLogConfig,
    resolveWorkflowLogRetentionDays,
    WorkflowAppService,
} from '../../src/services/workflow-service';

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

import { execSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
    PipeProcess,
    PipeProcessOptions,
    ProcessExecutor,
    ProcessOptions,
    ProcessResult,
} from '@gobing-ai/ts-runtime';

class TestProcessExecutor implements ProcessExecutor {
    async run(options: ProcessOptions): Promise<ProcessResult> {
        const cwd = options.cwd || process.cwd();
        const cmd = options.args?.[0] === '-c' && options.args?.[1] ? options.args[1] : options.command;

        // Handle echo redirects: echo "text" > file or echo "text" >> file
        const echoMatch = cmd.match(/^echo\s+"?([^">]*)"?\s*(>>|>)\s*(.+)$/);
        if (echoMatch) {
            const text = echoMatch[1] ?? '';
            const op = echoMatch[2] ?? '>';
            const file = echoMatch[3] ?? '';
            const targetPath = resolve(cwd, file.trim());
            if (op === '>>') {
                appendFileSync(targetPath, `${text.trim()}\n`, 'utf8');
            } else {
                writeFileSync(targetPath, `${text.trim()}\n`, 'utf8');
            }
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: 0,
                stdout: '',
                stderr: '',
                durationMs: 1,
            };
        }

        // Handle test commands: test "val1" = val2
        const testMatch = cmd.match(/^test\s+"?([^"=]*)"?\s*=\s*"?([^"]*)"?$/);
        if (testMatch) {
            const left = testMatch[1] ?? '';
            const right = testMatch[2] ?? '';
            const ok = left.trim() === right.trim();
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: ok ? 0 : 1,
                stdout: '',
                stderr: '',
                durationMs: 1,
            };
        }

        // Handle touch & exit: touch <file> && exit 1
        const touchMatch = cmd.match(/^touch\s+(.+)\s+&&\s+exit\s+(\d+)$/);
        if (touchMatch) {
            const file = touchMatch[1] ?? '';
            const code = touchMatch[2] ?? '0';
            writeFileSync(resolve(cwd, file.trim()), '', 'utf8');
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: parseInt(code, 10),
                stdout: '',
                stderr: '',
                durationMs: 1,
            };
        }

        try {
            const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: 0,
                stdout,
                stderr: '',
                durationMs: 1,
            };
        } catch (e) {
            const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: typeof err.status === 'number' ? err.status : 1,
                stdout: err.stdout?.toString() ?? '',
                stderr: err.stderr?.toString() ?? '',
                durationMs: 1,
            };
        }
    }

    runStreaming(options: PipeProcessOptions): PipeProcess {
        const pending = this.run(options);
        const makeStream = (pick: (r: ProcessResult) => string): ReadableStream<Uint8Array> | null =>
            new ReadableStream<Uint8Array>({
                start(controller) {
                    void pending.then((result) => {
                        const text = pick(result);
                        if (text !== '') controller.enqueue(new TextEncoder().encode(text));
                        controller.close();
                    });
                },
            });
        return {
            pid: null,
            stdout: makeStream((r) => r.stdout),
            stderr: makeStream((r) => r.stderr),
            exited: pending.then((r) => r.exitCode),
            writeStdin: () => undefined,
            endStdin: () => undefined,
            kill: () => undefined,
        };
    }
}

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
        processExecutor: () => new TestProcessExecutor(),
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

        test('0538 R2: rejects an agent.run step with no role, naming the step', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-norole-'));
            const path = join(dir, 'norole.yaml');
            await writeFile(
                path,
                [
                    'name: norole',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '    onEnter:',
                    '      - kind: agent.run',
                    '        options:',
                    '          input: hello',
                    '          agent: claude',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: done',
                    'terminalStates: [done]',
                ].join('\n'),
            );
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.join('\n')).toContain('start/agent.run[0]');
                expect(result.errors.join('\n')).toContain('no role:');
            }
            await rm(dir, { recursive: true });
        });

        test('0538 R2: rejects an agent.run step with an unknown role', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-badrole-'));
            const path = join(dir, 'badrole.yaml');
            await writeFile(
                path,
                [
                    'name: badrole',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '    onEnter:',
                    '      - kind: agent.run',
                    '        options:',
                    '          input: hello',
                    '          agent: claude',
                    '          role: sorcerer',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: done',
                    'terminalStates: [done]',
                ].join('\n'),
            );
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.join('\n')).toContain("unknown role: 'sorcerer'");
            }
            await rm(dir, { recursive: true });
        });

        test('0538 R2: accepts an agent.run step declaring a valid role', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-role-'));
            const path = join(dir, 'role.yaml');
            await writeFile(
                path,
                [
                    'name: role',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '    onEnter:',
                    '      - kind: agent.run',
                    '        options:',
                    '          input: hello',
                    '          agent: claude',
                    '          role: reviewer',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: done',
                    'terminalStates: [done]',
                ].join('\n'),
            );
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(true);
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

        // ── R3 (0453): shell syntax validation ──────────────────────────

        const GOOD_SHELL_WORKFLOW = [
            'name: shell-good',
            'kind: state-machine',
            'initialState: start',
            'states:',
            '  - id: start',
            '    onEnter:',
            '      - kind: shell',
            '        options:',
            '          command: mkdir -p .spur/run && echo PASS > .spur/run/status',
            '  - id: done',
            'transitions:',
            '  - from: start',
            '    to: done',
            '    guard:',
            '      kind: shell',
            '      options:',
            '        command: "test -f .spur/run/status"',
            'terminalStates: [done]',
        ].join('\n');

        const BAD_SHELL_WORKFLOW = [
            'name: shell-bad',
            'kind: state-machine',
            'initialState: start',
            'states:',
            '  - id: start',
            '    onEnter:',
            '      - kind: shell',
            '        options:',
            '          command: if true; then echo "unclosed"',
            '  - id: done',
            'transitions:',
            '  - from: start',
            '    to: done',
            'terminalStates: [done]',
        ].join('\n');

        test('R3: workflow with valid shell commands passes validate', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-sh-good-'));
            const path = join(dir, 'good.yaml');
            await writeFile(path, GOOD_SHELL_WORKFLOW);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(true);
            await rm(dir, { recursive: true });
        });

        test('R3: workflow with broken shell syntax (unclosed if) fails validate', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-sh-bad-'));
            const path = join(dir, 'bad.yaml');
            await writeFile(path, BAD_SHELL_WORKFLOW);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.includes('Shell syntax error'))).toBe(true);
                // Error should name the state/action location
                expect(result.errors[0]).toContain('start/action');
            }
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

        // Task 0431: `run` must resolve `$schema` through `embeddedSchemas` the same way
        // `validate` does. Before the fix, `run` called `svc.runFile(path)` which loaded
        // the def with bare `loadWorkflowDef(path)` - no embedded options - so a
        // package-specifier `$schema` ref fell through to node resolution and failed
        // when cwd was outside the package tree (CI, --compile binary).
        test('run resolves a package-specifier $schema from embeddedSchemas (CI cwd-independence)', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-run-embedded-'));
            const path = join(dir, 'pkg-schema.yaml');
            await writeFile(
                path,
                [
                    '"$schema": "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"',
                    'name: embedded-run-flow',
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
            const result = await svc.run(path, { runId: 'svc-run-embedded-1' });
            expect(result.status).toBe('done');
            expect(result.finalState).toBe('done');

            // A schema that rejects the workflow proves the embedded copy is actually
            // applied during `run`, not silently skipped or falling back to disk.
            const rejecting = new Map([
                [
                    'schemas/state-machine-workflow.schema.json',
                    JSON.stringify({ type: 'object', properties: { name: { enum: ['other'] } } }),
                ],
            ]);
            const svcReject = new WorkflowAppService({ ...makeCtx(dir), embeddedSchemas: () => rejecting });
            // R2/R5: rejection must name the mismatch and must not cite any node_modules path
            // (embedded map is the sole schema source when configured).
            let rejectMsg = '';
            try {
                await svcReject.run(path, { runId: 'svc-run-embedded-reject' });
                expect.unreachable('expected schema rejection');
            } catch (error) {
                rejectMsg = error instanceof Error ? error.message : String(error);
            }
            expect(rejectMsg.length).toBeGreaterThan(0);
            // R5: offending field named; R2: no node_modules path; embedded map used.
            expect(rejectMsg).toMatch(/\bname\b/);
            expect(rejectMsg).not.toMatch(/node_modules/);
            expect(rejectMsg).toMatch(/embedded-spur/);
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

        test('surfaces the per-run consolidated run log when present (task 0426)', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-trace-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'trace-artifact-1' });

            // Simulate the consolidated run-log sink having written the log file.
            const artifactDir = join(dir, '.spur', 'run');
            await mkdir(artifactDir, { recursive: true });
            await writeFile(
                join(artifactDir, 'trace-artifact-1.log'),
                '# spur workflow run trace-artifact-1 — test-flow — started 2026-08-02T00:00:01.000Z\n',
            );

            const result = await svc.trace('trace-artifact-1');
            expect('events' in result).toBe(true);
            if ('events' in result) {
                expect(result.outputArtifact).toBe(join('.spur', 'run', 'trace-artifact-1.log'));
            }
            await rm(dir, { recursive: true, force: true });
        });

        test('omits outputArtifact when no run log exists (task 0426)', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-trace-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            await svc.run(path, { runId: 'trace-no-artifact-1' });

            const result = await svc.trace('trace-no-artifact-1');
            expect('events' in result).toBe(true);
            if ('events' in result) {
                expect(result.outputArtifact).toBeUndefined();
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

        test('projects actionable context and allow-listed action metadata without raw output (0528)', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-context-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);
            const context = { ...makeCtx(dir), secretValues: ['top-secret'] };
            const svc = new WorkflowAppService(context);
            await svc.run(path, { runId: 'trace-context-1' });
            const db = await context.getDb();
            await db.run(
                `UPDATE runs SET status = 'failed', started_at = ?, completed_at = ?, metadata_json = ? WHERE id = ?`,
                '2026-08-12T10:00:00.000Z',
                '2026-08-12T10:01:00.000Z',
                JSON.stringify({ failureReason: 'action-failed' }),
                'trace-context-1',
            );
            await db.run(
                `INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                'action-1',
                'trace-context-1',
                'implement',
                'agent.run',
                'failed',
                60000,
                0,
                JSON.stringify({
                    ok: false,
                    data: {
                        exitCode: 1,
                        agent: 'codex',
                        stdoutTail: 'top-secret raw output',
                        invocation: {
                            agent: 'codex',
                            command: 'codex',
                            argv: ['top-secret prompt'],
                            model: 'gpt-5',
                            timeoutMs: 60000,
                        },
                    },
                    error: 'provider failed with top-secret',
                }),
                '2026-08-12T10:00:00.000Z',
                '2026-08-12T10:01:00.000Z',
                99,
            );
            await db.run(
                `INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at, created_at)
                 VALUES ('action-2', 'trace-context-1', 'broken', 'shell', 'failed', NULL, 0, '{bad', NULL, NULL, 100)`,
            );
            await mkdir(join(dir, '.spur', 'run'), { recursive: true });
            await writeFile(join(dir, '.spur', 'run', 'trace-context-1-implement-partial.md'), 'partial');
            await writeFile(join(dir, '.spur', 'run', 'trace-context-1.log'), 'log');

            const result = await svc.trace('trace-context-1');
            expect(result.run).toMatchObject({
                project: { name: dir.split('/').at(-1), root: dir },
                durationMs: 60000,
                outcome: 'failure',
                nextAction: { kind: 'path', value: '.spur/run/trace-context-1.log' },
            });
            const action = result.events.find((event) => event.kind === 'action');
            expect(action).toMatchObject({
                actionId: 'action-1',
                node: 'implement',
                durationMs: 60000,
                outcome: 'failure',
                result: { agent: 'codex', exitCode: 1 },
                invocation: { agent: 'codex', command: 'codex', model: 'gpt-5', timeoutMs: 60000 },
                artifacts: ['.spur/run/trace-context-1-implement-partial.md'],
                nextAction: { kind: 'path' },
            });
            expect(JSON.stringify(action)).not.toContain('argv');
            expect(JSON.stringify(action)).not.toContain('raw output');
            expect(JSON.stringify(action)).not.toContain('top-secret');
            expect(action?.kind === 'action' ? action.error : null).toContain('[REDACTED]');
            const malformed = result.events.find((event) => event.kind === 'action' && event.actionId === 'action-2');
            expect(malformed).toMatchObject({
                durationMs: null,
                startedAt: null,
                completedAt: null,
                result: null,
                invocation: null,
                error: null,
                artifacts: [],
            });
            expect(malformed).not.toHaveProperty('nextAction');
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

    // 0433: Headless HITL taste gates cannot be approved after the fact.
    // `continuePaused` must accept an optional hitlAnswer that overrides the
    // persisted __hitlAnswer before guard re-evaluation on resume.
    describe('continue - HITL answer injection (0433)', () => {
        // Workflow with a taste gate that branches on __hitlAnswer.
        // The gate has hitl.confirm onEnter (persists the answer) then pauses.
        // Guards route yes -> approved, no -> cancelled, cancel -> cancelled.
        const TASTE_GATE_YAML = `name: taste-gate-svc
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
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Approve?"
  - id: approved
  - id: cancelled
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: approved
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
  - from: gate
    to: cancelled
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = no'
  - from: gate
    to: cancelled
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = cancel'
terminalStates:
  - approved
  - cancelled
`;

        /** A headless responder that returns `no` - simulates the bug scenario. */
        function makeCtxWithNoResponder(cwd: string) {
            const ctx = makeCtx(cwd);
            return { ...ctx, hitlResponder: () => ({ respond: async () => ({ value: 'no' }) }) };
        }

        async function seedTasteGate(useNoResponder = false): Promise<{ svc: WorkflowAppService; dir: string }> {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-0433-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'taste-gate.yaml'), TASTE_GATE_YAML);
            const ctx = useNoResponder ? makeCtxWithNoResponder(dir) : makeCtx(dir);
            return { svc: new WorkflowAppService(ctx), dir };
        }

        test('R1/R5: continuePaused with hitlAnswer=yes overrides persisted no, takes approve edge', async () => {
            const { svc, dir } = await seedTasteGate(true);
            const wf = join(dir, '.spur', 'workflows', 'taste-gate.yaml');
            // Run pauses at `gate`. Headless responder wrote `no` into __hitlAnswer.
            const runResult = await svc.run(wf, { runId: 't1' });
            expect(runResult.status).toBe('paused');
            expect(runResult.finalState).toBe('gate');

            // Without --answer, resume uses persisted `no` -> cancelled.
            // (We test this separately to prove the bug exists without the fix.)

            // With hitlAnswer=yes, the override wins -> approved.
            const resumed = await svc.continuePaused('t1', { hitlAnswer: 'yes' });
            expect(resumed.status).toBe('done');
            expect(resumed.finalState).toBe('approved');
            await rm(dir, { recursive: true, force: true });
        });

        test('R5: continuePaused with hitlAnswer=no routes to the reject edge', async () => {
            const { svc, dir } = await seedTasteGate(true);
            const wf = join(dir, '.spur', 'workflows', 'taste-gate.yaml');
            await svc.run(wf, { runId: 't2' });

            const resumed = await svc.continuePaused('t2', { hitlAnswer: 'no' });
            expect(resumed.status).toBe('done');
            expect(resumed.finalState).toBe('cancelled');
            await rm(dir, { recursive: true, force: true });
        });

        test('R5: continuePaused with hitlAnswer=cancel routes to the cancel edge', async () => {
            const { svc, dir } = await seedTasteGate(true);
            const wf = join(dir, '.spur', 'workflows', 'taste-gate.yaml');
            await svc.run(wf, { runId: 't3' });

            // R5 rejection parity: `cancel` is distinct on the wire and takes its
            // own guard edge (not coerced to yes/no).
            const resumed = await svc.continuePaused('t3', { hitlAnswer: 'cancel' });
            expect(resumed.status).toBe('done');
            expect(resumed.finalState).toBe('cancelled');
            await rm(dir, { recursive: true, force: true });
        });

        test('R4: answering one gate does not pre-clear a later gate', async () => {
            // Two sequential taste gates. hitlAnswer on resume applies only to
            // the current resume's vars merge; the second gate's onEnter still
            // runs when entered, producing its own fresh decision.
            const TWO_GATE_YAML = `name: two-gate-svc
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: gate1
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Gate 1?"
  - id: gate2
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Gate 2?"
  - id: done
transitions:
  - from: start
    to: gate1
    guard: { kind: always }
  - from: gate1
    to: gate2
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
  - from: gate2
    to: done
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
terminalStates:
  - done
`;
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-0433-twogate-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'two-gate.yaml'), TWO_GATE_YAML);
            const svc = new WorkflowAppService(makeCtxWithNoResponder(dir));
            const wf = join(wfDir, 'two-gate.yaml');

            // Run pauses at gate1 (headless responder wrote `no`).
            await svc.run(wf, { runId: 'tg1' });

            // Resume with --answer yes -> takes gate1 approve edge -> enters gate2.
            // gate2's onEnter hitl.confirm fires, writing `no` again -> pauses.
            const resumed1 = await svc.continuePaused('tg1', { hitlAnswer: 'yes' });
            expect(resumed1.status).toBe('paused');
            expect(resumed1.finalState).toBe('gate2');

            // The second gate is NOT pre-cleared: it paused for its own decision.
            // Resume with --answer yes to complete.
            const resumed2 = await svc.continuePaused('tg1', { hitlAnswer: 'yes' });
            expect(resumed2.status).toBe('done');
            expect(resumed2.finalState).toBe('done');
            await rm(dir, { recursive: true, force: true });
        });

        test('R1: without hitlAnswer, persisted no is used (bug reproduction)', async () => {
            const { svc, dir } = await seedTasteGate(true);
            const wf = join(dir, '.spur', 'workflows', 'taste-gate.yaml');
            await svc.run(wf, { runId: 't4' });

            // No hitlAnswer -> engine uses persisted `no` -> cancelled.
            const resumed = await svc.continuePaused('t4');
            expect(resumed.status).toBe('done');
            expect(resumed.finalState).toBe('cancelled');
            await rm(dir, { recursive: true, force: true });
        });

        test('R6/R7: a rejected design gate cannot loop unattended - cap revises then terminates', async () => {
            // Mirrors the idea-pipeline design-approval reject-cap at the shared
            // resume + HITL mechanism: an onEnter counter increments per entry; the
            // `no -> (revise)` edge is capped at 1; a second reject routes to `failed`
            // instead of looping back for another design-agent pass (R7 of 0433).
            const REJECT_CAP_YAML = `name: design-reject-cap-svc
kind: state-machine
initialState: start
vars:
  __runId: ""
  __hitlAnswer: ""
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: design-approval
    pause: true
    onEnter:
      - kind: shell
        options:
          command: 'mkdir -p .spur/run && count=$(cat .spur/run/\${vars.__runId}-design-reject-count 2>/dev/null || echo 0); echo $((count + 1)) > .spur/run/\${vars.__runId}-design-reject-count'
      - kind: hitl.confirm
        options:
          prompt: "Approve design?"
  - id: approved
  - id: failed
transitions:
  - from: start
    to: design-approval
    guard: { kind: always }
  - from: design-approval
    to: approved
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
  - from: design-approval
    to: design-approval
    description: "Rejected - revise design (cap: 1)."
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = no && test "$(cat .spur/run/\${vars.__runId}-design-reject-count 2>/dev/null || echo 0)" -le 1'
  - from: design-approval
    to: failed
    description: "Rejected after 1 revise - design-approval gate exhausted."
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = no && test "$(cat .spur/run/\${vars.__runId}-design-reject-count 2>/dev/null || echo 0)" -gt 1'
terminalStates:
  - approved
  - failed
failureStates:
  - failed
`;
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-0433-rejectcap-'));
            const wfDir = join(dir, '.spur', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'design-reject-cap.yaml'), REJECT_CAP_YAML);
            const svc = new WorkflowAppService(makeCtxWithNoResponder(dir));
            const wf = join(wfDir, 'design-reject-cap.yaml');

            // First entry: counter -> 1, headless confirm writes `no`, pauses.
            const first = await svc.run(wf, { runId: 'dc1' });
            expect(first.status).toBe('paused');
            expect(first.finalState).toBe('design-approval');

            // Resume (persisted `no`): revise edge allowed (count 1 <= cap 1) ->
            // re-enters design-approval, counter -> 2, confirm writes `no`, pauses.
            const revise = await svc.continuePaused('dc1');
            expect(revise.status).toBe('paused');
            expect(revise.finalState).toBe('design-approval');

            // Resume again: count 2 > cap 1 -> revise edge denied; reject-cap edge
            // terminates as `failed` (design-approval named) instead of looping.
            const exhausted = await svc.continuePaused('dc1');
            expect(exhausted.status).toBe('failed');
            expect(exhausted.finalState).toBe('failed');
            await rm(dir, { recursive: true, force: true });
        });
    });
    // R8 (0366): WorkflowAppService.run() injects __runId into workflow vars so
    // discovery artifacts can stamp run provenance. The var must be observable
    // by shell actions and survive the full run.
    describe('run — __runId injection (R8 of 0366)', () => {
        // Absolute /bin/* binaries inside a bare `command` (engine wraps as
        // `/bin/sh -c <line>`). Bare `mkdir`/`printf` look up PATH; if a prior
        // test left PATH without /bin the shell exits 127 → status "failed".
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
          command: 'echo "\${vars.__runId}" > captured-runid.txt'
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
            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');

            const captured = await readFile(join(dir, 'captured-runid.txt'), 'utf8');
            expect(captured.trim()).toBe('inject-test-1');
            await rm(dir, { recursive: true, force: true });
        });

        test('__runId is injected even when caller passes no vars', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-runid-novars-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, RUNID_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path, { runId: 'auto-runid-1' });
            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');

            const captured = await readFile(join(dir, 'captured-runid.txt'), 'utf8');
            expect(captured.trim()).toBe('auto-runid-1');
            await rm(dir, { recursive: true, force: true });
        });

        test('caller-provided vars are preserved alongside __runId', async () => {
            const MIX_YAML = `name: runid-inject
kind: state-machine
initialState: start
vars:
  __runId: ""
  taskId: ""
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: 'echo "\${vars.__runId}|\${vars.taskId}" > captured-runid.txt'
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-runid-vars-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MIX_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path, { runId: 'mix-1', vars: { taskId: '0099' } });
            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');

            const captured = await readFile(join(dir, 'captured-runid.txt'), 'utf8');
            expect(captured.trim()).toBe('mix-1|0099');
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
          command: 'echo "\${vars.__hitlAnswer}|\${vars.__runId}|\${vars.seedVar}" > captured-vars.txt'
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
            const captured = await readFile(join(dir, 'captured-vars.txt'), 'utf8');
            expect(captured.trim()).toBe('yes|persist-1|seeded');
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
          command: 'echo discovery >> side-effects.log'
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
          command: 'echo feature-create >> side-effects.log'
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
            const atPause = await readFile(join(dir, 'side-effects.log'), 'utf8');
            expect(occurrences(atPause, 'discovery')).toBe(1);
            expect(occurrences(atPause, 'feature-create')).toBe(0);

            const resumed = await svc.continuePaused('recovery-1');
            expect(resumed.status).toBe('done');

            // The whole point: resume re-entered neither discovery nor the gate,
            // and allocated exactly one feature.
            const afterResume = await readFile(join(dir, 'side-effects.log'), 'utf8');
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
                ...makeCtx(dir),
                getDb: async () => db,
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

    describe('run — agent var resolves from agent.default', () => {
        // Every pipeline YAML hardcodes `agent: "omp"`, which bypassed `.spur/config.yaml`
        // entirely: config only reached an `agent.run` step when a caller passed the literal
        // `auto`, which the pipelines never do. An operator whose default executor was failing
        // therefore had no supported way to redirect them.
        const AGENT_YAML = `name: agent-var
kind: state-machine
initialState: start
vars:
  agent: "omp"
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: 'echo "\${vars.agent}" > captured-agent.txt'
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

        async function seedWorkflow(prefix: string, configuredAgent?: string): Promise<string> {
            const dir = await mkdtemp(join(tmpdir(), prefix));
            await writeFile(join(dir, 'test.yaml'), AGENT_YAML);
            if (configuredAgent !== undefined) {
                await mkdir(join(dir, '.spur'), { recursive: true });
                await writeFile(join(dir, '.spur', 'config.yaml'), `agent:\n  default: ${configuredAgent}\n`);
            }
            return dir;
        }

        async function capturedAgent(dir: string): Promise<string> {
            return (await readFile(join(dir, 'captured-agent.txt'), 'utf8')).trim();
        }

        test('configured agent.default overrides the YAML literal', async () => {
            // `pi` is a canonical agent binary, so R2 validation accepts it.
            const dir = await seedWorkflow('spur-wf-agent-cfg-', 'pi');
            const svc = new WorkflowAppService(makeCtx(dir));

            const result = await svc.run(join(dir, 'test.yaml'), { runId: 'agent-cfg-1' });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            expect(await capturedAgent(dir)).toBe('pi');
            await rm(dir, { recursive: true, force: true });
        });

        test('an explicit caller agent wins over agent.default', async () => {
            const dir = await seedWorkflow('spur-wf-agent-explicit-', 'pi');
            const svc = new WorkflowAppService(makeCtx(dir));

            const result = await svc.run(join(dir, 'test.yaml'), {
                runId: 'agent-explicit-1',
                vars: { agent: 'chosen-by-operator' },
            });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            expect(await capturedAgent(dir)).toBe('chosen-by-operator');
            await rm(dir, { recursive: true, force: true });
        });

        test('the YAML literal stands when no agent.default is configured', async () => {
            // Config resolution layers project → user (`~/.config/spur/config.yaml`), so a
            // developer's own global default would otherwise decide this test's outcome.
            const dir = await seedWorkflow('spur-wf-agent-nocfg-');
            const previous = process.env.SPUR_SKIP_GLOBAL_CONFIG;
            process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';
            try {
                const svc = new WorkflowAppService(makeCtx(dir));

                const result = await svc.run(join(dir, 'test.yaml'), { runId: 'agent-nocfg-1' });

                expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
                expect(await capturedAgent(dir)).toBe('omp');
            } finally {
                if (previous === undefined) delete process.env.SPUR_SKIP_GLOBAL_CONFIG;
                else process.env.SPUR_SKIP_GLOBAL_CONFIG = previous;
            }
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('run — implementAgent injection + agent.default validation (0485 R2)', () => {
        const BOTH_AGENT_YAML = `name: agent-both
kind: state-machine
initialState: start
vars:
  agent: "omp"
  implementAgent: ""
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: 'echo "\${vars.agent} \${vars.implementAgent}" > captured-agents.txt'
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

        async function seedBoth(prefix: string, configYaml: string): Promise<string> {
            const dir = await mkdtemp(join(tmpdir(), prefix));
            await writeFile(join(dir, 'test.yaml'), BOTH_AGENT_YAML);
            await mkdir(join(dir, '.spur'), { recursive: true });
            await writeFile(join(dir, '.spur', 'config.yaml'), configYaml);
            return dir;
        }

        async function capturedAgents(dir: string): Promise<string> {
            return (await readFile(join(dir, 'captured-agents.txt'), 'utf8')).trim();
        }

        test('AC2: agent.default injects both agent and implementAgent', async () => {
            const dir = await seedBoth(
                'spur-wf-r2-both-',
                'agent:\n  default: my-exec\n  executors:\n    - name: my-exec\n      agent: pi\n',
            );
            const svc = new WorkflowAppService(makeCtx(dir));

            const result = await svc.run(join(dir, 'test.yaml'), { runId: 'r2-both-1' });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            expect(await capturedAgents(dir)).toBe('my-exec my-exec');
            await rm(dir, { recursive: true, force: true });
        });

        test('0487 R4: caller-set agent seeds implementAgent, outranking agent.default', async () => {
            const dir = await seedBoth(
                'spur-wf-r2-impl-',
                'agent:\n  default: my-exec\n  executors:\n    - name: my-exec\n      agent: pi\n',
            );
            const svc = new WorkflowAppService(makeCtx(dir));

            const result = await svc.run(join(dir, 'test.yaml'), {
                runId: 'r2-impl-1',
                vars: { agent: 'operator-pick' },
            });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            // Was `operator-pick my-exec` under 0485: the caller's explicit agent never
            // reached the implement hop. Caller choice now outranks agent.default.
            expect(await capturedAgents(dir)).toBe('operator-pick operator-pick');
            await rm(dir, { recursive: true, force: true });
        });

        test('0487 R4: caller-set agent seeds implementAgent even with no usable agent.default', async () => {
            const dir = await seedBoth('spur-wf-r2-impl-nodefault-', 'agent:\n  default: commented-out-exec\n');
            const svc = new WorkflowAppService(makeCtx(dir));

            const result = await svc.run(join(dir, 'test.yaml'), {
                runId: 'r2-impl-2',
                vars: { agent: 'operator-pick' },
            });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            expect(await capturedAgents(dir)).toBe('operator-pick operator-pick');
            await rm(dir, { recursive: true, force: true });
        });

        test('0487 R4: caller-set implementAgent is never overridden by vars.agent', async () => {
            const dir = await seedBoth(
                'spur-wf-r2-impl-pinned-',
                'agent:\n  default: my-exec\n  executors:\n    - name: my-exec\n      agent: pi\n',
            );
            const svc = new WorkflowAppService(makeCtx(dir));

            const result = await svc.run(join(dir, 'test.yaml'), {
                runId: 'r2-impl-3',
                vars: { agent: 'operator-pick', implementAgent: 'pinned-impl' },
            });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            expect(await capturedAgents(dir)).toBe('operator-pick pinned-impl');
            await rm(dir, { recursive: true, force: true });
        });

        test('AC3: stale agent.default warns once and the YAML literal stands', async () => {
            const dir = await seedBoth('spur-wf-r2-stale-', 'agent:\n  default: commented-out-exec\n');
            const emitted: string[] = [];
            const svc = new WorkflowAppService({ ...makeCtx(dir), warn: (message) => emitted.push(message) });

            const result = await svc.run(join(dir, 'test.yaml'), { runId: 'r2-stale-1' });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            // Neither var is injected → agent stays on the YAML literal.
            expect(await capturedAgents(dir)).toBe('omp');
            // Exactly one warning naming the dropped value; no dispatch failure.
            const warnings = (result as Record<string, unknown>).warnings as string[] | undefined;
            expect(Array.isArray(warnings)).toBe(true);
            expect(warnings?.filter((w) => w.includes('commented-out-exec'))).toHaveLength(1);
            expect(emitted.filter((w) => w.includes('commented-out-exec'))).toHaveLength(1);
            await rm(dir, { recursive: true, force: true });
        });

        test('a Layer-1 role in agent.default is injected, not rejected as a stale executor', async () => {
            // Regression: `agent.default` moved to the role domain in 0542 (config.example.yaml
            // ships `coder`), but this resolver still validated executor names only — so the
            // recommended value was dropped and every agent.run silently fell back to the
            // pipeline's `omp` literal, defeating the role -> tier -> executor ladder.
            const dir = await seedBoth('spur-wf-role-default-', 'agent:\n  default: coder\n');
            const emitted: string[] = [];
            const svc = new WorkflowAppService({ ...makeCtx(dir), warn: (message) => emitted.push(message) });

            const result = await svc.run(join(dir, 'test.yaml'), { runId: 'role-default-1' });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            // The role reaches both vars; `spur agent run --agent coder` resolves it downstream.
            expect(await capturedAgents(dir)).toBe('coder coder');
            expect(emitted.filter((w) => w.includes('agent.default'))).toHaveLength(0);
            await rm(dir, { recursive: true, force: true });
        });

        test('every Layer-1 role id is accepted in agent.default', async () => {
            for (const role of AGENT_ROLE_NAMES) {
                const dir = await seedBoth(`spur-wf-role-${role}-`, `agent:\n  default: ${role}\n`);
                const svc = new WorkflowAppService(makeCtx(dir));

                const result = await svc.run(join(dir, 'test.yaml'), { runId: `role-${role}-1` });

                expect(result.status, `run failed for ${role}: ${String(result.reason ?? '')}`).toBe('done');
                expect(await capturedAgents(dir)).toBe(`${role} ${role}`);
                await rm(dir, { recursive: true, force: true });
            }
        });

        test('a value that is neither role, executor, nor binary still warns and keeps the literal', async () => {
            const dir = await seedBoth('spur-wf-role-bogus-', 'agent:\n  default: not-a-role\n');
            const emitted: string[] = [];
            const svc = new WorkflowAppService({ ...makeCtx(dir), warn: (message) => emitted.push(message) });

            const result = await svc.run(join(dir, 'test.yaml'), { runId: 'role-bogus-1' });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            expect(await capturedAgents(dir)).toBe('omp');
            expect(emitted.filter((w) => w.includes('not-a-role'))).toHaveLength(1);
            // The warning names all three accepted domains so the operator can fix the value.
            expect(emitted.find((w) => w.includes('not-a-role'))).toContain('Layer-1 role');
            await rm(dir, { recursive: true, force: true });
        });

        test('AC3: a throwing warning sink cannot fail an otherwise completed workflow', async () => {
            const dir = await seedBoth('spur-wf-r2-warn-failure-', 'agent:\n  default: commented-out-exec\n');
            const svc = new WorkflowAppService({
                ...makeCtx(dir),
                warn: () => {
                    throw new Error('output unavailable');
                },
            });

            const result = await svc.run(join(dir, 'test.yaml'), { runId: 'r2-warn-failure-1' });

            expect(result.status, `run failed: ${String(result.reason ?? '')}`).toBe('done');
            expect(await capturedAgents(dir)).toBe('omp');
            expect(((result as Record<string, unknown>).warnings as string[] | undefined)?.length).toBe(1);
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

    describe('cleanRunLogs (retained run-log reclamation, 0429)', () => {
        const DAY = 24 * 60 * 60 * 1000;

        async function seedLog(dir: string, runId: string, mtimeMs: number): Promise<string> {
            const logPath = join(dir, '.spur', 'run', `${runId}.log`);
            await mkdir(join(dir, '.spur', 'run'), { recursive: true });
            await writeFile(logPath, `log for ${runId}`);
            await utimes(logPath, new Date(mtimeMs), new Date(mtimeMs));
            return logPath;
        }

        test('reclaims logs older than the retention threshold, keeps fresh ones', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-log-'));
            const oldLog = await seedLog(dir, 'run_old', Date.now() - 40 * DAY);
            await seedLog(dir, 'run_fresh', Date.now() - 5 * 60 * 1000);

            const result = await new WorkflowAppService(makeCtx(dir)).cleanRunLogs(30, false);

            expect(result.retentionDays).toBe(30);
            expect(result.dryRun).toBe(false);
            expect(result.failures).toEqual([]);
            expect(result.reclaimed.map((r) => r.runId)).toEqual(['run_old']);
            await expect(readFile(oldLog, 'utf8')).rejects.toThrow(); // unlinked
            expect(await readFile(join(dir, '.spur', 'run', 'run_fresh.log'), 'utf8')).toContain('run_fresh');
            await rm(dir, { recursive: true, force: true });
        });

        test('dry-run lists candidates without deleting', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-log-'));
            const oldLog = await seedLog(dir, 'run_old', Date.now() - 40 * DAY);

            const result = await new WorkflowAppService(makeCtx(dir)).cleanRunLogs(30, true);

            expect(result.dryRun).toBe(true);
            expect(result.reclaimed.map((r) => r.runId)).toEqual(['run_old']);
            expect(await readFile(oldLog, 'utf8')).toContain('run_old'); // still present
            await rm(dir, { recursive: true, force: true });
        });

        test('missing run dir is a no-op', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-log-'));
            const result = await new WorkflowAppService(makeCtx(dir)).cleanRunLogs(30, false);
            expect(result).toEqual({ retentionDays: 30, dryRun: false, reclaimed: [], failures: [] });
            await rm(dir, { recursive: true, force: true });
        });

        test('ignores non-log files in the run dir', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-log-'));
            await seedLog(dir, 'run_old', Date.now() - 40 * DAY);
            await writeFile(join(dir, '.spur', 'run', 'README.md'), 'keep me');

            const result = await new WorkflowAppService(makeCtx(dir)).cleanRunLogs(30, false);

            expect(result.reclaimed.map((r) => r.runId)).toEqual(['run_old']);
            expect(await readFile(join(dir, '.spur', 'run', 'README.md'), 'utf8')).toBe('keep me');
            await rm(dir, { recursive: true, force: true });
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

describe('agent.output config bounds flow to the consolidated run-log sink (task 0426 R7)', () => {
    test('resolveOutputLogConfig reads max-bytes/max-lines from .spur/config.yaml agent.output', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-output-config-'));
        // .spur/config.yaml → AgentOutputConfigSchema → resolveOutputLogConfig → WorkflowRunLogConfig.
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(
            join(dir, '.spur', 'config.yaml'),
            `version: "1"\nname: config-bound\nagent:\n  output:\n    max-bytes: 2048\n    max-lines: 1\n`,
        );

        const config = await resolveOutputLogConfig(dir);
        expect(config.maxBytes).toBe(2048);
        expect(config.maxLines).toBe(1);
        await rm(dir, { recursive: true, force: true });
    });

    test('resolveOutputLogConfig degrades to defaults when agent.output is absent', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-output-config-'));
        const config = await resolveOutputLogConfig(dir);
        expect(config.maxBytes).toBeUndefined();
        expect(config.maxLines).toBeUndefined();
        await rm(dir, { recursive: true, force: true });
    });

    test('resolveOutputLogConfig degrades to defaults when config is unreadable', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-output-config-'));
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), `this is: not: valid: yaml: [unclosed\n`);
        const config = await resolveOutputLogConfig(dir);
        expect(config.maxBytes).toBeUndefined();
        expect(config.maxLines).toBeUndefined();
        await rm(dir, { recursive: true, force: true });
    });
});

describe('workflow.logRetentionDays config flows to clean (task 0429)', () => {
    test('resolveWorkflowLogRetentionDays reads workflow.logRetentionDays from .spur/config.yaml', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-retention-config-'));
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'version: "1"\nworkflow:\n  logRetentionDays: 7\n');

        expect(await resolveWorkflowLogRetentionDays(dir)).toBe(7);
        await rm(dir, { recursive: true, force: true });
    });

    test('resolveWorkflowLogRetentionDays degrades to the 30-day default when unset', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-retention-config-'));
        expect(await resolveWorkflowLogRetentionDays(dir)).toBe(30);
        await rm(dir, { recursive: true, force: true });
    });

    test('resolveWorkflowLogRetentionDays degrades to the 30-day default when config is unreadable', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-retention-config-'));
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), `this is: not: valid: yaml: [unclosed\n`);
        expect(await resolveWorkflowLogRetentionDays(dir)).toBe(30);
        await rm(dir, { recursive: true, force: true });
    });
});

// ── 0533 / D4: workflow YAML extensions (actions/guards) ─────────────────────

/** Write a workflow YAML + an extension module into a temp project dir. */
async function seedExtensionProject(opts: {
    name: string;
    extensions?: { actions?: string[]; guards?: string[] };
    extModules?: Record<string, string>;
}): Promise<{ dir: string; wfPath: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-wf-ext-'));
    const extsDir = join(dir, 'exts');
    await mkdir(extsDir, { recursive: true });
    const lines = [`name: ${opts.name}`, 'kind: state-machine', 'initialState: start'];
    if (opts.extensions !== undefined) {
        lines.push('extensions:');
        if (opts.extensions.actions !== undefined) {
            lines.push('  actions:');
            for (const p of opts.extensions.actions) lines.push(`    - ${p}`);
        }
        if (opts.extensions.guards !== undefined) {
            lines.push('  guards:');
            for (const p of opts.extensions.guards) lines.push(`    - ${p}`);
        }
    }
    lines.push('states:', '  - id: start');
    // Only reference the extension action when the workflow declares one; a
    // guard-only workflow must not require the action module (R2).
    if (opts.extensions?.actions !== undefined) {
        lines.push('    onEnter:', '      - kind: audit-log', '        options:', '          marker: marker.txt');
    }
    lines.push(
        '  - id: done',
        'transitions:',
        '  - from: start',
        '    to: done',
        // Only reference the extension guard when the workflow declares one; a
        // action-only workflow must not require the guard module (R1).
        ...(opts.extensions?.guards !== undefined ? ['    guard: { kind: feature-flag }'] : []),
        'terminalStates:',
        '  - done',
    );
    const wfPath = join(dir, 'flow.yaml');
    await writeFile(wfPath, lines.join('\n'));
    for (const [rel, source] of Object.entries(opts.extModules ?? {})) {
        await writeFile(join(extsDir, rel), source);
    }
    return { dir, wfPath };
}

const AUDIT_EXT = `
export default {
    name: 'audit-ext',
    actions: [
        {
            kind: 'audit-log',
            async execute(options, context) {
                const { writeFileSync, mkdirSync } = await import('node:fs');
                const { join } = await import('node:path');
                const base = context.workdir ?? process.cwd();
                mkdirSync(base, { recursive: true });
                writeFileSync(join(base, String(options.marker ?? 'marker.txt')), 'ran', 'utf8');
                return { ok: true };
            },
        },
    ],
};
`;

const FLAG_EXT = `
export default {
    name: 'flag-ext',
    guards: [
        {
            kind: 'feature-flag',
            async evaluate() {
                return true;
            },
        },
    ],
};
`;

describe('WorkflowAppService — workflow YAML extensions (0533 / D4)', () => {
    test('R1: a listed action module is registered for the same file', async () => {
        const { dir, wfPath } = await seedExtensionProject({
            name: 'ext-action',
            extensions: { actions: ['./exts/audit.ts'] },
            extModules: { 'audit.ts': AUDIT_EXT },
        });
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(wfPath, { runId: 'ext-a1' });
            expect(result.status).toBe('done');
            const marker = await readFile(join(dir, 'marker.txt'), 'utf8').catch(() => '');
            expect(marker).toBe('ran');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R2: a listed guard module is registered and evaluated', async () => {
        const { dir, wfPath } = await seedExtensionProject({
            name: 'ext-guard',
            extensions: { guards: ['./exts/flag.ts'] },
            extModules: { 'flag.ts': FLAG_EXT },
        });
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(wfPath, { runId: 'ext-g1' });
            // Guard feature-flag evaluates true → transition taken → done.
            expect(result.status).toBe('done');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R3: validate fails closed on a missing extension module', async () => {
        const { dir, wfPath } = await seedExtensionProject({
            name: 'ext-missing',
            extensions: { actions: ['./exts/nope.ts'] },
        });
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(wfPath);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.join('\n')).toMatch(/nope\.ts/);
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R3: run fails closed on a module without the declared capability', async () => {
        const { dir, wfPath } = await seedExtensionProject({
            name: 'ext-misshape',
            extensions: { actions: ['./exts/bad.ts'] },
            extModules: { 'bad.ts': 'export default { name: "bad-ext" };\n' },
        });
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            await expect(svc.run(wfPath, { runId: 'ext-b1' })).rejects.toThrow(/actions\[\]/);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R4: dry-run uses the same loaded host (guard registered + evaluated)', async () => {
        const { dir, wfPath } = await seedExtensionProject({
            name: 'ext-dry',
            extensions: { guards: ['./exts/flag.ts'] },
            extModules: { 'flag.ts': FLAG_EXT },
        });
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(wfPath, { runId: 'ext-d1', dryRun: true });
            // Guards evaluate even under dry-run; a missing guard would fail here.
            expect(result.status).toBe('done');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R4: absolute paths are rejected with no import', async () => {
        const { dir, wfPath } = await seedExtensionProject({
            name: 'ext-abs',
            extensions: { actions: ['/etc/passwd'] },
        });
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            const validated = await svc.validate(wfPath);
            expect(validated.valid).toBe(false);
            if (!validated.valid) {
                expect(validated.errors.join('\n')).toMatch(/relative|absolute/i);
            }
            await expect(svc.run(wfPath, { runId: 'ext-ab1' })).rejects.toThrow(/relative|absolute/i);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R4: ".." traversal is rejected with no import', async () => {
        const { dir, wfPath } = await seedExtensionProject({
            name: 'ext-dotdot',
            extensions: { actions: ['./../escape.ts'] },
        });
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            const validated = await svc.validate(wfPath);
            expect(validated.valid).toBe(false);
            if (!validated.valid) {
                expect(validated.errors.join('\n')).toMatch(/traversal|\.\./);
            }
            await expect(svc.run(wfPath, { runId: 'ext-d1' })).rejects.toThrow(/traversal|\.\./);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('WorkflowAppService — continue loads workflow YAML extensions (0533 / D4)', () => {
    test('R4: continue re-registers extension guards from the workflow file', async () => {
        // A pausing workflow whose resume transition is gated by an extension
        // guard. If continue did not load extensions, the resume would fail with
        // an unknown-guard error instead of taking the transition.
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-ext-cont-'));
        const wfDir = join(dir, '.spur', 'workflows');
        const extsDir = join(wfDir, 'exts');
        await mkdir(extsDir, { recursive: true });
        const wfPath = join(wfDir, 'ext-pauser.yaml');
        await writeFile(
            wfPath,
            [
                'name: ext-pauser',
                'kind: state-machine',
                'initialState: start',
                'extensions:',
                '  guards:',
                '    - ./exts/flag.ts',
                'states:',
                '  - id: start',
                '  - id: gate',
                '    pause: true',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: gate',
                '    guard: { kind: always }',
                '  - from: gate',
                '    to: done',
                '    guard: { kind: feature-flag }',
                'terminalStates:',
                '  - done',
            ].join('\n'),
        );
        await writeFile(join(extsDir, 'flag.ts'), FLAG_EXT);
        try {
            const svc = new WorkflowAppService(makeCtx(dir));
            const paused = await svc.run(wfPath, { runId: 'ext-p1' });
            expect(paused.status).toBe('paused');

            const resumed = await svc.continuePaused('ext-p1');
            expect(resumed.status).toBe('done');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('definitionDigest merge on run creation (task 0603)', () => {
    test('run merges definitionDigest into runs.metadata_json without clobbering dryRun or failureReason', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-digest-'));
        const wfPath = join(dir, 'test-digest.yaml');
        await writeFile(
            wfPath,
            [
                'kind: state-machine',
                'name: digest-wf',
                'initialState: start',
                'states:',
                '  - id: start',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
                'terminalStates:',
                '  - done',
            ].join('\n'),
        );
        try {
            const ctx = makeCtx(dir);
            const svc = new WorkflowAppService(ctx);
            const res = await svc.run(wfPath, { runId: 'run-digest-1', dryRun: true });
            expect(res.status).toBe('done');

            const db = await ctx.getDb();
            const row = await new RunDao(db).traceRowById('run-digest-1');
            expect(row).toBeDefined();
            const meta = JSON.parse(row?.metadata_json ?? '{}');
            expect(meta.dryRun).toBe(true);
            expect(meta.definitionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
