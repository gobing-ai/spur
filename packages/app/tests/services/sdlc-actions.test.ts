import { describe, expect, test } from 'bun:test';
import { type BuilderConfig, BuilderConfigSchema, SDLC_PRESET_ACTIONS } from '@gobing-ai/spur-config';
import { planLightChecks } from '../../src/services/quality-gate';
import {
    BUN_PRESET,
    isReservedAction,
    listActions,
    RESERVED_ACTIONS,
    renderScoped,
    resolveAction,
} from '../../src/services/sdlc-actions';

/** A validated builder block — the resolver only ever sees schema-parsed input. */
function builder(input: Record<string, unknown>): BuilderConfig {
    return BuilderConfigSchema.parse(input);
}

const SPUR_RULE_PRE = 'spur rule run --preset recommended-pre-check --fail-on warning --no-logo';
const SPUR_RULE_POST = 'spur rule run --preset recommended-post-check --fail-on warning --no-logo';

describe('bun preset byte-identity (task 1222 R4)', () => {
    // Satellite §3.1 "bun preset binding" column, transcribed independently of BUN_PRESET: this
    // table is the pin — if the resolver and today's commands diverge, a test fails, not a repo.
    const SATELLITE: Record<string, string> = {
        build: 'bun run build',
        dev: 'bun run dev',
        clean: 'bun run clean',
        format: 'bun run format',
        autofix: 'bun run autofix',
        lint: 'bun run lint',
        typecheck: 'bun run typecheck',
        test: 'bun run test',
        'test-full': 'bun run test:full',
        'test-heavy': 'bun run test:heavy',
        'rules-pre': 'bun run test-pre-check',
        'rules-post': 'bun run test-post-check',
        check: 'bun run spur-check',
        'check-full': 'bun run spur-check:full',
        'check-feature': 'bun run spur-check-feature',
        'lint-changed': 'bunx biome check {files}',
        'typecheck-changed': 'cd {workspace} && bun run typecheck',
        'test-changed': 'cd {workspace} && bun test {paths}',
    };

    test('every reserved action resolves to the satellite bun literal with no config', () => {
        expect(Object.keys(SATELLITE)).toEqual([...RESERVED_ACTIONS]);
        for (const [name, command] of Object.entries(SATELLITE)) {
            expect(BUN_PRESET[name as keyof typeof BUN_PRESET]).toBe(command);
            expect(resolveAction(undefined, name)).toEqual({
                name,
                reserved: true,
                source: 'preset',
                kind: 'command',
                command,
            });
        }
    });

    test('rendered preset commands equal the current light-gate plan lines', () => {
        const plans = planLightChecks(
            { files: ['src/a b.ts'], workspaces: ['packages/app'], tests: ['packages/app/tests/x.test.ts'] },
            () => true,
        );
        const cmd = (id: string): string => plans.find((plan) => plan.id === id)?.cmd ?? '';
        const lintChanged = resolveAction(undefined, 'lint-changed');
        expect(lintChanged.kind).toBe('command');
        expect(renderScoped(lintChanged.kind === 'command' ? lintChanged.command : '', { files: ['src/a b.ts'] })).toBe(
            cmd('format-lint:changed'),
        );
        const typecheckChanged = resolveAction(undefined, 'typecheck-changed');
        expect(
            renderScoped(typecheckChanged.kind === 'command' ? typecheckChanged.command : '', {
                workspace: 'packages/app',
            }),
        ).toBe(cmd('typecheck:packages/app'));
        const testChanged = resolveAction(undefined, 'test-changed');
        expect(
            renderScoped(testChanged.kind === 'command' ? testChanged.command : '', {
                workspace: 'packages/app',
                paths: ['tests/x.test.ts'],
            }),
        ).toBe(cmd('test:packages/app'));
        expect(resolveAction(undefined, 'rules-pre')).toMatchObject({ command: cmd('rules:pre') });
        expect(resolveAction(undefined, 'rules-post')).toMatchObject({ command: cmd('rules:post') });
    });
});

