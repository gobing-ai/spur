/**
 * `spur agent usage` command tests (B6 0892 R7): fixture + stubbed source
 * coverage of R1 (capture → snapshot → quota observations → drain apply),
 * R2 (dry-run writes nothing) and R3 (fail-closed on missing binary or
 * unparsable payload; per-provider error entries never treated as recovery).
 * R4 (serve never schedules the producer) is asserted by the grep test below.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UsageSource } from '@gobing-ai/spur-app';
import { runAgentUsageProducer, UsageSourceError } from '@gobing-ai/spur-app';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { main } from '../../src';
import { setAgentUsageSourceForTesting } from '../../src/commands/agent';
import { EMBEDDED_SPUR_SCHEMAS } from '../../src/config/embedded-schemas';
import { type CliContext, createCliContext } from '../../src/context';
import { createCapturedOutput } from '../helpers';

const FIXTURE_PATH = join(import.meta.dir, '..', 'fixtures', 'codexbar-usage.json');

/** Source stub serving a canned capture (or throwing like a missing binary). */
function stubSource(
    behavior: () =>
        | { stdout: string; stderr: string; exitCode?: number }
        | Promise<{
              stdout: string;
              stderr: string;
              exitCode?: number;
          }>,
): UsageSource {
    return {
        name: 'codexbar',
        capture: async () => {
            const out = await behavior();
            return { exitCode: out.exitCode ?? 0, stdout: out.stdout, stderr: out.stderr };
        },
    };
}

async function fixtureStdout(): Promise<string> {
    return readFile(FIXTURE_PATH, 'utf8');
}

/**
 * Project with executors exercising every mapping rule: claude → claude-exec
 * (agent match); codex → codex-exec (pre-existing quota disable to recover);
 * openai → openai-model-exec (model prefix, but the openai PROVIDER ERRORED in
 * the fixture → no observation); operator-exec (operator disable survives).
 * grok/zed/antigravity stay unmapped.
 */
async function makeProjectCtx(): Promise<{
    cwd: string;
    home: string;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-agent-usage-'));
    const home = await mkdtemp(join(tmpdir(), 'spur-agent-usage-home-'));
    const out = createCapturedOutput();
    await mkdir(join(cwd, '.spur'), { recursive: true });
    await writeFile(
        join(cwd, '.spur', 'config.yaml'),
        [
            // Minimal app-shell sections so main()'s runNodeApplication bootstrap
            // (configFile present branch) starts cleanly — same shape as real
            // projects / bootstrap.test.ts's accepted minimal config.
            'version: "1.2"',
            'name: usage-test',
            'bootstrap:',
            '  logging:',
            '    enabled: false',
            '  telemetry:',
            '    enabled: false',
            '  database:',
            '    enabled: false',
            '  scheduler:',
            '    enabled: false',
            'agent:',
            '  executors:',
            '    - name: claude-exec',
            '      agent: claude',
            '    - name: codex-exec',
            '      agent: codex',
            '      disabled:',
            '        owner: quota',
            '        since: 2026-09-17T00:00:00.000Z',
            '        reason: codexbar codex exhausted',
            '    - name: openai-model-exec',
            '      agent: codex',
            '      model: openai/gpt-5.2',
            '    - name: operator-exec',
            '      agent: claude',
            '      disabled: true',
        ].join('\n'),
    );
    return {
        cwd,
        home,
        out,
        cleanup: async () => {
            await rm(cwd, { recursive: true, force: true });
            await rm(home, { recursive: true, force: true });
        },
    };
}

/** Minimal CliContext for the producer (same shape the CLI action passes). */
function producerContext(cwd: string, out: ReturnType<typeof createCapturedOutput>): CliContext {
    return createCliContext({
        cwd,
        output: out,
        dbUrl: ':memory:',
        // Composition-root-style re-load accessor (0799/ADR-082): fresh read of
        // the project layer, null on failure — not the boot-snapshot default.
        loadAgentConfig: (projectRoot) =>
            loadSpurConfig(projectRoot, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS }).catch(() => null),
    });
}

