/**
 * `spurCommand` / `childEnv` (packages/app/src/workflow/wrapup/spur-command.ts; script-absorption
 * PR-5): how the wrap-up steps turn a workflow's `spurBin` into a spawnable command and which env the
 * nested spur lookups and the feature gate receive.
 */
import { describe, expect, test } from 'bun:test';
import { childEnv, spurCommand } from '../../../src/workflow/wrapup/spur-command';

describe('spurCommand', () => {
    test('defaults to `spur` when spurBin is unset, empty or whitespace', () => {
        expect(spurCommand(undefined)).toEqual({ cmd: 'spur', prefix: [] });
        expect(spurCommand('')).toEqual({ cmd: 'spur', prefix: [] });
        expect(spurCommand('   ')).toEqual({ cmd: 'spur', prefix: [] });
    });

    test('splits a multi-word launch on any whitespace into command plus prefix args', () => {
        expect(spurCommand('/usr/local/bin/spur')).toEqual({ cmd: '/usr/local/bin/spur', prefix: [] });
        expect(spurCommand('  bun \t apps/cli/src/index.ts  ')).toEqual({
            cmd: 'bun',
            prefix: ['apps/cli/src/index.ts'],
        });
    });
});

describe('childEnv', () => {
    test('keeps every defined var (flag overrides included) and drops undefined ones', () => {
        expect(childEnv({ PATH: '/bin', feature: 'D9', spurBin: 'spur', unset: undefined, empty: '' })).toEqual({
            PATH: '/bin',
            feature: 'D9',
            spurBin: 'spur',
            empty: '',
        });
    });

    test('an empty env yields an empty record', () => {
        expect(childEnv({})).toEqual({});
    });
});
