import { describe, expect, test } from 'bun:test';
import { parseChecklist } from '../../src/bdd/checklist';
import { checkAcCoverage, normalizeTitle } from '../../src/bdd/coverage';

describe('normalizeTitle', () => {
    test('lowercases', () => {
        expect(normalizeTitle('User Can Log In')).toBe('user can log in');
    });

    test('strips R-id prefix', () => {
        expect(normalizeTitle('R1: user can log in')).toBe('user can log in');
        expect(normalizeTitle('R2 - password reset')).toBe('password reset');
    });

    test('collapses whitespace', () => {
        expect(normalizeTitle('user   can   log   in')).toBe('user can log in');
    });

    test('strips smart quotes', () => {
        expect(normalizeTitle('User\u2019s \u201cFeature\u201d')).toBe('users feature');
    });

    test('empty after stripping returns empty string', () => {
        expect(normalizeTitle('R1:')).toBe('');
    });
});

describe('checkAcCoverage', () => {
    const featureAc = `Feature: User Management
  Scenario: User can log in
    Given a registered user
    When they submit credentials
    Then they are authenticated
  Scenario: User can reset password
    Given a registered user
    When they request a reset
    Then they receive an email`;

    test('full coverage: all feature scenarios covered by task', () => {
        const taskAc = `Feature: User Management
  Scenario: User can log in
    Given a registered user
    When they submit credentials
    Then they are authenticated
  Scenario: User can reset password
    Given a registered user
    When they request a reset
    Then they receive an email`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(true);
        expect(result.uncovered).toHaveLength(0);
    });

    test('partial coverage: task covers subset', () => {
        const taskAc = `Feature: User Management
  Scenario: User can log in
    Given a registered user
    When they submit credentials
    Then they are authenticated`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(true);
        expect(result.uncovered).toHaveLength(0);
        expect(result.orphans).toEqual(['User can reset password']);
    });

    test('orphan scenarios are warnings not errors', () => {
        const taskAc = `Feature: User Management
  Scenario: User can log in
    Given a registered user
    When they submit credentials
    Then they are authenticated`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(true);
        expect(result.orphans.length).toBeGreaterThan(0);
        const orphanIssues = result.issues.filter((i) => i.severity === 'warning');
        expect(orphanIssues.length).toBeGreaterThan(0);
    });

    test('uncovered task scenario is an error (subset violation)', () => {
        const taskAc = `Feature: User Management
  Scenario: Unknown scenario not in feature
    Given something`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(false);
        expect(result.uncovered).toContain('Unknown scenario not in feature');
        const errorIssues = result.issues.filter((i) => i.severity === 'error');
        expect(errorIssues.length).toBeGreaterThan(0);
    });

    test('R-id prefixed task scenario matches feature scenario', () => {
        const taskAc = `Feature: User Management
  Scenario: R1: User can log in
    Given a registered user
    When they submit credentials
    Then they are authenticated`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(true);
        expect(result.uncovered).toHaveLength(0);
    });

    test('checklist items can cover feature scenarios', () => {
        const checklist = parseChecklist(`- [ ] User can log in
- [ ] User can reset password`);
        const result = checkAcCoverage(featureAc, '', checklist);
        expect(result.covered).toBe(true);
        expect(result.orphans).toHaveLength(0);
    });

    test('checklist item covering unknown scenario is uncovered error', () => {
        const checklist = parseChecklist(`- [ ] Unknown scenario`);
        const result = checkAcCoverage(featureAc, '', checklist);
        expect(result.covered).toBe(false);
        expect(result.uncovered).toContain('Unknown scenario');
    });

    test('non-Gherkin task AC returns empty coverage', () => {
        const result = checkAcCoverage(featureAc, 'Just some text without scenarios');
        expect(result.covered).toBe(true);
        expect(result.orphans).toHaveLength(2);
    });

    test('empty task and empty feature: covered with no orphans', () => {
        const result = checkAcCoverage('', '');
        expect(result.covered).toBe(true);
        expect(result.orphans).toHaveLength(0);
        expect(result.uncovered).toHaveLength(0);
    });

    test('case-insensitive title matching', () => {
        const taskAc = `Feature: User Management
  Scenario: USER CAN LOG IN
    Given something`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(true);
        expect(result.orphans).toEqual(['User can reset password']);
    });

    test('whitespace-insensitive title matching', () => {
        const taskAc = `Feature: User Management
  Scenario: User   Can   Log   In
    Given something`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(true);
    });

    test('bare task Scenario blocks without Feature: still cover (task AC style)', () => {
        // Tasks often omit the Feature: header; only the feature file owns it.
        const taskAc = `@core
Scenario: User can log in
  Given a registered user
  When they submit credentials
  Then they are authenticated`;
        const result = checkAcCoverage(featureAc, taskAc);
        expect(result.covered).toBe(true);
        expect(result.orphans).toEqual(['User can reset password']);
        expect(result.uncovered).toHaveLength(0);
    });
});
