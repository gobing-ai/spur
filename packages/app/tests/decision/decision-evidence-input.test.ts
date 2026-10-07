import { describe, expect, test } from 'bun:test';
import { readDecisionEvidence } from '../../src/decision/decision-evidence-input';

describe('readDecisionEvidence (task 1094 R3)', () => {
    test('reads, redacts and bounds each declared file in order', async () => {
        const long = 'x'.repeat(3000);
        const evidence = await readDecisionEvidence(['/tmp/a.md', '/tmp/b.md'], async (path) =>
            path === '/tmp/a.md' ? 'token: sk-abc123' : long,
        );
        expect(evidence).toHaveLength(2);
        expect(evidence[0]).toBe('[REDACTED]');
        // redactAndBound appends an ellipsis after the 2000-char slice.
        expect(evidence[1]?.length).toBeLessThanOrEqual(2001);
    });

    test('unreadable file throws the shared caller-mistake message', async () => {
        await expect(
            readDecisionEvidence(['/tmp/missing.md'], async () => {
                throw new Error('ENOENT');
            }),
        ).rejects.toThrow('evidence file "/tmp/missing.md" is unreadable');
    });
});
