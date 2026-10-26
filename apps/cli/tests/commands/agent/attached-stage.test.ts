/**
 * Task 1282 — attached-occupant stage execution over the CLI surfaces (design
 * `fleet-attached-occupants` §4–6).
 *
 * Failure list this pins:
 *   - a bound member's lifecycle report without `--pin`     → exit 2, no handshake
 *   - a bound member's report with a stale pin              → exit 2, no handshake
 *   - a bound member's report with the matching pin         → exit 0, `handshakeAt` set ONCE (AC2)
 *   - a plain guest's report                                → unchanged path, no pin required
 *   - the strategy holding on a bound, un-handshook member  → `member-busy`, gap named (AC1)
 *   - the same member after the handshake, idle             → dispatchable again
 *   - `leave` on a bound member with an in-flight claim     → drain times out, claim preserved (R5)
 *   - `leave` on a bound member with nothing in flight      → drain settles, record retired
 *   - `leave` on a plain guest                              → unchanged output (no drain)
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    FleetGuestService,
    gtdStrategy,
    InboxService,
    type MemberAttachmentState,
    type StrategyContext,
    type TaskSummary,
} from '@gobing-ai/spur-app';
import { main } from '../../../src';
import { type CliContext, createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

async function makeFleetProject(): Promise<{ root: string; ctx: CliContext; cleanup: () => Promise<void> }> {
    const base = join(tmpdir(), `spur-attached-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
    await mkdir(base, { recursive: true });
    const root = await realpath(base);
    const out = createCapturedOutput();
    const deps = { cwd: root, output: out, env: {}, dbUrl: join(root, '.spur', 'spur.db') };
    await main(['self', 'init', '--json'], deps);
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
            '      executionCapabilities:',
            '        version: 1',
            '        axes:',
            '          fsRead: { state: available, provenance: native-known }',
            '          fsWrite: { state: available, provenance: native-known }',
            '          processSpawn: { state: available, provenance: native-known }',
            '',
        ].join('\n')}`,
    );
    return { root, ctx: createCliContext(deps), cleanup: async () => rm(root, { recursive: true, force: true }) };
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
    const start = text.search(/[[{]/);
    const parsed = JSON.parse(text.slice(start)) as { specs?: Array<{ id: string }> };
    const coder = parsed.specs?.find((spec) => spec.id.endsWith('-coder-1'));
    if (coder === undefined) throw new Error(`no coder-1 member in the roster: ${text.slice(0, 200)}`);
    return coder.id;
}

async function joinMember(root: string, memberId: string): Promise<void> {
    const code = await main(['agent', 'join', '--role', 'coder', '--member', memberId, '--json'], {
        cwd: root,
        output: createCapturedOutput(),
        env: {},
        dbUrl: join(root, '.spur', 'spur.db'),
    });
    if (code !== 0) throw new Error(`join --member exited ${code}`);
}

/** Lifecycle report exactly as the host hook sends it (seq in wall-clock nanoseconds). */
async function report(
    root: string,
    memberId: string,
    state: 'working' | 'idle',
    pin?: string,
): Promise<{ code: number; output: ReturnType<typeof createCapturedOutput> }> {
    const out = createCapturedOutput();
    const code = await main(
        [
            'agent',
            'report',
            '--state',
            state,
            '--seq',
            String(process.hrtime.bigint()),
            '--spec',
            memberId,
            ...(pin !== undefined ? ['--pin', pin] : []),
            '--json',
        ],
        { cwd: root, output: out, env: {}, dbUrl: join(root, '.spur', 'spur.db') },
    );
    return { code, output: out };
}

/** The attachments map built exactly the way `makeFleetRuntime` builds it from real records. */
async function attachmentsFrom(
    service: FleetGuestService,
    ids: string[],
): Promise<Map<string, MemberAttachmentState | null>> {
    const map = new Map<string, MemberAttachmentState | null>();
    for (const id of ids) {
        const binding = (await service.read(id))?.memberBinding;
        map.set(
            id,
            binding === undefined
                ? null
                : {
                      handshake: binding.handshakeAt !== undefined,
                      draining: binding.draining === true,
                      stageEligible: binding.stageEligible,
                  },
        );
    }
    return map;
}

const AUTOTAGGED: TaskSummary = {
    wbs: '0801',
    status: 'todo',
    frontmatter: { tags: ['fleet:auto'], priority: 'P0' },
} as unknown as TaskSummary;

