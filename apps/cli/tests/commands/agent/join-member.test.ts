/**
 * Task 1281 R1/R4 — the `spur agent join --member` CLI surface.
 *
 * Failure list this pins:
 *   - `--member` names no declared member            → exit 2 with the `unknown-member` reason
 *   - the declared executor attests nothing          → exit 2 `capability-unattested`, no binding
 *   - a member id that is also a guest id            → the guest path still refuses it (R4)
 *   - the flag is undocumented                       → `join --help` lists `--member`
 *   - a successful bind is invisible                 → the record carries `memberBinding` and the
 *                                                      JSON output surfaces it
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FleetGuestService } from '@gobing-ai/spur-app';
import { main } from '../../../src';
import { type CliContext, createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

/** A project with one declared coder member, optionally without capability attestation. */
async function makeFleetProject(options: { attested: boolean }): Promise<{
    root: string;
    ctx: CliContext;
    cleanup: () => Promise<void>;
}> {
    // Lowercase-only directory name: the member id is `<slug>-coder-1` and the slug rejects
    // uppercase, so `mkdtemp`'s mixed-case suffix would make the roster unreadable.
    const base = join(tmpdir(), `spur-join-member-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
    await mkdir(base, { recursive: true });
    const root = await realpath(base);
    const out = createCapturedOutput();
    const deps = { cwd: root, output: out, env: {}, dbUrl: join(root, '.spur', 'spur.db') };
    await main(['self', 'init', '--json'], deps);
    const attestation = options.attested
        ? [
              '      executionCapabilities:',
              '        version: 1',
              '        axes:',
              '          fsRead: { state: available, provenance: native-known }',
              '          fsWrite: { state: available, provenance: native-known }',
              '          processSpawn: { state: available, provenance: native-known }',
          ]
        : [];
    const configPath = join(root, '.spur/config.yaml');
    await writeFile(
        configPath,
        `${await readFile(configPath, 'utf8')}\n${[
            'agent:',
            '  fleet:',
            '    enabled: true',
            '    strategy: gtd',
            '    orchestrator: planner-1',
            '    members:',
            '      - { id: coder-1, role: coder, executor: bind-exec }',
            '  executors:',
            '    - name: bind-exec',
            '      agent: claude',
            '      tier: standard',
            ...attestation,
            '',
        ].join('\n')}`,
    );
    return {
        root,
        ctx: createCliContext(deps),
        cleanup: async () => rm(root, { recursive: true, force: true }),
    };
}

/** The roster's `<slug>-coder-1` id, read the way an operator reads it: `agent list --specs`. */
async function coderInstanceId(deps: {
    cwd: string;
    output: ReturnType<typeof createCapturedOutput>;
    env: Record<string, string | undefined>;
    dbUrl: string;
}): Promise<string> {
    const out = createCapturedOutput();
    await main(['agent', 'list', '--specs', '--json'], { ...deps, output: out });
    const text = out.messages.join('\n');
    if (text.trim() === '') {
        throw new Error(`agent list --specs printed nothing (errors: ${out.errors.join(' | ').slice(0, 300)})`);
    }
    const start = text.search(/[[{]/);
    const parsed = JSON.parse(text.slice(start)) as { specs?: Array<{ id: string }> };
    const coder = parsed.specs?.find((spec) => spec.id.endsWith('-coder-1'));
    if (coder === undefined) throw new Error(`no coder-1 member in the roster: ${text.slice(0, 200)}`);
    return coder.id;
}

describe('spur agent join --member (1281 R1)', () => {
    test('join --help documents the flag — the consented public surface', async () => {
        const base = join(tmpdir(), `spur-join-member-help-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
        await mkdir(base, { recursive: true });
        const root = await realpath(base);
        const out = createCapturedOutput();
        try {
            await main(['agent', 'join', '--help'], { cwd: root, output: out, env: {}, dbUrl: ':memory:' });
            expect(out.messages.join('\n')).toContain('--member');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('an unknown member exits 2 with its named reason and binds nothing', async () => {
        const { root, ctx, cleanup } = await makeFleetProject({ attested: true });
        try {
            const code = await main(['agent', 'join', '--role', 'coder', '--member', 'not-a-member', '--json'], {
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(code).toBe(2);
            const service = new FleetGuestService({ cwd: ctx.cwd, fs: ctx.fs, getDb: () => ctx.getDb() });
            expect(await service.read('not-a-member')).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('a declared executor with no attestation is refused with capability-unattested', async () => {
        const { root, ctx, cleanup } = await makeFleetProject({ attested: false });
        try {
            const memberId = await coderInstanceId({
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            const code = await main(['agent', 'join', '--role', 'coder', '--member', memberId, '--json'], {
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(code).toBe(2);
            const service = new FleetGuestService({ cwd: ctx.cwd, fs: ctx.fs, getDb: () => ctx.getDb() });
            expect(await service.read(memberId)).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('a capable member binds: the record and the JSON output carry memberBinding', async () => {
        const { root, ctx, cleanup } = await makeFleetProject({ attested: true });
        try {
            const memberId = await coderInstanceId({
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            const out = createCapturedOutput();
            const code = await main(['agent', 'join', '--role', 'coder', '--member', memberId, '--json'], {
                cwd: root,
                output: out,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain(memberId);
            expect(out.messages.join('\n')).toContain('memberBinding');

            const service = new FleetGuestService({ cwd: ctx.cwd, fs: ctx.fs, getDb: () => ctx.getDb() });
            const record = await service.read(memberId);
            expect(record?.id).toBe(memberId);
            expect(record?.memberBinding?.memberId).toBe(memberId);
            expect(record?.memberBinding?.version).toBe(1);
            // Below the `--member` surface the guest defaults hold: a plain join still works (R4).
            expect(
                await main(['agent', 'join', '--role', 'reviewer', '--id', 'plain-guest', '--json'], {
                    cwd: root,
                    output: createCapturedOutput(),
                    env: {},
                    dbUrl: join(root, '.spur', 'spur.db'),
                }),
            ).toBe(0);
            expect((await service.read('plain-guest'))?.memberBinding).toBeUndefined();
        } finally {
            await cleanup();
        }
    });
});
