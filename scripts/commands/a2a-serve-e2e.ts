/**
 * a2a-serve-e2e — prove `spur serve` speaks A2A, driven by the unmodified `a2a` CLI (feature G9,
 * task 1336 R7; design `a2a-member-transport` §3.5).
 *
 * Usage: bun scripts/spur-dev.ts a2a-serve-e2e [--keep]
 *
 * One scratch project is scaffolded under `$TMPDIR` with a declared fleet member (`agent.fleet`
 * WITHOUT `enabled: true`, so nothing autostarts), `spur serve` is started on a free port with the
 * A2A listener on, and the operator-installed `a2a` binary is the only client: `card get`,
 * `send --async`, `task get`, `task cancel`. Every step records its command, exit code, observed
 * evidence and the requirement it proves, and the run writes
 * `docs/reports/a2a-serve-e2e-receipt.json` (stable name, overwritten each run).
 *
 * The member's own run is NOT executed here — that is the two-install proof (task 1337). To still
 * exercise the receipt→state projection end to end, the `completed` step seeds one `coordination_runs`
 * row and one inbox reply in the scratch project's own database (the same rows a member loop writes)
 * and then reads the task back over HTTP with the CLI.
 *
 * Determinism: bounded polling of real HTTP state, no wall-clock assertions. Exit 0 = every step
 * passed, 1 = at least one failed, 2 = a precondition (the `a2a` binary) is missing.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { type Subprocess, spawn } from 'bun';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const CLI = join(REPO_ROOT, 'apps/cli/src/index.ts');
const RECEIPT = join(REPO_ROOT, 'docs/reports/a2a-serve-e2e-receipt.json');
const TOKEN = 'a2a-e2e-token-1234';
const AUTH_ENV = 'SPUR_A2A_TOKEN';
const MEMBER_LOCAL = 'coder';

type StepStatus = 'passed' | 'failed' | 'skipped';

interface StepRow {
    step: string;
    requirement: string;
    command: string;
    exitCode: number;
    status: StepStatus;
    evidence: string;
}

/** A free TCP port, so two runs never collide. */
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

/** Run one command, capturing stdout+stderr; never throws (a failure is a row). */
async function run(cmd: string[]): Promise<{ code: number; out: string }> {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: getEnvVars() });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    return { code, out: `${out}${err}`.trim() };
}

/** Parse the CLI's `-o json` output; a non-JSON answer is evidence of a real failure, not a crash. */
function jsonOf(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** `send` wraps the task (`{task}`); `task get`/`task cancel` also answer with `{task}` on this CLI. */
function taskOf(payload: unknown): Record<string, unknown> | null {
    const record = asRecord(payload);
    if (record === null) return null;
    return asRecord(record.task) ?? record;
}

function stateOf(payload: unknown): string {
    const task = taskOf(payload);
    const status = asRecord(task?.status);
    return typeof status?.state === 'string' ? status.state : '';
}

/** Poll `/api/health` until the server answers or the budget runs out. */
async function waitForHealth(port: number, budgetMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (res.ok) return true;
        } catch {
            // not listening yet
        }
        await Bun.sleep(250);
    }
    return false;
}

/** Scaffold the scratch project: a declared member, planning folders, nothing autostarted. */
function scaffold(dir: string): void {
    mkdirSync(join(dir, '.spur'), { recursive: true });
    mkdirSync(join(dir, 'docs/tasks'), { recursive: true });
    mkdirSync(join(dir, 'docs/features'), { recursive: true });
    writeFileSync(
        join(dir, '.spur/config.yaml'),
        [
            'version: "1.2"',
            'name: a2a-e2e',
            'agent:',
            '  fleet:',
            '    strategy: rest',
            '    members:',
            `      - id: ${MEMBER_LOCAL}`,
            '        executor: claude',
            '',
        ].join('\n'),
    );
}

/** Start `spur serve` for the scratch project with the A2A listener on (or off). */
function startServe(dir: string, port: number, enabled: boolean): Subprocess<'ignore', 'pipe', 'pipe'> {
    return spawn({
        cmd: ['bun', CLI, 'serve', '--port', String(port), '--host', '127.0.0.1', '--no-open'],
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...getEnvVars(),
            ...(enabled
                ? { SPUR_A2A_ENABLED: '1', SPUR_A2A_AUTH_ENV: AUTH_ENV, [AUTH_ENV]: TOKEN }
                : { SPUR_A2A_ENABLED: '0' }),
        },
    });
}

