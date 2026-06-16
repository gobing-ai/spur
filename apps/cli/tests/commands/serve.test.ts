import { describe, expect, test } from 'bun:test';
import { registerServeCommand } from '../../src/commands/serve';
import type { CliContext } from '../../src/context';

type ActionFn = (options: { port?: number; host?: string; open?: boolean; json?: boolean }) => Promise<void>;

/** Register the serve command against a fake commander chain and capture its action handler. */
function captureServe(context: CliContext): { cmds: string[]; action: ActionFn } {
    const cmds: string[] = [];
    let action: ActionFn | undefined;
    const chain = {
        summary() {
            return this;
        },
        option() {
            return this;
        },
        action(fn: ActionFn) {
            action = fn;
            return chain;
        },
    };
    const program = {
        command: (name: string) => {
            cmds.push(name);
            return chain;
        },
    };
    registerServeCommand(program as never, context);
    if (!action) throw new Error('serve action not registered');
    return { cmds, action };
}

function makeCtx(over: Partial<CliContext> = {}): {
    ctx: CliContext;
    writes: string[];
    errors: string[];
    exit: number[];
} {
    const writes: string[] = [];
    const errors: string[] = [];
    const exit: number[] = [];
    const ctx = {
        cwd: '/tmp/test',
        output: { write: (m: string) => writes.push(m), error: (m: string) => errors.push(m) },
        setExitCode: (c: number) => exit.push(c),
        ...over,
    } as unknown as CliContext;
    return { ctx, writes, errors, exit };
}

describe('registerServeCommand', () => {
    test('registers a serve command without throwing', () => {
        const { ctx } = makeCtx();
        const { cmds } = captureServe(ctx);
        expect(cmds).toContain('serve');
    });

    test('--json prints { port, url, pid } and does not start the server', async () => {
        const { ctx, writes } = makeCtx();
        const { action } = captureServe(ctx);

        await action({ port: 4321, host: '127.0.0.1', json: true });

        const payload = JSON.parse(writes.at(-1) ?? '{}');
        expect(payload.port).toBe(4321);
        expect(payload.url).toBe('http://127.0.0.1:4321');
        expect(payload.pid).toBe(process.pid);
    });

    test('surfaces a startup error as a clean exit 1', async () => {
        const { ctx, errors, exit } = makeCtx();
        const { action } = captureServe(ctx);

        // Force buildConfigFromEnv → startServer down a failing path by passing a
        // host/port and letting startServer attempt a real bind on an invalid host.
        await action({ port: -1, host: 'invalid host', open: false, json: false });

        expect(exit).toContain(1);
        expect(errors.length).toBeGreaterThan(0);
    });
});
