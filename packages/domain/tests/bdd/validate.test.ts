import { describe, expect, test } from 'bun:test';

import { validateAcceptanceCriteria } from '../../src/bdd/validate';

describe('validateAcceptanceCriteria', () => {
    test('minimal valid feature', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Minimal
  Scenario: Happy path
    Given something
    When action
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('feature with background', () => {
        const result = validateAcceptanceCriteria(
            `Feature: With Background

  Background:
    Given the database is seeded
    And the server is running

  Scenario: Test
    Given setup
    When action
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('feature with doc strings', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Doc strings

  Scenario: JSON payload
    Given the request body is:
      """
      { "name": "Test", "value": 42 }
      """
    When I send a POST request
    Then the response should be 200`,
        );
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
    });

    test('feature with scenario outline and examples', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Parametrized

  Scenario Outline: Add numbers
    Given I have a calculator
    When I add <a> and <b>
    Then the result should be <sum>

    Examples:
      | a | b | sum |
      | 1 | 2 | 3   |
      | 5 | 7 | 12  |`,
        );
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('feature with tags', () => {
        const result = validateAcceptanceCriteria(
            `@smoke @regression
Feature: Tagged

  @wip
  Scenario: Test
    Given setup
    When action
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('feature with comments', () => {
        const result = validateAcceptanceCriteria(
            `# This is a comment
Feature: Commented
  # Another comment
  Scenario: Test
    Given setup
    When action
    Then result`,
        );
        expect(result.valid).toBe(true);
    });

    test('feature and scenario descriptions are valid and do not warn', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Described feature
  This feature description is valid Gherkin prose.

  Scenario: Described scenario
    This scenario description is also valid.
    Given setup
    When action
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('Unrecognized syntax'))).toBe(false);
    });

    test('no feature declaration', () => {
        const result = validateAcceptanceCriteria(
            `Scenario: Orphan
    Given something`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('No Feature'))).toBe(true);
    });

    test('multiple feature declarations', () => {
        const result = validateAcceptanceCriteria(
            `Feature: First
Feature: Second
  Scenario: Test
    Given something
    When action
    Then result`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Multiple Feature'))).toBe(true);
    });

    test('empty feature name', () => {
        const result = validateAcceptanceCriteria(
            `Feature:
  Scenario: Test
    Given something
    When action
    Then result`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Feature name is empty'))).toBe(true);
    });

    test('empty scenario name', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario:
    Given something
    When action
    Then result`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Scenario name is empty'))).toBe(true);
    });

    test('empty scenario outline name', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario Outline:
    Given something
    When action
    Then result`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Scenario Outline name is empty'))).toBe(true);
    });

    test('duplicate scenario names', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Same Name
    Given something
    When action
    Then result
  Scenario: Same Name
    Given something else
    When other action
    Then other result`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Duplicate scenario name'))).toBe(true);
    });

    test('duplicate between Scenario and Scenario Outline (2.1 fix)', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Shared Name
    Given something
    When action
    Then result
  Scenario Outline: Shared Name
    Given <thing>
    When <action>
    Then <result>
    Examples:
      | thing | action | result |
      | a     | b      | c      |`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Duplicate scenario name: "Shared Name"'))).toBe(true);
    });

    test('And/But as first step', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Bad first step
    And something`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('cannot be the first step'))).toBe(true);
    });

    test('step outside scenario or background', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Given orphan step`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('outside of any Scenario'))).toBe(true);
    });

    test('background after scenario', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: First
    Given something
    When action
    Then result
  Background:
    Given too late`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Background must come before'))).toBe(true);
    });

    test('data table outside scenario', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  | orphan | table |`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Data table outside of any Scenario'))).toBe(true);
    });

    test('bare keyword without text triggers unrecognized syntax warning', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Empty step
    Given `,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('Unrecognized syntax'))).toBe(true);
    });

    test('unclosed doc string', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Unclosed
    Given the body is:
      """
      { "unclosed": true }`,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Unclosed doc string'))).toBe(true);
    });

    test('steps inside Background are valid (1.3 fix)', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Background steps
  Background:
    Given the database is seeded
    And the server is running
  Scenario: Test
    When action
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.errors.some((e) => e.message.includes('outside of any Scenario'))).toBe(false);
    });

    test('doc string content does not trigger unrecognized syntax (3.3 fix)', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Doc string content
  Scenario: JSON payload
    Given the body is:
      """
      { "name": "Test", "value": 42 }
      """
    When I send a request
    Then the response is 200`,
        );
        expect(result.warnings).toHaveLength(0);
    });

    test('no scenario found is a warning', () => {
        const result = validateAcceptanceCriteria(`Feature: Empty`);
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('No Scenario found'))).toBe(true);
    });

    test('unrecognized syntax is a warning', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Test
    Given something
    When action
    Then result
  random text here`,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('Unrecognized syntax'))).toBe(true);
    });

    test('Then without When warns (2.2 fix)', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Skip When
    Given setup
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('without a preceding "When"'))).toBe(true);
    });

    test('Given -> And -> Then warns about missing When (2.2 fix)', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: And before Then
    Given setup
    And more setup
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('without a preceding "When"'))).toBe(true);
    });

    test('When after Then warns', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Reverse
    Given setup
    When first action
    Then first result
    When second action`,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('consider splitting into separate scenario'))).toBe(true);
    });

    test('Given -> When -> And -> Then does not warn (2.2 fix)', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Normal flow
    Given setup
    When action
    And more action
    Then result`,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings).toHaveLength(0);
    });

    test('Then -> And -> Then does not warn', () => {
        const result = validateAcceptanceCriteria(
            `Feature: Test
  Scenario: Multiple assertions
    Given setup
    When action
    Then result one
    And result two
    Then result three`,
        );
        expect(result.valid).toBe(true);
        expect(result.warnings).toHaveLength(0);
    });
});
