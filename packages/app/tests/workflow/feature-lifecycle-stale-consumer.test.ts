/**
 * R4 regression fixture for the stale-consumer diagnosis (task 1185, feature A33), driven end to end
 * through the real CLI and the real `feature-lifecycle` `verifying` entry.
 *
 * Both directions are pinned:
 *   - a project-layer `feature-verification.yaml` override whose consumer requires an export the
 *     shipped inline-run entry retired → the named diagnosis (override path, consumer path, missing
 *     export, entry path) and a non-`done` feature (the transition is still denied);
 *   - a migrated consumer that calls the current app-owned operation → a PASS receipt and `done`.
 * A genuine verification FAIL is pinned too, so the stale-consumer diagnosis cannot be confused with
 * it (R3): that failure keeps the verification command's own result and records FAIL.
 *
 * Fixture projects are throwaway roots under the OS tmp dir; nothing here touches the repo corpus.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const INLINE_RUN_ENTRY = join(REPO_ROOT, 'plugins', 'sp', 'lib', 'inline-run.generated.mjs');
const STATE_MACHINE_SCHEMA = join(REPO_ROOT, 'apps', 'cli', 'schemas', 'state-machine-workflow.schema.json');
const FEATURE_ID = 'F1';

/** One spawned CLI invocation against a throwaway project root. */
function runCli(root: string, args: string[]): { status: number; stdout: string; output: string } {
    const result = Bun.spawnSync([process.execPath, CLI_ENTRY, ...args], { cwd: root });
    const stdout = result.stdout.toString();
    return {
        status: result.exitCode ?? -1,
        stdout,
        output: `${stdout}${result.stderr.toString()}`,
    };
}

const featureBody = (): string =>
    [
        '---',
        'schema_version: 1',
        'id: "F1"',
        'name: "Stale consumer fixture"',
        'status: active',
        'priority: P0',
        'created_at: 2026-08-02T00:00:00.000Z',
        'updated_at: 2026-08-02T00:00:00.000Z',
        '---',
        '',
        '# F1: Stale consumer fixture',
        '',
        '## Goal',
        '',
        'Drive the feature-lifecycle verifying entry.',
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
        '| 9001 | done task | done |',
        '',
        '## Notes',
        '',
        'Fixture.',
    ].join('\n');

const taskBody = (): string =>
    [
        '---',
        'schema_version: 1',
        'wbs: "9001"',
        'name: "Task 9001"',
        'status: done',
        'feature_id: "F1"',
        'created_at: 2026-08-02T00:00:00.000Z',
        'updated_at: 2026-08-02T00:00:00.000Z',
        '---',
        '',
        '# 9001: Task 9001',
        '',
        '### Solution',
        '',
        'Done.',
    ].join('\n');

/** The project-layer override: its `onEnter` runs the project-rooted consumer, as ts-libs does. */
const overrideBody = (verificationCmd: string): string =>
    [
        // Absolute repo path, not the `@gobing-ai/spur/...` package specifier: the throwaway root
        // has no node_modules, so a bare specifier only resolved through Bun auto-install from
        // the npm registry (network, and the *published* schema rather than this checkout's).
        `"$schema": ${JSON.stringify(STATE_MACHINE_SCHEMA)}`,
        'kind: state-machine',
        'name: feature-verification',
        'version: "1"',
        'description: "Project-layer override of the feature-verification pass."',
        'iterationBound: 2',
        'initialState: verify',
        'terminalStates:',
        '  - done',
        '  - failed',
        'failureStates:',
        '  - failed',
        'vars:',
        '  featureId: "X"',
        '  spurBin: "spur"',
        '  __runId: ""',
        `  verificationCmd: "${verificationCmd}"`,
        'states:',
        '  - id: verify',
        '    description: Verify through the project-rooted consumer.',
        '    onEnter:',
        '      - kind: shell',
        '        options:',
        '          command: \'bun .spur/scripts/feature-verify.mjs verify --feature-id "$featureId" --run-id "$__runId" --spur-bin "$spurBin"\'',
        '  - id: done',
        '    description: Terminal — the pass recorded PASS.',
        '  - id: failed',
        '    description: Terminal — the pass failed or recorded no PASS.',
        'transitions:',
        '  - from: verify',
        '    to: done',
        '    guard:',
        '      kind: shell',
        '      options:',
        '        command: \'test "$(cat .spur/run/$__runId-feature-verification.status 2>/dev/null)" = PASS\'',
        '  - from: verify',
        '    to: failed',
        '    terminalReason: failed-check',
        '    guard:',
        '      kind: always',
    ].join('\n');

