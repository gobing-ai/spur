/**
 * Inline-run provenance readers that outlive the deleted inline driver (task 1242).
 *
 * The driver itself (`spur workflow inline *`, `services/inline-run-setup.ts`) is gone. Two
 * readers survive because their consumers are not the driver: the canonical project DB opener
 * used by feature verification, and the unattributed-stage count `spur agent doctor` reports.
 */
import { join, resolve } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { runStoragePaths } from './run-storage';

// Synchronous reads are load-bearing here (a boot-time DB open and a doctor count); the builtin is
// taken through getBuiltinModule, the standing runtime-boundaries form for this package.
const { readdirSync, readFileSync } = process.getBuiltinModule('node:fs');

/** The project DB handle handed to the feature-verification run. */
export interface InlineRunProjectDb {
    readonly adapter: Awaited<ReturnType<typeof createMigratedDb>>;
    readonly close: () => void;
}

/**
 * Open the canonical project database (`.spur/spur.db`, migrated, 30s busy timeout) — the same
 * URL/migrations/busy-timeout posture the CLI composition root uses
 * (apps/cli/src/context.ts `createMigratedDbAdapter`).
 */
export async function openInlineRunProjectDb(workdir: string): Promise<InlineRunProjectDb> {
    const { mkdirSync } = process.getBuiltinModule('node:fs');
    const url = join(resolve(workdir), '.spur', 'spur.db');
    mkdirSync(join(url, '..'), { recursive: true });
    const adapter = await createMigratedDb({ url });
    return { adapter, close: () => adapter.close() };
}

/**
 * Count inline stages that ran without executor attribution (1134 R6) — the operator's signal that
 * fail-fast could not have fired. Unreadable or malformed ledgers contribute nothing rather than
 * failing the read.
 */
export function countUnattributedInlineStages(projectRoot: string): number {
    const scratchDir = runStoragePaths(projectRoot).scratchDir;
    let files: string[];
    try {
        files = readdirSync(scratchDir).filter((entry) => entry.endsWith('-attribution.jsonl'));
    } catch {
        return 0;
    }
    let count = 0;
    for (const file of files) {
        let text: string;
        try {
            text = readFileSync(join(scratchDir, file), 'utf8');
        } catch {
            continue;
        }
        for (const line of text.split('\n')) {
            if (line.trim() === '') continue;
            try {
                const row = JSON.parse(line) as { executor?: unknown };
                if (row.executor === null) count += 1;
            } catch {
                // A partial trailing line is not an attribution record; ignore it.
            }
        }
    }
    return count;
}
