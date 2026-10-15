import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spurConfigSchema } from '@gobing-ai/spur-config';
import { main } from '../../../src';
import { type CliContext, createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

async function makeCtx(
    env: Record<string, string | undefined> = {},
    spurConfig?: ReturnType<typeof spurConfigSchema.parse>,
): Promise<{
    ctx: CliContext;
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    // mkdtemp's random suffix is mixed-case; agent ids are lowercase-only, so the
    // project itself is a fixed lowercase dir inside the temp parent (the fleet
    // slug falls back to the directory basename when the project is unregistered).
    const root = await mkdtemp(join(tmpdir(), 'spur-agent-team-'));
    const cwd = join(root, 'alpha');
    await mkdir(cwd, { recursive: true });
    const out = createCapturedOutput();
    const ctx = createCliContext({ cwd, output: out, env, dbUrl: ':memory:', ...(spurConfig ? { spurConfig } : {}) });
    return { ctx, cwd, out, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

describe('spur agent list --specs', () => {
    test('0544 R2/R4: --specs shows role and executor as distinct fields, unset when undeclared', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await mkdir(join(cwd, '.spur'), { recursive: true });
            await writeFile(
                join(cwd, '.spur', 'config.yaml'),
                [
                    'agent:',
                    '  executors:',
                    '    - name: cheap-exec',
                    '      agent: pi',
                    '      tier: cheap',
                    '    - name: capable-exec',
                    '      agent: claude',
                    '      tier: capable-1',
                    // 0858: the roster is declared under the project's `agent.fleet`
                    // section (the retired `.spur/fleet.json` now fails the load).
                    '  fleet:',
                    '    enabled: true',
                    '    members:',
                    '      - role: reviewer',
                    '      - executor: cheap-exec',
                    '',
                ].join('\n'),
                'utf8',
            );
            // G72 R2: fleet specs are DERIVED from `agent.fleet` — nothing is written to
            // `.spur/agents/`, so the declared roster is enough for the spec listing. The
            // project dir is named `alpha`, which is the slug the unregistered project
            // falls back to (the temp-dir basename was mixed-case and invalid as an id prefix).

            // Human: distinct role and executor columns; undeclared role renders `unset`.
            out.messages.length = 0;
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const human = out.messages.join('\n');
            expect(human).toContain('reviewer');
            expect(human).toContain('capable-exec');
            expect(human).toContain('unset');

            // JSON: role and executor are distinct fields; role omitted when undeclared.
            out.messages.length = 0;
            await main(['agent', 'list', '--specs', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            const reviewer = payload.specs.find((s: { id: string }) => s.id === 'alpha-reviewer-1');
            expect(reviewer?.role).toBe('reviewer');
            expect(reviewer?.executor).toBe('capable-exec');
            const plain = payload.specs.find((s: { id: string }) => s.id === 'alpha-cheap-exec');
            expect(plain?.role).toBeUndefined();
            expect(plain?.executor).toBe('cheap-exec');
            // Fleet specs are derived in memory: no backing file, so no `path` (it would
            // name a file that does not exist); `source` says where the spec came from.
            expect(reviewer?.source).toBe('fleet');
            expect(reviewer?.path).toBeUndefined();

            out.messages.length = 0;
            await main(['agent', 'status', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            const status = JSON.parse(out.messages.at(-1) ?? '{}');
            const reviewerRow = status.agents.find((s: { id: string }) => s.id === 'alpha-reviewer-1');
            expect(reviewerRow?.source).toBe('fleet');
            expect(reviewerRow?.path).toBeUndefined();
        } finally {
            await cleanup();
        }
    });
    test('reports no specs on an empty project', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toBe('No agent specs found (.spur/agents/*.yaml or agent.fleet members)');

            out.messages.length = 0;
            expect(await main(['agent', 'status'], { cwd, output: out, dbUrl: ':memory:' })).toBe(0);
            expect(out.messages.join('\n')).toBe('No agent specs found (.spur/agents/*.yaml or agent.fleet members)');
        } finally {
            await cleanup();
        }
    });
});
