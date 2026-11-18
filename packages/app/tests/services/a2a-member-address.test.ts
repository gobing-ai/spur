import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectEntry } from '@gobing-ai/spur-config';
import {
    createProjectCardRefResolver,
    envProjectCardRefResolver,
    resolveProjectCardTarget,
} from '../../src/services/a2a-member-address';

const entry = (name: string, path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry => ({
    name,
    path,
    port: 0,
    ...extra,
});

const gatewayAnswering = (async () =>
    Response.json({ ok: true, gateway: true, port: 3000, projects: [] })) as unknown as typeof fetch;

const nothingListening = (async () => {
    throw new Error('Unable to connect. Is the computer able to access the url?');
}) as unknown as typeof fetch;

function deps(overrides: Partial<Parameters<typeof resolveProjectCardTarget>[0]> = {}) {
    return {
        project: 'ts-libs',
        member: 'coder',
        gatewayPort: 3000,
        listProjects: async () => [entry('ts-libs', '/tmp/ts-libs', { prefix: '/tslibs', port: 3007 })],
        fetchImpl: gatewayAnswering,
        ...overrides,
    };
}

/**
 * 1395 R2: the address resolves at dispatch time (never cached) from a registry name or prefix to the
 * gateway's stable card URL. Every failure returns an actionable message instead of a thrown error,
 * because the caller maps it to a `not-started` delivery rather than a crash.
 */
describe('1395 R2: project member → gateway card URL', () => {
    test('resolves a registry name through its prefix on the gateway port', async () => {
        const resolved = await resolveProjectCardTarget(deps());
        expect(resolved).toEqual({
            url: 'http://localhost:3000/tslibs/a2a/members/ts-libs-coder/.well-known/agent-card.json',
        });
    });

    test('resolves a stored prefix, with or without its leading slash', async () => {
        for (const project of ['/tslibs', 'tslibs']) {
            const resolved = await resolveProjectCardTarget(deps({ project }));
            expect(resolved).toEqual({
                url: 'http://localhost:3000/tslibs/a2a/members/ts-libs-coder/.well-known/agent-card.json',
            });
        }
    });

    test('an unknown project names the registry and the way to inspect it', async () => {
        const resolved = await resolveProjectCardTarget(deps({ project: 'nope' }));
        expect(resolved).toEqual({ error: expect.stringContaining('spur projects list') });
        expect((resolved as { error: string }).error).toContain('nope');
    });

    test('an ambiguous project name refuses instead of guessing', async () => {
        const resolved = await resolveProjectCardTarget(
            deps({
                listProjects: async () => [
                    entry('ts-libs', '/tmp/a', { prefix: '/a' }),
                    entry('ts-libs', '/tmp/b', { prefix: '/b' }),
                ],
            }),
        );
        expect(resolved).toEqual({ error: expect.stringContaining('/a') });
        expect((resolved as { error: string }).error).toContain('/b');
    });

    test('a remote entry is refused as local-only (ADR-151)', async () => {
        const resolved = await resolveProjectCardTarget(
            deps({
                listProjects: async () => [entry('ts-libs', '/tmp/remote', { host: '192.168.87.27', port: 3003 })],
            }),
        );
        expect(resolved).toEqual({ error: expect.stringContaining('local') });
    });

    test('a gateway that is not answering says how to start one', async () => {
        const resolved = await resolveProjectCardTarget(deps({ fetchImpl: nothingListening }));
        expect(resolved).toEqual({ error: expect.stringContaining('spur self serve --gateway') });
    });

    test('a foreign listener on the gateway port is not accepted as the gateway', async () => {
        const resolved = await resolveProjectCardTarget(
            deps({ fetchImpl: (async () => Response.json({ ok: true, project: 'spur' })) as unknown as typeof fetch }),
        );
        expect(resolved).toEqual({ error: expect.stringContaining('not the gateway') });
    });

    test('the remote instance id is <registry name>-<member>, the identity the target mints', async () => {
        const resolved = await resolveProjectCardTarget(
            deps({
                listProjects: async () => [entry('Knowledge Kit', '/tmp/kk', { prefix: '/kk', port: 3007 })],
                project: '/kk',
                member: 'coder',
            }),
        );
        expect(resolved).toEqual({
            url: 'http://localhost:3000/kk/a2a/members/Knowledge%20Kit-coder/.well-known/agent-card.json',
        });
    });
});

/**
 * The adapter the composition roots use. It must hand the transport a URL and turn every resolution
 * failure into a throw (which the transport records as a `failed` receipt), and it must read the
 * registry from the env path each time so a re-registered project resolves without a restart.
 */
describe('1395 R2/R5: transport resolver adapters', () => {
    test('createProjectCardRefResolver returns the URL, and throws an actionable error otherwise', async () => {
        const resolve = createProjectCardRefResolver({
            listProjects: async () => [entry('ts-libs', '/tmp/ts-libs', { prefix: '/tslibs', port: 3007 })],
            gatewayPort: 3000,
            fetchImpl: gatewayAnswering,
        });
        await expect(resolve({ instanceId: 'proj-tslibs', project: 'ts-libs', member: 'coder' })).resolves.toBe(
            'http://localhost:3000/tslibs/a2a/members/ts-libs-coder/.well-known/agent-card.json',
        );
        await expect(resolve({ instanceId: 'proj-x', project: 'missing', member: 'coder' })).rejects.toThrow(
            /spur projects list/,
        );
        await expect(resolve({ instanceId: 'proj-x', project: 'ts-libs' })).rejects.toThrow(/project\/member pair/);
    });

    test('envProjectCardRefResolver reads the registry from SPUR_PROJECTS_FILE', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-card-refs-'));
        try {
            const registryPath = join(dir, 'projects.json');
            await writeFile(
                registryPath,
                JSON.stringify({
                    projects: [{ name: 'ts-libs', path: '/tmp/ts-libs', prefix: '/tslibs', port: 3007 }],
                }),
                'utf8',
            );
            const resolve = envProjectCardRefResolver({
                env: { SPUR_PROJECTS_FILE: registryPath },
                fetchImpl: gatewayAnswering,
            });
            await expect(resolve({ instanceId: 'proj-tslibs', project: '/tslibs', member: 'coder' })).resolves.toBe(
                'http://localhost:3000/tslibs/a2a/members/ts-libs-coder/.well-known/agent-card.json',
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
