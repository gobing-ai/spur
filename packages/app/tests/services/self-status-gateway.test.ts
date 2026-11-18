import { describe, expect, test } from 'bun:test';
import type { SpurConfig } from '@gobing-ai/spur-config';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { collectSelfStatus, type SelfStatusContext } from '../../src/services/self-status';

/** Read-only FileSystem stub: nothing exists, nothing may be written. */
function emptyFs(): FileSystem {
    const forbidden = (): never => {
        throw new Error('self status must never write');
    };
    return {
        exists: () => false,
        readDir: () => [],
        stat: () => null,
        readFile: forbidden,
        writeFile: forbidden,
        appendFile: forbidden,
        ensureDir: forbidden,
        deleteFile: forbidden,
        rename: forbidden,
        copy: forbidden,
        createWriteStream: forbidden,
        resolve: (...segments: string[]) => segments.join('/'),
        getProjectRoot: () => '/project',
    } as unknown as FileSystem;
}

function context(fetchImpl: typeof fetch, port?: number): SelfStatusContext {
    const config = port === undefined ? null : ({ server: { gateway: { port } } } as unknown as SpurConfig);
    return {
        cwd: '/project',
        env: { PATH: '/usr/bin', SPUR_PROJECTS_FILE: '/project/.spur/projects.json' },
        config,
        git: { root: null, branch: null, dirty: false },
        fs: emptyFs(),
        fetchImpl,
        deadlineMs: 200,
    };
}

const counters = {
    since: '2026-11-18T00:00:00.000Z',
    requests: 7,
    status4xx: 2,
    status5xx: 1,
    upstreamRestarts: { '/kk': 3 },
};

describe('self status gateway section (1385 R3)', () => {
    test('a gateway answer becomes ready with the live counters, probed on the configured port', async () => {
        const seen: string[] = [];
        const fetchImpl = (async (input: unknown) => {
            seen.push(String(input));
            return Response.json({ ok: true, gateway: true, port: 4321, projects: [], counters });
        }) as unknown as typeof fetch;

        const aggregate = await collectSelfStatus(context(fetchImpl, 4321));
        expect(aggregate.sections.gateway.state).toBe('ready');
        expect(aggregate.sections.gateway.scope).toBe('machine');
        expect(aggregate.sections.gateway.message).toBe('');
        expect(aggregate.sections.gateway.data?.counters).toEqual(counters);
        expect(seen).toContain('http://localhost:4321/api/health');
    });

    test('no gateway running is not-applicable, and never degrades the aggregate', async () => {
        const fetchImpl = (async () => {
            throw new Error('Unable to connect. Is the computer able to access the url?');
        }) as unknown as typeof fetch;

        const aggregate = await collectSelfStatus(context(fetchImpl));
        expect(aggregate.sections.gateway.state).toBe('not-applicable');
        expect(aggregate.overallState).not.toBe('degraded');
    });

    test('a foreign listener on the port is degraded and named, never reported as a gateway', async () => {
        const fetchImpl = (async () => new Response('not the gateway\n', { status: 404 })) as unknown as typeof fetch;

        const aggregate = await collectSelfStatus(context(fetchImpl, 3000));
        expect(aggregate.sections.gateway.state).toBe('degraded');
        expect(aggregate.sections.gateway.message).toContain('3000');
        expect(aggregate.sections.gateway.data?.counters).toBeUndefined();
    });

    test('a project serve answering /api/health is a foreign listener too', async () => {
        const fetchImpl = (async () => Response.json({ ok: true, project: 'spur' })) as unknown as typeof fetch;

        const aggregate = await collectSelfStatus(context(fetchImpl, 3000));
        expect(aggregate.sections.gateway.state).toBe('degraded');
        expect(aggregate.sections.gateway.message).toContain('not the gateway');
    });
});
