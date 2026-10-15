/**
 * PR-L lazy CLI loading — structural guarantees, checked on the real source graph.
 *
 * Walks **static** import edges only (`Bun.Transpiler.scanImports`, which drops type-only imports
 * and labels `import()` as `dynamic-import`), resolving workspace sources and stopping at external
 * packages. That proves what a launch evaluates before any dynamic import runs.
 */

import { describe, expect, test } from 'bun:test';
import { dirname, join, relative, resolve } from 'node:path';
import { REGISTRATION_STEPS } from '../src/program';

const REPO = resolve(import.meta.dir, '..', '..', '..');
const SRC = join(REPO, 'apps', 'cli', 'src');
const transpiler = new Bun.Transpiler({ loader: 'ts' });

interface Edge {
    kind: string;
    path: string;
}

async function scan(file: string): Promise<Edge[]> {
    const text = (await Bun.file(file).text()).replace(/^#!.*\n/, '\n');
    return transpiler.scanImports(text) as Edge[];
}

/** Resolve a specifier to a workspace source file, or null for an external package. */
function resolveLocal(spec: string, from: string): string | null {
    const resolved = Bun.resolveSync(spec, dirname(from));
    return resolved.startsWith(REPO) && !resolved.includes('/node_modules/') ? resolved : null;
}

/** Static closure from `entry`: workspace files reached plus every external specifier seen. */
async function staticClosure(entry: string): Promise<{ files: Set<string>; externals: Set<string> }> {
    const files = new Set<string>();
    const externals = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (files.has(file)) continue;
        files.add(file);
        for (const edge of await scan(file)) {
            if (edge.kind !== 'import-statement' && edge.kind !== 'require-call') continue;
            if (edge.path.startsWith('node:') || edge.path.startsWith('bun:')) continue;
            const local = resolveLocal(edge.path, file);
            if (local === null) externals.add(edge.path);
            else queue.push(local);
        }
    }
    return { files, externals };
}

const rel = (file: string) => relative(REPO, file);

/** Modules a boot-free invocation must never evaluate. */
const HEAVY_FILES = [
    'apps/cli/src/cli-runtime.ts',
    'apps/cli/src/context.ts',
    'apps/cli/src/config/embedded-schemas.ts',
    'packages/app/src/index.ts',
    'packages/config/src/index.ts',
    'packages/config/src/loader.ts',
    'packages/domain/src/index.ts',
];
const HEAVY_EXTERNALS = ['@gobing-ai/ts-db', '@gobing-ai/ts-infra/application-node', 'figlet', 'zod'];

describe('boot-free entry graph', () => {
    for (const entry of ['index.ts', 'self-hook.ts']) {
        test(`${entry} statically reaches no DB, config loader, app barrel or banner`, async () => {
            const { files, externals } = await staticClosure(join(SRC, entry));
            const reached = [...files].map(rel);
            expect(reached.filter((file) => HEAVY_FILES.includes(file))).toEqual([]);
            expect(
                reached.filter(
                    (file) => file.startsWith('apps/cli/src/commands/') && !file.endsWith('shared-options.ts'),
                ),
            ).toEqual([]);
            expect([...externals].filter((spec) => HEAVY_EXTERNALS.includes(spec))).toEqual([]);
        });
    }

    test('the full runtime still pins ts-db into the static graph for --compile', async () => {
        const edges = await scan(join(SRC, 'cli-runtime.ts'));
        expect(edges).toContainEqual({ kind: 'import-statement', path: '@gobing-ai/ts-db' });
    });
});

describe('command registry', () => {
    test('every command module is reached through a string-literal dynamic import (bundled by --compile)', async () => {
        const text = await Bun.file(join(SRC, 'program.ts')).text();
        const dynamic = (await scan(join(SRC, 'program.ts'))).filter((edge) => edge.kind === 'dynamic-import');
        // Every `import(` call in the registry takes a string literal; a variable specifier would not be bundled.
        expect(text.match(/\bimport\(\s*[^'")\s]/g) ?? []).toEqual([]);
        expect(dynamic.length).toBe((text.match(/\bimport\(\s*'/g) ?? []).length);
        for (const edge of dynamic) expect(resolveLocal(edge.path, join(SRC, 'program.ts'))).not.toBeNull();
        expect(new Set(dynamic.map((edge) => edge.path)).size).toBe(16);
    });

    test('nouns are unique and keep the help-listing order', () => {
        expect(REGISTRATION_STEPS.map((step) => step.noun)).toEqual([
            'agent',
            'builder',
            'decision',
            'feature',
            'history',
            'message',
            'projects',
            'rule',
            'self',
            'init',
            'maintain',
            'migrate',
            'serve',
            'status',
            'task',
            'workflow',
        ]);
    });

    test('no command module statically imports the entry, the registry or the runtime (no cycles)', async () => {
        const banned = new Set(['index.ts', 'program.ts', 'cli-runtime.ts'].map((file) => join(SRC, file)));
        const offenders: string[] = [];
        const glob = new Bun.Glob('**/*.ts');
        for await (const file of glob.scan({ cwd: SRC, absolute: true })) {
            if (banned.has(file)) continue;
            for (const edge of await scan(file)) {
                if (!edge.path.startsWith('.')) continue;
                const target = resolveLocal(edge.path, file);
                if (target !== null && banned.has(target)) offenders.push(`${rel(file)} -> ${edge.path}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
