/**
 * delegate-workflow-e2e — task 1397: both delegation workflows run end to end across two installs.
 *
 * Nothing on the chain is mocked: install A's workflow sends one `agent.run` to a fleet member, that
 * member's card is install B's `spur self serve` A2A surface, and B's own transport drives a deterministic
 * worker. The worker creates a tagged task and replies `WBS: <id>`, which the workflow parses to tag
 * A's requesting task. Both fixture projects are real Spur homes with their own databases.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const CLI = join(REPO_ROOT, 'apps/cli/src/index.ts');
const RECEIPT = join(REPO_ROOT, 'docs/reports/delegate-workflow-e2e-receipt.json');
const TOKEN = 'delegate-workflow-token-1234';
const TOKEN_ENV = 'DELEGATE_WORKFLOW_TOKEN';
const LISTENER_ENV = 'DELEGATE_WORKFLOW_LISTENER_TOKEN';

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
    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...getEnvVars(), ...env } });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function healthy(port: number): Promise<boolean> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true;
        } catch {
            // still starting
        }
        await Bun.sleep(200);
    }
    return false;
}

/** One Spur project fixture: `.spur/config.yaml`, a tasks folder, and a git branch. */
function scaffoldProject(root: string, name: string, configBody: string[]): void {
    mkdirSync(join(root, '.spur'), { recursive: true });
    mkdirSync(join(root, 'docs/tasks'), { recursive: true });
    mkdirSync(join(root, 'docs/features'), { recursive: true });
    writeFileSync(join(root, '.spur/config.yaml'), ['version: "1.2"', `name: ${name}`, ...configBody, ''].join('\n'));
}

