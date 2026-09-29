import { describe, expect, test } from 'bun:test';
import { checkInventoryCoverage } from '../../src/services/feature-inventory';
import { FINDING_CODES } from '../../src/services/finding-codes';

// 1004 R1: behavioral port of the deleted plugin coverage-checker test suite —
// the checker is now the pure `checkInventoryCoverage` consumed by `feature check --inventory`.

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

const expectInventoryFinding = (finding: { code: string; severity: string; layer: string }): void => {
    expect(finding.code).toBe(FINDING_CODES.INVENTORY_COVERAGE);
    expect(finding.severity).toBe('error');
    expect(finding.layer).toBe('L3');
};

describe('checkInventoryCoverage (1004 R1)', () => {
    test('all non-deferred inventory items covered → no findings', () => {
        expect(checkInventoryCoverage(REPORT, AC_FULL)).toEqual([]);
    });

    test('an uncovered owing item is an error and names it; the deferred item stays exempt', () => {
        const ac = AC_FULL.replace('    # covers: I1\n', '');
        const findings = checkInventoryCoverage(REPORT, ac);
        expect(findings).toHaveLength(1);
        const first = findings[0] as { code: string; severity: string; layer: string; message: string };
        expect(first.message).toContain('I1');
        expect(first.message).not.toContain('I3');
        expectInventoryFinding(first);
        expect(first.message).toContain('not [deferred:]');
    });

    test('an unclear item is not exempt — it still owes coverage', () => {
        const ac = AC_FULL.replace('    # covers: I2, I4\n', '    # covers: I2\n');
        const findings = checkInventoryCoverage(REPORT, ac);
        expect(findings.map((f) => f.message).join(' ')).toContain('I4');
        expect(findings.map((f) => f.message).join(' ')).not.toContain('I3');
    });

    test('a missing Requirement inventory section fails closed', () => {
        const findings = checkInventoryCoverage('## Scores\n- urgency: 4\n', AC_FULL);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.message).toContain('no `## Requirement inventory` items');
    });

    test('an empty section (header but no items) fails closed too', () => {
        const findings = checkInventoryCoverage('## Requirement inventory\n\n## Scores\n', AC_FULL);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.message).toContain('no `## Requirement inventory` items');
    });

    test('covers comments outside a scenario body are ignored', () => {
        const ac = ['# covers: I1, I2, I4', '', ...AC_FULL.replace('    # covers: I1\n', '').split('\n')].join('\n');
        const findings = checkInventoryCoverage(REPORT, ac);
        // The floating comment attaches to no scenario, so I1 is not covered by it.
        expect(findings.map((f) => f.message).join(' ')).toContain('I1');
    });
});
