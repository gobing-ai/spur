#!/usr/bin/env bun
/**
 * quality-gate — shared retry/bounded-findings gate behind the task-pipeline test-gate
 * wrappers (task 0823, feature I21, governance §1.2 composition budgets).
 *
 * Task 1006 R1: the gate logic moved to packages/app/src/services/quality-gate.ts (unit-tested
 * there); this script is ADR-130 glue — argv/env parsing only — over the bundled core in
 * ../lib/quality-gate.generated.* (regenerate: `bun run build:plugin-lib && bun run build:scripts`).
 *
 * Behavioral contract (unchanged): modes run|recheck|light|status (env: wbs, qualityGateCmd,
 * gateProbeCmd, proofDigest, runId); exit 0 on PASS/reuse, 1 on FAIL, 2 on usage error; the
 * `{reuse, reason}` JSON stays the last stdout line in status mode. Invoked from
 * task-pipeline.yaml via `superskill script path sp quality-gate.mjs` — keep the committed twin
 * in lockstep.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';
import type { QualityGateEnv, QualityGateOptions } from '../lib/quality-gate.generated.mjs';
import { readReceiptStatus, runLightGate, runQualityGate } from '../lib/quality-gate.generated.mjs';

export * from '../lib/quality-gate.generated.mjs';

export const QUALITY_GATE_USAGE =
    'usage: quality-gate.ts <run|recheck|light|status>  (env: wbs, qualityGateCmd, gateProbeCmd, proofDigest, runId)';

export function main(
    argv: string[],
    rawEnv: Partial<QualityGateEnv> = getEnvVars(),
    options: QualityGateOptions = {},
): number {
    const mode = argv[0];
    if (mode !== 'run' && mode !== 'recheck' && mode !== 'light' && mode !== 'status') {
        process.stderr.write(`${QUALITY_GATE_USAGE}\n`);
        return 2;
    }
    const wbs = rawEnv.wbs ?? '';
    if (wbs.length === 0) {
        process.stderr.write('quality-gate: env `wbs` is required\n');
        return 2;
    }
    const env: QualityGateEnv = { ...rawEnv, wbs };
    if (mode === 'light') {
        runLightGate(env);
    } else if (mode === 'status') {
        const runDir = join(options.cwd ?? '.', '.spur', 'run');
        const verdict = readReceiptStatus(join(runDir, `${env.wbs}-check-receipt.json`), env.proofDigest ?? '');
        if (verdict.reuse) {
            // 0940 R3: reuse is observable in the gate log and on stdout (the action result
            // `data`); the `{reuse, reason}` JSON stays the last stdout line for machine readers.
            const line = `check.reused — full-tier receipt reused for input digest ${env.proofDigest ?? ''}\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(join(runDir, `${env.wbs}-test-gate.log`), line);
        }
        process.stdout.write(`${JSON.stringify(verdict)}\n`);
    } else {
        runQualityGate(mode, env);
    }
    return 0;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