describe('preset none (task 1222 R5)', () => {
    test('rules-pre/rules-post fall back to the stack-neutral defaults', () => {
        const none = builder({ preset: 'none' });
        expect(resolveAction(none, 'rules-pre')).toEqual({
            name: 'rules-pre',
            reserved: true,
            source: 'default',
            kind: 'command',
            command: SPUR_RULE_PRE,
        });
        expect(resolveAction(none, 'rules-post')).toMatchObject({ source: 'default', command: SPUR_RULE_POST });
    });

    test('every other undeclared reserved action is unbound', () => {
        const none = builder({ preset: 'none' });
        for (const name of RESERVED_ACTIONS.filter((action) => action !== 'rules-pre' && action !== 'rules-post')) {
            expect(resolveAction(none, name)).toEqual({ name, reserved: true, source: 'unbound', kind: 'unbound' });
        }
    });

    // Task 1228 (from the 1222 review): the schema's resolvable set and the resolver's defaults are
    // one fact. This pins the two against each other, so a stack-neutral default added in only one
    // layer fails here instead of surfacing as a spurious "resolves to no action" load error.
    test('the schema resolvable set and the resolver defaults agree for every reserved action', () => {
        const none = builder({ preset: 'none' });
        const resolvable = new Set<string>(SDLC_PRESET_ACTIONS.none);
        for (const name of RESERVED_ACTIONS) {
            const resolved = resolveAction(none, name);
            expect(resolved.source === 'unbound').toBe(!resolvable.has(name));
        }
    });
});

describe('builder.actions binding', () => {
    test('a declared command wins over the preset entry', () => {
        const bound = builder({ actions: { build: 'make build' } });
        expect(resolveAction(bound, 'build')).toEqual({
            name: 'build',
            reserved: true,
            source: 'config',
            kind: 'command',
            command: 'make build',
        });
        expect(resolveAction(bound, 'test')).toMatchObject({ source: 'preset', command: 'bun run test' });
    });

    test('a declared composite replaces the preset entry whole (never merged)', () => {
        const bound = builder({ actions: { check: ['lint', 'test'] } });
        expect(resolveAction(bound, 'check')).toEqual({
            name: 'check',
            reserved: true,
            source: 'config',
            kind: 'composite',
            steps: ['lint', 'test'],
        });
    });

    test('a custom action resolves from config and is not reserved', () => {
        const bound = builder({ preset: 'none', actions: { release: './scripts/release.sh' } });
        expect(resolveAction(bound, 'release')).toEqual({
            name: 'release',
            reserved: false,
            source: 'config',
            kind: 'command',
            command: './scripts/release.sh',
        });
        expect(resolveAction(bound, 'unknown-action')).toMatchObject({ reserved: false, source: 'unbound' });
        expect(isReservedAction('check')).toBe(true);
        expect(isReservedAction('release')).toBe(false);
    });

    test('listActions returns the reserved vocabulary in order, then sorted custom names', () => {
        const listed = listActions(builder({ actions: { zeta: 'z', alpha: 'a', build: 'make build' } }));
        expect(listed.map((action) => action.name)).toEqual([...RESERVED_ACTIONS, 'alpha', 'zeta']);
        expect(listed[0]?.source).toBe('config');
        expect(listed.filter((action) => action.source === 'unbound')).toHaveLength(0);
    });
});

describe('renderScoped (task 1222 R3)', () => {
    test('quotes each item and only the requested placeholders', () => {
        expect(renderScoped('bunx biome check {files}', { files: ['a.ts', 'b c.ts', "d'e.ts"] })).toBe(
            "bunx biome check a.ts 'b c.ts' 'd'\\''e.ts'",
        );
        expect(
            renderScoped('cd {workspace} && bun test {paths}', { workspace: 'packages/app', paths: ['tests/x.ts'] }),
        ).toBe('cd packages/app && bun test tests/x.ts');
        expect(renderScoped('bun run lint', { files: ['a.ts'] })).toBe('bun run lint');
    });

    test('a quoted path containing a replacement pattern is inserted literally', () => {
        expect(renderScoped('bunx biome check {files}', { files: ['$&{files}.ts'] })).toBe(
            "bunx biome check '$&{files}.ts'",
        );
    });

    test('a missing value throws instead of widening the command', () => {
        expect(() => renderScoped('bunx biome check {files}', {})).toThrow('{files}');
        expect(() => renderScoped('cd {workspace} && bun run typecheck', {})).toThrow('{workspace}');
    });

    // Task 1228 (from the 1222 review): an empty list is the same widening hazard as a missing one —
    // `bunx biome check ` with no paths checks the whole repo, `cd ws && bun test` the whole workspace.
    test('an empty list throws instead of widening the command', () => {
        expect(() => renderScoped('bunx biome check {files}', { files: [] })).toThrow('empty list');
        expect(() => renderScoped('cd {workspace} && bun test {paths}', { workspace: 'ws', paths: [] })).toThrow(
            'empty list',
        );
        expect(() => renderScoped('cd {workspace} && bun run typecheck', { workspace: '' })).toThrow('empty');
    });
});
