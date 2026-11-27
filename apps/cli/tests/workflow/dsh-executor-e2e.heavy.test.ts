import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

/**
 * Task 1458 R10/R11 — dsh as a dispatachable executor, proven on a real host.
 *
 * Two legs, both against the real `dsh` binary (no mock proves the NDJSON contract):
 *   leg 1 — dsh loads a named `sp-*` skill through the `skill` tool in a `--json` run;
 *   leg 2 — one bounded prompt runs through the `deepseek` executor via `spur agent run`
 *           and leaves a Spur run record naming the executor.
 *
 * Provenance: dsh 0.2.2-rc.1 (the version the `deepseek` capability row is verified
 * against); the model provider comes from the operator's own dsh profile — Spur reads and
 * stores no credential. Both legs write their receipt to
 * `.spur/run/e2e/dsh-executor-receipt.json`.
 *
 * Skip conditions are explicit: no `dsh` on PATH, or no installed `sp-*` skill to load.
 */

setDefaultTimeout(300_000);

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const CLI = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const RECEIPT = join(REPO_ROOT, '.spur', 'run', 'e2e', 'dsh-executor-receipt.json');
const SKILLS_ROOT = join(homedir(), '.agents', 'skills');
const SKILL_NAME = 'sp-brainstorm';

/** The one dsh event shape this E2E reads; other event types pass through untouched. */
interface DshEvent {
    type: string;
    tool?: string;
    callId?: string;
    input?: { name?: string };
    status?: string;
    sessionId?: string;
    reason?: { kind?: string };
}

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway git project: dsh resolves its workspace from it, Spur resolves its project layer. */
function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-e2e-'));
    tempDirs.push(dir);
    Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: dir });
    return dir;
}

/** Executor config that makes `--agent deepseek` dispatchable, with the attestation R6 requires. */
function writeExecutorConfig(cwd: string): void {
    mkdirSync(join(cwd, '.spur'), { recursive: true });
    writeFileSync(
        join(cwd, '.spur', 'config.yaml'),
        [
            'version: "1.2"',
            'name: dsh-e2e',
            'agent:',
            '  executors:',
            '    - name: deepseek',
            '      agent: deepseek',
            '      model: deepseek-chat',
            '      tier: standard',
            '      executionCapabilities:',
            '        version: 1',
            '        axes:',
            '          fsRead: { state: available, provenance: native-known }',
            '          fsWrite: { state: available, provenance: native-known }',
            '          processSpawn: { state: available, provenance: native-known }',
            '',
        ].join('\n'),
    );
}

async function run(command: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    // `getEnvVars()` IS the ambient environment (plus config-derived values) — the env-var-hygiene
    // rule forbids reading the raw environment in tests, and the child needs HOME/PATH for dsh.
    const env = getEnvVars() as Record<string, string>;
    // The suite preload skips both real config layers; this E2E needs the temp project's own
    // `.spur/config.yaml` to supply the `deepseek` executor, so drop only those two switches.
    delete env.SPUR_SKIP_PROJECT_CONFIG;
    delete env.SPUR_SKIP_GLOBAL_CONFIG;
    const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', env });
    const stdout = await new Response(child.stdout as ReadableStream).text();
    const stderr = await new Response(child.stderr as ReadableStream).text();
    return { code: await child.exited, stdout, stderr };
}

/** Parse an NDJSON stream, skipping any non-JSON banner line a CLI may print first. */
function parseEvents(stdout: string): DshEvent[] {
    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('{'))
        .flatMap((line) => {
            try {
                return [JSON.parse(line) as DshEvent];
            } catch {
                return [];
            }
        });
}

function dshVersion(): string {
    const probe = Bun.spawnSync(['dsh', '--version']);
    return probe.stdout.toString().trim();
}

function installedSpSkill(): string | null {
    if (!existsSync(SKILLS_ROOT)) return null;
    return (
        readdirSync(SKILLS_ROOT)
            .filter((name) => name.startsWith('sp-'))
            .sort()[0] ?? null
    );
}

