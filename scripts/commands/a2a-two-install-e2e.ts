/**
 * a2a-two-install-e2e — task 1337: two Spur homes complete A2A work, including fenced mutation.
 *
 * A real A2A listener/member loop runs in install B; install A uses the normal named-member cold
 * path. A tiny `a2a server --exec` is B's deterministic worker. Every leg uses real source code and
 * durable databases, never a mocked receipt.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { A2aCli, A2aMemberRef, A2aTask } from '@gobing-ai/spur-app';
import { A2aCliService, A2aMemberTransport, AgentCoordinationService, FleetDispatcher } from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { CoordinationRunDao, createMigratedDb, InboxDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const CLI = join(REPO_ROOT, 'apps/cli/src/index.ts');
const RECEIPT = join(REPO_ROOT, 'docs/reports/a2a-two-install-e2e-receipt.json');
const TOKEN = 'a2a-two-install-token-1234';
const TOKEN_ENV = 'A2A_TWO_INSTALL_MEMBER_TOKEN';
const LISTENER_ENV = 'A2A_TWO_INSTALL_LISTENER_TOKEN';
const EXTENSION = 'urn:spur:write-fencing:v1';
const REMOTE_BRANCH = 'sp/remote-e2e';

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
function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}
function jsonOf(text: string): Record<string, unknown> | null {
    try {
        return asRecord(JSON.parse(text));
    } catch {
        return null;
    }
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
        env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN, [LISTENER_ENV]: TOKEN, ...env },
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}
async function healthy(port: number): Promise<boolean> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true;
        } catch {
            // listener is still starting
        }
        await Bun.sleep(200);
    }
    return false;
}
function scaffold(root: string, name: string, members: string[]): void {
    mkdirSync(join(root, '.spur'), { recursive: true });
    mkdirSync(join(root, 'docs/tasks'), { recursive: true });
    mkdirSync(join(root, 'docs/features'), { recursive: true });
    writeFileSync(
        join(root, '.spur/config.yaml'),
        [
            'version: "1.2"',
            `name: ${name}`,
            'agent:',
            '  fleet:',
            '    strategy: rest',
            '    members:',
            ...members,
            '',
        ].join('\n'),
    );
}
function startServe(root: string, port: number) {
    return Bun.spawn([CLI, 'self', 'serve', '--port', String(port), '--host', '127.0.0.1', '--no-open', '--no-logo'], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...getEnvVars(),
            SPUR_A2A_ENABLED: '1',
            SPUR_A2A_AUTH_ENV: LISTENER_ENV,
            [TOKEN_ENV]: TOKEN,
            [LISTENER_ENV]: TOKEN,
        },
    });
}
async function stopServe(proc: ReturnType<typeof Bun.spawn> | undefined): Promise<void> {
    if (proc === undefined) return;
    proc.kill('SIGTERM');
    await proc.exited;
}
class CountingCli implements A2aCli {
    sends = 0;
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
    get(member: A2aMemberRef, taskId: string): Promise<A2aTask> {
        return this.inner.get(member, taskId);
    }
    cancel(member: A2aMemberRef, taskId: string): Promise<void> {
        return this.inner.cancel(member, taskId);
    }
}
async function transportFor(root: string, env: Record<string, string | undefined> = {}, counting?: CountingCli) {
    const db = await createMigratedDb({ url: join(root, '.spur/spur.db') });
    const coordination = new AgentCoordinationService({
        cwd: root,
        env: getEnvVars(),
        spurConfig: await loadSpurConfig(root),
        getDb: async () => db,
        fs: createNodeFileSystem(root),
    });
    const dispatcher = new FleetDispatcher({
        coordination,
        runs: { listByMessageId: async (id) => await new CoordinationRunDao(db).listByMessageId(id) },
    });
    const transport = new A2aMemberTransport({
        cwd: root,
        getDb: async () => db,
        env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN, [LISTENER_ENV]: TOKEN, ...env },
        ...(counting === undefined ? {} : { cli: counting }),
        pollIntervalMs: 25,
    });
    return { db, coordination, dispatcher, transport };
}
async function memberFor(coordination: AgentCoordinationService, localId: string) {
    const roster = await coordination.listFleetMembers();
    const member = roster.find(
        (candidate) => candidate.localId === localId || candidate.instanceId.endsWith(`-${localId}`),
    );
    if (member === undefined) throw new Error(`member did not resolve: ${localId}`);
    return member;
}
function workflowFile(root: string): string {
    const path = join(root, 'a2a-two-install-workflow.yaml');
    writeFileSync(
        path,
        [
            'name: a2a-two-install-proof',
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
            '          agent: remote-b',
            '          input: "mutate public"',
            '          requireDiff: true',
            '          timeoutMs: 60000',
            '  - id: done',
            'transitions:',
            '  - from: work',
            '    to: done',
            '    guard:',
            '      kind: always',
            '',
        ].join('\n'),
    );
    return path;
}

export async function runA2aTwoInstallE2e(args: string[] = []): Promise<number> {
    const keep = args.includes('--keep');
    if ((await run(['a2a', 'version'], REPO_ROOT)).code !== 0) return 2;
    const scratch = join(tmpdir(), `a2a-two-install-${Math.random().toString(36).slice(2, 10)}`);
    const aHome = join(scratch, 'a');
    const bHome = join(scratch, 'b');
    mkdirSync(aHome, { recursive: true });
    mkdirSync(bHome, { recursive: true });
    const execPort = await freePort();
    const bPort = await freePort();
    const execLog = join(scratch, 'exec.log');
    const agent = join(scratch, 'exec-agent.sh');
    writeFileSync(
        agent,
        `#!/bin/sh\ninput=$(cat)\nprintf '%s\\n' "$input" >> '${execLog}'\ncase "$input" in *slow*) sleep 2 ;; esac\ncase "$input" in *mutate*) printf 'mutated\\n' > '${bHome}/mutated.txt' ;; esac\nprintf 'exec-answer: %s\\n' "$input"\n`,
    );
    chmodSync(agent, 0o755);
    const execServer = Bun.spawn(['a2a', 'server', '--exec', agent, '--port', String(execPort), '--quiet'], {
        cwd: bHome,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    let bServe: ReturnType<typeof Bun.spawn> | undefined;
    try {
        const execCard = `http://127.0.0.1:${execPort}`;
        scaffold(bHome, 'a2a-two-install-b', [
            '      - id: worker',
            `        a2a: ${execCard}`,
            `        authEnv: ${TOKEN_ENV}`,
        ]);
        writeFileSync(
            join(bHome, '.spur/config.yaml'),
            readFileSync(join(bHome, '.spur/config.yaml'), 'utf8').replace(
                '  fleet:\n',
                '  fleet:\n    enabled: true\n',
            ),
        );
        for (const [home, branch] of [
            [aHome, 'sp/sender-e2e'],
            [bHome, REMOTE_BRANCH],
        ] as const) {
            const init = await run(['git', 'init', '-b', branch], home);
            if (init.code !== 0) throw new Error(`git init failed in ${home}: ${init.stderr}`);
        }
        await Bun.sleep(300);
        bServe = startServe(bHome, bPort);
        if (!(await healthy(bPort))) throw new Error('install B never became healthy');
        const bCard = `http://127.0.0.1:${bPort}/a2a/members/${basename(bHome)}-worker/.well-known/agent-card.json`;
        scaffold(aHome, 'a2a-two-install-a', [
            '      - id: remote-b',
            `        a2a: ${bCard}`,
            `        authEnv: ${TOKEN_ENV}`,
            '      - id: unfenced',
            `        a2a: ${execCard}`,
            `        authEnv: ${TOKEN_ENV}`,
        ]);

        const cold = await run(
            [CLI, 'agent', 'run', 'read only two install', '--agent', 'remote-b', '--json', '--no-logo'],
            aHome,
        );
        const coldBody = jsonOf(cold.stdout);
        const messageId = typeof coldBody?.messageId === 'string' ? coldBody.messageId : '';
        const aDb = await createMigratedDb({ url: join(aHome, '.spur/spur.db') });
        const bDb = await createMigratedDb({ url: join(bHome, '.spur/spur.db') });
        const aRuns = messageId === '' ? [] : await new CoordinationRunDao(aDb).listByMessageId(messageId);
        const remoteMessageId = aRuns[0]?.remote_task_id ?? '';
        const bRuns = remoteMessageId === '' ? [] : await new CoordinationRunDao(bDb).listByMessageId(remoteMessageId);
        record(
            'read-only-two-install',
            'R1/R2/AC1',
            'A: spur agent run "read only two install" --agent remoteB --json',
            cold.code === 0 && coldBody?.status === 'completed' && aRuns.length === 1 && bRuns.length === 1,
            `exit=${cold.code}; status=${String(coldBody?.status)}; output=${String(coldBody?.output ?? '')}; A runs=${aRuns.length}; B runs=${bRuns.length}`,
        );

        const card = await run(['a2a', '-a', bCard, '--auth', `Bearer ${TOKEN}`, 'card', 'get', '-o', 'json'], aHome);
        const cardBody = jsonOf(card.stdout);
        const capabilities = asRecord(cardBody?.capabilities);
        const extensions = Array.isArray(capabilities?.extensions) ? capabilities.extensions : [];
        const extensionOk = extensions.some((entry) => asRecord(entry)?.uri === EXTENSION);
        record('write-fencing-card', 'R3', `a2a -a ${bCard} card get`, card.code === 0 && extensionOk, card.stdout);

        const unfenced = await transportFor(aHome);
        const unfencedMember = await memberFor(unfenced.coordination, 'unfenced');
        const unfencedResult = await unfenced.transport.dispatch(unfencedMember, 'mutate unfenced', {
            dispatcher: unfenced.dispatcher,
            fromId: 'operator',
            requestKey: 'e2e/unfenced',
            work: { requireDiff: true },
        });
        record(
            'extension-free-refusal',
            'R3/AC2',
            'A2aMemberTransport.dispatch(requireDiff) to card without extension',
            unfencedResult.status === 'not-started' && String(unfencedResult.reason ?? '').includes('read-only'),
            `status=${unfencedResult.status}; reason=${unfencedResult.reason ?? ''}`,
        );

        writeFileSync(
            join(aHome, '.spur/config.yaml'),
            readFileSync(join(aHome, '.spur/config.yaml'), 'utf8').replace(
                `a2a: ${bCard}\n        authEnv: ${TOKEN_ENV}`,
                `a2a: ${bCard}\n        authEnv: A2A_WRONG_TOKEN`,
            ),
        );
        const wrong = await transportFor(aHome, { A2A_WRONG_TOKEN: 'wrong-value' });
        const wrongMember = await memberFor(wrong.coordination, 'remote-b');
        const wrongResult = await wrong.transport.dispatch(wrongMember, 'token mismatch', {
            dispatcher: wrong.dispatcher,
            fromId: 'operator',
            requestKey: 'e2e/token-mismatch',
        });
        const wrongInbox = await new InboxDao(wrong.db).findByRequestKey(
            `a2a:${wrongMember.instanceId}:e2e/token-mismatch`,
        );
        record(
            'token-mismatch',
            'failure: wrong bearer token',
            'A2aMemberTransport.dispatch with a different A/B token',
            wrongResult.status === 'not-started' && wrongInbox === null,
            `status=${wrongResult.status}; B request present=${wrongInbox !== null}; reason=${wrongResult.reason ?? ''}`,
        );
        writeFileSync(
            join(aHome, '.spur/config.yaml'),
            readFileSync(join(aHome, '.spur/config.yaml'), 'utf8').replace('A2A_WRONG_TOKEN', TOKEN_ENV),
        );

        const fenced = await transportFor(aHome);
        const fencedMember = await memberFor(fenced.coordination, 'remote-b');
        const fencedResult = await fenced.transport.dispatch(fencedMember, 'mutate fenced', {
            dispatcher: fenced.dispatcher,
            fromId: 'operator',
            requestKey: 'e2e/fenced',
            work: { requireDiff: true },
        });
        const fencedRecord = asRecord(fencedResult);
        record(
            'fenced-mutation-and-branch',
            'R3/R4/AC2',
            'A2aMemberTransport.dispatch(requireDiff) to B write-fencing card',
            fencedResult.status === 'completed' &&
                fencedRecord?.remoteBranch === REMOTE_BRANCH &&
                existsSync(join(bHome, 'mutated.txt')) &&
                !existsSync(join(aHome, 'mutated.txt')),
            `status=${fencedResult.status}; remoteBranch=${String(fencedRecord?.remoteBranch)}; B mutated=${existsSync(join(bHome, 'mutated.txt'))}; A mutated=${existsSync(join(aHome, 'mutated.txt'))}`,
        );

        const workflow = await run(
            [CLI, 'workflow', 'run', workflowFile(aHome), '--vars', '{"executor":"fleet"}', '--json', '--no-logo'],
            aHome,
        );
        const workflowBody = jsonOf(workflow.stdout);
        record(
            'fenced-workflow-stage',
            'R3',
            'spur workflow run requireDiff=true --vars {"executor":"fleet"}',
            workflow.code === 0 && workflowBody?.status === 'done',
            `exit=${workflow.code}; status=${String(workflowBody?.status)}; reason=${String(workflowBody?.reason ?? '')}`,
        );

        await stopServe(bServe);
        bServe = undefined;
        const down = await transportFor(aHome);
        const downMember = await memberFor(down.coordination, 'remote-b');
        const downResult = await down.transport.dispatch(downMember, 'B is down', {
            dispatcher: down.dispatcher,
            fromId: 'operator',
            requestKey: 'e2e/down',
        });
        record(
            'b-down',
            'failure: B unavailable',
            'A2aMemberTransport.dispatch with B stopped',
            downResult.status === 'not-started',
            `status=${downResult.status}; reason=${downResult.reason ?? ''}`,
        );

        bServe = startServe(bHome, bPort);
        if (!(await healthy(bPort))) throw new Error('install B did not restart');
        const counting = new CountingCli(
            new A2aCliService({ cwd: aHome, env: { ...getEnvVars(), [TOKEN_ENV]: TOKEN } }),
        );
        const restarted = await transportFor(aHome, {}, counting);
        const restartMember = await memberFor(restarted.coordination, 'remote-b');
        const beforeRestart = existsSync(execLog)
            ? readFileSync(execLog, 'utf8').split('\n').filter(Boolean).length
            : 0;
        const first = await restarted.transport.dispatch(restartMember, 'slow mutate restart', {
            dispatcher: restarted.dispatcher,
            fromId: 'operator',
            requestKey: 'e2e/restart',
            timeoutMs: 50,
        });
        await stopServe(bServe);
        bServe = startServe(bHome, bPort);
        if (!(await healthy(bPort))) throw new Error('install B did not restart for re-attach');
        const resumedTransport = (await transportFor(aHome, {}, counting)).transport;
        const resumed = await resumedTransport.runMessage(restartMember, first.messageId, { timeoutMs: 10_000 });
        const afterRestart = existsSync(execLog) ? readFileSync(execLog, 'utf8').split('\n').filter(Boolean).length : 0;
        record(
            'restart-reattach',
            'failure: B restarted mid-run',
            'dispatch(timeout=50ms) → stop/start B → runMessage',
            first.status === 'outcome-unknown' &&
                resumed.status === 'completed' &&
                asRecord(resumed)?.remoteBranch === REMOTE_BRANCH &&
                counting.sends === 1 &&
                afterRestart === beforeRestart + 1,
            `first=${first.status}; resumed=${resumed.status}; remoteBranch=${String(asRecord(resumed)?.remoteBranch)}; sends=${counting.sends}; worker turns=${beforeRestart}/${afterRestart}`,
        );

        const fetchHead = existsSync(join(aHome, '.git/FETCH_HEAD'));
        const branches = await run(['git', 'branch', '--show-current'], aHome);
        record(
            'no-fetch-or-merge',
            'R4',
            'inspect A .git/FETCH_HEAD and current branch',
            !fetchHead && branches.stdout === 'sp/sender-e2e',
            `FETCH_HEAD=${fetchHead}; branch=${branches.stdout}`,
        );

        const receipt = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            command: 'bun run a2a-two-install-e2e',
            a2aVersion: (await run(['a2a', 'version'], REPO_ROOT)).stdout.split('\n')[0],
            scratch,
            steps,
            passed: steps.every((step) => step.status === 'passed'),
        };
        writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
        for (const step of steps) console.log(`${step.status === 'passed' ? '✓' : '✗'} ${step.step}: ${step.evidence}`);
        return receipt.passed ? 0 : 1;
    } finally {
        execServer.kill('SIGTERM');
        await execServer.exited;
        await stopServe(bServe);
        if (keep) console.log(`kept scratch: ${scratch}`);
        else rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    try {
        process.exitCode = await runA2aTwoInstallE2e(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
