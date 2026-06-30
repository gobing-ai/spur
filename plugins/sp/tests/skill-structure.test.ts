/**
 * sp plugin structural invariants (task 0161, ADR-028).
 *
 * The functional skill split decomposed the spur-dev umbrella into a thin orchestration spine plus
 * deep competency skills (sys-architecture, code-implementation, code-testing, code-verification,
 * spec-decomposition) and a single CLI facade (spur-cli). These assertions lock the invariants the
 * split depends on, so a future edit that violates one fails the gate instead of silently rotting:
 *
 *   R13  — cross-cutting.md is single-SSOT: exactly one physical copy across the plugin.
 *   R16a — disjoint trigger surfaces: the spine and the competency skills do not share a routing
 *          keyword that would make skill selection ambiguous.
 *   R16b — every cross-skill `sp:<skill>` reference names a skill that actually exists.
 *   R16c — relative markdown links inside skill files resolve to a real file.
 *   R16d — no retired skill/agent name is referenced anywhere in the plugin.
 *   R20  — the plugin is self-contained: no shipped file references `vendors/` or the external rd3
 *          plugin path. Research-time evidence is never a runtime/documentation dependency.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PLUGIN_ROOT = join(import.meta.dir, '..');
const SKILLS_DIR = join(PLUGIN_ROOT, 'skills');
const AGENTS_DIR = join(PLUGIN_ROOT, 'agents');

/** Recursively collect every file under `dir` matching `pred`. */
function walk(dir: string, pred: (p: string) => boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, pred));
        } else if (pred(full)) {
            out.push(full);
        }
    }
    return out;
}

const allMarkdown = walk(PLUGIN_ROOT, (p) => p.endsWith('.md'));
const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

