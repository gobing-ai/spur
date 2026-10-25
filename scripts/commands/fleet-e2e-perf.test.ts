/**
 * The perf lane's WARM row decision (task 1276 R1, feature G74).
 *
 * Failure modes FIRST, because the row is evidence and a wrongly-`qualified` row is worse than no
 * row at all: an agent with no registered driver, an installed binary whose version the driver was
 * never verified against, a binary whose version cannot be parsed, and a driver whose own
 * `qualify()` refuses. Only then the qualified case. The row must always carry the probed binary
 * path and version (AC1) so a reader can tell WHICH binary was qualified.
 *
 * The pure decision cases supply a driver directly; probe integration cases shell a fixture
 * executable and use the installed driver — no host agent binary, no network, no paid run.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdtempSync,
    readFileSync,
    rmdirSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { getAgentShim, type TurnSessionDriver } from '@gobing-ai/ts-ai-runner';
import { parsePerfArgs, probeWarm, scaffoldPerfProject, warmRow } from './fleet-e2e';

/** A driver that refuses every binary — the shape `TURN_SESSION_DRIVERS` has for 1277/1278. */
function refusingDriver(reason: string): TurnSessionDriver {
    return {
        agent: 'codex',
        qualify: () => ({ qualified: false, reason }),
        spawnArgv: () => ({ command: 'codex', args: [] }),
        handshake: async () => null,
        encodeTurn: () => '',
        decode: () => [],
        encodeCancel: () => '',
    } as unknown as TurnSessionDriver;
}

function qualifyingDriver(agent: TurnSessionDriver['agent'] = 'claude'): TurnSessionDriver {
    return {
        agent,
        qualify: () => ({ qualified: true }),
        spawnArgv: () => ({ command: 'claude', args: [] }),
        handshake: async () => null,
        encodeTurn: () => '',
        decode: () => [],
        encodeCancel: () => '',
    } as unknown as TurnSessionDriver;
}

const BINARY = { path: '/opt/homebrew/bin/claude', version: '2.1.308' };

describe('1276 R1: an unsupported warm lane is named, never silently qualified', () => {
    test('an agent with no registered driver records unsupported and names the agent', () => {
        const row = warmRow('codex', { driver: null, binary: BINARY, verifiedVersion: 'unverified' });
        expect(row.status).toBe('unsupported');
        expect(row.reason).toContain("no turn-session driver registered for agent 'codex'");
    });

    test("an installed version the driver refuses keeps the driver's own reason", () => {
        const driver = refusingDriver('codex 0.51.0 is not the qualified version 0.52.0');
        const row = warmRow('codex', {
            driver,
            binary: { path: '/opt/homebrew/bin/codex', version: '0.51.0' },
            verifiedVersion: '0.52.0',
        });
        expect(row.status).toBe('unsupported');
        expect(row.reason).toBe('codex 0.51.0 is not the qualified version 0.52.0');
        // The evidence still says which binary was refused.
        expect(row.binary).toEqual({ path: '/opt/homebrew/bin/codex', version: '0.51.0' });
    });

    test('a binary whose version cannot be probed never qualifies', () => {
        const row = warmRow('claude', {
            driver: qualifyingDriver(),
            binary: { path: '/usr/bin/claude', version: null },
            verifiedVersion: '2.1.308',
        });
        expect(row.status).toBe('unsupported');
        expect(row.qualified).toBe(false);
        expect(row.reason).toContain('version could not be probed');
    });

    test('an absent binary never qualifies', () => {
        const row = warmRow('claude', { driver: qualifyingDriver(), binary: null, verifiedVersion: '2.1.308' });
        expect(row.status).toBe('unsupported');
        expect(row.binary).toBeNull();
    });
});

describe('1276 AC1: a qualified binary is recorded with its path and version', () => {
    test('the qualified row carries binary path, version, driver and verifiedAgainst', () => {
        const row = warmRow('claude', { driver: qualifyingDriver(), binary: BINARY, verifiedVersion: '2.1.308' });
        expect(row.status).toBe('qualified');
        expect(row.qualified).toBe(true);
        expect(row.binary).toEqual({ path: '/opt/homebrew/bin/claude', version: '2.1.308' });
        expect(row.driver).toBe('claude');
        expect(row.verifiedVersion).toBe('2.1.308');
    });
});

// Failure modes for the real probe: a hung command may print a valid version before hanging,
// and a successful command must supply its observed version to the installed driver's qualifier.
// Only the shim's command path is replaced; spawning, parsing and driver qualification are real.
function withVersionBinary(body: string, check: (path: string) => void): void {
    const directory = mkdtempSync(join(tmpdir(), 'spur-warm-probe-'));
    const binary = join(directory, 'claude');
    const command = spyOn(getAgentShim('claude'), 'getVersionCommand');
    try {
        writeFileSync(binary, `#!/bin/sh\n${body}\n`);
        chmodSync(binary, 0o755);
        command.mockReturnValue({ command: binary, args: ['--version'] });
        check(binary);
    } finally {
        command.mockRestore();
        unlinkSync(binary);
        rmdirSync(directory);
    }
}

