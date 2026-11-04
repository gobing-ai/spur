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
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    captureFeatureReceiptDigest,
    completeFeatureVerificationReceipt,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    featureReceiptPaths,
    resolveWorkflowDefinition,
    startFeatureVerificationReceipt,
} from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createMigratedDbAdapter } from '../../../src/context';
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
    // Seed one feature: list/sync assertions need a non-empty corpus (was implicit via create tests pre-split).
    await main(['feature', 'create', 'Seed Feature'], { cwd, output: createCapturedOutput() });
}, 20000);

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

/** Feature/task fixture paths shared by the 1119 receipt-gating tests. */
const receiptGate = {
    id: '',
    featurePath: '',
    taskPath: '',
};

/**
 * 1119 AC2 fixture: record a valid feature-verification receipt (both copies) bound to the
 * feature's current on-disk content, plus the backing run-store rows the CLI receipt port
 * validates (terminal done run, persisted definition digest, registered artifact).
 * The verifier contract and proof digest are captured from `process.cwd()` — the same root
 * `feature check` resolves them against at validation time.
 */
async function fixturePassReceipt(featureId: string, featureContent: string): Promise<void> {
    const selected = await resolveWorkflowDefinition(process.cwd(), 'feature-lifecycle');
    const cmd = DEFAULT_FEATURE_VERIFICATION_CMD;
    // defaultVerdictRunDir(<cwd>/docs/tasks): the fixture uses the default docs/ layout.
    const runDir = join(cwd, '.spur', 'run');
    const fs = createNodeFileSystem();
    // Fold learnings exactly as validation does (feature-check.ts) — from the repo root
    // `.spur/context/learnings.md` exists, and omitting it made the receipt stale.
    const learningsPath = join(process.cwd(), '.spur', 'context', 'learnings.md');
    const learnings = existsSync(learningsPath) ? readFileSync(learningsPath, 'utf8') : undefined;
    const inputDigest = await captureFeatureReceiptDigest(process.cwd(), featureContent, learnings);
    const runId = `receipt-${featureId.toLowerCase()}`;
    const running = await startFeatureVerificationReceipt(fs, runDir, {
        featureId,
        runId,
        workdir: cwd,
        verifier: {
            name: 'feature-lifecycle',
            sourcePath: selected.path,
            layer: selected.layer,
            definitionDigest: selected.digest,
        },
        verificationCmd: cmd,
        inputDigest,
    });
    await completeFeatureVerificationReceipt(fs, runDir, running, {
        status: 'PASS',
        inputDigest,
    });

    const db = await createMigratedDbAdapter(cwd);
    try {
        await db.run(
            'INSERT INTO runs (id, status, workflow_name, mode, started_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
            runId,
            'done',
            'feature-lifecycle',
            'inline',
            Date.now(),
            JSON.stringify({ definitionDigest: selected.digest }),
        );
        await new ArtifactDao(db).record({
            runId,
            path: featureReceiptPaths(runDir, featureId, runId).runScoped,
            kind: 'evidence',
        });
    } finally {
        db.close();
    }
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
    test('sync requires id or --all (exits 2)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.join('')).toContain('Feature ID is required unless --all is passed');
    });

    test('sync <id> --dry-run --json outputs sync proposal', async () => {
        const listOut = createCapturedOutput();
        await main(['feature', 'list', '--json'], { cwd, output: listOut });
        const features = JSON.parse(lastMessage(listOut));
        const fid = features[0]?.id ?? 'A';

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', fid, '--dry-run', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.proposal.featureId).toBe(fid);
        expect(typeof parsed.proposal.from).toBe('string');
        expect(typeof parsed.proposal.to).toBe('string');
    });

    test('sync --all --json evaluates features in corpus', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', '--all', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(typeof parsed.totalFeatures).toBe('number');
        expect(Array.isArray(parsed.results)).toBe(true);
    });

    test('sync <id> human text branch', async () => {
        const listOut = createCapturedOutput();
        await main(['feature', 'list', '--json'], { cwd, output: listOut });
        const features = JSON.parse(lastMessage(listOut));
        const fid = features[0]?.id ?? 'A';

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', fid, '--dry-run'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain(`Feature ${fid}:`);
    });

    test('sync --all human text branch with linked tasks and --folder', async () => {
        const featDir = join(cwd, 'docs', 'features');
        const tasksDir = join(cwd, 'docs', 'tasks');
        await mkdir(featDir, { recursive: true });
        await mkdir(tasksDir, { recursive: true });

        const fid = 'A';
        const taskContent = `---
schema_version: 1
wbs: "9910"
name: "Task 9910"
title: "Task 9910"
status: "wip"
feature_id: "${fid}"
created_at: "${new Date().toISOString()}"
updated_at: "${new Date().toISOString()}"
---

## Description
Task description

## Requirements
- R1: Requirement 1

## Solution
Solution description

## Testing
Testing description

## Review
Review description
`;
        writeFileSync(join(tasksDir, '9910_sync-all-task.md'), taskContent);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', '--all', '--dry-run', '--folder', featDir], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Evaluated');
    });
});

