#!/usr/bin/env bun
/**
 * feature-verification-steps — the single writer of feature verification
 * receipts behind the `feature-verification` workflow (task 0915, remediated
 * to the frozen v1 contract; no public CLI verb exists by design).
 *
 * Usage (workflow onEnter, vars: featureId, verificationCmd, spurBin, __runId):
 *   bun plugins/sp/scripts/feature-verification-steps.ts verify \
 *     --feature-id D63 --run-id <runId> --cmd "bun run spur-check-feature"
 *
 * One pass, in order:
 *   1. resolve the selected `feature-verification` definition (project override
 *      wins) for the verifier identity + configured command,
 *   2. capture the before proof-input digest, record the RUNNING receipt (both
 *      copies) and register the run-scoped receipt as a run artifact,
 *   3. run the effective command via the safe launch splitter (never `sh -c`
 *      interpolation), output to the run-scoped log,
 *   4. capture the after digest — a mismatch records FAIL,
 *   5. complete the receipt PASS/FAIL (both copies) and the coarse status file.
 *
 * Always exits 0 after verify; the transition guard reads the status file and
 * the completion boundary validates the receipt (fail-closed). Unsafe ids are
 * refused outright. Node-builtin imports only (ADR-065); the application seams come
 * from the generated inline bundle (`plugins/sp/lib/inline-run.generated.mjs`) — never
 * from `packages/app/src/index.ts`, which is not a plugin-script contract surface (0948 R3).
 */

import { spawnSync } from 'node:child_process';
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnvVar } from '../lib/env';

/** Single safe filename component — same class as the inline-run-setup run-id guard. */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Shape of the generated inline bundle / repo app source this script consumes. */
interface VerificationModule {
    startFeatureVerificationReceipt: typeof import('../../packages/app/src/workflow/feature-verification-receipt')['startFeatureVerificationReceipt'];
    completeFeatureVerificationReceipt: typeof import('../../packages/app/src/workflow/feature-verification-receipt')['completeFeatureVerificationReceipt'];
    captureFeatureReceiptDigest: typeof import('../../packages/app/src/workflow/feature-verification-receipt')['captureFeatureReceiptDigest'];
    resolveWorkflowDefinition: typeof import('../../packages/app/src/workflow/workflow-resolver')['resolveWorkflowDefinition'];
    splitLaunchCommand: typeof import('../../packages/app/src/workflow/split-launch-command')['splitLaunchCommand'];
    openInlineRunProjectDb: typeof import('../../packages/app/src/services/inline-run-setup')['openInlineRunProjectDb'];
    ArtifactDao: new (
        adapter: never,
    ) => { record: (input: { runId: string; path: string; kind: string }) => Promise<unknown> };
}

/**
 * Load the verification seams from the plugin's GENERATED inline bundle.
 *
 * Mode is explicit (0948 R3): plugin scripts consume the generated bundle — the
 * contract surface ADR-065 gives them — and never `packages/app/src/index.ts`.
 * The app source entry is not a plugin-script surface and does not re-export every
 * seam (`splitLaunchCommand`, `ArtifactDao`), so loading it produced a misleading
 * "rebuild/install the sp plugin" failure that no rebuild could fix. The bundle is
 * tracked, so a source checkout has it without an install step.
 *
 * `spurBin` no longer selects the module (it named the *caller's* CLI entry, not this
 * script's runtime surface); it is kept only to make the failure message actionable.
 */
async function loadModule(spurBin: string): Promise<VerificationModule> {
    const bundle = fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url));
    if (!existsSync(bundle)) {
        throw new Error(
            `feature-verification-steps: mode=bundle — the generated inline bundle is missing at ${bundle}` +
                `${spurBin === '' ? '' : ` (spurBin=${spurBin})`}. ` +
                'Fix: in a source checkout run `bun run build:bundle`; for an installed plugin reinstall it.',
        );
    }
    return requireModule(bundle, 'bundle');
}

/** Dynamic-import the entry and refuse modules missing the verification seams. */
async function requireModule(entry: string, mode: 'bundle'): Promise<VerificationModule> {
    const mod = (await import(entry)) as Partial<VerificationModule> & Record<string, unknown>;
    const missing = (
        [
            'startFeatureVerificationReceipt',
            'completeFeatureVerificationReceipt',
            'captureFeatureReceiptDigest',
            'resolveWorkflowDefinition',
            'splitLaunchCommand',
            'openInlineRunProjectDb',
            'ArtifactDao',
        ] as const
    ).filter((k) => typeof mod[k] !== 'function');
    if (missing.length > 0) {
        throw new Error(
            `feature-verification-steps: mode=${mode} — application entry ${entry} is missing feature-verification seams (${missing.join(', ')}). ` +
                'Fix: the generated inline bundle is stale or incomplete — run `bun run build:bundle` in a source checkout, or reinstall the sp plugin.',
        );
    }
    return mod as VerificationModule;
}

/** Refuse ids that could escape the run directory through receipt filenames. */
function assertSafeId(kind: string, id: string): void {
    if (!SAFE_ID_RE.test(id) || id.includes('..')) {
        throw new Error(`refusing unsafe ${kind}: ${id}`);
    }
}

/** Locate `<id>_<slug>.md` under the features directory. */
function findFeatureFile(featureDir: string, featureId: string): string | undefined {
    if (!existsSync(featureDir)) return undefined;
    const name = readdirSync(featureDir).find((n) => n.startsWith(`${featureId}_`) && n.endsWith('.md'));
    return name === undefined ? undefined : join(featureDir, name);
}

