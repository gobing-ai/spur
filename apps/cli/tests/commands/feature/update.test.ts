/**
 * Thin-wrapper integration tests for apps/cli/src/commands/feature.ts.
 * Behavioral tests for FeatureService live in
 * packages/app/tests/services/feature-service.test.ts.
 *
 * These exercise the `spur feature` verb surface through the real `main()`
 * entry point: golden paths, the `--json` envelope, status/priority filters,
 * and exit codes 0/1/2 (design §7.2, §10).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    // Throwaway root outside the repo tree: a nested `.git/` inside the checkout is both dirt in
    // `git status` when cleanup is skipped and unwritable under a sandboxed run.
    cwd = mkdtempSync(join(tmpdir(), 'spur-feature-test-'));
    await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
    // Real repos ignore `.spur/` — keeps recorded receipts out of the digest tree.
    writeFileSync(join(cwd, '.gitignore'), '.spur/\n');
    // Fixture commits HEAD first so `git read-tree HEAD` resolves for tree-digest paths.
    const init = Bun.spawnSync(
        [
            'sh',
            '-c',
            'git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -q -m init',
        ],
        { cwd },
    );
    if (init.exitCode !== 0) throw new Error(`fixture git init failed: ${init.stderr.toString()}`);
}, 20000);

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

/** The feature ID from the `feature create` confirmation line. */
function createdId(output: CapturedOutput): string {
    const msg = output.messages.find((m) => m.startsWith('Created feature'));
    if (msg === undefined) throw new Error(`no "Created feature" line in: ${output.messages.join(' | ')}`);
    const id = msg.replace('Created feature ', '').split(':')[0]?.trim();
    if (!id) throw new Error(`could not parse id from: ${msg}`);
    return id;
}

// ── 1247: one sync completes active → verifying → done on the onEnter's PASS (D66 R4) ──────────
const SYNC_REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..', '..');

const SYNC_CLI_ENTRY = join(SYNC_REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');

const SYNC_FIXTURE_TIMEOUT_MS = 60_000;

interface SyncFixture {
    root: string;
    /** One line per feature-verification pass — the verifying onEnter's call count. */
    callsLog: string;
}

const syncFeatureBody = (id: string, name: string, rows: ReadonlyArray<[string, string, string]>): string =>
    [
        '---',
        'schema_version: 1',
        `id: "${id}"`,
        `name: "${name}"`,
        'status: active',
        'priority: P2',
        'created_at: 2026-10-18T00:00:00.000Z',
        'updated_at: 2026-10-18T00:00:00.000Z',
        '---',
        '',
        `# ${id}: ${name}`,
        '',
        '## Goal',
        '',
        'Drive feature sync through the verifying entry.',
        '',
        '## Scope',
        '',
        'In: fixture',
        'Out: nothing',
        '',
        '## Acceptance Criteria',
        '',
        '- [ ] fixture item',
        '',
        '## Tasks',
        '',
        '| WBS | Task | Status |',
        '| --- | ---- | ------ |',
        ...rows.map(([wbs, task, status]) => `| ${wbs} | ${task} | ${status} |`),
        '',
        '## Notes',
        '',
        'Fixture.',
    ].join('\n');

const syncTaskBody = (wbs: string, status: string, featureId: string): string =>
    [
        '---',
        'schema_version: 1',
        `wbs: "${wbs}"`,
        `name: "Task ${wbs}"`,
        `status: ${status}`,
        `feature_id: "${featureId}"`,
        'created_at: 2026-10-18T00:00:00.000Z',
        'updated_at: 2026-10-18T00:00:00.000Z',
        '---',
        '',
        `# ${wbs}: Task ${wbs}`,
        '',
        '### Solution',
        '',
        'Done.',
    ].join('\n');

/**
 * A throwaway project holding F1 (one done + one cancelled task) and a wip sibling G1, plus a stub
 * `spur` that decides the feature-verification pass (`spur self exec check-feature`) and logs every
 * invocation. `$spurBin` is PATH-independent, so the stub never shadows the lifecycle's own
 * `feature check` / `feature verify` calls — only the verification command itself.
 */
function makeSyncFixture(label: string, passExit: 0 | 1): SyncFixture {
    const root = mkdtempSync(join(tmpdir(), `spur-1247-${label}-`));
    mkdirSync(join(root, 'docs', 'features'), { recursive: true });
    mkdirSync(join(root, 'docs', 'tasks'), { recursive: true });
    mkdirSync(join(root, 'stub-bin'), { recursive: true });
    // Receipts, run rows and the DB land in `.spur/`; keeping it ignored keeps the checked-input
    // digest stable across the pass.
    writeFileSync(join(root, '.gitignore'), '.spur/\nstub-bin/\nprojects.json\nslash_commands.json\n');
    writeFileSync(
        join(root, 'docs', 'features', 'F1_sync-probe.md'),
        syncFeatureBody('F1', 'Sync probe', [
            ['9001', 'done task', 'done'],
            ['9002', 'cancelled task', 'cancelled'],
        ]),
    );
    writeFileSync(
        join(root, 'docs', 'features', 'G1_wip-sibling.md'),
        syncFeatureBody('G1', 'Wip sibling', [['9003', 'wip task', 'wip']]),
    );
    writeFileSync(join(root, 'docs', 'tasks', '9001_done.md'), syncTaskBody('9001', 'done', 'F1'));
    writeFileSync(join(root, 'docs', 'tasks', '9002_cancelled.md'), syncTaskBody('9002', 'cancelled', 'F1'));
    writeFileSync(join(root, 'docs', 'tasks', '9003_wip.md'), syncTaskBody('9003', 'wip', 'G1'));
    const callsLog = join(root, 'stub-bin', 'calls.log');
    const stub = join(root, 'stub-bin', 'spur');
    writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${callsLog}"\nexit ${passExit}\n`);
    chmodSync(stub, 0o755);
    // A silently failed fixture commit leaves the project without HEAD, which the pass's git-tree
    // digest capture reports as an opaque `feature verify` exit 1 — fail here instead.
    const git = (args: string): void => {
        const result = Bun.spawnSync(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', ...args.split(' ')], {
            cwd: root,
        });
        if (result.exitCode !== 0) throw new Error(`fixture git ${args} failed: ${result.stderr.toString()}`);
    };
    git('init -q');
    git('add -A');
    git('commit -qm init');
    return { root, callsLog };
}

