/**
 * Task 1445 R7 — the `tools-rule` module's own contract: every descriptor it exports has a handler
 * in its dispatch map, no handler is unreachable, and each handler reaches its one service seam.
 * The full dispatcher behaviour (schema refusal, telemetry) is asserted in tests/modules/mcp-module.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import type { ServerContext } from '../../../src/context';
import { descriptors, dispatch } from '../../../src/modules/mcp/tools-rule';

/** A context slice carrying only the rule service the handlers read. */
function ctxWith(ruleService: Record<string, unknown>): ServerContext {
    return { cwd: '/proj', ruleService: () => ruleService } as unknown as ServerContext;
}

describe('mcp tools-rule', () => {
    test('descriptors and dispatch name the same tools', () => {
        expect(descriptors.length).toBeGreaterThan(0);
        expect(descriptors.map((tool) => tool.name).sort()).toEqual(Object.keys(dispatch).sort());
    });

    test('sp_rule_run maps the service result and passes a no-color palette that leaves text unchanged', async () => {
        let received: Record<string, unknown> | undefined;
        const handler = dispatch.sp_rule_run;
        if (handler === undefined) throw new Error('sp_rule_run handler missing');
        const result = await handler(
            ctxWith({
                evaluate: async (options: Record<string, unknown>) => {
                    received = options;
                    const color = options.color as Record<string, ((text: string) => string) | undefined>;
                    // The palette is identity: a programmatic caller draws no escapes.
                    for (const key of ['dim', 'red', 'green', 'yellow', 'cyan']) {
                        expect(color[key]?.('x')).toBe('x');
                    }
                    return { findings: [{ ruleId: 'r' }], fixes: [], exitCode: 1, ruleCount: 52 };
                },
            }),
            { preset: 'strict', rule: 'r', failOn: 'warning', fixMode: 'suggest' },
        );
        expect(received).toMatchObject({ preset: 'strict', rule: 'r', failOn: 'warning', fixMode: 'suggest' });
        expect(result).toEqual({ findings: [{ ruleId: 'r' }], fixes: [], exitCode: 1, ruleCount: 52 });
    });

    test('sp_rule_run defaults the preset and the failure severity', async () => {
        let received: Record<string, unknown> | undefined;
        const handler = dispatch.sp_rule_run;
        if (handler === undefined) throw new Error('sp_rule_run handler missing');
        await handler(
            ctxWith({
                evaluate: async (options: Record<string, unknown>) => {
                    received = options;
                    return { findings: [], fixes: [], exitCode: 0, ruleCount: 1 };
                },
            }),
            {},
        );
        expect(received).toMatchObject({ preset: 'recommended-pre-check', failOn: 'error', fixMode: 'none' });
    });

    test('sp_rule_list forwards an optional preset', async () => {
        const seen: Array<string | undefined> = [];
        const handler = dispatch.sp_rule_list;
        if (handler === undefined) throw new Error('sp_rule_list handler missing');
        const list = async (preset?: string) => {
            seen.push(preset);
            return { rules: ['a'] };
        };
        await handler(ctxWith({ list }), {});
        await handler(ctxWith({ list }), { preset: 'strict' });
        expect(seen).toEqual([undefined, 'strict']);
    });

    test('sp_rule_validate defaults to the preset and confines a file argument to the project root', async () => {
        const seen: unknown[] = [];
        const handler = dispatch.sp_rule_validate;
        if (handler === undefined) throw new Error('sp_rule_validate handler missing');
        const validate = async (options: { source: unknown }) => {
            seen.push(options.source);
            return { valid: true };
        };
        await handler(ctxWith({ validate }), {});
        await handler(ctxWith({ validate }), { file: 'my-rule.yaml' });
        expect(seen).toEqual([
            { kind: 'preset', value: 'recommended-pre-check' },
            { kind: 'file', value: '/proj/my-rule.yaml' },
        ]);
        await expect(handler(ctxWith({ validate }), { file: '../../etc/passwd' })).rejects.toThrow(
            'file must be inside the project',
        );
    });
});
