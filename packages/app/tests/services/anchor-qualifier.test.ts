import { describe, expect, test } from 'bun:test';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import {
    anchorQualify,
    buildTrackedBasenameIndex,
    qualifyAnchors,
    qualifySectionBody,
    resolveConfiguredTaskDirs,
    resolveRepoRoot,
} from '../../src/services/anchor-qualifier';
import { citedLinesNameSubject, extractPathSubjectTokens, extractSubjectTokens } from '../../src/services/task-check';

describe('qualifySectionBody', () => {
    const index = new Map<string, string[]>([
        ['badge.tsx', ['packages/web/src/Badge.tsx']],
        ['history-service.ts', ['packages/app/src/services/history-service.ts']],
        ['mappers.ts', ['lib/a/mappers.ts', 'lib/b/mappers.ts']],
    ]);

    test('R1: rewrites a unique bare basename to its repo-relative path', () => {
        const body = ['Evidence: `Badge.tsx:42` implements the badge.', ''].join('\n');
        const { newBody, qualified } = qualifySectionBody(body, index);
        expect(newBody).toContain('`packages/web/src/Badge.tsx:42`');
        expect(qualified).toHaveLength(1);
        expect(qualified[0]?.oldPath).toBe('Badge.tsx');
        expect(qualified[0]?.newPath).toBe('packages/web/src/Badge.tsx');
    });

    test('R1: idempotent — a second pass changes zero', () => {
        const body = ['Evidence: `Badge.tsx:42`', ''].join('\n');
        const first = qualifySectionBody(body, index);
        expect(first.newBody).not.toBe(body);
        const second = qualifySectionBody(first.newBody, index);
        expect(second.newBody).toBe(first.newBody);
        expect(second.qualified).toHaveLength(0);
    });

    test('R2: an ambiguous basename is reported and left untouched', () => {
        const body = ['Evidence: `mappers.ts:481` maps call ids.', ''].join('\n');
        const { newBody, qualified, ambiguous } = qualifySectionBody(body, index);
        expect(newBody).toBe(body);
        expect(qualified).toHaveLength(0);
        expect(ambiguous).toHaveLength(1);
        expect(ambiguous[0]?.candidates).toEqual(['lib/a/mappers.ts', 'lib/b/mappers.ts']);
    });

    test('dedupes repeated ambiguous citations in the same body', () => {
        const body = ['Evidence: `mappers.ts:481` and `mappers.ts:500`', ''].join('\n');
        const { newBody, ambiguous } = qualifySectionBody(body, index);
        expect(newBody).toBe(body);
        expect(ambiguous).toHaveLength(1);
    });

    test('R3: preserves the line range byte-for-byte on a range citation', () => {
        const body = ['Evidence: `history-service.ts:284-290` runs the importer.', ''].join('\n');
        const { newBody, qualified } = qualifySectionBody(body, index);
        expect(newBody).toContain('`packages/app/src/services/history-service.ts:284-290`');
        expect(qualified[0]?.lineSpec).toBe('284-290');
    });

    test('untracked / external evidence is untouched and not reported as ambiguous or qualified', () => {
        const body = ['Evidence: `untracked-file.ts:10` is not in index.', ''].join('\n');
        const { newBody, qualified, ambiguous } = qualifySectionBody(body, index);
        expect(newBody).toBe(body);
        expect(qualified).toHaveLength(0);
        expect(ambiguous).toHaveLength(0);
    });

    test('ignores matches with empty path part', () => {
        const body = ['Empty path citation `:10` is ignored.', ''].join('\n');
        const { newBody, qualified, ambiguous } = qualifySectionBody(body, index);
        expect(newBody).toBe(body);
        expect(qualified).toHaveLength(0);
        expect(ambiguous).toHaveLength(0);
    });
});

describe('resolveRepoRoot', () => {
    test('returns explicit projectRoot when provided', async () => {
        const root = await resolveRepoRoot('/custom/project/root');
        expect(root).toBe('/custom/project/root');
    });

    test('resolves git repo root when projectRoot is omitted', async () => {
        const root = await resolveRepoRoot(undefined);
        expect(root).toBe(process.cwd());
    });
});

describe('buildTrackedBasenameIndex', () => {
    test('builds tracked index from real repo root and filters out .spur/', async () => {
        const index = await buildTrackedBasenameIndex(process.cwd());
        expect(index.size).toBeGreaterThan(0);
        // .spur/ entries should be excluded
        for (const list of index.values()) {
            for (const p of list) {
                expect(p).not.toMatch(/\.spur(\/|$)/);
            }
        }
    });

    test('returns empty index on invalid directory', async () => {
        const index = await buildTrackedBasenameIndex('/invalid/directory/path/xyz');
        expect(index.size).toBe(0);
    });
});

describe('resolveConfiguredTaskDirs', () => {
    test('resolves active and configured task folders', async () => {
        const fs = createNodeFileSystem(process.cwd());
        const dirs = await resolveConfiguredTaskDirs(fs);
        expect(dirs.length).toBeGreaterThan(0);
    });
});

