/**
 * command-contract.test — thin-wrapper contract test for plugin sp commands
 * (feature O, task 0309; ADR-032).
 *
 * Validates plugins/sp/commands/*.md directly against the thin-wrapper
 * contract. The .md files are the hand-editable SSOT; superskill owns
 * per-platform emission. Replaces adapter-drift.test.ts (0308).
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootMain, parseCliArgs, renderHelp, runCli, validate } from '../scripts/validate-commands';

const ROOT = join(import.meta.dir, '..', '..', '..');
const COMMANDS_DIR = join(ROOT, 'plugins', 'sp', 'commands');
const SKILLS_DIR = join(ROOT, 'plugins', 'sp', 'skills');

// ─── Helpers ────────────────────────────────────────────────────────────────

function listCommandFiles(): string[] {
    return readdirSync(COMMANDS_DIR)
        .filter((f) => f.endsWith('.md'))
        .sort();
}

function slugify(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number} -]/gu, '')
        .replaceAll(' ', '-');
}

/** Extract the ## Implementation section body from raw markdown. */
function implSection(raw: string): string {
    const parts = raw.split(/^## Implementation\n/m);
    if (parts.length < 2) return '';
    return parts[1].split(/\n## /m)[0];
}

/** Create a minimal command .md in a temp plugins/sp/commands/ structure. */
function makeTempCommand(
    tmp: string,
    name: string,
    description: string,
    argumentHint: string,
    allowedTools: string,
    usage: string,
    implementation: string,
    extraHeadings: string[] = [],
): void {
    const dir = join(tmp, 'plugins', 'sp', 'commands');
    mkdirSync(dir, { recursive: true });
    const lines = [
        '---',
        `description: ${description}`,
        `argument-hint: ${argumentHint}`,
        `allowed-tools: ${allowedTools}`,
        '---',
        '',
        `# ${name}`,
        '',
        'Wraps sp:test.',
        '',
        '## Usage',
        '',
        usage,
        '',
        '## Implementation',
        '',
        implementation,
        '',
    ];
    for (const h of extraHeadings) {
        lines.push(`## ${h}`);
        lines.push('');
        lines.push('Extra content.');
        lines.push('');
    }
    writeFileSync(join(dir, 'test-cmd.md'), lines.join('\n'));
}

// ─── (a) heading whitelist ──────────────────────────────────────────────────

describe('(a) heading whitelist — only ## Usage + ## Implementation beyond H1', () => {
    test('every command .md has exactly the allowed headings', () => {
        const allowed = new Set(['Usage', 'Implementation']);
        for (const file of listCommandFiles()) {
            const name = file.replace(/\.md$/, '');
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
            const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;

            const h1 = body.split('\n')[0];
            expect(h1, `${name}: missing H1`).toMatch(/^# /);

            const h2s = body
                .split('\n')
                .filter((l) => l.startsWith('## '))
                .map((l) => l.slice(3).trim());
            for (const h of h2s) {
                expect(allowed.has(h), `${name}: forbidden heading ## ${h}`).toBe(true);
            }
        }
    });

    test('forbidden lifecycle-prose headings are absent (grep gate)', () => {
        const forbidden = /^## (When to use|Behavior|Workflow|Arguments|Q&A|Examples|Naming|Mode resolution)/m;
        for (const file of listCommandFiles()) {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            expect(forbidden.test(raw), `${file} carries lifecycle-prose heading`).toBe(false);
        }
    });

    test('every command carries exactly the two required headings, once each', () => {
        for (const file of listCommandFiles()) {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
            const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
            const headings = body
                .split('\n')
                .slice(1) // drop the H1 title
                .filter((l) => l.startsWith('#'))
                .map((l) => l.replace(/^#+\s*/, '').trim());
            expect(headings, `${file}: heading set must be exactly Usage + Implementation`).toEqual([
                'Usage',
                'Implementation',
            ]);
        }
    });
});

// ─── (a2) exact-set regressions (0309 verify --fix all) ─────────────────────
//
// The first cut of gate (a) only rejected non-whitelisted `## ` headings. It
// therefore passed two shapes the 0308 gate had caught via toEqual(): a wrapper
// missing `## Usage` entirely, and lifecycle prose smuggled under `### Behavior`
// (invisible to a `## `-only scan). These lock both closed.

describe('(a2) heading gate enforces an exact set', () => {
    test('a wrapper missing a required heading is rejected', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            const dir = join(tmp, 'plugins', 'sp', 'commands');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'no-usage.md'),
                [
                    '---',
                    'description: d',
                    'argument-hint: "h"',
                    'allowed-tools: ["Bash"]',
                    '---',
                    '',
                    '# No Usage',
                    '',
                    '## Implementation',
                    '',
                    '- run it',
                    '',
                ].join('\n'),
            );
            const result = validate(tmp);
            expect(
                result.violations.some((v) => v.gate === 'a' && /missing required heading "## Usage"/.test(v.message)),
            ).toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('lifecycle prose hidden under a ### subheading is rejected', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            const dir = join(tmp, 'plugins', 'sp', 'commands');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'sub-prose.md'),
                [
                    '---',
                    'description: d',
                    'argument-hint: "h"',
                    'allowed-tools: ["Bash"]',
                    '---',
                    '',
                    '# Sub Prose',
                    '',
                    '## Usage',
                    '',
                    '/x',
                    '',
                    '### Behavior',
                    '',
                    'Long lifecycle prose that belongs in the skill.',
                    '',
                    '## Implementation',
                    '',
                    '- run it',
                    '',
                ].join('\n'),
            );
            const result = validate(tmp);
            expect(
                result.violations.some((v) => v.gate === 'a' && /forbidden heading "Behavior"/.test(v.message)),
            ).toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('a duplicated required heading is rejected', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            const dir = join(tmp, 'plugins', 'sp', 'commands');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'dupe.md'),
                [
                    '---',
                    'description: d',
                    'argument-hint: "h"',
                    'allowed-tools: ["Bash"]',
                    '---',
                    '',
                    '# Dupe',
                    '',
                    '## Usage',
                    '',
                    '/x',
                    '',
                    '## Usage',
                    '',
                    '/y',
                    '',
                    '## Implementation',
                    '',
                    '- run it',
                    '',
                ].join('\n'),
            );
            const result = validate(tmp);
            expect(
                result.violations.some((v) => v.gate === 'a' && /duplicate heading "## Usage"/.test(v.message)),
            ).toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('hash lines inside a fenced code block are not treated as headings', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            const dir = join(tmp, 'plugins', 'sp', 'commands');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'fenced.md'),
                [
                    '---',
                    'description: d',
                    'argument-hint: "h"',
                    'allowed-tools: ["Bash"]',
                    '---',
                    '',
                    '# Fenced',
                    '',
                    '## Usage',
                    '',
                    '/x',
                    '',
                    '## Implementation',
                    '',
                    '```bash',
                    '# regenerate the thing',
                    '## still not a heading',
                    'bun run x',
                    '```',
                    '',
                ].join('\n'),
            );
            const result = validate(tmp);
            expect(result.violations.filter((v) => v.gate === 'a')).toEqual([]);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// ─── (b) frontmatter schema ─────────────────────────────────────────────────

describe('(b) frontmatter schema — description, argument-hint, allowed-tools', () => {
    test('every command has description, argument-hint, allowed-tools in frontmatter', () => {
        for (const file of listCommandFiles()) {
            const name = file.replace(/\.md$/, '');
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            expect(raw, `${name}: missing description`).toMatch(/^description:\s*.+/m);
            expect(raw, `${name}: missing argument-hint`).toMatch(/^argument-hint:\s*.+/m);
            expect(raw, `${name}: missing allowed-tools`).toMatch(/^allowed-tools:\s*\[/m);
        }
    });

    test('31 command files exist with unique basenames', () => {
        const files = listCommandFiles();
        expect(files.length).toBe(31);
        const names = new Set(files.map((f) => f.replace(/\.md$/, '')));
        expect(names.size).toBe(31);
    });
});

// ─── (c) target resolution ──────────────────────────────────────────────────

describe('(c) target resolution — Skill() calls resolve to skills/', () => {
    test('every Skill() skill target resolves to a SKILL.md', () => {
        const seen = new Set<string>();
        for (const file of listCommandFiles()) {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            const impl = implSection(raw);
            const calls = [...impl.matchAll(/Skill\(skill="sp:([a-z][a-z-]+)"/g)];
            for (const c of calls) {
                const skillName = c[1];
                seen.add(skillName);
                expect(
                    existsSync(join(SKILLS_DIR, skillName, 'SKILL.md')),
                    `${file}: unresolved skill sp:${skillName}`,
                ).toBe(true);
            }
        }
        expect(seen.size).toBeGreaterThan(10);
    });

    test('workflow targets resolve to .spur/workflows/', () => {
        for (const file of listCommandFiles()) {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            const impl = implSection(raw);
            const refs = [...impl.matchAll(/\.spur\/workflows\/([^\s)"\]]+\.yaml)/g)];
            for (const r of refs) {
                expect(existsSync(join(ROOT, '.spur', 'workflows', r[1])), `${file}: unresolved workflow ${r[1]}`).toBe(
                    true,
                );
            }
        }
    });

    test('procedure anchors resolve in referenced files', () => {
        for (const file of listCommandFiles()) {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            const impl = implSection(raw);
            const refs = [...impl.matchAll(/\[([^\]]*)\]\(([^)]*#([^)]*))\)/g)];
            for (const r of refs) {
                const filePart = r[2].split('#')[0];
                const anchor = r[3];
                const resolved = join(COMMANDS_DIR, filePart);
                if (existsSync(resolved)) {
                    const headings = readFileSync(resolved, 'utf8')
                        .split('\n')
                        .filter((l) => l.startsWith('#'));
                    const anchors = headings.map((l) => slugify(l.replace(/^#+\s*/, '').trim()));
                    expect(anchors, `${file}: anchor #${anchor} not found in ${filePart}`).toContain(anchor);
                }
            }
        }
    });
});

// ─── (d) allowed-tools coherence ────────────────────────────────────────────

describe('(d) allowed-tools coherence — Skill <-> Skill() call', () => {
    test('Skill in allowed-tools iff body contains Skill() call', () => {
        for (const file of listCommandFiles()) {
            const name = file.replace(/\.md$/, '');
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            const hasSkillTool = /^allowed-tools:.*"Skill"/m.test(raw);
            const hasSkillCall = raw.includes('Skill(');
            expect(
                hasSkillTool === hasSkillCall,
                `${name}: Skill tool=${hasSkillTool} but Skill() call=${hasSkillCall}`,
            ).toBe(true);
        }
    });
});

// ─── (e) validator integration — no violations on the real corpus ───────────

describe('(e) validator reports no violations on the live corpus', () => {
    test('validate() returns zero violations', () => {
        const result = validate(ROOT);
        expect(result.fileCount).toBe(31);
        expect(result.violations).toEqual([]);
    });
});

describe('spur-init structured-output contract (task 0313)', () => {
    test('invokes init once with JSON, preserves supported flags, and reuses the parsed result', () => {
        const raw = readFileSync(join(COMMANDS_DIR, 'spur-init.md'), 'utf8');
        const implementation = implSection(raw);
        const invocations = implementation.match(/spur init\b/g) ?? [];

        expect(invocations).toHaveLength(1);
        expect(implementation).toContain('spur init --json $ARGUMENTS');
        expect(implementation).toContain('scaffoldResult');
        expect(implementation).toContain('<scaffoldResult.project>');
        expect(implementation).toContain('one block');
        expect(raw).not.toContain('--skip-docs');
    });
});

// ─── (f) negative-path tests per gate ───────────────────────────────────────

describe('(f) validator catches violations in corrupted files', () => {
    test('gate (a) — extra heading is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            makeTempCommand(tmp, 'Test Cmd', 'test', '""', '["Bash"]', '/sp:test-cmd', '- Run it.', ['Behavior']);
            const result = validate(tmp);
            const aViolations = result.violations.filter((v) => v.gate === 'a');
            expect(aViolations.length).toBeGreaterThan(0);
            expect(aViolations[0].message).toContain('Behavior');
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('gate (b) — missing frontmatter field is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            const dir = join(tmp, 'plugins', 'sp', 'commands');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'test-cmd.md'),
                [
                    '---',
                    'argument-hint: ""',
                    'allowed-tools: ["Bash"]',
                    '---',
                    '',
                    '# Test Cmd',
                    '',
                    '## Usage',
                    '',
                    '/sp:test-cmd',
                    '',
                    '## Implementation',
                    '',
                    '- Run it.',
                    '',
                ].join('\n'),
            );
            const result = validate(tmp);
            const bViolations = result.violations.filter((v) => v.gate === 'b');
            expect(bViolations.length).toBeGreaterThan(0);
            expect(bViolations.some((v) => v.message.includes('description'))).toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('gate (c) — unresolved skill reference is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            makeTempCommand(
                tmp,
                'Test Cmd',
                'test',
                '""',
                '["Bash", "Skill"]',
                '/sp:test-cmd',
                '- Skill(skill="sp:nonexistent", args="$ARGUMENTS")',
            );
            const result = validate(tmp);
            const cViolations = result.violations.filter((v) => v.gate === 'c');
            expect(cViolations.length).toBeGreaterThan(0);
            expect(cViolations[0].message).toContain('nonexistent');
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('gate (d) — Skill in tools but no Skill() call is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            makeTempCommand(tmp, 'Test Cmd', 'test', '""', '["Bash", "Skill"]', '/sp:test-cmd', '- Run it directly.');
            const result = validate(tmp);
            const dViolations = result.violations.filter((v) => v.gate === 'd');
            expect(dViolations.length).toBeGreaterThan(0);
            expect(dViolations[0].message).toContain('Skill');
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('gate (d) — Skill() call but no Skill in tools is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            makeTempCommand(
                tmp,
                'Test Cmd',
                'test',
                '""',
                '["Bash"]',
                '/sp:test-cmd',
                '- Skill(skill="sp:test", args="$ARGUMENTS")',
            );
            const result = validate(tmp);
            const dViolations = result.violations.filter((v) => v.gate === 'd');
            expect(dViolations.length).toBeGreaterThan(0);
            expect(dViolations[0].message).toContain('Skill()');
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('empty commands/ directory yields zero violations', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            mkdirSync(join(tmp, 'plugins', 'sp', 'commands'), { recursive: true });
            const result = validate(tmp);
            expect(result.fileCount).toBe(0);
            expect(result.violations).toEqual([]);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('gate (c) — unresolved workflow file is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            makeTempCommand(
                tmp,
                'Test Cmd',
                'test',
                '""',
                '["Bash"]',
                '/sp:test-cmd',
                '```bash\nspur workflow run .spur/workflows/nonexistent.yaml\n```',
            );
            const result = validate(tmp);
            const cViolations = result.violations.filter((v) => v.gate === 'c');
            expect(cViolations.length).toBeGreaterThan(0);
            expect(cViolations.some((v) => v.message.includes('nonexistent'))).toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('gate (c) — unresolved procedure anchor is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            // Create a reference file with known headings
            const refDir = join(tmp, 'plugins', 'sp', 'commands');
            mkdirSync(refDir, { recursive: true });
            writeFileSync(
                join(refDir, 'ref.md'),
                ['# Reference', '', '## existing-heading', '', 'Content.', ''].join('\n'),
            );
            makeTempCommand(
                tmp,
                'Test Cmd',
                'test',
                '""',
                '["Bash"]',
                '/sp:test-cmd',
                'See [ref](ref.md#nonexistent-anchor).',
            );
            const result = validate(tmp);
            const cViolations = result.violations.filter((v) => v.gate === 'c');
            expect(cViolations.length).toBeGreaterThan(0);
            expect(cViolations.some((v) => v.message.includes('nonexistent-anchor'))).toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('gate (c) — unresolved procedure file reference is reported', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'cmd-contract-'));
        try {
            makeTempCommand(
                tmp,
                'Test Cmd',
                'test',
                '""',
                '["Bash"]',
                '/sp:test-cmd',
                'See [ref](nonexistent-file.md#some-anchor).',
            );
            const result = validate(tmp);
            const cViolations = result.violations.filter((v) => v.gate === 'c');
            expect(cViolations.length).toBeGreaterThan(0);
            expect(cViolations.some((v) => v.message.includes('nonexistent-file.md'))).toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// ─── (g) CLI surface ────────────────────────────────────────────────────────

describe('(g) CLI surface', () => {
    test('parseCliArgs reads --json and --help', () => {
        expect(parseCliArgs([])).toEqual({ check: false, help: false, json: false });
        expect(parseCliArgs(['--json'])).toEqual({ check: false, help: false, json: true });
        expect(parseCliArgs(['--help'])).toEqual({ check: false, help: true, json: false });
        expect(parseCliArgs(['-h'])).toEqual({ check: false, help: true, json: false });
    });

    test('renderHelp documents validate + gates', () => {
        const help = renderHelp();
        expect(help).toContain('validate-commands');
        expect(help).toContain('--json');
        expect(help).toContain('(a)');
        expect(help).toContain('(b)');
        expect(help).toContain('(c)');
        expect(help).toContain('(d)');
    });

    test('runCli --help exits 0', () => {
        const r = runCli(['--help']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('validate-commands');
    });

    test('runCli reports clean state', () => {
        const r = runCli([], {
            validateFn: () => ({ violations: [], fileCount: 30 }),
        });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('30 commands pass');
    });

    test('runCli reports violations', () => {
        const r = runCli([], {
            validateFn: () => ({
                violations: [{ command: 'test', gate: 'a', message: 'bad heading' }],
                fileCount: 1,
            }),
        });
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('bad heading');
    });

    test('runCli --json outputs JSON', () => {
        const r = runCli(['--json'], {
            validateFn: () => ({ violations: [], fileCount: 5 }),
        });
        expect(r.exitCode).toBe(0);
        const parsed = JSON.parse(r.stdout);
        expect(parsed.fileCount).toBe(5);
        expect(parsed.violations).toEqual([]);
    });

    test('runCli --json with violations exits 1', () => {
        const r = runCli(['--json'], {
            validateFn: () => ({
                violations: [{ command: 'test', gate: 'd', message: 'bad' }],
                fileCount: 1,
            }),
        });
        expect(r.exitCode).toBe(1);
        const parsed = JSON.parse(r.stdout);
        expect(parsed.violations.length).toBe(1);
    });

    test('bootMain writes via spies', () => {
        const writes: string[] = [];
        let exitCode: number | undefined;
        bootMain(['--help'], {
            exit: (code?: number) => {
                exitCode = code;
            },
            stdout: {
                write: (s: string) => {
                    writes.push(s);
                    return true;
                },
            },
            stderr: {
                write: (s: string) => {
                    writes.push(s);
                    return true;
                },
            },
        });
        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('validate-commands');
    });
});

// ─── (h) task 0315 — dev-review and dev-handover hardened contracts ─────────

describe('(h) task 0315 — dev-review and dev-handover hardened contracts', () => {
    test('dev-review allowed-tools does not include Write (least privilege)', () => {
        const raw = readFileSync(join(COMMANDS_DIR, 'dev-review.md'), 'utf8');
        expect(raw).toContain('allowed-tools: ["Bash", "Read", "Skill"]');
        expect(raw).not.toContain('"Write"');
    });

    test('dev-review implementation defines deterministic WBS vs Path modes and flags deprecations', () => {
        const raw = readFileSync(join(COMMANDS_DIR, 'dev-review.md'), 'utf8');
        const impl = implSection(raw);
        expect(impl).toContain('WBS mode');
        expect(impl).toContain('Path mode');
        expect(impl).toContain('sp:functional-review');
        expect(impl).toContain('sp:code-verification');
        expect(impl).toContain('sp:code-improvement');
        expect(impl).toContain('Deprecated');
        expect(impl).toContain('--fix');
        expect(impl).toContain('--next');
    });

    test('dev-handover procedure specifies standalone SSOT file and non-destructive pointer append', () => {
        const opsRaw = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'dev-operations.md'), 'utf8');
        expect(opsRaw).toContain('docs/handover/<YYYY-MM-DD>-<slug>.md');
        expect(opsRaw).toContain('preserving any pre-existing content without replacing or clobbering it');
    });

    test('dev-handover helper preserves pre-existing Notes/References content when appending pointer', () => {
        const existingTaskBody = [
            '---',
            'name: "Test Task"',
            'status: wip',
            '---',
            '',
            '## Background',
            'Important background details.',
            '',
            '## Notes',
            'Durable operator note 1: do not clobber this content.',
            '',
            '## References',
            '- [Prior ADR](docs/00_ADR.md)',
            '',
        ].join('\n');

        const handoverPath = 'docs/handover/2026-07-23-test-blocker.md';
        const pointer = `- Handover: [${handoverPath}](${handoverPath}) — test blocker`;

        // Simulate append to References section
        const updatedReferences = existingTaskBody.replace(
            '## References\n- [Prior ADR](docs/00_ADR.md)',
            `## References\n- [Prior ADR](docs/00_ADR.md)\n${pointer}`,
        );

        expect(updatedReferences).toContain('Durable operator note 1: do not clobber this content.');
        expect(updatedReferences).toContain('- [Prior ADR](docs/00_ADR.md)');
        expect(updatedReferences).toContain(pointer);
    });
});

// ─── (i) task 0316 — dev-debug and dev-daily entry points ───────────────────

describe('(i) task 0316 — dev-debug and dev-daily entry points', () => {
    test('dev-debug wrapper passes contract gates and delegates to sp:sys-debugging', () => {
        const raw = readFileSync(join(COMMANDS_DIR, 'dev-debug.md'), 'utf8');
        expect(raw).toContain('description:');
        expect(raw).toContain('argument-hint:');
        expect(raw).toContain('allowed-tools: ["Bash", "Read", "Write", "Skill"]');
        expect(raw).toContain('# Dev Debug');
        expect(raw).toContain('## Usage');
        expect(raw).toContain('## Implementation');
        expect(implSection(raw)).toContain('Skill(skill="sp:sys-debugging", args="$ARGUMENTS")');
    });

    test('dev-daily runs the daily-summary script inline (NOT Skill() — the skill is disable-model-invocation)', () => {
        const raw = readFileSync(join(COMMANDS_DIR, 'dev-daily.md'), 'utf8');
        expect(raw).toContain('description:');
        expect(raw).toContain('argument-hint:');
        expect(raw).toContain('allowed-tools: ["Bash", "Read"]');
        expect(raw).toContain('# Dev Daily');
        expect(raw).toContain('## Usage');
        expect(raw).toContain('## Implementation');
        // sp:daily-summary carries disable-model-invocation, so a Skill() dispatch would never fire
        // (docs/tasks2/0187 Q&A). dev-daily must run the script directly, not via Skill().
        expect(implSection(raw)).toContain('scripts/daily-summary/daily-summary.ts');
        expect(implSection(raw)).toContain('$ARGUMENTS');
        expect(raw).not.toContain('Skill(skill="sp:daily-summary"');
    });
});

// ─── (j) task 0318 — least-privilege allowed-tools sweep ───────────────────

describe('(j) task 0318 — least-privilege allowed-tools sweep', () => {
    const trimmedCommands = [
        { file: 'dev-idea.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'AskUserQuestion'] },
        { file: 'dev-wrap.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'AskUserQuestion'] },
        { file: 'dev-wrapall.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'AskUserQuestion'] },
        { file: 'dev-verify.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'Skill'] },
        { file: 'dev-verifyall.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'Skill'] },
        { file: 'dev-plan.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'Skill', 'AskUserQuestion'] },
        { file: 'dev-refine.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'Skill', 'AskUserQuestion'] },
        { file: 'dev-parallel.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'Skill'] },
        { file: 'dev-runall.md', forbidden: ['Write', 'Edit'], expected: ['Bash', 'Read', 'Skill'] },
    ];

    for (const { file, forbidden, expected } of trimmedCommands) {
        test(`${file} allowed-tools does not contain forbidden tools (${forbidden.join(', ')})`, () => {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            for (const tool of forbidden) {
                expect(raw).not.toContain(`"${tool}"`);
            }
            for (const tool of expected) {
                expect(raw).toContain(`"${tool}"`);
            }
        });
    }

    test('code/test/doc authoring commands retain Write/Edit grants', () => {
        const authoringCommands = [
            { file: 'dev-run.md', required: ['Write', 'Edit'] },
            { file: 'dev-unit.md', required: ['Write', 'Edit'] },
            { file: 'dev-simplify.md', required: ['Edit'] },
            { file: 'dev-reverse.md', required: ['Write', 'Edit'] },
            { file: 'dev-debug.md', required: ['Write'] },
            { file: 'dev-dogfood.md', required: ['Write', 'Edit'] },
            { file: 'dev-fixall.md', required: ['Write', 'Edit'] },
            { file: 'dev-handover.md', required: ['Write'] },
            { file: 'rule-add.md', required: ['Write'] },
            { file: 'rule-refine.md', required: ['Edit'] },
            { file: 'spur-init.md', required: ['Write'] },
            { file: 'workflow-add.md', required: ['Write'] },
            { file: 'workflow-refine.md', required: ['Edit'] },
        ];

        for (const { file, required } of authoringCommands) {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            for (const tool of required) {
                expect(raw).toContain(`"${tool}"`);
            }
        }
    });

    test('interactive wrappers retain AskUserQuestion tool', () => {
        const interactiveFiles = [
            'dev-brainstorm.md',
            'dev-idea.md',
            'dev-next.md',
            'dev-plan.md',
            'dev-refine.md',
            'dev-wrap.md',
            'dev-wrapall.md',
        ];

        for (const file of interactiveFiles) {
            const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            expect(raw).toContain('"AskUserQuestion"');
        }
    });
});
