/**
 * Root test lane classifier (task 1459 R1/R2).
 *
 * Failure modes first — each would put a spawning test in the in-process lane (where it
 * times out under full fan-out) or redden the drift guard on a correct manifest:
 *   - a direct spawn token goes unclassified (Bun.spawn / spawnSync / execSync / child_process / `$`)
 *   - a shell template `` $`cmd` `` is missed because it is not a call expression
 *   - an aliased helper import (`import { runCli as run }`) is missed
 *   - an import resolves to the helper but only a non-spawning export is used
 *   - a helper that spawns *through another helper* is over-classified (documented one-level limit)
 *   - a relative specifier without `.ts` / with an index file fails to resolve
 *   - membership drift is not reported, or the report loses the offending path
 *   - the manifest reader accepts a malformed document
 *   - JUnit timings are not summed per file
 */
import { describe, expect, test } from 'bun:test';
import {
    classifyTestFiles,
    diffLaneManifest,
    type LaneEntry,
    type LaneManifest,
    type LaneReason,
    parseJunitTimings,
    readLaneManifest,
    type TestSource,
} from '@gobing-ai/spur-app';

const source = (path: string, content: string): TestSource => ({ path, content });

const manifest = (subprocess: { path: string; reason: LaneReason }[]): LaneManifest => ({
    version: 1,
    root: { subprocess },
});

describe('classifyTestFiles', () => {
    test('classifies a direct spawn token', () => {
        const entries = classifyTestFiles([source('apps/cli/tests/a.test.ts', "const p = Bun.spawn(['echo']);")], []);
        expect(entries).toEqual([{ path: 'apps/cli/tests/a.test.ts', reason: 'direct' }]);
    });

    test('classifies a shell-template spawn', () => {
        const entries = classifyTestFiles(
            [source('scripts/tests/b.test.ts', 'const out = await $`git status --porcelain`;')],
            [],
        );
        expect(entries.map((entry) => entry.reason)).toEqual(['direct']);
    });

    test('classifies a test that imports a spawning helper under an alias', () => {
        const entries = classifyTestFiles(
            [source('apps/cli/tests/c.test.ts', "import { runCli as run } from './helpers';\nrun('x');")],
            [
                source(
                    'apps/cli/tests/helpers.ts',
                    'export async function runCli(args: string[]) {\n    const p = Bun.spawn(args);\n    return await p.exited;\n}',
                ),
            ],
        );
        expect(entries).toEqual([
            { path: 'apps/cli/tests/c.test.ts', reason: 'helper:apps/cli/tests/helpers.ts#runCli' },
        ]);
    });

    test('does not classify a test that imports only a non-spawning helper export', () => {
        const entries = classifyTestFiles(
            [source('apps/cli/tests/d.test.ts', "import { makeTemp } from './helpers';\nmakeTemp();")],
            [
                source(
                    'apps/cli/tests/helpers.ts',
                    "export function makeTemp() {\n    return 1;\n}\n\nexport function runCli() {\n    return Bun.spawnSync(['x']);\n}",
                ),
            ],
        );
        expect(entries).toEqual([]);
    });

    test('does not follow a second level of helper indirection', () => {
        const entries = classifyTestFiles(
            [source('apps/cli/tests/e.test.ts', "import { wrapper } from './wrapper';\nwrapper();")],
            [
                source(
                    'apps/cli/tests/wrapper.ts',
                    "import { spawner } from './spawner';\n\nexport function wrapper() {\n    return spawner();\n}",
                ),
                source('apps/cli/tests/spawner.ts', "export function spawner() {\n    return Bun.spawn(['x']);\n}"),
            ],
        );
        expect(entries).toEqual([]);
    });

    test('resolves a helper specifier with an index file and an explicit extension', () => {
        const helpers = [
            source('plugins/sp/tests/helpers/index.ts', 'export const run = () => Bun.spawn([]);'),
            source('plugins/sp/tests/direct.ts', 'export const run2 = () => execSync("x");'),
        ];
        const entries = classifyTestFiles(
            [
                source('plugins/sp/tests/f.test.ts', "import { run } from './helpers';\nrun();"),
                source('plugins/sp/tests/g.test.ts', "import { run2 } from './direct.ts';\nrun2();"),
            ],
            helpers,
        );
        expect(entries.map((entry) => entry.reason)).toEqual([
            'helper:plugins/sp/tests/helpers/index.ts#run',
            'helper:plugins/sp/tests/direct.ts#run2',
        ]);
    });

    test('classifies a helper export written as a brace-bodied arrow or a function expression', () => {
        const entries = classifyTestFiles(
            [
                source(
                    'apps/cli/tests/h.test.ts',
                    "import { arrow, expression } from './shapes';\narrow();\nexpression();",
                ),
            ],
            [
                source(
                    'apps/cli/tests/shapes.ts',
                    "export const arrow = () => {\n    return Bun.spawn(['x']);\n};\nexport const expression = function () {\n    return spawnSync('x');\n};\nexport const plain = 1;",
                ),
            ],
        );
        expect(entries.map((entry) => entry.reason)).toEqual(['helper:apps/cli/tests/shapes.ts#arrow']);
    });

    test('classifies a helper export written as a function expression', () => {
        const entries = classifyTestFiles(
            [source('apps/cli/tests/k.test.ts', "import { expression } from './expression';\nexpression();")],
            [
                source(
                    'apps/cli/tests/expression.ts',
                    "export const expression = function () {\n    return spawnSync('x');\n};",
                ),
            ],
        );
        expect(entries.map((entry) => entry.reason)).toEqual(['helper:apps/cli/tests/expression.ts#expression']);
    });

    test('does not classify a test file whose helper source is unterminated', () => {
        // An unterminated string swallows the closing brace, so no body is indexable: malformed
        // source must fail closed rather than classify on a partial slice.
        const entries = classifyTestFiles(
            [source('apps/cli/tests/i.test.ts', "import { broken } from './broken';\nbroken();")],
            [source('apps/cli/tests/broken.ts', 'export function broken() {\n    return Bun.spawn(["x"]);')],
        );
        expect(entries).toEqual([]);
    });

    test('skips escaped quotes inside a helper body', () => {
        const entries = classifyTestFiles(
            [source('apps/cli/tests/j.test.ts', "import { quoted } from './quoted';\nquoted();")],
            [
                source(
                    'apps/cli/tests/quoted.ts',
                    'export function quoted() {\n    return Bun.spawn(["sh", "-c", "echo \\"a } b\\""]);\n}',
                ),
            ],
        );
        expect(entries.map((entry) => entry.reason)).toEqual(['helper:apps/cli/tests/quoted.ts#quoted']);
    });

    test('returns entries sorted by path', () => {
        const entries = classifyTestFiles(
            [
                source('scripts/tests/z.test.ts', 'Bun.spawnSync([]);'),
                source('apps/cli/tests/a.test.ts', 'child_process.spawn("x");'),
                source('packages/app/tests/m.test.ts', 'execFileSync("x");'),
            ],
            [],
        );
        expect(entries.map((entry) => entry.path)).toEqual([
            'apps/cli/tests/a.test.ts',
            'packages/app/tests/m.test.ts',
            'scripts/tests/z.test.ts',
        ]);
    });
});

