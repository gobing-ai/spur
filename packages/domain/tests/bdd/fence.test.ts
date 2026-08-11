import { describe, expect, test } from 'bun:test';
import { looksLikeGherkinAc, normalizeAcFence, stripAcFence } from '../../src/bdd/fence';

describe('stripAcFence', () => {
    test('removes gherkin code fence lines', () => {
        const input = `\`\`\`gherkin
Feature: Login
  Scenario: A user can log in
    Given a user "alice"
    When they enter valid credentials
    Then they see the dashboard
\`\`\``;
        const result = stripAcFence(input);
        expect(result).toBe(`Feature: Login
  Scenario: A user can log in
    Given a user "alice"
    When they enter valid credentials
    Then they see the dashboard`);
    });

    test('removes any ```-prefixed line regardless of content', () => {
        const input = `\`\`\`
Feature: Example
\`\`\`raw
\`\`\`some-lang
  Scenario: Something
\`\`\``;
        const result = stripAcFence(input);
        expect(result).toBe(`Feature: Example
  Scenario: Something`);
    });

    test('passes through plain text unchanged', () => {
        const input = 'Feature: Plain\n  Scenario: No fence\n    Given no wrapping\n    Then no changes';
        const result = stripAcFence(input);
        expect(result).toBe(input);
    });

    test('handles empty string', () => {
        expect(stripAcFence('')).toBe('');
    });

    test('handles string with only fence lines', () => {
        const input = '```gherkin\n```';
        const result = stripAcFence(input);
        expect(result).toBe('');
    });

    test('handles indented fence lines', () => {
        const input = '  ```gherkin\nFeature: Indented\n  ```';
        const result = stripAcFence(input);
        expect(result).toBe('Feature: Indented');
    });

    test('does not remove lines that merely contain backticks', () => {
        const input = 'Then the output contains ``code``';
        const result = stripAcFence(input);
        expect(result).toBe('Then the output contains ``code``');
    });

    test('handles single newline', () => {
        expect(stripAcFence('\n')).toBe('\n');
    });

    test('preserves blank lines between fence blocks', () => {
        const input = '```gherkin\n\nFeature: Blank\n\n  Scenario: Has blanks\n\n```';
        const result = stripAcFence(input);
        expect(result).toBe('\nFeature: Blank\n\n  Scenario: Has blanks\n');
    });
});

describe('normalizeAcFence', () => {
    test('wraps raw Gherkin in a gherkin fence', () => {
        const input = 'Scenario: R1 — thing works\n  Given a precondition\n  Then an outcome';
        const fence = '```';
        expect(normalizeAcFence(input)).toBe(`${fence}gherkin\n${input}\n${fence}`);
    });

    test('round-trips through stripAcFence to the original body', () => {
        const input = 'Feature: F\n  Scenario: R1 — x\n    Given g\n    Then t';
        expect(stripAcFence(normalizeAcFence(input)).trim()).toBe(input);
    });

    test('leaves already-fenced Gherkin unchanged', () => {
        const input = '```gherkin\nScenario: R1 — x\n```';
        expect(normalizeAcFence(input)).toBe(input);
    });

    test('leaves checklist-tier AC unfenced', () => {
        const input = '- [ ] AC1 thing works\n- [ ] AC2 other thing';
        expect(normalizeAcFence(input)).toBe(input);
    });

    test('leaves empty and whitespace bodies unchanged', () => {
        expect(normalizeAcFence('')).toBe('');
        expect(normalizeAcFence('   \n  ')).toBe('   \n  ');
    });

    test('detects Gherkin behind leading @tags', () => {
        expect(looksLikeGherkinAc('@core\nScenario: R1 — x')).toBe(true);
        expect(looksLikeGherkinAc('plain prose')).toBe(false);
    });
});
