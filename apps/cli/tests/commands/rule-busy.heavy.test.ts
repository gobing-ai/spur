/**
 * Integration proof that the rule-run path's db connection honors
 * `SQLITE_BUSY_TIMEOUT_MS` (task 0801 R1a).
 */
import { describe, expect, test } from 'bun:test';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { createTempProject } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('rule run SQLITE_BUSY busy-wait integration', () => {
    test('rule run waits out a busy window held by another writer (does not throw SQLITE_BUSY)', async () => {
        const cwd = await createTempProject();
        const dbUrl = `${cwd}/busy-wait.db`;
        const file = `${cwd}/rules.yaml`;
        await Bun.write(
            file,
            [
                'rules:',
                '  - id: sample-rule',
                '    description: Sample rule',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - package.json',
            ].join('\n'),
        );
        await Bun.write(`${cwd}/package.json`, '{"name":"fixture","type":"module"}\n');

        // Prime the schema so the child sees the migrated table set on first open.
        await main(['rule', 'trace'], { cwd, output: nullOutput(), dbUrl });

        const holdMs = 4000;
        const child = Bun.spawn(
            [
                'bun',
                '-e',
                `const { Database } = require('bun:sqlite');
const db = new Database(${JSON.stringify(dbUrl)});
db.exec('BEGIN IMMEDIATE');
db.exec(\`INSERT INTO rule_runs (id, preset, source_kind, status, started_at, created_at, updated_at) VALUES ('child-holder', 'recommended-pre-check', 'preset', 'done', '2026-01-01T00:00:00Z', datetime('now'), datetime('now'))\`);
process.stdout.write('locked\\n');
setTimeout(() => {
  db.exec('COMMIT');
  db.close();
  process.exit(0);
}, ${holdMs});`,
            ],
            { stderr: 'inherit' },
        );
        // Wait for the child's readiness signal before timing the parent's run.
        await new Promise<void>((resolve) => {
            (child.stdout as ReadableStream<Uint8Array>)
                .getReader()
                .read()
                .then(() => resolve());
        });

        const t0 = performance.now();
        const exitCode = await main(['rule', 'run', '--file', file, '--json'], {
            cwd,
            output: nullOutput(),
            dbUrl,
        });
        const elapsedMs = performance.now() - t0;
        await child.exited;

        // Rule run must NOT throw SQLITE_BUSY: it must wait and succeed (exit 0).
        expect(exitCode).toBe(0);
        expect(elapsedMs).toBeGreaterThanOrEqual(2000);
        expect(elapsedMs).toBeLessThan(30000);
    }, 20000);
});
