import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { DEFAULT_DATABASE_URL } from '@gobing-ai/spur-config';
import type { StartServerOptions } from '@gobing-ai/spur-server';
import {
    type RegisterServeOptions,
    registerServeCommand,
    resolveServeCwd,
    resolveServeDbUrl,
} from '../../src/commands/serve';
import type { CliContext } from '../../src/context';
import { CommandError } from '../../src/errors';

type ActionFn = (options: {
    port?: number;
    host?: string;
    open?: boolean;
    json?: boolean;
    cwd?: string;
}) => Promise<void>;

type LaunchSpy = (options: StartServerOptions) => Promise<void>;

/**
 * Register the serve command against a fake commander chain and capture its
 * action handler. `registerOptions` can inject a recording `startServer` so the
 * startup composition is exercised with injected dependencies (task 0805 AC2).
 */
function captureServe(
    context: CliContext,
    registerOptions: RegisterServeOptions = {},
): {
    cmds: string[];
    action: ActionFn;
    launched: Array<Partial<StartServerOptions>>;
} {
    const cmds: string[] = [];
    const launched: Array<Partial<StartServerOptions>> = [];
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
    const launch: LaunchSpy = async (options) => {
        launched.push(options);
    };
    const injected = registerOptions.startServer ?? launch;
    registerServeCommand(program as never, context, { ...registerOptions, startServer: injected as never });
    if (!action) throw new Error('serve action not registered');
    return { cmds, action, launched };
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

    test('--json prints { port, url, pid: null, running: false } and does not start the server', async () => {
        const { ctx, writes } = makeCtx();
        const { action, launched } = captureServe(ctx);

        await action({ port: 4321, host: '127.0.0.1', json: true });

        const payload = JSON.parse(writes.at(-1) ?? '{}');
        expect(payload.port).toBe(4321);
        expect(payload.url).toBe('http://127.0.0.1:4321');
        // No server started — pid must not claim the CLI process is a server.
        expect(payload.pid).toBeNull();
        expect(payload.running).toBe(false);
        expect(launched).toHaveLength(0);
    });

    test('--port flag overrides the PORT env var (flag > env precedence)', async () => {
        const { ctx, writes } = makeCtx();
        const { action } = captureServe(ctx);

        const prevPort = process.env.PORT;
        process.env.PORT = '8080';
        try {
            // Flag set to 9090 while env says 8080 — flag must win.
            await action({ port: 9090, host: 'localhost', json: true });
            const payload = JSON.parse(writes.at(-1) ?? '{}');
            expect(payload.port).toBe(9090);
        } finally {
            if (prevPort === undefined) delete process.env.PORT;
            else process.env.PORT = prevPort;
        }
    });

    test('falls back to the PORT env var when no --port flag is given (env > default)', async () => {
        const { ctx, writes } = makeCtx();
        const { action } = captureServe(ctx);

        const prevPort = process.env.PORT;
        process.env.PORT = '8080';
        try {
            await action({ host: 'localhost', json: true });
            const payload = JSON.parse(writes.at(-1) ?? '{}');
            expect(payload.port).toBe(8080);
        } finally {
            if (prevPort === undefined) delete process.env.PORT;
            else process.env.PORT = prevPort;
        }
    });

    test('resolves serve DB to the project SQLite file when DATABASE_URL is absent', () => {
        expect(resolveServeDbUrl('/tmp/project', {}, ':memory:')).toBe('/tmp/project/.spur/spur.db');
        expect(resolveServeDbUrl('/tmp/project', { DATABASE_URL: 'custom.db' }, 'custom.db')).toBe('custom.db');
    });

    test('surfaces a startup error as a clean exit 1', async () => {
        const { ctx, errors, exit } = makeCtx();
        const { action } = captureServe(ctx, {
            startServer: (async () => {
                throw new Error('bind failed');
            }) as RegisterServeOptions['startServer'],
        });

        // A thrown startServer failure (e.g. an invalid host/port bind) must
        // surface as a clean exit 1 with a readable diagnostic.
        await action({ port: -1, host: 'invalid host', open: false, json: false });

        expect(exit).toContain(1);
        expect(errors.some((e) => e.includes('bind failed'))).toBe(true);
    });

    test('classifies a SQLITE_BUSY startup failure with the busy remediation (2026-09-08)', async () => {
        const { ctx, errors, exit } = makeCtx();
        // bun:sqlite busy failure shape, verified live: message "database is locked", code SQLITE_BUSY.
        const busyError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
        const { action } = captureServe(ctx, {
            startServer: (async () => {
                throw busyError;
            }) as RegisterServeOptions['startServer'],
        });

        await action({ port: 3000, host: 'localhost', open: false, json: false });

        expect(exit).toContain(1);
        const all = errors.join('\n');
        expect(all).toContain('.spur/spur.db is busy');
        expect(all).toContain('lsof .spur/spur.db');
    });
});

