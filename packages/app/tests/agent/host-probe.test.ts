/**
 * The host-capability probe's decision contract (task 1280 R1/R3, feature G75).
 *
 * Failure modes FIRST — the ones that would make this report lie:
 *   - a binary that is not installed still advertises a wake channel
 *   - help text mentions hooks but no probe evidence was recorded (unproven, not supported)
 *   - headless mode claims a host callback channel it cannot have
 *   - a secret or the operator's home path lands in the tracked report
 *   - the report loses a host×mode row, or duplicates one
 * The probe service (`packages/app/src/agent/host-probe.ts`) only collects observations; every word
 * of the report's contract is decided by the functions this file pins.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildHostRow,
    classifyHostWake,
    HOST_PROBE_AGENTS,
    HOST_PROBE_MODES,
    HOST_PROBE_TIMEOUT_MS,
    type HostCapabilityReport,
    hostProbeReportPath,
    hostReportViolations,
    redactProbeOutput,
    runHostBinary,
    runHostProbe,
} from '../../src/agent/host-probe';

const claudeHelp = 'Usage: claude [options]\n  --hooks            run the configured Stop hooks\n';

/** A complete, contract-honouring report for the violation tests to mutate. */
function cleanReport(): HostCapabilityReport {
    return {
        schemaVersion: 1,
        generatedAt: '2026-10-22T00:00:00.000Z',
        hosts: HOST_PROBE_AGENTS.flatMap((agent) =>
            HOST_PROBE_MODES.map((mode) => buildHostRow({ agent, mode, binary: null, helpText: '', evidence: null })),
        ),
    };
}

describe('classifyHostWake (1280 R3)', () => {
    test('headless mode is pull-only with a reason, whatever the help text advertises', () => {
        const classified = classifyHostWake({ mode: 'headless', helpText: claudeHelp });
        expect(classified.wake).toBe('pull-only');
        expect(classified.reason ?? '').toContain('headless');
    });

    test('interactive hook / rpc / app-server surfaces are recognised in that order', () => {
        expect(classifyHostWake({ mode: 'interactive', helpText: claudeHelp }).wake).toBe('hook');
        expect(classifyHostWake({ mode: 'interactive', helpText: '  --rpc-port <n>' }).wake).toBe('rpc');
        expect(classifyHostWake({ mode: 'interactive', helpText: '  --app-server-url <url>' }).wake).toBe('app-server');
    });

    test('no recognised surface is pull-only with an actionable reason', () => {
        const classified = classifyHostWake({ mode: 'interactive', helpText: 'Usage: pi [options]' });
        expect(classified.wake).toBe('pull-only');
        expect(classified.reason ?? '').not.toBe('');
    });
});

describe('buildHostRow (1280 R1/R3)', () => {
    test('an absent binary can never advertise a wake channel', () => {
        const row = buildHostRow({
            agent: 'codex',
            mode: 'interactive',
            binary: null,
            helpText: claudeHelp,
            evidence: null,
        });
        expect(row.binary).toBe('absent');
        expect(row.wake).toBe('pull-only');
        expect(row.evidence).toBeNull();
        expect(row.reason ?? '').toContain('not installed');
    });

    test('help text alone does not prove a wake channel — unproven downgrades to pull-only', () => {
        const row = buildHostRow({
            agent: 'claude',
            mode: 'interactive',
            binary: { path: '/usr/local/bin/claude', version: '1.2.3' },
            helpText: claudeHelp,
            evidence: null,
        });
        expect(row.wake).toBe('pull-only');
        expect(row.reason ?? '').toContain('no probe evidence');
    });

    test('a proven wake channel keeps its probe command and observed output', () => {
        const row = buildHostRow({
            agent: 'claude',
            mode: 'interactive',
            binary: { path: '/usr/local/bin/claude', version: '1.2.3' },
            helpText: claudeHelp,
            evidence: { command: 'claude --help', output: '--hooks run the configured Stop hooks' },
        });
        expect(row.wake).toBe('hook');
        expect(row.evidence?.command).toBe('claude --help');
        expect(row.evidence?.output).toContain('--hooks');
    });

    test('the report never carries a secret or the operator home prefix', () => {
        const row = buildHostRow({
            agent: 'pi',
            mode: 'interactive',
            binary: { path: '/Users/robin/.local/bin/pi', version: 'pi 2.0 (token sk-liveSECRET1234)' },
            helpText: '  --rpc',
            evidence: { command: 'pi --help', output: 'sk-proj-SECRETVALUE99' },
        });
        const serialized = JSON.stringify(row);
        expect(serialized).not.toContain('sk-proj-SECRETVALUE99');
        expect(serialized).not.toContain('sk-liveSECRET1234');
        expect(serialized).not.toContain('/Users/');
        expect(serialized).toContain('~');
    });
});

/** The first row, or a loud failure — a report with no rows is a broken fixture, not an assertion. */
function firstRow(report: HostCapabilityReport) {
    const row = report.hosts[0];
    if (row === undefined) throw new Error('the report has no rows');
    return row;
}

