/**
 * Golden parity for script-absorption PR-9: `spur workflow cost [--budget]` must reproduce the
 * retired `real-run-cost` / `check-pipeline-budgets` dev-scripts byte-for-byte on the same
 * seeded DB, definitions and budget file. The golden was captured from the legacy scripts by
 * `script-absorption-pr9/capture.ts`; the only documented delta is the verdict-line prefix
 * (`check-pipeline-budgets:` → `workflow cost --budget:`).
 */
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../src/index';
import { createCapturedOutput } from './helpers';
import { PR9_CASES, rewriteLegacy } from './script-absorption-pr9/cases';

const FIX = join(import.meta.dir, 'fixtures/script-absorption-pr9');
const GOLDEN = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures/script-absorption-pr9-golden.json'), 'utf-8'),
) as Record<string, { stdout: string; stderr: string; exitCode: number }>;

let scratch = '';

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd: scratch, output, env: { PATH: getEnvVars().PATH, HOME: scratch } });
    const join = (lines: string[]) => (lines.length === 0 ? '' : `${lines.join('\n')}\n`);
    return { exitCode, stdout: join(output.messages), stderr: join(output.errors) };
}

beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'pr9-parity-'));
    mkdirSync(join(scratch, 'config'), { recursive: true });
    // The command reads the project workflow layer (.spur/workflows); the budget file stays a
    // user-supplied --budget argv path, so it keeps its scratch-relative location.
    mkdirSync(join(scratch, '.spur', 'workflows'), { recursive: true });
    cpSync(join(FIX, 'workflows'), join(scratch, '.spur', 'workflows'), { recursive: true });
    cpSync(join(FIX, 'pipeline-budgets.json'), join(scratch, 'config/pipeline-budgets.json'));
    cpSync(join(FIX, 'measured-over.json'), join(scratch, 'measured-over.json'));
    // First invocation migrates the project DB; then seed the run rows.
    expect((await run(['workflow', 'cost'])).exitCode).toBe(0);
    const db = new Database(join(scratch, '.spur/spur.db'));
    db.exec(readFileSync(join(FIX, 'seed.sql'), 'utf-8'));
    db.close();
});

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

describe('script-absorption PR-9 golden parity (workflow cost)', () => {
    test('every case has a golden entry', () => {
        expect(Object.keys(GOLDEN).sort()).toEqual(PR9_CASES.map((c) => c.name).sort());
    });

    for (const c of PR9_CASES) {
        test(c.name, async () => {
            const golden = GOLDEN[c.name];
            if (golden === undefined) throw new Error(`missing golden: ${c.name}`);
            const r = await run(c.cli);
            expect(r.stdout).toBe(rewriteLegacy(golden.stdout));
            expect(r.stderr).toBe(rewriteLegacy(golden.stderr));
            expect(r.exitCode).toBe(golden.exitCode);
        });
    }
});
