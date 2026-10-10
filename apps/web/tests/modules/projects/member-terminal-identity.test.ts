import { afterAll, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Real-renderer terminal-identity regressions (isolated process, 1163) ────
// Sibling project suites each install a process-global fake `EventSource`
// (MemberDetail/AgentsView/a11y/responsive) and Bun's last registration wins for
// the whole run, so the real `MemberDetail` + real `MemberTerminal`
// alpha→beta regression cannot own its stream in this process. The pipeline file
// is therefore spawned as its own `bun test --isolate` process; this file owns the
// assertions, and the expected-probe list fails the suite if the probe silently
// stops running any of them.
const PROBE = './tests/modules/projects/member-terminal-identity-pipeline.tsx';
const WEB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const REPORT = join(tmpdir(), `spur-member-terminal-identity-probe-${process.pid}.xml`);

const probe = Bun.spawnSync({
    cmd: ['bun', 'test', '--isolate', '--reporter=junit', `--reporter-outfile=${REPORT}`, PROBE],
    cwd: WEB_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
});
const probeOutput = `${probe.stdout.toString()}\n${probe.stderr.toString()}`;
const report = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : '';
rmSync(REPORT, { force: true });

const numberFrom = (pattern: RegExp): number => Number(report.match(pattern)?.[1] ?? -1);
const probeTestCount = numberFrom(/<testsuites[^>]*tests="(\d+)"/);
const probeFailureCount = numberFrom(/<testsuites[^>]*failures="(\d+)"/);
const probeAssertionCount = numberFrom(/<testsuites[^>]*assertions="(\d+)"/);
const probeCases = Array.from(report.matchAll(/<testcase name="([^"]+)"/g), (match) => match[1] as string);

const EXPECTED_PROBES = [
    'real MemberDetail: alpha@seq100 → beta@seq20 drops alpha state and replays beta',
    'real MemberDetail: stale alpha callbacks cannot touch beta DOM',
    'real MemberDetail: session metadata changes keep the same stream and cursor',
    'real MemberDetail: unmount aborts the status request and clears the poll interval',
    'selecting a different watch row remounts the shared detail terminal',
];

afterAll(() => {
    rmSync(REPORT, { force: true });
});

test('AC1/AC2 — every isolated terminal-identity regression ran and passed', () => {
    const missing = EXPECTED_PROBES.filter((name) => !probeCases.includes(name));
    if (probe.exitCode !== 0 || probeFailureCount !== 0 || missing.length > 0) {
        console.error(probeOutput.slice(-4000));
    }
    expect({
        exitCode: probe.exitCode,
        tests: probeTestCount,
        failures: probeFailureCount,
        missing,
        // A probe that stopped rendering would still "pass" with almost no assertions.
        assertionsRan: probeAssertionCount > 30,
    }).toEqual({
        exitCode: 0,
        tests: EXPECTED_PROBES.length,
        failures: 0,
        missing: [],
        assertionsRan: true,
    });
});