describe('readLaneManifest', () => {
    test('reads version and root entries', () => {
        expect(readLaneManifest('{"version":1,"root":{"subprocess":[]}}')).toEqual(manifest([]));
    });

    test('preserves unknown top-level keys', () => {
        const parsed = readLaneManifest('{"version":1,"root":{"subprocess":[]},"heavy":[]}');
        expect(parsed.heavy).toEqual([]);
    });

    test('rejects a malformed document', () => {
        const malformed = [
            'not json',
            '[]',
            '{"version":2,"root":{"subprocess":[]}}',
            '{"version":1}',
            '{"version":1,"root":{"subprocess":{}}}',
            '{"version":1,"root":{"subprocess":[null]}}',
            '{"version":1,"root":{"subprocess":[{"path":"","reason":"direct"}]}}',
            '{"version":1,"root":{"subprocess":[{"path":"a.test.ts"}]}}',
            '{"version":1,"root":{"subprocess":[{"path":"a.test.ts","reason":"direct","durationMs":"1"}]}}',
        ];
        for (const document of malformed) expect(() => readLaneManifest(document)).toThrow();
        expect(
            readLaneManifest('{"version":1,"root":{"subprocess":[{"path":"a.test.ts","reason":"direct"}]}}'),
        ).toEqual(manifest([{ path: 'a.test.ts', reason: 'direct' }]));
    });
});

describe('diffLaneManifest', () => {
    test('reports a spawning file the manifest does not list', () => {
        const drift = diffLaneManifest([{ path: 'apps/cli/tests/a.test.ts', reason: 'direct' }], manifest([]));
        expect(drift).toEqual([
            {
                path: 'apps/cli/tests/a.test.ts',
                kind: 'missing',
                detail: 'spawning file missing from config/test-lanes.json',
            },
        ]);
    });

    test('reports a listed file that no longer spawns', () => {
        const drift = diffLaneManifest([], manifest([{ path: 'apps/cli/tests/gone.test.ts', reason: 'direct' }]));
        expect(drift).toEqual([
            {
                path: 'apps/cli/tests/gone.test.ts',
                kind: 'stale',
                detail: 'listed in config/test-lanes.json but no longer classifies as subprocess-spawning',
            },
        ]);
    });

    test('is empty when membership matches', () => {
        const entry: LaneEntry = { path: 'apps/cli/tests/a.test.ts', reason: 'direct' };
        expect(diffLaneManifest([entry], manifest([entry]))).toEqual([]);
    });
});

describe('parseJunitTimings', () => {
    test('sums per-file times and ignores the rest', () => {
        const xml = [
            '<testsuites>',
            '<testsuite name="a">',
            '<testcase name="one" file="apps/cli/tests/a.test.ts" time="0.10" />',
            '<testcase name="two" file="apps/cli/tests/a.test.ts" time="0.25" />',
            '<testcase name="three" file="packages/app/tests/b.test.ts" time="1.00" />',
            '</testsuite>',
            '</testsuites>',
        ].join('\n');
        const timings = parseJunitTimings(xml);
        expect(timings.get('apps/cli/tests/a.test.ts')).toBe(350);
        expect(timings.get('packages/app/tests/b.test.ts')).toBe(1000);
        expect(timings.size).toBe(2);
    });

    test('returns an empty map for a document without timings', () => {
        expect(parseJunitTimings('<testsuites></testsuites>').size).toBe(0);
    });
});
