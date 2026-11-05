/**
 * sp-bot-bootstrap behavior test (task 1292 / feature I14 R2).
 *
 * Runs the exact fenced `sh` blocks from SKILL.md against stub executables, so the shipped
 * doc and the tested shell cannot drift. Only bun/node builtins and relative imports.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';

const SKILL_MD = readFileSync(join(import.meta.dir, '../skills/sp-bot-bootstrap/SKILL.md'), 'utf8');

function block(tag: 'check' | 'setup'): string {
    const re = /```sh sp-bot-bootstrap:(check|setup)\n([\s\S]*?)```/g;
    const matches = [...SKILL_MD.matchAll(re)];
    expect(matches.length).toBe(2); // exactly two fenced blocks
    const match = matches.find((m) => m[1] === tag);
    if (!match?.[2]) throw new Error(`block ${tag} not found`);
    return match[2];
}

interface Case {
    name: string;
    /** $BUN_INSTALL/bin entries pre-seeded (empty host: none). */
    seeded: string[];
    env: Record<string, string>;
}

const EMPTY_HOST: Case = { name: 'empty-host', seeded: [], env: {} };
const PARTIAL_HOST: Case = { name: 'partial-host', seeded: ['bun', 'spur'], env: {} };
const SECRET_ENV: Case = {
    name: 'secret-env',
    seeded: [],
    env: { GROK_API_KEY: 'sekret', SAND_TOKEN: 'sekret' },
};

/** Fake `bun` tool handler: `--version` exits 0; `add -g pkg…` writes fake tool stubs that log argv. */
const BUN_TOOL = [
    '#!/bin/sh',
    'echo "bun $*" >> "$STUB_LOG"',
    'case "$1" in',
    '  --version) echo "stub 1.0"; exit 0 ;;',
    '  add)',
    '    if [ "$2" = "-g" ]; then',
    '      shift 2',
    '      for p in "$@"; do',
    '        case "$p" in *knowledge-kit) n=kk ;; *) n="\x24{p##*/}" ;; esac',
    '        cat > "$BUN_INSTALL/bin/$n" <<\'TSTUB\'',
    '#!/bin/sh',
    'echo "$0 $*" >> "$STUB_LOG"',
    '[ "$1" = "--version" ] && { echo "$0 stub 1.0"; exit 0; }',
    'exit 0',
    'TSTUB',
    '        chmod +x "$BUN_INSTALL/bin/$n"',
    '      done',
    '    fi',
    '    exit 0 ;;',
    '  *) exit 0 ;;',
    'esac',
].join('\n');

function makeCase(c: Case) {
    const home = mkdtempSync(join(tmpdir(), 'spbot-'));
    const stubDir = join(home, 'stubs');
    const bunInstall = join(home, '.bun-home'); // BUN_INSTALL outside $HOME/.bun for isolation
    const stubLog = join(home, 'stub.log');
    const binDir = join(bunInstall, 'bin');
    mkdirSync(stubDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    // `curl` stub: logs argv, prints the "installer payload" that lands the fake bun in $BUN_INSTALL/bin.
    const payload = `#!/bin/sh\nmkdir -p "$BUN_INSTALL/bin"\ncat > "$BUN_INSTALL/bin/bun" <<'BUNSTUB'\n${BUN_TOOL}\nBUNSTUB\nchmod +x "$BUN_INSTALL/bin/bun"\n`;
    const curlStub = `#!/bin/sh\necho "curl $*" >> "$STUB_LOG"\ncat <<'PAYLOAD'\n${payload}\nPAYLOAD\n`;
    writeFileSync(join(stubDir, 'curl'), curlStub, { mode: 0o755 });

    // Pre-seed bun/spur stubs directly on PATH (partial-host case).
    for (const tool of c.seeded) {
        if (tool === 'bun') writeFileSync(join(stubDir, 'bun'), BUN_TOOL, { mode: 0o755 });
        else
            writeFileSync(
                join(stubDir, tool),
                `#!/bin/sh\necho "${tool} $*" >> "$STUB_LOG"\necho "stub 1.0"\nexit 0\n`,
                { mode: 0o755 },
            );
    }

    const envBase = {
        ...getEnvVars(),
        ...c.env,
        HOME: home,
        BUN_INSTALL: bunInstall,
        STUB_LOG: stubLog,
        PATH: `${stubDir}:/usr/bin:/bin`,
    };
    const run = (sh: string) => {
        const proc = Bun.spawnSync(['sh', '-c', sh], { env: envBase, stdout: 'pipe', stderr: 'pipe' });
        return { code: proc.exitCode ?? 1, out: proc.stdout.toString(), err: proc.stderr.toString() };
    };
    const log = () => readFileSync(stubLog, 'utf8');
    const clean = () => rmSync(home, { recursive: true, force: true });
    return { run, log, clean, stubLog, home };
}

describe('sp-bot-bootstrap blocks (task 1292, feature I14 R2/R3/R5)', () => {
    test('AC1: empty host — first check fails with all four, setup installs once, re-check passes', () => {
        const c = makeCase(EMPTY_HOST);
        try {
            const check1 = c.run(block('check'));
            expect(check1.code).toBe(1);
            for (const tool of ['bun', 'spur', 'superskill', 'kk']) {
                expect(check1.out).toContain(`missing: ${tool}`);
            }
            expect(check1.out.split('missing:').length - 1).toBe(4);

            c.run(block('setup'));
            expect(c.log().split('curl ').length - 1).toBe(1);
            expect(c.log()).toContain('bun add -g @gobing-ai/spur @gobing-ai/superskill @gobing-ai/knowledge-kit');

            const check2 = c.run(block('check'));
            expect(check2.code).toBe(0);
        } finally {
            c.clean();
        }
    });

    test('AC2: second setup is a no-op (zero installer and bun add calls)', () => {
        const c = makeCase(EMPTY_HOST);
        try {
            c.run(block('setup'));
            const before = c.log();
            const out = c.run(block('setup'));
            expect(out.code).toBe(0);
            expect(c.log()).toBe(before);
        } finally {
            c.clean();
        }
    });

    test('AC3: partial host (bun + spur present) installs only the two missing packages', () => {
        const c = makeCase(PARTIAL_HOST);
        try {
            const out = c.run(block('setup'));
            expect(out.code).toBe(0);
            expect(c.log()).not.toContain('curl ');
            expect(c.log()).toContain('bun add -g @gobing-ai/superskill @gobing-ai/knowledge-kit');
            expect(c.log().split('bun add').length - 1).toBe(1);
            expect(c.log()).not.toContain('@gobing-ai/spur');
        } finally {
            c.clean();
        }
    });

    test('AC4: secrets never leak into output streams or the stub log; check is read-only', () => {
        const c = makeCase(SECRET_ENV);
        try {
            const chk = c.run(block('check'));
            const preSetupLog = existsSync(c.stubLog) ? c.log() : ''; // log up to the end of the check run
            const set = c.run(block('setup'));
            const all = `${chk.out}${chk.err}${set.out}${set.err}${c.log()}`;
            expect(all).not.toContain('sekret');
            expect(preSetupLog).not.toContain('curl ');
            expect(preSetupLog).not.toContain('bun add');
        } finally {
            c.clean();
        }
    });
});
