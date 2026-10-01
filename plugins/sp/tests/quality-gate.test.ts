import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, QUALITY_GATE_USAGE } from '../scripts/quality-gate';

// Task 1006 R1: the gate's behavioral suite moved with the core to
// packages/app/tests/services/quality-gate.test.ts; this file pins only the script glue —
// `main` is the plugin surface the generated twin invokes, so its argv/env validation and
// usage text stay contract-tested here.
test('main: run and recheck return the gate failure exit code in the selected cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-gate-main-'));
    const original = process.stdout.write;
    process.stdout.write = () => true;
    try {
        for (const mode of ['run', 'recheck']) {
            expect(main([mode], { wbs: '1033', qualityGateCmd: 'exit 1' }, { cwd: dir })).toBe(1);
            expect(main([mode], { wbs: '1033', qualityGateCmd: 'exit 0' }, { cwd: dir })).toBe(0);
            expect(main([mode], { wbs: '1033', qualityGateCmd: '' }, { cwd: dir })).toBe(1);
        }
    } finally {
        process.stdout.write = original;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('main: a bad mode and a missing wbs each exit 2 with the reason on stderr', () => {
    const writes: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: Uint8Array | string): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
        return true;
    }) as typeof process.stderr.write;
    try {
        expect(main([], { wbs: '' })).toBe(2);
        expect(writes.join('')).toBe(`${QUALITY_GATE_USAGE}\n`);
        expect(main(['run'], { wbs: '' })).toBe(2);
        expect(writes.join('')).toContain('quality-gate: env `wbs` is required\n');
    } finally {
        process.stderr.write = original;
    }
});
