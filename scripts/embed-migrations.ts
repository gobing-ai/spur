/**
 * Regenerate `packages/core/src/db/embedded-migrations.ts` from the `drizzle/` folder.
 *
 * Run this after adding new migrations:
 *   bun run scripts/embed-migrations.ts
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRIZZLE_DIR = resolve(import.meta.dir, '..', 'drizzle');
const OUTPUT_FILE = resolve(import.meta.dir, '..', 'packages', 'core', 'src', 'db', 'embedded-migrations.ts');

function main(): void {
    const journalPath = resolve(DRIZZLE_DIR, 'meta', '_journal.json');
    if (!existsSync(journalPath)) {
        console.error('No drizzle/meta/_journal.json found. Run `bun run db:generate` first.');
        process.exit(1);
    }

    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));

    let output = `/**
 * Embedded migration SQL — auto-generated from drizzle/ folder.
 *
 * This file bundles all migration SQL as inline strings so the compiled
 * binary can apply migrations without needing the drizzle/ folder on disk.
 *
 * DO NOT EDIT MANUALLY. Regenerate with: bun run scripts/embed-migrations.ts
 */

export interface EmbeddedMigration {
  /** Migration tag (e.g. "0000_init"). */
  tag: string;
  /** SQL statements for this migration. */
  sql: string;
  /** SHA-256 hash of the SQL content for journal tracking. */
  hash: string;
}

export const embeddedMigrations: EmbeddedMigration[] = [
`;

    const entries: Array<{ tag: string; sql: string; hash: string }> = [];

    for (const entry of journal.entries) {
        const tag: string = entry.tag;
        const sqlFileName = readdirSync(DRIZZLE_DIR).find((f) => f.startsWith(tag) && f.endsWith('.sql'));
        if (!sqlFileName) {
            console.error(`Missing SQL file for migration: ${tag}`);
            process.exit(1);
        }

        const sql = readFileSync(resolve(DRIZZLE_DIR, sqlFileName), 'utf8');
        const hash = createHash('sha256').update(sql).digest('hex');
        entries.push({ tag, sql, hash });
    }

    for (const e of entries) {
        output += `  {\n`;
        output += `    tag: ${JSON.stringify(e.tag)},\n`;
        output += `    sql: ${JSON.stringify(e.sql)},\n`;
        output += `    hash: ${JSON.stringify(e.hash)},\n`;
        output += `  },\n`;
    }

    output += `];\n`;

    writeFileSync(OUTPUT_FILE, output, 'utf8');
    console.log(`Generated ${OUTPUT_FILE} with ${entries.length} migration(s).`);
}

main();
