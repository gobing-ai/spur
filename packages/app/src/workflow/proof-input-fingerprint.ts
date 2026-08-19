import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { canonicalJsonStringify } from './composition-baseline';

/**
 * Normalized task metadata and section content used for proof fingerprinting.
 */
export interface TaskProofData {
    /** Task WBS identifier. */
    wbs?: string;
    /** Task title/name. */
    name?: string;
    /** Owning feature identifier. */
    feature_id?: string;
    /** Declared task dependencies. */
    depends_on?: string[];
    /** Normalized section markdown bodies. */
    sections: Record<string, string>;
}

/**
 * Normalized feature metadata and section content used for proof fingerprinting.
 */
export interface FeatureProofData {
    /** Feature identifier. */
    id?: string;
    /** Feature title/name. */
    name?: string;
    /** Normalized section markdown bodies. */
    sections: Record<string, string>;
}

/**
 * Options configuring proof input fingerprint computation.
 */
export interface ComputeProofInputOptions {
    /** Working directory of git repository. */
    cwd?: string;
    /** Raw markdown content of the task file. */
    taskContent?: string;
    /** Raw markdown content of the feature file. */
    featureContent?: string;
    /** Corpus and ephemeral path globs excluded from the git tree hash. */
    excludeGlobs?: string[];
    /** ProcessExecutor abstraction. */
    processExecutor?: ProcessExecutor;
    /** FileSystem abstraction. */
    fileSystem?: FileSystem;
}

const DEFAULT_EXCLUDE_GLOBS = ['docs/tasks*', 'docs/features*', '.spur/run*', '.spur/memory*', '.spur/context*'];

/**
 * Computes an isolated git tree hash for the working tree excluding corpus/ephemeral directories.
 * Uses temporary alternate index (`GIT_INDEX_FILE`) without mutating the real index or HEAD.
 *
 * @param cwd - Repository root directory.
 * @param excludeGlobs - Globs to exclude from tree object.
 * @param executor - ProcessExecutor instance.
 * @param fs - FileSystem instance.
 * @returns Git tree SHA-1 hash or empty string on error.
 */
export async function createGitAlternateTree(
    cwd: string,
    excludeGlobs: string[] = DEFAULT_EXCLUDE_GLOBS,
    executor: ProcessExecutor = new NodeProcessExecutor(),
    fs: FileSystem = createNodeFileSystem(),
): Promise<string> {
    const indexFile = join(tmpdir(), `spur-proof-fingerprint-${crypto.randomUUID()}.index`);
    try {
        await fs.ensureDir(dirname(indexFile));
        const env = Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        );
        env.GIT_INDEX_FILE = indexFile;
        const common = { cwd, env, forceBuffered: true, rejectOnError: false } as const;

        const read = await executor.run({ command: 'git', args: ['read-tree', 'HEAD'], ...common });
        if (read.exitCode !== 0) return '';

        const excludes = excludeGlobs.map((glob) => `:(exclude)${glob}`);
        const add = await executor.run({ command: 'git', args: ['add', '-A', '--', '.', ...excludes], ...common });
        if (add.exitCode !== 0) return '';

        const tree = await executor.run({ command: 'git', args: ['write-tree'], ...common });
        if (tree.exitCode !== 0) return '';
        return tree.stdout.trim();
    } catch {
        return '';
    } finally {
        if (await fs.exists(indexFile)) {
            try {
                await fs.deleteFile(indexFile);
            } catch {
                // best-effort cleanup
            }
        }
    }
}

/**
 * Parses and normalizes task frontmatter and specification sections for proof computation.
 *
 * @param content - Raw task markdown content.
 * @returns Normalized task proof data.
 */
export function extractTaskProofData(content: string): TaskProofData {
    const doc = MarkdownDocument.parse(content, 'task');
    const fm = doc.frontmatterData ?? {};

    const wbs = typeof fm.wbs === 'string' ? fm.wbs : undefined;
    const name = typeof fm.name === 'string' ? fm.name : undefined;
    const feature_id = typeof fm.feature_id === 'string' ? fm.feature_id : undefined;

    let depends_on: string[] | undefined;
    if (Array.isArray(fm.depends_on)) {
        depends_on = fm.depends_on.filter((d): d is string => typeof d === 'string');
    } else if (Array.isArray(fm.dependencies)) {
        depends_on = fm.dependencies.filter((d): d is string => typeof d === 'string');
    }

    const sections: Record<string, string> = {};
    const taskSections = ['Background', 'Requirements', 'Acceptance Criteria', 'Design', 'Plan'];
    for (const sec of taskSections) {
        if (doc.hasSection(sec)) {
            const body = doc.getSection(sec);
            if (body !== null) {
                sections[sec] = body.trim();
            }
        }
    }

    return {
        ...(wbs !== undefined ? { wbs } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(feature_id !== undefined ? { feature_id } : {}),
        ...(depends_on !== undefined ? { depends_on } : {}),
        sections,
    };
}

/**
 * Parses and normalizes feature frontmatter and specification sections for proof computation.
 *
 * @param content - Raw feature markdown content.
 * @returns Normalized feature proof data.
 */
export function extractFeatureProofData(content: string): FeatureProofData {
    const doc = MarkdownDocument.parse(content, 'feature');
    const fm = doc.frontmatterData ?? {};

    const id = typeof fm.id === 'string' ? fm.id : undefined;
    const name = typeof fm.name === 'string' ? fm.name : undefined;

    const sections: Record<string, string> = {};
    const featureSections = ['Goal', 'Scope', 'Acceptance Criteria'];
    for (const sec of featureSections) {
        if (doc.hasSection(sec)) {
            const body = doc.getSection(sec);
            if (body !== null) {
                sections[sec] = body.trim();
            }
        }
    }

    return {
        ...(id !== undefined ? { id } : {}),
        ...(name !== undefined ? { name } : {}),
        sections,
    };
}

/**
 * Computes canonical composite SHA-256 fingerprint over git working tree, task spec, and feature spec.
 *
 * @param options - Fingerprint options including optional task/feature contents and custom excludes.
 * @returns Composite SHA-256 fingerprint string (`sha256:<hex>`).
 */
export async function computeProofInputFingerprint(options: ComputeProofInputOptions = {}): Promise<string> {
    const cwd = options.cwd ?? process.cwd();
    const gitTree = await createGitAlternateTree(
        cwd,
        options.excludeGlobs ?? DEFAULT_EXCLUDE_GLOBS,
        options.processExecutor,
        options.fileSystem,
    );

    let task: TaskProofData | undefined;
    if (options.taskContent !== undefined) {
        task = extractTaskProofData(options.taskContent);
    }

    let feature: FeatureProofData | undefined;
    if (options.featureContent !== undefined) {
        feature = extractFeatureProofData(options.featureContent);
    }

    const canonical = canonicalJsonStringify({
        gitTree,
        ...(task !== undefined ? { task } : {}),
        ...(feature !== undefined ? { feature } : {}),
    });

    const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    return `sha256:${hash}`;
}

/**
 * Proof input fingerprint namespace.
 */
export const ProofInputFingerprint = {
    compute: computeProofInputFingerprint,
};
