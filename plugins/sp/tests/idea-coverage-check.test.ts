import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'idea-coverage-check.ts');

function run(dir: string, report: string, ac: string) {
    const reportPath = join(dir, 'eval-report.md');
    const acPath = join(dir, 'ac-content.md');
    writeFileSync(reportPath, report);
    writeFileSync(acPath, ac);
    const stdout = execFileSync(
        'bun',
        [SCRIPT, '--run-id', 'run-0887', '--report', reportPath, '--ac', acPath, '--out', join(dir, 'coverage.status')],
        { stdio: 'pipe' },
    ).toString();
    return {
        status: readFileSync(join(dir, 'coverage.status'), 'utf8'),
        reason: readFileSync(join(dir, 'coverage.status.reason'), 'utf8'),
        stdout,
    };
}

const REPORT = [
    '## Requirement inventory',
    '',
    '- I1 — Capture the idea verbatim before any processing (source: "exact words the operator typed")',
    '- I2 — Generate acceptance criteria mapped to each requirement',
    '- I3 — Allow a deferral when a requirement is explicitly out of scope [deferred: postponed to I13]',
    '- I4 — Tolerate a fuzzy ask [unclear: the operator left the volume open-ended]',
    '',
].join('\n');

const AC_FULL = [
    'Feature: idea pipeline robustness',
    '',
    '  Scenario: Verbatim idea artifact persisted',
    '    # covers: I1',
    '    Given an operator idea',
    '    When the run starts',
    '    Then the idea-input artifact matches the argument text',
    '',
    '  Scenario: AC coverage mapping',
    '    # covers: I2, I4',
    '    Given an inventory with a fuzzy item',
    '    When acceptance criteria are generated',
    '    Then every requirement maps to a scenario',
    '',
].join('\n');

test('all non-deferred inventory items covered → PASS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idea-coverage-'));
    try {
        const { status, reason, stdout } = run(dir, REPORT, AC_FULL);
        expect(status).toBe('PASS\n');
        expect(reason).toContain('PASS run=run-0887');
        expect(reason).toContain('all covered');
        expect(stdout).toContain('idea-coverage-check PASS run=run-0887');
        expect(stdout).toContain('deferred=1');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('an uncovered owing item → FAIL and names it; the deferred item stays exempt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idea-coverage-'));
    try {
        const ac = AC_FULL.replace('    # covers: I1\n', '');
        const { status, reason, stdout } = run(dir, REPORT, ac);
        expect(status).toBe('FAIL\n');
        expect(reason).toContain('FAIL run=run-0887');
        expect(reason).toContain('uncovered=I1');
        expect(stdout).toContain('uncovered=I1');
        // The deferred item alone never fails the gate.
        expect(stdout).not.toContain('uncovered=I3');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('an unclear item is not exempt — it still owes coverage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idea-coverage-'));
    try {
        const ac = AC_FULL.replace('    # covers: I2, I4\n', '    # covers: I2\n');
        const { status, stdout } = run(dir, REPORT, ac);
        expect(status).toBe('FAIL\n');
        expect(stdout).toContain('uncovered=I4');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a missing Requirement inventory section fails closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idea-coverage-'));
    try {
        const { status, stdout } = run(dir, '## Scores\n- urgency: 4\n', AC_FULL);
        expect(status).toBe('FAIL\n');
        expect(stdout).toContain('no Requirement inventory items');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('absent input files fail closed rather than crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idea-coverage-'));
    try {
        const outPath = join(dir, 'coverage.status');
        const stdout = execFileSync(
            'bun',
            [
                SCRIPT,
                '--run-id',
                'run-0887',
                '--report',
                join(dir, 'absent.md'),
                '--ac',
                join(dir, 'absent-ac.md'),
                '--out',
                outPath,
            ],
            { stdio: 'pipe' },
        ).toString();
        expect(readFileSync(outPath, 'utf8')).toBe('FAIL\n');
        expect(readFileSync(`${outPath}.reason`, 'utf8')).toContain('missing input');
        expect(stdout).toContain('missing input');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('covers comments outside a scenario body are ignored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idea-coverage-'));
    try {
        const ac = ['# covers: I1, I2, I4', '', ...AC_FULL.replace('    # covers: I1\n', '').split('\n')].join('\n');
        const { status, stdout } = run(dir, REPORT, ac);
        // The floating comment attaches to no scenario, so I1 is not covered by it.
        expect(status).toBe('FAIL\n');
        expect(stdout).toContain('uncovered=I1');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
