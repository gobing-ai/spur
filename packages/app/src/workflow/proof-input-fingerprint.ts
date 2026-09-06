import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import {
    createNodeFileSystem,
    type FileStat,
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

/**
 * Raised when the isolated git-tree capture fails (read-tree, add, write-tree non-zero, or any
 * thrown git error). Carries the git stderr so the caller can name the failure instead of hashing
 * an empty tree (task 0751 R1 - the capture must fail closed, never yield a sentinel digest input).
 */
export class ProofCaptureError extends Error {
    constructor(
        message: string,
        readonly stderr?: string,
    ) {
        super(message);
        this.name = 'ProofCaptureError';
    }
}

/**
 * Result of validated proof-input spec reads (task 0785 R1).
 *
 * `ok: false` carries an actionable named error; the caller surfaces it instead of producing a
 * digest. `ok: true` carries only the specs that were actually supplied and read — an omitted
 * (`undefined`) or empty (`''`) path stays optional for compatibility, while any nonempty supplied
 * path must resolve to a readable regular file under the workflow workdir or the read fails
 * closed before any digest is computed.
 */
export type ProofInputContents =
    | { ok: true; taskContent?: string; featureContent?: string }
    | { ok: false; error: string };

interface SpecReadOutcome {
    content?: string;
    error?: string;
}

/**
 * Resolve and validate the optional task/feature spec inputs shared by `proof.fingerprint` and
 * bound `run.artifact` (task 0785 R1).
 *
 * The pre-0785 `readOptional` helper treated an explicit missing path like omitted input, so a
 * typo'd spec path silently degraded the digest to tree-only proof. Here only `undefined`/`''`
 * mean omitted; anything else must be a string that resolves (relative paths resolve under the
 * workflow workdir) to a readable regular file. Non-string option values are rejected by name.
 */
export async function readProofInputContents(
    fileSystem: FileSystem,
    workdir: string,
    options: { taskFile?: unknown; featureFile?: unknown },
): Promise<ProofInputContents> {
    for (const name of ['taskFile', 'featureFile'] as const) {
        const value = options[name];
        if (value !== undefined && typeof value !== 'string') {
            return { ok: false, error: `${name} must be a string when supplied (got ${typeof value})` };
        }
    }

    const readOne = async (name: 'taskFile' | 'featureFile'): Promise<SpecReadOutcome> => {
        const raw: string | undefined =
            name === 'taskFile'
                ? (options.taskFile as string | undefined)
                : (options.featureFile as string | undefined);
        // Empty-string compatibility: a caller with no linked feature supplies '' and the spec
        // stays legitimately omitted rather than failing the capture.
        if (raw === undefined || raw === '') return {};
        const workdirAbs = resolve(workdir);
        const resolved = resolve(workdirAbs, raw);
        if (!(resolved === workdirAbs || resolved.startsWith(`${workdirAbs}${sep}`))) {
            return { error: `${name} must resolve under the workflow workdir (${workdirAbs}): ${raw}` };
        }
        let stat: FileStat | null;
        try {
            stat = await fileSystem.stat(resolved);
        } catch (error) {
            return { error: `${name} could not be inspected: ${(error as Error).message}` };
        }
        if (stat === null) {
            return {
                error: `${name} does not exist: ${raw} (resolved ${resolved}) — an explicitly supplied spec must be readable, not silently omitted`,
            };
        }
        if (!stat.isFile()) {
            return { error: `${name} is not a regular file: ${resolved}` };
        }
        try {
            return { content: await fileSystem.readFile(resolved) };
        } catch (error) {
            return { error: `${name} is not readable: ${(error as Error).message}` };
        }
    };

    const task = await readOne('taskFile');
    if (task.error !== undefined) return { ok: false, error: task.error };
    const feature = await readOne('featureFile');
    if (feature.error !== undefined) return { ok: false, error: feature.error };

    return {
        ok: true,
        ...(task.content !== undefined ? { taskContent: task.content } : {}),
        ...(feature.content !== undefined ? { featureContent: feature.content } : {}),
    };
}

/**
 * Corpus paths excluded from the git-tree half of the digest. Task/feature files are TRACKED, so
 * they must be excluded here and folded in separately as normalized spec content — otherwise every
 * pipeline section write would change the digest.
 *
 * `.spur/run*`, `.spur/memory*`, and `.spur/context*` were removed (task 0612): they live under
 * `/.spur/…`, which `.gitignore` already excludes, so naming them added nothing — and it actively
 * broke the tree hash. Naming an ignored path in a pathspec makes `git add` report
 * "The following paths are ignored by one of your .gitignore files" and exit **1**, which
 * `createGitAlternateTree` treated as fatal and answered with `''`. The git-tree component was
 * therefore empty on every call since task 0603, leaving the digest sensitive only to spec content.
 */
const DEFAULT_EXCLUDE_GLOBS = ['docs/tasks*', 'docs/features*'];

/**
 * Computes an isolated git tree hash for the working tree excluding corpus/ephemeral directories.
 * Uses temporary alternate index (`GIT_INDEX_FILE`) without mutating the real index or HEAD.
 *
 * @param cwd - Repository root directory.
 * @param excludeGlobs - Globs to exclude from tree object.
 * @param executor - ProcessExecutor instance.
 * @param fs - FileSystem instance.
 * @returns Git tree SHA-1 hash.
 * @throws ProofCaptureError when any git step fails - never an empty-string sentinel.
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
        if (read.exitCode !== 0)
            throw new ProofCaptureError(`git read-tree HEAD failed with exit code ${read.exitCode}`, read.stderr);

        const excludes = excludeGlobs.map((glob) => `:(exclude)${glob}`);
        const add = await executor.run({ command: 'git', args: ['add', '-A', '--', '.', ...excludes], ...common });
        if (add.exitCode !== 0)
            throw new ProofCaptureError(`git add -A failed with exit code ${add.exitCode}`, add.stderr);

        const tree = await executor.run({ command: 'git', args: ['write-tree'], ...common });
        if (tree.exitCode !== 0)
            throw new ProofCaptureError(`git write-tree failed with exit code ${tree.exitCode}`, tree.stderr);
        return tree.stdout.trim();
    } catch (error) {
        if (error instanceof ProofCaptureError) throw error;
        throw new ProofCaptureError(`git alternate-tree capture threw: ${(error as Error).message}`);
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
 * @throws ProofCaptureError when the git-tree half cannot be captured - no digest is derived from a
 * failed capture (task 0751 R1: an empty string no longer doubles as both "no tree" and "failed").
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
