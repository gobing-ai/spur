/**
 * A83 1426/1427 R5 — no adopted built-in module keeps a hand-built header or tab strip.
 *
 * The mounted-shell DOM proofs live in 1430's browser leg (`integrations-browser`-style heavy test,
 * one module at a time): mounting eight data-heavy shells inside the shared bun process made the
 * aggregate suite order-dependent through testing-library's act queue and the process-global rpc
 * mock, which is a worse trade than proving the same shells in a real browser.
 *
 * A structural probe, because the DOM assertions can only see what a module renders under the
 * fixtures a test happens to mount. The rule is the migration's contract: the shell markup lives
 * in `module-kit`, so a module source gains one by importing the kit, not by copying it.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULES_ROOT = join(import.meta.dir, '../../src/modules');

/** The sources 1426 migrated; 1427 appends its four here. */
const MIGRATED = [
    'projects/ProjectsShell.tsx',
    'settings/SettingsShell.tsx',
    'task-kanban/TasksShell.tsx',
    'search/index.tsx',
    // 1427
    'designs/DesignsShell.tsx',
    'features/FeaturesShell.tsx',
    'history/HistoryShell.tsx',
    'plans/PlansShell.tsx',
];

describe('1426 R5 — no hand-built header or tablist in the migrated modules', () => {
    for (const relative of MIGRATED) {
        test(`${relative} renders through the kit`, () => {
            const source = readFileSync(join(MODULES_ROOT, relative), 'utf8');
            expect(source).not.toMatch(/<h1[\s>]/);
            expect(source).not.toContain('role="tablist"');
            expect(source).toContain("from '../../components/module-kit'");
            expect(source).toMatch(/<ModuleShell|ModuleShell\b/);
        });
    }
});
