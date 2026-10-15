import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOGFOOD_GATE_USAGE, DOGFOOD_VALIDATE_USAGE } from '@gobing-ai/spur-app/dogfood';
import { PR7_CASES } from './script-absorption-pr7/cases';
import { type Observation, runSide } from './script-absorption-pr7/harness';

/**
 * Script-absorption PR-7 parity: every case frozen from the retired plugin scripts
 * (`fixtures/script-absorption-pr7-golden.json`, captured from origin/main by
 * `script-absorption-pr7/capture.ts`) is replayed through `spur agent dogfood` / `spur builder pr`
 * and must produce the same exit code, stdout and — after the rewrites below, which only rename
 * the retired script in its usage text — the same stderr.
 */
const GOLDEN = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures', 'script-absorption-pr7-golden.json'), 'utf8'),
) as { cases: Record<string, Observation> };

const FIXTURES = join(import.meta.dir, '..', '..', '..', 'packages', 'app', 'tests', 'services', 'dogfood', 'fixtures');

const LEGACY_GATE_USAGE = `Usage:
  bun plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts \\
    --testee "<testee string>" [--max-retry-present] [--steps "s1||s2"] [--json]`;
const LEGACY_VALIDATE_USAGE_HEAD = `Usage:
  bun plugins/sp/scripts/dogfood-testing/validate-report.ts --file <report.md> [--json]`;

function rewrite(stderr: string): string {
    return stderr
        .replace(LEGACY_GATE_USAGE, DOGFOOD_GATE_USAGE.split('\n\n')[0] ?? '')
        .replace(LEGACY_VALIDATE_USAGE_HEAD, DOGFOOD_VALIDATE_USAGE.split('\n\n')[0] ?? '');
}

describe('spur agent dogfood | builder pr golden parity (script-absorption PR-7)', () => {
    test('the fixture covers every case exactly', () => {
        expect(Object.keys(GOLDEN.cases).sort()).toEqual(PR7_CASES.map((c) => c.name).sort());
    });

    for (const c of PR7_CASES) {
        test(c.name, () => {
            const want = GOLDEN.cases[c.name] as Observation;
            const got = runSide(c, 'cli', { fixtures: FIXTURES });
            const where = `spur ${c.cli.join(' ')}`;
            expect({ where, exitCode: got.exitCode }).toEqual({ where, exitCode: want.exitCode });
            const mode = c.compare ?? 'full';
            if (mode !== 'exit') expect({ where, stdout: got.stdout }).toEqual({ where, stdout: want.stdout });
            if (mode === 'full') expect({ where, stderr: got.stderr }).toEqual({ where, stderr: rewrite(want.stderr) });
        }, 30_000);
    }
});
