import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { type CheckFeatureResult, FeatureCheckService } from '../../src/services/feature-check';

function seedFile(content: string): { fs: ReturnType<typeof createNodeFileSystem>; path: string; cleanup(): void } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-feature-check-'));
    const filePath = join(dir, 'A_feature.md');
    writeFileSync(filePath, content);
    return {
        fs: createNodeFileSystem(),
        path: filePath,
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
}

function seedFeaturesDir(files: Record<string, string>): {
    fs: ReturnType<typeof createNodeFileSystem>;
    dir: string;
    cleanup(): void;
} {
    const dir = mkdtempSync(join(tmpdir(), 'spur-feature-check-dir-'));
    for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(dir, name), content);
    }
    return {
        fs: createNodeFileSystem(),
        dir,
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
}

describe('FeatureCheckService', () => {
    // ── L1: Schema validation ────────────────────────────────────────────

    test('L1: schema validation passes for valid feature frontmatter', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "A"',
            'name: "Valid Feature"',
            'status: backlog',
            'priority: P1',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# A: Valid Feature',
            '',
            '## Goal',
            '',
            'Build a feature check system.',
            '',
            '## Scope',
            '',
            'In scope: validation',
            'Out of scope: deployment',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'A');
        cleanup();

        expect(result.pass).toBe(true);
        expect(result.findings.filter((f) => f.layer === 'L1' && f.severity === 'error')).toHaveLength(0);
    });

    test('L1: schema validation catches missing required field', async () => {
        const content = ['---', 'status: backlog', '---', '', '# A: Bad feature'].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'A');
        cleanup();

        const l1Errors = result.findings.filter((f) => f.layer === 'L1' && f.severity === 'error');
        expect(l1Errors.length).toBeGreaterThan(0);
        expect(result.pass).toBe(false);
    });

    test('L1: schema rejects invalid feature ID format', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "invalid-id"',
            'name: "Bad ID"',
            'status: backlog',
            'priority: P2',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# invalid-id: Bad ID',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'invalid-id');
        cleanup();

        const l1Errors = result.findings.filter((f) => f.layer === 'L1' && f.severity === 'error');
        expect(l1Errors.length).toBeGreaterThan(0);
        expect(result.pass).toBe(false);
    });

    test('L1: markdown parse failure produces error', async () => {
        const { fs, path, cleanup } = seedFile('not valid yaml ---');
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'A');
        cleanup();

        // No frontmatter means schema validation fails
        expect(result.pass).toBe(false);
    });

    // ── L2: Section presence ─────────────────────────────────────────────

    test('L2: active status requires Goal, Scope, Acceptance Criteria', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "B"',
            'name: "Active Feature"',
            'status: active',
            'priority: P1',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# B: Active Feature',
            '',
            '## Goal',
            '',
            'The goal.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'B');
        cleanup();

        const l2Errors = result.findings.filter((f) => f.layer === 'L2' && f.severity === 'error');
        // active has gate:true, so missing Scope and Acceptance Criteria are errors
        expect(l2Errors.length).toBeGreaterThan(0);
        expect(result.pass).toBe(false);
        expect(result.missingSections).toContain('Scope');
        expect(result.missingSections).toContain('Acceptance Criteria');
    });

    // Group (umbrella) features carry no Acceptance Criteria — their leaf children own it.
    // Before the `group` matrix variant existed, every group feature in the corpus (A-H) failed
    // the L2 gate on a section the convention says they must not have.
    test('L2: group-tagged active feature does not require Acceptance Criteria', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "B"',
            'name: "Umbrella Feature"',
            'status: active',
            'priority: P1',
            'tags: [group]',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# B: Umbrella Feature',
            '',
            '## Goal',
            '',
            'The goal.',
            '',
            '## Scope',
            '',
            'The scope.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'B');
        cleanup();

        expect(result.missingSections).not.toContain('Acceptance Criteria');
        expect(result.findings.filter((f) => f.layer === 'L2' && f.severity === 'error')).toHaveLength(0);
        expect(result.pass).toBe(true);
    });

    test('L2: group variant still requires Goal and Scope', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "B"',
            'name: "Umbrella Feature"',
            'status: active',
            'priority: P1',
            'tags: [group]',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# B: Umbrella Feature',
            '',
            '## Goal',
            '',
            'The goal.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'B');
        cleanup();

        // The exemption is scoped to Acceptance Criteria — an umbrella must still say what it covers.
        expect(result.missingSections).toContain('Scope');
        expect(result.pass).toBe(false);
    });

    test('L2: an untagged active feature is still gated on Acceptance Criteria', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "B"',
            'name: "Leaf Feature"',
            'status: active',
            'priority: P1',
            'tags: [rd3-migration]',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# B: Leaf Feature',
            '',
            '## Goal',
            '',
            'The goal.',
            '',
            '## Scope',
            '',
            'The scope.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'B');
        cleanup();

        expect(result.missingSections).toContain('Acceptance Criteria');
        expect(result.pass).toBe(false);
    });

    test('L2: backlog status has no required sections', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "C"',
            'name: "Backlog Feature"',
            'status: backlog',
            'priority: P3',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# C: Backlog Feature',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'C');
        cleanup();

        const l2Errors = result.findings.filter((f) => f.layer === 'L2' && f.severity === 'error');
        expect(l2Errors).toHaveLength(0);
        expect(result.pass).toBe(true);
    });

    test('L2: cancelled status requires Notes', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "D"',
            'name: "Cancelled Feature"',
            'status: cancelled',
            'priority: P2',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# D: Cancelled Feature',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'D');
        cleanup();

        // cancelled has no gate:true, so missing Notes is a warning, not error
        const l2Warnings = result.findings.filter(
            (f) => f.layer === 'L2' && f.severity === 'warning' && f.section === 'Notes',
        );
        expect(l2Warnings.length).toBeGreaterThan(0);
        // Should still pass since it's a warning
        expect(result.pass).toBe(true);
    });

    // ── L3: Format rules ─────────────────────────────────────────────────

    test('L3: validates BDD Acceptance Criteria syntax', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "E"',
            'name: "BDD Feature"',
            'status: verifying',
            'priority: P1',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# E: BDD Feature',
            '',
            '## Goal',
            '',
            'Test BDD validation.',
            '',
            '## Scope',
            '',
            'In scope: AC validation.',
            '',
            '## Acceptance Criteria',
            '',
            'Feature: Login',
            '',
            '  Scenario: Successful login',
            '    Given a registered user',
            '    When they enter valid credentials',
            '    Then they are logged in',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'E');
        cleanup();

        // BDD valid — no L3 errors from AC
        const l3Errors = result.findings.filter((f) => f.layer === 'L3' && f.severity === 'error');
        expect(l3Errors).toHaveLength(0);
    });

    test('L3: detects invalid BDD syntax in Acceptance Criteria', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "F"',
            'name: "Bad BDD"',
            'status: active',
            'priority: P2',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# F: Bad BDD',
            '',
            '## Goal',
            '',
            'Test bad BDD.',
            '',
            '## Scope',
            '',
            'In scope: BDD errors.',
            '',
            '## Acceptance Criteria',
            '',
            'Scenario: Missing feature keyword',
            '  Given something',
            '  When something',
            '  Then something',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'F');
        cleanup();

        // BDD invalid — should have errors
        const l3Errors = result.findings.filter(
            (f) => f.layer === 'L3' && f.severity === 'error' && f.section === 'Acceptance Criteria',
        );
        expect(l3Errors.length).toBeGreaterThan(0);
    });

    // ── L3: Wayfinder-map AC skip (task 0473) ──────────────────────────

    test('L3: wayfinder-map tag skips BDD AC validation for prose disclaimer', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "M"',
            'name: "Wayfinder Map"',
            'status: active',
            'priority: P1',
            'tags: ["wayfinder-map"]',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# M: Wayfinder Map',
            '',
            '## Goal',
            '',
            'Discover the path to a specable feature.',
            '',
            '## Scope',
            '',
            'In scope: investigation.',
            '',
            '## Acceptance Criteria',
            '',
            '### Not yet specified',
            '',
            'This is a wayfinder map — acceptance criteria emerge when the destination is reached.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'M');
        cleanup();

        // Map tagged → BDD AC validation suppressed despite prose disclaimer
        const acErrors = result.findings.filter(
            (f) =>
                f.layer === 'L3' &&
                f.severity === 'error' &&
                f.section === 'Acceptance Criteria' &&
                (f.code === 'L3.ac-bdd-error' || f.code === 'L3.ac-bdd-invalid'),
        );
        expect(acErrors).toHaveLength(0);
    });

    test('L3: wayfinder-map tag still runs non-AC checks (scope delineation)', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "M"',
            'name: "Wayfinder Map No Scope"',
            'status: active',
            'priority: P1',
            'tags: ["wayfinder-map"]',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# M: Wayfinder Map No Scope',
            '',
            '## Goal',
            '',
            'Discover something.',
            '',
            '## Scope',
            '',
            'Free-form text with no in-scope markers.',
            '',
            '## Acceptance Criteria',
            '',
            '### Not yet specified',
            '',
            'Map destination.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'M');
        cleanup();

        // Scope check stays live for maps — no in/out delineation → warning
        const scopeWarnings = result.findings.filter((f) => f.layer === 'L3' && f.code === 'L3.scope-delineation');
        expect(scopeWarnings.length).toBe(1);
    });

    test('L3: untagged feature with prose AC still gets BDD errors', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "X"',
            'name: "Not A Map"',
            'status: active',
            'priority: P1',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# X: Not A Map',
            '',
            '## Goal',
            '',
            'Build something testable.',
            '',
            '## Scope',
            '',
            'In scope: feature work.',
            '',
            '## Acceptance Criteria',
            '',
            '### Not yet specified',
            '',
            'This is NOT a wayfinder map — should fail BDD validation.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'X');
        cleanup();

        // No tag → BDD AC validation is live → prose disclaimer triggers errors
        const acErrors = result.findings.filter(
            (f) =>
                f.layer === 'L3' &&
                f.severity === 'error' &&
                f.section === 'Acceptance Criteria' &&
                (f.code === 'L3.ac-bdd-error' || f.code === 'L3.ac-bdd-invalid'),
        );
        expect(acErrors.length).toBeGreaterThan(0);
    });

    test('L3: warns when Scope lacks in/out delineation', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "G"',
            'name: "Vague Scope"',
            'status: active',
            'priority: P3',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# G: Vague Scope',
            '',
            '## Goal',
            '',
            'Test scope.',
            '',
            '## Scope',
            '',
            'This is just free-form text with no in-scope markers.',
            '',
            '## Acceptance Criteria',
            '',
            'Feature: Test',
            '',
            '  Scenario: Placeholder',
            '    Given nothing',
            '    When nothing',
            '    Then nothing',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'G');
        cleanup();

        const scopeWarning = result.findings.filter(
            (f) => f.layer === 'L3' && f.severity === 'warning' && f.section === 'Scope',
        );
        expect(scopeWarning.length).toBeGreaterThan(0);
    });

    // The scaffold in feature-service.ts emits `- In:` / `- Out:` bullets. The check must
    // accept its own scaffold: a prior `/\b[Ii]n:\b/` could never match them (a `\b` after
    // a colon needs a following word char), so every freshly created feature warned.
    test.each([
        ['scaffold bullets', ['- In:', '- Out:']],
        ['bold labels', ['**In scope:**', '**Out of scope:**']],
        ['bare labels', ['In:', 'Out:']],
        ['prose headings', ['In scope', 'Out of scope']],
    ])('L3: accepts in/out delineation written as %s', async (_label, scopeLines) => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "G"',
            'name: "Delineated Scope"',
            'status: active',
            'priority: P3',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# G: Delineated Scope',
            '',
            '## Goal',
            '',
            'Test scope.',
            '',
            '## Scope',
            '',
            ...scopeLines,
            '',
            '## Acceptance Criteria',
            '',
            'Feature: Test',
            '',
            '  Scenario: Placeholder',
            '    Given nothing',
            '    When nothing',
            '    Then nothing',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'G');
        cleanup();

        const scopeWarning = result.findings.filter(
            (f) => f.layer === 'L3' && f.severity === 'warning' && f.section === 'Scope',
        );
        expect(scopeWarning).toEqual([]);
    });

    // ── L3: One-active-goal ──────────────────────────────────────────────

    test('L3: one-active-goal detects conflicting P0 active/verifying features', async () => {
        const files: Record<string, string> = {
            'A_first.md': [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "First P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: First P0',
            ].join('\n'),
            'B_second.md': [
                '---',
                'schema_version: 1',
                'id: "B"',
                'name: "Second P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# B: Second P0',
            ].join('\n'),
        };

        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);

        // Check the second feature — should detect conflict with first
        const result = await svc.check(`${dir}/B_second.md`, 'B', {
            featuresDir: dir,
        });
        cleanup();

        const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
        expect(goalErrors.length).toBe(1);
        expect(goalErrors[0]?.severity).toBe('error');
        expect(result.pass).toBe(false);
    });

    test('L3: one-active-goal passes when only one P0 active feature', async () => {
        const files: Record<string, string> = {
            'A_solo.md': [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Solo P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Solo P0',
            ].join('\n'),
        };

        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);

        const result = await svc.check(`${dir}/A_solo.md`, 'A', {
            featuresDir: dir,
        });
        cleanup();

        const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
        expect(goalErrors).toHaveLength(0);
    });

    test('L3: one-active-goal not triggered for non-P0 features', async () => {
        const files: Record<string, string> = {
            'A_p0_active.md': [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Only P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Only P0',
            ].join('\n'),
            'B_p1_active.md': [
                '---',
                'schema_version: 1',
                'id: "B"',
                'name: "P1 Feature"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# B: P1 Feature',
            ].join('\n'),
        };

        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);

        // Check P1 feature — should not trigger one-active-goal
        const result = await svc.check(`${dir}/B_p1_active.md`, 'B', {
            featuresDir: dir,
        });
        cleanup();

        const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
        expect(goalErrors).toHaveLength(0);
    });

    test('L3: one-active-goal does not count verifying as an active goal (0418)', async () => {
        // 0418: a P0 in `verifying` is terminal-bound (verification toward done,
        // DD-13), not an active goal — it neither triggers the rule when checked
        // nor blocks another P0 from being the single active goal.
        const files: Record<string, string> = {
            'A_active.md': [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Active P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Active P0',
            ].join('\n'),
            'B_verifying.md': [
                '---',
                'schema_version: 1',
                'id: "B"',
                'name: "Verifying P0"',
                'status: verifying',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# B: Verifying P0',
            ].join('\n'),
        };

        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);

        // Checking the verifying feature: it is not an active goal → no finding.
        const resultB = await svc.check(`${dir}/B_verifying.md`, 'B', {
            featuresDir: dir,
        });
        // Checking the active feature: B in verifying no longer blocks A — A is
        // the sole active P0 goal.
        const resultA = await svc.check(`${dir}/A_active.md`, 'A', {
            featuresDir: dir,
        });
        cleanup();

        for (const result of [resultA, resultB]) {
            const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
            expect(goalErrors).toHaveLength(0);
        }
    });

    // ── L3: One-active-goal — direction-aware (0418) ─────────────────────

    test('L3: one-active-goal is direction-aware — the relieving transition (--as verifying) is not denied (0418)', async () => {
        // The deadlock fixture: two P0 features both `active`. The active→verifying
        // guard checks the feature with `--as verifying`; the rule must evaluate
        // the POST-transition state (verifying = not an active goal) and let the
        // exit through — the transition that leaves a single active goal must not
        // be denied by the rule it relieves.
        const files: Record<string, string> = {
            'A_first.md': [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "First P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: First P0',
                '',
                '## Goal',
                '',
                'Finish.',
                '',
                '## Scope',
                '',
                'In: x',
                'Out: y',
                '',
                '## Acceptance Criteria',
                '',
                '- [ ] fixture item',
            ].join('\n'),
            'B_second.md': [
                '---',
                'schema_version: 1',
                'id: "B"',
                'name: "Second P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# B: Second P0',
                '',
                '## Goal',
                '',
                'Finish.',
                '',
                '## Scope',
                '',
                'In: x',
                'Out: y',
                '',
                '## Acceptance Criteria',
                '',
                '- [ ] fixture item',
            ].join('\n'),
        };

        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);

        const result = await svc.check(`${dir}/B_second.md`, 'B', {
            featuresDir: dir,
            asStatus: 'verifying',
        });
        cleanup();

        const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
        expect(goalErrors).toHaveLength(0);
        expect(result.pass).toBe(true);
    });

    test('L3: one-active-goal is direction-aware — entering active (--as active) while another P0 is active is denied (0418)', async () => {
        // The WIP limit still governs ENTRY: a P0 activating (backlog → active)
        // while another P0 is active must be denied.
        const files: Record<string, string> = {
            'A_active.md': [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Active P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Active P0',
            ].join('\n'),
            'B_backlog.md': [
                '---',
                'schema_version: 1',
                'id: "B"',
                'name: "Backlog P0"',
                'status: backlog',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# B: Backlog P0',
            ].join('\n'),
        };

        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);

        const result = await svc.check(`${dir}/B_backlog.md`, 'B', {
            featuresDir: dir,
            asStatus: 'active',
        });
        cleanup();

        const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
        expect(goalErrors).toHaveLength(1);
        expect(goalErrors[0]?.severity).toBe('error');
        expect(result.pass).toBe(false);
    });

    test('L3: one-active-goal is direction-aware — a done target (--as done) is not denied (0418)', async () => {
        // The verifying→done guard checks with `--as done`; a feature leaving the
        // goal set for terminal must not be blocked by the rule.
        const files: Record<string, string> = {
            'A_active.md': [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Active P0"',
                'status: active',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Active P0',
                '',
                '## Goal',
                '',
                'Finish.',
                '',
                '## Scope',
                '',
                'In: x',
                'Out: y',
                '',
                '## Acceptance Criteria',
                '',
                '- [ ] fixture item',
            ].join('\n'),
            'B_verifying.md': [
                '---',
                'schema_version: 1',
                'id: "B"',
                'name: "Verifying P0"',
                'status: verifying',
                'priority: P0',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# B: Verifying P0',
                '',
                '## Goal',
                '',
                'Finish.',
                '',
                '## Scope',
                '',
                'In: x',
                'Out: y',
                '',
                '## Acceptance Criteria',
                '',
                '- [ ] fixture item',
                '',
                // D61 task 0765: --as done now drives the matrix selection, so
                // the fixture must satisfy the done-status matrix (Tasks required).
                '## Tasks',
                '',
                '- [ ] fixture task',
            ].join('\n'),
        };

        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);

        const result = await svc.check(`${dir}/B_verifying.md`, 'B', {
            featuresDir: dir,
            asStatus: 'done',
        });
        cleanup();

        const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
        expect(goalErrors).toHaveLength(0);
        expect(result.pass).toBe(true);
    });

    // ── L3: Children-limit (DD-14, corpus-derived) ───────────────────────

    function featureFile(id: string): string {
        return [
            '---',
            'schema_version: 1',
            `id: "${id}"`,
            `name: "Feature ${id}"`,
            'status: backlog',
            'priority: P2',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            `# ${id}: Feature ${id}`,
        ].join('\n');
    }

    test('L3: children count is corpus-derived, at the 9-boundary, and excludes non-children', async () => {
        // A's 9 direct children (A1..A9, all length-2) + an unrelated group B with its
        // own child B1 (must NOT count toward A). 9 children = at the DD-14 limit → no warning.
        const files: Record<string, string> = { 'A_parent.md': featureFile('A') };
        for (let d = 1; d <= 9; d++) files[`A${d}_child.md`] = featureFile(`A${d}`);
        files['B_unrelated.md'] = featureFile('B');
        files['B1_unrelated_child.md'] = featureFile('B1');
        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(`${dir}/A_parent.md`, 'A', { featuresDir: dir });
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('children'))).toHaveLength(0);
    });

    test('L3: children-limit warning fires on a corrupt corpus (duplicate child IDs)', async () => {
        // DD-14's single [1-9] digit caps a node at 9 distinct direct children, so a clean
        // corpus can never exceed 9 — the allocation path enforces that (0056). The check is
        // defense-in-depth: it must still flag a *corrupt* corpus where duplicate files claim
        // the same child IDs (e.g. a bad merge), counting 10 length-2 children of A.
        const files: Record<string, string> = { 'A_parent.md': featureFile('A') };
        for (let d = 1; d <= 9; d++) files[`A${d}_child.md`] = featureFile(`A${d}`);
        // Tenth length-2 child of A via a duplicate-id file (corruption the check detects).
        files['A1_dup.md'] = featureFile('A1');
        const { fs, dir, cleanup } = seedFeaturesDir(files);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(`${dir}/A_parent.md`, 'A', { featuresDir: dir });
        cleanup();
        const childWarn = result.findings.filter((f) => f.layer === 'L3' && f.message.includes('children'));
        expect(childWarn).toHaveLength(1);
        expect(childWarn[0]?.message).toContain('split the parent');
    });

    // ── L4: Traceability — incoming feature_id edges + orphan scenarios ───

    test('L4: orphan-scenario warning when AC has scenarios but no linked task', async () => {
        const featureDir = mkdtempSync(join(tmpdir(), 'spur-fc-orphan-feat-'));
        const tasksDir = mkdtempSync(join(tmpdir(), 'spur-fc-orphan-tasks-'));
        const fp = join(featureDir, 'A_orphan.md');
        writeFileSync(
            fp,
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Orphan"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Orphan',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                'Feature: Orphan',
                '',
                '  Scenario: Untraced',
                '    Given x',
                '    When y',
                '    Then z',
            ].join('\n'),
        );
        const fs = createNodeFileSystem();
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(fp, 'A', { featuresDir: featureDir, tasksDir });
        rmSync(featureDir, { recursive: true, force: true });
        rmSync(tasksDir, { recursive: true, force: true });
        const orphan = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('orphan'));
        expect(orphan).toHaveLength(1);
        expect(orphan[0]?.severity).toBe('warning');
    });

    test('L4 (DD-13): a verifying feature with incomplete linked tasks warns (non-blocking)', async () => {
        const featureDir = mkdtempSync(join(tmpdir(), 'spur-fc-verifying-feat-'));
        const tasksDir = mkdtempSync(join(tmpdir(), 'spur-fc-verifying-tasks-'));
        const fp = join(featureDir, 'A_verifying.md');
        writeFileSync(
            fp,
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Verifying"',
                'status: verifying',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Verifying',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                '- [ ] R1: does the thing',
            ].join('\n'),
        );
        // A linked task that is still in-progress (not done/cancelled).
        writeFileSync(
            join(tasksDir, '0001_wip.md'),
            [
                '---',
                'schema_version: 1',
                'name: "WIP task"',
                'status: wip',
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. WIP task',
            ].join('\n'),
        );
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(fp, 'A', { featuresDir: featureDir, tasksDir });
        rmSync(featureDir, { recursive: true, force: true });
        rmSync(tasksDir, { recursive: true, force: true });
        const warn = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('not done/cancelled'));
        expect(warn).toHaveLength(1);
        expect(warn[0]?.severity).toBe('warning'); // non-blocking
        expect(result.pass).toBe(true); // a warning does not fail the gate
    });

    test('L4 (DD-13): a verifying feature with ALL linked tasks done/cancelled — clean entry, no warning', async () => {
        const featureDir = mkdtempSync(join(tmpdir(), 'spur-fc-clean-feat-'));
        const tasksDir = mkdtempSync(join(tmpdir(), 'spur-fc-clean-tasks-'));
        const fp = join(featureDir, 'A_clean.md');
        writeFileSync(
            fp,
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Clean"',
                'status: verifying',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Clean',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                '- [x] R1: done',
            ].join('\n'),
        );
        // Two linked tasks, both complete (done + cancelled) — verifying is ready.
        writeFileSync(
            join(tasksDir, '0001_done.md'),
            [
                '---',
                'schema_version: 1',
                'name: "Done task"',
                'status: done',
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. Done task',
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0002_cancelled.md'),
            [
                '---',
                'schema_version: 1',
                'name: "Cancelled task"',
                'status: cancelled',
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0002. Cancelled task',
            ].join('\n'),
        );
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(fp, 'A', { featuresDir: featureDir, tasksDir });
        rmSync(featureDir, { recursive: true, force: true });
        rmSync(tasksDir, { recursive: true, force: true });
        // Clean entry: no verifying-readiness warning, no orphan warning (tasks exist).
        expect(result.findings.filter((f) => f.message.includes('not done/cancelled'))).toHaveLength(0);
        expect(result.findings.filter((f) => f.message.includes('orphan'))).toHaveLength(0);
    });

    test('0379 regression: linked task checklist covers and verifies feature scenarios', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-0379-checklist-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(runDir, { recursive: true });
        writeFileSync(
            join(featuresDir, 'A_checklist.md'),
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Checklist coverage"',
                'status: done',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Checklist coverage',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                'Feature: Checklist coverage',
                '',
                '  Scenario: R1 — alpha',
                '    Given x',
                '    When y',
                '    Then z',
                '',
                '## Tasks',
                '',
                '| WBS | Task | Status |',
                '| --- | --- | --- |',
                '| 0001 | covers alpha | done |',
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0001_alpha.md'),
            [
                '---',
                'schema_version: 1',
                'name: "covers alpha"',
                'status: done',
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. covers alpha',
                '',
                '### Acceptance Criteria',
                '',
                '- [x] R1 — alpha',
            ].join('\n'),
        );
        writeFileSync(
            join(runDir, '0001-verdict.json'),
            JSON.stringify({
                verdict: 'PASS',
                requirements: [],
                acceptanceCriteria: [{ id: 'AC-1', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            }),
        );

        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'A_checklist.md'), 'A', {
            strict: true,
            featuresDir,
            tasksDir,
            runDir,
        });

        expect(result.findings.filter((f) => f.code === 'L4.uncovered-feature-scenario')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.pass).toBe(true);
        rmSync(dir, { recursive: true, force: true });
    });

    test('L4: no orphan warning when a task links the feature via feature_id', async () => {
        const featureDir = mkdtempSync(join(tmpdir(), 'spur-fc-linked-feat-'));
        const tasksDir = mkdtempSync(join(tmpdir(), 'spur-fc-linked-tasks-'));
        const fp = join(featureDir, 'A_linked.md');
        writeFileSync(
            fp,
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Linked"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Linked',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                'Feature: Linked',
                '',
                '  Scenario: Traced',
                '    Given x',
                '    When y',
                '    Then z',
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0001_impl.md'),
            [
                '---',
                'schema_version: 1',
                'name: "Impl A"',
                'status: backlog',
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. Impl A',
            ].join('\n'),
        );
        const fs = createNodeFileSystem();
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(fp, 'A', { featuresDir: featureDir, tasksDir });
        rmSync(featureDir, { recursive: true, force: true });
        rmSync(tasksDir, { recursive: true, force: true });
        expect(result.findings.filter((f) => f.message.includes('orphan'))).toHaveLength(0);
    });

    // ── Dogfood: the real docs/features corpus (B08 two-tier AC) ─────────

    test('dogfood: every feature in the real corpus parses without L1 errors', async () => {
        // The hand-authored docs/features/ corpus is the must-accept fixture: the
        // check must PARSE every feature (no L1 schema/markdown errors) and handle
        // both Gherkin (fenced) and checklist AC. (A check may still report L2/L3
        // findings — e.g. an active group feature missing AC — that is correct output.)
        const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
        const featuresDir = join(repoRoot, 'docs', 'features');
        const fs = createNodeFileSystem();
        const svc = new FeatureCheckService(fs);
        const entries = await fs.readDir(featuresDir);
        const featureFiles = entries.filter((n) => /^[A-Z][1-9]*_.+\.md$/.test(n));
        expect(featureFiles.length).toBeGreaterThan(0);

        for (const name of featureFiles) {
            const id = name.match(/^([A-Z][1-9]*)_/)?.[1];
            if (!id) continue;
            const result = await svc.check(join(featuresDir, name), id, { featuresDir });
            const l1Errors = result.findings.filter((f) => f.layer === 'L1');
            expect(l1Errors).toHaveLength(0); // corpus must parse + schema-validate
            // No spurious "```gherkin" fence warnings (the fence-strip fix).
            const fenceWarnings = result.findings.filter((f) => f.message.includes('```'));
            expect(fenceWarnings).toHaveLength(0);
        }
    });

    test('two-tier AC: a fenced Gherkin block validates without fence warnings', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "A"',
            'name: "Fenced"',
            'status: active',
            'priority: P1',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# A: Fenced',
            '',
            '## Goal',
            '',
            'g',
            '',
            '## Scope',
            '',
            'In scope: x',
            '',
            '## Acceptance Criteria',
            '',
            '```gherkin',
            'Feature: Fenced',
            '',
            '  Scenario: Works',
            '    Given x',
            '    When y',
            '    Then z',
            '```',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'A');
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('```'))).toHaveLength(0);
        expect(result.findings.filter((f) => f.layer === 'L3' && f.severity === 'error')).toHaveLength(0);
    });

    test('two-tier AC: a checklist AC validates (no "No Feature declaration" error)', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "A"',
            'name: "Checklist AC"',
            'status: active',
            'priority: P1',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# A: Checklist AC',
            '',
            '## Goal',
            '',
            'g',
            '',
            '## Scope',
            '',
            'In scope: x',
            '',
            '## Acceptance Criteria',
            '',
            '- [ ] R1: the feature does the thing',
            '- [x] R2: the other thing is done',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'A');
        cleanup();
        // Checklist tier — no Gherkin "No Feature declaration" hard error.
        expect(result.findings.filter((f) => f.message.includes('No Feature declaration'))).toHaveLength(0);
        expect(result.findings.filter((f) => f.layer === 'L3' && f.severity === 'error')).toHaveLength(0);
    });

    // ── Strict mode ──────────────────────────────────────────────────────

    test('--strict elevates warnings to errors', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'id: "H"',
            'name: "Strict Feature"',
            'status: blocked',
            'priority: P1',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# H: Strict Feature',
            '',
            '## Goal',
            '',
            'Goal text.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs);
        const result = await svc.check(path, 'H', { strict: true });
        cleanup();

        // blocked requires Goal + Notes; missing Notes is warning in non-strict
        // In strict mode, all warnings become errors, so we should have at least one error
        const l2Findings = result.findings.filter((f) => f.layer === 'L2');
        expect(l2Findings.every((f) => f.severity === 'error')).toBe(true);
        // In strict, pass should be false since warnings were elevated
        expect(result.pass).toBe(false);
    });

    // ── resolveMatrixEntry ───────────────────────────────────────────────

    test('resolveMatrixEntry falls back to the standard variant', () => {
        const svc = new FeatureCheckService(createNodeFileSystem());
        const entry = svc.resolveMatrixEntry('nonexistent', 'backlog');
        expect(entry).toBeTruthy();
        // backlog has no required sections
        expect(entry?.required).toHaveLength(0);
    });

    test('resolveMatrixEntry returns undefined for unknown status', () => {
        const svc = new FeatureCheckService(createNodeFileSystem());
        const entry = svc.resolveMatrixEntry('standard', 'nonexistent-status');
        expect(entry).toBeUndefined();
    });

    // ── Custom matrix ────────────────────────────────────────────────────

    test('accepts custom matrix in constructor', async () => {
        const customMatrix = {
            variants: {
                standard: {
                    backlog: {
                        required: ['Goal', 'Notes'],
                        gate: true,
                    },
                },
            },
        };

        const content = [
            '---',
            'schema_version: 1',
            'id: "I"',
            'name: "Custom Matrix"',
            'status: backlog',
            'priority: P3',
            'created_at: 2026-06-14T00:00:00.000Z',
            'updated_at: 2026-06-14T00:00:00.000Z',
            '---',
            '',
            '# I: Custom Matrix',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new FeatureCheckService(fs, customMatrix);
        const result = await svc.check(path, 'I');
        cleanup();

        const l2Errors = result.findings.filter((f) => f.layer === 'L2' && f.severity === 'error');
        expect(l2Errors.length).toBeGreaterThan(0);
        expect(result.missingSections).toContain('Goal');
        expect(result.missingSections).toContain('Notes');
    });

    // ── P3: Mandatory dogfood for self-referential workflow changes ──

    test('P3: no finding when dogfood artifact exists for self-ref feature', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-p3-ok-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        const dogfoodDir = join(dir, 'dogfood');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(dogfoodDir, { recursive: true });

        writeFileSync(
            join(featuresDir, 'M_ok.md'),
            [
                '---',
                'schema_version: 1',
                'id: "M"',
                'name: "Dogfood OK"',
                'status: verifying',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# M: Dogfood OK',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                'Feature: M',
                '',
                '  Scenario: dogfood',
                '    Given x',
            ].join('\n'),
        );

        writeFileSync(
            join(tasksDir, '0001_ok.md'),
            [
                '---',
                'schema_version: 1',
                'name: "self-ref task"',
                'status: done',
                'feature_id: M',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. self-ref task',
                '',
                '### Solution',
                '',
                'Touched .spur/workflows/task-pipeline.yaml.',
            ].join('\n'),
        );

        // Dogfood artifact exists and mentions the feature ID
        writeFileSync(join(dogfoodDir, '2026-07-10-M-dogfood.md'), '# Dogfood for M');

        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'M_ok.md'), 'M', {
            featuresDir,
            tasksDir,
            dogfoodDir,
        });
        rmSync(dir, { recursive: true, force: true });

        const dogfoodFindings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('dogfood'));
        expect(dogfoodFindings).toHaveLength(0);
    });

    test('P3: no finding when tasks do not touch self-referential paths', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-p3-nosr-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });

        writeFileSync(
            join(featuresDir, 'N_no.md'),
            [
                '---',
                'schema_version: 1',
                'id: "N"',
                'name: "No Self-Ref"',
                'status: verifying',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# N: No Self-Ref',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                'Feature: N',
                '',
                '  Scenario: normal',
                '    Given x',
            ].join('\n'),
        );

        // Task Solution does NOT mention self-ref paths
        writeFileSync(
            join(tasksDir, '0001_nosr.md'),
            [
                '---',
                'schema_version: 1',
                'name: "normal task"',
                'status: done',
                'feature_id: N',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. normal task',
                '',
                '### Solution',
                '',
                'Added a utility function in packages/app/src/services/agent-service.ts.',
            ].join('\n'),
        );

        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'N_no.md'), 'N', {
            featuresDir,
            tasksDir,
            dogfoodDir: join(dir, 'dogfood'),
        });
        rmSync(dir, { recursive: true, force: true });

        const dogfoodFindings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('dogfood'));
        expect(dogfoodFindings).toHaveLength(0);
    });

    test('P3: no dogfood check for non-verifying/done statuses', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-p3-backlog-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });

        writeFileSync(
            join(featuresDir, 'Q_backlog.md'),
            [
                '---',
                'schema_version: 1',
                'id: "Q"',
                'name: "Backlog Self-Ref"',
                'status: backlog',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# Q: Backlog Self-Ref',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                'Feature: Q',
                '',
                '  Scenario: backlog',
                '    Given x',
            ].join('\n'),
        );

        writeFileSync(
            join(tasksDir, '0001_bl.md'),
            [
                '---',
                'schema_version: 1',
                'name: "self-ref backlog"',
                'status: done',
                'feature_id: Q',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. self-ref backlog',
                '',
                '### Solution',
                '',
                'Changed packages/app/src/workflow/lifecycle-adapter.ts.',
            ].join('\n'),
        );

        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'Q_backlog.md'), 'Q', {
            featuresDir,
            tasksDir,
            dogfoodDir: join(dir, 'dogfood'),
        });
        rmSync(dir, { recursive: true, force: true });

        const dogfoodFindings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('dogfood'));
        expect(dogfoodFindings).toHaveLength(0);
    });

    // ── 0340: Scenario-satisfaction classification (L4.scenario-unverified) ───

    /**
     * Build a fixture: feature A with one AC scenario "alpha", a linked task
     * 0001, and (optionally) a verdict artifact at <dir>/.spur/run/0001-verdict.json.
     * `taskStatus` controls the task frontmatter status; `verdict` (when defined)
     * writes the artifact with the given top-level verdict and requirement rows.
     */
    async function setupScenarioSatisfaction(opts: {
        taskStatus: string;
        asStatus?: string;
        verdict?: {
            verdict: string;
            requirements?: Array<{ id: string; status: string; evidence?: string }>;
            acceptanceCriteria?: Array<{ id: string; status: string; evidence?: string }>;
        };
        scenarioTitle?: string;
        /** Optional `## Testing` section body written into the task (F93 fallback). */
        testing?: string;
    }): Promise<{ result: CheckFeatureResult; cleanup: () => void }> {
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-0340-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(runDir, { recursive: true });
        const scenario = opts.scenarioTitle ?? 'alpha';
        const fenced = (lines: string[]) => ['```gherkin', ...lines, '```'];
        writeFileSync(
            join(featuresDir, 'A_sat.md'),
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Sat"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Sat',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                ...fenced(['Feature: A', '', `  Scenario: ${scenario}`, '    Given x']),
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0001_a.md'),
            [
                '---',
                'schema_version: 1',
                'name: "covers alpha"',
                `status: ${opts.taskStatus}`,
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. covers alpha',
                '',
                '### Acceptance Criteria',
                '',
                ...fenced(['Feature: T', '', `  Scenario: ${scenario}`, '    Given x']),
                ...(opts.testing !== undefined ? ['', '### Testing', '', opts.testing] : []),
            ].join('\n'),
        );
        if (opts.verdict !== undefined) {
            writeFileSync(join(runDir, '0001-verdict.json'), JSON.stringify(opts.verdict));
        }
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'A_sat.md'), 'A', {
            featuresDir,
            tasksDir,
            runDir,
            asStatus: opts.asStatus,
        });
        return { result, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    }

    test('0340 R2: linked-and-verified scenario (done + PASS + MET) produces no unverified finding', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: { verdict: 'PASS', requirements: [{ id: 'AC-1', status: 'MET', evidence: 'tests/x.test.ts:1' }] },
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(0);
        cleanup();
    });

    // ── 0398 R7: bracket-tagged verdict rows must still match their scenario ──
    // requiresExecutableEvidence needs the tag IN the id to keep a static-evidence row at MET,
    // while matching used to compare the tagged id against an untagged scenario title. Both
    // rules could not be satisfied at once, so a documentation scenario was unverifiable.
    test.each([
        ['[doc-only] alpha'],
        ['[docs-only] alpha'],
        ['[non-behavior] alpha'],
        ['[advisory] alpha'],
        ['[non-core] alpha'],
        ['[doc-only] Scenario: alpha'],
        ['Scenario: [doc-only] alpha'],
    ])('0398 R7: verdict row id "%s" verifies the untagged scenario "alpha"', async (rowId) => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: { verdict: 'PASS', requirements: [{ id: rowId, status: 'MET', evidence: 'tests/x.test.ts:1' }] },
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        cleanup();
    });

    // ── 0561 R1/R2: trailing Gherkin bodies in verdict row ids ────────────────
    // An AC row id that embeds the full Gherkin body in a trailing parenthetical
    // must still verify its feature scenario (no L4.scenario-unverified), while a
    // title that legitimately ends in `(...)` must still match unmodified (R2).

    test('0561 R1: MET row id with a trailing Gherkin body verifies the scenario', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: {
                verdict: 'PASS',
                requirements: [
                    { id: 'Scenario: alpha (Given x / When y / Then z)', status: 'MET', evidence: 'tests/x.test.ts:1' },
                ],
            },
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        cleanup();
    });

    test('0561 R1: bracket-tagged id with a multi-line nested-parenthetical body verifies', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: {
                verdict: 'PASS',
                requirements: [
                    {
                        id: '[doc-only] alpha (Given x (nested) / When y\n  / Then z)',
                        status: 'MET',
                        evidence: 'tests/x.test.ts:1',
                    },
                ],
            },
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        cleanup();
    });

    test('0561 R2: a title that legitimately ends in a parenthetical still matches unmodified', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            scenarioTitle: 'alpha handles (nested) cases',
            verdict: {
                verdict: 'PASS',
                requirements: [{ id: 'alpha handles (nested) cases', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            },
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        cleanup();
    });

    test('0561 R1 regression (E6/0558): the pre-surgery R4 AC row id verifies without re-derivation', async () => {
        // Reconstructed from the E6 forensic report: 0558's verify answer embedded the
        // full Gherkin body in the R4 AC row id and `spur task verdict --from-answer`
        // preserved it verbatim in the artifact. The matcher must accept the artifact
        // as-is — the bodyStripped form is evaluated without touching the file.
        const r4 = 'R4 — Already-imported history is correlated retroactively and marked estimated';
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            scenarioTitle: r4,
            verdict: {
                verdict: 'PASS',
                acceptanceCriteria: [
                    {
                        id: `Scenario: ${r4} (Given history rows imported before correlation existed / When retroactive correlation runs over a bounded window / Then matched rows carry a run id marked estimated)`,
                        status: 'MET',
                        evidence: 'tests/x.test.ts:1',
                    },
                ],
            },
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        cleanup();
    });

    test('0340 R2: verdict requirement matched by normalized title (not just AC-N)', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            scenarioTitle: 'Hierarchical ID allocation',
            verdict: {
                verdict: 'PASS',
                requirements: [{ id: 'Hierarchical ID allocation', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            },
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(0);
        cleanup();
    });

    // ── F93 (0672): completion-gate fallback reads the tracked ## Testing section ──

    test('0672 R1: absent artifact falls back to a parseable tracked Testing section', async () => {
        // done task, no verdict artifact, but ## Testing carries a Verdict + MET row keyed
        // by the scenario title → scenario verified with no error on the missing artifact.
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            testing: [
                '- Verdict: PASS (from verdict artifact)',
                '',
                '| Requirement | Status | Evidence |',
                '|-------------|--------|----------|',
                '| R1 | MET | covered |',
                '',
                '| Acceptance Criteria | Status | Evidence Type | Evidence |',
                '|---------------------|--------|---------------|----------|',
                '| alpha | MET | test | t |',
            ].join('\n'),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === 'L4.evidence-not-recoverable')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === 'L4.malformed-verdict-artifact')).toHaveLength(0);
        cleanup();
    });

    // ── 0410: Verdict artifact hardening (scenario alias + diagnostics) ────

    /**
     * Variant of setupScenarioSatisfaction that writes a RAW verdict artifact
     * string (so 0410 tests can exercise `scenario` aliases, conflicts, and
     * malformed shapes the typed helper cannot express). Pass `rawArtifact`
     * undefined for the missing-artifact case, or 'MALFORMED' for invalid JSON.
     */
    async function setup0410(opts: {
        taskStatus: string;
        rawArtifact?: string;
        scenarioTitle?: string;
    }): Promise<{ result: CheckFeatureResult; cleanup: () => void }> {
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-0410-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(runDir, { recursive: true });
        const scenario = opts.scenarioTitle ?? 'alpha';
        const fenced = (lines: string[]) => ['```gherkin', ...lines, '```'];
        writeFileSync(
            join(featuresDir, 'A_0410.md'),
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Hardened"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Hardened',
                '',
                '## Goal',
                '',
                'g',
                '',
                '## Scope',
                '',
                'In scope: x',
                '',
                '## Acceptance Criteria',
                '',
                ...fenced(['Feature: A', '', `  Scenario: ${scenario}`, '    Given x']),
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0001_a.md'),
            [
                '---',
                'schema_version: 1',
                'name: "covers alpha"',
                `status: ${opts.taskStatus}`,
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. covers alpha',
                '',
                '### Acceptance Criteria',
                '',
                ...fenced(['Feature: T', '', `  Scenario: ${scenario}`, '    Given x']),
            ].join('\n'),
        );
        if (opts.rawArtifact !== undefined) {
            writeFileSync(
                join(runDir, '0001-verdict.json'),
                opts.rawArtifact === 'MALFORMED' ? '{ not valid json' : opts.rawArtifact,
            );
        }
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'A_0410.md'), 'A', {
            featuresDir,
            tasksDir,
            runDir,
        });
        return { result, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    }

    const malformedCode = 'L4.malformed-verdict-artifact';

    test('0410 R1: verdict row using `scenario` key alias verifies the scenario (no id present)', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ scenario: 'alpha', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410 R1: verdict row using `scenario` alias with AC-N form verifies', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ scenario: 'AC-1', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410 R2: id and scenario both present and equal → id authoritative, row accepted (no warning)', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'AC-1', scenario: 'AC-1', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('1042 R1: matching-WBS artifact verifies as before (no regression)', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                wbs: '0001',
                verdict: 'PASS',
                requirements: [{ id: 'alpha', status: 'MET', evidence: 'x' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('1042 R1: omitted-WBS artifact keeps legacy compatibility (verifies)', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'alpha', status: 'MET', evidence: 'x' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410 R4: scenario-key alias in acceptanceCriteria verifies (no id present)', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [],
                acceptanceCriteria: [{ scenario: 'AC-1', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410 R6 regression: canonical `id` key still verifies (no behavior change)', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'AC-1', status: 'MET', evidence: 'tests/x.test.ts:1' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });
});

// ---------------------------------------------------------------------------
// R6: multi-folder feature check (task 0451) — L4 edge resolution across
// all configured task folders, not only the active one.
// ---------------------------------------------------------------------------

describe('R6 — multi-folder feature check (task 0451)', () => {
    test('L4: no orphan-scenarios when done task is in non-active tasks folder', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-r6-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks'); // active
        const tasksDir2 = join(dir, 'tasks2'); // archive
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(tasksDir2, { recursive: true });
        mkdirSync(runDir, { recursive: true });

        // Feature with one scenario "alpha"
        const featureContent = [
            '---',
            'schema_version: 1',
            'id: "R6"',
            'name: "R6 Multi-Folder"',
            'status: done',
            'priority: P2',
            'created_at: 2026-08-05T00:00:00.000Z',
            'updated_at: 2026-08-05T00:00:00.000Z',
            '---',
            '',
            '# R6: Multi-Folder',
            '',
            '## Goal',
            '',
            'Test multi-folder L4 edge resolution.',
            '',
            '## Scope',
            '',
            'In scope: testing.',
            '',
            '## Acceptance Criteria',
            '',
            '```gherkin',
            'Scenario: alpha',
            '  Given a situation',
            '  When something happens',
            '  Then ensure result',
            '```',
            '',
            '## Tasks',
            '',
            '- [x] 0001: secondary task',
        ].join('\n');
        writeFileSync(join(featuresDir, 'R6_multi.md'), featureContent);

        // Task in non-active folder (tasks2) with feature_id R6 and AC covering "alpha"
        const taskContent = [
            '---',
            'schema_version: 1',
            'name: "R6 Secondary Task"',
            'status: done',
            'feature_id: R6',
            'priority: P2',
            'created_at: 2026-08-05T00:00:00.000Z',
            'updated_at: 2026-08-05T00:00:00.000Z',
            '---',
            '',
            '## 0001. R6 Secondary Task',
            '',
            '## Acceptance Criteria',
            '',
            '```gherkin',
            'Scenario: alpha',
            '  Given a situation',
            '  When something happens',
            '  Then ensure result',
            '```',
            '',
            '## Solution',
            '',
            'Implemented.',
        ].join('\n');
        writeFileSync(join(tasksDir2, '0001_secondary.md'), taskContent);

        // Verdict artifact for the done task — PASS with MET for alpha
        writeFileSync(
            join(runDir, '0001-verdict.json'),
            JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'Scenario: alpha', status: 'MET', evidence: 'tests/x.test.ts:1' }],
                acceptanceCriteria: [],
            }),
        );

        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'R6_multi.md'), 'R6', {
            featuresDir,
            tasksDirs: [tasksDir, tasksDir2],
            runDir,
        });

        // No orphan scenarios — the task in tasks2 is found via tasksDirs
        const orphan = result.findings.filter((f) => f.code === 'L4.orphan-scenarios');
        expect(orphan).toHaveLength(0);
        // No unverified scenario — the verdict is PASS with MET
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(0);
        // No malformed verdict artifact
        const malformed = result.findings.filter((f) => f.code === 'L4.malformed-verdict-artifact');
        expect(malformed).toHaveLength(0);

        rmSync(dir, { recursive: true, force: true });
    });
});