/** Entry resolution shared by all three consumers: from the `spur` invocation the caller names. */
const CONSUMER_PRELUDE = `
const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? (process.argv[i + 1] ?? '') : '';
};
const spurBin = flag('--spur-bin');
const main = spurBin.split(/\\s+/).find((t) => /\\.(ts|mjs|js)$/.test(t)) ?? '';
const root = main.replace(/\\/apps\\/cli\\/src\\/index\\.ts$/, '');
const entry = \`\${root}/plugins/sp/lib/inline-run.generated.mjs\`;
`;

/** The pre-retirement port: requires the retired names as functions of the shipped entry. */
const STALE_CONSUMER = `${CONSUMER_PRELUDE}
const REQUIRED = [
    'startFeatureVerificationReceipt',
    'completeFeatureVerificationReceipt',
    'captureFeatureReceiptDigest',
    'resolveWorkflowDefinition',
    'splitLaunchCommand',
    'openInlineRunProjectDb',
    'ArtifactDao',
];
const mod = await import(entry);
const missing = REQUIRED.filter((name) => typeof mod[name] !== 'function');
if (missing.length > 0) {
    console.error(
        \`feature-verify: Error: module \${entry} is missing feature-verification seams (\${missing.join(', ')}) — reinstall/upgrade @gobing-ai/spur\`,
    );
    process.exit(1);
}
console.log('feature-verify: seams present');
`;

/** The migrated consumer: the current app-owned operation, reached through the generated bundle. */
const MIGRATED_CONSUMER = `${CONSUMER_PRELUDE}
const { runFeatureVerification } = await import(entry);
const result = await runFeatureVerification({
    workdir: process.cwd(),
    featureId: flag('--feature-id'),
    runId: flag('--run-id'),
});
console.log(\`feature-verify: \${result.status} \${result.message}\`);
`;

interface FixtureKind {
    /** Override's configured verification command — the pass's completion contract. */
    verificationCmd: string;
    consumer: string;
}

const FIXTURES: Record<'stale' | 'migrated' | 'failing', FixtureKind> = {
    // The override's own command never runs: the consumer refuses at import, exactly as ts-libs did.
    stale: { verificationCmd: 'bun run spur-check-feature', consumer: STALE_CONSUMER },
    migrated: { verificationCmd: 'true', consumer: MIGRATED_CONSUMER },
    failing: { verificationCmd: 'false', consumer: MIGRATED_CONSUMER },
};