const dshAvailable = Bun.which('dsh') !== null;
const skillAvailable = installedSpSkill() !== null;

// State the skip reason in the run output: a silent skip reads as a pass.
if (!dshAvailable) console.warn('dsh-executor E2E skipped: `dsh` is not on PATH');
else if (!skillAvailable) console.warn(`dsh-executor E2E skipped: no sp-* skill under ${SKILLS_ROOT}`);

describe('dsh executor E2E (heavy, 1458)', () => {
    test.skipIf(!dshAvailable || !skillAvailable)(
        'dsh loads a named sp skill through the skill tool, then a Spur task runs through the deepseek executor',
        async () => {
            const cwd = tempProject();
            writeExecutorConfig(cwd);

            // ── Leg 1 (R10): skill discovery, asserted from the NDJSON stream ──────────────
            const skillRun = await run(
                [
                    'dsh',
                    '--profile',
                    'headless',
                    '--json',
                    '--permission-mode',
                    'workspace-write',
                    '--approval-policy',
                    'never',
                    '--',
                    `Use the skill tool to load the skill named ${SKILL_NAME}, then reply with the first heading line of that skill's file.`,
                ],
                cwd,
            );
            expect(skillRun.code).toBe(0);

            const events = parseEvents(skillRun.stdout);
            const skillCall = events.find((event) => event.type === 'tool_call' && event.tool === 'skill');
            expect(skillCall?.input?.name).toBe(SKILL_NAME);
            // The same call must come back non-error: dsh reports a completed tool_result.
            const skillResult = events.find(
                (event) => event.type === 'tool_result' && event.callId === skillCall?.callId,
            );
            expect(skillResult?.status).toBe('completed');
            const final = events.find((event) => event.type === 'final');
            expect(final?.reason?.kind).toBe('completed');

            // ── Leg 2 (R11): a bounded run through the deepseek executor ───────────────────
            const agentRun = await run(
                [
                    process.execPath,
                    CLI,
                    '--no-logo',
                    'agent',
                    'run',
                    'Reply with exactly one word: ready',
                    '--agent',
                    'deepseek',
                    '--json',
                ],
                cwd,
            );
            expect(agentRun.code).toBe(0);
            const result = JSON.parse(agentRun.stdout.slice(agentRun.stdout.indexOf('{'))) as {
                exitCode?: number;
                resolved?: { executor?: string; agent?: string };
            };
            expect(result.exitCode).toBe(0);
            expect(result.resolved?.executor).toBe('deepseek');
            expect(result.resolved?.agent).toBe('deepseek');

            // The durable Spur run record: `.spur/memory/runs/<runId>.md`, headed with the executor.
            const runsDir = join(cwd, '.spur', 'memory', 'runs');
            const records = readdirSync(runsDir).filter((name) => name.endsWith('.md'));
            expect(records.length).toBeGreaterThan(0);
            const recordName = records.sort().at(-1) as string;
            const runId = recordName.replace(/\.md$/, '');
            const record = readFileSync(join(runsDir, recordName), 'utf8');
            expect(record.split('\n')[0]).toContain('spur agent run');
            expect(record.split('\n')[0]).toContain('deepseek');
            expect(record.split('\n')[0]).toContain(runId);

            // ── Receipt (repeatable artifact) ─────────────────────────────────────────────
            mkdirSync(join(REPO_ROOT, '.spur', 'run', 'e2e'), { recursive: true });
            writeFileSync(
                RECEIPT,
                `${JSON.stringify(
                    {
                        task: '1458',
                        dshVersion: dshVersion(),
                        skill: { name: skillCall?.input?.name, status: skillResult?.status },
                        sessionId: final?.sessionId ?? null,
                        runId,
                        executor: result.resolved?.executor,
                        runRecord: `.spur/memory/runs/${recordName}`,
                        capturedAt: new Date().toISOString(),
                    },
                    null,
                    2,
                )}\n`,
            );
            expect(existsSync(RECEIPT)).toBe(true);
        },
    );
});