describe('hostReportViolations (1280 R1 — one row per host×mode, evidence-or-nothing)', () => {
    test('the complete report built from unproven rows is clean', () => {
        expect(hostReportViolations(cleanReport())).toEqual([]);
    });

    test('a missing host×mode row is a violation', () => {
        const report = cleanReport();
        report.hosts = report.hosts.filter((row) => !(row.agent === 'pi' && row.mode === 'headless'));
        expect(hostReportViolations(report).join(' ')).toContain('missing row for pi:headless');
    });

    test('a duplicate row is a violation', () => {
        const report = cleanReport();
        report.hosts.push({ ...firstRow(report) });
        expect(hostReportViolations(report).join(' ')).toContain('duplicate row');
    });

    test('a wake channel without probe evidence is a violation', () => {
        const report = cleanReport();
        report.hosts[0] = {
            ...firstRow(report),
            binary: { path: '/usr/local/bin/codex', version: '0.9.0' },
            wake: 'app-server',
            evidence: null,
        };
        expect(hostReportViolations(report).join(' ')).toContain('cites no probe evidence');
    });

    test('an absent binary that advertises wake is a violation', () => {
        const report = cleanReport();
        report.hosts[0] = { ...firstRow(report), wake: 'hook', evidence: { command: 'x --help', output: 'hooks' } };
        expect(hostReportViolations(report).join(' ')).toContain('absent binary cannot advertise');
    });
});

describe('redactProbeOutput (1280 R1 — recorded verbatim, redacted)', () => {
    test('redacts credential-shaped tokens and the home prefix', () => {
        expect(redactProbeOutput('token=ghp_ABCDEFGH12345678 ok')).toBe('token=[redacted] ok');
    });
});

describe('runHostBinary (task 1414 — bounded probe)', () => {
    /** A fake host: `body` runs instead of a real CLI, so the test owns the timing. */
    function fakeHost(body: string): string {
        const root = mkdtempSync(join(tmpdir(), 'spur-host-bin-'));
        const script = join(root, 'host');
        writeFileSync(script, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
        return script;
    }

    test('a binary that never answers is cut at its budget instead of hanging the probe', async () => {
        // The failure this pins: unbounded spawnSync let a wedged host (codex 0.171.0 on macOS)
        // hang `spur agent doctor-hosts` until the caller's timeout killed it.
        const script = fakeHost('sleep 30');
        try {
            const startedAt = Date.now();
            const result = await runHostBinary(script, ['--help'], 300);
            expect(result.timedOut).toBe(true);
            expect(result.output.trim()).toBe('');
            expect(Date.now() - startedAt).toBeLessThan(5_000);
        } finally {
            rmSync(join(script, '..'), { recursive: true, force: true });
        }
    }, 15_000);

    test('a healthy binary reports its output inside the budget', async () => {
        const script = fakeHost('echo "Usage: host [options]"');
        try {
            const result = await runHostBinary(script, ['--help'], HOST_PROBE_TIMEOUT_MS);
            expect(result.timedOut).toBe(false);
            expect(result.exitCode).toBe(0);
            expect(result.output).toContain('Usage: host [options]');
        } finally {
            rmSync(join(script, '..'), { recursive: true, force: true });
        }
    });
});

describe('buildHostRow probe failure', () => {
    test('a binary that blew its deadline is pull-only with the deadline as its reason', () => {
        // Empty help text would otherwise be explained as "names no channel", which hides the real
        // cause: the host never answered.
        const row = buildHostRow({
            agent: 'codex',
            mode: 'interactive',
            binary: { path: '/opt/homebrew/bin/codex', version: 'unknown' },
            helpText: '',
            evidence: null,
            probeFailure: 'codex --help did not answer within 2500ms — pull-only until it does',
        });
        expect(row.wake).toBe('pull-only');
        expect(row.evidence).toBeNull();
        expect(row.reason ?? '').toContain('did not answer within');
        expect(
            hostReportViolations({ schemaVersion: 1, generatedAt: '2026-11-23T00:00:00.000Z', hosts: [row] }),
        ).toContain('missing row for codex:headless');
    });
});

describe('runHostProbe', () => {
    test('an unknown --agents entry is refused before any host work', async () => {
        const outcome = await runHostProbe({ cwd: process.cwd(), agents: ['wizard'] });
        expect(outcome.usage).toBe(true);
        expect(outcome.report).toBeNull();
        expect(outcome.lines.join('\n')).toContain('unknown agents: wizard (known: codex, claude, pi)');
    });

    test('probes every agent and writes the report without launching a host', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-host-probe-'));
        try {
            const outcome = await runHostProbe({ cwd: root, out: 'report.json' });
            expect(outcome.ok).toBe(true);
            expect(outcome.report?.hosts).toHaveLength(HOST_PROBE_AGENTS.length * HOST_PROBE_MODES.length);
            expect(outcome.reportPath).toBe(join(root, 'report.json'));
            for (const row of outcome.report?.hosts ?? []) {
                expect(row.e2e).toBeUndefined();
                if (row.binary === 'absent') expect(row.wake).toBe('pull-only');
            }
            expect(JSON.parse(readFileSync(outcome.reportPath, 'utf8')).schemaVersion).toBe(1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        // The probe reads whatever binaries this machine has; one wedged host burns its whole
        // per-run budget (2 runs × HOST_PROBE_TIMEOUT_MS), so the wall clock is not bun's 5s default.
    }, 30_000);

    test('the report path honours --out and the default', () => {
        expect(hostProbeReportPath('/p')).toBe('/p/docs/reports/fleet-host-capabilities.json');
        expect(hostProbeReportPath('/p', 'r/out.json')).toBe('/p/r/out.json');
    });
});
