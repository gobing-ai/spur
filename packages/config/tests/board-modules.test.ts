import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    BOARD_MODULE_ID_PATTERN,
    BoardModuleConfigError,
    boardModuleRoute,
    isBoardModuleConfigError,
    isSafeFrameUrl,
    parseBoardModuleDeclarations,
    spurConfigSchema,
    validateBoardModuleDeclarations,
} from '../src/index';

// Task 0989 R1/R2/AC4 — the config layer of the catalog deliverable: one strict declaration
// shape under `bootstrap.modules`, cross-declaration rules that need the host inventory, and
// frame URLs rejected as configuration errors rather than as broken frames later.

/** Reserved identities as `board-runtime.json` publishes them. */
const reserved = [
    { id: 'workspace', route: '/board/projects' },
    { id: 'inbox', route: '/board/projects/conversation', retired: true as const, redirectTo: '/board/projects' },
];

const reactDeclaration = {
    id: 'kanban',
    name: 'Kanban',
    icon: 'K',
    type: 'react',
    directory: 'board/kanban',
    entry: 'index.js',
};

describe('bootstrap.modules declaration shape (R1)', () => {
    test('defaults enabled true and styles empty, preserving bootstrap.options', () => {
        const config = spurConfigSchema.parse({
            bootstrap: { options: { keep: 'me' }, modules: [reactDeclaration] },
        });
        expect(config.bootstrap?.options).toEqual({ keep: 'me' });
        expect(config.bootstrap?.modules).toHaveLength(1);
        expect(config.bootstrap?.modules?.[0]).toMatchObject({ id: 'kanban', enabled: true, styles: [] });
    });

    test('a config without modules keeps its previous shape', () => {
        const config = spurConfigSchema.parse({ bootstrap: { options: {} } });
        expect(config.bootstrap?.modules).toBeUndefined();
    });

    test('the iframe variant carries url and no directory fields', () => {
        const parsed = parseBoardModuleDeclarations([
            { id: 'docs', name: 'Docs', icon: 'D', type: 'iframe', url: 'https://docs.example.com', enabled: false },
        ]);
        expect(parsed[0]).toMatchObject({ type: 'iframe', url: 'https://docs.example.com', enabled: false });
    });

    test('unknown, mixed and malformed fields are rejected', () => {
        const cases: unknown[] = [
            { ...reactDeclaration, widget: true },
            { ...reactDeclaration, url: 'https://example.com' },
            { id: 'docs', name: 'Docs', icon: 'D', type: 'iframe', url: 'https://example.com', directory: 'x' },
            { ...reactDeclaration, id: 'Kanban' },
            { ...reactDeclaration, name: '' },
            { ...reactDeclaration, icon: '' },
            { ...reactDeclaration, order: Number.POSITIVE_INFINITY },
            { ...reactDeclaration, type: 'web-component' },
        ];
        for (const declaration of cases) {
            expect(() => parseBoardModuleDeclarations([declaration])).toThrow(z.ZodError);
        }
    });

    test('every optional field is accepted, and an absent list parses to none', () => {
        const parsed = parseBoardModuleDeclarations([
            {
                id: 'notes',
                name: 'Notes',
                icon: 'N',
                type: 'react',
                directory: 'board/notes',
                entry: 'index.js',
                styles: ['a.css', 'b.css'],
                sidebarLabel: 'Notes',
                description: 'Project notes',
                order: 1.5,
                enabled: false,
            },
        ]);
        expect(parsed[0]).toMatchObject({ order: 1.5, styles: ['a.css', 'b.css'], enabled: false });
        expect(parseBoardModuleDeclarations(undefined)).toEqual([]);
    });

    test('the id pattern is the one the declarations enforce', () => {
        expect(BOARD_MODULE_ID_PATTERN.test('kanban-2')).toBe(true);
        expect(BOARD_MODULE_ID_PATTERN.test('-kanban')).toBe(false);
    });
});

describe('frame URLs are configuration errors when unusable (R2/AC4)', () => {
    test('absolute credential-free http(s) URLs keep their value', () => {
        expect(isSafeFrameUrl('https://docs.example.com/board?x=1')).toBe(true);
        expect(isSafeFrameUrl('http://localhost:8080/')).toBe(true);
        const frame = parseBoardModuleDeclarations([
            { id: 'docs', name: 'Docs', icon: 'D', type: 'iframe', url: 'https://docs.example.com/board' },
        ])[0];
        if (frame?.type !== 'iframe') throw new Error('expected the iframe declaration to survive parsing');
        expect(frame.url).toBe('https://docs.example.com/board');
    });

    test('relative URLs, other schemes and embedded credentials are rejected', () => {
        for (const url of [
            '/board',
            'docs/board',
            'ftp://example.com',
            'javascript:alert(1)',
            'https://u:p@example.com',
        ]) {
            expect(isSafeFrameUrl(url)).toBe(false);
            expect(() =>
                parseBoardModuleDeclarations([{ id: 'docs', name: 'Docs', icon: 'D', type: 'iframe', url }]),
            ).toThrow(z.ZodError);
        }
    });
});

describe('cross-declaration rules (R2)', () => {
    const first = { ...reactDeclaration } as const;
    const second = { ...reactDeclaration, id: 'notes', directory: 'board/notes' };

    test('valid declarations pass and resolve a derived route', () => {
        const parsed = parseBoardModuleDeclarations([first, second], reserved);
        expect(parsed.map((declaration) => declaration.id)).toEqual(['kanban', 'notes']);
        expect(boardModuleRoute('kanban')).toBe('/modules/kanban');
    });

    test('duplicate ids fail, including when one of them is disabled', () => {
        const error = (() => {
            try {
                parseBoardModuleDeclarations([first, { ...first, enabled: false }], reserved);
            } catch (thrown) {
                return thrown;
            }
            return undefined;
        })();
        expect(error).toBeInstanceOf(BoardModuleConfigError);
        expect((error as Error).message).toContain('duplicate module id "kanban"');
        expect((error as Error).message).toContain('bootstrap.modules[1]');
    });

    test('collisions with a host or retired identity fail by index and reason', () => {
        expect(() => validateBoardModuleDeclarations([{ ...first, id: 'workspace' } as never], reserved)).toThrow(
            /collides with host module "workspace"/,
        );
        expect(() => validateBoardModuleDeclarations([{ ...first, id: 'inbox' } as never], reserved)).toThrow(
            /collides with retired host identity "inbox"/,
        );
        expect(() =>
            validateBoardModuleDeclarations([{ ...first, id: 'workspace', enabled: false } as never], reserved),
        ).toThrow(BoardModuleConfigError);
    });

    test('the config-load failure detector recognises a module-declaration error', () => {
        const loaderFailure = new Error(
            'Spur config validation failed after merging global (absent) with project .spur/config.yaml:\n  bootstrap.modules[0].url: iframe url must be an absolute http(s) URL',
        );
        expect(isBoardModuleConfigError(loaderFailure)).toBe(true);
        expect(isBoardModuleConfigError(new Error('Failed to parse project config: tabs'))).toBe(false);
        expect(isBoardModuleConfigError(new BoardModuleConfigError(0, 'kanban', 'was not found'))).toBe(true);
    });
});