describe('sp plugin structure — functional split invariants (task 0161 / ADR-028)', () => {
    test('R13 — cross-cutting.md exists exactly once across the plugin', () => {
        const copies = allMarkdown.filter((p) => p.endsWith('cross-cutting.md'));
        expect(copies.map((p) => relative(PLUGIN_ROOT, p))).toEqual(['skills/spur-dev/references/cross-cutting.md']);
    });

    test('R16a — spine and competency skills have disjoint trigger surfaces', () => {
        // The work-unit keywords each competency owns; the spine must NOT trigger on these
        // (it dispatches the competency instead). This is the routing-ambiguity guard.
        const spineDesc = readFileSync(join(SKILLS_DIR, 'spur-dev', 'SKILL.md'), 'utf8')
            .split('---')[1] // frontmatter block
            .toLowerCase();
        // Phrases that belong to a competency's trigger, not the spine's.
        const competencyOnlyTriggers = [
            'decompose this',
            'create tasks from this',
            'write code',
            'measure coverage',
            "what's the right approach",
        ];
        for (const phrase of competencyOnlyTriggers) {
            expect(
                spineDesc.includes(phrase),
                `spine description must not trigger on competency phrase "${phrase}"`,
            ).toBe(false);
        }
    });

    test("R16b — references to this plugin's own skills name an existing skill", () => {
        // We only assert integrity of references to THIS plugin's skills/agents/commands — a
        // dangling `sp:<our-skill>` is the mis-route this guards. Cross-plugin names (e.g.
        // sp:product-management, sp:super-pm from the rd3 plugin) and slash-command names
        // (sp:dev-*, sp:rule-*, sp:workflow-*, sp:brainstorm-*, sp:prd-*) are out of scope here.
        const ownSkills = new Set(skillDirs);
        const ownAgents = new Set(
            readdirSync(AGENTS_DIR)
                .filter((f) => f.endsWith('.md'))
                .map((f) => f.replace(/\.md$/, '')),
        );
        const commandPrefixes = /^(dev|rule|workflow|brainstorm|prd|magent|agent|command|skill|hook)-/;
        const crossPluginOrCommand = (name: string) => commandPrefixes.test(name) || name === 'spur-init';
        const offenders: string[] = [];
        for (const file of allMarkdown) {
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(/\bsp:([a-z][a-z0-9-]+)\b/g)) {
                const name = match[1];
                if (crossPluginOrCommand(name)) continue;
                if (ownSkills.has(name) || ownAgents.has(name)) continue;
                // A `spur-` / `code-` / `sys-` / `expert-` prefixed name is unambiguously meant to be
                // one of THIS plugin's skills/agents — if it has no home, it is a dangling reference.
                if (/^(spur-|code-|sys-|spec-|expert-)/.test(name)) {
                    offenders.push(`${relative(PLUGIN_ROOT, file)} → sp:${name}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('R16c — relative markdown links inside skill files resolve', () => {
        const broken: string[] = [];
        const linkRe = /\]\((?!https?:|#)([^)]+\.md)(?:#[^)]*)?\)/g;
        for (const file of walk(SKILLS_DIR, (p) => p.endsWith('.md'))) {
            const raw = readFileSync(file, 'utf8');
            // Strip fenced code blocks and inline-code spans: a link inside backticks documents a
            // FORMAT (e.g. the roster-row example `[0110](0110_<slug>.md)`), it is not a navigable link.
            const text = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
            const dir = join(file, '..');
            for (const match of text.matchAll(linkRe)) {
                // Skip obvious placeholders (angle-bracket vars like <slug>).
                if (match[1].includes('<')) continue;
                const target = join(dir, match[1]);
                try {
                    statSync(target);
                } catch {
                    broken.push(`${relative(PLUGIN_ROOT, file)} → ${match[1]}`);
                }
            }
        }
        expect(broken).toEqual([]);
    });

    test('R16d — no retired skill/agent name is referenced anywhere in the plugin', () => {
        // Retired in Wave A (noun-skills + noun-experts + expert-dev). The spur-cli facade and
        // expert-spur subagent replaced them; super-coder absorbed expert-dev's single-task role.
        const retired = [
            'sp:spur-tasks',
            'sp:spur-features',
            'sp:spur-rules',
            'sp:spur-workflows',
            'sp:expert-tasks',
            'sp:expert-features',
            'sp:expert-rules',
            'sp:expert-workflows',
            'sp:expert-dev',
        ];
        const offenders: string[] = [];
        for (const file of allMarkdown) {
            const text = readFileSync(file, 'utf8');
            for (const name of retired) {
                if (text.includes(name)) {
                    offenders.push(`${relative(PLUGIN_ROOT, file)} → ${name}`);
                }
            }
        }
        // super-coder.md intentionally narrates the expert-dev retirement in prose ("the role
        // formerly held by the retired expert-dev"); allow that single historical mention without
        // the sp: prefix — the assertion above only flags the sp:-prefixed skill/agent references
        // that would actually mis-route.
        expect(offenders).toEqual([]);
    });

    test('R20 — no shipped plugin file references vendors/ or the external rd3 plugin', () => {
        const offenders: string[] = [];
        // Research-time evidence only; never a runtime/documentation dependency (ADR-028d).
        const forbidden = [/\bvendors\//, /cc-agents\/plugins\/rd3/, /\/plugins\/rd3\//];
        const files = [
            ...allMarkdown,
            ...walk(SKILLS_DIR, (p) => p.endsWith('.yaml') || p.endsWith('.yml')),
            ...(statSync(AGENTS_DIR).isDirectory() ? walk(AGENTS_DIR, (p) => p.endsWith('.md')) : []),
        ];
        for (const file of new Set(files)) {
            const text = readFileSync(file, 'utf8');
            for (const re of forbidden) {
                if (re.test(text)) {
                    offenders.push(`${relative(PLUGIN_ROOT, file)} → ${re.source}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the five competency skills and the spur-cli facade all exist', () => {
        for (const name of [
            'sys-architecture',
            'code-implementation',
            'code-testing',
            'code-verification',
            'spec-decomposition',
            'spur-cli',
        ]) {
            expect(skillDirs, `missing skill: ${name}`).toContain(name);
            statSync(join(SKILLS_DIR, name, 'SKILL.md')); // throws if absent
        }
    });
});