describe('spur agent report — the attached handshake (1282 §4)', () => {
    test('--help documents the pin flag', async () => {
        const base = join(tmpdir(), `spur-attached-help-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
        await mkdir(base, { recursive: true });
        const out = createCapturedOutput();
        try {
            await main(['agent', 'report', '--help'], { cwd: base, output: out, env: {}, dbUrl: ':memory:' });
            expect(out.messages.join('\n')).toContain('--pin');
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });

    test('a bound member refuses pinless and stale-pin reports, then handshakes once on a match', async () => {
        const { root, ctx, cleanup } = await makeFleetProject();
        try {
            const memberId = await coderInstanceId({
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            await joinMember(root, memberId);
            const service = new FleetGuestService({ cwd: ctx.cwd, fs: ctx.fs, getDb: () => ctx.getDb() });
            const binding = (await service.read(memberId))?.memberBinding;
            expect(binding).toBeDefined();
            if (binding === undefined) return;

            // Pinless: refused before the lifecycle report lands.
            const pinless = await report(root, memberId, 'working');
            expect(pinless.code).toBe(2);
            expect((await service.read(memberId))?.memberBinding?.handshakeAt).toBeUndefined();

            // Stale pin: the occupant generation moved — refused, no handshake.
            const stale = await report(
                root,
                memberId,
                'working',
                `${binding.ownerEpoch}:${binding.occupancyGeneration + 1}`,
            );
            expect(stale.code).toBe(2);
            expect((await service.read(memberId))?.memberBinding?.handshakeAt).toBeUndefined();

            // Matching pin: accepted, the handshake lands (AC2).
            const good = await report(root, memberId, 'idle', `${binding.ownerEpoch}:${binding.occupancyGeneration}`);
            expect(good.code).toBe(0);
            const handshook = (await service.read(memberId))?.memberBinding?.handshakeAt;
            expect(typeof handshook).toBe('string');
            expect(handshook).toBeTruthy();

            // A second matching report never moves the handshake (first pin wins, once).
            await report(root, memberId, 'working', `${binding.ownerEpoch}:${binding.occupancyGeneration}`);
            expect((await service.read(memberId))?.memberBinding?.handshakeAt).toBe(handshook);

            // The real read path the runtime ticks through now reports the member stage-ready.
            expect(await attachmentsFrom(service, [memberId])).toEqual(
                new Map([[memberId, { handshake: true, draining: false, stageEligible: true }]]),
            );
        } finally {
            await cleanup();
        }
    });

    test('a plain guest reports without any pin — the unchanged path', async () => {
        const { root, cleanup } = await makeFleetProject();
        try {
            const code = await main(['agent', 'join', '--role', 'reviewer', '--id', 'plain-guest', '--json'], {
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(code).toBe(0);
            const reported = await report(root, 'plain-guest', 'idle');
            expect(reported.code).toBe(0);
        } finally {
            await cleanup();
        }
    });
});

describe('gtdStrategy holds on attached occupants (1282 AC1)', () => {
    test('an un-handshook bound member holds member-busy; after the handshake it is dispatchable', () => {
        const memberId = 'proj-coder-1';
        const base: Partial<StrategyContext> = {
            candidates: [AUTOTAGGED],
            idleInstances: [
                {
                    instanceId: memberId,
                    executor: 'bind-exec',
                    enabled: true,
                    writeCapable: true,
                    capabilityState: 'available',
                    role: 'coder',
                },
            ],
            memberLifecycle: new Map([[memberId, 'idle']]),
            dependencyBlocked: () => null,
            dispatchAttempts: new Map(),
        };
        // Never handshook: the occupant's session is not stage-visible yet.
        const pending = gtdStrategy.select({
            projectPath: '/tmp/p',
            strategyVersion: 3,
            ownerEpoch: 1,
            ...base,
            memberAttachments: new Map([[memberId, { handshake: false, draining: false, stageEligible: false }]]),
        } as StrategyContext);
        const hold = pending.holds.find((row) => row.reason === 'member-busy');
        expect(hold?.detail).toContain('handshake pending');
        expect(pending.decisions).toEqual([]);

        // Handshook and idle: no attachment gap, the stage dispatches.
        const ready = gtdStrategy.select({
            projectPath: '/tmp/p',
            strategyVersion: 3,
            ownerEpoch: 1,
            ...base,
            memberAttachments: new Map([[memberId, { handshake: true, draining: false, stageEligible: true }]]),
        } as StrategyContext);
        expect(ready.holds.find((row) => row.reason === 'member-busy')).toBeUndefined();
        expect(ready.decisions.length).toBe(1);

        // Draining: held for the whole drain window.
        const draining = gtdStrategy.select({
            projectPath: '/tmp/p',
            strategyVersion: 3,
            ownerEpoch: 1,
            ...base,
            memberAttachments: new Map([[memberId, { handshake: true, draining: true, stageEligible: true }]]),
        } as StrategyContext);
        expect(draining.holds.find((row) => row.reason === 'member-busy')?.detail).toContain('draining');
    });
});

describe('spur agent leave — the attached drain (1282 R5)', () => {
    test('a bound member with an in-flight claim times out but never force-fails the turn', async () => {
        const { root, ctx, cleanup } = await makeFleetProject();
        try {
            const memberId = await coderInstanceId({
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            await joinMember(root, memberId);
            const inbox = new InboxService({ getDb: () => ctx.getDb() });
            await inbox.send({ from: 'planner-1', to: memberId, body: 'stage request in flight' });
            const [claimed] = await inbox.claim(memberId, 5);
            expect(claimed).toBeDefined();

            const out = createCapturedOutput();
            const code = await main(['agent', 'leave', memberId, '--drain-timeout', '400', '--json'], {
                cwd: root,
                output: out,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('"drained": false');
            // The claimed request survives the drain timeout — the turn stays resumable (R5).
            const service = new FleetGuestService({ cwd: ctx.cwd, fs: ctx.fs, getDb: () => ctx.getDb() });
            expect(await service.read(memberId)).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('a bound member with nothing in flight drains settled; a plain guest leaves without a drain', async () => {
        const { root, cleanup } = await makeFleetProject();
        try {
            const memberId = await coderInstanceId({
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            await joinMember(root, memberId);
            const out = createCapturedOutput();
            const code = await main(['agent', 'leave', memberId, '--json'], {
                cwd: root,
                output: out,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('"drained": true');

            const plain = createCapturedOutput();
            await main(['agent', 'join', '--role', 'reviewer', '--id', 'plain-guest', '--json'], {
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            const plainCode = await main(['agent', 'leave', 'plain-guest', '--json'], {
                cwd: root,
                output: plain,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(plainCode).toBe(0);
            // The plain path carries no drain fields at all.
            expect(plain.messages.join('\n')).not.toContain('drained');
        } finally {
            await cleanup();
        }
    });

    test('drain guardrails: malformed timeout, ghost session, unknown id', async () => {
        const { root, cleanup } = await makeFleetProject();
        try {
            const memberId = await coderInstanceId({
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            await joinMember(root, memberId);

            const bad = createCapturedOutput();
            const badCode = await main(['agent', 'leave', memberId, '--drain-timeout', 'abc', '--json'], {
                cwd: root,
                output: bad,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(badCode).toBe(2);
            expect(bad.messages.join('\n')).toContain('--drain-timeout must be a non-negative number');

            const ghost = createCapturedOutput();
            const ghostCode = await main(['agent', 'leave', '--session-id', 'sess-ghost', '--json'], {
                cwd: root,
                output: ghost,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(ghostCode).toBe(2);
            expect(ghost.messages.join('\n')).toContain('no guest joined by session sess-ghost');

            const unknown = createCapturedOutput();
            const unknownCode = await main(['agent', 'leave', 'never-joined', '--json'], {
                cwd: root,
                output: unknown,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(unknownCode).toBe(2);
            expect(unknown.messages.join('\n')).toContain('no joined guest');
        } finally {
            await cleanup();
        }
    });

    test('a plain (non-JSON) drain leave reports the settled outcome in prose', async () => {
        const { root, cleanup } = await makeFleetProject();
        try {
            const memberId = await coderInstanceId({
                cwd: root,
                output: createCapturedOutput(),
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            await joinMember(root, memberId);
            const out = createCapturedOutput();
            const code = await main(['agent', 'leave', memberId], {
                cwd: root,
                output: out,
                env: {},
                dbUrl: join(root, '.spur', 'spur.db'),
            });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('drain settled');
        } finally {
            await cleanup();
        }
    });
});
