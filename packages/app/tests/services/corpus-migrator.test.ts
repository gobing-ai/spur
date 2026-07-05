import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    applyM1,
    applyM2,
    applyM3,
    applyM4,
    applyM5,
    applyM6,
    applyM7,
    applyM8,
    CorpusMigrator,
    extractFilenameParent,
    type MigrationFlag,
    serializeFrontmatter,
} from '../../src/services/corpus-migrator';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempCorpus(): string {
    return mkdtempSync(join(tmpdir(), 'spur-corpus-test-'));
}

function makeCorpusFile(dir: string, filename: string, content: string): string {
    const path = join(dir, filename);
    writeFileSync(path, content);
    return path;
}

function makeFs(cwd: string) {
    return createNodeFileSystem(cwd);
}

/** Minimal legacy task file (pre-migration). */
const LEGACY_TASK = `---
name: "Sample legacy task"
description: "Sample legacy task"
status: Done
created_at: 2026-05-09T04:48:47.680Z
updated_at: 2026-05-11T00:00:00.000Z
folder: docs/tasks
type: task
feature-id: F-1.4.1
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0050. "Sample legacy task"

### Background

This is the body prose. It must not be modified by migration.

### Requirements

R1. Some requirement.

### Solution

Some solution text.
`;

/** Legacy task with preset, dependencies, tags as strings, medium priority. */
const LEGACY_TASK_FULL = `---
name: "Full legacy task"
description: "Full legacy task"
status: WIP
created_at: 2026-05-10T00:00:00.000Z
updated_at: 2026-05-11T00:00:00.000Z
folder: docs/tasks
type: task
preset: standard
priority: medium
dependencies: "0090,0091"
tags: "kernel,cli,wave-5"
impl_progress:
  planning: pending
---

## 0090. "Full legacy task"

### Background

Body text.
`;

/** Legacy task with parent_id convention. Name avoids "parent_id" substring. */
const LEGACY_TASK_PARENT_ID = `---
name: "Sub-task with parent reference"
description: "Sub-task with parent reference"
status: Backlog
created_at: 2026-05-12T00:00:00.000Z
updated_at: 2026-05-12T00:00:00.000Z
folder: docs/tasks
type: task
parent_id: "0050"
---

## 0051. "Sub-task with parent reference"

### Background

Sub-task body.
`;

/** Legacy task with filename-embedded parent: 0140_0139.A_... */
const LEGACY_TASK_FILENAME_PARENT = `---
name: "Refactor parent task"
description: "Refactor parent task"
status: done
created_at: 2026-05-14T00:00:00.000Z
updated_at: 2026-05-14T00:00:00.000Z
folder: docs/tasks
type: task
---

## 0140. "Refactor parent task"

### Background

Body.
`;

// ── M-rule unit tests ────────────────────────────────────────────────────────

describe('M1 — Status canon', () => {
    test('normalizes Done → done', () => {
        const data: Record<string, unknown> = { status: 'Done' };
        const flags: MigrationFlag[] = [];
        applyM1(data, flags);
        expect(data.status).toBe('done');
        expect(flags).toHaveLength(0);
    });

    test('normalizes WIP → wip', () => {
        const data: Record<string, unknown> = { status: 'WIP' };
        const flags: MigrationFlag[] = [];
        applyM1(data, flags);
        expect(data.status).toBe('wip');
    });

    test('normalizes Backlog → backlog', () => {
        const data: Record<string, unknown> = { status: 'Backlog' };
        const flags: MigrationFlag[] = [];
        applyM1(data, flags);
        expect(data.status).toBe('backlog');
    });

    test('flags unknown status and defaults to backlog', () => {
        const data: Record<string, unknown> = { status: 'Frozen' };
        const flags: MigrationFlag[] = [];
        applyM1(data, flags);
        expect(data.status).toBe('backlog');
        expect(flags).toHaveLength(1);
        expect(flags[0]?.rule).toBe('M1');
        expect(flags[0]?.severity).toBe('warning');
    });

    test('skips non-string status', () => {
        const data: Record<string, unknown> = { status: 42 };
        const flags: MigrationFlag[] = [];
        applyM1(data, flags);
        expect(data.status).toBe(42);
        expect(flags).toHaveLength(0);
    });
});

