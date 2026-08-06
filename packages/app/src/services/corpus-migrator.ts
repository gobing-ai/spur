/**
 * Corpus migrator — idempotent normalization pass over legacy task/feature corpora.
 *
 * Authority: design §11 (A17). Pipeline: discover → lenient-parse → transform (M1–M8)
 * → strict-validate → atomic write → report. `--dry-run` produces the full report with
 * zero writes; re-running on migrated corpora is a no-op.
 *
 * This is a standalone module (W0 has no TaskService yet); the `spur task migrate` verb
 * wires it in 0050. Each M-rule is a pure, individually-unit-tested transform.
 *
 * Body sections are **never** rewritten — M-rules touch frontmatter + append-only History
 * only. The transform uses `MarkdownDocument` (0042) for lossless parsing, the 0041 schemas
 * for strict validation, and `atomicWrite` (0044) for safe output.
 */

import { join, relative } from 'node:path';
import { DEFAULT_TASKS_DIR } from '@gobing-ai/spur-config';
import {
    atomicWriteAsync,
    MarkdownDocument,
    type MarkdownDomain,
    normalizeTaskStatus,
    type TaskFrontmatter,
    taskFrontmatterSchema,
} from '@gobing-ai/spur-domain';
import { type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { parse as parseYaml } from 'yaml';

// ── Types ────────────────────────────────────────────────────────────────────

/** Severity for a migration flag. */
export type FlagSeverity = 'info' | 'warning';

/** A single observation about a file during migration. */
export interface MigrationFlag {
    /** M-rule that produced this flag: 'M1'–'M8', or 'validate'. */
    rule: string;
    severity: FlagSeverity;
    message: string;
}

/** Per-file migration result. */
export interface FileReport {
    path: string;
    wbs: string;
    modified: boolean;
    flags: MigrationFlag[];
    validationError?: string;
}

/** Aggregate migration report. */
export interface MigrationReport {
    filesScanned: number;
    filesModified: number;
    filesSkipped: number;
    flags: MigrationFlag[];
    fileReports: FileReport[];
}

/** Options for {@link CorpusMigrator.migrate}. */
export interface MigrateOptions {
    /** Produce the full report but write nothing. */
    dryRun?: boolean;
}

/** Constructor options. */
export interface CorpusMigratorOptions {
    fs: FileSystem;
    /** Corpus directory to scan (default: the config DEFAULT_TASKS_DIR). */
    corpusDir?: string;
    /** Domain kind (default: `task`). */
    domain?: MarkdownDomain;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Priority aliases from the legacy corpora mapped to canonical P0–P3. */
const PRIORITY_MAP: Readonly<Record<string, string>> = {
    p0: 'P0',
    p1: 'P1',
    p2: 'P2',
    p3: 'P3',
    critical: 'P0',
    urgent: 'P0',
    high: 'P1',
    medium: 'P2',
    normal: 'P2',
    low: 'P3',
};

/** Canonical frontmatter field order for deterministic output. */
const FIELD_ORDER = [
    'template',
    'schema_version',
    'name',
    'description',
    'status',
    'type',
    'profile',
    'feature_id',
    'parent_wbs',
    'priority',
    'tags',
    'dependencies',
    'created_at',
    'updated_at',
] as const;

// Keys where `null` is a meaningful value (explicit "no parent" vs field-absent).
// These must round-trip as `null` rather than be dropped by the serializer.
const NULL_PRESERVING_KEYS = new Set(['parent_wbs']);

// ── M-rule transforms (pure functions) ───────────────────────────────────────

/**
 * M1 — Status canon. Alias/case normalize; `Canceled` → `cancelled`.
 * Unknown values fall back to `backlog` (flagged).
 */
export function applyM1(data: Record<string, unknown>, flags: MigrationFlag[]): void {
    const raw = data.status;
    if (typeof raw !== 'string') return;
    try {
        data.status = normalizeTaskStatus(raw);
    } catch {
        flags.push({
            rule: 'M1',
            severity: 'warning',
            message: `Unknown status "${raw}" → defaulted to "backlog"`,
        });
        data.status = 'backlog';
    }
}

/**
 * M2 — Key collapse. `preset`/`profile` → `profile` (profile wins when both present).
 */
export function applyM2(data: Record<string, unknown>): void {
    const preset = data.preset;
    const profile = data.profile;
    if (preset === undefined && profile === undefined) return;
    data.profile = profile ?? preset;
    delete data.preset;
}

/**
 * M3 — Edge rename. `feature-id` → `feature_id`; empty string → key removed.
 *
 * Legacy `F-X.Y.Z` values from the old feature taxonomy don't match the new DD-14
 * pattern (`^[A-Z][1-9]*$`) and cannot be mechanically mapped — they are dropped.
 */
export function applyM3(data: Record<string, unknown>, flags: MigrationFlag[]): void {
    const fid = data['feature-id'];
    if (fid !== undefined) {
        if (fid === '' || fid === null) {
            delete data['feature-id'];
        } else {
            data.feature_id = fid;
            delete data['feature-id'];
        }
    }
    // Also clean empty feature_id
    if (data.feature_id === '' || data.feature_id === null) {
        delete data.feature_id;
    }
    // Drop legacy F-X.Y.Z values that can't satisfy DD-14
    const current = data.feature_id;
    if (typeof current === 'string' && current && !/^[A-Z][1-9]*$/.test(current)) {
        flags.push({
            rule: 'M3',
            severity: 'info',
            message: `Legacy feature-id "${current}" dropped (incompatible with DD-14)`,
        });
        delete data.feature_id;
    }
}

/**
 * M4 — Noise removal. Drop `impl_progress`, `folder`, and `description` when `== name`.
 */
export function applyM4(data: Record<string, unknown>): void {
    delete data.impl_progress;
    delete data.folder;
    // A bare `description:` (no value) round-trips through YAML as `null`; the schema
    // requires a string. Coerce to empty string to preserve the "explicit empty" intent.
    if (data.description === null) {
        data.description = '';
    }
    if (data.description !== undefined && data.name !== undefined && String(data.description) === String(data.name)) {
        delete data.description;
    }
}

/**
 * M5 — Sub-task unification. Three legacy parent conventions → `parent_wbs`.
 *
 * Conventions:
 * 1. `parent_id` key
 * 2. `parent-wbs` or `parent` key
 * 3. Filename-embedded: `0140_0139.A_Description.md` → parent is `0139`
 *
 * Unresolvable values are reported and dropped.
 */
export function applyM5(data: Record<string, unknown>, wbsFromFile: string, flags: MigrationFlag[]): void {
    // Coerce an existing numeric `parent_wbs` (e.g. `90` from a prior tool) to the
    // canonical zero-padded WBS string (`0090`). The schema requires `string | null`.
    if (typeof data.parent_wbs === 'number' && Number.isFinite(data.parent_wbs)) {
        data.parent_wbs = String(data.parent_wbs).padStart(4, '0');
    }

    if (data.parent_wbs !== undefined && data.parent_wbs !== null) return; // already canonical

    let resolved: string | undefined;

    // Convention 1: parent_id
    const parentId = data.parent_id;
    if (typeof parentId === 'string' && parentId.trim()) {
        resolved = parentId.trim();
        delete data.parent_id;
    }

    // Convention 2: parent-wbs / parent
    if (resolved === undefined) {
        for (const key of ['parent-wbs', 'parent']) {
            const val = data[key];
            if (typeof val === 'string' && val.trim()) {
                resolved = val.trim();
                delete data[key];
                break;
            }
        }
    }

    // Convention 3: filename-embedded parent (extracted by caller)
    if (resolved === undefined && wbsFromFile) {
        resolved = wbsFromFile;
    }

    if (resolved !== undefined) {
        if (/^\d{4}$/.test(resolved)) {
            data.parent_wbs = resolved;
        } else {
            flags.push({
                rule: 'M5',
                severity: 'warning',
                message: `Unresolvable parent WBS "${resolved}" — dropped`,
            });
        }
    }
}

/**
 * Extract a filename-embedded parent WBS.
 *
 * Pattern: `0140_0139.A_Description.md` → the segment after the first `_`
 * and before `.` is `0139` — the parent WBS.
 */
export function extractFilenameParent(filename: string): string | undefined {
    const base = filename.replace(/\.md$/, '');
    const parts = base.split('_');
    if (parts.length < 2) return undefined;
    const segment = parts[1];
    if (segment === undefined) return undefined;
    const match = /^(\d{4})\.[A-Z]/.exec(segment);
    return match?.[1];
}

/**
 * M6 — Versioning. Add `schema_version: 1`.
 */
export function applyM6(data: Record<string, unknown>): void {
    if (data.schema_version === undefined) {
        data.schema_version = 1;
    }
}

/**
 * M7 — Timestamp repair. Missing/implausible `updated_at` recovered from git log
 * (fallback: file mtime, flagged).
 *
 * "Implausible" = missing, unparseable, future-dated, or before `created_at`.
 */
export function applyM7(
    data: Record<string, unknown>,
    gitDate: string | null,
    mtime: string | null,
    flags: MigrationFlag[],
): void {
    const updated = data.updated_at;
    const created = data.created_at;

    let needsRepair = false;
    if (typeof updated !== 'string' || !updated.trim()) {
        needsRepair = true;
    } else if (Number.isNaN(Date.parse(updated))) {
        needsRepair = true;
    } else if (Date.parse(updated) > Date.now() + 60_000) {
        needsRepair = true;
    } else if (typeof created === 'string' && !Number.isNaN(Date.parse(created))) {
        if (Date.parse(updated) < Date.parse(created)) {
            needsRepair = true;
        }
    }

    if (!needsRepair) return;

    const recovered = gitDate ?? mtime;
    if (recovered) {
        data.updated_at = recovered;
        if (gitDate === null) {
            flags.push({
                rule: 'M7',
                severity: 'warning',
                message: `updated_at repaired from file mtime (git log unavailable): ${recovered}`,
            });
        } else {
            flags.push({
                rule: 'M7',
                severity: 'info',
                message: `updated_at repaired from git log: ${recovered}`,
            });
        }
    } else {
        flags.push({
            rule: 'M7',
            severity: 'warning',
            message: 'updated_at needs repair but no recovery source available',
        });
    }
}

/**
 * Coerce tags/dependencies from legacy comma-separated string to array.
 * Passes through existing arrays unchanged.
 */
function coerceArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
    }
    return undefined;
}

