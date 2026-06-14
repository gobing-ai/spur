import { describe, expect, test } from 'bun:test';
import { stripAcFence } from '../../src/bdd/fence';

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
