/**
 * Inline-run provenance readers that outlive the deleted inline driver (task 1242).
 *
 * The driver itself (`spur workflow inline *`, `services/inline-run-setup.ts`) is gone. The
 * canonical project DB opener survives because its consumers (feature verification, worktree
 * persistence) are not the driver.
 */
import { join, resolve } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';

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
