/**
 * The module UI kit's authoring types must resolve from the INSTALLED package (A81 1349 R4).
 *
 * The proof runs a real TypeScript program from a temporary consumer directory whose only
 * dependency surface is the workspace `node_modules` — where `@gobing-ai/spur` is the CLI
 * package itself. Resolution therefore goes through that package's `exports` map
 * (`./board/ui` -> the generated declaration mirror), exactly as it does for a downstream
 * project after `npm install`, with no Spur source path on the resolution route.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const WEB_ROOT = join(import.meta.dir, '..', '..');
const REPO_ROOT = join(WEB_ROOT, '..', '..');

const CONSUMER = `import { ModuleHeader, ModuleShell, ModuleTabs, TimeRangePresets, Diagnostic, EmptyState, Loading, Card, Badge, Button } from '@gobing-ai/spur/board/ui';
import type { ModuleTab } from '@gobing-ai/spur/board/ui';

const tabs: readonly ModuleTab[] = [{ id: 'a', label: 'A' }];

export function entry(): unknown {
    return (
        <ModuleShell>
            <ModuleHeader
                icon={<span />}
                title="Consumer"
                filters={<TimeRangePresets presets={['1h', 'all']} value="1h" onChange={() => {}} />}
                tabs={<ModuleTabs tabs={tabs} value="a" onChange={() => {}} label="Consumer tabs" idPrefix="c" />}
            />
            <EmptyState>nothing yet</EmptyState>
            <Diagnostic title="failed" hint="retry" />
            <Card><Badge>ok</Badge><Button size="sm">Go</Button><Loading size="sm" /></Card>
        </ModuleShell>
    );
}
`;

const dirs: string[] = [];

afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A consumer directory whose `node_modules` is the workspace install. */
function consumerDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-kit-consumer-'));
    dirs.push(dir);
    const modules = join(dir, 'node_modules');
    mkdirSync(join(modules, '@gobing-ai'), { recursive: true });
    // The installed package IS apps/cli, so resolution goes through its real `exports` map — the
    // route a downstream `npm install @gobing-ai/spur` takes. React comes from the web workspace,
    // standing in for the consumer's own dependency install.
    symlinkSync(join(REPO_ROOT, 'apps/cli'), join(modules, '@gobing-ai/spur'), 'dir');
    for (const name of ['react', 'react-dom', '@types']) {
        symlinkSync(join(WEB_ROOT, 'node_modules', name), join(modules, name), 'dir');
    }
    writeFileSync(join(dir, 'consumer.tsx'), CONSUMER, 'utf-8');
    return dir;
}

/** Compile the consumer and return the diagnostics TypeScript reported. */
function diagnosticsFor(dir: string): string[] {
    const file = join(dir, 'consumer.tsx');
    const program = ts.createProgram({
        rootNames: [file],
        options: {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            jsx: ts.JsxEmit.ReactJSX,
            lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            jsxImportSource: 'react',
            types: [],
        },
    });
    return ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

describe('installed-package kit types (R4)', () => {
    test('an entry importing the kit specifier typechecks with no Spur source path', () => {
        const dir = consumerDir();
        // Resolution is only faithful if the request cannot fall back to a relative path: the
        // consumer lives outside the checkout and imports the bare specifier.
        expect(dir.startsWith(REPO_ROOT)).toBe(false);
        expect(diagnosticsFor(dir)).toEqual([]);
    });

    test('the kit is reachable only through the package exports map', () => {
        const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/cli/package.json'), 'utf-8')) as {
            exports?: Record<string, { types?: string }>;
            files?: string[];
        };
        expect(pkg.exports?.['./board/ui']?.types).toBe('./board/kit/module-kit/index.d.ts');
        // The declaration mirror ships with the package (the `board` directory is in `files`).
        expect(pkg.files).toContain('board');
    });
});
