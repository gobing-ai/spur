/**
 * G11 task 1266, AC2/R2 — only the inbox data-access layer queries the inbox table.
 *
 * This is the executable form of the task's Plan step 6 sweep: a production module outside
 * `InboxDao` (and the migration/schema definitions that must name the table to create it) may
 * not address `inbox_messages`, and the retired ts-db DAOs may not resurface. A convention held
 * only by review rots; this fails the suite the moment a second query path appears.
 *
 * Prose is not a violation: comments are stripped before scanning, so a doc block may still say
 * "an `inbox_messages` row" and explain the design.
 */
import { describe, expect, test } from 'bun:test';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');

/** Production source roots. Test files are excluded: they may seed and assert on the table. */
const SOURCE_ROOTS = ['packages', 'apps', 'scripts'];

/** Modules that legitimately address the table: the DAO, the migration and the schema. */
const ALLOWED = new Set([
    'packages/domain/src/dao/inbox-dao.ts',
    'packages/domain/src/migrations.ts',
    'packages/domain/src/schema/inbox-messages.ts',
]);

/**
 * The one non-query mention allowed elsewhere: the unique-index collision predicate matches the
 * SQLite driver's error text, which happens to name the table. It writes nothing.
 */
const DRIVER_MESSAGE_EXCEPTION = 'error.message.includes';

/** Retired names that must not resurface in production source (G11 R2). */
const RETIRED = ['InboxMessageDao', 'InboxRecentDao', 'InboxUnfinishedDao'];

/** Drop block and line comments so prose about the table is not read as a query. */
function stripComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
        .join('\n');
}

async function productionSources(): Promise<string[]> {
    const files = new Set<string>();
    for (const root of SOURCE_ROOTS) {
        for (const pattern of ['**/src/**/*.ts', '**/*.ts']) {
            const glob = new Bun.Glob(pattern);
            for await (const path of glob.scan({ cwd: join(REPO_ROOT, root) })) {
                if (path.includes('/tests/') || path.includes('.test.')) continue;
                files.add(relative(REPO_ROOT, join(REPO_ROOT, root, path)));
            }
        }
    }
    return [...files].sort();
}

describe('1266 R2/AC2 — inbox table ownership', () => {
    test('only InboxDao, the migration and the schema address inbox_messages', async () => {
        const offenders: string[] = [];
        for (const file of await productionSources()) {
            if (ALLOWED.has(file)) continue;
            const code = stripComments(await Bun.file(join(REPO_ROOT, file)).text());
            for (const line of code.split('\n')) {
                if (!line.includes('inbox_messages')) continue;
                if (line.includes(DRIVER_MESSAGE_EXCEPTION)) continue;
                offenders.push(`${file}: ${line.trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the retired ts-db DAOs are gone from production source', async () => {
        const offenders: string[] = [];
        for (const file of await productionSources()) {
            const code = stripComments(await Bun.file(join(REPO_ROOT, file)).text());
            for (const retired of RETIRED) {
                if (code.includes(retired)) offenders.push(`${file}: ${retired}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the sweep actually finds the allowed modules — a silent empty scan is not a pass', async () => {
        const files = await productionSources();
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain('packages/domain/src/dao/inbox-dao.ts');
        expect(files).toContain('packages/app/src/services/inbox-service.ts');
    });
});
