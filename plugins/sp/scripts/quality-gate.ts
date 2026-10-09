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
import { resolveReceiptReuse, runDeferredGate, runLightGate, runQualityGate } from '../lib/quality-gate.generated.mjs';

export * from '../lib/quality-gate.generated.mjs';

export const QUALITY_GATE_USAGE =
    'usage: quality-gate.ts <run|recheck|light|deferred|status>  (env: wbs, qualityGateCmd, gateProbeCmd, proofDigest, runId)';

export function main(
    argv: string[],
    rawEnv: Partial<QualityGateEnv> = getEnvVars(),
    options: QualityGateOptions = {},
): number {
    const mode = argv[0];
    if (mode !== 'run' && mode !== 'recheck' && mode !== 'light' && mode !== 'deferred' && mode !== 'status') {
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
    } else if (mode === 'deferred') {
        // 1111 R1: light tier for per-task feedback, `DEFERRED`/`FAIL` for the status token —
        // exit 0 on DEFERRED so the YAML's `; exit 0` wrapper and the action result agree.
        return runDeferredGate(env, options).status === 'DEFERRED' ? 0 : 1;
    } else if (mode === 'status') {
        const runDir = join(options.cwd ?? '.', '.spur', 'run');
        // Task 1136 R3: the gate owns its reuse identity — recompute the proof-input fingerprint
        // before consulting the receipt, so a caller-copied digest can never trigger reuse.
        const decision = resolveReceiptReuse(
            join(runDir, `${env.wbs}-check-receipt.json`),
            env,
            options.cwd ?? process.cwd(),
            options.recomputeFingerprint,
        );
        const verdict = decision.receiptStatus;
        if (decision.refusal !== undefined) {
            const line = `check.reuse-refused — ${decision.refusal}\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(join(runDir, `${env.wbs}-test-gate.log`), line);
        } else if (verdict.reuse) {
            // 0940 R3: reuse is observable in the gate log and on stdout (the action result
            // `data`); the `{reuse, reason}` JSON stays the last stdout line for machine readers.
            const line = `check.reused — full-tier receipt reused for input digest ${env.proofDigest ?? ''}\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(join(runDir, `${env.wbs}-test-gate.log`), line);
        }
        process.stdout.write(`${JSON.stringify(verdict)}\n`);
    } else {
        return runQualityGate(mode, env, options).status === 'PASS' ? 0 : 1;
    }
    return 0;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
