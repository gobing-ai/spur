import { describe, expect, test } from 'bun:test';
import { BuilderConfigSchema, SDLC_ACTIONS, SDLC_PRESET_ACTIONS, SDLC_PRESETS } from '../src/index';

/** Parse and flatten every issue message, so a test can assert on the key path it names. */
function issues(input: unknown): string[] {
    const result = BuilderConfigSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('BuilderConfigSchema — preset and actions (task 1222 R1)', () => {
    test('a bare builder block defaults to the bun preset and an empty binding', () => {
        const parsed = BuilderConfigSchema.parse({});
        expect(parsed.preset).toBe('bun');
        expect(parsed.actions).toEqual({});
    });

    test('accepts a string command, a composite step list, and the none preset', () => {
        const parsed = BuilderConfigSchema.parse({
            preset: 'none',
            actions: {
                build: 'make build',
                'lint-changed': 'ruff check {files}',
                'typecheck-changed': 'cd {workspace} && mypy src',
                'test-changed': 'cd {workspace} && pytest {paths}',
                lint: 'ruff check .',
                test: 'pytest -q',
                check: ['lint', 'test'],
            },
        });
        expect(parsed.preset).toBe('none');
        expect(parsed.actions.check).toEqual(['lint', 'test']);
    });

    test('rejects an unknown preset, leaving bump-ver untouched', () => {
        expect(BuilderConfigSchema.safeParse({ preset: 'python' }).success).toBe(false);
        expect(BuilderConfigSchema.parse({ 'bump-ver': { ghRunListLimit: 3 } })['bump-ver']?.ghRunListLimit).toBe(3);
    });

    test('reserved vocabulary is the frozen 18-name list and every preset is known', () => {
        expect(SDLC_ACTIONS).toHaveLength(18);
        expect([...SDLC_PRESETS]).toEqual(['bun', 'none']);
        expect(SDLC_PRESET_ACTIONS.bun).toBe(SDLC_ACTIONS);
        expect(SDLC_PRESET_ACTIONS.none).toEqual(['rules-pre', 'rules-post']);
    });
});

describe('BuilderConfigSchema — load-time rejection names the key path (task 1222 R2)', () => {
    test('malformed action name', () => {
        const found = issues({ actions: { 'Bad Name': 'make' } });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain('builder.actions.Bad Name is not a valid action name');
    });

    test('composite step that resolves to no action', () => {
        const found = issues({ preset: 'none', actions: { check: ['lint'] } });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain('builder.actions.check lists step "lint"');
    });

    test('a step declared later in the same map resolves (declared, not order-dependent)', () => {
        expect(
            BuilderConfigSchema.safeParse({ preset: 'none', actions: { check: ['lint'], lint: 'ruff check .' } })
                .success,
        ).toBe(true);
    });

    test('reserved names stay resolvable through the active preset', () => {
        expect(BuilderConfigSchema.safeParse({ actions: { ci: ['lint', 'test', 'rules-post'] } }).success).toBe(true);
    });

    test('self cycle is rejected with its path', () => {
        const found = issues({ preset: 'none', actions: { loop: ['loop'] } });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain('builder.actions.loop forms a cycle: loop → loop');
    });

    test('two-action cycle is rejected once, with its path', () => {
        const found = issues({ preset: 'none', actions: { a: ['b'], b: ['a'] } });
        expect(found).toHaveLength(1);
        expect(found[0]).toMatch(/builder\.actions\.(?<first>[ab]) forms a cycle: \k<first> → [ab] → \k<first>/);
    });

    test('placeholder outside the three *-changed actions', () => {
        const found = issues({ actions: { lint: 'ruff check {files}' } });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain('builder.actions.lint uses placeholder {files}');
    });

    test('a scoped action rejects a placeholder the gate planner never supplies for it', () => {
        // The light gate renders test-changed with {workspace}/{paths} only; {files} would throw at gate time.
        const found = issues({ actions: { 'test-changed': 'pytest {files}' } });
        expect(found).toHaveLength(1);
        expect(found[0]).toContain('builder.actions.test-changed uses placeholder {files}');
        expect(issues({ actions: { 'lint-changed': 'ruff check {workspace}' } })).toHaveLength(1);
        expect(issues({ actions: { 'typecheck-changed': 'mypy {paths}' } })).toHaveLength(1);
        expect(
            BuilderConfigSchema.safeParse({ actions: { 'test-changed': 'cd {workspace} && pytest {paths}' } }).success,
        ).toBe(true);
    });

    test('cycle detection stays linear on a dense composite DAG', () => {
        // 32 two-edge composites: an un-memoized path walk is ~Fibonacci(32) visits (~1.5 s measured).
        const actions: Record<string, string[] | string> = { s0: 'true', s1: 'true' };
        for (let i = 2; i < 34; i += 1) actions[`s${i}`] = [`s${i - 1}`, `s${i - 2}`];
        const started = performance.now();
        expect(BuilderConfigSchema.safeParse({ preset: 'none', actions }).success).toBe(true);
        expect(performance.now() - started).toBeLessThan(500);
    });

    test('empty string and empty list', () => {
        expect(issues({ actions: { build: '  ' } })[0]).toContain('builder.actions.build must not be empty');
        expect(issues({ actions: { ci: [] } })[0]).toContain('builder.actions.ci must not be an empty list');
    });

    test('non-string/list value is a type error', () => {
        expect(BuilderConfigSchema.safeParse({ actions: { build: 42 } }).success).toBe(false);
    });
});
