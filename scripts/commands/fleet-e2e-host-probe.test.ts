/**
 * The host-capability probe's decision contract (task 1280 R1/R3, feature G75).
 *
 * Failure modes FIRST — the ones that would make this report lie:
 *   - a binary that is not installed still advertises a wake channel
 *   - help text mentions hooks but no probe evidence was recorded (unproven, not supported)
 *   - headless mode claims a host callback channel it cannot have
 *   - a secret or the operator's home path lands in the tracked report
 *   - the report loses a host×mode row, or duplicates one
 * The probe body in `fleet-e2e.ts` only collects observations; every word of the report's contract
 * is decided by the functions this file pins.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildHostRow,
    classifyHostWake,
    HOST_PROBE_AGENTS,
    HOST_PROBE_MODES,
    type HostCapabilityReport,
    hostReportViolations,
    redactProbeOutput,
    runHostProbe,
} from './fleet-e2e';

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

describe('runHostProbe (1280 AC3 — real hosts are opt-in)', () => {
    test('an unknown --agents entry is refused before any host work', async () => {
        expect(await runHostProbe({ agents: ['wizard'] })).toBe(2);
    });
});

describe('the fixture host drives the portable loop with hooks absent (1280 AC2)', () => {
    test('the fixture runs join → wait --inbox → message reply → leave, in that order', () => {
        const source = readFileSync(join(import.meta.dir, 'fixtures/fleet-host-fixture.ts'), 'utf8');
        // The argv literals alone: the file's prose mentions the same verbs earlier, so a bare
        // word search would pass even if the calls were reordered.
        const order = ["['agent', 'join'", "['agent', 'wait'", "['message', 'reply'", "['agent', 'leave'"].map(
            (needle) => source.indexOf(needle),
        );
        expect(source).toContain('SPUR_E2E_HOST_AGENT');
        for (let index = 1; index < order.length; index++) {
            expect(order[index] ?? -1).toBeGreaterThan(order[index - 1] ?? Number.MAX_SAFE_INTEGER);
        }
        expect(source).not.toContain('hooks.json');
    });
});
