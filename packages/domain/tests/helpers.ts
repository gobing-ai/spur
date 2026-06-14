/**
 * Per-workspace test helpers for `@gobing-ai/spur-domain` (design §13, H05).
 *
 * Shared `@gobing-ai/spur-testing` workspace is held — helpers live per-workspace
 * in `tests/helpers.ts`. Each helper here has at least one consuming test to
 * avoid dead code.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb as createMigratedDbImpl, type DbAdapter } from '../src';

// ─── Temp-project factory (R1) ───────────────────────────────────────────

export interface TempProject {
    /** Absolute root of the temp project. */
    root: string;
    /** `<root>/.spur` directory. */
    spurDir: string;
    /** `<root>/docs/tasks` directory. */
    tasksDir: string;
    /** `<root>/docs/features` directory. */
    featuresDir: string;
}

/**
 * Create a temp project dir with the Spur planning layout: `.spur/config.yaml`
 * (minimal valid marker), `docs/tasks/`, and `docs/features/`.
 *
 * Returns the directory paths so callers can write fixtures into them.
 */
export async function createTempProject(prefix = 'spur-domain-'): Promise<TempProject> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    const spurDir = join(root, '.spur');
    const tasksDir = join(root, 'docs', 'tasks');
    const featuresDir = join(root, 'docs', 'features');
    await Bun.write(join(spurDir, 'config.yaml'), ['version: "1"', 'name: fixture', ''].join('\n'));
    await Bun.write(join(tasksDir, '.gitkeep'), '');
    await Bun.write(join(featuresDir, '.gitkeep'), '');
    return { root, spurDir, tasksDir, featuresDir };
}

// ─── In-memory SQLite factory (R3) ──────────────────────────────────────

/**
 * Create a fresh in-memory SQLite adapter with CLI migrations applied.
 *
 * Thin pass-through to the domain's canonical `createMigratedDb`. Each call
 * yields an independent database — callers own closing the adapter.
 */
export async function createMigratedDb(url = ':memory:'): Promise<DbAdapter> {
    return createMigratedDbImpl({ url });
}

// ─── Task / feature file fixture factories (R2) ─────────────────────────

const ISO = '2026-06-13T00:00:00.000Z';

/** Override object for {@link makeTaskFrontmatter}. All keys optional. */
export interface TaskFrontmatterOverrides {
    name?: string;
    status?: string;
    priority?: string;
    tags?: string[];
    feature_id?: string | null;
    parent_wbs?: string | null;
    profile?: string;
}

/**
 * Build a valid task frontmatter object (per `taskFrontmatterSchema`).
 *
 * Accepts string aliases for status so tests can exercise normalization.
 * `schema_version` and timestamps are fixed for deterministic round-trips.
 */
export function makeTaskFrontmatter(overrides: TaskFrontmatterOverrides = {}): Record<string, unknown> {
    return {
        schema_version: 1,
        name: overrides.name ?? 'Fixture task',
        status: overrides.status ?? 'wip',
        created_at: ISO,
        updated_at: ISO,
        ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
        ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
        ...(overrides.feature_id !== undefined ? { feature_id: overrides.feature_id } : {}),
        ...(overrides.parent_wbs !== undefined ? { parent_wbs: overrides.parent_wbs } : {}),
        ...(overrides.profile !== undefined ? { profile: overrides.profile } : {}),
    };
}

/** Override object for {@link makeFeatureFrontmatter}. All keys optional. */
export interface FeatureFrontmatterOverrides {
    id?: string;
    name?: string;
    status?: string;
    priority?: string;
    tags?: string[];
}

/**
 * Build a valid feature frontmatter object (per `featureFrontmatterSchema`).
 *
 * Accepts string aliases for status so tests can exercise normalization.
 */
export function makeFeatureFrontmatter(overrides: FeatureFrontmatterOverrides = {}): Record<string, unknown> {
    return {
        schema_version: 1,
        id: overrides.id ?? 'A',
        name: overrides.name ?? 'Fixture feature',
        status: overrides.status ?? 'active',
        priority: overrides.priority ?? 'P1',
        created_at: ISO,
        updated_at: ISO,
        ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    };
}

/**
 * Render a complete task markdown file string (frontmatter + canonical sections).
 *
 * The output parses cleanly through `MarkdownDocument.parse(content, 'task')`
 * and `taskFrontmatterSchema`.
 */
export function makeTaskFile(overrides: TaskFrontmatterOverrides = {}): string {
    const fm = makeTaskFrontmatter(overrides);
    const name = (fm.name as string) ?? 'Fixture task';
    // Emit every optional key the override surface accepts, so the rendered file
    // round-trips the same data as makeTaskFrontmatter. Omitting any would be a
    // silent fixture trap (override accepted but dropped from the file).
    // `parent_wbs` is a 4-digit string (e.g. "0049") — quote it so YAML doesn't
    // coerce the leading-zero value to a number and fail `wbsString` validation.
    const optionalLines = [
        fm.feature_id !== undefined ? `feature_id: ${fm.feature_id}` : '',
        fm.parent_wbs !== undefined ? `parent_wbs: ${JSON.stringify(String(fm.parent_wbs))}` : '',
        fm.profile !== undefined ? `profile: ${fm.profile}` : '',
        Array.isArray(fm.tags) && (fm.tags as string[]).length > 0 ? `tags: ${JSON.stringify(fm.tags)}` : '',
    ].filter((line) => line.length > 0);
    return [
        '---',
        `schema_version: ${fm.schema_version}`,
        `name: ${fm.name}`,
        `status: ${fm.status}`,
        `created_at: ${fm.created_at}`,
        `updated_at: ${fm.updated_at}`,
        `priority: ${fm.priority ?? 'P1'}`,
        ...optionalLines,
        '---',
        '',
        `## 0050. ${name}`,
        '',
        '### Background',
        '',
        'Fixture background text.',
        '',
        '### Requirements',
        '',
        '- R1: do the thing',
        '',
        '### Solution',
        '',
        'Fixture solution text.',
        '',
        '### Testing',
        '',
        '',
    ].join('\n');
}

/**
 * Render a complete feature markdown file string (frontmatter + canonical sections).
 *
 * The output parses cleanly through `MarkdownDocument.parse(content, 'feature')`
 * and `featureFrontmatterSchema`.
 */
export function makeFeatureFile(overrides: FeatureFrontmatterOverrides = {}): string {
    const fm = makeFeatureFrontmatter(overrides);
    const name = (fm.name as string) ?? 'Fixture feature';
    return [
        '---',
        `schema_version: ${fm.schema_version}`,
        `id: ${fm.id}`,
        `name: ${fm.name}`,
        `status: ${fm.status}`,
        `priority: ${fm.priority}`,
        `created_at: ${fm.created_at}`,
        `updated_at: ${fm.updated_at}`,
        '---',
        '',
        `# ${fm.id}: ${name}`,
        '',
        '## Goal',
        '',
        'Fixture goal text.',
        '',
        '## Scope',
        '',
        'Fixture scope text.',
        '',
        '## Acceptance Criteria',
        '',
        '```gherkin',
        'Feature: Fixture',
        '',
        '  Scenario: fixture works',
        '    Given a precondition',
        '    When an action happens',
        '    Then a result is observed',
        '```',
        '',
        '## Tasks',
        '',
        '<!-- AUTO-GENERATED by spur feature refresh -->',
        '| WBS | Task | Status |',
        '|-----|------|--------|',
        '<!-- END AUTO-GENERATED -->',
        '',
        '## Notes',
        '',
        '',
    ].join('\n');
}
