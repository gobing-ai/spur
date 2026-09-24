/**
 * record-feature-sync — record-step post-record feature sync owner (tasks 0328 / 0411 / 0931).
 *
 * Extracted from the record onEnter shell (0931 R5): ADR-115 caps one workflow shell at 10
 * logical commands and 800 chars, and the deferFeatureSync guard plus the sync chain can no
 * longer share it. The pipeline shell resolves this script (in-repo first, superskill-staged
 * .mjs fallback), notes a deferral, and delegates the rest here:
 *
 * - A task with no feature_id gets the orphan proposal note (0328).
 * - The sync routes through feature-sync-bounded.ts (0411 retry suppression), then the
 *   superskill-staged module, then bare `spur feature sync` (0328).
 * - Best-effort by contract: a sync failure never fails the record step.
 *
 * Node-builtin imports only (ADR-065): this file is transpiled to a node-runnable .mjs twin
 * by `superskill script convert`. Env: wbs (required), spurBin (default "spur"); the
 * `--spur-bin <bin>` argument wins over the env var.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { getEnvVar } from '../lib/env';

function resolveSpurBin(argv: string[]): string {
    const flag = argv.indexOf('--spur-bin');
    const value = flag !== -1 ? argv[flag + 1] : undefined;
    return value ?? getEnvVar('spurBin') ?? 'spur';
}

function main(): void {
    const argv = process.argv.slice(2);
    const spurBin = resolveSpurBin(argv);
    const wbs = getEnvVar('wbs') ?? '';
    if (wbs.length === 0) {
        console.error('record-feature-sync: env `wbs` is required');
        process.exit(0); // best-effort contract — never fail the record step
    }

    const reportPath = `.spur/run/${wbs}-report.txt`;
    const report = (line: string): void => {
        appendFileSync(reportPath, `${line}\n`);
    };

    const show = spawnSync(spurBin, ['task', 'show', wbs, '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    let featureId = '';
    try {
        const parsed = JSON.parse(show.stdout ?? '') as {
            feature_id?: string;
            frontmatter?: { feature_id?: string };
        };
        featureId = String(parsed.feature_id ?? parsed.frontmatter?.feature_id ?? '');
    } catch {
        featureId = '';
    }

    if (featureId.length === 0) {
        report(`Orphan task ${wbs} — no feature_id linked — proposal: consider linking to a parent feature.`);
        return;
    }

    if (existsSync('plugins/sp/scripts/feature-sync-bounded.ts')) {
        spawnSync('bun', ['plugins/sp/scripts/feature-sync-bounded.ts', featureId, '--spur-bin', spurBin, '--json'], {
            stdio: 'inherit',
        });
        return;
    }

    const staged = spawnSync('superskill', ['script', 'path', 'sp', 'feature-sync-bounded.mjs'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    const stagedPath = (staged.stdout ?? '').trim();
    if (staged.status === 0 && stagedPath.length > 0 && existsSync(stagedPath)) {
        spawnSync('node', [stagedPath, featureId, '--spur-bin', spurBin, '--json'], { stdio: 'inherit' });
        return;
    }

    spawnSync(spurBin, ['feature', 'sync', featureId, '--json'], { stdio: 'inherit' });
    // Falls through with exit 0: a sync failure never fails the record step (0411).
}

main();
