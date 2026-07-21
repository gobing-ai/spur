/**
 * adapter-drift.test — the drift-test contract for generated adapters
 * (feature O wave-2, task 0308; spec ticket 0283 R7/R8).
 *
 * (a) contract test — every wrapper's skill/workflow/procedure target exists and resolves.
 * (b) metadata-parity test — slash vs dollar-skill wrappers over the same command carry
 *     identical name/argument-hint/description.
 * (c) no-prose test — wrapper bodies match the generator byte-for-byte (the strongest form
 *     of "invocation syntax + delegation line only") plus a forbidden-headings grep gate.
 * (d) snapshot invalidation — the embedded snapshot hash versions each wrapper against the
 *     registry; the marker mandates a fresh session before dogfooding an edited wrapper.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMAND_BY_NAME, COMMANDS, type CommandMeta } from '../scripts/command-registry';
import {
    bootMain,
    checkAdapters,
    claudeDelegation,
    claudeRelPath,
    codexDelegation,
    codexRelPath,
    markerLine,
    parseCliArgs,
    renderClaudeWrapper,
    renderCodexWrapper,
    renderHelp,
    runCli,
    snapshotHash,
    TEMPLATE_VERSION,
    wrapsLine,
    writeAdapters,
} from '../scripts/generate-adapters';

const ROOT = join(import.meta.dir, '..', '..', '..');
const SKILLS_DIR = join(ROOT, 'plugins', 'sp', 'skills');

function meta(name: string): CommandMeta {
    const m = COMMAND_BY_NAME.get(name);
    if (!m) throw new Error(`registry missing ${name}`);
    return m;
}

/** GitHub-style heading slug, for procedure-anchor resolution. */
function slugify(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number} -]/gu, '')
        .replaceAll(' ', '-');
}

