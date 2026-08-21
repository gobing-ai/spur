/**
 * cli-surface.test — focused live capture + fixture parsing checks for the 0512 helper.
 *
 * Live captures prove source-local provenance: the helper must invoke the monorepo CLI entry
 * through Bun (never a bare PATH `spur`) and record the entry path + @gobing-ai/spur version.
 * Fixture assertions pin the narrow Commander-block adapter. The 0516 scope parsers read the
 * authoritative skill tables (Tier C exclusions, Step routing, ADR-054 ownership markers)
 * straight from the two SKILL.md documents. Deeper fixture/live parity assertions are wired
 * by 0517 (per the 2026-08-11 decomposition).
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    captureCliSurface,
    parseCommanderHelp,
    parseOwnershipMarkers,
    parseSpineRoutes,
    parseTierCExclusions,
} from './cli-surface';

const FACADE_SKILL = join(import.meta.dir, '..', '..', 'skills', 'spur-cli', 'SKILL.md');
const SPINE_SKILL = join(import.meta.dir, '..', '..', 'skills', 'spur-dev', 'SKILL.md');

describe('cli-surface — parseCommanderHelp narrow adapter', () => {
    test('parses Commands and Options blocks, dedupes, sorts', () => {
        const { commands, flags } = parseCommanderHelp(`Usage: spur [options] [command]

Options:
  -V, --version  output the version number
  -h, --help     display help for command

Commands:
  agent   run agents
  agent   run agents
  task    manage tasks
`);
        expect(commands).toEqual(['agent', 'task']);
        expect(flags).toEqual(['--help', '--version', '-V', '-h']);
    });

    test('returns empty arrays for a verb help with no Commands block', () => {
        const { commands, flags } = parseCommanderHelp(`Usage: spur task update [options] <wbs> [status]

Options:
  --section <name>  Section name to replace
  -h, --help        display help for command
`);
        expect(commands).toEqual([]);
        expect(flags).toEqual(['--help', '--section', '-h']);
    });

    test('wrapped description lines do not inject phantom commands (0517 regression)', () => {
        const { commands } = parseCommanderHelp(`Usage: spur message [options] [command]

Commands:
  send [options] <body>            Enqueue a message for an agent.
  watch [options]                  Follow an agent inbox - surface new messages
                                   as they arrive (Ctrl-C to exit).
  help [command]                   display help for command

Options:
  -h, --help  display help for command
`);
        // The continuation line ("as they arrive ...") is description prose indented to the
        // description column — it must not surface as a command token.
        expect(commands).toEqual(['help', 'send', 'watch']);
        expect(commands).not.toContain('as');
    });

    test('fails loudly on text that is not Commander help', () => {
        expect(() => parseCommanderHelp('panic: not help output at all')).toThrow(/not Commander help/);
    });
});

describe('cli-surface — captureCliSurface live source-local capture', () => {
    test('root capture returns sorted commands, flags, and full provenance', () => {
        const surface = captureCliSurface();
        expect(surface.commands.length).toBeGreaterThan(0);
        expect(surface.commands).toContain('task');
        expect(surface.commands).toEqual([...surface.commands].sort());
        expect(surface.flags).toContain('--help');
        expect(surface.provenance.entryPath.endsWith('apps/cli/src/index.ts')).toBe(true);
        expect(surface.provenance.packageName).toBe('@gobing-ai/spur');
        expect(surface.provenance.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    test('noun and noun+verb captures resolve their own surfaces', () => {
        const noun = captureCliSurface(['task']);
        expect(noun.commands).toContain('update');
        expect(noun.provenance.packageVersion).toBe(captureCliSurface().provenance.packageVersion);

        const verb = captureCliSurface(['task', 'update']);
        expect(verb.flags).toContain('--section');
        expect(verb.flags).toContain('--json');
    });
});

describe('cli-surface — captureCliSurface failure branches', () => {
    test('fails loudly when apps/cli/package.json version is not a non-empty string', () => {
        // Spy on the global JSON.parse (resolved by the helper at call time) so the
        // version read yields a non-string — exercising the missing/invalid-version branch.
        const parseSpy = spyOn(JSON, 'parse').mockImplementation(() => ({ version: 123 }));
        try {
            expect(() => captureCliSurface()).toThrow(/has no string "version"/);
        } finally {
            parseSpy.mockRestore();
        }
    });

    test('fails loudly when apps/cli/package.json is invalid JSON', () => {
        const parseSpy = spyOn(JSON, 'parse').mockImplementation(() => {
            throw new SyntaxError('Unexpected token');
        });
        try {
            expect(() => captureCliSurface()).toThrow(
                /captureCliSurface: cannot read .*apps\/cli\/package\.json: Unexpected token/,
            );
        } finally {
            parseSpy.mockRestore();
        }
    });

    test('fails loudly when the CLI process exits non-zero', () => {
        // Unchecked cast: the fake result only needs exitCode/stdout/stderr for this branch.
        const fakeSpawn = (() => ({
            exitCode: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from('boom'),
        })) as unknown as typeof Bun.spawnSync;
        const spawnSpy = spyOn(Bun, 'spawnSync').mockImplementation(fakeSpawn);
        try {
            expect(() => captureCliSurface()).toThrow(/command failed \(exit 1\)[\s\S]*stderr: boom/);
        } finally {
            spawnSpy.mockRestore();
        }
    });
});

describe('cli-surface — 0516 scope parsers (explicit exclusions + ADR-054 boundary)', () => {
    test('R1 — parseTierCExclusions reads the live Tier C table: three reasoned nouns incl. help', () => {
        const exclusions = parseTierCExclusions(readFileSync(FACADE_SKILL, 'utf8'));
        expect(exclusions.map((e) => e.noun)).toEqual(['history', 'projects', 'help']);
        for (const exclusion of exclusions) {
            expect(exclusion.reason.length, `noun "${exclusion.noun}" must carry a reason`).toBeGreaterThan(0);
        }
        expect(exclusions.find((e) => e.noun === 'help')?.reason).toMatch(/Commander/i);
    });

    test('R1 — parseTierCExclusions fails on an empty reason or a duplicate noun', () => {
        const base = `### Tier C exclusion reasons\n\n| Noun | Reason |\n|------|--------|\n| \`help\` | Auto-generated by Commander.js; not a real noun. |\n`;
        expect(() => parseTierCExclusions(`${base}| \`x\` |  |\n`)).toThrow(/empty exclusion reason/);
        expect(() => parseTierCExclusions(`${base}| \`help\` | another reason |\n`)).toThrow(/duplicate noun "help"/);
    });

    test('R1 — parseTierCExclusions fails loudly when the heading is absent', () => {
        expect(() => parseTierCExclusions('# no tier table here\n')).toThrow(/no "### Tier C exclusion reasons"/);
    });

    test('R2 — parseSpineRoutes classifies CLI and non-CLI rows from the live Step routing table', () => {
        const routes = parseSpineRoutes(readFileSync(SPINE_SKILL, 'utf8'));
        const cli = routes.filter((r) => r.kind === 'cli');
        const nonCli = routes.filter((r) => r.kind === 'non-cli');
        expect(cli.length).toBeGreaterThan(0);
        expect(nonCli.length).toBeGreaterThan(0);

        // CLI rows carry the noun/verb of the backticked `spur <noun> <verb>` gate.
        const nouns = new Set(cli.map((r) => r.noun));
        expect(nouns.has('task')).toBe(true);
        expect(nouns.has('feature')).toBe(true);
        // A gate with flags inside the backticks (`spur task update --section`) is still CLI-routed.
        expect(cli.find((r) => r.step === 'Refine')).toMatchObject({ kind: 'cli', noun: 'task', verb: 'update' });
        for (const route of cli) {
            expect(route.noun?.length, `cli row "${route.step}" must carry a noun`).toBeGreaterThan(0);
            expect(route.verb?.length, `cli row "${route.step}" must carry a verb`).toBeGreaterThan(0);
        }

        // Non-CLI rows keep the original gate text as their reason (no silent regex miss).
        expect(nonCli.find((r) => r.step === 'Intake')?.reason).toContain('prompt work');
        for (const route of nonCli) {
            expect(route.reason.length, `non-cli row "${route.step}" must retain its gate text`).toBeGreaterThan(0);
        }
    });

    test('R2 — parseSpineRoutes fails loudly when the heading is absent', () => {
        expect(() => parseSpineRoutes('# no routing table here\n')).toThrow(/no "## Step routing"/);
    });

    test('R3 — parseOwnershipMarkers reads ADR-054 claims from both live skill documents', () => {
        const markers = parseOwnershipMarkers(readFileSync(FACADE_SKILL, 'utf8'), readFileSync(SPINE_SKILL, 'utf8'));
        expect(markers.facade.surface).toBe('facade');
        expect(markers.facade.claim).toContain('ADR-054');
        expect(markers.facade.claim).toContain('owns CLI noun/verb/flag semantics');
        expect(markers.spine.surface).toBe('spine');
        expect(markers.spine.claim).toContain('ADR-054');
        expect(markers.spine.claim).toContain('owns multi-step lifecycle orchestration');
    });

    test('R3 — ownership inversion fails (facade claiming orchestration)', () => {
        const facade = `${readFileSync(FACADE_SKILL, 'utf8')}\nThis facade owns multi-step lifecycle orchestration.\n`;
        const spine = readFileSync(SPINE_SKILL, 'utf8');
        expect(() => parseOwnershipMarkers(facade, spine)).toThrow(/inverts the ADR-054 boundary/);
    });

    test('R3 — a missing ADR-054 marker fails loudly', () => {
        const facade = readFileSync(FACADE_SKILL, 'utf8').replace('ADR-054', 'ADR-000');
        const spine = readFileSync(SPINE_SKILL, 'utf8').replace('ADR-054', 'ADR-000');
        expect(() => parseOwnershipMarkers(facade, spine)).toThrow(/has no "ADR-054" ownership marker/);
    });
});