/**
 * Coerce priority from legacy text values to canonical P0–P3.
 */
function coercePriority(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const key = value.trim().toUpperCase();
    if (/^P[0-3]$/.test(key)) return key;
    return PRIORITY_MAP[value.trim().toLowerCase()];
}

// ── Frontmatter serialization ────────────────────────────────────────────────

/**
 * Serialize a frontmatter data object to a YAML block string.
 *
 * Output is deterministic (canonical field order, consistent quoting) to
 * guarantee idempotency on second run.
 */
export function serializeFrontmatter(data: Record<string, unknown>): string {
    const lines: string[] = ['---'];

    for (const key of FIELD_ORDER) {
        if (!(key in data)) continue;
        const value = data[key];
        if (value === undefined) continue;
        // `null` is dropped except for keys where it's a meaningful explicit value.
        if (value === null && !NULL_PRESERVING_KEYS.has(key)) continue;

        if (value === null) {
            lines.push(`${key}: null`);
        } else if (Array.isArray(value)) {
            if (value.length === 0) {
                // Preserve explicit empty arrays — distinct from field-absent (e.g. `dependencies: []`).
                lines.push(`${key}: []`);
            } else {
                const items = value.map((v) => yamlScalar(v)).join(',');
                lines.push(`${key}: [${items}]`);
            }
        } else if (typeof value !== 'object') {
            // Scalars only. No schema field is object-typed (M4 drops `impl_progress`),
            // so an object here would be a bug upstream — skip rather than emit broken YAML.
            lines.push(`${key}: ${yamlScalar(value)}`);
        }
    }

    lines.push('---');
    lines.push('');
    return lines.join('\n');
}