async function runSyncCli(root: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
    const env = getEnvVars();
    const proc = Bun.spawn([process.execPath, SYNC_CLI_ENTRY, ...args], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...env,
            PATH: `${join(root, 'stub-bin')}:${env.PATH ?? ''}`,
            // Never read or lock the operator's global registry from a test.
            SPUR_PROJECTS_FILE: join(root, 'projects.json'),
            SPUR_SLASH_COMMANDS_FILE: join(root, 'slash_commands.json'),
            // The onEnter's `env -u __runId` must open the pass's OWN run row (1246 R2).
            __runId: 'run_outerpipeline0000000000',
        },
    });
    const [stdout, stderr, status] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { status: status ?? -1, stdout, stderr };
}

/** Assert a spawned CLI call succeeded, carrying its output into the failure message. */
function expectSyncCliOk(result: { status: number; stdout: string; stderr: string }): void {
    if (result.status !== 0) {
        throw new Error(`spur exited ${result.status}:\n${result.stdout}${result.stderr}`);
    }
}

/** The `--json` payload: pretty-printed, possibly after a logo/banner line. */
function parseJsonOutput(output: string): unknown {
    const start = output.indexOf('{');
    if (start < 0) throw new Error(`no JSON object in output: ${output}`);
    return JSON.parse(output.slice(start));
}

const syncFixtureStatus = (root: string, file: string): string =>
    /^status:\s*(\S+)/m.exec(readFileSync(join(root, 'docs', 'features', file), 'utf8'))?.[1] ?? '';

/** Verification-pass invocations recorded by the stub `spur`, one line per call. */
const syncVerifierCalls = (callsLog: string): string[] =>
    existsSync(callsLog) ? readFileSync(callsLog, 'utf8').trim().split('\n').filter(Boolean) : [];

/**
 * R4's negative path: syncing the wip sibling itself must stay in `active`, apply no hop and run
 * no verification pass. Reading G1's file after F1's sync proves nothing — only G1's own sync
 * exercises the non-terminal rule.
 */
async function expectWipSiblingSyncStaysActive(root: string, callsLog: string): Promise<void> {
    const before = syncVerifierCalls(callsLog).length;
    const sync = await runSyncCli(root, ['feature', 'sync', 'G1', '--json']);
    expectSyncCliOk(sync);

    const parsed = parseJsonOutput(sync.stdout) as {
        proposal: { from: string; to: string };
        applied: boolean;
        appliedHops: string[];
    };
    expect(parsed.proposal.from).toBe('active');
    expect(parsed.proposal.to).toBe('active');
    expect(parsed.applied).toBe(false);
    expect(parsed.appliedHops).toEqual([]);
    expect(syncFixtureStatus(root, 'G1_wip-sibling.md')).toBe('active');
    // No verifying hop ⇒ no onEnter ⇒ no additional verification pass.
    expect(syncVerifierCalls(callsLog).length).toBe(before);
}

