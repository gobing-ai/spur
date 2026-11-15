/**
 * a2a-member-e2e — prove work delivery to A2A-declared fleet members (task 1334).
 *
 * Usage: bun scripts/spur-dev.ts a2a-member-e2e [--keep]
 *
 * Drives the unmodified `a2a` CLI against a local `a2a server --exec`, then the real source-local
 * `spur` CLI with no serve (in-process) and with serve (live member loop). The timeout/re-attach
 * leg uses the same real transport and database, not a stubbed receipt. Every step records its
 * command, exit code and evidence in docs/reports/a2a-member-e2e-receipt.json.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { A2aCli, A2aMemberRef, A2aTask } from '@gobing-ai/spur-app';
import { A2aCliService, A2aMemberTransport, AgentCoordinationService, FleetDispatcher } from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { CoordinationRunDao, createMigratedDb } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const CLI = join(REPO_ROOT, 'apps/cli/src/index.ts');
const RECEIPT = join(REPO_ROOT, 'docs/reports/a2a-member-e2e-receipt.json');
const EXEC_LOG_RECEIPT = join(REPO_ROOT, 'docs/reports/a2a-member-e2e-exec.log');
const TOKEN = 'a2a-member-e2e-token-1234';
const TOKEN_ENV = 'A2A_MEMBER_TEST_TOKEN';
const MISSING_ENV = 'A2A_MEMBER_UNSET_TOKEN';

interface StepRow {
    step: string;
    requirement: string;
    command: string;
    exitCode: number;
    status: 'passed' | 'failed';
    evidence: string;
}

const steps: StepRow[] = [];
function record(step: string, requirement: string, command: string, passed: boolean, evidence: string): void {
    steps.push({
        step,
        requirement,
        command,
        exitCode: passed ? 0 : 1,
        status: passed ? 'passed' : 'failed',
        evidence,
    });
}

async function freePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            server.close(() => resolvePort(port));
        });
    });
}

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}) {
    const proc = Bun.spawn(cmd, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN, ...env },
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

function jsonOf(text: string): Record<string, unknown> | null {
    try {
        const value = JSON.parse(text) as unknown;
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

async function waitForHealth(port: number, memberId?: string): Promise<boolean> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            const health = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (health.ok && memberId === undefined) return true;
            if (health.ok && memberId !== undefined) {
                const response = await fetch(`http://127.0.0.1:${port}/api/processes`);
                const body = (await response.json()) as { processes?: Array<{ agentId?: string; status?: string }> };
                if (body.processes?.some((row) => row.agentId === memberId && row.status === 'running')) return true;
            }
        } catch {
            // Listener not ready yet.
        }
        await Bun.sleep(200);
    }
    return false;
}

/** Count calls while delegating every invocation to the real `a2a` binary. */
class CountingCli implements A2aCli {
    sends = 0;
    gets = 0;
    cancels = 0;
    constructor(private readonly inner: A2aCliService) {}
    version(): Promise<string> {
        return this.inner.version();
    }
    card(member: A2aMemberRef): Promise<{ protocolVersion: string }> {
        return this.inner.card(member);
    }
    async send(member: A2aMemberRef, text: string, messageId: string): Promise<{ taskId: string; contextId: string }> {
        this.sends++;
        return this.inner.send(member, text, messageId);
    }
    async get(member: A2aMemberRef, taskId: string): Promise<A2aTask> {
        this.gets++;
        return this.inner.get(member, taskId);
    }
    async cancel(member: A2aMemberRef, taskId: string): Promise<void> {
        this.cancels++;
        return this.inner.cancel(member, taskId);
    }
}

