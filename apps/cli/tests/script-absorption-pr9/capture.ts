/**
 * One-shot legacy capture for the PR-9 golden (NOT run by the test suite).
 * Usage: bun apps/cli/tests/script-absorption-pr9/capture.ts <legacy-worktree> <seeded-db>
 * The legacy worktree must be a disposable checkout that still has the retired scripts; its
 * config/workflows and config/pipeline-budgets.json are replaced by the fixtures.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PR9_CASES } from './cases';

const [legacyRoot, seededDb] = process.argv.slice(2);
if (!legacyRoot || !seededDb) throw new Error('usage: capture.ts <legacy-worktree> <seeded-db>');
const FIX = join(import.meta.dir, '../fixtures/script-absorption-pr9');
rmSync(join(legacyRoot, 'config/workflows'), { recursive: true, force: true });
cpSync(join(FIX, 'workflows'), join(legacyRoot, 'config/workflows'), { recursive: true });
cpSync(join(FIX, 'pipeline-budgets.json'), join(legacyRoot, 'config/pipeline-budgets.json'));
cpSync(join(FIX, 'measured-over.json'), join(legacyRoot, 'measured-over.json'));
mkdirSync(join(legacyRoot, '.spur'), { recursive: true });
cpSync(seededDb, join(legacyRoot, '.spur/spur.db'));

const out: Record<string, { stdout: string; stderr: string; exitCode: number }> = {};
for (const c of PR9_CASES) {
    const r = Bun.spawnSync(['bun', 'scripts/spur-dev.ts', ...c.legacy], {
        cwd: legacyRoot,
        env: { PATH: process.env.PATH ?? '' },
    });
    out[c.name] = { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode ?? -1 };
}
writeFileSync(
    join(import.meta.dir, '../fixtures/script-absorption-pr9-golden.json'),
    `${JSON.stringify(out, null, 2)}\n`,
);
