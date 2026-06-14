import { describe, expect, test } from 'bun:test';

import type { ParsedFeature, ParsedScenario, ParsedStep } from '../../src/bdd/parser';
import { parseFeature } from '../../src/bdd/parser';

/** Narrow ParsedFeature | null to ParsedFeature, failing the test if null. */
function assertParsed(result: ParsedFeature | null): ParsedFeature {
    expect(result).not.toBeNull();
    return result as ParsedFeature;
}

/** Get scenario at index, failing the test if missing. */
function getScenario(f: ParsedFeature, index: number): ParsedScenario {
    const s = f.scenarios[index];
    expect(s).toBeDefined();
    return s as ParsedScenario;
}

/** Get step at index from a scenario, failing the test if missing. */
function getStep(s: ParsedScenario, index: number): ParsedStep {
    const step = s.steps[index];
    expect(step).toBeDefined();
    return step as ParsedStep;
}

describe('parseFeature', () => {
    test('returns null for empty content', () => {
        const result = parseFeature('');
        expect(result).toBeNull();
    });

    test('parses minimal feature', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: My Feature
  Scenario: My Scenario
    Given setup
    When action
    Then result`,
            ),
        );
        expect(f.name).toBe('My Feature');
        expect(f.scenarios).toHaveLength(1);
        const s = getScenario(f, 0);
        expect(s.name).toBe('My Scenario');
        expect(s.steps).toHaveLength(3);
    });

    test('step line numbers are correct (1.1 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Line Numbers
  Scenario: Test
    Given setup on line 3
    When action on line 4
    Then result on line 5`,
            ),
        );
        const s = getScenario(f, 0);
        expect(getStep(s, 0).line).toBe(3);
        expect(getStep(s, 1).line).toBe(4);
        expect(getStep(s, 2).line).toBe(5);
    });

    test('step line numbers are never zero (1.1 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Test
  Scenario: Test
    Given first
    When second
    Then third`,
            ),
        );
        for (const step of getScenario(f, 0).steps) {
            expect(step.line).toBeGreaterThan(0);
        }
    });

    test('parses background steps (1.2 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: With Background

  Background:
    Given the database is seeded
    And the server is running

  Scenario: Test
    When action
    Then result`,
            ),
        );
        expect(f.background).toBeDefined();
        expect(f.background?.steps).toHaveLength(2);
        const bg0 = f.background?.steps[0];
        const bg1 = f.background?.steps[1];
        expect(bg0?.keyword).toBe('Given');
        expect(bg0?.text).toBe('the database is seeded');
        expect(bg1?.keyword).toBe('And');
        expect(bg1?.text).toBe('the server is running');
    });

    test('background steps are separate from scenario steps', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Separation

  Background:
    Given shared setup

  Scenario: First
    When action one
    Then result one

  Scenario: Second
    When action two
    Then result two`,
            ),
        );
        expect(f.background?.steps).toHaveLength(1);
        expect(f.scenarios).toHaveLength(2);
        expect(getScenario(f, 0).steps).toHaveLength(2);
        expect(getScenario(f, 1).steps).toHaveLength(2);
    });

    test('parses doc strings attached to steps (3.4 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Doc strings

  Scenario: JSON payload
    Given the body is:
      """
      { "name": "Test" }
      """
    When I send a request
    Then result`,
            ),
        );
        const givenStep = getStep(getScenario(f, 0), 0);
        expect(givenStep.docString).toBe('{ "name": "Test" }');
    });

    test('parses data tables attached to steps (3.4 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Data tables

  Scenario: Users
    Given the following users exist:
      | name  | role  |
      | Alice | admin |
      | Bob   | user  |
    When I query users
    Then all users are found`,
            ),
        );
        const givenStep = getStep(getScenario(f, 0), 0);
        expect(givenStep.dataTable).toBeDefined();
        expect(givenStep.dataTable).toHaveLength(3);
        expect(givenStep.dataTable?.[0]).toEqual(['name', 'role']);
        expect(givenStep.dataTable?.[1]).toEqual(['Alice', 'admin']);
        expect(givenStep.dataTable?.[2]).toEqual(['Bob', 'user']);
    });

    test('parses scenario outline examples (3.4 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Outline

  Scenario Outline: Add numbers
    Given I have a calculator
    When I add <a> and <b>
    Then the result is <sum>

    Examples:
      | a | b | sum |
      | 1 | 2 | 3   |
      | 5 | 7 | 12  |`,
            ),
        );
        const scenario = getScenario(f, 0);
        expect(scenario.outline).toBeDefined();
        expect(scenario.outline?.examples).toHaveLength(2);
        expect(scenario.outline?.examples[0]).toEqual({ a: '1', b: '2', sum: '3' });
        expect(scenario.outline?.examples[1]).toEqual({ a: '5', b: '7', sum: '12' });
    });

    test('parses feature-level tags (3.5 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `@smoke @regression
Feature: Tagged

  Scenario: Test
    Given setup
    When action
    Then result`,
            ),
        );
        expect(f.tags).toEqual(['@smoke', '@regression']);
    });

    test('parses scenario-level tags (3.5 fix)', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Tagged Scenarios

  @wip
  Scenario: First
    Given setup
    When action
    Then result

  @slow @integration
  Scenario: Second
    Given setup
    When action
    Then result`,
            ),
        );
        expect(getScenario(f, 0).tags).toEqual(['@wip']);
        expect(getScenario(f, 1).tags).toEqual(['@slow', '@integration']);
    });

    test('scenario without tags has no tags property', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: No Tags

  Scenario: Untagged
    Given setup
    When action
    Then result`,
            ),
        );
        expect(f.tags).toBeUndefined();
        expect(getScenario(f, 0).tags).toBeUndefined();
    });

    test('parses multiple scenarios', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Multiple

  Scenario: First
    Given setup one
    When action one
    Then result one

  Scenario: Second
    Given setup two
    When action two
    Then result two`,
            ),
        );
        expect(f.scenarios).toHaveLength(2);
        expect(getScenario(f, 0).name).toBe('First');
        expect(getScenario(f, 1).name).toBe('Second');
    });

    test('parses And and But keywords', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Keywords

  Scenario: All keywords
    Given setup
    And more setup
    But not this setup
    When action
    Then result
    And more result
    But not this result`,
            ),
        );
        const steps = getScenario(f, 0).steps;
        expect(steps).toHaveLength(7);
        expect(steps[1]?.keyword).toBe('And');
        expect(steps[2]?.keyword).toBe('But');
        expect(steps[5]?.keyword).toBe('And');
        expect(steps[6]?.keyword).toBe('But');
    });

    test('parses feature description', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: Described

  This is a description.
  It has multiple lines.

  Scenario: Test
    Given setup`,
            ),
        );
        expect(f.description).toBe('This is a description.\nIt has multiple lines.');
    });

    test('no description returns undefined', () => {
        const f = assertParsed(
            parseFeature(
                `Feature: No Desc
  Scenario: Test
    Given setup`,
            ),
        );
        expect(f.description).toBeUndefined();
    });
});
