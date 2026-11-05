import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { createTempProject } from '../helpers';

/**
 * Task 1293 R3 — E2E receipt for the Grok Bot webhook-notify recipe.
 *
 * The recipe (docs/help/examples/grok-bot-notify.yaml) soft-runs a fixture target
 * workflow and POSTs the target's `spur workflow run --json` document to a routine
 * webhook. The leg produces a clean top-level run by clearing
 * SPUR_WORKFLOW_RUN_ACTIVE for exactly its probe (task 1293 Q&A — engine nested-run
 * refusal, 0610 R4, otherwise refuses any nested run).
 *
 * The CLI is invoked synchronously (spawnSync): a run lasts a few seconds and the
 * recipe run's summary JSON is the last stdout document.
 */

setDefaultTimeout(60_000);

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const EXAMPLE = join(REPO_ROOT, 'docs', 'help', 'examples', 'grok-bot-notify.yaml');
const FIXTURES = join(REPO_ROOT, 'apps', 'cli', 'tests', 'fixtures', 'grok-bot');

// `%` and `\` prove the key reaches the header verbatim — a key used as the printf format would not.
const KEY_SENTINEL = 'test-%s-key\\n';
const KEY_MSG = 'GROK_ROUTINE_KEY is not set';

interface SeenRequest {
    method: string;
    path: string;
    authorization: string | null;
    body: string;
}

let seen: SeenRequest[] = [];

const server = Bun.serve({
    port: 0,
    async fetch(req) {
        seen.push({
            method: req.method,
            path: new URL(req.url).pathname,
            authorization: req.headers.get('authorization'),
            body: await req.text(),
        });
        return new Response('{}', { status: 200 });
    },
});

const ROUTINE_URL = `http://127.0.0.1:${server.port}/hook`;

/** Temp bin dirs (source-local `spur` shim, R3: no global link) and project dirs; runs never touch the live `.spur/`. */
const tempDirs: string[] = [];

afterEach(() => {
    // Zero accumulated requests between scenarios.
    seen = [];
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function spawnRecipe(cwd: string, vars: Record<string, string>, env: Record<string, string>): Bun.Subprocess {
    const binDir = join(tmpdir(), `spur-recipe-bin-${crypto.randomUUID()}`);
    mkdirSync(binDir, { recursive: true });
    tempDirs.push(binDir);
    const script = `#!/bin/sh\nexec bun ${REPO_ROOT}/apps/cli/src/index.ts "$@"\n`;
    writeFileSync(join(binDir, 'spur'), script);
    chmodSync(join(binDir, 'spur'), 0o755);
    // Async spawn (not spawnSync): the webhook stub lives in THIS process, and a
    // synchronous wait would block its event loop so the child's POST could never
    // be served. It is awaited at the end of `runRecipe`.
    return Bun.spawn(
        [
            process.execPath,
            join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts'),
            'workflow',
            'run',
            EXAMPLE,
            '--run-id',
            `1293-recipe-${crypto.randomUUID()}`,
            '--vars',
            JSON.stringify(vars),
            '--json',
            '--no-logo',
        ],
        {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                ...getEnvVars(),
                PATH: `${binDir}:${getEnvVar('PATH') ?? ''}`,
                GROK_ROUTINE_URL: ROUTINE_URL,
                GROK_ROUTINE_KEY: KEY_SENTINEL,
                ...env,
            },
        },
    );
}

async function collect(process: Bun.Subprocess): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const stdout = await new Response(process.stdout as ReadableStream).text();
    const stderr = await new Response(process.stderr as ReadableStream).text();
    const exitCode = await process.exited;
    return { exitCode, stdout, stderr };
}

/** Run the recipe in a fresh temp project and return its stdio + exit code + project dir. */
async function runRecipe(
    target: string,
    env: Record<string, string>,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; cwd: string }> {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
    return { ...(await collect(spawnRecipe(cwd, { target: join(FIXTURES, target) }, env))), cwd };
}

/** The recipe's final summary JSON is the JSON document on stdout ({@link finalStatus}). */
interface RecipeSummary {
    status: string;
    finalState: string;
    runId: string;
}

function finalStatus(stdout: string): RecipeSummary {
    const start = stdout.indexOf('{');
    expect(start).toBeGreaterThanOrEqual(0);
    return JSON.parse(stdout.slice(start)) as RecipeSummary;
}

function runRecipeFile(cwd: string, name: string): string {
    return readFileSync(join(cwd, '.spur', 'memory', 'runs', name), 'utf8');
}

describe('grok-bot-notify recipe (heavy E2E, 1293)', () => {
    test('passing target: run done, exactly one authorized POST with the target status', async () => {
        const result = await runRecipe('pass.yaml', {});
        expect(result.exitCode).toBe(0);
        const summary = finalStatus(result.stdout);
        expect(summary.status).toBe('done');
        expect(summary.finalState).toBe('done');
        expect(seen.length).toBe(1);
        const post = seen[0] as SeenRequest;
        expect(post.method).toBe('POST');
        expect(post.path).toBe('/hook');
        expect(post.authorization).toBe(`Bearer ${KEY_SENTINEL}`);
        let body: { status?: string } = {};
        try {
            body = JSON.parse(post.body) as { status?: string };
        } catch {
            body = {};
        }
        expect(body.status).toBe('done');
        // (d) the key value never appears in the CLI's own streams…
        const streams = `${result.stdout}${result.stderr}`;
        expect(streams.includes(KEY_SENTINEL)).toBe(false);
        // …nor in the persisted run record.
        expect(runRecipeFile(result.cwd, `${summary.runId}.md`).includes(KEY_SENTINEL)).toBe(false);
    });

    test('failing target: run failed (failed-check), exactly one POST with body status failed', async () => {
        const result = await runRecipe('fail.yaml', {});
        const summary = finalStatus(result.stdout);
        expect(summary.status).toBe('failed');
        expect(summary.finalState).toBe('failed');
        expect(seen.length).toBe(1);
        expect(seen[0]?.method).toBe('POST');
        let body: { status?: string } = {};
        try {
            body = JSON.parse(seen[0]?.body ?? '') as { status?: string };
        } catch {
            body = {};
        }
        expect(body.status).toBe('failed');
    });

    test('routine key unset: run fails, names the missing key, stub receives zero requests', async () => {
        const result = await runRecipe('pass.yaml', { GROK_ROUTINE_KEY: '' });
        const summary = finalStatus(result.stdout);
        expect(summary.status).toBe('failed');
        const stderr = result.stderr;
        const runLog = runRecipeFile(result.cwd, `${summary.runId}.md`);
        expect(`${stderr}\n${runLog}`).toContain(KEY_MSG);
        expect(seen.length).toBe(0);
    });
});
