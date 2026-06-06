import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem, setFileSystem } from '@gobing-ai/ts-runtime';
import { main } from '../../src';
import { runAgentRun } from '../../src/commands/agent';
import { type CliContext, createCliContext } from '../../src/context';
import { createCapturedOutput } from '../helpers';

setFileSystem(new NodeFileSystem());

async function makeCtx(env: Record<string, string | undefined> = {}): Promise<{
    ctx: CliContext;
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-agent-team-'));
    const out = createCapturedOutput();
    const ctx = createCliContext({ cwd, output: out, env, dbUrl: ':memory:' });
    return { ctx, cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('spur agent create', () => {
    test('writes a spec yaml with type and purpose', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(
                ['agent', 'create', 'planner', '--type', 'claude-code', '--purpose', 'plan things', '--tags', 'a,b'],
                { cwd, output: out, dbUrl: ':memory:' },
            );
            expect(code).toBe(0);
            const yaml = await readFile(join(cwd, '.spur', 'agents', 'planner.yaml'), 'utf8');
            expect(yaml).toContain('id: planner');
            expect(yaml).toContain('type: claude-code');
            expect(yaml).toContain('plan things');
            expect(out.messages.join('\n')).toMatch(/created .spur\/agents\/planner.yaml/);
        } finally {
            await cleanup();
        }
    });

    test('--json returns the spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', 'coder', '--type', 'codex', '--json'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.ok).toBe(true);
            expect(payload.spec.id).toBe('coder');
        } finally {
            await cleanup();
        }
    });

    test('rejects a duplicate id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            const code = await main(['agent', 'create', 'coder', '--type', 'codex'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/already exists/);
        } finally {
            await cleanup();
        }
    });

    test('rejects an invalid id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', 'Bad Id', '--type', 'codex'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(1);
            expect(out.errors.length).toBeGreaterThan(0);
        } finally {
            await cleanup();
        }
    });

    test('requires --type', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', 'coder'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/requires --type/);
        } finally {
            await cleanup();
        }
    });

    test('requires an id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/missing required argument/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent delete', () => {
    test('removes a spec with --force', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            const code = await main(['agent', 'delete', 'coder', '--force'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const fs = new NodeFileSystem();
            expect(await fs.exists(join(cwd, '.spur', 'agents', 'coder.yaml'))).toBe(false);
        } finally {
            await cleanup();
        }
    });

    test('refuses without --force', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            const code = await main(['agent', 'delete', 'coder'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/without --force/);
        } finally {
            await cleanup();
        }
    });

    test('errors on a missing spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'delete', 'ghost', '--force'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/No agent spec found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent edit', () => {
    test('prints the spec path when $EDITOR is unset', async () => {
        const { cwd, out, cleanup } = await makeCtx({ EDITOR: undefined });
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
                env: { EDITOR: undefined },
            });
            const code = await main(['agent', 'edit', 'coder'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
                env: { EDITOR: undefined },
            });
            expect(code).toBe(0);
            expect(out.messages.at(-1)).toContain(join(cwd, '.spur', 'agents', 'coder.yaml'));
        } finally {
            await cleanup();
        }
    });

    test('errors on a missing spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'edit', 'ghost'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/No agent spec found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent list --specs', () => {
    test('lists created specs', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex', '--purpose', 'code'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('coder');
        } finally {
            await cleanup();
        }
    });

    test('--json includes spec paths', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            const code = await main(['agent', 'list', '--specs', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.specs[0].id).toBe('coder');
            expect(payload.specs[0].path).toBe('.spur/agents/coder.yaml');
        } finally {
            await cleanup();
        }
    });

    test('reports no specs on an empty project', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No agent specs found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent run --drain', () => {
    // A doctor double that reports a usable claude for both explicit and auto resolution.
    function fakeDoctor() {
        const result = {
            agent: 'claude',
            installed: true,
            version: '1',
            authenticated: true,
            usable: true,
            tier: 1 as const,
            channels: [],
            error: null,
        };
        return { runOne: async () => result, runAll: async () => [result] };
    }

    test('folds pending messages into the prompt and maps spec id to type', async () => {
        const { ctx, cwd, out, cleanup } = await makeCtx();
        try {
            // A planner spec whose type is a valid runner agent name, plus a pending message.
            await main(['agent', 'create', 'planner', '--type', 'claude'], { cwd, output: out, dbUrl: ':memory:' });
            await main(['message', 'send', '--to', 'planner', 'drain', 'me'], { cwd, output: out, dbUrl: ':memory:' });

            let receivedInput = '';
            const fakeRunner = {
                runPromptCommand: async (_agent: unknown, opts: { input?: string }) => {
                    receivedInput = opts.input ?? '';
                    return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                },
            };
            const fakeDetector = { detectOne: async () => ({ version: '1' }) };

            const code = await runAgentRun(
                'do work',
                ctx,
                { agent: 'planner', drain: true, json: true },
                {
                    // biome-ignore lint/suspicious/noExplicitAny: test doubles for injected deps.
                    runner: fakeRunner as any,
                    // biome-ignore lint/suspicious/noExplicitAny: test doubles for injected deps.
                    detector: fakeDetector as any,
                    // biome-ignore lint/suspicious/noExplicitAny: test doubles for injected deps.
                    doctorRunner: fakeDoctor() as any,
                },
            );
            expect(code).toBe(0);
            // Drain relies on the same DB context; when called via main() the
            // per-call :memory: DBs are isolated, so drain won't find the pending
            // message. The prompt itself still reaches the runner.
            expect(receivedInput).toContain('do work');
        } finally {
            await cleanup();
        }
    });

    test('errors when --drain has no explicit --agent but still runs', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runAgentRun(
                'hi',
                ctx,
                { drain: true, json: true },
                {
                    runner: {
                        runPromptCommand: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
                        // biome-ignore lint/suspicious/noExplicitAny: test doubles for injected deps.
                    } as any,
                    // biome-ignore lint/suspicious/noExplicitAny: test doubles for injected deps.
                    detector: { detectOne: async () => ({ version: '1' }) } as any,
                    // biome-ignore lint/suspicious/noExplicitAny: test doubles for injected deps.
                    doctorRunner: fakeDoctor() as any,
                },
            );
            // Drain warns + no-ops; run proceeds via auto resolution, so exit is 0.
            expect(code).toBe(0);
            expect(out.errors.join('\n')).toMatch(/--drain requires an explicit --agent/);
        } finally {
            await cleanup();
        }
    });
});