describe('spur feature sync receipt gating (1119)', () => {
    test('sync stops a fully-done feature at verifying while the feature-verification receipt is missing (1119 AC1)', async () => {
        // The suite's other tests exhaust the A–Z top-level letter ceiling, so place the
        // fixture feature file directly (same template shape as `feature create`) on the
        // first free child ID (<letter><digit>) instead of allocating through the CLI.
        await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
        const featureFiles = readdirSync(join(cwd, 'docs', 'features'));
        let id = '';
        outer: for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
            for (const digit of '123456789') {
                if (!featureFiles.some((f) => f.startsWith(`${letter}${digit}_`))) {
                    id = `${letter}${digit}`;
                    break outer;
                }
            }
        }
        expect(id).not.toBe('');
        receiptGate.id = id;
        const now = new Date().toISOString();
        receiptGate.featurePath = join(cwd, 'docs', 'features', `${id}_receipt-gate-feature.md`);
        // File-wins: place the feature at `verifying` directly — reaching verifying through a
        // real sync hop runs the lifecycle shell guard, which cannot pass in the test runner
        // (resolveSpurBin resolves the test file itself under `bun test`).
        writeFileSync(
            receiptGate.featurePath,
            `---
schema_version: 1
id: "${id}"
name: "Receipt Gate Feature"
status: verifying
priority: P2
tags: []
created_at: "${now}"
updated_at: "${now}"
---

# ${id}: Receipt Gate Feature

## Goal

## Scope

- In:
- Out:

## Acceptance Criteria

\`\`\`gherkin
Feature: Receipt Gate Feature

  Scenario: Basic acceptance
    Given a precondition
    When an action
    Then an expected outcome
\`\`\`

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
<!-- END AUTO-GENERATED -->
`,
        );
        await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
        receiptGate.taskPath = join(cwd, 'docs', 'tasks', '9911_receipt-gate-task.md');
        writeFileSync(
            receiptGate.taskPath,
            `---
schema_version: 1
wbs: "9911"
name: "Receipt Gate Task"
title: "Receipt Gate Task"
status: "done"
feature_id: "${receiptGate.id}"
created_at: "${new Date().toISOString()}"
updated_at: "${new Date().toISOString()}"
---

## Description
Task description
`,
        );

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', receiptGate.id, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.proposal.from).toBe('verifying');
        expect(parsed.proposal.to).toBe('verifying');
        expect(parsed.appliedHops).toEqual([]);
        expect(parsed.proposal.receiptPending).toBe(true);
        expect(parsed.proposal.gateFindings.map((f: { code: string }) => f.code)).toContain(
            'L4.feature-receipt-missing',
        );

        const showOut = createCapturedOutput();
        await main(['feature', 'show', receiptGate.id, '--json'], { cwd, output: showOut });
        expect(JSON.parse(lastMessage(showOut)).status).toBe('verifying');
    });

    test('sync releases done once a valid receipt lands, not a suppressed BLOCKED replay (1119 AC2)', async () => {
        const featureContent = readFileSync(receiptGate.featurePath, 'utf8');
        await fixturePassReceipt(receiptGate.id, featureContent);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', receiptGate.id, '--dry-run', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        // The derivation now releases done. Applying the hop runs the lifecycle done-guard,
        // which cannot pass under the test runner, hence --dry-run asserts the derivation
        // contract; the applied-path completion is covered by the FeatureService unit suite.
        expect(parsed.proposal.to).toBe('done');
        expect(parsed.proposal.hops).toEqual(['done']);
        expect(parsed.proposal.receiptPending).toBeUndefined();
        expect(parsed.suppressed).toBeUndefined();

        rmSync(receiptGate.featurePath, { force: true });
        rmSync(receiptGate.taskPath, { force: true });
    });
});

describe('spur feature sync re-derives after the verifying onEnter (1247, D66 R4)', () => {
    test(
        'one sync drives active → done on the onEnter PASS, running the pass exactly once',
        async () => {
            await withSyncFixture('pass', 0, async ({ root, callsLog }) => {
                const sync = await runSyncCli(root, ['feature', 'sync', 'F1', '--json']);
                expectSyncCliOk(sync);

                const parsed = parseJsonOutput(sync.stdout) as {
                    proposal: { from: string; to: string };
                    appliedHops: string[];
                };
                expect(parsed.proposal.from).toBe('active');
                expect(parsed.proposal.to).toBe('done');
                expect(parsed.appliedHops).toEqual(['verifying', 'done']);
                expect(syncFixtureStatus(root, 'F1_sync-probe.md')).toBe('done');

                // The wip sibling is untouched by F1's sync.
                expect(syncFixtureStatus(root, 'G1_wip-sibling.md')).toBe('active');

                // The verifying onEnter ran the verification pass exactly once.
                expect(syncVerifierCalls(callsLog)).toEqual(['self exec check-feature']);

                await expectWipSiblingSyncStaysActive(root, callsLog);
            });
        },
        SYNC_FIXTURE_TIMEOUT_MS,
    );
});