describe('1276 real version probe and portable receipt evidence', () => {
    test('a timed-out version command refuses even after printing a valid version', () => {
        withVersionBinary("printf '2.1.308\\n'\nexec /bin/sleep 0.3", (path) => {
            const probe = probeWarm('claude', 30);
            expect(probe.binary).toEqual({ path, version: null });
            const row = warmRow('claude', probe);
            expect(row.qualified).toBe(false);
            expect(row.reason).toContain('version could not be probed');
        });
    });

    test('the installed driver qualifies the version parsed from the executable output', () => {
        withVersionBinary("printf 'Claude Code 2.1.308\\n'", (path) => {
            const row = warmRow('claude', probeWarm('claude'));
            expect(row.binary).toEqual({ path, version: '2.1.308' });
            expect(row.verifiedVersion).toBe('2.1.308');
            expect(row.qualified).toBe(true);
        });
    });

    test('repository-local binaries are recorded relative to the repository root', () => {
        const binary = { path: resolve(import.meta.dir, '../../node_modules/.bin/pi'), version: '0.87.1' };
        const row = warmRow('pi', { driver: null, binary, verifiedVersion: '0.87.0' });
        expect(row.binary).toEqual({ path: 'node_modules/.bin/pi', version: '0.87.1' });
        expect(binary.path).toBe(resolve(import.meta.dir, '../../node_modules/.bin/pi'));
    });

    test('a sibling directory sharing the repository prefix keeps its absolute binary path', () => {
        const path = `${resolve(import.meta.dir, '../..')}-other/node_modules/.bin/pi`;
        const row = warmRow('pi', { driver: null, binary: { path, version: '0.87.1' }, verifiedVersion: null });
        expect(row.binary?.path).toBe(path);
    });
});

describe('1273 R4: the real-agent lane is opt-in and --agents narrows the columns', () => {
    test('the deterministic lane is the default', () => {
        expect(parsePerfArgs(['--perf']).realAgents).toBe(false);
        expect(parsePerfArgs(['--perf', '--real-agents']).realAgents).toBe(true);
    });

    test('--agents selects columns and defaults to every target', () => {
        expect(parsePerfArgs(['--perf']).agents).toEqual(['claude', 'codex', 'pi']);
        expect(parsePerfArgs(['--perf', '--agents', 'claude']).agents).toEqual(['claude']);
        expect(parsePerfArgs(['--perf', '--agents', 'claude,pi']).agents).toEqual(['claude', 'pi']);
    });

    test('an unknown --agents value fails loudly instead of measuring nothing', () => {
        expect(() => parsePerfArgs(['--perf', '--agents', 'gemini'])).toThrow(/--agents/);
        expect(() => parsePerfArgs(['--perf', '--agents', ''])).toThrow(/--agents/);
    });

    test('--real-agents composes with --trials and --keep', () => {
        const parsed = parsePerfArgs(['--perf', '--real-agents', '--agents', 'claude', '--trials', '2', '--keep']);
        expect(parsed).toMatchObject({ realAgents: true, agents: ['claude'], trials: 2, keep: true });
    });
});

describe('1277 AC1: Pi executable provenance and actual perf executor', () => {
    test('host and repository Pi identities survive a refusal of the selected executable', () => {
        const directory = mkdtempSync(join(tmpdir(), 'spur-pi-probe-'));
        const hostPi = join(directory, 'pi');
        const command = spyOn(getAgentShim('pi'), 'getVersionCommand');
        const originalWhich = Bun.which;
        const which = spyOn(Bun, 'which');
        try {
            writeFileSync(hostPi, "#!/bin/sh\nprintf '1.4.0\\n'\n");
            chmodSync(hostPi, 0o755);
            command.mockReturnValue({ command: hostPi, args: ['--version'] });
            which.mockImplementation((name, options) => (name === 'pi' ? hostPi : originalWhich(name, options)));
            const row = warmRow('pi', probeWarm('pi'));
            expect(row.qualified).toBe(false);
            expect(row.binary).toEqual({ path: hostPi, version: '1.4.0' });
            expect(row.verifiedVersion).toBe('0.87.1');
            expect(row.provenance).toEqual({
                host: { path: hostPi, version: '1.4.0' },
                repository: { path: 'node_modules/.bin/pi', version: '0.87.1' },
            });
        } finally {
            command.mockRestore();
            which.mockRestore();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('a real Pi column configures Pi and leaves no Claude stub', async () => {
        const skip = getEnvVar('SPUR_SKIP_PROJECT_CONFIG');
        let project: Awaited<ReturnType<typeof scaffoldPerfProject>> | undefined;
        try {
            // The scratch project's declared fleet is the input under test; global config stays off.
            setEnvVar('SPUR_SKIP_PROJECT_CONFIG', 'false');
            project = await scaffoldPerfProject('pi', { realAgents: true });
            const config = readFileSync(join(project.scratch, '.spur/config.yaml'), 'utf8');
            expect(config).toContain('      agent: pi\n');
            expect(config).not.toContain('      agent: claude\n');
            // `Bun.file(...).size` is 0 for a MISSING path too, so the old assertion proved nothing.
            expect(existsSync(project.stubPath)).toBe(false);
        } finally {
            setEnvVar('SPUR_SKIP_PROJECT_CONFIG', skip ?? 'true');
            if (project !== undefined) {
                (await project.openDb()).close();
                rmSync(project.scratch, { recursive: true, force: true });
            }
        }
    }, 20_000);
});
