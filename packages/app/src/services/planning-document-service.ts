import { basename, join } from 'node:path';
import type { DesignFileSummary, PlanFileSummary } from '@gobing-ai/spur-contracts';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/**
 * PlanningDocumentService — one application owner for the plan/design document reads
 * (task 1300). The raw Hono handlers in the health module and the oRPC procedures both
 * delegate here, so the path allowlists, the directory walk and the title derivation exist
 * once instead of in two drifting copies.
 *
 * Only reads live here: plans and designs have no mutation surface on the Board.
 */

/** Why a document read failed. Each code maps to one HTTP status on every transport. */
export type PlanningDocumentErrorCode = 'unavailable' | 'missing-path' | 'denied' | 'not-found' | 'read-failed';

/** Thrown for every refusal so the raw alias and the oRPC procedure agree on the cause. */
export class PlanningDocumentError extends Error {
    readonly code: PlanningDocumentErrorCode;

    constructor(code: PlanningDocumentErrorCode, message: string) {
        super(message);
        this.name = 'PlanningDocumentError';
        this.code = code;
    }
}

/** One read document: the pre-contract success payload, unchanged. */
export interface PlanningDocument {
    ok: true;
    path: string;
    title: string;
    content: string;
}

/** Filesystem access the reads need; the server context supplies it. */
export interface PlanningDocumentContext {
    fs?: FileSystem;
    cwd?: string;
}

const PLAN_FILES = {
    roadmap: 'docs/02_ROADMAP.md',
    plansDir: 'docs/plans',
} as const;

const DESIGN_FILES = {
    root: 'DESIGN.md',
    architecture: 'docs/04_DESIGN.md',
    designsDir: 'docs/design',
} as const;

const PLAN_PATH_RE = /^docs\/plans\/[a-zA-Z0-9_.-]+\.md$/;
const DESIGN_PATH_RE = /^docs\/design\/[a-zA-Z0-9_-]+\.md$/;

/** Title from the document's first H1, falling back to a de-slugged filename. */
function deriveTitle(content: string, reqPath: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    if (match?.[1]) return match[1].trim();
    const name = basename(reqPath, '.md');
    return name === '02_ROADMAP' ? 'Roadmap' : name.replace(/-/g, ' ');
}

/** Reads plan and design documents for both transports; constructed per call from the context. */
export class PlanningDocumentService {
    constructor(private readonly ctx: PlanningDocumentContext) {}

    private requireFs(): { fs: FileSystem; projectRoot: string } {
        if (!this.ctx.fs) throw new PlanningDocumentError('unavailable', 'ServerContext unavailable');
        return { fs: this.ctx.fs, projectRoot: this.ctx.cwd ?? process.cwd() };
    }

    /** All registered plan documents, roadmap first. An absent plans directory is an empty list. */
    async listPlans(): Promise<{ files: PlanFileSummary[]; total: number }> {
        let fs: FileSystem;
        let projectRoot: string;
        try {
            ({ fs, projectRoot } = this.requireFs());
        } catch {
            return { files: [], total: 0 };
        }
        const files: PlanFileSummary[] = [];
        const roadmap = await this.summary(fs, projectRoot, PLAN_FILES.roadmap, '02_ROADMAP.md');
        if (roadmap !== null) files.push({ ...roadmap, category: 'roadmap' });
        for (const row of await this.listDir(fs, projectRoot, PLAN_FILES.plansDir, 'desc')) {
            files.push({ ...row, category: 'plan' });
        }
        return { files, total: files.length };
    }

    /** All registered design documents, root and architecture first. */
    async listDesigns(): Promise<{ files: DesignFileSummary[]; total: number }> {
        let fs: FileSystem;
        let projectRoot: string;
        try {
            ({ fs, projectRoot } = this.requireFs());
        } catch {
            return { files: [], total: 0 };
        }
        const files: DesignFileSummary[] = [];
        const root = await this.summary(fs, projectRoot, DESIGN_FILES.root, 'DESIGN.md');
        if (root !== null) files.push({ ...root, category: 'root' });
        const architecture = await this.summary(fs, projectRoot, DESIGN_FILES.architecture, '04_DESIGN.md');
        if (architecture !== null) files.push({ ...architecture, category: 'architecture' });
        for (const row of await this.listDir(fs, projectRoot, DESIGN_FILES.designsDir, 'asc')) {
            files.push({ ...row, category: 'satellite' });
        }
        return { files, total: files.length };
    }

    /** Read one plan document. The allowlist and the 404 stay exactly as they were. */
    async showPlan(reqPath: string | undefined): Promise<PlanningDocument> {
        return this.read(reqPath, (path) => path === PLAN_FILES.roadmap || PLAN_PATH_RE.test(path));
    }

    /** Read one design document. The allowlist and the 404 stay exactly as they were. */
    async showDesign(reqPath: string | undefined): Promise<PlanningDocument> {
        return this.read(
            reqPath,
            (path) => path === DESIGN_FILES.root || path === DESIGN_FILES.architecture || DESIGN_PATH_RE.test(path),
        );
    }

    private async read(reqPath: string | undefined, allowed: (path: string) => boolean): Promise<PlanningDocument> {
        const { fs, projectRoot } = this.requireFs();
        if (!reqPath) throw new PlanningDocumentError('missing-path', 'Missing path query parameter');
        if (!allowed(reqPath)) {
            throw new PlanningDocumentError('denied', 'Access denied: path not allowed');
        }
        const fullPath = join(projectRoot, reqPath);
        if (!(await fs.exists(fullPath))) throw new PlanningDocumentError('not-found', 'File not found');
        try {
            const content = await fs.readFile(fullPath);
            return { ok: true, path: reqPath, title: deriveTitle(content, reqPath), content };
        } catch (error) {
            throw new PlanningDocumentError('read-failed', error instanceof Error ? error.message : String(error));
        }
    }

    /** Directory listing shared by both kinds; a missing or unreadable directory is empty. */
    private async listDir(
        fs: FileSystem,
        projectRoot: string,
        dir: string,
        order: 'asc' | 'desc',
    ): Promise<Array<{ id: string; path: string; name: string; title: string }>> {
        const out: Array<{ id: string; path: string; name: string; title: string }> = [];
        let names: string[];
        try {
            names = await fs.readDir(join(projectRoot, dir));
        } catch {
            return out;
        }
        // Per-kind order preserved from the pre-contract surfaces: plans list newest-first,
        // design satellites alphabetically.
        const ordered = names.sort();
        for (const name of order === 'desc' ? ordered.reverse() : ordered) {
            if (!name.endsWith('.md')) continue;
            const summary = await this.summary(fs, projectRoot, `${dir}/${name}`, name);
            if (summary !== null) out.push(summary);
        }
        return out;
    }

    /** One list row; an unreadable file still lists with its filename-derived title. */
    private async summary(
        fs: FileSystem,
        projectRoot: string,
        relPath: string,
        name: string,
    ): Promise<{ id: string; path: string; name: string; title: string } | null> {
        const fullPath = join(projectRoot, relPath);
        if (!(await fs.exists(fullPath))) return null;
        let title = name.replace(/\.md$/, '').replace(/-/g, ' ');
        try {
            title = deriveTitle(await fs.readFile(fullPath), relPath);
        } catch {
            // Listed with its filename-derived title rather than dropped.
        }
        return { id: relPath, path: relPath, name, title };
    }
}