describe('serve --cwd project root (task 0805 R2)', () => {
    test('resolveServeCwd keeps an absolute directory target and validates it', () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-abs-'));
        expect(resolveServeCwd(b)).toBe(b);
    });

    test('resolveServeCwd resolves a relative target against the invocation directory', () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-rel-'));
        const rel = relative(process.cwd(), b);
        expect(resolveServeCwd(rel)).toBe(resolve(rel));
    });

    test('resolveServeCwd throws CommandError for a missing or non-directory target', () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-bad-'));
        const file = join(b, 'file.txt');
        const missing = join(b, 'nope');
        writeFileSync(file, 'x');
        expect(() => resolveServeCwd(missing)).toThrow(CommandError);
        // A regular file is not a directory.
        expect(() => resolveServeCwd(file)).toThrow(CommandError);
    });

    test('passes an absolute --cwd into startServer as the project root (server uses B, not A)', async () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-launch-abs-'));
        const { ctx, writes } = makeCtx({ cwd: '/tmp/project-a' });
        const { action, launched } = captureServe(ctx);

        await action({ port: 3000, host: 'localhost', open: false, cwd: b });

        expect(launched).toHaveLength(1);
        expect(launched[0]?.cwd).toBe(b);
        // The default DB resolves under B, not the invocation dir A.
        expect(launched[0]?.dbUrl).toBe(join(b, DEFAULT_DATABASE_URL));
        expect(writes.some((w) => w.includes('Starting Spur server'))).toBe(true);
    });

    test('passes a relative --cwd resolved against the invocation directory', async () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-launch-rel-'));
        const rel = relative(process.cwd(), b);
        const { ctx } = makeCtx({ cwd: '/tmp/project-a' });
        const { action, launched } = captureServe(ctx);

        await action({ port: 3000, host: 'localhost', open: false, cwd: rel });

        expect(launched).toHaveLength(1);
        expect(launched[0]?.cwd).toBe(resolve(rel));
        expect(launched[0]?.dbUrl).toBe(join(resolve(rel), DEFAULT_DATABASE_URL));
    });

    test('direct action call without --cwd passes no cwd to startServer (process.cwd fallback); the real CLI defaults --cwd to context.cwd via commander', async () => {
        const { ctx } = makeCtx({ cwd: '/tmp/project-a' });
        const { action, launched } = captureServe(ctx);

        await action({ port: 3000, host: 'localhost', open: false });

        expect(launched).toHaveLength(1);
        expect(launched[0]?.cwd).toBeUndefined();
        expect(launched[0]?.dbUrl).toBe(join('/tmp/project-a', DEFAULT_DATABASE_URL));
    });

    test('explicit DATABASE_URL retains precedence over the --cwd default DB', async () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-dburl-'));
        const prev = process.env.DATABASE_URL;
        process.env.DATABASE_URL = 'custom.db';
        const { ctx } = makeCtx({ cwd: '/tmp/project-a' });
        const { action, launched } = captureServe(ctx);
        try {
            await action({ port: 3000, host: 'localhost', open: false, cwd: b });
            expect(launched).toHaveLength(1);
            expect(launched[0]?.cwd).toBe(b);
            expect(launched[0]?.dbUrl).toBe('custom.db');
        } finally {
            if (prev === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = prev;
        }
    });

    test('missing/non-directory --cwd fails before server startup with exit 1', async () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-fail-'));
        const { ctx, errors, exit } = makeCtx({ cwd: '/tmp/project-a' });
        const { action, launched } = captureServe(ctx);

        await action({ port: 3000, host: 'localhost', open: false, cwd: join(b, 'does-not-exist') });

        expect(launched).toHaveLength(0); // startServer was never reached
        expect(exit).toContain(1);
        expect(errors.some((e) => e.includes('does not resolve to an existing directory'))).toBe(true);
    });

    test('--json --cwd <missing> fails with exit 1 before the probe emits (0808 R1)', async () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-probe-cwd-'));
        const { ctx, writes, errors, exit } = makeCtx({ cwd: '/tmp/project-a' });
        const { action, launched } = captureServe(ctx);

        await action({ port: 3000, host: 'localhost', open: false, json: true, cwd: join(b, 'does-not-exist') });

        expect(exit).toContain(1);
        expect(launched).toHaveLength(0); // startServer was never reached
        const all = [...writes, ...errors].join('\n');
        expect(all).toContain('does not resolve to an existing directory');
        // The probe payload {port,url,pid,running} was never emitted — only the error.
        expect(writes.some((w) => w.includes('"port"'))).toBe(false);
    });

    test('canonical self serve and hidden serve alias behave identically for --cwd', async () => {
        const b = mkdtempSync(join(tmpdir(), 'spur-serve-cwd-alias-'));
        const { ctx } = makeCtx({ cwd: '/tmp/project-a' });

        const visible = captureServe(ctx);
        const hidden = captureServe(ctx, { hidden: true });

        await visible.action({ port: 3000, host: 'localhost', open: false, cwd: b });
        await hidden.action({ port: 3001, host: 'localhost', open: false, cwd: b });

        expect(visible.cmds).toEqual(['serve']);
        expect(hidden.cmds).toEqual(['serve']);
        expect(visible.launched).toHaveLength(1);
        expect(hidden.launched).toHaveLength(1);
        expect(visible.launched[0]?.cwd).toBe(b);
        expect(hidden.launched[0]?.cwd).toBe(b);
        // Both pass the same resolved root + DB scoping.
        expect(visible.launched[0]?.dbUrl).toBe(hidden.launched[0]?.dbUrl);
    });
});