/** Format a scalar value for YAML output. */
function yamlScalar(value: unknown): string {
    // Numbers (e.g. `schema_version: 1`) emit bare so they re-parse as numbers.
    if (typeof value === 'number') return String(value);

    const str = String(value);
    // Quote strings when YAML would reinterpret them on re-parse:
    // - empty string (bare parses as null)
    // - all-digit (especially leading-zero WBS IDs like `0195` — bare parses as number 195)
    // - YAML 1.1 bool-looking words (yes/no/on/off/true/false/null)
    // - `: ` (colon-space), leading `#`, leading/trailing whitespace (flow-safety)
    // Plain colons in timestamps (T00:00:00) are safe and stay unquoted.
    const looksNumeric = /^\d+$/.test(str);
    const looksBoolish = /^(yes|no|on|off|true|false|null)$/i.test(str);
    if (
        str === '' ||
        looksNumeric ||
        looksBoolish ||
        str.includes(': ') ||
        str.startsWith('#') ||
        str.startsWith(' ') ||
        str.endsWith(' ')
    ) {
        return JSON.stringify(str);
    }
    return str;
}

// ── Git timestamp lookup ─────────────────────────────────────────────────────

/** A bare `%aI` author date, e.g. `2026-07-08T13:25:15-07:00`. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Build a `path → last git author date (ISO 8601)` map for every tracked file
 * under `dir`, in one `git log` walk.
 *
 * One spawn for the whole corpus rather than one per file: at a few hundred
 * tasks the per-file form spent seconds in process startup alone. Commits arrive
 * newest-first, so the first date seen for a path is its last-modified date.
 *
 * Returns an empty map when git is unavailable or nothing is tracked — callers
 * treat a miss the same as the old `null` return.
 */
