import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    applyCliMigrations,
    CLI_MIGRATIONS,
    HISTORY_DIMENSION_MARTS_SCHEMA_SQL,
    loadSqlMigrations,
    RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL,
    splitSqlStatements,
} from '../../src/migrations';

/**
 * Task 1311 — evidence only. Released SQL stays as it is. This fixture compares the
 * embedded 0037 constant with the tracked drizzle file, replays offline upgrade fixtures,
 * and writes the go/no-go artifact from that measurement.
 */

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const REPORT_JSON = resolve(REPO_ROOT, 'docs/reports/1311-migration-ownership.json');
const REPORT_MD = resolve(REPO_ROOT, 'docs/reports/1311-migration-ownership.md');
const PROOF_JSON = resolve(REPO_ROOT, '.spur/run/1311-migration-ownership.json');
const PROOF_JUNIT = resolve(REPO_ROOT, '.spur/run/1311-migration-ownership.junit.xml');
const COMMAND = [
    'rm -f docs/reports/1311-migration-ownership.json docs/reports/1311-migration-ownership.md',
    'cd packages/domain && bun test tests/dao/migration-ownership.test.ts',
].join(' && ');
const CANDIDATE_ID = '0037_spur_cli_history_dimension_marts';
const CANDIDATE_FILE = 'drizzle/0037_spur_cli_history_dimension_marts.sql';
const FIXTURE_SEED = {
    id: '1311-offline-upgrade-v1',
    candidateId: CANDIDATE_ID,
    expectedCount: 55,
    expectedRange: '0000..0054',
    previousReleaseThrough: '0036_spur_cli_history_rollup_watermark',
    duplicateColumn: '0007_spur_cli_runs_external_key',
    absentColumn: '0007_spur_cli_runs_external_key',
    phenomena: ['fresh', 'previous-release', 'already-applied', 'interrupted', 'duplicate-column', 'absent-column'],
} as const;

const DEPENDENCY_PATHS = [
    'package.json',
    'bun.lock',
    'packages/domain/package.json',
    'packages/app/package.json',
    'apps/cli/package.json',
] as const;

const RELEASED_SQL_PATHS = ['drizzle', 'packages/domain/src/migrations.ts'] as const;

type Status = 'go' | 'no-go' | 'inconclusive';

interface GuardRef {
    id: string;
    table: string;
    column: string;
}

interface MirrorRow {
    id: string;
    tracked: boolean;
    exactEqual: boolean | null;
    normalizedEqual: boolean | null;
    disposition: 'candidate' | 'inventory-only';
}

interface FixtureCase {
    id: string;
    pass: boolean;
    detail: string;
}

interface OwnershipDecisionInput {
    measurable: boolean;
    idsMatchReleased: boolean;
    semanticEqual: boolean;
    schemaEqual: boolean;
    releasedSqlUnchanged: boolean;
    dependencyUnchanged: boolean;
    guardCasesPass: boolean;
    offlinePass: boolean;
}

interface OwnershipReport {
    schemaVersion: 1;
    candidate: '0037-dimension-marts';
    status: Status;
    reason: string;
    ids: {
        count: number;
        first: string;
        last: string;
        contiguousFrom0000: boolean;
        order: string[];
        guards: GuardRef[];
    };
    hashes: {
        auditOnly: true;
        journalColumns: ['id', 'applied_at'];
        embedded0037: string;
        tracked0037: string;
        normalizedEmbedded0037: string;
        normalizedTracked0037: string;
    };
    semanticParity: {
        normalizedEqual: boolean;
        schemaEqual: boolean;
        method: 'sql-comment-and-whitespace';
    };
    guardParity: {
        preserved: boolean;
        cases: FixtureCase[];
    };
    offlineProof: {
        pass: boolean;
        bundlePath: 'apps/cli/spur.js';
        bundleDigest: string;
        exitCode: number | null;
        reportedApplied: number | null;
        cwdHadDrizzle: boolean;
        cwdHadRepositorySource: boolean;
        journalColumns: string[];
        embeddedIdsPresent: number;
        importerLedgerPresent: boolean;
    };
    mirrors: {
        trackedCount: number;
        embeddedOnly: string[];
        normalizedMismatch: string[];
        disposition: 'inventory-only; no other mirror is proposed in this slice';
        rows: MirrorRow[];
    };
    provenance: {
        bun: string;
        sqlite: string;
        domainPackage: string;
        cliPackage: string;
        dependencyPaths: string[];
        releasedSqlPaths: string[];
    };
    sourceRevision: string;
    sourceDigests: Record<string, string>;
    fixtureSeed: typeof FIXTURE_SEED;
    command: string;
    measuredAt: string;
}