describe('M2 — Key collapse (preset/profile)', () => {
    test('collapses preset → profile', () => {
        const data: Record<string, unknown> = { preset: 'standard' };
        applyM2(data);
        expect(data.profile).toBe('standard');
        expect(data.preset).toBeUndefined();
    });

    test('profile wins when both present', () => {
        const data: Record<string, unknown> = { preset: 'simple', profile: 'complex' };
        applyM2(data);
        expect(data.profile).toBe('complex');
        expect(data.preset).toBeUndefined();
    });

    test('no-op when neither present', () => {
        const data: Record<string, unknown> = { name: 'x' };
        applyM2(data);
        expect(data.profile).toBeUndefined();
        expect(data.preset).toBeUndefined();
    });
});

describe('M3 — Edge rename (feature-id → feature_id)', () => {
    test('renames valid feature-id → feature_id', () => {
        const data: Record<string, unknown> = { 'feature-id': 'A1' };
        const flags: MigrationFlag[] = [];
        applyM3(data, flags);
        expect(data.feature_id).toBe('A1');
        expect(data['feature-id']).toBeUndefined();
    });

    test('drops legacy F-X.Y.Z feature-id (incompatible with DD-14)', () => {
        const data: Record<string, unknown> = { 'feature-id': 'F-1.4.1' };
        const flags: MigrationFlag[] = [];
        applyM3(data, flags);
        expect(data.feature_id).toBeUndefined();
        expect(data['feature-id']).toBeUndefined();
        expect(flags).toHaveLength(1);
        expect(flags[0]?.rule).toBe('M3');
    });

    test('removes empty string feature-id', () => {
        const data: Record<string, unknown> = { 'feature-id': '' };
        const flags: MigrationFlag[] = [];
        applyM3(data, flags);
        expect(data['feature-id']).toBeUndefined();
        expect(data.feature_id).toBeUndefined();
    });

    test('removes null feature-id', () => {
        const data: Record<string, unknown> = { 'feature-id': null };
        const flags: MigrationFlag[] = [];
        applyM3(data, flags);
        expect(data['feature-id']).toBeUndefined();
    });

    test('no-op when feature-id absent', () => {
        const data: Record<string, unknown> = { name: 'x' };
        const flags: MigrationFlag[] = [];
        applyM3(data, flags);
        expect(data.feature_id).toBeUndefined();
    });
});

describe('M4 — Noise removal', () => {
    test('drops impl_progress', () => {
        const data: Record<string, unknown> = { impl_progress: { planning: 'done' } };
        applyM4(data);
        expect(data.impl_progress).toBeUndefined();
    });

    test('drops folder', () => {
        const data: Record<string, unknown> = { folder: 'docs/tasks' };
        applyM4(data);
        expect(data.folder).toBeUndefined();
    });

    test('drops description when == name', () => {
        const data: Record<string, unknown> = { name: 'My Task', description: 'My Task' };
        applyM4(data);
        expect(data.description).toBeUndefined();
    });

    test('keeps description when != name', () => {
        const data: Record<string, unknown> = {
            name: 'My Task',
            description: 'A longer description',
        };
        applyM4(data);
        expect(data.description).toBe('A longer description');
    });
});

describe('M5 — Sub-task unification (parent_wbs)', () => {
    test('convention 1: parent_id → parent_wbs', () => {
        const data: Record<string, unknown> = { parent_id: '0050' };
        const flags: MigrationFlag[] = [];
        applyM5(data, '', flags);
        expect(data.parent_wbs).toBe('0050');
        expect(data.parent_id).toBeUndefined();
        expect(flags).toHaveLength(0);
    });

    test('convention 2: parent-wbs → parent_wbs', () => {
        const data: Record<string, unknown> = { 'parent-wbs': '0090' };
        const flags: MigrationFlag[] = [];
        applyM5(data, '', flags);
        expect(data.parent_wbs).toBe('0090');
        expect(data['parent-wbs']).toBeUndefined();
    });

    test('convention 3: filename-embedded parent', () => {
        const data: Record<string, unknown> = {};
        const flags: MigrationFlag[] = [];
        applyM5(data, '0139', flags);
        expect(data.parent_wbs).toBe('0139');
        expect(flags).toHaveLength(0);
    });

    test('unresolvable parent value is flagged and dropped', () => {
        const data: Record<string, unknown> = { parent_id: 'abc' };
        const flags: MigrationFlag[] = [];
        applyM5(data, '', flags);
        expect(data.parent_wbs).toBeUndefined();
        expect(flags).toHaveLength(1);
        expect(flags[0]?.rule).toBe('M5');
    });

    test('does not overwrite existing parent_wbs', () => {
        const data: Record<string, unknown> = { parent_wbs: '0050', parent_id: '0090' };
        const flags: MigrationFlag[] = [];
        applyM5(data, '0139', flags);
        expect(data.parent_wbs).toBe('0050');
    });
});