async function loadGitLastModified(cwd: string, dir: string): Promise<Map<string, string>> {
    try {
        // ProcessExecutor seam (no-direct-process-spawn). Large buffer for full corpus walk.
        const result = await new NodeProcessExecutor().run({
            command: 'git',
            args: ['log', '--format=%aI', '--name-only', '-z', '--', dir],
            cwd,
            maxOutput: 32 * 1024 * 1024,
            forceBuffered: true,
            rejectOnError: false,
        });
        if (result.exitCode !== 0) return new Map();
        return parseGitNameOnlyZ(result.stdout);
    } catch {
        // git unavailable — every lookup misses, same as the old per-file failure.
        return new Map();
    }
}

/**
 * Parse `git log --format=%aI --name-only -z` output into `path → newest date`.
 *
 * Under `-z` the stream is, per commit: the `%aI` date as its own NUL-terminated
 * chunk, then the changed paths as NUL-terminated chunks — where the *first* path
 * carries the newline that separated it from the header. So: strip a leading
 * newline, and treat a bare ISO timestamp (which no corpus path can look like) as
 * the current commit's date. Commits arrive newest-first, so the first date seen
 * for a path is its last-modified date.
 *
 * Exported for tests: the layout is easy to get subtly wrong, and a wrong parse
 * fails silently — every lookup misses and M7 quietly degrades to mtime.
 */
export function parseGitNameOnlyZ(output: string): Map<string, string> {
    const dates = new Map<string, string>();
    let currentDate: string | null = null;
    for (const raw of output.split('\0')) {
        if (raw === '') continue;
        const leadingNewline = raw.startsWith('\n');
        const chunk = leadingNewline ? raw.slice(1) : raw;
        if (chunk === '') continue;
        if (!leadingNewline && ISO_TIMESTAMP_RE.test(chunk)) {
            currentDate = chunk;
            continue;
        }
        if (currentDate === null) continue;
        if (!dates.has(chunk)) dates.set(chunk, currentDate);
    }
    return dates;
}

// ── History seed (M8) ────────────────────────────────────────────────────────

