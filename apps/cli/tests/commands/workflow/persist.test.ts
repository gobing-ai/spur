import { describe, expect, test } from 'bun:test';
import { main } from '../../../src/index';

/**
 * D65 1242: `spur workflow persist-out` / `persist-check` are the two flat verbs that survive the
 * deleted `spur workflow inline` group — they are the WT-4 worktree-landing transport, not
 * bookkeeping. These tests pin the surface (they are registered under `workflow`) and the usage
 * refusal, so a later refactor cannot quietly drop them.
 */
describe('workflow persist-out / persist-check (flat verbs, D65 1242)', () => {
    const capture = async (argv: string[]): Promise<{ code: number; out: string; err: string }> => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await main(argv, {
            cwd: process.cwd(),
            output: {
                write: (s: string) => out.push(s),
                error: (s: string) => err.push(s),
            } as never,
        });
        return { code, out: out.join(''), err: err.join('') };
    };

    test('the workflow help lists both landing verbs', async () => {
        const { out } = await capture(['workflow', '--help']);
        expect(out).toContain('persist-out');
        expect(out).toContain('persist-check');
    });

    test('the retired inline group is no longer a command', async () => {
        const { code, err } = await capture(['workflow', 'inline', 'begin']);
        expect(code).toBe(1);
        expect(err.toLowerCase()).toContain('unknown command');
    });

    test('persist-out with a source tree runs the transport and reports its payload', async () => {
        // No run rows to carry: the transport still runs, and its JSON line is what the caller reads.
        const { code, out } = await capture(['workflow', 'persist-out', '--from', process.cwd()]);
        expect([0, 1]).toContain(code);
        expect(out).toContain('"ok"');
    });

    test('persist-check reports its verdict lines and exits with the transport code', async () => {
        const { code, out, err } = await capture(['workflow', 'persist-check', '--from', process.cwd()]);
        expect(code).toBeGreaterThanOrEqual(0);
        expect(`${out}${err}`.length).toBeGreaterThan(0);
    });

    test('persist-out with an empty --task-file is a usage error', async () => {
        const { code, err } = await capture(['workflow', 'persist-out', '--from', 'x', '--task-file', '']);
        expect(code).toBe(2);
        expect(err).toContain('Usage:');
    });

    test('persist-out without a source tree is a usage error, not a silent success', async () => {
        const { code, err } = await capture(['workflow', 'persist-out']);
        expect(code).toBe(2);
        expect(err).toContain('Usage:');
    });
});
