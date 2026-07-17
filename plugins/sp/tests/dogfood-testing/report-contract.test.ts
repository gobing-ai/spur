import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateReport } from '../../scripts/dogfood-testing/validate-report';

const SKILL_DIR = join(import.meta.dir, '..', '..', 'skills', 'dogfood-testing');
const FIXTURES = join(import.meta.dir, 'fixtures');

const passFixture = readFileSync(join(FIXTURES, 'report-complete.md'), 'utf8');
const failFixture = readFileSync(join(FIXTURES, 'report-missing-footer.md'), 'utf8');

describe('dogfood @1.2 report contract (task 0276)', () => {
    test('dogfood-fixture-pass — report-complete.md validates clean', () => {
        const result = validateReport(passFixture);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);

        // Golden-shape assertions (0274 R22b) — the fixture is the SSOT example.
        expect(passFixture).toContain('── Dogfood Summary ──');
        expect(passFixture).toContain('[Live:');
        expect(passFixture).toContain('[Report:');
        for (const n of [1, 2, 3, 4, 5, 6]) {
            const re = new RegExp(`^### ${n}\\.`, 'gm');
            expect(passFixture.match(re)).toHaveLength(1);
        }
        expect(passFixture).toContain('#### Fixed');
        expect(passFixture).toContain('#### Unresolved');
        expect(passFixture).toContain('protocol: sp:dogfood-testing@1.2');
    });

    test('dogfood-fixture-fail-footer — missing footer is rejected with missing_footer', () => {
        const result = validateReport(failFixture);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_footer');
        expect(result.errors).toContain('missing_live_path');
        expect(result.errors).toContain('missing_report_path');
    });

    test('dogfood-protocol-string — skill surfaces pin the colon-form @1.2 protocol', () => {
        for (const rel of ['SKILL.md', 'references/report-template.md', 'references/monitor-ledger.md']) {
            const text = readFileSync(join(SKILL_DIR, rel), 'utf8');
            expect(text, `${rel} must carry the @1.2 protocol string`).toContain('sp:dogfood-testing@1.2');
            expect(text, `${rel} must not document the dash form as canonical`).not.toContain(
                'protocol: sp-dogfood-testing@',
            );
        }
        const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
        expect(skill).toContain('version: "1.2"');
        expect(skill).toContain('protocol: "sp:dogfood-testing@1.2"');
    });

    test('validator — duplicated section heading is rejected', () => {
        const mutated = passFixture.replace('### 6. Findings', '### 6. Findings\n\n### 6. Findings (duplicate)');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('duplicate_section:6');
    });

    test('validator — dropped section heading is rejected', () => {
        const mutated = passFixture.replace('### 4. What We Did', '### What We Did');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_section:4');
    });

    test('validator — missing Issues subheads are rejected', () => {
        const mutated = passFixture.replace('#### Unresolved', '#### Open');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_issues_subheads');
    });

    test('validator — ledger row count must equal declared executed steps', () => {
        const mutated = passFixture.replace('**Steps:** 2 derived, 2 executed', '**Steps:** 3 derived, 3 executed');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('ledger_cardinality');
    });

    test('validator — missing ledger section with declared steps is a cardinality failure', () => {
        const mutated = passFixture.replace(/### 3\. Monitor Ledger[\s\S]*?(?=### 4\.)/, '');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('ledger_cardinality');
    });

    test('validator — undeclared Steps line is rejected', () => {
        const mutated = passFixture.replace('- **Steps:** 2 derived, 2 executed, 0 N/A', '- **Steps:** (not recorded)');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_steps_declared');
    });

    test('validator — dash-form protocol string is rejected', () => {
        const mutated = passFixture.replace('protocol: sp:dogfood-testing@1.2', 'protocol: sp-dogfood-testing@1.2');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('protocol_string');
    });

    test('validator — missing protocol frontmatter line is rejected', () => {
        const mutated = passFixture.replace('protocol: sp:dogfood-testing@1.2\n', '');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('protocol_string');
    });

    test('validator — missing [Live:] delivery path is rejected', () => {
        const mutated = passFixture.replace(
            '[Live: .spur/run/dogfood/fixture-complete-0001.md]',
            '(live path omitted)',
        );
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_live_path');
    });
});