describe('M6 — Versioning (schema_version)', () => {
    test('adds schema_version: 1', () => {
        const data: Record<string, unknown> = { name: 'x' };
        applyM6(data);
        expect(data.schema_version).toBe(1);
    });

    test('no-op when schema_version already set', () => {
        const data: Record<string, unknown> = { schema_version: 1 };
        applyM6(data);
        expect(data.schema_version).toBe(1);
    });
});

describe('M7 — Timestamp repair', () => {
    test('keeps valid updated_at', () => {
        const data: Record<string, unknown> = {
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-11T00:00:00.000Z',
        };
        const flags: MigrationFlag[] = [];
        applyM7(data, null, null, flags);
        expect(data.updated_at).toBe('2026-05-11T00:00:00.000Z');
        expect(flags).toHaveLength(0);
    });

    test('repairs missing updated_at from git log', () => {
        const data: Record<string, unknown> = {
            created_at: '2026-05-01T00:00:00.000Z',
        };
        const flags: MigrationFlag[] = [];
        applyM7(data, '2026-05-10T12:00:00.000Z', null, flags);
        expect(data.updated_at).toBe('2026-05-10T12:00:00.000Z');
        expect(flags).toHaveLength(1);
        expect(flags[0]?.rule).toBe('M7');
        expect(flags[0]?.severity).toBe('info');
    });

    test('repairs missing updated_at from mtime when git unavailable', () => {
        const data: Record<string, unknown> = {
            created_at: '2026-05-01T00:00:00.000Z',
        };
        const flags: MigrationFlag[] = [];
        applyM7(data, null, '2026-05-15T08:00:00.000Z', flags);
        expect(data.updated_at).toBe('2026-05-15T08:00:00.000Z');
        expect(flags).toHaveLength(1);
        expect(flags[0]?.severity).toBe('warning');
    });

    test('repairs updated_at before created_at', () => {
        const data: Record<string, unknown> = {
            created_at: '2026-05-10T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
        };
        const flags: MigrationFlag[] = [];
        applyM7(data, '2026-05-11T00:00:00.000Z', null, flags);
        expect(data.updated_at).toBe('2026-05-11T00:00:00.000Z');
        expect(flags).toHaveLength(1);
    });

    test('repairs future-dated updated_at', () => {
        const future = new Date(Date.now() + 86400000).toISOString();
        const data: Record<string, unknown> = {
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: future,
        };
        const flags: MigrationFlag[] = [];
        applyM7(data, '2026-05-11T00:00:00.000Z', null, flags);
        expect(data.updated_at).toBe('2026-05-11T00:00:00.000Z');
    });

    test('flags when no recovery source available', () => {
        const data: Record<string, unknown> = {
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: 'garbage',
        };
        const flags: MigrationFlag[] = [];
        applyM7(data, null, null, flags);
        expect(flags).toHaveLength(1);
        expect(flags[0]?.severity).toBe('warning');
        expect(data.updated_at).toBe('garbage');
    });
});

// ── M8 — History seed ───────────────────────────────────────────────────────

