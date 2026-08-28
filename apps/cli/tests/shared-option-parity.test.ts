import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_OPTION_FLAGS, SHARED_OPTIONS } from '../src/commands/shared-options';

// Every shared flag string (membership set) and every registry entry lives here.
// 0618 R3: re-declaring a shared option inline (literal .option/.requiredOption)
// instead of spreading SHARED_OPTIONS must fail this test, so descriptions cannot
// drift from the registry.
//
// Forward check: no literal declaration whose flag string is in SHARED_OPTION_FLAGS.
// Spreads cannot match the literal-head regex, so a passing file is clean by construction.
// Reverse check: every registry entry is actually spread in at least one command module,
// and every shared flag string is consumed by at least two distinct command modules.

const commandsDir = join(import.meta.dir, '..', 'src', 'commands');
const modules = readdirSync(commandsDir)
    .filter((f) => f.endsWith('.ts') && f !== 'shared-options.ts')
    .map((f) => ({ name: f, src: readFileSync(join(commandsDir, f), 'utf8') }));

// .option('  --flag <v>  ', 'desc' — first string arg is the flags literal; strip
// leading dashes / brackets variants conservatively via the raw literal text.
const LITERAL_HEAD = /\.(?:option|requiredOption)\(\s*(['"`])([^'"`]+?)\1\s*,\s*(['"`])/g;

function flagKey(flagsLiteral: string): string {
    return flagsLiteral.trim().split(/[\s,]+/)[0] || flagsLiteral;
}

describe('shared option registry parity', () => {
    test('SHARED_OPTION_FLAGS covers exactly 29 shared flag strings', () => {
        expect(SHARED_OPTION_FLAGS.size).toBe(29);
    });

    test('no literal declaration of a shared flag string in command modules', () => {
        const offenders: string[] = [];
        for (const { name, src } of modules) {
            for (const m of src.matchAll(LITERAL_HEAD)) {
                const head = flagKey(m[2] ?? '');
                if (SHARED_OPTION_FLAGS.has(head)) {
                    offenders.push(`${name}: ${m[2]}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('every registry entry is spread by at least one command module', () => {
        const keys = Object.keys(SHARED_OPTIONS);
        const spread = new Set<string>();
        for (const { src } of modules) {
            for (const m of src.matchAll(/SHARED_OPTIONS\.(\w+)/g)) spread.add(m[1] ?? '');
        }
        const unused = keys.filter((k) => !spread.has(k));
        expect(unused).toEqual([]);
    });

    test('every shared flag string is consumed by at least two distinct modules', () => {
        const flagsToKeys = new Map<string, string[]>();
        for (const [key, value] of Object.entries(SHARED_OPTIONS)) {
            const head = flagKey(value[0]);
            flagsToKeys.set(head, [...(flagsToKeys.get(head) ?? []), key]);
        }
        const offenders: string[] = [];
        for (const [flag, keys] of flagsToKeys) {
            const mods = new Set<string>();
            for (const { name, src } of modules) {
                if (keys.some((k) => src.includes(`SHARED_OPTIONS.${k}`))) mods.add(name);
            }
            if (mods.size < 2) offenders.push(`${flag}: ${[...mods].join(', ') || 'none'}`);
        }
        expect(offenders).toEqual([]);
    });
});
