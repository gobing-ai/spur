/**
 * Regression guard for the packaging prune filter (task 0500 R4).
 *
 * The published `@gobing-ai/spur` tarball must ship the `sp` plugin content but
 * NOT test/eval/OS-junk files. Two failure modes are caught here:
 *  1. the root suite (`bun test … ./apps/cli … ./plugins … ./scripts`) re-discovers
 *     any `*.test.ts` that survives into `apps/cli/plugins/` (AC7) — bun walks the
 *     staged tree and ignores `.gitignore`;
 *  2. shipping tests/evals bloat the tarball (superskill 0113 measured the gap).
 *
 * Superskill's `find plugins -type d -name tests -prune` misses the five
 * `*.test.ts` files outside any `tests/` dir; the EXCLUDE regex here must prune
 * by content type, not by directory name.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXCLUDE, stagePlugins } from './stage-plugins';

async function listFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await listFiles(full)));
        else out.push(full.replace(/\\/g, '/'));
    }
    return out;
}

describe('stagePlugins', () => {
    let target: string;

    afterEach(async () => {
        if (target) await rm(target, { recursive: true, force: true });
    });

    test('prunes tests/, *.test.ts, evals/ and OS junk from the staged plugin tree', async () => {
        target = await mkdtemp(join(tmpdir(), 'spur-stage-'));
        const pluginTarget = join(target, 'plugins');
        const marketplaceTarget = join(target, '.claude-plugin');
        await stagePlugins(pluginTarget, marketplaceTarget);

        const files = await listFiles(pluginTarget);
        const rel = files.map((f) => f.slice(pluginTarget.length + 1));

        // Distribution content ships.
        expect(rel).toContain('sp/plugin.json');
        expect(rel.some((f) => f.startsWith('sp/skills/'))).toBe(true);
        expect(rel.some((f) => f.startsWith('sp/commands/'))).toBe(true);
        expect(rel).toContain('sp/hooks/hooks.json');
        expect(rel.some((f) => f.startsWith('sp/scripts/'))).toBe(true);

        // Nothing under a tests/ directory ships.
        expect(rel.some((f) => f.includes('/tests/') || f.startsWith('tests/'))).toBe(false);
        // No *.test.ts anywhere (the five outside tests/ dirs must be pruned too).
        expect(rel.some((f) => f.endsWith('.test.ts'))).toBe(false);
        // evals/ (monorepo-only) pruned.
        expect(rel.some((f) => f.includes('/evals/'))).toBe(false);
        // Marketplace manifest ships.
        const mk = await listFiles(marketplaceTarget);
        expect(mk.map((f) => f.replace(/\\/g, '/'))).toContain(`${marketplaceTarget}/marketplace.json`);
    });

    test('staged plugin root retains a distribution entry superskill requires', async () => {
        target = await mkdtemp(join(tmpdir(), 'spur-stage-'));
        const pluginTarget = join(target, 'plugins');
        await stagePlugins(pluginTarget, join(target, '.claude-plugin'));

        const top = await readdir(join(pluginTarget, 'sp'), { withFileTypes: true });
        const names = top.filter((e) => e.isDirectory()).map((e) => e.name);
        // superskill rejects a plugin root without one of these (marketplace.ts:180).
        expect(names.some((n) => ['skills', 'commands', 'agents', 'hooks'].includes(n))).toBe(true);
    });
});

describe('EXCLUDE filter', () => {
    const rel = (p: string) => p;

    test('prunes test files, tests/ and evals/ dirs, and OS junk anywhere in the tree', () => {
        expect(EXCLUDE.test(rel('sp/hooks/careful-guard.test.ts'))).toBe(true);
        expect(EXCLUDE.test(rel('sp/evals/judge.test.ts'))).toBe(true);
        expect(EXCLUDE.test(rel('sp/evals/judge.ts'))).toBe(true);
        expect(EXCLUDE.test(rel('sp/tests/fixture.test.ts'))).toBe(true);
        expect(EXCLUDE.test(rel('sp/tests/util.ts'))).toBe(true);
        expect(EXCLUDE.test(rel('sp/.DS_Store'))).toBe(true);
        expect(EXCLUDE.test(rel('README.md'))).toBe(false);
        expect(EXCLUDE.test(rel('sp/plugin.json'))).toBe(false);
        expect(EXCLUDE.test(rel('sp/skills/dev-plan/SKILL.md'))).toBe(false);
        expect(EXCLUDE.test(rel('sp/scripts/validate-commands.ts'))).toBe(false);
        expect(EXCLUDE.test(rel('sp/hooks/careful-guard.ts'))).toBe(false);
    });
});
