#!/usr/bin/env bun
/**
 * feature-verification-steps — argv adapter for the feature-verification pass (task 0915; reduced to
 * an adapter in task 1176).
 *
 * The pass itself — resolve the selected `feature-verification` definition, capture the before
 * proof-input digest, record and register the RUNNING receipt, run the effective command through the
 * safe argv splitter (never `sh -c`), compare the after digest, complete PASS/FAIL plus the coarse
 * status file — lives in the application operation
 * `packages/app/src/workflow/feature-verification-run.ts`, reached through the generated inline
 * bundle. This entry owns argv, usage and exit codes only: it opens no project DB, constructs no
 * `ArtifactDao`, and scans no feature directory (that lookup is app-owned too).
 *
 * Usage (workflow onEnter, vars: featureId, verificationCmd, spurBin, __runId):
 *   bun plugins/sp/scripts/feature-verification-steps.ts verify \
 *     --feature-id D63 --run-id <runId> [--cmd "bun run spur-check-feature"] [--module-mode bundle]
 *
 * Always exits 0 after a completed pass; the transition guard reads the status file and the
 * completion boundary validates the receipt (fail-closed). Unsafe ids are refused by the operation.
 *
 * Node-builtin imports only (ADR-065); the application seams come from the generated inline bundle,
 * never from `packages/app/src/index.ts`, which is not a plugin-script contract surface (0948 R3).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEnvVar } from '../lib/env';

/** Shape of the generated inline bundle / repo app source this script consumes. */
interface VerificationModule {
    runFeatureVerification: typeof import('../../../packages/app/src/workflow/feature-verification-run')['runFeatureVerification'];
}

/** Explicit module surface. Source is not the contract; the generated bundle is (0948 R3). */
type ModuleMode = 'source' | 'bundle';

function bundleEntry(): string {
    return fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url));
}

/**
 * Source mode names the mode and the fix. The app source entry does not export the verification
 * operation, and "rebuild/install the sp plugin" cannot add it.
 */
function sourceModeError(spurBin: string): Error {
    return new Error(
        `source mode: refusing to load packages/app/src/index.ts (spurBin=${JSON.stringify(spurBin)}). ` +
            'That entry is not the feature-verification contract surface — it does not export ' +
            'runFeatureVerification. Fix: run in bundle mode so ' +
            'plugins/sp/lib/inline-run.generated.mjs is loaded (omit --module-mode, or pass --module-mode bundle) ' +
            'and regenerate that bundle if it is missing. Reinstalling the sp plugin does not add the operation to the app source entry.',
    );
}

function resolveModuleMode(raw: string): ModuleMode {
    if (raw === '' || raw === 'bundle') return 'bundle';
    if (raw === 'source') return 'source';
    throw new Error(`unknown --module-mode ${JSON.stringify(raw)}; expected "source" or "bundle"`);
}

/**
 * Bundle mode loads the generated inline bundle. Source mode fails closed with a named fix.
 *
 * `spurBin` no longer selects the module (it named the *caller's* CLI entry, not this script's runtime
 * surface); it is kept only to make the failure message actionable.
 */
async function loadModule(spurBin: string, mode: ModuleMode): Promise<VerificationModule> {
    if (mode === 'source') throw sourceModeError(spurBin);
    const bundle = bundleEntry();
    if (!existsSync(bundle)) {
        throw new Error(
            `feature-verification-steps: mode=bundle — the generated inline bundle is missing at ${bundle}` +
                `${spurBin === '' ? '' : ` (spurBin=${spurBin})`}. ` +
                'Fix: in a source checkout run `bun run build:bundle`; for an installed plugin reinstall it.',
        );
    }
    return requireModule(bundle, mode);
}

/** Dynamic-import the entry and refuse a module missing the verification operation. */
async function requireModule(entry: string, mode: ModuleMode): Promise<VerificationModule> {
    const mod = (await import(entry)) as Partial<VerificationModule> & Record<string, unknown>;
    const missing = (['runFeatureVerification'] as const).filter((k) => typeof mod[k] !== 'function');
    if (missing.length > 0) {
        throw new Error(
            `feature-verification-steps: mode=${mode} — application entry ${entry} is missing feature-verification seams (${missing.join(', ')}). ` +
                'Fix: the generated inline bundle is stale or incomplete — run `bun run build:bundle` in a source checkout, or reinstall the sp plugin.',
        );
    }
    return mod as VerificationModule;
}

/** One full verification pass for one feature. Always exits 0. */
async function verify(
    featureId: string,
    runId: string,
    cmdOverride: string,
    spurBin: string,
    mode: ModuleMode,
    confidenceOverride: string,
    ackLowConfidence: boolean,
): Promise<void> {
    const mod = await loadModule(spurBin, mode);
    const result = await mod.runFeatureVerification({
        workdir: process.cwd(),
        featureId,
        runId,
        cmdOverride,
        // Operator-declared level (empty = derive from the pass) and the acknowledgement of a LOW
        // level. Both ride the receipt, so the completion boundary reads them from the evidence
        // rather than from whatever flags a later transition happens to pass.
        confidenceOverride,
        ackLowConfidence,
    });
    console.log(`feature-verification-steps: ${featureId} ${result.message}`);
}

function main(): void {
    const args = process.argv.slice(2);
    const command = args[0];
    const flag = (name: string): string => {
        const i = args.indexOf(name);
        return i >= 0 && i + 1 < args.length ? (args[i + 1] ?? '') : '';
    };
    if (command !== 'verify') {
        console.error(
            'Usage: feature-verification-steps.ts verify --feature-id <id> --run-id <id> [--cmd <command>] ' +
                '[--confidence HIGH|MEDIUM|LOW] [--ack-low-confidence]',
        );
        process.exit(2);
    }
    verify(
        flag('--feature-id') || getEnvVar('featureId') || '',
        flag('--run-id') || getEnvVar('__runId') || '',
        flag('--cmd') || getEnvVar('verificationCmd') || '',
        flag('--spur-bin') || getEnvVar('spurBin') || '',
        resolveModuleMode(flag('--module-mode')),
        flag('--confidence') || getEnvVar('confidence') || '',
        args.includes('--ack-low-confidence') || getEnvVar('ackLowConfidence') === 'true',
    )
        .then(() => process.exit(0))
        .catch((err: unknown) => {
            console.error(`feature-verification-steps: ${String(err)}`);
            process.exit(1);
        });
}

main();
