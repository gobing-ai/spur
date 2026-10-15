/**
 * CLI argv / exit-code contract for `spur agent dogfood gate`.
 * Absorbed from plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts (script-absorption PR-7).
 */
import { evaluateDogfoodGate } from './pipeline-detect';

/** Parsed `spur agent dogfood gate` arguments. */
export interface DogfoodGateCliArgs {
    testee: string | null;
    maxRetryPresent: boolean;
    steps: string[];
    json: boolean;
    help: boolean;
}

/** Parse CLI argv (everything after the verb). Exported for unit tests. */
export function parseDogfoodGateArgs(argv: readonly string[]): DogfoodGateCliArgs {
    let testee: string | null = null;
    let maxRetryPresent = false;
    let steps: string[] = [];
    let json = false;
    let help = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === undefined) continue;
        if (a === '--help' || a === '-h') {
            help = true;
        } else if (a === '--json') {
            json = true;
        } else if (a === '--max-retry-present') {
            maxRetryPresent = true;
        } else if (a === '--testee') {
            testee = argv[++i] ?? null;
        } else if (a === '--steps') {
            const raw = argv[++i] ?? '';
            steps =
                raw.length === 0
                    ? []
                    : raw
                          .split('||')
                          .map((s) => s.trim())
                          .filter(Boolean);
        } else if (a === '--') {
            testee = argv.slice(i + 1).join(' ');
            break;
        } else if (!a.startsWith('-') && testee === null) {
            testee = a;
        }
    }

    return { testee, maxRetryPresent, steps, json, help };
}

/** Usage text for `spur agent dogfood gate`. */
export const DOGFOOD_GATE_USAGE = `Usage:
  spur agent dogfood gate --testee "<testee string>" [--max-retry-present] [--steps "s1||s2"] [--json]

Exit codes:
  0  proceed (stdout may carry implement-heavy advisory)
  2  refuse — pipeline-driving OR mutating --fix mode without --max-retry
  1  usage error

Phase 1.0: run BEFORE deriving steps (omit --steps).
Phase 1 W8: re-run AFTER step derivation with --steps "label1||label2".`;

/**
 * Pure CLI runner for tests: returns { exitCode, stdout, stderr } without
 * process.exit / console I/O side effects.
 */
export function runDogfoodGateCli(argv: readonly string[]): {
    exitCode: number;
    stdout: string;
    stderr: string;
} {
    const { testee, maxRetryPresent, steps, json, help } = parseDogfoodGateArgs(argv);
    if (help) {
        return { exitCode: 0, stdout: '', stderr: DOGFOOD_GATE_USAGE };
    }
    if (testee === null || testee.length === 0) {
        return { exitCode: 1, stdout: '', stderr: DOGFOOD_GATE_USAGE };
    }

    const result = evaluateDogfoodGate(testee, { maxRetryPresent, steps });
    if (json) {
        return { exitCode: result.exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' };
    }
    if (result.message) {
        return { exitCode: result.exitCode, stdout: `${result.message}\n`, stderr: '' };
    }
    return { exitCode: result.exitCode, stdout: '', stderr: '' };
}
