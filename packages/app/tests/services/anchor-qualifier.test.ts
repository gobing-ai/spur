import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import {
    anchorQualify,
    buildTrackedBasenameIndex,
    normalizeDoneReason,
    qualifyAnchors,
    qualifySectionBody,
    resolveConfiguredTaskDirs,
    resolveRepoRoot,
} from '../../src/services/anchor-qualifier';
import { citedLinesNameSubject, extractSubjectTokens } from '../../src/services/task-check';

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
        // 0713 R3b: assert the git toplevel, not `process.cwd()` — they coincide only when the
        // suite is launched from the repo root, which made this test cwd-dependent.
        const toplevel = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd: process.cwd() })
            .stdout.toString()
            .trim();
        const root = await resolveRepoRoot(undefined);
        expect(root).toBe(toplevel);
    });

    test('R4: hint resolves the target project root when cwd is outside the project', async () => {
        const outer = mkdtempSync(join(tmpdir(), 'spur-r4-'));
        Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: outer });
        const nested = join(outer, 'docs', 'tasks');
        mkdirSync(nested, { recursive: true });
        const prevCwd = process.cwd();
        try {
            process.chdir(tmpdir());
            const root = await resolveRepoRoot(undefined, nested);
            expect(root).toBe(realpathSync(outer));
        } finally {
            process.chdir(prevCwd);
            rmSync(outer, { recursive: true, force: true });
        }
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

describe('normalizeDoneReason (1089 R3)', () => {
    test('rewrites a worktree-absolute artifact reference to its repo-relative form', () => {
        expect(
            normalizeDoneReason(
                'unforced close; PASS artifact at /Users/someone/xprojects/spur-new-run-1049-e7e0/.spur/memory/evidence/1049-verdict.json',
            ),
        ).toBe('unforced close; PASS artifact at .spur/memory/evidence/1049-verdict.json');
    });

    test('is idempotent — an already-relative reason is not a rewrite', () => {
        expect(normalizeDoneReason('unforced close; PASS artifact at .spur/run/1046-verdict.json')).toBeNull();
    });

    test('leaves operator rationale and non-.spur absolute paths untouched', () => {
        expect(normalizeDoneReason('operator emergency close')).toBeNull();
        expect(normalizeDoneReason('Verified with 23 passing tests')).toBeNull();
        expect(normalizeDoneReason('unforced close; PASS artifact at /var/tmp/elsewhere/1049-verdict.json')).toBeNull();
    });
});

describe('done_reason normalization in the qualification pass (1089 R3)', () => {
    const ABSOLUTE_REASON =
        'unforced close; PASS artifact at /Users/someone/xprojects/spur-new-run-1049-e7e0/.spur/memory/evidence/1049-verdict.json';
    const RELATIVE_REASON = 'unforced close; PASS artifact at .spur/memory/evidence/1049-verdict.json';

    interface FieldWrite {
        filePath: string;
        wbs: string;
        key: string;
        value: string;
    }

    /** Two done tasks: one absolute reason (drift), one free-form (operator text). */
    function mockFs(opts: { drifted?: boolean; anchor?: string } = {}): FileSystem {
        const drifted = opts.drifted ?? true;
        const testing = opts.anchor === undefined ? '`bun test` — green' : `Evidence: \`${opts.anchor}\``;
        const files: Record<string, string> = {
            '/mock/docs/tasks/1049_task.md': `---
wbs: "1049"
name: "Worktree close"
status: done
done_reason: "${drifted ? ABSOLUTE_REASON : RELATIVE_REASON}"
---

## 1049. Worktree close

### Testing

${testing}
`,
            '/mock/docs/tasks/1046_task.md': `---
wbs: "1046"
name: "Inline close"
status: done
done_reason: "Verified with 23 passing tests"
---

## 1046. Inline close

### Testing

\`bun test\` — green
`,
        };
        return {
            resolve: (p: string) => p,
            cwd: () => '/mock',
            readDir: async (dir: string) => {
                if (dir === '/mock/docs/tasks') return ['1049_task.md', '1046_task.md'];
                throw new Error('Directory not found');
            },
            readFile: async (p: string) => {
                const content = files[p];
                if (content !== undefined) return content;
                throw new Error(`File not found: ${p}`);
            },
        } as unknown as FileSystem;
    }

    test('dry-run reports the rewrite and writes nothing', async () => {
        const writes: FieldWrite[] = [];
        const report = await qualifyAnchors(mockFs(), {
            fs: mockFs(),
            dryRun: true,
            taskDirs: ['/mock/docs/tasks'],
            projectRoot: process.cwd(),
            writeField: async (filePath, wbs, key, value) => {
                writes.push({ filePath, wbs, key, value });
            },
        });
        const entry = report.fileReports.find((r) => r.wbs === '1049');
        expect(entry?.doneReasons).toEqual([{ from: ABSOLUTE_REASON, to: RELATIVE_REASON }]);
        expect(entry?.modified).toBe(true);
        expect(writes).toHaveLength(0);
        // A free-form reason is operator text, not corpus drift — never reported.
        expect(report.fileReports.some((r) => r.wbs === '1046')).toBe(false);
    });

    test('apply writes the normalized reason through the frontmatter writer', async () => {
        const writes: FieldWrite[] = [];
        const report = await qualifyAnchors(mockFs(), {
            fs: mockFs(),
            dryRun: false,
            taskDirs: ['/mock/docs/tasks'],
            projectRoot: process.cwd(),
            writeField: async (filePath, wbs, key, value) => {
                writes.push({ filePath, wbs, key, value });
            },
        });
        expect(writes).toEqual([
            {
                filePath: '/mock/docs/tasks/1049_task.md',
                wbs: '1049',
                key: 'done_reason',
                value: RELATIVE_REASON,
            },
        ]);
        expect(report.filesModified).toBe(1);
    });

    test('an already-relative reason is not rewritten on apply', async () => {
        const writes: FieldWrite[] = [];
        const report = await qualifyAnchors(mockFs({ drifted: false }), {
            fs: mockFs({ drifted: false }),
            dryRun: false,
            taskDirs: ['/mock/docs/tasks'],
            projectRoot: process.cwd(),
            writeField: async (filePath, wbs, key, value) => {
                writes.push({ filePath, wbs, key, value });
            },
        });
        expect(writes).toHaveLength(0);
        expect(report.filesModified).toBe(0);
    });

    test('an unwritable task reports the skip and never attempts the reason write', async () => {
        const writes: FieldWrite[] = [];
        // The Testing anchor is what makes the section writer run — and throw.
        const report = await qualifyAnchors(mockFs({ anchor: 'project-registry.ts:42' }), {
            fs: mockFs({ anchor: 'project-registry.ts:42' }),
            dryRun: false,
            taskDirs: ['/mock/docs/tasks'],
            projectRoot: process.cwd(),
            write: async () => {
                throw new Error('schema predates the current frontmatter');
            },
            writeField: async (filePath, wbs, key, value) => {
                writes.push({ filePath, wbs, key, value });
            },
        });
        const entry = report.fileReports.find((r) => r.wbs === '1049');
        expect(entry?.skipped).toContain('schema predates');
        expect(entry?.modified).toBe(false);
        expect(entry?.doneReasons).toEqual([]);
        expect(writes).toHaveLength(0);
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