/** Build one throwaway project root with the given override/consumer pair. */
function makeProject(kind: keyof typeof FIXTURES): string {
    const root = mkdtempSync(join(tmpdir(), `spur-1185-${kind}-`));
    mkdirSync(join(root, 'docs', 'features'), { recursive: true });
    mkdirSync(join(root, 'docs', 'tasks'), { recursive: true });
    mkdirSync(join(root, '.spur', 'workflows'), { recursive: true });
    mkdirSync(join(root, '.spur', 'scripts'), { recursive: true });
    // Receipts and workflow runs land in `.spur/`; keeping it ignored keeps the checked-input
    // digest stable across the pass (the same reason the 0872 fixture ignores it).
    writeFileSync(join(root, '.gitignore'), '.spur/\n');
    writeFileSync(join(root, 'docs', 'features', 'F1_probe.md'), featureBody());
    writeFileSync(join(root, 'docs', 'tasks', '9001_done.md'), taskBody());
    writeFileSync(
        join(root, '.spur', 'workflows', 'feature-verification.yaml'),
        overrideBody(FIXTURES[kind].verificationCmd),
    );
    writeFileSync(join(root, '.spur', 'scripts', 'feature-verify.mjs'), FIXTURES[kind].consumer);
    const git = (args: string): void => {
        Bun.spawnSync(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', ...args.split(' ')], { cwd: root });
    };
    git('init -q');
    git('add -A');
    git('commit -qm init');
    return root;
}

const featureStatus = (root: string): string =>
    /^status:\s*(\S+)/m.exec(readFileSync(join(root, 'docs', 'features', 'F1_probe.md'), 'utf8'))?.[1] ?? '';

/** The single recorded verdict status file (`.spur/run/<runId>-feature-verification.status`). */
const recordedStatus = (root: string): string => {
    const runDir = join(root, '.spur', 'run');
    const name = readdirSync(runDir).find((entry) => entry.endsWith('-feature-verification.status'));
    return name === undefined ? '' : readFileSync(join(runDir, name), 'utf8').trim();
};

const withProject = async (kind: keyof typeof FIXTURES, body: (root: string) => Promise<void>): Promise<void> => {
    const root = makeProject(kind);
    try {
        await body(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
};

const FIXTURE_TIMEOUT_MS = 60_000;
const testFixture = (label: string, fn: () => Promise<void>): void => {
    test(label, fn, FIXTURE_TIMEOUT_MS);
};

describe('feature-lifecycle verifying entry: stale consumer diagnosis (1185)', () => {
    testFixture('AC3: a stale consumer is named and the feature does not complete', async () => {
        await withProject('stale', async (root) => {
            const sync = runCli(root, ['feature', 'sync', FEATURE_ID, '--json']);
            expect(sync.status).not.toBe(0);
            // The bare denial is widened, not replaced: state/exit facts stay.
            expect(sync.output).toContain('State "verifying" onEnter shell failed (exit 1)');
            // AC1: the diagnosis SENTENCE, not just the four bare facts — a message that happens to
            // contain the paths but never composes the claim would satisfy the loose form (1185 review P4).
            expect(sync.output).toContain(
                'requires openInlineRunProjectDb, ArtifactDao from the shipped inline-run entry',
            );
            expect(sync.output).toContain('which no longer provides them');
            expect(sync.output).toContain(join(root, '.spur', 'workflows', 'feature-verification.yaml'));
            expect(sync.output).toContain(join(root, '.spur', 'scripts', 'feature-verify.mjs'));
            expect(sync.output).toContain('openInlineRunProjectDb');
            expect(sync.output).toContain(INLINE_RUN_ENTRY);
            // AC2: only the two remedies that can work are offered.
            expect(sync.output).toContain('remove the project-layer override');
            expect(sync.output).toContain('migrate');
            expect(sync.output).not.toMatch(/reinstall\/upgrade/i);
            // Fail-closed: the entry never landed the feature anywhere.
            expect(featureStatus(root)).toBe('active');
        });
    });

    testFixture('R1: the nested pass failure carries the same diagnosis', async () => {
        await withProject('stale', async (root) => {
            const run = runCli(root, [
                'workflow',
                'run',
                'feature-verification.yaml',
                '--vars',
                JSON.stringify({ featureId: FEATURE_ID, spurBin: `${process.execPath} ${CLI_ENTRY}` }),
                '--json',
            ]);
            expect(run.status).not.toBe(0);
            const parsed = JSON.parse(run.stdout) as { status?: string; reason?: string; transitionsTaken?: number };
            expect(parsed.status).toBe('failed');
            expect(parsed.transitionsTaken).toBe(0);
            expect(parsed.reason ?? '').toContain(join(root, '.spur', 'scripts', 'feature-verify.mjs'));
            expect(parsed.reason ?? '').toContain('openInlineRunProjectDb');
            expect(parsed.reason ?? '').toContain(INLINE_RUN_ENTRY);
        });
    });

    testFixture('AC2/AC3: a genuine verification FAIL keeps its own message and records FAIL', async () => {
        await withProject('failing', async (root) => {
            const sync = runCli(root, ['feature', 'sync', FEATURE_ID, '--json']);
            expect(sync.status).not.toBe(0);
            expect(recordedStatus(root)).toBe('FAIL');
            // Distinguishable from a stale consumer: no consumer diagnosis is fabricated.
            expect(sync.output).not.toContain('shipped inline-run entry');
            expect(sync.output).not.toContain('remove the project-layer override');
            expect(featureStatus(root)).toBe('active');
        });
    });

    testFixture('AC3: a migrated consumer records PASS and reaches done', async () => {
        await withProject('migrated', async (root) => {
            // Hop 1 runs the pass (verifying's onEnter); hop 2 completes it against the receipt.
            const enter = runCli(root, ['feature', 'sync', FEATURE_ID, '--json']);
            expect(enter.status).toBe(0);
            expect(featureStatus(root)).toBe('verifying');
            expect(recordedStatus(root)).toBe('PASS');

            const complete = runCli(root, ['feature', 'sync', FEATURE_ID, '--json']);
            expect(complete.status).toBe(0);
            expect(featureStatus(root)).toBe('done');
        });
    });
});