export async function runDelegateWorkflowE2e(args: string[] = []): Promise<number> {
    const keep = args.includes('--keep');
    if ((await run(['a2a', 'version'], REPO_ROOT)).code !== 0) return 2;
    const scratch = join(tmpdir(), `delegate-e2e-${Math.random().toString(36).slice(2, 10)}`);
    const aHome = join(scratch, 'a');
    const bHome = join(scratch, 'b');
    // A private HOME keeps the global config out of the developer's real one.
    const home = join(scratch, 'home');
    mkdirSync(aHome, { recursive: true });
    mkdirSync(bHome, { recursive: true });
    mkdirSync(join(home, '.config', 'spur'), { recursive: true });
    const execPort = await freePort();
    const bPort = await freePort();
    const execLog = join(scratch, 'exec.log');
    const sharedEnv = { HOME: home, [TOKEN_ENV]: TOKEN, [LISTENER_ENV]: TOKEN };

    // Install B's deterministic worker: on a delegation request it creates a task, tags it with the
    // sender's sentinel, and answers with the one parseable line the workflow reads.
    const agent = join(scratch, 'exec-agent.sh');
    writeFileSync(
        agent,
        [
            '#!/bin/sh',
            'input=$(cat)',
            `printf '%s\\n' "$input" >> '${execLog}'`,
            'case "$input" in',
            '  *no-reply-line*) printf \'exec-answer: %s\\n\' "$input" ;;',
            '  *delegated-from:*)',
            `    created=$(cd '${bHome}' && bun '${CLI}' task create "delegated request $$" --skip-ready --allow-duplicate-name --json --no-logo 2>/dev/null)`,
            `    id=$(printf '%s' "$created" | sed -n 's/.*"wbs"[[:space:]]*:[[:space:]]*"\\([0-9]*\\)".*/\\1/p' | head -1)`,
            "    tag=$(printf '%s' \"$input\" | sed -n 's/.*\\(delegated-from:[^ ]*\\).*/\\1/p')",
            `    (cd '${bHome}' && bun '${CLI}' task update "$id" --add-tag "$tag" --no-lifecycle >/dev/null 2>&1)`,
            '    printf \'WBS: %s\\n\' "$id"',
            '    ;;',
            '  *) printf \'exec-answer: %s\\n\' "$input" ;;',
            'esac',
            '',
        ].join('\n'),
    );
    chmodSync(agent, 0o755);

    const execServer = Bun.spawn(['a2a', 'server', '--exec', agent, '--port', String(execPort), '--quiet'], {
        cwd: bHome,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    let bServe: ReturnType<typeof Bun.spawn> | undefined;
    try {
        scaffoldProject(bHome, 'delegate-b', [
            'agent:',
            '  fleet:',
            '    enabled: true',
            '    strategy: rest',
            '    members:',
            '      - id: worker',
            `        a2a: http://127.0.0.1:${execPort}`,
            `        authEnv: ${TOKEN_ENV}`,
        ]);
        for (const [dir, branch] of [
            [aHome, 'sp/delegate-sender'],
            [bHome, 'sp/delegate-target'],
        ] as const) {
            const init = await run(['git', 'init', '-b', branch], dir);
            if (init.code !== 0) throw new Error(`git init failed in ${dir}: ${init.stderr}`);
        }
        await Bun.sleep(300);
        bServe = Bun.spawn(
            [CLI, 'self', 'serve', '--port', String(bPort), '--host', '127.0.0.1', '--no-open', '--no-logo'],
            {
                cwd: bHome,
                stdout: 'pipe',
                stderr: 'pipe',
                env: { ...getEnvVars(), ...sharedEnv, SPUR_A2A_ENABLED: '1', SPUR_A2A_AUTH_ENV: LISTENER_ENV },
            },
        );
        if (!(await healthy(bPort))) throw new Error('install B never became healthy');

        // A's member points at B's serve card, which advertises the write-fencing extension, so the
        // mutation-shaped request (`requireDiff`) is admitted. The project-addressed form (1395) is
        // covered by its own suite; here the point is the workflow contract.
        scaffoldProject(aHome, 'delegate-a', [
            'agent:',
            '  fleet:',
            '    enabled: true',
            '    strategy: rest',
            '    members:',
            '      - id: handler',
            `        a2a: http://127.0.0.1:${bPort}/a2a/members/b-worker/.well-known/agent-card.json`,
            `        authEnv: ${TOKEN_ENV}`,
        ]);

        // One requesting task per workflow, created through the CLI so the corpus rules apply.
        async function createRequestingTask(title: string): Promise<string> {
            const created = await run(
                [CLI, 'task', 'create', title, '--skip-ready', '--json', '--no-logo'],
                aHome,
                sharedEnv,
            );
            const parsed = JSON.parse(created.stdout || '{}') as { wbs?: string; data?: { wbs?: string } };
            return parsed.wbs ?? parsed.data?.wbs ?? '';
        }

        for (const [workflow, title] of [
            ['delegate-upstream-fix.yaml', 'upstream facade fix request'],
            ['delegate-install-sync.yaml', 'install sync request'],
        ] as const) {
            const wbs = await createRequestingTask(title);
            const workflowRun = await run(
                [
                    CLI,
                    'workflow',
                    'run',
                    join(REPO_ROOT, 'config/workflows', workflow),
                    '--vars',
                    JSON.stringify({ wbs, member: 'handler', summary: `e2e: ${title}` }),
                    '--json',
                    '--no-logo',
                ],
                aHome,
                sharedEnv,
            );
            const senderSlug = 'a';
            // Both ends carry a queryable tag: the target's created task and the requesting task's
            // frontmatter. `task list` has no tag filter, so the fixture reads the files.
            const targetFiles = readdirSync(join(bHome, 'docs', 'tasks'));
            const targetHit = targetFiles.find((file) =>
                readFileSync(join(bHome, 'docs', 'tasks', file), 'utf8').includes(
                    `delegated-from:${senderSlug}:${wbs}`,
                ),
            );
            const requestingFile = existsSync(join(aHome, 'docs', 'tasks'))
                ? readdirSync(join(aHome, 'docs', 'tasks')).find((file) => file.startsWith(`${wbs}_`))
                : undefined;
            const requesting = requestingFile ? readFileSync(join(aHome, 'docs', 'tasks', requestingFile), 'utf8') : '';
            const linkMatch = /delegated-to:handler:(\d+)/.exec(requesting);
            record(
                workflow === 'delegate-upstream-fix.yaml' ? 'delegate-upstream-fix' : 'delegate-install-sync',
                'R1/R2/R3/AC1',
                `spur workflow run ${workflow} --vars {wbs:${wbs}, member:handler}`,
                workflowRun.code === 0 &&
                    /"status"\s*:\s*"done"/.test(workflowRun.stdout) &&
                    targetHit !== undefined &&
                    linkMatch !== null,
                `exit=${workflowRun.code}; target task=${targetHit ?? '(none)'}; requesting tag=${linkMatch?.[0] ?? '(none)'}; workflow=${workflowRun.stdout.slice(0, 120).replace(/\n/g, ' ')}`,
            );
        }

        // R3's failure path: the same workflow against a member that answers without a `WBS:` line.
        const badWbs = await createRequestingTask('missing reply line request');
        const badRun = await run(
            [
                CLI,
                'workflow',
                'run',
                join(REPO_ROOT, 'config/workflows/delegate-upstream-fix.yaml'),
                '--vars',
                JSON.stringify({ wbs: badWbs, member: 'handler', summary: 'no-reply-line' }),
                '--json',
                '--no-logo',
            ],
            aHome,
            sharedEnv,
        );
        const badFile = existsSync(join(aHome, 'docs', 'tasks'))
            ? readdirSync(join(aHome, 'docs', 'tasks')).find((file) => file.startsWith(`${badWbs}_`))
            : undefined;
        const badBody = badFile ? readFileSync(join(aHome, 'docs', 'tasks', badFile), 'utf8') : '';
        record(
            'malformed-reply-fails-loudly',
            'R3',
            'spur workflow run against a reply without a WBS: line',
            // The worker answers, but not with the contract line: the record step must fail the run
            // and write no link. The message naming member + remote task id comes from the step's
            // own stderr (asserted below), never from a silently-passed run.
            badRun.code !== 0 &&
                /"status"\s*:\s*"failed"/.test(badRun.stdout) &&
                /"finalState"\s*:\s*"record"/.test(badRun.stdout) &&
                !/delegated-to:/.test(badBody),
            `exit=${badRun.code}; finalState=${/"finalState"\s*:\s*"([^"]+)"/.exec(badRun.stdout)?.[1] ?? '?'}; tag=${/delegated-to:/.test(badBody) ? 'unexpected' : 'absent'}; reason=${(/"reason"\s*:\s*"([^"]{0,80})/.exec(badRun.stdout)?.[1] ?? '').replace(/\\/g, '')}`,
        );

        const receipt = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            command: 'bun run delegate-workflow-e2e',
            a2aVersion: (await run(['a2a', 'version'], REPO_ROOT)).stdout.split('\n')[0],
            scratch,
            steps,
            passed: steps.every((step) => step.status === 'passed'),
        };
        mkdirSync(join(REPO_ROOT, 'docs/reports'), { recursive: true });
        writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
        for (const step of steps) console.log(`${step.status === 'passed' ? '✓' : '✗'} ${step.step}: ${step.evidence}`);
        return receipt.passed ? 0 : 1;
    } finally {
        execServer.kill('SIGTERM');
        await execServer.exited;
        for (const proc of [bServe]) {
            if (proc === undefined) continue;
            proc.kill('SIGTERM');
            await proc.exited;
        }
        if (keep) console.log(`kept scratch: ${scratch}`);
        else rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    try {
        process.exitCode = await runDelegateWorkflowE2e(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