/** Strip SQL comments and collapse whitespace. Quoted strings and identifiers stay intact. */
export function normalizeMigrationSql(sql: string): string {
    const out: string[] = [];
    let i = 0;
    let pendingSpace = false;
    const flush = (text: string): void => {
        if (text.length === 0) return;
        if (pendingSpace && out.length > 0) out.push(' ');
        pendingSpace = false;
        out.push(text);
    };
    const markSpace = (): void => {
        if (out.length > 0) pendingSpace = true;
    };
    while (i < sql.length) {
        const current = sql[i] ?? '';
        const next = sql[i + 1];
        if (current === "'" || current === '"') {
            const quote = current;
            const start = i;
            i += 1;
            while (i < sql.length) {
                if (sql[i] === quote) {
                    if (sql[i + 1] === quote) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            flush(sql.slice(start, i));
            continue;
        }
        if (current === '-' && next === '-') {
            while (i < sql.length && sql[i] !== '\n') i += 1;
            markSpace();
            continue;
        }
        if (current === '/' && next === '*') {
            i += 2;
            while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
            i = Math.min(sql.length, i + 2);
            markSpace();
            continue;
        }
        if (current === ' ' || current === '\n' || current === '\t' || current === '\r' || current === '\f') {
            markSpace();
            i += 1;
            continue;
        }
        flush(current);
        i += 1;
    }
    return out.join('').trim();
}

/** Decide go, no-go, or inconclusive. A missing measurement is not a no-go. */
export function decideMigrationOwnership(input: OwnershipDecisionInput): { status: Status; reason: string } {
    if (!input.measurable) {
        return {
            status: 'inconclusive',
            reason: 'A required source, digest, or source-free bundle measurement is missing, so consolidation is not decided. Leave 1312 blocked.',
        };
    }
    if (!input.idsMatchReleased) {
        return {
            status: 'no-go',
            reason: 'Embedded migration ids are not the contiguous released set 0000..0054. Leave 1312 blocked.',
        };
    }
    if (!input.semanticEqual || !input.schemaEqual) {
        return {
            status: 'no-go',
            reason: '0037 tracked SQL is not semantically equivalent to HISTORY_DIMENSION_MARTS_SCHEMA_SQL. Leave 1312 blocked.',
        };
    }
    if (!input.releasedSqlUnchanged) {
        return {
            status: 'no-go',
            reason: 'Released migration SQL is dirty in this tree. Leave 1312 blocked.',
        };
    }
    if (!input.dependencyUnchanged) {
        return {
            status: 'no-go',
            reason: 'An upstream package manifest changed. Leave 1312 blocked.',
        };
    }
    if (!input.guardCasesPass || !input.offlinePass) {
        return {
            status: 'no-go',
            reason: 'Offline startup or column-guard fixtures did not preserve current behavior. Leave 1312 blocked.',
        };
    }
    return {
        status: 'go',
        reason: '0037 tracked SQL matches the embedded constant after comment and whitespace normalization, and the applied schema matches. Released SQL bytes were not rewritten. Fresh, previous-release, already-applied, interrupted, duplicate-column, and absent-column fixtures kept the current guards. The bundled CLI migrated a directory with no drizzle folder and no repository source. Audit SHA-256 values are evidence only; the runtime journal stores id and applied_at, not checksums. Other SQL mirrors are inventoried and not proposed. No package dependency changed. 1312 may consume this artifact; this task does not generate SQL.',
    };
}

function sha256(bytes: string | Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function digestFile(path: string): string {
    return sha256(readFileSync(resolve(REPO_ROOT, path)));
}

function gitHead(): string {
    const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error('git rev-parse HEAD failed');
    return result.stdout.toString().trim();
}

function porcelain(pathspec: readonly string[]): string[] {
    const result = Bun.spawnSync(['git', 'status', '--porcelain', '--', ...pathspec], {
        cwd: REPO_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (result.exitCode !== 0) throw new Error(`git status failed for ${pathspec.join(' ')}`);
    return result.stdout
        .toString()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function packageVersion(path: string): string {
    const parsed = JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8')) as { version?: string };
    return parsed.version ?? '';
}

async function openMemory(): Promise<DbAdapter> {
    return createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
}

async function masterSql(adapter: DbAdapter, names: readonly string[]): Promise<string[]> {
    const rows = await adapter.queryAll<{ name: string; sql: string | null }>(
        "SELECT name, sql FROM sqlite_master WHERE name IN ('history_board_dimension_daily', 'history_board_kpi_window', 'idx_history_board_dimension_daily_day') ORDER BY name",
    );
    const byName = new Map(rows.map((row) => [row.name, row.sql ?? '']));
    return names.map((name) => `${name}:${byName.get(name) ?? ''}`);
}

async function applySql(adapter: DbAdapter, sql: string): Promise<void> {
    for (const statement of splitSqlStatements(sql)) {
        await adapter.exec(statement);
    }
}

const DIMENSION_NAMES = [
    'history_board_dimension_daily',
    'history_board_kpi_window',
    'idx_history_board_dimension_daily_day',
] as const;

const NULLABLE_MEASURES = [
    'messages',
    'tool_calls',
    'skill_calls',
    'fresh_input_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'output_tokens',
    'duration_ms',
    'duration_samples',
    'errors',
] as const;

async function journalIds(adapter: DbAdapter): Promise<string[]> {
    const rows = await adapter.queryAll<{ id: string }>('SELECT id FROM "__spur_cli_migrations" ORDER BY rowid');
    return rows.map((row) => row.id);
}

async function columnNames(adapter: DbAdapter, table: string): Promise<string[]> {
    const rows = await adapter.queryAll<{ name: string }>(`PRAGMA table_info("${table}")`);
    return rows.map((row) => row.name);
}

function idsMatchReleased(ids: readonly string[]): boolean {
    if (ids.length !== FIXTURE_SEED.expectedCount) return false;
    return ids.every((id, index) => id.startsWith(`${String(index).padStart(4, '0')}_`));
}

function migrationOrder(journal: readonly string[]): string[] {
    const released = new Set(CLI_MIGRATIONS.map((migration) => migration.id));
    return journal.filter((id) => released.has(id));
}

let sourceFreeStderr = '';

async function sourceFreeSmoke(): Promise<OwnershipReport['offlineProof']> {
    const bundlePath = resolve(REPO_ROOT, 'apps/cli/spur.js');
    const empty: OwnershipReport['offlineProof'] = {
        pass: false,
        bundlePath: 'apps/cli/spur.js',
        bundleDigest: existsSync(bundlePath) ? digestFile('apps/cli/spur.js') : '',
        exitCode: null,
        reportedApplied: null,
        cwdHadDrizzle: false,
        cwdHadRepositorySource: false,
        journalColumns: [],
        embeddedIdsPresent: 0,
        importerLedgerPresent: false,
    };
    if (!existsSync(bundlePath)) return empty;
    const cwd = mkdtempSync(join(tmpdir(), 'spur-1311-source-free-'));
    const dbPath = join(cwd, '.spur', 'spur.db');
    mkdirSync(join(cwd, '.spur'), { recursive: true });
    try {
        sourceFreeStderr = '';
        // A literal child environment. Inheriting the test process would follow a
        // caller database URL; the gateway rule also forbids reading it here.
        const env = {
            PATH: '/usr/bin:/bin:/usr/local/bin',
            HOME: cwd,
            TMPDIR: tmpdir(),
            DATABASE_URL: dbPath,
            SPUR_SKIP_GLOBAL_CONFIG: 'true',
            SPUR_SKIP_PROJECT_CONFIG: 'true',
            SPUR_PROJECTS_FILE: join(cwd, 'projects.json'),
            SPUR_SLASH_COMMANDS_FILE: join(cwd, 'slash_commands.json'),
        };
        const proc = Bun.spawnSync([process.execPath, bundlePath, 'migrate', '--json'], {
            cwd,
            env,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 120_000,
        });
        empty.exitCode = proc.exitCode;
        sourceFreeStderr = proc.stderr.toString().slice(0, 800);
        empty.cwdHadDrizzle = existsSync(join(cwd, 'drizzle'));
        empty.cwdHadRepositorySource = existsSync(join(cwd, 'packages', 'domain', 'src', 'migrations.ts'));
        const stdout = proc.stdout.toString().trim();
        if (stdout.startsWith('{')) {
            const parsed = JSON.parse(stdout) as { applied?: number };
            empty.reportedApplied = typeof parsed.applied === 'number' ? parsed.applied : null;
        }
        if (!existsSync(dbPath)) return empty;
        const db = new Database(dbPath, { readonly: true });
        try {
            const columns = db.query("PRAGMA table_info('__spur_cli_migrations')").all() as Array<{ name: string }>;
            empty.journalColumns = columns.map((column) => column.name);
            const ids = db.query('SELECT id FROM "__spur_cli_migrations"').all() as Array<{ id: string }>;
            const present = new Set(ids.map((row) => row.id));
            empty.embeddedIdsPresent = CLI_MIGRATIONS.filter((migration) => present.has(migration.id)).length;
            empty.importerLedgerPresent = ids.some((row) => row.id.startsWith('importer_schema@'));
        } finally {
            db.close();
        }
        empty.pass =
            proc.exitCode === 0 &&
            empty.cwdHadDrizzle === false &&
            empty.cwdHadRepositorySource === false &&
            empty.journalColumns.includes('id') &&
            empty.journalColumns.includes('applied_at') &&
            empty.journalColumns.every((column) => column === 'id' || column === 'applied_at') &&
            empty.embeddedIdsPresent === CLI_MIGRATIONS.length &&
            empty.importerLedgerPresent;
        return empty;
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}

function stable(report: OwnershipReport): unknown {
    // The commit that adds the frozen report changes HEAD. sourceRevision stays in
    // both artifacts; equality uses sourceDigests, which do not move with that commit.
    const { measuredAt: _measuredAt, sourceRevision: _sourceRevision, ...rest } = report;
    return rest;
}

function renderMarkdown(report: OwnershipReport): string {
    const digests = Object.entries(report.sourceDigests)
        .map(([path, digest]) => `- \`${path}\`: \`${digest}\``)
        .join('\n');
    const guards = report.ids.guards.map((guard) => `| ${guard.id} | ${guard.table} | ${guard.column} |`).join('\n');
    const cases = report.guardParity.cases.map((item) => `| ${item.id} | ${item.pass} | ${item.detail} |`).join('\n');
    const mismatches = report.mirrors.normalizedMismatch.join(', ') || '(none)';
    const embeddedOnly = report.mirrors.embeddedOnly.join(', ') || '(none)';
    return `# 1311 migration ownership

schemaVersion: ${report.schemaVersion}
candidate: ${report.candidate}
status: ${report.status}
sourceRevision: ${report.sourceRevision}
command: \`${report.command}\`
fixtureSeed: ${report.fixtureSeed.id}
measuredAt: ${report.measuredAt}

## Reason

${report.reason}

Audit hashes are not runtime journal fields. \`__spur_cli_migrations\` stores \`id\` and \`applied_at\` only.

## Source digests

${digests}

## Identifiers

Count: ${report.ids.count}. First: ${report.ids.first}. Last: ${report.ids.last}. Contiguous 0000..0054: ${report.ids.contiguousFrom0000}.

| guard id | table | column |
| --- | --- | --- |
${guards}

## 0037 hashes

- embedded: \`${report.hashes.embedded0037}\`
- tracked file: \`${report.hashes.tracked0037}\`
- normalized embedded: \`${report.hashes.normalizedEmbedded0037}\`
- normalized tracked: \`${report.hashes.normalizedTracked0037}\`

Normalized equal: ${report.semanticParity.normalizedEqual}. Schema equal: ${report.semanticParity.schemaEqual}. Method: ${report.semanticParity.method}.

## Fixtures

| id | pass | detail |
| --- | --- | --- |
${cases}

## Offline proof

Bundle \`${report.offlineProof.bundlePath}\` digest \`${report.offlineProof.bundleDigest}\`.
Exit ${report.offlineProof.exitCode}. Reported applied ${report.offlineProof.reportedApplied}.
Temporary directory had drizzle: ${report.offlineProof.cwdHadDrizzle}. Had repository source: ${report.offlineProof.cwdHadRepositorySource}.
Journal columns: ${report.offlineProof.journalColumns.join(', ')}.
Embedded ids present: ${report.offlineProof.embeddedIdsPresent}. Importer ledger present: ${report.offlineProof.importerLedgerPresent}.

## Other mirrors

Tracked files: ${report.mirrors.trackedCount}. Disposition: ${report.mirrors.disposition}.
Embedded ids with no tracked file: ${embeddedOnly}.
Normalized mismatches: ${mismatches}.

## Provenance

bun ${report.provenance.bun}; sqlite ${report.provenance.sqlite}; domain ${report.provenance.domainPackage}; cli ${report.provenance.cliPackage}.

## Decision

${report.status === 'go' ? '1312 may consume this artifact after review.' : '1312 stays blocked.'}
`;
}

function renderJUnit(report: OwnershipReport): string {
    const cases = report.guardParity.cases
        .map((item) => {
            const name = `1311 ${item.id}`;
            if (!item.pass) {
                return `    <testcase name="${xml(name)}"><failure message="${xml(item.detail)}"/></testcase>`;
            }
            return `    <testcase name="${xml(name)}"/>`;
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="1311-migration-ownership" tests="${report.guardParity.cases.length}">
${cases}
</testsuite>
`;
}

function xml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function formatReport(path: string): void {
    const result = Bun.spawnSync(['bunx', 'biome', 'check', '--write', path], {
        cwd: REPO_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
        throw new Error(`biome format failed for ${path}: ${result.stderr.toString()}`);
    }
}

function passingInput(): OwnershipDecisionInput {
    return {
        measurable: true,
        idsMatchReleased: true,
        semanticEqual: true,
        schemaEqual: true,
        releasedSqlUnchanged: true,
        dependencyUnchanged: true,
        guardCasesPass: true,
        offlinePass: true,
    };
}

describe('1311 SQL normalization and decision', () => {
    test('comments and whitespace collapse, and quoted text stays literal', () => {
        const normalized = normalizeMigrationSql(
            "SELECT '-- keep', \"id\"\n  /* block */ -- tail\nFROM t  WHERE note = 'a''b';",
        );
        expect(normalized).toBe("SELECT '-- keep', \"id\" FROM t WHERE note = 'a''b';");
    });

    test('an unclosed block comment does not throw', () => {
        expect(normalizeMigrationSql('SELECT 1 /* never ends')).toBe('SELECT 1');
    });

    test('frozen equality ignores the measurement clock and git HEAD', () => {
        const measured = {
            measuredAt: '2026-11-06T08:19:21.436Z',
            sourceRevision: 'da6484006e41fbe7ed02d16792733acf223f8c65',
            status: 'go' as const,
        };
        const committed = {
            ...measured,
            measuredAt: '2099-01-01T00:00:00.000Z',
            sourceRevision: 'cccccccccccccccccccccccccccccccccccccccc',
        };
        expect(stable(measured as OwnershipReport)).toEqual(stable(committed as OwnershipReport));
        expect(committed.sourceRevision).not.toBe(measured.sourceRevision);
    });

    test('a missing measurement is inconclusive and each failed gate is no-go', () => {
        expect(decideMigrationOwnership({ ...passingInput(), measurable: false }).status).toBe('inconclusive');
        expect(decideMigrationOwnership({ ...passingInput(), idsMatchReleased: false }).status).toBe('no-go');
        expect(decideMigrationOwnership({ ...passingInput(), semanticEqual: false }).status).toBe('no-go');
        expect(decideMigrationOwnership({ ...passingInput(), schemaEqual: false }).status).toBe('no-go');
        expect(decideMigrationOwnership({ ...passingInput(), releasedSqlUnchanged: false }).status).toBe('no-go');
        expect(decideMigrationOwnership({ ...passingInput(), dependencyUnchanged: false }).status).toBe('no-go');
        expect(decideMigrationOwnership({ ...passingInput(), guardCasesPass: false }).status).toBe('no-go');
        expect(decideMigrationOwnership({ ...passingInput(), offlinePass: false }).status).toBe('no-go');
        expect(decideMigrationOwnership(passingInput()).status).toBe('go');
    });

    test('an unguarded duplicate ADD COLUMN fails, which is why the guard exists', async () => {
        const adapter = await openMemory();
        await adapter.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, external_key TEXT)');
        await expect(adapter.exec(RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL)).rejects.toThrow();
        adapter.close();
    });
});

describe('1311 migration ownership evidence', () => {
    test('publishes the 0037 ownership decision from fixtures', async () => {
        const embeddedIds = CLI_MIGRATIONS.map((migration) => migration.id);
        const contiguous = idsMatchReleased(embeddedIds);
        const trackedMigrations = await loadSqlMigrations(resolve(REPO_ROOT, 'drizzle'));
        const trackedById = new Map(trackedMigrations.map((migration) => [migration.id, migration.sql]));
        const trackedFile = readFileSync(resolve(REPO_ROOT, CANDIDATE_FILE));
        const embeddedSql = HISTORY_DIMENSION_MARTS_SCHEMA_SQL;
        const normalizedEmbedded = normalizeMigrationSql(embeddedSql);
        const normalizedTracked = normalizeMigrationSql(trackedFile.toString('utf8'));
        const normalizedEqual = normalizedEmbedded === normalizedTracked;
        const candidateEntry = CLI_MIGRATIONS.find((migration) => migration.id === CANDIDATE_ID);
        expect(candidateEntry?.sql).toBe(embeddedSql);

        const embeddedDb = await openMemory();
        await applySql(embeddedDb, embeddedSql);
        const trackedDb = await openMemory();
        await applySql(trackedDb, trackedFile.toString('utf8'));
        const schemaEqual =
            (await masterSql(embeddedDb, DIMENSION_NAMES)).join('\n') ===
            (await masterSql(trackedDb, DIMENSION_NAMES)).join('\n');
        embeddedDb.close();
        trackedDb.close();

        const cases: FixtureCase[] = [];

        const fresh = await openMemory();
        const freshApplied = await applyCliMigrations(fresh);
        const freshJournal = await journalIds(fresh);
        const freshColumns = await columnNames(fresh, '__spur_cli_migrations');
        const measureColumns = await fresh.queryAll<{ name: string; notnull: number; dflt_value: string | null }>(
            'PRAGMA table_info(history_board_dimension_daily)',
        );
        const measuresNullable = NULLABLE_MEASURES.every((name) => {
            const column = measureColumns.find((item) => item.name === name);
            return column?.notnull === 0 && column.dflt_value == null;
        });
        const freshOrder = migrationOrder(freshJournal);
        const freshPass =
            freshApplied === CLI_MIGRATIONS.length &&
            freshOrder.join('\n') === embeddedIds.join('\n') &&
            freshColumns.includes('id') &&
            freshColumns.includes('applied_at') &&
            freshColumns.every((column) => column === 'id' || column === 'applied_at') &&
            measuresNullable &&
            (await masterSql(fresh, DIMENSION_NAMES)).every((row) => !row.endsWith(':'));
        cases.push({
            id: 'fresh',
            pass: freshPass,
            detail: `applied ${freshApplied}; journal columns ${freshColumns.join(',')}; nullable measures ${measuresNullable}`,
        });

        const already = await applyCliMigrations(fresh);
        cases.push({
            id: 'already-applied',
            pass: already === 0 && (await journalIds(fresh)).join('\n') === freshJournal.join('\n'),
            detail: `second apply returned ${already}`,
        });
        fresh.close();

        const previous = await openMemory();
        await applyCliMigrations(previous, CLI_MIGRATIONS.slice(0, 37));
        const previousApplied = await applyCliMigrations(previous);
        const previousHasMart = (await masterSql(previous, DIMENSION_NAMES)).every((row) => !row.endsWith(':'));
        cases.push({
            id: 'previous-release',
            pass: previousApplied === CLI_MIGRATIONS.length - 37 && previousHasMart,
            detail: `upgrade from 0036 applied ${previousApplied}`,
        });
        previous.close();

        const interrupted = await openMemory();
        await applyCliMigrations(interrupted, CLI_MIGRATIONS.slice(0, 37));
        await applySql(interrupted, embeddedSql);
        const resumed = await applyCliMigrations(interrupted);
        const interruptedJournal = migrationOrder(await journalIds(interrupted));
        const interruptedPass =
            resumed === CLI_MIGRATIONS.length - 37 && interruptedJournal.join('\n') === embeddedIds.join('\n');
        cases.push({
            id: 'interrupted',
            pass: interruptedPass,
            detail: `0037 SQL applied before its journal row; resume applied ${resumed}`,
        });
        interrupted.close();

        const duplicate = await openMemory();
        await duplicate.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, external_key TEXT)');
        const duplicateApplied = await applyCliMigrations(duplicate, [
            {
                id: '0007_spur_cli_runs_external_key',
                sql: RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL,
                addColumnIfMissing: { table: 'runs', column: 'external_key' },
            },
        ]);
        const duplicateColumns = await duplicate.queryAll<{ name: string }>('PRAGMA table_info(runs)');
        cases.push({
            id: 'duplicate-column',
            pass:
                duplicateApplied === 1 &&
                duplicateColumns.filter((column) => column.name === 'external_key').length === 1,
            detail: '0007 journals when external_key is already present',
        });
        duplicate.close();

        const absent = await openMemory();
        await absent.exec('CREATE TABLE runs (id TEXT PRIMARY KEY)');
        const absentApplied = await applyCliMigrations(absent, [
            {
                id: '0007_spur_cli_runs_external_key',
                sql: RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL,
                addColumnIfMissing: { table: 'runs', column: 'external_key' },
            },
        ]);
        const absentColumns = await columnNames(absent, 'runs');
        cases.push({
            id: 'absent-column',
            pass: absentApplied === 1 && absentColumns.includes('external_key'),
            detail: '0007 adds external_key when the column is absent',
        });
        absent.close();

        const offlineProof = await sourceFreeSmoke();
        const guards: GuardRef[] = CLI_MIGRATIONS.flatMap((migration) =>
            migration.addColumnIfMissing
                ? [
                      {
                          id: migration.id,
                          table: migration.addColumnIfMissing.table,
                          column: migration.addColumnIfMissing.column,
                      },
                  ]
                : [],
        );
        const rows: MirrorRow[] = CLI_MIGRATIONS.map((migration) => {
            const tracked = trackedById.get(migration.id);
            return {
                id: migration.id,
                tracked: tracked !== undefined,
                exactEqual: tracked === undefined ? null : tracked === migration.sql,
                normalizedEqual:
                    tracked === undefined
                        ? null
                        : normalizeMigrationSql(tracked) === normalizeMigrationSql(migration.sql),
                disposition: migration.id === CANDIDATE_ID ? 'candidate' : 'inventory-only',
            };
        });
        const inspected = [
            'packages/domain/src/migrations.ts',
            CANDIDATE_FILE,
            'apps/cli/spur.js',
            ...DEPENDENCY_PATHS,
            ...rows.flatMap((row) => (row.tracked ? [`drizzle/${row.id}.sql`] : [])),
        ];
        const uniqueInspected = [...new Set(inspected)];
        const sourceDigests = Object.fromEntries(uniqueInspected.map((path) => [path, digestFile(path)]));
        const digestsComplete = uniqueInspected.every((path) => (sourceDigests[path] ?? '').length === 64);
        const releasedClean = porcelain(RELEASED_SQL_PATHS).length === 0;
        const dependencyClean = porcelain(DEPENDENCY_PATHS).length === 0;
        const guardCasesPass = cases.every((item) => item.pass);
        const decision = decideMigrationOwnership({
            measurable: digestsComplete && offlineProof.bundleDigest.length === 64,
            idsMatchReleased:
                contiguous &&
                embeddedIds[0] === '0000_spur_cli_foundation' &&
                embeddedIds.at(-1)?.startsWith('0054_') === true,
            semanticEqual: normalizedEqual && candidateEntry?.sql === embeddedSql,
            schemaEqual,
            releasedSqlUnchanged: releasedClean,
            dependencyUnchanged: dependencyClean,
            guardCasesPass,
            offlinePass: offlineProof.pass,
        });
        const sqliteVersion = await (async () => {
            const probe = await openMemory();
            const row = await probe.queryFirst<{ v: string }>('SELECT sqlite_version() AS v');
            probe.close();
            return row?.v ?? '';
        })();
        const report: OwnershipReport = {
            schemaVersion: 1,
            candidate: '0037-dimension-marts',
            status: decision.status,
            reason: decision.reason,
            ids: {
                count: embeddedIds.length,
                first: embeddedIds[0] ?? '',
                last: embeddedIds.at(-1) ?? '',
                contiguousFrom0000: contiguous,
                order: embeddedIds,
                guards,
            },
            hashes: {
                auditOnly: true,
                journalColumns: ['id', 'applied_at'],
                embedded0037: sha256(embeddedSql),
                tracked0037: sha256(trackedFile),
                normalizedEmbedded0037: sha256(normalizedEmbedded),
                normalizedTracked0037: sha256(normalizedTracked),
            },
            semanticParity: {
                normalizedEqual,
                schemaEqual,
                method: 'sql-comment-and-whitespace',
            },
            guardParity: { preserved: guardCasesPass, cases },
            offlineProof,
            mirrors: {
                trackedCount: rows.filter((row) => row.tracked).length,
                embeddedOnly: rows.filter((row) => !row.tracked).map((row) => row.id),
                normalizedMismatch: rows.filter((row) => row.normalizedEqual === false).map((row) => row.id),
                disposition: 'inventory-only; no other mirror is proposed in this slice',
                rows,
            },
            provenance: {
                bun: Bun.version,
                sqlite: sqliteVersion,
                domainPackage: packageVersion('packages/domain/package.json'),
                cliPackage: packageVersion('apps/cli/package.json'),
                dependencyPaths: [...DEPENDENCY_PATHS],
                releasedSqlPaths: [...RELEASED_SQL_PATHS],
            },
            sourceRevision: gitHead(),
            sourceDigests,
            fixtureSeed: FIXTURE_SEED,
            command: COMMAND,
            measuredAt: new Date().toISOString(),
        };

        mkdirSync(dirnameSafe(PROOF_JSON), { recursive: true });
        writeFileSync(PROOF_JSON, `${JSON.stringify(report, null, 4)}\n`);
        writeFileSync(PROOF_JUNIT, renderJUnit(report));
        if (!existsSync(REPORT_JSON)) {
            mkdirSync(dirnameSafe(REPORT_JSON), { recursive: true });
            writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 4)}\n`);
            writeFileSync(REPORT_MD, renderMarkdown(report));
            formatReport(REPORT_JSON);
        } else {
            const existing = JSON.parse(readFileSync(REPORT_JSON, 'utf8')) as OwnershipReport;
            expect(stable(existing)).toEqual(stable(report));
        }

        expect(report.schemaVersion).toBe(1);
        expect(report.candidate).toBe('0037-dimension-marts');
        expect(report.command).toBe(COMMAND);
        expect(report.sourceRevision).toBe(gitHead());
        expect(report.hashes.journalColumns).toEqual(['id', 'applied_at']);
        expect(cases.map((item) => item.id)).toEqual([
            'fresh',
            'already-applied',
            'previous-release',
            'interrupted',
            'duplicate-column',
            'absent-column',
        ]);
        expect(guardCasesPass, JSON.stringify(cases)).toBe(true);
        expect(normalizedEqual, `embedded:\n${normalizedEmbedded}\ntracked:\n${normalizedTracked}`).toBe(true);
        expect(schemaEqual).toBe(true);
        expect(offlineProof.pass, `${JSON.stringify(offlineProof)}\n${sourceFreeStderr}`).toBe(true);
        expect(report.status).toBe('go');
    }, 120_000);
});

function dirnameSafe(path: string): string {
    return path.slice(0, path.lastIndexOf('/'));
}