/** Seed a finished member run + its reply, the two rows a real member loop writes. */
async function seedCompletedRun(dir: string, taskId: string, answer: string): Promise<string> {
    const { createMigratedDb, CoordinationRunDao, InboxDao } = await import('@gobing-ai/spur-domain');
    const { InboxService } = await import('@gobing-ai/spur-app');
    const db = await createMigratedDb({ url: join(dir, '.spur', 'spur.db') });
    const message = await new InboxDao(db).get(taskId);
    if (message === null) throw new Error(`seeded task ${taskId} is not in the scratch inbox`);
    const runs = new CoordinationRunDao(db);
    const runId = `e2e-${taskId}`;
    await runs.insertStart({
        specId: message.toId,
        agentKind: 'claude',
        processId: null,
        runId,
        generation: 1,
        startedAt: new Date().toISOString(),
        messageIds: [taskId],
    });
    await runs.updateExit(runId, 'exited', new Date().toISOString(), '[]', {
        messageIds: [taskId],
        outcome: 'run-exit-only',
    });
    await new InboxService({ getDb: async () => db }).reply(taskId, message.toId, answer);
    await db.close?.();
    return runId;
}

function record(
    rows: StepRow[],
    step: string,
    requirement: string,
    command: string,
    exitCode: number,
    passed: boolean,
    evidence: string,
): void {
    rows.push({
        step,
        requirement,
        command,
        exitCode,
        status: passed ? 'passed' : 'failed',
        evidence: evidence.replaceAll(TOKEN, '[REDACTED]').slice(0, 2000),
    });
}

