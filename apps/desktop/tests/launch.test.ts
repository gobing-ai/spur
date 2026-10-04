import { describe, expect, test } from 'bun:test';
import {
    binaryKind,
    buildDevCliLaunch,
    childEnv,
    listProdBinaryCandidates,
    resolveDesktopBin,
    resolveServeLaunch,
    standaloneServerCliCompanion,
} from '../src/launch';
import type { DesktopLayout } from '../src/layout';

const devLayout: DesktopLayout = {
    mode: 'dev',
    repoRoot: '/repo',
    projectRoot: '/work',
    resourcesDir: undefined,
};

describe('launch', () => {
    test('dev command is the approved bun serve invocation', () => {
        const launch = buildDevCliLaunch({
            bun: 'bun',
            repoRoot: '/repo',
            projectRoot: '/work',
            port: 4312,
            parentEnv: { PATH: '/usr/bin', DATABASE_URL: '/tmp/other.db', EMPTY: undefined },
        });
        expect(launch.kind).toBe('dev-cli');
        expect(launch.command).toBe('bun');
        expect(launch.cwd).toBe('/repo');
        expect(launch.args).toEqual([
            'apps/cli/src/index.ts',
            'serve',
            '--host',
            '127.0.0.1',
            '--port',
            '4312',
            '--no-open',
            '--cwd',
            '/work',
        ]);
        expect(launch.env.DATABASE_URL).toBeUndefined();
        expect(launch.env.HOST).toBe('127.0.0.1');
        expect(launch.env.PATH).toBe('/usr/bin');
        expect(launch.env.PORT).toBeUndefined();
    });

    test('childEnv drops undefined extras', () => {
        expect(childEnv({ A: '1', DATABASE_URL: 'x' }, { HOST: '127.0.0.1', PORT: undefined }).PORT).toBeUndefined();
    });

    test('binary kind distinguishes the standalone server', () => {
        expect(binaryKind('/opt/spur')).toBe('cli');
        expect(binaryKind('/opt/spur-server')).toBe('server');
        expect(binaryKind('/opt/spur-server.exe')).toBe('server');
        expect(binaryKind('/dist/cli/spur-windows-x64.exe')).toBe('cli');
    });

    test('prod candidates prefer an explicit binary, then resources, then dist', () => {
        expect(
            listProdBinaryCandidates({
                envBin: '/opt/custom',
                resourcesDir: '/res/spur',
                repoRoot: '/repo',
                platform: 'linux',
                arch: 'x64',
            }),
        ).toEqual([
            '/opt/custom',
            '/res/spur/spur',
            '/res/spur/spur-server',
            '/repo/dist/cli/spur-linux-x64',
            '/repo/dist/server/spur-server',
        ]);
        expect(
            listProdBinaryCandidates({
                resourcesDir: '/res/spur',
                repoRoot: '/repo',
                platform: 'win32',
                arch: 'arm64',
            }),
        ).toEqual([
            '/res/spur/spur.exe',
            '/res/spur/spur-server.exe',
            '/repo/dist/cli/spur-windows-arm64.exe',
            '/repo/dist/server/spur-server.exe',
        ]);
        expect(listProdBinaryCandidates({ platform: 'freebsd', arch: 'x64' })).toEqual([]);
    });

    test('dev resolve fails closed without a checkout', () => {
        expect(() =>
            resolveServeLaunch({
                layout: { ...devLayout, repoRoot: undefined },
                port: 1,
                parentEnv: {},
                bunPath: 'bun',
                exists: () => false,
            }),
        ).toThrow(/spur checkout/);
    });

    test('prod uses SPUR_DESKTOP_BIN when it exists and refuses a missing override', () => {
        const layout: DesktopLayout = {
            mode: 'prod',
            repoRoot: '/repo',
            projectRoot: '/work',
            resourcesDir: '/res/spur',
        };
        const cli = resolveServeLaunch({
            layout,
            port: 9,
            parentEnv: { SPUR_DESKTOP_BIN: '/opt/spur', DATABASE_URL: '/nope.db' },
            bunPath: 'bun',
            exists: (path) => path === '/opt/spur',
            platform: 'linux',
            arch: 'x64',
        });
        expect(cli.kind).toBe('prod-cli');
        expect(cli.command).toBe('/opt/spur');
        expect(cli.args).toEqual(['serve', '--host', '127.0.0.1', '--port', '9', '--no-open', '--cwd', '/work']);
        expect(cli.cwd).toBe('/work');
        expect(cli.env.DATABASE_URL).toBeUndefined();

        expect(() =>
            resolveServeLaunch({
                layout,
                port: 9,
                parentEnv: { SPUR_DESKTOP_BIN: '/missing' },
                bunPath: 'bun',
                exists: () => false,
            }),
        ).toThrow(/SPUR_DESKTOP_BIN/);
    });

    test('prod falls through to the server binary and sets PORT without a second database url', () => {
        const launch = resolveServeLaunch({
            layout: {
                mode: 'prod',
                repoRoot: '/repo',
                projectRoot: '/work',
                resourcesDir: '/res/spur',
            },
            port: 10,
            parentEnv: { PATH: '/bin' },
            bunPath: 'bun',
            exists: (path) => path === '/repo/dist/server/spur-server',
            platform: 'linux',
            arch: 'x64',
        });
        expect(launch.kind).toBe('prod-server');
        expect(launch.command).toBe('/repo/dist/server/spur-server');
        expect(launch.args).toEqual([]);
        expect(launch.cwd).toBe('/work');
        expect(launch.env.PORT).toBe('10');
        expect(launch.env.HOST).toBe('127.0.0.1');
        expect(launch.env.DATABASE_URL).toBeUndefined();
    });

    test('prod names every candidate it failed to find', () => {
        expect(() =>
            resolveServeLaunch({
                layout: {
                    mode: 'prod',
                    repoRoot: '/repo',
                    projectRoot: '/work',
                    resourcesDir: '/res/spur',
                },
                port: 1,
                parentEnv: {},
                bunPath: 'bun',
                exists: () => false,
                platform: 'linux',
                arch: 'x64',
            }),
        ).toThrow(/\/res\/spur\/spur-server/);
    });

    test('prod explains when nothing is compiled', () => {
        expect(() =>
            resolveServeLaunch({
                layout: { mode: 'prod', repoRoot: undefined, projectRoot: '/work', resourcesDir: undefined },
                port: 1,
                parentEnv: {},
                bunPath: 'bun',
                exists: () => false,
                platform: 'linux',
                arch: 'x64',
            }),
        ).toThrow(/bun run build/);
    });

    test('relative SPUR_DESKTOP_BIN is resolved against the launch directory', () => {
        const layout: DesktopLayout = {
            mode: 'prod',
            repoRoot: '/repo',
            projectRoot: '/work',
            resourcesDir: '/res/spur',
        };
        const launch = resolveServeLaunch({
            layout,
            port: 9,
            parentEnv: { SPUR_DESKTOP_BIN: 'bin/spur' },
            bunPath: 'bun',
            launchCwd: '/launch',
            exists: (path) => path === '/launch/bin/spur',
            platform: 'linux',
            arch: 'x64',
        });
        expect(launch.command).toBe('/launch/bin/spur');
        expect(launch.cwd).toBe('/work');
        expect(resolveDesktopBin('/opt/spur', '/launch')).toBe('/opt/spur');
    });

    test('standalone server companion matches dirname(execPath)/../cli/spur', () => {
        expect(standaloneServerCliCompanion('/app/resources/spur/spur-server', 'linux')).toBe(
            '/app/resources/cli/spur',
        );
        expect(standaloneServerCliCompanion('/app/resources/spur/spur-server.exe', 'win32')).toBe(
            '/app/resources/cli/spur.exe',
        );
    });
});

test('relative BUN_PATH resolves from launch cwd while bare commands use PATH', () => {
    const layout = { mode: 'dev' as const, repoRoot: '/repo', projectRoot: '/work', resourcesDir: undefined };
    const input = { layout, port: 1234, parentEnv: {}, exists: () => true, launchCwd: '/launcher' };
    expect(resolveServeLaunch({ ...input, bunPath: './bin/bun' }).command).toBe('/launcher/bin/bun');
    expect(resolveServeLaunch({ ...input, bunPath: 'bun' }).command).toBe('bun');
});

test('Windows dev launches the Bun script directly so its IPC descriptor is retained', () => {
    const launch = buildDevCliLaunch({
        bun: 'bun',
        repoRoot: '/repo',
        projectRoot: '/project',
        port: 1234,
        parentEnv: {},
        platform: 'win32',
    });
    expect(launch.args[0]).toBe('apps/cli/src/index.ts');
    expect(launch.args).not.toContain('run');
});
