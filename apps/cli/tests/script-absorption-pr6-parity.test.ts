import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PR6_CASES } from './script-absorption-pr6/cases';
import { type Observation, runSide } from './script-absorption-pr6/harness';

/**
 * Script-absorption PR-6 parity: every case frozen from the retired plugin scripts
 * (`fixtures/script-absorption-pr6-golden.json`, captured by `script-absorption-pr6/capture.ts`
 * from the stack base before deletion) is replayed through `spur history anatomy|timeline|summary`
 * / `spur workflow summary|profile` and must produce the same exit code, stdout and — after the
 * rewrites below, which only rename the retired script in its usage and error prefixes — the
 * same stderr.
 */
const GOLDEN = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures', 'script-absorption-pr6-golden.json'), 'utf8'),
) as { cases: Record<string, Observation> };

const FIXTURES = join(import.meta.dir, 'fixtures', 'script-absorption-pr6');

/** Legacy script names → the spur verb that replaced them (usage text and error prefixes only). */
const RENAMES: readonly [string, string][] = [
    // `paths` no longer requires --helper (it defaults to the running spur) and gained --skill-dir.
    [
        'usage: <script> paths --helper <p> --out <env> ',
        'usage: spur history anatomy paths --out <env> [--skill-dir <d>] [--helper <p>] ',
    ],
    ['usage: <script> ', 'usage: spur history anatomy '],
    ['session-timeline: ', 'spur history timeline: '],
    ['usage: run-summary ', 'usage: spur workflow summary '],
    ['run-summary: ', 'spur workflow summary: '],
    ['workflow-step-profile: ', 'spur workflow profile: '],
];

function rewrite(stderr: string): string {
    return RENAMES.reduce((text, [from, to]) => text.replaceAll(from, to), stderr);
}

describe('spur history anatomy|timeline|summary | workflow summary|profile golden parity (script-absorption PR-6)', () => {
    test('the fixture covers every case exactly', () => {
        expect(Object.keys(GOLDEN.cases).sort()).toEqual(PR6_CASES.map((c) => c.name).sort());
    });

    for (const c of PR6_CASES) {
        test(c.name, () => {
            const want = GOLDEN.cases[c.name] as Observation;
            const got = runSide(c, 'cli', { fixtures: FIXTURES });
            const where = `spur ${c.cli.join(' ')}`;
            expect({ where, exitCode: got.exitCode }).toEqual({ where, exitCode: want.exitCode });
            const mode = c.compare ?? 'full';
            const wantStdout = (c.stdoutDelta ?? []).reduce((text, [from, to]) => text.replace(from, to), want.stdout);
            if (mode !== 'exit') expect({ where, stdout: got.stdout }).toEqual({ where, stdout: wantStdout });
            if (mode === 'full') expect({ where, stderr: got.stderr }).toEqual({ where, stderr: rewrite(want.stderr) });
        }, 30_000);
    }
});