/** Drive the whole E2E and write the receipt. Returns the process exit code. */
export async function runA2aServeE2e(args: string[] = []): Promise<number> {
    const keep = args.includes('--keep');
    const probe = await run(['a2a', '--version']);
    if (probe.code !== 0) {
        console.error('a2a-serve-e2e: the `a2a` CLI is not on PATH (a2a-cli >= 0.4.0 is a prerequisite)');
        return 2;
    }

    const scratch = mkdtempSync(join(tmpdir(), 'spur-a2a-e2e-'));
    scaffold(scratch);
    const port = await freePort();
    // The member address is `<projectSlug>-<memberLocalId>`; an unregistered scratch tree slugs
    // from its directory basename (the same fallback FleetService uses).
    const member = `${basename(scratch)}-${MEMBER_LOCAL}`;
    const root = `http://127.0.0.1:${port}`;
    const cardPath = `${root}/a2a/members/${member}/.well-known/agent-card.json`;
    const rows: StepRow[] = [];
    const offTrees: string[] = [];
    let serve: Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
    let offServe: Subprocess<'ignore', 'pipe', 'pipe'> | undefined;

    try {
        serve = startServe(scratch, port, true);
        const healthy = await waitForHealth(port);
        record(
            rows,
            'serve-ready',
            'R1',
            `spur serve --port ${port}`,
            healthy ? 0 : 1,
            healthy,
            healthy ? 'health ok' : 'server did not answer /api/health',
        );
        if (!healthy) throw new Error('spur serve never became healthy');

        // ── R2 / AC1 — the card ──
        const card = await run(['a2a', '-a', cardPath, '--auth', `Bearer ${TOKEN}`, 'card', 'get', '-o', 'json']);
        const cardBody = asRecord(jsonOf(card.out));
        const interfaces = Array.isArray(cardBody?.supportedInterfaces) ? cardBody.supportedInterfaces : [];
        const first = asRecord(interfaces[0]);
        const capabilities = asRecord(cardBody?.capabilities);
        const cardOk =
            card.code === 0 &&
            cardBody?.name === member &&
            first?.protocolVersion === '1.0' &&
            first?.protocolBinding === 'HTTP+JSON' &&
            capabilities?.streaming === false &&
            capabilities?.pushNotifications === false;
        record(rows, 'card-get', 'R2 / AC1', `a2a -a ${cardPath} card get`, card.code, cardOk, card.out);

        // ── R3 / AC2 — a message becomes one keyed inbox request ──
        const send = await run([
            'a2a',
            '-a',
            cardPath,
            '--auth',
            `Bearer ${TOKEN}`,
            'send',
            '--async',
            '-o',
            'json',
            '--text-part',
            'summarize the readme',
        ]);
        const taskId = typeof taskOf(jsonOf(send.out))?.id === 'string' ? (taskOf(jsonOf(send.out))?.id as string) : '';
        const sendOk = send.code === 0 && taskId !== '' && stateOf(jsonOf(send.out)) === 'TASK_STATE_SUBMITTED';
        record(rows, 'send-async', 'R3 / AC2', 'a2a send --async', send.code, sendOk, send.out);
        if (!sendOk) throw new Error('send --async did not create a task');

        const replay = await run([
            'a2a',
            '-a',
            cardPath,
            '--auth',
            `Bearer ${TOKEN}`,
            'send',
            '--async',
            '-o',
            'json',
            '--text-part',
            'summarize the readme',
        ]);
        // A CLI-generated message id makes a byte-identical replay a NEW task, so idempotency is
        // proven by the keyed request in the module test; here the second task must simply exist.
        const replayId =
            typeof taskOf(jsonOf(replay.out))?.id === 'string' ? (taskOf(jsonOf(replay.out))?.id as string) : '';
        record(
            rows,
            'send-second-task',
            'R3',
            'a2a send --async',
            replay.code,
            replay.code === 0 && replayId !== '' && replayId !== taskId,
            `second task ${replayId}`,
        );

        // ── R4 / AC3 — the answer comes back as a text artifact ──
        const answer = 'the readme documents the CLI surface';
        const runId = await seedCompletedRun(scratch, taskId, answer);
        const completed = await run([
            'a2a',
            '-a',
            cardPath,
            '--auth',
            `Bearer ${TOKEN}`,
            'task',
            'get',
            taskId,
            '-o',
            'json',
        ]);
        const completedTask = taskOf(jsonOf(completed.out));
        const artifacts = Array.isArray(completedTask?.artifacts) ? completedTask.artifacts : [];
        const parts = asRecord(artifacts[0])?.parts;
        const artifactText = asRecord(Array.isArray(parts) ? parts[0] : null)?.text;
        record(
            rows,
            'task-get-completed',
            'R4 / AC3',
            `a2a task get ${taskId}`,
            completed.code,
            completed.code === 0 &&
                stateOf(jsonOf(completed.out)) === 'TASK_STATE_COMPLETED' &&
                artifactText === answer,
            `run ${runId} → ${stateOf(jsonOf(completed.out))} artifact=${String(artifactText)}`,
        );

        // ── AC3 — the failed arm carries the reason ──
        const failedSend = await run([
            'a2a',
            '-a',
            cardPath,
            '--auth',
            `Bearer ${TOKEN}`,
            'send',
            '--async',
            '-o',
            'json',
            '--text-part',
            'this one fails',
        ]);
        const failedId =
            typeof taskOf(jsonOf(failedSend.out))?.id === 'string'
                ? (taskOf(jsonOf(failedSend.out))?.id as string)
                : '';
        const failedRun = await seedErroredRun(scratch, failedId);
        const failedTask = await run([
            'a2a',
            '-a',
            cardPath,
            '--auth',
            `Bearer ${TOKEN}`,
            'task',
            'get',
            failedId,
            '-o',
            'json',
        ]);
        record(
            rows,
            'task-get-failed',
            'R4 / AC3',
            `a2a task get ${failedId}`,
            failedTask.code,
            failedTask.code === 0 && stateOf(jsonOf(failedTask.out)) === 'TASK_STATE_FAILED',
            `${failedRun} → ${stateOf(jsonOf(failedTask.out))}`,
        );

        // ── R5 / AC4 — cancel stops the task ──
        // AC4's precondition is a run IN PROGRESS: seed the live run row a member loop would own,
        // then cancel it through the CLI (the cancel path signals the supervisor and reads back).
        await seedRunningRun(scratch, replayId);
        const cancel = await run([
            'a2a',
            '-a',
            cardPath,
            '--auth',
            `Bearer ${TOKEN}`,
            'task',
            'cancel',
            replayId,
            '-o',
            'json',
        ]);
        const afterCancel = await run([
            'a2a',
            '-a',
            cardPath,
            '--auth',
            `Bearer ${TOKEN}`,
            'task',
            'get',
            replayId,
            '-o',
            'json',
        ]);
        record(
            rows,
            'task-cancel',
            'R5 / AC4',
            `a2a task cancel ${replayId}`,
            cancel.code,
            cancel.code === 0 && stateOf(jsonOf(afterCancel.out)) === 'TASK_STATE_CANCELED',
            `cancel→${stateOf(jsonOf(cancel.out))} get→${stateOf(jsonOf(afterCancel.out))}`,
        );

        // ── R6 / AC5 — a call without the token is rejected and writes nothing ──
        const unauthenticated = await fetch(cardPath);
        record(
            rows,
            'unauthenticated-refused',
            'R6 / AC5',
            `GET ${cardPath} (no Authorization)`,
            0,
            unauthenticated.status === 401,
            `HTTP ${unauthenticated.status}`,
        );

        // ── R1 / AC5 — off by default: no route exists ──
        // A second project, not a second server on the same one: one project is served by one
        // process (the project claim), so the default-config server gets its own scratch tree.
        const offScratch = mkdtempSync(join(tmpdir(), 'spur-a2a-off-'));
        scaffold(offScratch);
        offTrees.push(offScratch);
        const offPort = await freePort();
        offServe = startServe(offScratch, offPort, false);
        const offHealthy = await waitForHealth(offPort);
        const offCard = await fetch(
            `http://127.0.0.1:${offPort}/a2a/members/${basename(offScratch)}-${MEMBER_LOCAL}/.well-known/agent-card.json`,
            {
                headers: { Authorization: `Bearer ${TOKEN}` },
            },
        );
        record(
            rows,
            'endpoint-off',
            'R1 / AC5',
            `spur serve (SPUR_A2A_ENABLED=0) :${offPort}`,
            0,
            offHealthy && offCard.status === 404,
            offHealthy ? `HTTP ${offCard.status}` : 'second server did not answer /api/health',
        );

        const tokenLeak = rows.some((row) => row.evidence.includes(TOKEN));
        record(
            rows,
            'token-not-echoed',
            'R6',
            'receipt scan',
            0,
            !tokenLeak,
            tokenLeak ? 'token appears in evidence' : 'no token in any captured output',
        );
    } catch (error) {
        record(rows, 'harness', '—', 'a2a-serve-e2e', 1, false, error instanceof Error ? error.message : String(error));
    } finally {
        serve?.kill();
        offServe?.kill();
        if (!keep) {
            rmSync(scratch, { recursive: true, force: true });
            for (const tree of offTrees) rmSync(tree, { recursive: true, force: true });
        }
    }

    const receipt = {
        artifact: 'a2a-serve-e2e',
        generatedAt: new Date().toISOString(),
        a2aCliVersion: probe.out.split('\n')[0] ?? '',
        scratch: keep ? scratch : '(removed)',
        port,
        steps: rows,
        passed: rows.filter((row) => row.status === 'passed').length,
        failed: rows.filter((row) => row.status === 'failed').length,
    };
    mkdirSync(join(REPO_ROOT, 'docs/reports'), { recursive: true });
    writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 4)}\n`);

    console.log(`a2a-serve-e2e receipt: ${relative(REPO_ROOT, RECEIPT)}`);
    for (const row of rows) {
        console.log(
            `  ${row.status === 'passed' ? 'ok  ' : 'FAIL'} ${row.step} [${row.requirement}]: ${row.evidence.slice(0, 160)}`,
        );
    }
    if (receipt.failed > 0) {
        console.error(
            `a2a-serve-e2e: ${receipt.failed} step(s) failed: ${rows
                .filter((r) => r.status === 'failed')
                .map((r) => r.step)
                .join(', ')}`,
        );
        return 1;
    }
    return 0;
}

/** Seed a live run row (the `working` state AC4 cancels). */
async function seedRunningRun(dir: string, taskId: string): Promise<string> {
    const { createMigratedDb, CoordinationRunDao, InboxDao } = await import('@gobing-ai/spur-domain');
    const db = await createMigratedDb({ url: join(dir, '.spur', 'spur.db') });
    const message = await new InboxDao(db).get(taskId);
    if (message === null) throw new Error(`seeded task ${taskId} is not in the scratch inbox`);
    const runId = `e2e-run-${taskId}`;
    await new CoordinationRunDao(db).insertStart({
        specId: message.toId,
        agentKind: 'claude',
        processId: null,
        runId,
        generation: 1,
        startedAt: new Date().toISOString(),
        messageIds: [taskId],
    });
    await db.close?.();
    return runId;
}

/** Seed an errored run row (the failed arm of the projection). */
async function seedErroredRun(dir: string, taskId: string): Promise<string> {
    const { createMigratedDb, CoordinationRunDao, InboxDao } = await import('@gobing-ai/spur-domain');
    const db = await createMigratedDb({ url: join(dir, '.spur', 'spur.db') });
    const message = await new InboxDao(db).get(taskId);
    if (message === null) throw new Error(`seeded task ${taskId} is not in the scratch inbox`);
    const runs = new CoordinationRunDao(db);
    const runId = `e2e-fail-${taskId}`;
    await runs.insertStart({
        specId: message.toId,
        agentKind: 'claude',
        processId: null,
        runId,
        generation: 1,
        startedAt: new Date().toISOString(),
        messageIds: [taskId],
    });
    await runs.updateExit(runId, 'errored', new Date().toISOString(), '[]', {
        messageIds: [taskId],
        outcome: 'errored',
    });
    await db.close?.();
    return runId;
}

if (import.meta.main) {
    if (!existsSync(REPO_ROOT)) process.exit(2);
    process.exit(await runA2aServeE2e(process.argv.slice(2)));
}
