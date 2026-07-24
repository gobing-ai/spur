import { describe, expect, test } from 'bun:test';
import { mergeStubs, scaffoldFeatureScenarios } from '../../src';

describe('BDD scaffold generator (0320)', () => {
    test('R1 & R2: renders 1:1 pending test.todo stub with AAA comments and @ac: tag', () => {
        const ac = `
Scenario: One pending test per scenario
  Given a task whose Acceptance Criteria has multiple Gherkin scenarios
  When BDD scaffold generation runs for that task
  Then one pending test is written per scenario, each named for its scenario
`;
        const stubs = scaffoldFeatureScenarios(ac);
        expect(stubs).toHaveLength(1);
        const stub = stubs[0];
        expect(stub).toBeDefined();
        expect(stub?.scenarioName).toBe('One pending test per scenario');
        expect(stub?.acTag).toBe('one pending test per scenario');
        expect(stub?.code).toContain('// @ac:one pending test per scenario');
        expect(stub?.code).toContain("test.todo('One pending test per scenario', () => {");
        expect(stub?.code).toContain('// Given a task whose Acceptance Criteria has multiple Gherkin scenarios');
        expect(stub?.code).toContain('// When BDD scaffold generation runs for that task');
        expect(stub?.code).toContain('// Then one pending test is written per scenario, each named for its scenario');
    });

    test('R4: Scenario Outline expands per example row with row data comments', () => {
        const ac = `
Scenario Outline: Scenario Outline expands per example row
  Given an AC scenario outline with <count> example rows
  When scaffold generation runs
  Then <count> pending stubs are written with the row data recorded

  Examples:
    | count |
    | 1     |
    | 2     |
`;
        const stubs = scaffoldFeatureScenarios(ac);
        expect(stubs).toHaveLength(2);

        expect(stubs[0]?.scenarioName).toBe('Scenario Outline expands per example row (Example 1: count=1)');
        expect(stubs[0]?.acTag).toBe('scenario outline expands per example row');
        expect(stubs[0]?.code).toContain('// @ac:scenario outline expands per example row');
        expect(stubs[0]?.code).toContain('// Example 1: count=1');
        expect(stubs[0]?.code).toContain('// Given an AC scenario outline with 1 example rows');

        expect(stubs[1]?.scenarioName).toBe('Scenario Outline expands per example row (Example 2: count=2)');
        expect(stubs[1]?.code).toContain('// Example 2: count=2');
        expect(stubs[1]?.code).toContain('// Given an AC scenario outline with 2 example rows');
    });

    test('R3: mergeStubs creates header and stubs when target content is empty', () => {
        const stubs = scaffoldFeatureScenarios(`
Scenario: Foo test
  Given foo
  When bar
  Then baz
`);
        const res = mergeStubs('', stubs);
        expect(res.created).toBe(1);
        expect(res.skipped).toBe(0);
        expect(res.drifted).toBe(0);
        expect(res.content).toContain("import { test } from 'bun:test';");
        expect(res.content).toContain("test.todo('Foo test'");
    });

    test('R3: mergeStubs preserves existing filled stubs, appends new scenarios, and flags drift', () => {
        const existingCode = `import { test } from 'bun:test';

// @ac:first scenario
test('First scenario', () => {
    expect(1).toBe(1);
});

// @ac:removed scenario
test.todo('Removed scenario', () => {
    // Given old scenario
});
`;

        const newAc = `
Scenario: First scenario
  Given first scenario
  When runs
  Then passes

Scenario: Added scenario
  Given new scenario
  When runs
  Then passes
`;

        const newStubs = scaffoldFeatureScenarios(newAc);
        const res = mergeStubs(existingCode, newStubs);

        expect(res.created).toBe(1); // 'Added scenario' appended
        expect(res.skipped).toBe(1); // 'First scenario' skipped
        expect(res.drifted).toBe(1); // 'removed scenario' reported as drift
        expect(res.driftedScenarios).toEqual(['removed scenario']);
        expect(res.content).toContain("test('First scenario', () => {"); // Filled body untouched!
        expect(res.content).toContain("test.todo('Added scenario', () => {");
        expect(res.content).toContain("test.todo('Removed scenario'"); // Old stub kept on disk!
    });
});
