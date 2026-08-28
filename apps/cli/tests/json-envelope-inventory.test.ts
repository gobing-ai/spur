import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 0697 AC4 — the advertise-and-ignore guard, as a runnable check rather than a
 * manual sweep.
 *
 * Every verb under `apps/cli/src/commands/` that registers `SHARED_OPTIONS.jsonEnvelope`
 * advertises `--json-envelope`. A verb that advertises the flag and never routes it to an
 * envelope emitter is the exact defect this task closed: the flag is documented in `--help`
 * and silently does nothing.
 *
 * A verb passes when its `.command()` block either reaches an envelope emitter in-module
 * (`toEnvelopeJson` / `toEnvelopeError` / `writeJsonError`) or hands the decision down to a
 * `packages/app` service (`jsonEnvelope` appears in the delegated call). Anything else must
 * be named in KEPT_RAW with a reason, mirrored in `docs/04_DESIGN.md` §4.1.
 */

const COMMANDS_DIR = join(import.meta.dir, '..', 'src', 'commands');

/** Verbs that advertise the flag but deliberately do not envelope. Keep in sync with docs/04_DESIGN.md §4.1. */
const KEPT_RAW: Record<string, string> = {
    // `task verdict` writes the .spur/run verdict artifact consumed by pipeline code,
    // not CLI stdout — enveloping it would break every artifact reader (ADR-091, task 0693).
    'task verdict': 'writes the .spur/run verdict artifact, not CLI stdout',
};

interface VerbBlock {
    noun: string;
    verb: string;
    line: number;
    body: string;
    /** Whole module text — handlers routinely delegate to a module-level helper. */
    module: string;
}

function collectVerbBlocks(): VerbBlock[] {
    const blocks: VerbBlock[] = [];
    for (const file of readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.ts'))) {
        const noun = file.replace(/\.ts$/, '');
        const module = readFileSync(join(COMMANDS_DIR, file), 'utf8');
        const lines = module.split('\n');
        let current: VerbBlock | undefined;
        for (const [index, line] of lines.entries()) {
            const match = line.match(/\.command\(\s*'([^']+)'/);
            if (match) {
                if (current) blocks.push(current);
                current = { noun, verb: match[1] as string, line: index + 1, body: '', module };
                continue;
            }
            if (current) current.body += `${line}\n`;
        }
        if (current) blocks.push(current);
    }
    return blocks;
}

const EMITTER = /toEnvelopeJson|toEnvelopeError|writeJsonError/;

/** Body of a module-level `function name(...)` declaration, brace-matched. */
function functionBody(module: string, name: string): string | undefined {
    const start = module.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\b`, 'm'));
    if (start < 0) return undefined;
    const open = module.indexOf('{', start);
    if (open < 0) return undefined;
    let depth = 0;
    for (let i = open; i < module.length; i++) {
        if (module[i] === '{') depth++;
        else if (module[i] === '}' && --depth === 0) return module.slice(open, i + 1);
    }
    return undefined;
}

/**
 * A verb honors the flag when it envelopes in its own block, threads the decision to a
 * `packages/app` service, or calls a module-level helper that does either. One level of
 * indirection is enough: every command module delegates at most one hop before emitting.
 */
function honorsFlag(block: VerbBlock): boolean {
    const routes = (text: string): boolean =>
        EMITTER.test(text) || text.replace(/SHARED_OPTIONS\.jsonEnvelope/g, '').includes('jsonEnvelope');
    if (routes(block.body)) return true;
    const called = new Set(Array.from(block.body.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(/g), (m) => m[1] as string));
    for (const name of called) {
        const body = functionBody(block.module, name);
        if (body === undefined) continue;
        if (routes(body)) return true;
        // `commanderOptionsToFlags(options)` copies EVERY commander option into the
        // flags record (kebab-cased: `jsonEnvelope` → `json-envelope`, agent.ts:223),
        // so a handler that builds its flags that way and hands them to a service has
        // wired the decision even with no literal `jsonEnvelope` token. Narrow by
        // design — one named forwarder, not a blanket exemption; the service side is
        // pinned by packages/app/tests/services/json-envelope-adoption.test.ts.
        if (/commanderOptionsToFlags/.test(block.body) && /\bsvc\.|Service\b/.test(body)) return true;
    }
    return false;
}

describe('AC4 — no CLI verb advertises --json-envelope and ignores it', () => {
    const advertising = collectVerbBlocks().filter((b) => b.body.includes('SHARED_OPTIONS.jsonEnvelope'));

    test('the scan finds the flag-registering verbs at all (guards a silently-empty sweep)', () => {
        expect(advertising.length).toBeGreaterThan(30);
    });

    test('every flag-registering verb either envelopes or is an explicit kept-raw entry', () => {
        const offenders = advertising
            .filter((b) => !honorsFlag(b))
            .filter((b) => KEPT_RAW[`${b.noun} ${b.verb}`] === undefined)
            .map((b) => `${b.noun} ${b.verb} (apps/cli/src/commands/${b.noun}.ts:${b.line})`);
        expect(offenders).toEqual([]);
    });

    test('every kept-raw entry still exists and still advertises the flag', () => {
        const advertised = new Set(advertising.map((b) => `${b.noun} ${b.verb}`));
        for (const name of Object.keys(KEPT_RAW)) expect(advertised.has(name)).toBe(true);
    });

    test('the four verbs task 0697 closed now thread the flag to their service', () => {
        for (const name of ['agent list', 'agent doctor', 'rule run', 'rule validate']) {
            const [noun, verb] = name.split(' ');
            const block = advertising.find((b) => b.noun === noun && b.verb === verb);
            expect(block).toBeDefined();
            expect(honorsFlag(block as VerbBlock)).toBe(true);
        }
    });
});
