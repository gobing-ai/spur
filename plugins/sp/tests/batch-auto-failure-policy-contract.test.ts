import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const REFERENCES = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references');
const EXECUTION_BATCH = join(REFERENCES, 'execution-batch.md');
const EXECUTION_BATCH_REPORT = join(REFERENCES, 'execution-batch-report.md');
const FLAG_GLOSSARY = join(REFERENCES, 'flag-glossary.md');
const DEV_OPERATIONS = join(REFERENCES, 'dev-operations.md');
const DEV_RUNALL = join(ROOT, 'plugins', 'sp', 'commands', 'dev-runall.md');

// 1318 — an unattended batch must not stop for a human, and `--agent auto` must be resolved once
// per batch instead of once per task. The batch driver is the skill-defined loop in
// execution-batch.md, so the rules are enforced as a doc contract: the four owning surfaces must
// state the auto-implies-keep-going policy (R1), the executor pin and its trace source (R2), the
// `failed-agent`-only retry (R3), and the report's pin line/column (R4).

describe('task 1318 — auto batch failure policy and the executor pin', () => {
    const executionBatch = readFileSync(EXECUTION_BATCH, 'utf8');
    const report = readFileSync(EXECUTION_BATCH_REPORT, 'utf8');
    const glossary = readFileSync(FLAG_GLOSSARY, 'utf8');
    const devOperations = readFileSync(DEV_OPERATIONS, 'utf8');
    const devRunall = readFileSync(DEV_RUNALL, 'utf8');

    test('R1: `--auto` implies `--keep-going` on every owning surface, and the non-auto default still halts', () => {
        for (const [name, doc] of [
            ['execution-batch.md', executionBatch],
            ['execution-batch-report.md', report],
            ['flag-glossary.md', glossary],
            ['dev-operations.md', devOperations],
            ['dev-runall.md', devRunall],
        ] as const) {
            expect(`${name}: ${doc}`).toContain(name);
            expect(doc).toContain('`--auto` implies `--keep-going`');
        }
        // The stop-the-batch default survives for the attended profile.
        expect(executionBatch).toContain('without `--auto`');
        expect(executionBatch).not.toMatch(/`--keep-going` is the only way/);
    });

    test('R2: `--agent auto` pins one executor for the batch, resolved from the implement trace event', () => {
        expect(executionBatch).toContain('result.executor');
        expect(executionBatch).toContain('`--agent <that executor>`');
        expect(devRunall).toContain('result.executor');
        expect(glossary).toContain('Executor pin');
    });

    test('R3: only `failed-agent` re-dispatches, exactly once, and the new executor becomes the pin', () => {
        expect(executionBatch).toContain('failed-agent');
        expect(executionBatch).toContain('exactly once');
        // A different terminal reason must never trigger the fallback.
        expect(executionBatch).toContain('No other terminal reason');
    });

    test('R4: the report carries the executor pin header line, an executor column and the auto mode value', () => {
        expect(report).toContain('Executor pin: <name>');
        expect(report).toContain('| Executor');
        expect(report).toContain('Mode: --auto (keep-going)');
    });
});
