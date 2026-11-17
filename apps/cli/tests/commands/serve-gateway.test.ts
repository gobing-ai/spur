import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import type { StartGatewayOptions } from '@gobing-ai/spur-server';
import { registerServeCommand } from '../../src/commands/serve';
import type { CliContext } from '../../src/context';

type ActionFn = (options: {
    port?: number;
    host?: string;
    open?: boolean;
    json?: boolean;
    cwd?: string;
    gateway?: boolean;
}) => Promise<void>;

/** Minimal commander chain capture with an injected gateway launcher. */
function captureGateway(context: CliContext): { action: ActionFn; launched: StartGatewayOptions[] } {
    const launched: StartGatewayOptions[] = [];
    let action: ActionFn | undefined;
    const chain = {
        summary: () => chain,
        option: () => chain,
        action: (fn: ActionFn) => {
            action = fn;
            return chain;
        },
    };
    const program = { command: () => chain };
    registerServeCommand(program as never, context, {
        startGateway: ((options: StartGatewayOptions) => {
            launched.push(options);
            return { port: options.port, url: `http://${options.host}:${options.port}`, stop: () => {} };
        }) as never,
    });
    if (!action) throw new Error('serve action not registered');
    return { action, launched };
}

function makeCtx(): { ctx: CliContext; writes: string[] } {
    const writes: string[] = [];
    const ctx = {
        cwd: '/tmp/test',
        output: { write: (m: string) => writes.push(m), error: (m: string) => writes.push(m) },
        setExitCode: () => {},
    } as unknown as CliContext;
    return { ctx, writes };
}

describe('spur self serve --gateway (K4 R3)', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-gateway-cli-'));
        setEnvVar('SPUR_PROJECTS_FILE', join(tempDir, 'projects.json'));
    });

    afterEach(() => {
        removeEnvVar('SPUR_PROJECTS_FILE');
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('--json is a dry probe that reports the gateway without binding', async () => {
        const { ctx, writes } = makeCtx();
        const { action, launched } = captureGateway(ctx);

        await action({ json: true, gateway: true, port: 3311, host: '127.0.0.1' });

        const payload = JSON.parse(writes.at(-1) ?? '{}');
        expect(payload).toEqual({ port: 3311, url: 'http://127.0.0.1:3311', gateway: true, running: false });
        expect(launched).toHaveLength(0);
    });

    test('starts the gateway with registry-backed deps and the gateway port', async () => {
        const { ctx, writes } = makeCtx();
        const { action, launched } = captureGateway(ctx);

        await action({ gateway: true, port: 3312, host: '127.0.0.1' });

        expect(launched).toHaveLength(1);
        const options = launched[0] as StartGatewayOptions;
        expect(options.port).toBe(3312);
        expect(await options.deps.listProjects()).toEqual([]);
        expect(options.deps.port).toBe(3312);
        expect(writes.join('\n')).toContain('Spur gateway listening on http://127.0.0.1:3312');

        // The upstream seam goes through the real start path, adopting THIS entry: a path that does
        // not exist fails fast and names the path (Q R3 — the entry is no longer re-resolved by path).
        await expect(
            options.deps.ensureUpstream({
                name: 'ghost',
                path: join(tempDir, 'ghost'),
                host: 'localhost',
                port: 0,
            }),
        ).rejects.toThrow(/Project path does not exist/);
    });
});