describe('spur agent usage (0892)', () => {
    test('R1: captures the fixture, writes the snapshot, recovers the quota disable, keeps operator-owned', async () => {
        const { cwd, home, out, cleanup } = await makeProjectCtx();
        try {
            const ctx = producerContext(cwd, out);
            const snapshotPath = join(home, '.config', 'spur', 'agent-usage.json');
            const result = await runAgentUsageProducer(
                {
                    getDb: () => ctx.getDb(),
                    projectRoot: cwd,
                    loadAgentConfig: ctx.loadAgentConfig,
                    warn: (m) => ctx.output.error(`Warning: ${m}`),
                },
                {
                    source: stubSource(async () => ({ stdout: await fixtureStdout(), stderr: '' })),
                    snapshotPath,
                    now: () => new Date('2026-09-18T05:00:00.000Z'),
                },
            );
            // Snapshot written atomically with the documented shape.
            const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
                captured_at: string;
                source: string;
                providers: Array<{ provider: string; status: string; mappedExecutors: string[] }>;
                raw: unknown;
            };
            expect(snapshot.source).toBe('codexbar');
            expect(snapshot.captured_at).toBe('2026-09-18T05:00:00.000Z');
            expect(Array.isArray(snapshot.raw)).toBe(true);
            const byProvider = new Map(snapshot.providers.map((p) => [p.provider, p]));
            expect(byProvider.get('zed')?.status).toBe('exhausted');
            expect(byProvider.get('zed')?.mappedExecutors).toEqual([]); // unmapped, listed not guessed
            expect(byProvider.get('openai')?.status).toBe('error');
            expect(byProvider.get('grok')?.status).toBe('headroom');
            // Observations recorded + drained for mapped executors.
            const changes = new Map(result.changes.map((c) => [c.executor, c]));
            expect(changes.get('claude-exec')?.action).toBe('no-op'); // headroom, already enabled
            expect(changes.get('codex-exec')?.action).toBe('applied'); // quota disable → recovery
            expect(changes.get('codex-exec')?.to).toBe('enabled');
            expect(changes.get('codex-exec')?.reason).toContain('codexbar codex headroom');
            expect(changes.get('openai-model-exec')?.action).toBe('no-op'); // openai ERRORED → no observation
            expect(result.drain?.applied).toBe(1);
            // Drain really wrote the project YAML: quota disable recovered, operator disable intact.
            const text = await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8');
            expect(text).not.toContain('owner: quota'); // the only quota disable was recovered
            expect(text).toContain('disabled: true'); // operator-owned, never overridden
            expect(result.unmappedProviders.sort()).toEqual(['antigravity', 'grok', 'zed'].sort());
        } finally {
            await cleanup();
        }
    });

    test('R1: an exhausted mapped provider disables its executor (quota object, window + resetsAt in reason)', async () => {
        const { cwd, home, out, cleanup } = await makeProjectCtx();
        try {
            const ctx = producerContext(cwd, out);
            const snapshotPath = join(home, '.config', 'spur', 'agent-usage.json');
            const entries = JSON.parse(await fixtureStdout()) as Array<Record<string, unknown>>;
            for (const entry of entries) {
                if (entry.provider === 'claude') {
                    (entry.usage as Record<string, unknown>).primary = {
                        resetsAt: '2026-09-18T06:00:00Z',
                        windowMinutes: 300,
                        usedPercent: 100,
                        resetDescription: 'exhausted',
                    };
                }
            }
            const result = await runAgentUsageProducer(
                {
                    getDb: () => ctx.getDb(),
                    projectRoot: cwd,
                    loadAgentConfig: ctx.loadAgentConfig,
                    warn: (m) => ctx.output.error(`Warning: ${m}`),
                },
                {
                    source: stubSource(() => ({ stdout: JSON.stringify(entries), stderr: '' })),
                    snapshotPath,
                },
            );
            const change = result.changes.find((c) => c.executor === 'claude-exec');
            expect(change?.action).toBe('applied');
            expect(change?.to).toBe('disabled(quota)');
            expect(change?.reason).toContain('primary window usedPercent 100%');
            expect(change?.reason).toContain('resetsAt 2026-09-18T06:00:00Z');
            const text = await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8');
            // The drain writes the quota-owned disable in its canonical event shape
            // (agent.quota.*; the window/resetsAt detail lives on the observation row
            // and the change listing above).
            expect(text).toContain('owner: quota');
            expect(text).toContain('agent.quota.exhausted claude-exec');
        } finally {
            await cleanup();
        }
    });

    test('R2: dry run prints changes and writes neither snapshot nor config', async () => {
        const { cwd, home, out, cleanup } = await makeProjectCtx();
        try {
            const snapshotPath = join(home, '.config', 'spur', 'agent-usage.json');
            const before = await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8');
            const fixture = await fixtureStdout();
            setAgentUsageSourceForTesting({
                source: stubSource(() => ({ stdout: fixture, stderr: '' })),
                snapshotPath,
            });
            const code = await main(['agent', 'usage', '--dry-run'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const printed = out.messages.join('\n');
            expect(printed).toContain('codex-exec: disabled(quota) → enabled');
            expect(printed).toContain('Dry run: nothing written');
            expect(printed).toContain('Unmapped providers (never guessed):');
            await expect(readFile(snapshotPath, 'utf8')).rejects.toThrow();
            expect(await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8')).toBe(before);
        } finally {
            setAgentUsageSourceForTesting(undefined);
            await cleanup();
        }
    });

    test('R3: a missing binary exits 1 with the cause on stderr; nothing changed', async () => {
        const { cwd, home, out, cleanup } = await makeProjectCtx();
        try {
            const snapshotPath = join(home, '.config', 'spur', 'agent-usage.json');
            const before = await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8');
            setAgentUsageSourceForTesting({
                source: {
                    name: 'codexbar',
                    capture: async () => {
                        throw new UsageSourceError(
                            'failed to launch `codexbar usage --format json --provider all`: ENOENT — install codexbar or fix PATH',
                        );
                    },
                },
                snapshotPath,
            });
            const code = await main(['agent', 'usage'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toContain('ENOENT');
            await expect(readFile(snapshotPath, 'utf8')).rejects.toThrow();
            expect(await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8')).toBe(before);
        } finally {
            setAgentUsageSourceForTesting(undefined);
            await cleanup();
        }
    });

    test('R3: unparsable output fails closed even with exit 0; rc=1 with a parsable array still applies', async () => {
        const { cwd, home, out, cleanup } = await makeProjectCtx();
        try {
            const snapshotPath = join(home, '.config', 'spur', 'agent-usage.json');
            setAgentUsageSourceForTesting({
                source: stubSource(() => ({ stdout: 'not json at all', stderr: 'boom' })),
                snapshotPath,
            });
            const code = await main(['agent', 'usage'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toContain('not valid JSON');
            const fixture = await fixtureStdout();
            setAgentUsageSourceForTesting({
                source: stubSource(() => ({ stdout: fixture, stderr: '', exitCode: 1 })),
                snapshotPath,
            });
            const code2 = await main(['agent', 'usage'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code2).toBe(0);
            expect(await readFile(snapshotPath, 'utf8')).toContain('"source": "codexbar"');
        } finally {
            setAgentUsageSourceForTesting(undefined);
            await cleanup();
        }
    });

    test('R4: the serve module never references the producer (no scheduler in spur serve)', async () => {
        const serveModule = await readFile(join(import.meta.dir, '..', '..', 'src', 'commands', 'serve.ts'), 'utf8');
        expect(serveModule).not.toContain('codexbar');
        expect(serveModule).not.toContain('agent-usage');
    });
});
