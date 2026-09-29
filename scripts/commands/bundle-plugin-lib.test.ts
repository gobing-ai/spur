import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleResidualScanLib } from './bundle-plugin-lib';

describe('bundleStepProfileLib (task 1005 R1)', () => {
    test('generated artifacts exist and are committed', () => {
        const mjs = join(import.meta.dir, '../../plugins/sp/lib/step-profile.generated.mjs');
        const dmts = join(import.meta.dir, '../../plugins/sp/lib/step-profile.generated.d.mts');
        expect(existsSync(mjs)).toBeTrue();
        expect(existsSync(dmts)).toBeTrue();
    });

    test('regeneration is deterministic and exports the aggregation core', async () => {
        const before = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/step-profile.generated.mjs'), 'utf8');
        // Build in the release process boundary: Bun's in-process test loader can rewrite
        // cached workspace modules while the bundler reads their dependency graph.
        const result = Bun.spawnSync(
            [
                'bun',
                '-e',
                'import { bundleStepProfileLib } from "./scripts/commands/bundle-plugin-lib"; await bundleStepProfileLib();',
            ],
            { cwd: join(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
        );
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        const after = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/step-profile.generated.mjs'), 'utf8');
        for (const name of [
            'buildStepProfile',
            'nearestRankP50',
            'extractExecutions',
            'rowFlags',
            'nonDryRuns',
            'formatStepProfileHuman',
        ]) {
            expect(after).toContain(name);
        }
        expect(after).toBe(before);
    });

    test('runtime exports and declared names are the same set', async () => {
        const lib = join(import.meta.dir, '../../plugins/sp/lib');
        const exported = Object.keys(await import(join(lib, 'step-profile.generated.mjs'))).sort();
        const dmts = readFileSync(join(lib, 'step-profile.generated.d.mts'), 'utf8');
        const declared = [...dmts.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
        expect(declared).toEqual(exported);
    });
});

describe('bundleHistoryAnatomyLib (task 1005 R2)', () => {
    test('generated artifacts exist and are committed', () => {
        const mjs = join(import.meta.dir, '../../plugins/sp/lib/history-anatomy.generated.mjs');
        const dmts = join(import.meta.dir, '../../plugins/sp/lib/history-anatomy.generated.d.mts');
        expect(existsSync(mjs)).toBeTrue();
        expect(existsSync(dmts)).toBeTrue();
    });

    test('regeneration is deterministic and exports the cache core', async () => {
        const before = readFileSync(
            join(import.meta.dir, '../../plugins/sp/lib/history-anatomy.generated.mjs'),
            'utf8',
        );
        const result = Bun.spawnSync(
            [
                'bun',
                '-e',
                'import { bundleHistoryAnatomyLib } from "./scripts/commands/bundle-plugin-lib"; await bundleHistoryAnatomyLib();',
            ],
            { cwd: join(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
        );
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        const after = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/history-anatomy.generated.mjs'), 'utf8');
        for (const name of [
            'semanticArtifactDigest',
            'decideCache',
            'checkReportStructure',
            'publishAtomically',
            'probe',
            'diffPorcelain',
        ]) {
            expect(after).toContain(name);
        }
        expect(after).toBe(before);
    });

    test('the bundle stays standalone — only node builtin runtime imports (task 1005 R4)', async () => {
        const mjs = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/history-anatomy.generated.mjs'), 'utf8');
        for (const imported of new Bun.Transpiler({ loader: 'js' }).scanImports(mjs)) {
            expect(imported.path.startsWith('node:') || imported.path.startsWith('bun:')).toBe(true);
        }
    });

    test('runtime exports and declared names are the same set', async () => {
        const lib = join(import.meta.dir, '../../plugins/sp/lib');
        const exported = Object.keys(await import(join(lib, 'history-anatomy.generated.mjs'))).sort();
        const dmts = readFileSync(join(lib, 'history-anatomy.generated.d.mts'), 'utf8');
        const declared = [...dmts.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
        expect(declared).toEqual(exported);
    });
});

describe('bundleResidualScanLib (task 1003 R5)', () => {
    test('generated artifacts exist and are committed', () => {
        const mjs = join(import.meta.dir, '../../plugins/sp/lib/residual-scan.generated.mjs');
        const dmts = join(import.meta.dir, '../../plugins/sp/lib/residual-scan.generated.d.mts');
        expect(existsSync(mjs)).toBeTrue();
        expect(existsSync(dmts)).toBeTrue();
    });

    test('regeneration is deterministic and exports the pure core', async () => {
        const before = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/residual-scan.generated.mjs'), 'utf8');
        const result = await bundleResidualScanLib();
        expect(result.mjs.endsWith('residual-scan.generated.mjs')).toBeTrue();
        expect(result.dmts.endsWith('residual-scan.generated.d.mts')).toBeTrue();
        const after = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/residual-scan.generated.mjs'), 'utf8');
        for (const name of ['scanResiduals', 'classify', 'foldVerdict', 'renderReport', 'parseReviewFindings']) {
            expect(after).toContain(name);
        }
        expect(after).toBe(before);
    });
});

describe('bundleIdeaHandoffLib (task 0824)', () => {
    // Regeneration resolves workspace deps through the repo gate invocation (`bun test ./scripts`
    // or `bun run build:plugin-lib`); Bun's resolver quirks on the explicit single-file form.
    test('generated artifacts exist and are committed', () => {
        const mjs = join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs');
        const dmts = join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.d.mts');
        expect(existsSync(mjs)).toBeTrue();
        expect(existsSync(dmts)).toBeTrue();
    });

    test('regeneration is deterministic and exports the handoff CLI entry', async () => {
        const before = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs'), 'utf8');
        // Build in the release process boundary: Bun's in-process test loader can rewrite
        // cached workspace modules while the bundler reads their dependency graph.
        const result = Bun.spawnSync(
            [
                'bun',
                '-e',
                'import { bundleIdeaHandoffLib } from "./scripts/commands/bundle-plugin-lib"; await bundleIdeaHandoffLib();',
            ],
            { cwd: join(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
        );
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        const after = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs'), 'utf8');
        expect(after).toContain('runIdeaHandoffCli');
        expect(after).toBe(before);
    });

    test('the bundle carries no truthy import.meta.main guard', () => {
        // The `import.meta.main: false` define must hold: importing the bundle (the twin does)
        // must never trigger the CLI entrypoint — the twin calls runIdeaHandoffCli itself.
        const mjs = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs'), 'utf8');
        expect(mjs).not.toContain('import.meta.main');
    });
});

test('inline application bundle regenerates deterministically with only runtime builtin imports', () => {
    const path = join(import.meta.dir, '../../plugins/sp/lib/inline-run.generated.mjs');
    const before = readFileSync(path, 'utf8');
    // Build in the release process boundary: Bun's in-process test loader can rewrite
    // cached workspace modules while the bundler reads their dependency graph.
    const result = Bun.spawnSync(
        [
            'bun',
            '-e',
            'import { bundleInlineRunLib } from "./scripts/commands/bundle-plugin-lib"; await bundleInlineRunLib();',
        ],
        { cwd: join(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const after = readFileSync(path, 'utf8');
    expect(after).toBe(before);
    expect(existsSync(path.replace(/\.mjs$/, '.d.mts'))).toBe(true);
    for (const imported of new Bun.Transpiler({ loader: 'js' }).scanImports(after)) {
        expect(imported.path.startsWith('node:') || imported.path.startsWith('bun:')).toBe(true);
    }
});

test('inline-run runtime exports and declared names are the same set (task 0972)', async () => {
    // Tripwire for drift between the committed artifacts: a name exported without a declaration
    // (or declared without an export) fails here even if the generator table is bypassed.
    const lib = join(import.meta.dir, '../../plugins/sp/lib');
    const exported = Object.keys(await import(join(lib, 'inline-run.generated.mjs'))).sort();
    const dmts = readFileSync(join(lib, 'inline-run.generated.d.mts'), 'utf8');
    const declared = [...dmts.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
    expect(declared).toEqual(exported);
});
