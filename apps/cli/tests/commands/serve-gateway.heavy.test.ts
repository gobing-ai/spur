/**
 * Process-level proof for feature K4 R3 (and R4's adoption half): one gateway port routes each
 * local prefix to that project's own real `spur serve`, and a dead upstream is isolated to its own
 * prefix — alpha keeps answering while beta restarts or fails closed (502) under its own name.
 *
 * Heavy tier: binds real listeners and runs real serve + gateway processes.
 * The lazy-*start* half of R4 (coalescing, exactly-once, 502 with log path) is covered with an
 * injected start function in `packages/app/tests/services/project-gateway.test.ts`, because the
 * free-port band belongs to whatever the operator already serves.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

const cliEntry = join(import.meta.dir, '../../src/index.ts');

function freePort(): number {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const port = server.port ?? 0;
    server.stop(true);
    return port;
}

async function waitForOk(url: string, deadlineMs: number): Promise<Response> {
    const started = Date.now();
    let lastError = 'timeout';
    while (Date.now() - started < deadlineMs) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return res;
            lastError = `status ${res.status}`;
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
        await Bun.sleep(250);
    }
    throw new Error(`never answered ${url}: ${lastError}`);
}

describe('spur self serve --gateway (heavy)', () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-gateway-heavy-'));
    const registryFile = join(root, 'projects.json');
    const children: Array<ReturnType<typeof Bun.spawn>> = [];

    afterAll(() => {
        for (const child of children) child.kill();
        rmSync(root, { recursive: true, force: true });
    });

    test(
        'routes two prefixes to two distinct serves on one port',
        async () => {
            const ports: Record<string, number> = { alpha: freePort(), beta: freePort() };
            for (const name of ['alpha', 'beta']) {
                const dir = join(root, name);
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module' }), 'utf8');
                const serve = Bun.spawn(
                    [
                        'bun',
                        cliEntry,
                        'serve',
                        '--cwd',
                        dir,
                        '--port',
                        String(ports[name]),
                        '--host',
                        '127.0.0.1',
                        '--no-open',
                    ],
                    { cwd: dir, stdout: 'ignore', stderr: 'ignore' },
                );
                children.push(serve);
                await waitForOk(`http://127.0.0.1:${ports[name as string]}/api/health`, 60_000);
            }

            writeFileSync(
                registryFile,
                JSON.stringify(
                    {
                        schema_version: 1,
                        projects: ['alpha', 'beta'].map((name) => ({
                            name,
                            path: join(root, name),
                            host: 'localhost',
                            port: ports[name as string],
                            prefix: `/${name}`,
                        })),
                    },
                    null,
                    2,
                ),
                'utf8',
            );

            const gatewayPort = freePort();
            const gateway = Bun.spawn(
                ['bun', cliEntry, 'self', 'serve', '--gateway', '--port', String(gatewayPort), '--host', '127.0.0.1'],
                {
                    env: { ...getEnvVars(), SPUR_PROJECTS_FILE: registryFile },
                    cwd: root,
                    stdout: 'ignore',
                    stderr: 'ignore',
                },
            );
            children.push(gateway);

            const health = await waitForOk(`http://127.0.0.1:${gatewayPort}/api/health`, 30_000);
            const healthBody = (await health.json()) as {
                gateway: boolean;
                port: number;
                projects: Array<{ name: string; prefix: string; running: boolean }>;
            };
            expect(healthBody.gateway).toBe(true);
            expect(healthBody.port).toBe(gatewayPort);
            expect(healthBody.projects.map((p) => p.prefix)).toEqual(['/alpha', '/beta']);
            expect(healthBody.projects.every((p) => p.running)).toBe(true);

            for (const name of ['alpha', 'beta']) {
                const viaGateway = await fetch(`http://127.0.0.1:${gatewayPort}/${name}/api/health`, {
                    signal: AbortSignal.timeout(20_000),
                });
                expect(viaGateway.status).toBe(200);
                const body = (await viaGateway.json()) as { status: string; service: string };
                expect(body.status).toBe('ok');
                expect(body.service).toBe('spur');
            }

            // Prefix stripping: an upstream 404 (not a gateway 404) proves the prefix left the path.
            const stripped = await fetch(`http://127.0.0.1:${gatewayPort}/alpha/api/does-not-exist`, {
                signal: AbortSignal.timeout(10_000),
            });
            expect(stripped.status).toBe(404);

            // Kill beta's serve: alpha keeps answering (isolation), and beta's own prefix
            // resolves to exactly one of the two documented outcomes (`project-gateway.md` §4
            // step 8): a single fresh start that succeeds, or a 502 naming the project. Which
            // one happens depends on the host (a free port in the band, `spur` resolvable), so
            // asserting only the 502 made this test environment-dependent.
            children[1]?.kill();
            await Bun.sleep(500);
            const alphaStillUp = await fetch(`http://127.0.0.1:${gatewayPort}/alpha/api/health`, {
                signal: AbortSignal.timeout(20_000),
            });
            expect(alphaStillUp.status).toBe(200);
            const betaAfterKill = await fetch(`http://127.0.0.1:${gatewayPort}/beta/api/health`, {
                signal: AbortSignal.timeout(60_000),
            });
            if (betaAfterKill.status === 200) {
                // Self-healed: the restarted serve answers on beta's prefix, not another project's.
                expect(((await betaAfterKill.json()) as { service: string }).service).toBe('spur');
            } else {
                expect(betaAfterKill.status).toBe(502);
                expect(await betaAfterKill.text()).toContain('beta');
            }
        },
        { timeout: 180_000 },
    );
});