// ponytail: the receipt service is filesystem-pure over the ts-runtime
// FileSystem port; only ensureDir/writeFile/rename are exercised on the
// start/complete paths. Swap to createNodeFileSystem if more surface is needed.
const nodeFsShim = {
    ensureDir: (dir: string) => {
        mkdirSync(dir, { recursive: true });
    },
    writeFile: (path: string, body: string) => {
        writeFileSync(path, body);
    },
    rename: (src: string, dest: string) => {
        renameSync(src, dest);
    },
    readFile: (path: string) => {
        return readFileSync(path, 'utf8');
    },
} as never;

/** One full verification pass for one feature. Always exits 0. */
async function verify(featureId: string, runId: string, cmdOverride: string, spurBin: string): Promise<void> {
    assertSafeId('feature id', featureId);
    assertSafeId('run id', runId);
    const cwd = process.cwd();
    const mod = await loadModule(spurBin);
    const runDir = join(cwd, '.spur', 'run');
    mkdirSync(runDir, { recursive: true });

    // 1. Selected verifier definition (project override wins); its configured
    // command is the completion contract — an override records but can't complete.
    const selected = await mod.resolveWorkflowDefinition(cwd, 'feature-verification');
    const vars = selected.workflow.vars as { verificationCmd?: unknown } | undefined;
    const configuredCmd =
        typeof vars?.verificationCmd === 'string' && vars.verificationCmd.length > 0
            ? vars.verificationCmd
            : 'bun run spur-check-feature';
    const effectiveCmd = cmdOverride !== '' ? cmdOverride : configuredCmd;

    const featureFile = findFeatureFile(join(cwd, 'docs', 'features'), featureId);
    if (featureFile === undefined) {
        throw new Error(`feature ${featureId} not found under ${join(cwd, 'docs', 'features')}`);
    }
    const featureContent = readFileSync(featureFile, 'utf8');
    const learningsPath = join(cwd, '.spur', 'context', 'learnings.md');
    const learningsContent = existsSync(learningsPath) ? readFileSync(learningsPath, 'utf8') : undefined;

    // 2. Before digest + RUNNING receipt (both copies) + artifact registration.
    const beforeDigest = await mod.captureFeatureReceiptDigest(cwd, featureContent, learningsContent);
    const receipt = await mod.startFeatureVerificationReceipt(nodeFsShim, runDir, {
        featureId,
        runId,
        workdir: cwd,
        verifier: {
            name: 'feature-verification',
            sourcePath: selected.path,
            layer: selected.layer,
            definitionDigest: selected.digest,
        },
        verificationCmd: effectiveCmd,
        inputDigest: beforeDigest,
    });
    const db = await mod.openInlineRunProjectDb(cwd);
    try {
        await new mod.ArtifactDao(db.adapter as never).record({
            runId,
            path: join(runDir, `${runId}-feature-verification.json`),
            kind: 'feature-verification',
        });
    } finally {
        db.close();
    }

    // 3. Run the effective command via the safe splitter (no `sh -c`).
    const logPath = join(runDir, `${runId}-feature-verification.log`);
    const launch = mod.splitLaunchCommand(effectiveCmd, 'feature-verification verificationCmd');
    if ('error' in launch) {
        await mod.completeFeatureVerificationReceipt(nodeFsShim, runDir, receipt, {
            status: 'FAIL',
            inputDigest: beforeDigest,
        });
        console.log(`feature-verification-steps: ${featureId} verification FAIL (${launch.error})`);
        return;
    }
    const logFd = openSync(logPath, 'a');
    try {
        const result = spawnSync(launch.command, launch.leadingArgs, {
            cwd,
            stdio: ['ignore', logFd, logFd],
            timeout: 4 * 60 * 60 * 1000,
        });
        const exit = result.status ?? 1;

        // 4/5. After digest — a mismatch records FAIL (the pass did not verify
        // the tree it left behind); otherwise the exit code decides.
        const afterDigest = await mod.captureFeatureReceiptDigest(cwd, featureContent, learningsContent);
        const status: 'PASS' | 'FAIL' = exit === 0 && afterDigest === beforeDigest ? 'PASS' : 'FAIL';
        await mod.completeFeatureVerificationReceipt(nodeFsShim, runDir, receipt, { status, inputDigest: afterDigest });
        console.log(`feature-verification-steps: ${featureId} verification ${status} (run ${runId}, log ${logPath})`);
    } finally {
        closeSync(logFd);
    }
}

function main(): void {
    const args = process.argv.slice(2);
    const command = args[0];
    const flag = (name: string): string => {
        const i = args.indexOf(name);
        return i >= 0 && i + 1 < args.length ? (args[i + 1] ?? '') : '';
    };
    if (command !== 'verify') {
        console.error('Usage: feature-verification-steps.ts verify --feature-id <id> --run-id <id> [--cmd <command>]');
        process.exit(2);
    }
    verify(
        flag('--feature-id') || getEnvVar('featureId') || '',
        flag('--run-id') || getEnvVar('__runId') || '',
        flag('--cmd') || getEnvVar('verificationCmd') || '',
        flag('--spur-bin') || getEnvVar('spurBin') || '',
    )
        .then(() => process.exit(0))
        .catch((err: unknown) => {
            console.error(`feature-verification-steps: ${String(err)}`);
            process.exit(1);
        });
}

main();
