import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FROZEN_HISTORY_SURFACES, historySurfaceFreezeCheck, resolveFrozenBase } from './history-surface-freeze-check';

const FROZEN_WEB = 'apps/web/src/modules/history/SummaryTab.tsx';
const FROZEN_CONTRACT = 'packages/contracts/src/history.ts';
const UNRELATED = 'packages/domain/src/analytics/other.ts';

let repo: string;
const created: string[] = [];

function git(args: string[]): string {
    const proc = Bun.spawnSync(['git', ...args], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
    if (proc.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${proc.stderr?.toString() ?? ''}`);
    }
    return (proc.stdout?.toString() ?? '').trim();
}

async function write(path: string, content: string): Promise<void> {
    const abs = join(repo, path);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content);
}

async function createUntracked(path: string, content: string): Promise<void> {
    await write(path, content);
    created.push(path);
}

beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'freeze-check-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@spur.local']);
    git(['config', 'user.name', 'Spur Test']);

    await write(FROZEN_WEB, 'export const SummaryTab = () => null;\n');
    await write(FROZEN_CONTRACT, 'export const history = true;\n');
    await write(UNRELATED, 'export const x = 1;\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'init']);
    git(['branch', '-M', 'main']);
});

afterEach(async () => {
    git(['checkout', '-q', '--', '.']);
    for (const path of created.splice(0)) {
        await rm(join(repo, path), { recursive: true, force: true });
    }
    git(['checkout', '-q', 'main']);
});

afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
});

describe('history-surface-freeze-check (0745 R1/R2)', () => {
    test('FROZEN_HISTORY_SURFACES lists both protected surfaces', () => {
        expect(FROZEN_HISTORY_SURFACES).toEqual(['apps/web/src/modules/history/', 'packages/contracts/src/history.ts']);
    });

    test('passes when the frozen surfaces are unchanged', () => {
        const result = historySurfaceFreezeCheck(repo, { defaultBranch: 'main' });
        expect(result.ok).toBe(true);
        expect(result.changes).toHaveLength(0);
        expect(result.base).toBe(resolveFrozenBase(repo, 'main'));
    });

    test('fails naming the path when a frozen web file changes', async () => {
        await write(FROZEN_WEB, 'export const SummaryTab = "changed";\n');
        const result = historySurfaceFreezeCheck(repo, { defaultBranch: 'main' });
        expect(result.ok).toBe(false);
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]?.path).toBe(FROZEN_WEB);
        expect(result.changes[0]?.added).toBe(1);
    });

    test('fails naming the path when the frozen contract changes', async () => {
        await write(FROZEN_CONTRACT, 'export const history = false;\n');
        const result = historySurfaceFreezeCheck(repo, { defaultBranch: 'main' });
        expect(result.ok).toBe(false);
        expect(result.changes.some((c) => c.path === FROZEN_CONTRACT)).toBe(true);
    });

    test('fails when an untracked file lands under a frozen surface', async () => {
        await createUntracked('apps/web/src/modules/history/NewTab.tsx', 'export const NewTab = 1;\n');
        const result = historySurfaceFreezeCheck(repo, { defaultBranch: 'main' });
        expect(result.ok).toBe(false);
        expect(result.changes.some((c) => c.path === 'apps/web/src/modules/history/NewTab.tsx')).toBe(true);
    });

    test('passes for an unrelated change elsewhere', async () => {
        await write(UNRELATED, 'export const x = 2;\n');
        const result = historySurfaceFreezeCheck(repo, { defaultBranch: 'main' });
        expect(result.ok).toBe(true);
        expect(result.changes).toHaveLength(0);
    });

    test('uses the merge base, not HEAD~1 — a change-then-revert is not flagged', async () => {
        git(['checkout', '-q', '-b', 'feature']);

        // Change the frozen file, commit it.
        await write(FROZEN_WEB, 'export const SummaryTab = () => null;\nexport const touch = 1;\n');
        git(['add', '--', FROZEN_WEB]);
        git(['commit', '-q', '-m', 'change']);

        // Revert it to the merge-base content, commit the revert.
        git(['checkout', '-q', 'main', '--', FROZEN_WEB]);
        git(['commit', '-q', '-m', 'revert']);

        // HEAD~1 (the change commit) differs from main — a HEAD~1 gate would flag it.
        const head1Diff = git(['diff', 'HEAD~1', '--', FROZEN_WEB]);
        // ...but the merge-base diff is clean, so the gate must pass.
        const result = historySurfaceFreezeCheck(repo, { defaultBranch: 'main' });
        expect(head1Diff).not.toBe('');
        expect(result.ok).toBe(true);
        expect(result.changes).toHaveLength(0);
    });
});
