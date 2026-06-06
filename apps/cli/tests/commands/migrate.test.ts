import { describe, expect, test } from 'bun:test';
import { main } from '../../src';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('migrate command', () => {
    test('runs migration with in-memory db', async () => {
        const exitCode = await main(['migrate'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
    });
});