describe('qualifyAnchors & anchorQualify', () => {
    test('qualifyAnchors performs dry-run and apply over provided task directories', async () => {
        const files: Record<string, string> = {
            '/mock/docs/tasks/0001_task.md': `---
wbs: "0001"
name: "Task 1"
status: todo
---

## 0001. Task 1

### Testing

Evidence: \`project-registry.ts:42\`

### Solution

Solution detail: \`task-check.ts:100\`
`,
            '/mock/docs/tasks/0002_ambiguous.md': `---
wbs: "0002"
name: "Task 2"
status: todo
---

## 0002. Task 2

### Testing

Evidence: \`index.ts:10\`
`,
            '/mock/docs/tasks/kanban.md': '# Kanban board (ignored)',
            '/mock/docs/tasks/notes.txt': 'Not a markdown file',
        };

        const written: Array<{ filePath: string; wbs: string; section: string; newBody: string }> = [];

        const mockFs = {
            resolve: (p: string) => p,
            cwd: () => '/mock',
            readDir: async (dir: string) => {
                if (dir === '/mock/docs/tasks') {
                    return ['0001_task.md', '0002_ambiguous.md', 'kanban.md', 'notes.txt'];
                }
                throw new Error('Directory not found');
            },
            readFile: async (p: string) => {
                const content = files[p];
                if (content !== undefined) return content;
                throw new Error(`File not found: ${p}`);
            },
        } as unknown as FileSystem;

        // Dry-run
        const dryReport = await qualifyAnchors(mockFs, {
            fs: mockFs,
            dryRun: true,
            taskDirs: ['/mock/docs/tasks', '/mock/nonexistent-dir'],
            projectRoot: process.cwd(),
            write: async (filePath, wbs, section, newBody) => {
                written.push({ filePath, wbs, section, newBody });
            },
        });

        expect(dryReport.fileReports.length).toBeGreaterThan(0);
        expect(written).toHaveLength(0); // Dry-run writes nothing

        // Apply via anchorQualify convenience entrypoint
        const applyReport = await anchorQualify(mockFs, {
            dryRun: false,
            taskDirs: ['/mock/docs/tasks'],
            write: async (filePath, wbs, section, newBody) => {
                written.push({ filePath, wbs, section, newBody });
            },
        });

        expect(applyReport.filesModified).toBe(1);
        expect(written.length).toBeGreaterThan(0);
    });

    test('handles unreadable files and empty sections gracefully', async () => {
        const mockFs = {
            resolve: (p: string) => p,
            cwd: () => '/mock',
            readDir: async () => ['unreadable.md', 'no-sections.md'],
            readFile: async (p: string) => {
                if (p.includes('unreadable')) throw new Error('Permission denied');
                return '---\nname: "No sections"\n---\n\n## Background\nNo testing section';
            },
        } as unknown as FileSystem;

        const report = await qualifyAnchors(mockFs, {
            fs: mockFs,
            dryRun: false,
            taskDirs: ['/mock/docs/tasks'],
            projectRoot: process.cwd(),
        });

        expect(report.filesScanned).toBe(0);
        expect(report.filesModified).toBe(0);
    });
});

describe('anchor-subject-mismatch (R4/R5)', () => {
    test('R4: reports mismatch when cited lines do not name the subject', () => {
        const tokens = extractSubjectTokens('R4 requires `createDefaultRegistry` to be tested');
        expect(tokens).toContain('createdefaultregistry');
        expect(citedLinesNameSubject(tokens, 'registry defaults are applied')).toBe(false);
    });

    test('R4: matches when the cited lines name the identifier', () => {
        const tokens = extractSubjectTokens('R4 requires `createDefaultRegistry`');
        expect(tokens).toContain('createdefaultregistry');
        expect(citedLinesNameSubject(tokens, 'export function createDefaultRegistry() {')).toBe(true);
    });

    test('R5: tolerates paraphrase — a symbol or heading naming the noun counts', () => {
        const tokens = extractSubjectTokens('R3 — `parseRowOfTokens` returns the row');
        expect(tokens).toContain('parserowoftokens');
        expect(citedLinesNameSubject(tokens, 'function parseRowOfTokens(...)')).toBe(true);
    });

    test('empty subject token set never reports mismatch', () => {
        expect(citedLinesNameSubject([], 'anything at all')).toBe(true);
    });
});

describe('extractPathSubjectTokens (R4, 0625) — Solution change-map subject derivation', () => {
    test('derives identifier tokens from a kebab-case basename', () => {
        expect(extractPathSubjectTokens('apps/cli/src/workflow/mermaid-render.ts')).toEqual(
            expect.arrayContaining(['mermaid', 'render']),
        );
    });

    test('derives a plain basename symbol', () => {
        expect(extractPathSubjectTokens('apps/cli/src/commands/workflow.ts')).toEqual(
            expect.arrayContaining(['workflow']),
        );
    });

    test('drops the extension and short fragments', () => {
        // `ts` is the extension — stripped before tokenization; no 2-char token.
        expect(extractPathSubjectTokens('apps/cli/src/commands/workflow.ts')).not.toContain('ts');
        expect(extractPathSubjectTokens('x/y/a.ts')).toEqual([]);
    });

    test('camelCase basename stays one identifier token (no case splitting)', () => {
        const tokens = extractPathSubjectTokens('packages/app/src/services/taskService.ts');
        expect(tokens).toContain('taskservice');
    });
});
