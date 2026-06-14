import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { featureFrontmatterSchema, MarkdownDocument, taskFrontmatterSchema } from '../src';
import {
    createMigratedDb,
    createTempProject,
    makeFeatureFile,
    makeFeatureFrontmatter,
    makeTaskFile,
    makeTaskFrontmatter,
} from './helpers';

describe('domain test helpers', () => {
    describe('createTempProject', () => {
        test('creates .spur/config.yaml, docs/tasks, and docs/features', async () => {
            const project = await createTempProject();
            try {
                expect(existsSync(join(project.root, '.spur', 'config.yaml'))).toBe(true);
                expect(existsSync(project.tasksDir)).toBe(true);
                expect(existsSync(project.featuresDir)).toBe(true);
            } finally {
                await Bun.spawn(['rm', '-rf', project.root]).exited;
            }
        });

        test('config.yaml contains version and name keys', async () => {
            const project = await createTempProject();
            try {
                const content = await Bun.file(join(project.root, '.spur', 'config.yaml')).text();
                expect(content).toContain('version: "1"');
                expect(content).toContain('name: fixture');
            } finally {
                await Bun.spawn(['rm', '-rf', project.root]).exited;
            }
        });
    });

    describe('createMigratedDb', () => {
        test('returns an independent in-memory adapter with migrations applied', async () => {
            const a = await createMigratedDb();
            const b = await createMigratedDb();
            try {
                expect(a).toBeDefined();
                expect(b).toBeDefined();
                expect(a).not.toBe(b);
                // Migrations applied: CLI schema tables exist.
                const row = await a.queryFirst<{ name: string }>(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces' LIMIT 1",
                );
                expect(row?.name).toBe('workspaces');
            } finally {
                a.close();
                b.close();
            }
        });
    });

    describe('makeTaskFrontmatter', () => {
        test('produces a schema-valid frontmatter object', () => {
            const fm = makeTaskFrontmatter();
            const parsed = taskFrontmatterSchema.parse(fm);
            expect(parsed.schema_version).toBe(1);
            expect(parsed.name).toBe('Fixture task');
            expect(parsed.status).toBe('wip');
        });

        test('applies overrides', () => {
            const fm = makeTaskFrontmatter({ name: 'Custom', status: 'done', priority: 'P0', tags: ['x'] });
            const parsed = taskFrontmatterSchema.parse(fm);
            expect(parsed.name).toBe('Custom');
            expect(parsed.status).toBe('done');
            expect(parsed.priority).toBe('P0');
            expect(parsed.tags).toEqual(['x']);
        });

        test('omits keys not provided in overrides', () => {
            const fm = makeTaskFrontmatter();
            expect('priority' in fm).toBe(false);
            expect('tags' in fm).toBe(false);
            expect('feature_id' in fm).toBe(false);
        });
    });

    describe('makeFeatureFrontmatter', () => {
        test('produces a schema-valid frontmatter object', () => {
            const fm = makeFeatureFrontmatter();
            const parsed = featureFrontmatterSchema.parse(fm);
            expect(parsed.schema_version).toBe(1);
            expect(parsed.id).toBe('A');
            expect(parsed.status).toBe('active');
            expect(parsed.priority).toBe('P1');
        });

        test('applies overrides including hierarchical id', () => {
            const fm = makeFeatureFrontmatter({ id: 'A11', name: 'Custom feature', status: 'done' });
            const parsed = featureFrontmatterSchema.parse(fm);
            expect(parsed.id).toBe('A11');
            expect(parsed.name).toBe('Custom feature');
            expect(parsed.status).toBe('done');
        });
    });

    describe('makeTaskFile', () => {
        test('parses through MarkdownDocument with task sections', () => {
            const content = makeTaskFile();
            const doc = MarkdownDocument.parse(content, 'task');
            expect(doc.frontmatterData?.name).toBe('Fixture task');
            expect(doc.sectionNames).toContain('Background');
            expect(doc.sectionNames).toContain('Requirements');
            expect(doc.sectionNames).toContain('Solution');
            expect(doc.sectionNames).toContain('Testing');
        });

        test('frontmatter validates against taskFrontmatterSchema', () => {
            const content = makeTaskFile();
            const doc = MarkdownDocument.parse(content, 'task');
            const parsed = taskFrontmatterSchema.parse(doc.frontmatterData);
            expect(parsed.name).toBe('Fixture task');
        });

        test('serializes byte-identically when untouched (round-trip property)', () => {
            const content = makeTaskFile();
            const doc = MarkdownDocument.parse(content, 'task');
            expect(doc.serialize()).toBe(content);
        });

        test('accepts overrides', () => {
            const content = makeTaskFile({ name: 'Override', status: 'done' });
            const doc = MarkdownDocument.parse(content, 'task');
            expect(doc.frontmatterData?.name).toBe('Override');
            expect(doc.frontmatterData?.status).toBe('done');
        });

        test('renders feature_id/parent_wbs/profile overrides into the file (no silent drop)', () => {
            const content = makeTaskFile({ feature_id: 'A1', parent_wbs: '0049', profile: 'standard' });
            const doc = MarkdownDocument.parse(content, 'task');
            // Every override the interface accepts must survive into the rendered frontmatter.
            expect(doc.frontmatterData?.feature_id).toBe('A1');
            expect(doc.frontmatterData?.parent_wbs).toBe('0049');
            expect(doc.frontmatterData?.profile).toBe('standard');
            // And the result is still schema-valid.
            const parsed = taskFrontmatterSchema.parse(doc.frontmatterData);
            expect(parsed.feature_id).toBe('A1');
        });
    });

    describe('makeFeatureFile', () => {
        test('parses through MarkdownDocument with feature sections', () => {
            const content = makeFeatureFile();
            const doc = MarkdownDocument.parse(content, 'feature');
            expect(doc.frontmatterData?.id).toBe('A');
            expect(doc.sectionNames).toContain('Goal');
            expect(doc.sectionNames).toContain('Scope');
            expect(doc.sectionNames).toContain('Acceptance Criteria');
            expect(doc.sectionNames).toContain('Tasks');
        });

        test('frontmatter validates against featureFrontmatterSchema', () => {
            const content = makeFeatureFile();
            const doc = MarkdownDocument.parse(content, 'feature');
            const parsed = featureFrontmatterSchema.parse(doc.frontmatterData);
            expect(parsed.id).toBe('A');
            expect(parsed.priority).toBe('P1');
        });

        test('serializes byte-identically when untouched (round-trip property)', () => {
            const content = makeFeatureFile();
            const doc = MarkdownDocument.parse(content, 'feature');
            expect(doc.serialize()).toBe(content);
        });

        test('contains the auto-generated marker region in Tasks section', () => {
            const content = makeFeatureFile();
            const doc = MarkdownDocument.parse(content, 'feature');
            expect(doc.getSection('Tasks')).toContain('AUTO-GENERATED');
        });
    });
});
