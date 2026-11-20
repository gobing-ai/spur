/**
 * emit-board-types failure paths and writer behaviour (A94 1410).
 *
 * The committed artifact tests live in `emit-board-types.test.ts`; this suite pins what happens when
 * the authoring sources are wrong, because every one of these branches would otherwise ship a
 * silently empty or drifted published declaration:
 *   - a missing or non-compiling authoring source
 *   - an authoring source that lost a frozen ABI line
 *   - a kit declaration emitted outside the mirror root (its relative imports would break)
 *   - a kit barrel missing a primitive the published entry must re-export
 * plus the two writers: a first write reports `changed`, an idempotent re-run does not rewrite.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    emitBoardDeclarations,
    emitKitDeclarations,
    renderBoardDeclaration,
    renderKitDeclarations,
} from '../../src/builder/emit-board-types';

/** A contribution source carrying the frozen ABI without depending on React's types. */
const CONTRIBUTION = `interface ComponentType { readonly displayName?: string }

export interface BoardModuleContribution {
    readonly apiVersion: 1;
    readonly component: ComponentType;
    readonly rightPanelComponent?: ComponentType;
}

export const webModule = {} as BoardModuleContribution;
`;

/** A kit whose barrel re-exports every primitive the published entry must carry. */
const KIT_FILES: Record<string, string> = {
    'apps/web/src/components/module-kit/index.ts': [
        "export { Diagnostic } from './Diagnostic';",
        "export { EmptyState } from './EmptyState';",
        "export { ModuleHeader } from './ModuleHeader';",
        "export { ModuleShell } from './ModuleShell';",
        "export { type ModuleTab, ModuleTabs } from './ModuleTabs';",
        "export { TimeRangePresets } from './TimeRangePresets';",
        "export { Loading } from './Loading';",
        "export { Card, CardBody } from './Card';",
        "export { Badge } from './Badge';",
        "export { Button } from './Button';",
        '',
    ].join('\n'),
    'apps/web/src/components/module-kit/Diagnostic.ts': 'export function Diagnostic() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/EmptyState.ts': 'export function EmptyState() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/ModuleHeader.ts': 'export function ModuleHeader() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/ModuleShell.ts': 'export function ModuleShell() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/ModuleTabs.ts':
        'export type ModuleTab = { id: string };\nexport function ModuleTabs() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/TimeRangePresets.ts':
        'export function TimeRangePresets() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/Loading.ts': 'export function Loading() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/Card.ts':
        'export function Card() {\n    return null;\n}\nexport function CardBody() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/Badge.ts': 'export function Badge() {\n    return null;\n}\n',
    'apps/web/src/components/module-kit/Button.ts': 'export function Button() {\n    return null;\n}\n',
};

/** Build a throwaway source root from `files` (relative path → content). */
async function sourceRoot(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'spur-board-'));
    for (const [relative, content] of Object.entries(files)) {
        const target = join(root, relative);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf-8');
    }
    return root;
}

describe('renderBoardDeclaration refusals', () => {
    test('a missing authoring source fails with the path it looked for', async () => {
        const root = await sourceRoot({});
        try {
            expect(() => renderBoardDeclaration(root)).toThrow(/cannot load .*contribution\.ts/);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a non-compiling authoring source fails with its diagnostics', async () => {
        const root = await sourceRoot({
            'apps/web/src/modules/contribution.ts': 'export const broken: number = "not a number";\n',
        });
        try {
            expect(() => renderBoardDeclaration(root)).toThrow(/does not compile/);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('an authoring source that lost a frozen ABI line is refused', async () => {
        const root = await sourceRoot({
            'apps/web/src/modules/contribution.ts': CONTRIBUTION.replace('readonly apiVersion: 1;\n', ''),
        });
        try {
            expect(() => renderBoardDeclaration(root)).toThrow(/frozen contribution ABI line/);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('renderKitDeclarations refusals', () => {
    test('a barrel entry that pulls a declaration outside the mirror root is refused', async () => {
        const files = {
            ...KIT_FILES,
            'apps/web/src/lib/outside.ts': 'export function Outside() {\n    return null;\n}\n',
            'apps/web/src/components/module-kit/index.ts': `${KIT_FILES['apps/web/src/components/module-kit/index.ts']}export { Outside } from '../../lib/outside';\n`,
        };
        const root = await sourceRoot(files);
        try {
            expect(() => renderKitDeclarations(root)).toThrow(/falls outside/);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a primitive that does not declare itself is refused by name', async () => {
        const files = {
            ...KIT_FILES,
            // Still re-exported by the barrel, so the frozen-entry check passes and the failure lands on
            // the primitive's own declaration check.
            'apps/web/src/components/module-kit/Diagnostic.ts': "export const Diagnostic = { name: 'diagnostic' };\n",
        };
        const root = await sourceRoot(files);
        try {
            expect(() => renderKitDeclarations(root)).toThrow(/module-kit\/Diagnostic\.d\.ts.*must declare/);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('the writers report change state and stay idempotent', () => {
    test('emitKitDeclarations writes the mirror once, then reports an unchanged re-run', async () => {
        const root = await sourceRoot(KIT_FILES);
        const out = await mkdtemp(join(tmpdir(), 'spur-kit-out-'));
        try {
            const first = await emitKitDeclarations({ sourceRoot: root, root: out });
            expect(first.artifacts[0]?.kind).toBe('kit:11 files:changed');
            const entry = await readFile(join(out, 'module-kit/index.d.ts'), 'utf-8');
            expect(entry.startsWith('// Generated by scripts/commands/emit-board-types.ts from')).toBe(true);
            const second = await emitKitDeclarations({ sourceRoot: root, root: out });
            expect(second.artifacts[0]?.kind).toBe('kit:11 files:unchanged');
        } finally {
            await rm(root, { recursive: true, force: true });
            await rm(out, { recursive: true, force: true });
        }
    });

    test('emitBoardDeclarations writes the artifact once, then reports an unchanged re-run', async () => {
        const root = await sourceRoot({ 'apps/web/src/modules/contribution.ts': CONTRIBUTION });
        const out = await mkdtemp(join(tmpdir(), 'spur-board-out-'));
        try {
            const target = join(out, 'board', 'index.d.ts');
            const first = await emitBoardDeclarations({ sourceRoot: root, target });
            expect(first.artifacts[0]).toEqual({ path: target, kind: 'board:changed' });
            expect((await readFile(target, 'utf-8')).startsWith('// Generated by scripts/commands/')).toBe(true);
            const second = await emitBoardDeclarations({ sourceRoot: root, target });
            expect(second.artifacts[0]).toEqual({ path: target, kind: 'board:unchanged' });
        } finally {
            await rm(root, { recursive: true, force: true });
            await rm(out, { recursive: true, force: true });
        }
    });
});
