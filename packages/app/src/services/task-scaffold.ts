/**
 * TaskScaffoldService — generate BDD test stubs from task Acceptance Criteria.
 *
 * Implements R1–R5 (0320):
 * - Reads task Acceptance Criteria section.
 * - Generates pending test stubs (test.todo) with Given/When/Then comments.
 * - Merges idempotently into target test file.
 * - Reports counts (created, skipped, drifted) for CLI --json.
 */

import { dirname } from 'node:path';
import { MarkdownDocument, mergeStubs, scaffoldFeatureScenarios } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/** Options for task test scaffolding. */
export interface TaskScaffoldOptions {
    /** Custom target test file path override */
    targetFile?: string;
}

/** Result of a task test scaffolding operation. */
export interface TaskScaffoldResult {
    /** Task WBS identifier */
    wbs: string;
    /** Path to target test file */
    targetFile: string;
    /** Number of new stubs created */
    created: number;
    /** Number of existing stubs skipped */
    skipped: number;
    /** Number of scenarios missing from AC (drifted) */
    drifted: number;
    /** Titles of drifted scenarios */
    driftedScenarios: string[];
    /** Operational warnings */
    warnings: string[];
}

/** Context dependencies required by TaskScaffoldService. */
export interface TaskScaffoldContext {
    /** FileSystem instance */
    fs: FileSystem;
    /** Base tasks directory */
    tasksDir: string;
    /** Optional folders configuration */
    foldersConfig?: { folders: Record<string, unknown> };
}

/** Application service for generating BDD test stubs from task Acceptance Criteria. */
export class TaskScaffoldService {
    constructor(private ctx: TaskScaffoldContext) {}

    async scaffoldTests(wbs: string, options?: TaskScaffoldOptions): Promise<TaskScaffoldResult> {
        const taskPath = await this.findTaskFile(wbs);
        if (!taskPath) {
            throw new Error(`Task ${wbs} not found`);
        }

        const rawTask = await this.ctx.fs.readFile(taskPath);
        const doc = MarkdownDocument.parse(rawTask, 'task');
        let acContent = doc.getSection('Acceptance Criteria') ?? '';
        if (!acContent.trim() && doc.bodyWithoutFrontmatter.includes('Acceptance Criteria')) {
            const match = doc.bodyWithoutFrontmatter.match(/#+\s+Acceptance Criteria\s*\n([\s\S]*?)(?=\n#+|$)/i);
            if (match) {
                acContent = match[1] ?? '';
            }
        }

        const stubs = scaffoldFeatureScenarios(acContent);
        const targetFile = options?.targetFile ?? this.resolveDefaultTestPath(wbs);

        if (stubs.length === 0) {
            return {
                wbs,
                targetFile,
                created: 0,
                skipped: 0,
                drifted: 0,
                driftedScenarios: [],
                warnings: [`Task ${wbs} has no Gherkin Acceptance Criteria scenarios.`],
            };
        }

        let existingContent = '';
        let fileExists = false;

        try {
            existingContent = await this.ctx.fs.readFile(targetFile);
            fileExists = true;
        } catch {
            fileExists = false;
        }

        const mergeResult = mergeStubs(existingContent, stubs);

        const dir = dirname(targetFile);
        await this.ctx.fs.ensureDir(dir);

        if (mergeResult.created > 0 || !fileExists) {
            await this.ctx.fs.writeFile(targetFile, mergeResult.content);
        }

        const warnings: string[] = [];
        if (mergeResult.drifted > 0) {
            warnings.push(
                `Task ${wbs} AC removed ${mergeResult.drifted} scenario(s) present in existing stub file: ${mergeResult.driftedScenarios.join(', ')}`,
            );
        }

        return {
            wbs,
            targetFile,
            created: mergeResult.created,
            skipped: mergeResult.skipped,
            drifted: mergeResult.drifted,
            driftedScenarios: mergeResult.driftedScenarios,
            warnings,
        };
    }

    private async findTaskFile(wbs: string): Promise<string | null> {
        const dirs = this.allFolderDirs();
        for (const dir of dirs) {
            try {
                const entries = await this.ctx.fs.readDir(dir);
                for (const name of entries) {
                    if (name.startsWith(`${wbs}_`) && name.endsWith('.md')) {
                        return `${dir}/${name}`;
                    }
                }
            } catch {}
        }
        return null;
    }

    private allFolderDirs(): string[] {
        const folderKeys = this.ctx.foldersConfig ? Object.keys(this.ctx.foldersConfig.folders) : [];
        const dirs = [this.ctx.tasksDir, ...folderKeys.map((key) => this.ctx.fs.resolve(key))];
        return [...new Set(dirs)];
    }

    private resolveDefaultTestPath(wbs: string): string {
        return this.ctx.fs.resolve(`tests/tasks/${wbs}.test.ts`);
    }
}