describe('M8 — History seed', () => {
    test('appends History section when absent', () => {
        const content = `---
name: "Test"
status: done
created_at: 2026-05-01T00:00:00.000Z
updated_at: 2026-05-01T00:00:00.000Z
---

## 0050. "Test"

### Background

Body.
`;
        const doc = MarkdownDocument.parse(content, 'task');
        const body = content.slice(content.indexOf('---\n') + 4);
        const result = applyM8(doc, 'task', body);
        expect(result).toContain('### History');
        expect(result).toContain('Migrated from legacy format');
    });

    test('uses ## heading for the feature domain (### for task)', () => {
        const content = `---
name: "Feat"
status: active
created_at: 2026-05-01T00:00:00.000Z
updated_at: 2026-05-01T00:00:00.000Z
---

## A1. "Feat"

### Background

Body.
`;
        const doc = MarkdownDocument.parse(content, 'feature');
        const body = content.slice(content.indexOf('---\n') + 4);
        const result = applyM8(doc, 'feature', body);
        expect(result).toContain('## History');
        expect(result).not.toContain('### History');
    });

    test('does not append when History already exists', () => {
        const content = `---
name: "Test"
status: done
created_at: 2026-05-01T00:00:00.000Z
updated_at: 2026-05-01T00:00:00.000Z
---

## 0050. "Test"

### Background

Body.

### History

- Original entry (2026-01-01)
`;
        const doc = MarkdownDocument.parse(content, 'task');
        const body = content.slice(content.indexOf('---\n') + 4);
        const result = applyM8(doc, 'task', body);
        const historyCount = (result.match(/### History/g) ?? []).length;
        expect(historyCount).toBe(1);
    });
});

// ── Filename parent extraction ──────────────────────────────────────────────

describe('extractFilenameParent', () => {
    test('extracts parent from 0140_0139.A pattern', () => {
        expect(extractFilenameParent('0140_0139.A_Workflow_refactor.md')).toBe('0139');
    });

    test('extracts parent from 0141_0139.B pattern', () => {
        expect(extractFilenameParent('0141_0139.B_Other.md')).toBe('0139');
    });

    test('returns undefined for simple filename', () => {
        expect(extractFilenameParent('0050_Sample_task.md')).toBeUndefined();
    });

    test('returns undefined for filenames without underscore', () => {
        expect(extractFilenameParent('kanban.md')).toBeUndefined();
    });
});

// ── serializeFrontmatter ────────────────────────────────────────────────────

describe('serializeFrontmatter', () => {
    test('produces canonical field order', () => {
        const data = {
            updated_at: '2026-05-11T00:00:00.000Z',
            name: 'Test',
            schema_version: 1,
            status: 'done',
            created_at: '2026-05-01T00:00:00.000Z',
        };
        const result = serializeFrontmatter(data);
        const lines = result.split('\n');
        expect(lines[0]).toBe('---');
        // schema_version should be first (canonical order)
        expect(lines[1]).toBe('schema_version: 1');
        // name second
        expect(lines[2]).toBe('name: Test');
        // updated_at last
        expect(lines[5]).toBe('updated_at: 2026-05-11T00:00:00.000Z');
    });

    test('omits undefined/null fields', () => {
        const data = {
            schema_version: 1,
            name: 'Test',
            status: 'done',
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
            feature_id: null,
            parent_wbs: undefined,
        };
        const result = serializeFrontmatter(data);
        expect(result).not.toContain('feature_id');
        expect(result).not.toContain('parent_wbs');
    });

    test('formats array values inline', () => {
        const data = {
            schema_version: 1,
            name: 'Test',
            status: 'done',
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
            tags: ['kernel', 'cli'],
        };
        const result = serializeFrontmatter(data);
        expect(result).toContain('tags: [kernel,cli]');
    });

    test('preserves template frontmatter key (drives task-check variant)', () => {
        // `template` selects the task-check section-layout variant (task-check.ts);
        // dropping it silently flips every feature-impl task to the default variant.
        const data = {
            template: 'feature-impl',
            schema_version: 1,
            name: 'Test',
            status: 'todo',
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
        };
        const result = serializeFrontmatter(data);
        expect(result).toContain('template: feature-impl');
    });

    test('preserves parent_wbs: null (explicit no-parent vs field-absent)', () => {
        // Top-level tasks carry `parent_wbs: null` to mark "no parent" explicitly;
        // absence is ambiguous. null must round-trip for this key.
        const data = {
            schema_version: 1,
            name: 'Top-level',
            status: 'todo',
            parent_wbs: null,
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
        };
        const result = serializeFrontmatter(data);
        expect(result).toContain('parent_wbs: null');
    });

    test('preserves explicit empty dependencies array', () => {
        // `dependencies: []` is an explicit "no deps" marker, distinct from a
        // missing key. Empty arrays must round-trip rather than be dropped.
        const data = {
            schema_version: 1,
            name: 'Test',
            status: 'todo',
            dependencies: [],
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
        };
        const result = serializeFrontmatter(data);
        expect(result).toContain('dependencies: []');
    });

    test('quotes WBS-style strings so YAML re-parses them as strings (round-trip)', () => {
        // A bare `parent_wbs: 0195` re-parses as the number 195, breaking the schema's
        // `string | null` contract. Leading-zero WBS IDs must be quoted on output.
        const data = {
            schema_version: 1,
            name: 'Sub-task',
            status: 'todo',
            parent_wbs: '0195',
            dependencies: ['0090', '0091'],
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
        };
        const result = serializeFrontmatter(data);
        expect(result).toContain('parent_wbs: "0195"');
        expect(result).toContain('dependencies: ["0090","0091"]');
        // Real numbers stay bare (schema_version is `z.literal(1)`, a number).
        expect(result).toContain('schema_version: 1');
        expect(result).not.toContain('schema_version: "1"');
    });
});

// ── Integration: CorpusMigrator ─────────────────────────────────────────────

describe('CorpusMigrator integration', () => {
    test('migrates a standard legacy task file', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0050_Sample_legacy_task.md', LEGACY_TASK);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();

        expect(report.filesScanned).toBe(1);
        expect(report.filesModified).toBe(1);
        expect(report.filesSkipped).toBe(0);

        // Verify the output file
        const output = readFileSync(join(dir, '0050_Sample_legacy_task.md'), 'utf-8');
        expect(output).toContain('schema_version: 1');
        expect(output).toContain('status: done');
        // Legacy F-X.Y.Z feature-id dropped (incompatible with DD-14)
        expect(output).not.toContain('feature_id');
        expect(output).not.toContain('feature-id');
        expect(output).not.toContain('impl_progress');
        expect(output).not.toContain('folder:');
        expect(output).not.toContain('feature-id');
        // Description == name → dropped
        expect(output.match(/description:/g)).toBeNull();
        // History appended
        expect(output).toContain('### History');
        expect(output).toContain('Migrated from legacy format');
    });

    test('preserves body prose byte-identically', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0050_Sample_legacy_task.md', LEGACY_TASK);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        await migrator.migrate();

        const output = readFileSync(join(dir, '0050_Sample_legacy_task.md'), 'utf-8');
        // The body text between frontmatter and end must be preserved
        // (only new History section is appended)
        expect(output).toContain('This is the body prose. It must not be modified by migration.');
        expect(output).toContain('### Requirements\n\nR1. Some requirement.');
        expect(output).toContain('### Solution\n\nSome solution text.');
    });

    test('idempotent: second run produces zero modifications', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0050_Sample_legacy_task.md', LEGACY_TASK);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        // First run — should migrate
        const first = await migrator.migrate();
        expect(first.filesModified).toBe(1);

        // Second run — should be no-op
        const second = await migrator.migrate();
        expect(second.filesModified).toBe(0);
        expect(second.filesScanned).toBe(1);
    });

    test('--dry-run writes nothing', async () => {
        const dir = makeTempCorpus();
        const filePath = makeCorpusFile(dir, '0050_Sample_legacy_task.md', LEGACY_TASK);
        const originalContent = readFileSync(filePath, 'utf-8');
        const originalStat = statSync(filePath);

        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate({ dryRun: true });

        expect(report.filesScanned).toBe(1);
        expect(report.filesModified).toBe(1); // Reports what *would* be modified

        // File on disk is unchanged
        const afterContent = readFileSync(filePath, 'utf-8');
        const afterStat = statSync(filePath);
        expect(afterContent).toBe(originalContent);
        expect(afterStat.mtimeMs).toBe(originalStat.mtimeMs);
    });

    test('migrates full legacy task with preset, tags, dependencies, priority', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0090_Full_legacy_task.md', LEGACY_TASK_FULL);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();

        expect(report.filesModified).toBe(1);

        const output = readFileSync(join(dir, '0090_Full_legacy_task.md'), 'utf-8');
        expect(output).toContain('profile: standard');
        expect(output).not.toContain('preset:');
        expect(output).toContain('priority: P2');
        expect(output).toContain('tags: [kernel,cli,wave-5]');
        // WBS-style strings are quoted so YAML re-parses them as strings, not numbers.
        expect(output).toContain('dependencies: ["0090","0091"]');
    });

    test('migrates parent_id convention to parent_wbs', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0051_Sub-task_with_parent_id.md', LEGACY_TASK_PARENT_ID);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        await migrator.migrate();

        const output = readFileSync(join(dir, '0051_Sub-task_with_parent_id.md'), 'utf-8');
        // WBS IDs are quoted to survive YAML round-trip as strings.
        expect(output).toContain('parent_wbs: "0050"');
        // Check frontmatter has no parent_id key (the body prose title is fine)
        const fmBlock = output.split('---')[1] ?? '';
        expect(fmBlock).not.toContain('parent_id');
    });

    test('migrates filename-embedded parent to parent_wbs', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0140_0139.A_Refactor_parent_task.md', LEGACY_TASK_FILENAME_PARENT);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        await migrator.migrate();

        const output = readFileSync(join(dir, '0140_0139.A_Refactor_parent_task.md'), 'utf-8');
        expect(output).toContain('parent_wbs: "0139"');
    });

    test('skips files with no frontmatter', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, 'README.md', '# No frontmatter here\n\nJust prose.');
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();

        expect(report.filesScanned).toBe(1);
        expect(report.filesModified).toBe(0);
        expect(report.fileReports[0]?.flags[0]?.severity).toBe('info');
    });

    test('skips kanban.md', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, 'kanban.md', '---\nname: board\nstatus: done\n---\n\nBoard content');
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();
        expect(report.filesScanned).toBe(0);
    });

    test('handles malformed YAML gracefully', async () => {
        const dir = makeTempCorpus();
        const malformed = `---
name: "Test"
status: [unterminated
---

## 0050. "Test"
`;
        makeCorpusFile(dir, '0050_Test.md', malformed);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();

        expect(report.filesScanned).toBe(1);
        expect(report.filesModified).toBe(0);
        expect(report.filesSkipped).toBe(1);
        expect(report.fileReports[0]?.validationError).toBe('malformed-yaml');
    });

    test('provides per-file flags in report', async () => {
        const dir = makeTempCorpus();
        // Unknown status → M1 flag
        const unknown = `---
name: "Unknown status task"
description: "Unknown status task"
status: Frozen
created_at: 2026-05-01T00:00:00.000Z
updated_at: 2026-05-01T00:00:00.000Z
folder: docs/tasks
type: task
impl_progress:
  planning: pending
---

## 0060. "Unknown status task"

### Background

Body.
`;
        makeCorpusFile(dir, '0060_Unknown_status_task.md', unknown);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();

        const fileReport = report.fileReports[0];
        if (!fileReport) throw new Error('expected fileReport');
        const m1Flags = fileReport.flags.filter((f) => f.rule === 'M1');
        expect(m1Flags.length).toBeGreaterThan(0);
        expect(m1Flags[0]?.message).toContain('Unknown status');
        expect(m1Flags[0]?.message).toContain('backlog');
    });

    test('provides aggregate report with human-readable format', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0050_Sample.md', LEGACY_TASK);
        makeCorpusFile(dir, '0051_Other.md', LEGACY_TASK_PARENT_ID);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();

        expect(report.filesScanned).toBe(2);
        expect(report.filesModified).toBe(2);
        expect(report.flags.length).toBeGreaterThanOrEqual(0);
        expect(report.fileReports).toHaveLength(2);
        expect(report.fileReports[0]?.wbs).toBe('50');
        expect(report.fileReports[1]?.wbs).toBe('51');
    });

    test('provides JSON-compatible report', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0050_Sample.md', LEGACY_TASK);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        const report = await migrator.migrate();

        // The report must be serializable for --json output
        const json = JSON.stringify(report);
        expect(json).toBeDefined();
        const parsed = JSON.parse(json);
        expect(parsed.filesScanned).toBe(1);
        expect(parsed.fileReports[0].path).toBeDefined();
    });

    test('writes atomically (no leftover temp files after migration)', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0050_Sample.md', LEGACY_TASK);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        await migrator.migrate();

        // atomicWriteAsync uses `.<project>.<wbs>.<rand>.tmp` then renames; none should remain.
        const remaining = readdirSync(dir).filter((n) => n.endsWith('.tmp'));
        expect(remaining).toEqual([]);
        // Final file is intact and migrated.
        const output = readFileSync(join(dir, '0050_Sample.md'), 'utf-8');
        expect(output).toContain('schema_version: 1');
    });

    test('rejects a non-task domain (feature migration is unbuilt — fail loud)', () => {
        const dir = makeTempCorpus();
        const fs = makeFs(dir);
        expect(() => new CorpusMigrator({ fs, corpusDir: dir, domain: 'feature' })).toThrow(
            /only supports the 'task' domain/,
        );
    });

    test('does not append duplicate History on re-migration', async () => {
        const dir = makeTempCorpus();
        makeCorpusFile(dir, '0050_Sample.md', LEGACY_TASK);
        const fs = makeFs(dir);
        const migrator = new CorpusMigrator({ fs, corpusDir: dir });

        await migrator.migrate();
        const afterFirst = readFileSync(join(dir, '0050_Sample.md'), 'utf-8');
        const historyCountFirst = (afterFirst.match(/### History/g) ?? []).length;
        expect(historyCountFirst).toBe(1);

        // Second migration — should not add another History section
        await migrator.migrate();
        const afterSecond = readFileSync(join(dir, '0050_Sample.md'), 'utf-8');
        const historyCountSecond = (afterSecond.match(/### History/g) ?? []).length;
        expect(historyCountSecond).toBe(1);
    });
});