async function withSyncFixture(
    label: string,
    passExit: 0 | 1,
    body: (fixture: SyncFixture) => Promise<void>,
): Promise<void> {
    const fixture = makeSyncFixture(label, passExit);
    try {
        await body(fixture);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
}

describe('spur feature CLI', () => {
    test('update --help names the section-discovery command (0534 R2)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'update', '--help'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('spur task sections <wbs> list');
    });

    test('update --field sets a frontmatter value', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Prioritize Me'], { cwd, output: cOut });
        const id = createdId(cOut);

        const exitCode = await main(['feature', 'update', id, '--field', 'priority', '--value', 'P0'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);

        const shown = createCapturedOutput();
        await main(['feature', 'show', id, '--json'], { cwd, output: shown });
        expect(JSON.parse(lastMessage(shown)).frontmatter.priority).toBe('P0');
    });

    test('update --field without --value exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'No Value'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id, '--field', 'priority'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(2);
    });

    test('update --section --from-file replaces a feature section', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Section CLI'], { cwd, output: cOut });
        const id = createdId(cOut);
        const source = join(cwd, 'goal-body.md');
        writeFileSync(source, 'CLI-written goal.\n');

        const exitCode = await main(['feature', 'update', id, '--section', 'Goal', '--from-file', source], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);

        const shown = createCapturedOutput();
        await main(['feature', 'show', id], { cwd, output: shown });
        expect(shown.messages.join('')).toContain('## Goal\n\nCLI-written goal.\n');
    });

    test('update --section without --from-file exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'No Source'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id, '--section', 'Goal'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(2);
    });

    test('update status and section in one invocation', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Section Plus Status'], { cwd, output: cOut });
        const id = createdId(cOut);
        const source = join(cwd, 'scope-body.md');
        writeFileSync(source, 'In scope: combined update.\n\nOut of scope: unrelated work.\n');

        const exitCode = await main(['feature', 'update', id, 'active', '--section', 'Scope', '--from-file', source], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);

        const shown = createCapturedOutput();
        await main(['feature', 'show', id, '--json'], { cwd, output: shown });
        const parsed = JSON.parse(lastMessage(shown));
        expect(parsed.frontmatter.status).toBe('active');
        expect(parsed.content).toContain('In scope: combined update.');
    });

    test('update <status> transitions the feature lifecycle (human output)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Transition Me'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        // backlog → active is a valid feature-lifecycle transition.
        const exitCode = await main(['feature', 'update', id, 'active'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain(`${id}:`);
    });

    test('update with neither status nor --field exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Nothing To Do'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(2);
    });

    test('update parameter guard errors', async () => {
        const fid = 'A';

        const errOut1 = createCapturedOutput();
        const code1 = await main(['feature', 'update', fid, '--from-file', 'foo.md'], { cwd, output: errOut1 });
        expect(code1).toBe(2);
        expect(errOut1.errors.join('')).toContain('--section is required with --from-file');

        const errOut2 = createCapturedOutput();
        const code2 = await main(['feature', 'update', fid, '--value', 'val'], { cwd, output: errOut2 });
        expect(code2).toBe(2);
        expect(errOut2.errors.join('')).toContain('--field is required with --value');
    });
});

describe('spur feature sync re-derives after the verifying onEnter (1247, D66 R4)', () => {
    test(
        'a FAIL pass leaves the feature in verifying, names the rework edge, and exits 0',
        async () => {
            await withSyncFixture('fail', 1, async ({ root, callsLog }) => {
                const sync = await runSyncCli(root, ['feature', 'sync', 'F1', '--json']);
                // R2: a FAIL is a recorded outcome, not a sync failure.
                expectSyncCliOk(sync);

                const parsed = parseJsonOutput(sync.stdout) as {
                    proposal: { to: string; reason: string; receiptPending?: boolean };
                    appliedHops: string[];
                };
                expect(parsed.appliedHops).toEqual(['verifying']);
                expect(parsed.proposal.to).toBe('verifying');
                expect(parsed.proposal.receiptPending).toBe(true);
                expect(parsed.proposal.reason).toContain('L4.feature-receipt-failed');
                expect(parsed.proposal.reason).toContain('spur feature update F1 active');
                expect(syncFixtureStatus(root, 'F1_sync-probe.md')).toBe('verifying');
                expect(syncFixtureStatus(root, 'G1_wip-sibling.md')).toBe('active');

                // A FAIL still runs the pass exactly once — the re-derive must not retry it.
                expect(syncVerifierCalls(callsLog)).toEqual(['self exec check-feature']);

                await expectWipSiblingSyncStaysActive(root, callsLog);
                const rework = await runSyncCli(root, ['feature', 'update', 'F1', 'active', '--json']);
                expectSyncCliOk(rework);
                expect(syncFixtureStatus(root, 'F1_sync-probe.md')).toBe('active');
            });
        },
        SYNC_FIXTURE_TIMEOUT_MS,
    );
});
