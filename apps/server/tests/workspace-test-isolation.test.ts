import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * R5 regression pin (task 1089): the server workspace must load the shared test
 * preload when its suite is run workspace-locally.
 *
 * `serve.test.ts` starts real servers against throwaway roots, and `spur serve`
 * upserts its project root into `getProjectsFilePath()`. `tests/setup.ts` points
 * `SPUR_PROJECTS_FILE` at a disposable registry, but Bun only applies the preload
 * from the *nearest* bunfig — so the root bunfig alone left
 * `cd apps/server && bun test` (the run AGENTS.md prescribes) writing throwaway
 * roots into the operator's real `~/.config/spur/projects.json`, where
 * `refreshProjects` cannot prune them because the directories still exist.
 *
 * A deleted or mis-pathed `apps/server/bunfig.toml` silently reintroduces that
 * leak and nothing else observes it, so the wiring is asserted here.
 */
describe('apps/server workspace test isolation (1089 R5)', () => {
    test('the workspace bunfig preloads the shared registry-isolating setup', () => {
        const workspaceDir = resolve(import.meta.dir, '..');
        const bunfigPath = join(workspaceDir, 'bunfig.toml');
        expect(existsSync(bunfigPath)).toBe(true);
        const preload = /^\s*preload\s*=\s*\[([^\]]*)\]\s*$/m.exec(readFileSync(bunfigPath, 'utf8'))?.[1] ?? '';
        const entries = [...preload.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
        expect(entries).toEqual(['../../tests/setup.ts']);
        const setupPath = resolve(workspaceDir, entries[0] ?? '');
        expect(setupPath).toBe(join(resolve(workspaceDir, '..', '..'), 'tests', 'setup.ts'));
        expect(readFileSync(setupPath, 'utf8')).toContain('SPUR_PROJECTS_FILE');
    });
});