function fileHeadings(path: string): string[] {
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('#'))
        .map((l) => l.replace(/^#+\s*/, '').trim());
}

// ─── Registry integrity ─────────────────────────────────────────────────────

describe('command registry integrity', () => {
    test('28 commands, unique names, non-empty frontmatter fields', () => {
        expect(COMMANDS.length).toBe(28);
        const names = new Set(COMMANDS.map((c) => c.name));
        expect(names.size).toBe(28);
        for (const c of COMMANDS) {
            expect(c.title.length).toBeGreaterThan(0);
            expect(c.description.length).toBeGreaterThan(0);
            expect(c.argumentHint.length).toBeGreaterThan(0);
            expect(c.allowedTools.length).toBeGreaterThan(0);
        }
    });

    test('COMMAND_BY_NAME covers every command', () => {
        expect(COMMAND_BY_NAME.size).toBe(COMMANDS.length);
    });
});

// ─── (a) contract test — targets exist and resolve ──────────────────────────

describe('(a) contract — every wrapper target resolves', () => {
    test('skill dispatches resolve to plugins/sp/skills/<name>/SKILL.md', () => {
        const seen = new Set<string>();
        for (const c of COMMANDS) {
            const t = c.target;
            const dispatches = t.kind === 'skill' || t.kind === 'composite' ? t.dispatches : [];
            for (const d of dispatches) {
                seen.add(d.skill);
                const dir = d.skill.replace(/^sp:/, '');
                expect(existsSync(join(SKILLS_DIR, dir, 'SKILL.md')), `missing skill for ${d.skill}`).toBe(true);
            }
        }
        expect(seen.size).toBeGreaterThan(10);
    });

    test('workflow targets resolve to .spur/workflows/<workflow>', () => {
        const workflows = COMMANDS.filter((c) => c.target.kind === 'workflow');
        expect(workflows.length).toBe(3);
        for (const c of workflows) {
            if (c.target.kind !== 'workflow') continue;
            expect(existsSync(join(ROOT, '.spur', 'workflows', c.target.workflow))).toBe(true);
        }
    });

    test('procedure targets resolve to a dev-operations.md heading anchor', () => {
        const procedures = COMMANDS.filter((c) => c.target.kind === 'procedure');
        expect(procedures.length).toBe(4);
        for (const c of procedures) {
            if (c.target.kind !== 'procedure') continue;
            const refPath = join(SKILLS_DIR, c.target.referenceFile);
            expect(existsSync(refPath), `missing ${c.target.referenceFile}`).toBe(true);
            const anchors = fileHeadings(refPath).map(slugify);
            expect(anchors, `${c.name}: anchor #${c.target.anchor} not found`).toContain(c.target.anchor);
        }
    });
});

// ─── (b) metadata-parity test ────────────────────────────────────────────────

describe('(b) metadata parity — slash vs dollar-skill wrappers', () => {
    test('every command has both wrappers on disk', () => {
        for (const c of COMMANDS) {
            expect(existsSync(join(ROOT, claudeRelPath(c))), claudeRelPath(c)).toBe(true);
            expect(existsSync(join(ROOT, codexRelPath(c))), codexRelPath(c)).toBe(true);
        }
    });

    test('name + argument-hint + description are identical across both wrappers', () => {
        for (const c of COMMANDS) {
            const claude = readFileSync(join(ROOT, claudeRelPath(c)), 'utf8');
            const codex = readFileSync(join(ROOT, codexRelPath(c)), 'utf8');
            // Same command identity: /sp:<name> vs $sp-<name>
            expect(claude).toContain(`/sp:${c.name} ${c.argumentHint}`);
            expect(codex).toContain(`$sp-${c.name} ${c.argumentHint}`);
            expect(codex).toContain(`name: sp-${c.name}`);
            // Identical argument-hint and description strings in both frontmatters
            const ah = c.argumentHint.replaceAll('"', '\\"');
            expect(claude).toContain(`argument-hint: "${ah}"`);
            expect(codex).toContain(c.description.includes('"') ? c.description.split(' — ')[0] : c.description);
        }
    });
});

// ─── (c) no-prose test ───────────────────────────────────────────────────────

describe('(c) no-prose — wrappers carry invocation syntax + delegation only', () => {
    test('every wrapper on disk matches a fresh render byte-for-byte', () => {
        for (const c of COMMANDS) {
            expect(readFileSync(join(ROOT, claudeRelPath(c)), 'utf8'), claudeRelPath(c)).toBe(renderClaudeWrapper(c));
            expect(readFileSync(join(ROOT, codexRelPath(c)), 'utf8'), codexRelPath(c)).toBe(renderCodexWrapper(c));
        }
    });

    test('grep gate — no lifecycle-prose headings beyond the template', () => {
        const forbidden = /^## (When to use|Behavior|Workflow|Arguments|Q&A|Examples|Naming|Mode resolution)/m;
        for (const c of COMMANDS) {
            const claude = readFileSync(join(ROOT, claudeRelPath(c)), 'utf8');
            const codex = readFileSync(join(ROOT, codexRelPath(c)), 'utf8');
            expect(forbidden.test(claude), `${c.name} claude wrapper carries prose`).toBe(false);
            expect(forbidden.test(codex), `${c.name} codex wrapper carries prose`).toBe(false);
            // Template headings only
            const headings = fileHeadings(join(ROOT, claudeRelPath(c))).filter((h) => h !== c.title);
            expect(headings).toEqual(['Usage', 'Implementation']);
        }
    });
});

// ─── (d) snapshot invalidation ───────────────────────────────────────────────

describe('(d) snapshot invalidation — adapters version the snapshot', () => {
    test('embedded snapshot matches the registry hash in both wrappers', () => {
        for (const c of COMMANDS) {
            const hash = snapshotHash(c);
            expect(readFileSync(join(ROOT, claudeRelPath(c)), 'utf8')).toContain(`snapshot:${hash}`);
            expect(readFileSync(join(ROOT, codexRelPath(c)), 'utf8')).toContain(`snapshot:${hash}`);
        }
    });

    test('hash changes when any metadata field changes (staleness detectable)', () => {
        const base = meta('dev-run');
        const changed = { ...base, description: `${base.description} edited` };
        expect(snapshotHash(changed)).not.toBe(snapshotHash(base));
        const changedTools = { ...base, allowedTools: [...base.allowedTools, 'Write'] };
        expect(snapshotHash(changedTools)).not.toBe(snapshotHash(base));
    });

    test('marker mandates a fresh session before in-session dogfood of an edited wrapper', () => {
        const marker = markerLine(meta('dev-next'));
        expect(marker).toContain(`v${TEMPLATE_VERSION}`);
        expect(marker).toContain('fresh session');
        expect(marker).toContain('dogfood');
    });
});

// ─── Generator units (coverage) ──────────────────────────────────────────────

describe('generator rendering', () => {
    test('wrapsLine per target kind', () => {
        expect(wrapsLine(meta('dev-next'))).toBe('Wraps the **sp:next-router** skill.');
        expect(wrapsLine(meta('dev-review'))).toContain('sp:functional-review');
        expect(wrapsLine(meta('dev-review'))).toContain('skills');
        expect(wrapsLine(meta('dev-wrap'))).toBe('Wraps the **wrapup-pipeline.yaml** workflow.');
        expect(wrapsLine(meta('dev-changelog'))).toContain(
            '../skills/spur-dev/references/dev-operations.md#8-changelog',
        );
        expect(wrapsLine(meta('dev-changelog'), 'codex')).toContain(
            '../../skills/spur-dev/references/dev-operations.md#8-changelog',
        );
        expect(wrapsLine(meta('spur-init'))).toContain('spur init');
    });

    test('claudeDelegation renders Skill() calls with when-guards', () => {
        expect(claudeDelegation(meta('dev-next'))).toEqual(['- `Skill(skill="sp:next-router", args="$ARGUMENTS")`']);
        const run = claudeDelegation(meta('dev-run'));
        expect(run[0]).toContain('Full pipeline (default): `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")`');
        expect(run[1]).toContain('sp:code-implementation');
        expect(claudeDelegation(meta('dev-wrap'))).toEqual([
            '```bash',
            meta('dev-wrap').target.kind === 'workflow'
                ? (meta('dev-wrap').target as { invocation: string }).invocation
                : '',
            '```',
        ]);
        expect(claudeDelegation(meta('dev-fixall'))[0]).toContain('#10-fixall');
        const init = claudeDelegation(meta('spur-init'));
        expect(init).toContain('spur init $ARGUMENTS');
        expect(init[init.length - 1]).toContain('sp:doc-evolve');
    });

    test('codexDelegation renders invoke-instructions instead of Skill()', () => {
        expect(codexDelegation(meta('dev-next'))).toEqual([
            '- Invoke the **sp:next-router** skill with args `$ARGUMENTS`.',
        ]);
        const review = codexDelegation(meta('dev-review'));
        expect(review.length).toBe(3);
        expect(review[0]).toContain('Functional traceability: Invoke the **sp:functional-review** skill');
        expect(codexDelegation(meta('dev-idea'))[0]).toBe('```bash');
        expect(codexDelegation(meta('dev-handover'))[0]).toContain('../../skills/');
        const init = codexDelegation(meta('spur-init'));
        expect(init[init.length - 1]).toContain('Invoke the **sp:doc-evolve** skill');
    });

    test('yaml quoting — description with inner quotes is escaped', () => {
        const rendered = renderClaudeWrapper(meta('dev-review'));
        expect(rendered).toContain('description: "Review code for a task or path');
        expect(rendered).toContain('\\"review this\\"');
    });

    test('argument-hint with inner quotes renders escaped in frontmatter but raw in usage', () => {
        const rendered = renderClaudeWrapper(meta('dev-handover'));
        expect(rendered).toContain('argument-hint: "\\"<blocker description>\\""');
        expect(rendered).toContain('/sp:dev-handover "<blocker description>"');
    });

    test('rel paths map command name to both surfaces', () => {
        expect(claudeRelPath(meta('dev-run'))).toBe('plugins/sp/commands/dev-run.md');
        expect(codexRelPath(meta('dev-run'))).toBe('plugins/sp/adapters/codex/sp-dev-run.md');
    });
});

describe('checkAdapters / writeAdapters', () => {
    test('repo wrappers are in sync (no drift)', () => {
        expect(checkAdapters(ROOT)).toEqual([]);
    });

    test('tmp root reports every wrapper missing, then clean after writeAdapters', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'adapters-'));
        try {
            const before = checkAdapters(tmp);
            expect(before.length).toBe(COMMANDS.length * 2);
            expect(before.every((d) => d.reason === 'missing')).toBe(true);
            const written = writeAdapters(tmp);
            expect(written.length).toBe(COMMANDS.length * 2);
            expect(written).toContain('plugins/sp/commands/dev-run.md');
            expect(written).toContain('plugins/sp/adapters/codex/sp-dev-run.md');
            expect(checkAdapters(tmp)).toEqual([]);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('a hand-edited wrapper is reported stale', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'adapters-'));
        try {
            writeAdapters(tmp);
            const target = join(tmp, claudeRelPath(meta('dev-next')));
            writeFileSync(target, `${readFileSync(target, 'utf8')}\nhand edit\n`);
            const drift = checkAdapters(tmp);
            expect(drift).toEqual([{ path: claudeRelPath(meta('dev-next')), reason: 'stale' }]);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe('CLI surface', () => {
    test('parseCliArgs reads --check and --help', () => {
        expect(parseCliArgs([])).toEqual({ check: false, help: false });
        expect(parseCliArgs(['--check'])).toEqual({ check: true, help: false });
        expect(parseCliArgs(['--help'])).toEqual({ check: false, help: true });
        expect(parseCliArgs(['-h'].concat()).help).toBe(true);
    });

    test('renderHelp documents generate + check', () => {
        expect(renderHelp()).toContain('--check');
    });

    test('runCli --help exits 0 with usage', () => {
        const r = runCli(['--help']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('generate-adapters');
    });

    test('runCli --check reports clean and drift states', () => {
        const clean = runCli(['--check'], { check: () => [] });
        expect(clean.exitCode).toBe(0);
        expect(clean.stdout).toContain('all adapters in sync (56 files');
        const drift = runCli(['--check'], { check: () => [{ path: 'x.md', reason: 'stale' }] });
        expect(drift.exitCode).toBe(1);
        expect(drift.stderr).toContain('stale\tx.md');
        expect(drift.stderr).toContain('regenerate');
    });

    test('runCli generate writes via injected writer', () => {
        let called = 0;
        const r = runCli([], {
            write: () => {
                called += 1;
                return ['a.md', 'b.md'];
            },
        });
        expect(called).toBe(1);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('generated 2 wrappers from 28 commands');
    });

    test('bootMain writes streams and exits via spies', () => {
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
        expect(writes.join('')).toContain('generate-adapters');
    });

    test('bootMain defaults to runCli when no run override', () => {
        let exitCode: number | undefined;
        bootMain(['--check'], {
            exit: (code?: number) => {
                exitCode = code;
            },
            stdout: { write: () => true },
            stderr: { write: () => true },
        });
        expect(exitCode).toBe(0);
    });
});
