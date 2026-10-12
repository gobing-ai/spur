/**
 * detect-pipeline-driving — live Phase 1.0 CLI gate over the @1.2 detector (task 0277 W7).
 *
 * The detector and its policy helpers are application-owned in
 * `plugins/sp/lib/dogfood-pipeline.ts` (task 1173); this script keeps the shell entry the dogfood
 * driver calls, with argv, usage, exit codes and refusal messages unchanged. Callers and tests may
 * keep importing this path — every former export is re-exported.
 *
 *   bun plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts \
 *     --testee "/sp:dev-run 0125 --auto --next" [--max-retry-present] \
 *     [--steps "step1||step2"] [--json]
 *
 * Exit codes:
 *   0 — proceed (may print implement-heavy advisory on stderr)
 *   2 — refuse: pipeline-driving without explicit --max-retry
 *   1 — usage / argument error
 */

import { evaluateDogfoodGate } from '../../lib/dogfood-pipeline';

export * from '../../lib/dogfood-pipeline';

export interface CliArgs {
    testee: string | null;
    maxRetryPresent: boolean;
    steps: string[];
    json: boolean;
    help: boolean;
}

/** Parse CLI argv (everything after the script name). Exported for unit tests. */
export function parseCliArgs(argv: string[]): CliArgs {
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

export const CLI_USAGE = `Usage:
  bun plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts \\
    --testee "<testee string>" [--max-retry-present] [--steps "s1||s2"] [--json]

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
export function runCli(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
    const { testee, maxRetryPresent, steps, json, help } = parseCliArgs(argv);
    if (help) {
        return { exitCode: 0, stdout: '', stderr: CLI_USAGE };
    }
    if (testee === null || testee.length === 0) {
        return { exitCode: 1, stdout: '', stderr: CLI_USAGE };
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

if (import.meta.main) {
    const { exitCode, stdout, stderr } = runCli(process.argv.slice(2));
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exit(exitCode);
}