/** ISO date for the migration History stamp. */
function migrationDate(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * M8 — History seed. Append a `### History` (task) or `## History` (feature) migration
 * entry. Never rewrite existing history.
 *
 * @returns the new body with History appended, or the original body if History exists.
 */
export function applyM8(doc: MarkdownDocument, domain: MarkdownDomain, body: string): string {
    if (doc.hasSection('History')) return body;

    const level = domain === 'task' ? '###' : '##';
    const stamp = migrationDate();
    const entry = `\n\n${level} History\n\n- Migrated from legacy format (${stamp})\n`;
    return body.endsWith('\n') ? `${body}${entry}` : `${body}\n${entry}`;
}

// ── Corpus Migrator ──────────────────────────────────────────────────────────

/**
 * Standalone corpus migrator. Discovers `.md` files in the configured corpus directory,
 * applies M1–M8 normalization, validates against the 0041 schema, and writes atomically.
 * @internal — no public CLI surface. Corpus migration is not a shipped product
 * capability (0452 R3). Tests exist for the module's internal logic, but no
 * operator entry point is exposed. Use `mv` or a manual script instead.
 */
export class CorpusMigrator {
    private readonly fs: FileSystem;
    private readonly corpusDir: string;
    private readonly domain: MarkdownDomain;

    constructor(opts: CorpusMigratorOptions) {
        this.fs = opts.fs;
        this.corpusDir = opts.corpusDir ?? DEFAULT_TASKS_DIR;
        this.domain = opts.domain ?? 'task';
        // The M-rule pipeline is task-shaped (M2 profile, M3 feature_id, M5 parent_wbs,
        // task field order) and strict-validates against taskFrontmatterSchema. Feature
        // corpus migration is a separate, unbuilt concern — fail loud rather than
        // silently mis-validate feature files against the task schema.
        if (this.domain !== 'task') {
            throw new Error(
                `CorpusMigrator only supports the 'task' domain; got '${this.domain}'. ` +
                    'Feature corpus migration is not implemented.',
            );
        }
    }

    /**
     * Run the migration pipeline.
     *
     * Pipeline: discover → lenient-parse → transform (M1–M8) → strict-validate →
     * atomic write → report.
     */
    async migrate(opts: MigrateOptions = {}): Promise<MigrationReport> {
        const dryRun = opts.dryRun ?? false;
        const fileReports: FileReport[] = [];
        const allFlags: MigrationFlag[] = [];

        // --- discover ---
        const files = await this.discoverFiles();

        // One git walk for the whole corpus, not one per file (M7 timestamp repair).
        const gitDates = await loadGitLastModified(this.fs.getProjectRoot(), this.corpusDir);

        for (const filePath of files) {
            const report = await this.migrateFile(filePath, dryRun, gitDates);
            fileReports.push(report);
            allFlags.push(...report.flags);
        }

        const filesModified = fileReports.filter((r) => r.modified).length;
        const filesSkipped = fileReports.filter((r) => r.validationError !== undefined).length;

        return {
            filesScanned: files.length,
            filesModified,
            filesSkipped,
            flags: allFlags,
            fileReports,
        };
    }

    /** Discover `.md` files in the corpus directory. */
    private async discoverFiles(): Promise<string[]> {
        const entries = await this.fs.readDir(this.corpusDir);
        return entries
            .filter((name) => name.endsWith('.md'))
            .filter((name) => name !== 'kanban.md')
            .map((name) => join(this.corpusDir, name))
            .sort();
    }

    /** Migrate a single file. `gitDates` maps repo-relative paths to last-commit dates. */
    private async migrateFile(
        filePath: string,
        dryRun: boolean,
        gitDates: Map<string, string> = new Map(),
    ): Promise<FileReport> {
        const flags: MigrationFlag[] = [];
        const filename = filePath.split('/').pop() ?? filePath;
        const wbs = filename.replace(/_.*\.md$/, '').replace(/^0+/, '') || '????';

        // --- lenient-parse ---
        let content: string;
        try {
            content = await this.fs.readFile(filePath);
        } catch {
            return {
                path: filePath,
                wbs,
                modified: false,
                flags: [{ rule: 'validate', severity: 'warning', message: 'File not readable' }],
                validationError: 'unreadable',
            };
        }

        // Check for frontmatter
        const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
        const fmMatch = fmRe.exec(content);
        if (fmMatch === null) {
            // No frontmatter — not a task file, skip
            return {
                path: filePath,
                wbs,
                modified: false,
                flags: [{ rule: 'validate', severity: 'info', message: 'No frontmatter — skipped' }],
            };
        }

        // Parse frontmatter leniently
        const rawYaml = fmMatch[1] ?? '';
        let rawData: Record<string, unknown> = {};
        try {
            const parsed = parseYaml(rawYaml);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                rawData = parsed as Record<string, unknown>;
            }
        } catch {
            // Malformed YAML — can't migrate
            return {
                path: filePath,
                wbs,
                modified: false,
                flags: [{ rule: 'validate', severity: 'warning', message: 'Malformed YAML — skipped' }],
                validationError: 'malformed-yaml',
            };
        }

        // Skip non-task files (e.g. kanban templates with no status/name)
        if (rawData.status === undefined && rawData.name === undefined) {
            return {
                path: filePath,
                wbs,
                modified: false,
                flags: [{ rule: 'validate', severity: 'info', message: 'Not a task file — skipped' }],
            };
        }

        // Parse with MarkdownDocument for body preservation
        const doc = MarkdownDocument.parse(content, this.domain);

        // Deep copy the data for transformation
        const data: Record<string, unknown> = { ...rawData };

        // --- transform (M1–M8) ---
        applyM1(data, flags);
        applyM2(data);
        applyM3(data, flags);
        applyM4(data);
        const filenameParent = extractFilenameParent(filename);
        applyM5(data, filenameParent ?? '', flags);
        applyM6(data);

        // M7: timestamp repair
        const gitDate = gitDates.get(relative(this.fs.getProjectRoot(), filePath)) ?? null;
        const stat = await this.fs.stat(filePath);
        const mtime = stat ? new Date(stat.mtimeMs).toISOString() : null;
        applyM7(data, gitDate, mtime, flags);

        // Coerce tags/dependencies/priority for schema compliance
        const tags = coerceArray(data.tags);
        if (tags !== undefined) data.tags = tags;
        else delete data.tags;

        const deps = coerceArray(data.dependencies);
        if (deps !== undefined) data.dependencies = deps;
        else delete data.dependencies;

        const priority = coercePriority(data.priority);
        if (priority !== undefined) data.priority = priority;
        else delete data.priority;

        // Drop the legacy 'type' if it's not a valid task type
        if (data.type !== undefined && data.type !== 'task' && data.type !== 'brainstorm') {
            delete data.type;
        }
        if (data.type === undefined) data.type = 'task';

        // --- strict-validate ---
        const parseResult = taskFrontmatterSchema.safeParse(data);
        if (!parseResult.success) {
            const errorMsg = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
            flags.push({
                rule: 'validate',
                severity: 'warning',
                message: `Schema validation failed: ${errorMsg}`,
            });
            return {
                path: filePath,
                wbs,
                modified: false,
                flags,
                validationError: errorMsg,
            };
        }

        const validated = parseResult.data as TaskFrontmatter;

        // --- serialize output ---
        const newFrontmatter = serializeFrontmatter(validated as unknown as Record<string, unknown>);

        // Get body (everything after the original frontmatter block)
        const bodyStart = fmMatch[0].length;
        let body = content.slice(bodyStart);

        // M8: append History section if not present
        body = applyM8(doc, this.domain, body);

        const output = `${newFrontmatter}${body}`;

        // Check if content changed
        const modified = output !== content;

        // --- atomic write (temp + fsync + rename, DD-05) ---
        if (modified && !dryRun) {
            await atomicWriteAsync(filePath, output, wbs, this.fs);
        }

        return {
            path: filePath,
            wbs,
            modified,
            flags,
        };
    }
}
