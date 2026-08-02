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

    test('L3: one-active-goal counts verifying as active for P0 rule', async () => {
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

        // Check verifying P0 — should detect conflict with active P0
        const result = await svc.check(`${dir}/B_verifying.md`, 'B', {
            featuresDir: dir,
        });
        cleanup();

        const goalErrors = result.findings.filter((f) => f.message.includes('One-active-goal'));
        expect(goalErrors.length).toBe(1);
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

    test('R2 (DD-09): a feature scenario covered by no linked task is a coverage orphan warning', async () => {
        const featureDir = mkdtempSync(join(tmpdir(), 'spur-fc-cov-feat-'));
        const tasksDir = mkdtempSync(join(tmpdir(), 'spur-fc-cov-tasks-'));
        const fenced = (lines: string[]) => ['```gherkin', ...lines, '```'];
        writeFileSync(
            join(featureDir, 'A_cov.md'),
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Cov"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Cov',
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
                ...fenced(['Feature: A', '', '  Scenario: alpha', '    Given x', '  Scenario: beta', '    Given y']),
            ].join('\n'),
        );
        // One linked task covers only "alpha" → "beta" is a coverage orphan.
        writeFileSync(
            join(tasksDir, '0001_a.md'),
            [
                '---',
                'schema_version: 1',
                'name: "covers alpha"',
                'status: backlog',
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. covers alpha',
                '',
                '### Acceptance Criteria',
                '',
                ...fenced(['Feature: T', '', '  Scenario: alpha', '    Given x']),
            ].join('\n'),
        );
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featureDir, 'A_cov.md'), 'A', { featuresDir: featureDir, tasksDir });
        rmSync(featureDir, { recursive: true, force: true });
        rmSync(tasksDir, { recursive: true, force: true });
        const cov = result.findings.filter(
            (f) => f.layer === 'L4' && f.message.includes('not covered by any linked task'),
        );
        expect(cov).toHaveLength(1);
        expect(cov[0]?.message).toContain('beta');
        expect(cov[0]?.severity).toBe('warning'); // orphans are warnings, never errors (DD-09)
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
                acceptanceCriteria: [{ id: 'AC-1', status: 'MET' }],
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

    test('P3: warning when verifying feature touches self-ref paths with no dogfood artifact', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-p3-sr-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });

        // Feature at verifying status
        writeFileSync(
            join(featuresDir, 'L_sr.md'),
            [
                '---',
                'schema_version: 1',
                'id: "L"',
                'name: "Self-Ref Feature"',
                'status: verifying',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# L: Self-Ref Feature',
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
                'Feature: L',
                '',
                '  Scenario: self-ref',
                '    Given x',
            ].join('\n'),
        );

        // Task that touches self-referential path in Solution
        writeFileSync(
            join(tasksDir, '0001_sr.md'),
            [
                '---',
                'schema_version: 1',
                'name: "Self-ref task"',
                'status: done',
                'feature_id: L',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. Self-ref task',
                '',
                '### Solution',
                '',
                'Modified packages/app/src/workflow/lifecycle-adapter.ts to add gate.',
            ].join('\n'),
        );

        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'L_sr.md'), 'L', {
            featuresDir,
            tasksDir,
            dogfoodDir: join(dir, 'dogfood'),
        });
        rmSync(dir, { recursive: true, force: true });

        const dogfoodFindings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('dogfood'));
        expect(dogfoodFindings).toHaveLength(1);
        expect(dogfoodFindings[0]?.severity).toBe('warning');
        expect(dogfoodFindings[0]?.message).toContain('dogfood');
    });

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

    test('P3: --strict elevates dogfood warning to error', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-p3-strict-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });

        writeFileSync(
            join(featuresDir, 'P_strict.md'),
            [
                '---',
                'schema_version: 1',
                'id: "P"',
                'name: "Strict Dogfood"',
                'status: verifying',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# P: Strict Dogfood',
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
                'Feature: P',
                '',
                '  Scenario: strict',
                '    Given x',
            ].join('\n'),
        );

        writeFileSync(
            join(tasksDir, '0001_strict.md'),
            [
                '---',
                'schema_version: 1',
                'name: "self-ref strict"',
                'status: done',
                'feature_id: P',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. self-ref strict',
                '',
                '### Solution',
                '',
                'Updated plugins/sp/spur-dev/skills/spur-dev/workflow.md.',
            ].join('\n'),
        );

        const svc = new FeatureCheckService(createNodeFileSystem());
        // With --strict: dogfood warning is elevated to error.
        const result = await svc.check(join(featuresDir, 'P_strict.md'), 'P', {
            strict: true,
            featuresDir,
            tasksDir,
            dogfoodDir: join(dir, 'dogfood'),
        });
        rmSync(dir, { recursive: true, force: true });

        const dogfoodFindings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('dogfood'));
        expect(dogfoodFindings).toHaveLength(1);
        expect(dogfoodFindings[0]?.severity).toBe('error'); // elevated by --strict
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
        verdict?: { verdict: string; requirements: Array<{ id: string; status: string }> };
        scenarioTitle?: string;
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
        });
        return { result, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    }

    test('0340 R2: linked-and-verified scenario (done + PASS + MET) produces no unverified finding', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: { verdict: 'PASS', requirements: [{ id: 'AC-1', status: 'MET' }] },
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
            verdict: { verdict: 'PASS', requirements: [{ id: rowId, status: 'MET' }] },
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        cleanup();
    });

    test('0398 R7: a tagged row naming a DIFFERENT scenario still does not verify', async () => {
        // Guard against the fix over-matching: stripping tags must not make everything match.
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: { verdict: 'PASS', requirements: [{ id: '[doc-only] beta', status: 'MET' }] },
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified').length).toBeGreaterThan(0);
        cleanup();
    });

    test('0340 R2: linked-but-unverified via todo task emits warning', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'todo',
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        expect(unverified[0]?.severity).toBe('warning');
        expect(unverified[0]?.message).toContain('alpha');
        // R6: non-strict pass stays true
        expect(result.pass).toBe(true);
        cleanup();
    });

    test('0340 R2: done task with no verdict artifact is unverified', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            // no verdict artifact
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        expect(unverified[0]?.message).toContain('alpha');
        cleanup();
    });

    test('0340 R2: done task with PASS verdict but UNMET matching requirement is unverified', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: { verdict: 'PASS', requirements: [{ id: 'AC-1', status: 'UNMET' }] },
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        cleanup();
    });

    test('0340 R2: done task with FAIL verdict is unverified even if a row says MET', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            verdict: { verdict: 'FAIL', requirements: [{ id: 'AC-1', status: 'MET' }] },
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        cleanup();
    });

    test('0340 R2: verdict requirement matched by normalized title (not just AC-N)', async () => {
        const { result, cleanup } = await setupScenarioSatisfaction({
            taskStatus: 'done',
            scenarioTitle: 'Hierarchical ID allocation',
            verdict: {
                verdict: 'PASS',
                requirements: [{ id: 'Hierarchical ID allocation', status: 'MET' }],
            },
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(0);
        cleanup();
    });

    test('0340 R4: --strict elevates unverified to error and fails the check', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-0340-strict-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(runDir, { recursive: true });
        const fenced = (lines: string[]) => ['```gherkin', ...lines, '```'];
        writeFileSync(
            join(featuresDir, 'A_strict.md'),
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "Strict"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: Strict',
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
                ...fenced(['Feature: A', '', '  Scenario: alpha', '    Given x', '  Scenario: beta', '    Given y']),
            ].join('\n'),
        );
        // Both tasks todo → both scenarios linked-but-unverified
        for (const [name, scenario] of [
            ['0001_a.md', 'alpha'],
            ['0002_b.md', 'beta'],
        ] as const) {
            writeFileSync(
                join(tasksDir, name),
                [
                    '---',
                    'schema_version: 1',
                    `name: "covers ${scenario}"`,
                    'status: todo',
                    'feature_id: A',
                    'created_at: 2026-06-14T00:00:00.000Z',
                    'updated_at: 2026-06-14T00:00:00.000Z',
                    '---',
                    '',
                    `## ${name.slice(0, 4)}. covers ${scenario}`,
                    '',
                    '### Acceptance Criteria',
                    '',
                    ...fenced(['Feature: T', '', `  Scenario: ${scenario}`, '    Given x']),
                ].join('\n'),
            );
        }
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'A_strict.md'), 'A', {
            strict: true,
            featuresDir,
            tasksDir,
            runDir,
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(2);
        expect(unverified.every((f) => f.severity === 'error')).toBe(true);
        expect(result.pass).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });

    test('0340 R5 dogfood: PASS verdict with UNMET matching requirement must not PASS --strict', async () => {
        // WHY: the original R2 dogfood case — full linkage + recorded UNMET must
        // fail under --strict (not merely emit a non-strict warning).
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-0340-r5-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(runDir, { recursive: true });
        const fenced = (lines: string[]) => ['```gherkin', ...lines, '```'];
        writeFileSync(
            join(featuresDir, 'A_r5.md'),
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "R5"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: R5',
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
                ...fenced(['Feature: A', '', '  Scenario: alpha', '    Given x']),
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0001_a.md'),
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
                ...fenced(['Feature: T', '', '  Scenario: alpha', '    Given x']),
            ].join('\n'),
        );
        writeFileSync(
            join(runDir, '0001-verdict.json'),
            JSON.stringify({ verdict: 'PASS', requirements: [{ id: 'alpha', status: 'UNMET' }] }),
        );
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'A_r5.md'), 'A', {
            strict: true,
            featuresDir,
            tasksDir,
            runDir,
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        expect(unverified[0]?.severity).toBe('error');
        expect(unverified[0]?.message).toContain('alpha');
        expect(result.pass).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });

    test('0340 R3 regression: orphan scenario emits uncovered-feature-scenario, NOT scenario-unverified', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-0340-orphan-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(runDir, { recursive: true });
        const fenced = (lines: string[]) => ['```gherkin', ...lines, '```'];
        // Feature has scenarios "alpha" and "beta"; the linked task covers only "alpha".
        writeFileSync(
            join(featuresDir, 'A_orphan.md'),
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
                ...fenced(['Feature: A', '', '  Scenario: alpha', '    Given x', '  Scenario: beta', '    Given y']),
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0001_a.md'),
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
                ...fenced(['Feature: T', '', '  Scenario: alpha', '    Given x']),
            ].join('\n'),
        );
        writeFileSync(
            join(runDir, '0001-verdict.json'),
            JSON.stringify({ verdict: 'PASS', requirements: [{ id: 'AC-1', status: 'MET' }] }),
        );
        const svc = new FeatureCheckService(createNodeFileSystem());
        const result = await svc.check(join(featuresDir, 'A_orphan.md'), 'A', {
            featuresDir,
            tasksDir,
            runDir,
        });
        // "beta" is orphan → uncovered-feature-scenario (existing DD-09 behavior)
        const orphan = result.findings.filter((f) => f.code === 'L4.uncovered-feature-scenario');
        expect(orphan).toHaveLength(1);
        expect(orphan[0]?.message).toContain('beta');
        // "alpha" is linked-and-verified → no unverified finding
        // "beta" is orphan, not linked-but-unverified → no scenario-unverified for beta
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(0);
        rmSync(dir, { recursive: true, force: true });
    });

    test('0340: missing runDir skips satisfaction check (graceful — no findings, no crash)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-fc-0340-norun-'));
        const featuresDir = join(dir, 'features');
        const tasksDir = join(dir, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        const fenced = (lines: string[]) => ['```gherkin', ...lines, '```'];
        writeFileSync(
            join(featuresDir, 'A_norun.md'),
            [
                '---',
                'schema_version: 1',
                'id: "A"',
                'name: "NoRun"',
                'status: active',
                'priority: P1',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '# A: NoRun',
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
                ...fenced(['Feature: A', '', '  Scenario: alpha', '    Given x']),
            ].join('\n'),
        );
        writeFileSync(
            join(tasksDir, '0001_a.md'),
            [
                '---',
                'schema_version: 1',
                'name: "covers alpha"',
                'status: todo',
                'feature_id: A',
                'created_at: 2026-06-14T00:00:00.000Z',
                'updated_at: 2026-06-14T00:00:00.000Z',
                '---',
                '',
                '## 0001. covers alpha',
                '',
                '### Acceptance Criteria',
                '',
                ...fenced(['Feature: T', '', '  Scenario: alpha', '    Given x']),
            ].join('\n'),
        );
        const svc = new FeatureCheckService(createNodeFileSystem());
        // No runDir passed and no .spur/run derived (tasksDir parent has no .spur/run).
        const result = await svc.check(join(featuresDir, 'A_norun.md'), 'A', {
            featuresDir,
            tasksDir,
        });
        // runDir defaults to <tasksDir parent>/.spur/run. The covering task is
        // still todo, so it cannot provide eligible PASS evidence.
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        rmSync(dir, { recursive: true, force: true });
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
                requirements: [{ scenario: 'alpha', status: 'MET' }],
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
                requirements: [{ scenario: 'AC-1', status: 'MET' }],
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
                requirements: [{ id: 'AC-1', scenario: 'AC-1', status: 'MET' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410 R2: id and scenario both present and DIFFER → row rejected, scenario unverified, bounded L4 warning', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'alpha', scenario: 'beta', status: 'MET' }],
            }),
        });
        // Conflict row was rejected → scenario has no MET match → unverified.
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        // Bounded warning names task WBS, artifact path, rejected count, invalid fields.
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        const msg = malformed[0]?.message ?? '';
        expect(msg).toContain('0001');
        expect(msg).toContain('0001-verdict.json');
        expect(msg).toContain('1 rejected coverage row');
        expect(msg).toContain('conflict');
        cleanup();
    });

    test('0410 R2: present non-string scenario alias conflicts with canonical id and is rejected', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'alpha', scenario: 7, status: 'MET' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('id/scenario conflict');
        cleanup();
    });

    test('0410 R3: row missing status is rejected and warned; valid sibling rows still verify', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [
                    { id: 'gamma', status: 'MET' }, // valid but unmatched
                    { id: 'AC-1', status: 'MET' }, // valid, verifies scenario
                    { id: 'orphan-no-status' }, // rejected: no status
                ],
            }),
        });
        // Valid AC-1 row verifies the scenario.
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        // Rejected row produces the bounded warning.
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('1 rejected coverage row');
        expect(malformed[0]?.message).toContain('requirements.status');
        cleanup();
    });

    test('0410 R3: row missing both id and scenario is rejected and warned', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ unknown: 'alpha', status: 'MET' }],
            }),
        });
        // No valid row → scenario unverified.
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('requirements.id/scenario missing');
        cleanup();
    });

    test('0410 R3: non-object row (string) is rejected and warned', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: ['not-an-object', { id: 'AC-1', status: 'MET' }],
            }),
        });
        // Valid AC-1 row still verifies the scenario despite the sibling junk row.
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('1 rejected coverage row');
        expect(malformed[0]?.message).toContain('[non-object]');
        cleanup();
    });

    test('0410 R5: empty requirements array produces no malformed-artifact warning', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({ verdict: 'PASS', requirements: [] }),
        });
        // Empty array → no valid MET row → scenario unverified (expected).
        // But NO malformed-artifact warning (R5: empty arrays are not warned).
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410 R3: absent required requirements array is distinct from a valid empty array', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({ verdict: 'PASS' }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('requirements (missing array)');
        cleanup();
    });

    test('0410 R3: malformed JSON artifact emits a task-specific failure-mode warning', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: 'MALFORMED',
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('Task 0001');
        expect(malformed[0]?.message).toContain('malformed JSON');
        cleanup();
    });

    test('0410 R3: missing artifact emits a task-specific failure-mode warning distinct from malformed JSON', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: undefined, // file not written
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('Task 0001');
        expect(malformed[0]?.message).toContain('artifact is missing');
        expect(malformed[0]?.message).not.toContain('malformed JSON');
        cleanup();
    });

    test('0410 R3: valid JSON with a non-object root is diagnosed without throwing', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: 'null',
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('missing required `verdict` field');
        cleanup();
    });

    test('0410 R3/R7: valid unmatched rows remain distinct from malformed rows', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'does-not-match', status: 'MET' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410 R3: non-array requirements is diagnosed separately from an empty array', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({ verdict: 'PASS', requirements: {} }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('requirements (expected array)');
        cleanup();
    });

    test('0410 R4: rejected rows in acceptanceCriteria also produce bounded warning', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [],
                acceptanceCriteria: [{ id: 'alpha', scenario: 'beta', status: 'MET' }],
            }),
        });
        const unverified = result.findings.filter((f) => f.code === 'L4.scenario-unverified');
        expect(unverified).toHaveLength(1);
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('acceptanceCriteria.id/scenario conflict');
        cleanup();
    });

    test('0410 R4: scenario-key alias in acceptanceCriteria verifies (no id present)', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [],
                acceptanceCriteria: [{ scenario: 'AC-1', status: 'MET' }],
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
                requirements: [{ id: 'AC-1', status: 'MET' }],
            }),
        });
        expect(result.findings.filter((f) => f.code === 'L4.scenario-unverified')).toHaveLength(0);
        expect(result.findings.filter((f) => f.code === malformedCode)).toHaveLength(0);
        cleanup();
    });

    test('0410: single warning per artifact regardless of rejected-row count', async () => {
        const { result, cleanup } = await setup0410({
            taskStatus: 'done',
            rawArtifact: JSON.stringify({
                verdict: 'PASS',
                requirements: [
                    { id: 'a', scenario: 'b', status: 'MET' }, // conflict
                    { id: 'c' }, // missing status
                    { status: 'MET' }, // missing id/scenario
                    'junk', // non-object
                ],
            }),
        });
        const malformed = result.findings.filter((f) => f.code === malformedCode);
        expect(malformed).toHaveLength(1);
        expect(malformed[0]?.message).toContain('4 rejected coverage row');
        cleanup();
    });
});