export async function runA2aMemberE2e(args: string[]): Promise<number> {
    const keep = args.includes('--keep');
    if ((await run(['a2a', 'version'], REPO_ROOT)).code !== 0) return 2;
    const scratch = join(tmpdir(), `a2a-member-e2e-${Math.random().toString(36).slice(2, 10)}`);
    mkdirSync(scratch, { recursive: true });
    const a2aPort = await freePort();
    const servePort = await freePort();
    const agent = join(scratch, 'exec-agent.sh');
    const execLog = join(scratch, 'exec.log');
    writeFileSync(
        agent,
        `#!/bin/sh\ninput=$(cat)\nprintf '%s\\n' "$input" >> '${execLog}'\ncase "$input" in *slow*) sleep 2 ;; esac\nprintf 'exec-answer: %s\\n' "$input"\n`,
    );
    chmodSync(agent, 0o755);
    const a2aServer = Bun.spawn(['a2a', 'server', '--exec', agent, '--port', String(a2aPort), '--quiet'], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    let serve: ReturnType<typeof Bun.spawn> | undefined;
    try {
        mkdirSync(join(scratch, '.spur'), { recursive: true });
        mkdirSync(join(scratch, 'docs/tasks'), { recursive: true });
        mkdirSync(join(scratch, 'docs/features'), { recursive: true });
        const card = `http://127.0.0.1:${a2aPort}`;
        writeFileSync(
            join(scratch, '.spur/config.yaml'),
            [
                'version: "1.2"',
                'name: a2a-member-e2e',
                'agent:',
                '  fleet:',
                '    strategy: rest',
                '    members:',
                '      - id: remote',
                `        a2a: ${card}`,
                `        authEnv: ${TOKEN_ENV}`,
                '      - id: broken',
                '        a2a: http://127.0.0.1:1',
                '      - id: missing',
                `        a2a: ${card}`,
                `        authEnv: ${MISSING_ENV}`,
                '',
            ].join('\n'),
        );
        await Bun.sleep(500);

        const cold = await run(
            [CLI, 'agent', 'run', 'cold read-only turn', '--agent', 'remote', '--json', '--no-logo'],
            scratch,
        );
        const coldBody = jsonOf(cold.stdout);
        const db = await createMigratedDb({ url: join(scratch, '.spur/spur.db') });
        const messageId = typeof coldBody?.messageId === 'string' ? coldBody.messageId : '';
        const runs = messageId === '' ? [] : await new CoordinationRunDao(db).listByMessageId(messageId);
        record(
            'cold-in-process',
            'R1/R2/R3/R4/R8/AC1/AC6',
            'spur agent run "cold read-only turn" --agent remote --json',
            cold.code === 0 &&
                coldBody?.status === 'completed' &&
                runs[0]?.remote_task_id !== null &&
                runs.length === 1,
            `exit=${cold.code}; status=${String(coldBody?.status)}; output=${String(coldBody?.output ?? '')}; reason=${String(coldBody?.reason ?? '')}; remoteTask=${runs[0]?.remote_task_id ?? 'missing'}; context=${runs[0]?.remote_context_id ?? 'missing'}`,
        );
        record(
            'credential-not-persisted',
            'R8/AC6',
            'inspect argv, CLI output and .spur/run/a2a-credential-helper',
            !cold.stdout.includes(TOKEN) &&
                !cold.stderr.includes(TOKEN) &&
                existsSync(join(scratch, '.spur/run/a2a-credential-helper')) &&
                !readFileSync(join(scratch, '.spur/run/a2a-credential-helper'), 'utf8').includes(TOKEN),
            'the token appears only in the spawned environment; helper stores its variable name',
        );

        const doctor = await run([CLI, 'agent', 'doctor', '--no-logo'], scratch);
        record(
            'doctor',
            'R10',
            'spur agent doctor',
            doctor.stdout.includes('a2a 0.4.0') && doctor.stdout.includes('card reachable; protocol 1.0'),
            doctor.stdout
                .split('\n')
                .filter((line) => line.includes('-remote'))
                .join('\n'),
        );

        const missing = await run(
            [CLI, 'agent', 'run', 'must not start', '--agent', 'missing', '--json', '--no-logo'],
            scratch,
            {
                [MISSING_ENV]: undefined,
            },
        );
        record(
            'missing-auth',
            'R6/AC6',
            'spur agent run "must not start" --agent missing --json',
            missing.code !== 0 && missing.stderr.includes('missing') && missing.stderr.includes(MISSING_ENV),
            `exit=${missing.code}; ${missing.stderr}`,
        );
        const broken = await run(
            [CLI, 'agent', 'run', 'must not start', '--agent', 'broken', '--json', '--no-logo'],
            scratch,
        );
        record(
            'unreachable-card',
            'R6',
            'spur agent run "must not start" --agent broken --json',
            broken.code !== 0 && broken.stderr.includes('broken'),
            `exit=${broken.code}; ${broken.stderr}`,
        );

        // A live member takes the same keyed request through its loop, not the in-process shortcut.
        const configPath = join(scratch, '.spur/config.yaml');
        writeFileSync(
            configPath,
            readFileSync(configPath, 'utf8').replace('  fleet:\n', '  fleet:\n    enabled: true\n'),
        );
        serve = Bun.spawn(
            [CLI, 'serve', '--port', String(servePort), '--host', '127.0.0.1', '--no-open', '--no-logo'],
            {
                cwd: scratch,
                stdout: 'pipe',
                stderr: 'pipe',
                env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN },
            },
        );
        const memberId = `${scratch.split('/').pop()}-remote`;
        const liveReady = await waitForHealth(servePort, memberId);
        const live = liveReady
            ? await run(
                  [CLI, 'agent', 'run', 'live read-only turn', '--agent', 'remote', '--json', '--no-logo'],
                  scratch,
              )
            : { code: 1, stdout: '', stderr: 'member loop did not start' };
        const liveBody = jsonOf(live.stdout);
        record(
            'live-member-loop',
            'R3/AC1',
            'spur serve + spur agent run "live read-only turn" --agent remote --json',
            liveReady &&
                live.code === 0 &&
                liveBody?.status === 'completed' &&
                String(liveBody.output).includes('live read-only turn'),
            `ready=${liveReady}; exit=${live.code}; status=${String(liveBody?.status)}; output=${String(liveBody?.output ?? '')}; reason=${String(liveBody?.reason ?? '')}`,
        );
        serve.kill('SIGTERM');
        await serve.exited;
        serve = undefined;

        // A real workflow agent.run stage uses the SAME member resolution, with no A2A selector.
        const workflowPath = join(scratch, 'a2a-member-workflow.yaml');
        const workflowYaml = (mutating: boolean): string =>
            [
                'name: a2a-member-proof',
                'kind: state-machine',
                'version: "1"',
                'initialState: work',
                'terminalStates: [done]',
                'states:',
                '  - id: work',
                '    onEnter:',
                '      - kind: agent.run',
                '        options:',
                '          id: work',
                '          role: coder',
                '          agent: remote',
                '          input: "workflow read-only turn"',
                '          timeoutMs: 60000',
                ...(mutating ? ['          requireDiff: true'] : []),
                '  - id: done',
                'transitions:',
                '  - from: work',
                '    to: done',
                '    guard:',
                '      kind: always',
                '',
            ].join('\n');
        writeFileSync(workflowPath, workflowYaml(false));
        const workflow = await run(
            [CLI, 'workflow', 'run', workflowPath, '--vars', '{"executor":"fleet"}', '--json', '--no-logo'],
            scratch,
        );
        const workflowBody = jsonOf(workflow.stdout);
        record(
            'workflow-agent-run',
            'R3/R9/AC1',
            'spur workflow run a2a-member-workflow.yaml --vars {"executor":"fleet"}',
            workflow.code === 0 && workflowBody?.status === 'done',
            `exit=${workflow.code}; status=${String(workflowBody?.status)}; reason=${String(workflowBody?.reason ?? '')}`,
        );

        // Real timeout → resume: one remote task id, one send, no duplicate execution.
        const counting = new CountingCli(
            new A2aCliService({ cwd: scratch, env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN } }),
        );
        const transport = new A2aMemberTransport({
            cwd: scratch,
            getDb: async () => db,
            env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN },
            cli: counting,
            pollIntervalMs: 25,
        });
        const coordination = new AgentCoordinationService({
            cwd: scratch,
            env: getEnvVars(),
            spurConfig: await loadSpurConfig(scratch),
            getDb: async () => db,
            fs: createNodeFileSystem(scratch),
        });
        const dispatcher = new FleetDispatcher({
            coordination,
            runs: { listByMessageId: async (id) => await new CoordinationRunDao(db).listByMessageId(id) },
        });
        const roster = await coordination.listFleetMembers();
        const member = roster.find(
            (candidate) => candidate.localId === 'remote' || candidate.instanceId.endsWith('-remote'),
        );
        if (member === undefined) throw new Error(`remote member did not resolve: ${JSON.stringify(roster)}`);
        const first = await transport.dispatch(member, 'slow turn', {
            dispatcher,
            fromId: 'operator',
            requestKey: 'e2e/slow',
            timeoutMs: 50,
        });
        await Bun.sleep(2_200);
        // Simulate a member-loop restart: local orphans are reaped, an A2A remote run is NOT.
        const reaped = await new CoordinationRunDao(db).reapOrphanedRunning(
            member.instanceId,
            new Date().toISOString(),
        );
        const restarted = new A2aMemberTransport({
            cwd: scratch,
            getDb: async () => db,
            env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN },
            cli: counting,
            pollIntervalMs: 25,
        });
        const resumed = await restarted.runMessage(member, first.messageId, { timeoutMs: 10_000 });
        record(
            'timeout-reattach',
            'R4/R5/AC3/AC4',
            'A2aMemberTransport.dispatch(timeout=50ms) → orphan sweep + fresh transport runMessage',
            first.status === 'outcome-unknown' &&
                resumed.status === 'completed' &&
                counting.sends === 1 &&
                reaped.length === 0 &&
                resumed.runId === first.runId,
            `first=${first.status} (${first.reason ?? ''}); resumed=${resumed.status} (${resumed.reason ?? ''}); sends=${counting.sends}; gets=${counting.gets}; runId=${first.runId}`,
        );

        writeFileSync(workflowPath, workflowYaml(true));
        const beforeRefusal = existsSync(execLog)
            ? readFileSync(execLog, 'utf8').split('\n').filter(Boolean).length
            : 0;
        const refusal = await run(
            [CLI, 'workflow', 'run', workflowPath, '--vars', '{"executor":"fleet"}', '--json', '--no-logo'],
            scratch,
        );
        const refusalBody = jsonOf(refusal.stdout);
        const afterRefusal = existsSync(execLog) ? readFileSync(execLog, 'utf8').split('\n').filter(Boolean).length : 0;
        record(
            'read-only-admission',
            'R7/R9/AC5',
            'spur workflow run a2a-member-workflow.yaml (requireDiff=true)',
            refusal.code !== 0 && String(refusalBody?.reason).includes('read-only') && beforeRefusal === afterRefusal,
            `exit=${refusal.code}; reason=${String(refusalBody?.reason)}; remote turns before/after=${beforeRefusal}/${afterRefusal}; ExecutorDispatchSurface=host|fleet|subprocess`,
        );

        if (existsSync(execLog)) writeFileSync(EXEC_LOG_RECEIPT, readFileSync(execLog, 'utf8'));
        const receipt = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            command: 'bun run a2a-member-e2e',
            a2aVersion: (await run(['a2a', 'version'], REPO_ROOT)).stdout.split('\n')[0],
            scratch,
            steps,
            passed: steps.every((step) => step.status === 'passed'),
        };
        writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
        for (const step of steps) console.log(`${step.status === 'passed' ? '✓' : '✗'} ${step.step}: ${step.evidence}`);
        return receipt.passed ? 0 : 1;
    } finally {
        a2aServer.kill('SIGTERM');
        await a2aServer.exited;
        if (serve !== undefined) {
            serve.kill('SIGTERM');
            await serve.exited;
        }
        if (keep) console.log(`kept scratch: ${scratch}`);
        else rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    try {
        process.exitCode = await runA2aMemberE2e(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
