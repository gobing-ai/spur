/**
 * sp plugin runtime-requires guard (task 1291, feature I14 R1/R2).
 *
 * Every sp entity (skill, command, agent) declares a `requires:` frontmatter list
 * in the superskill 0162 grammar. The test derives the expected set from each
 * entity body (direct CLI invocations + the transitive closure over
 * `Skill(skill="sp:<id>")` dispatches) and compares it to the annotation, so an
 * undeclared CLI use or an inherited-but-missing token fails instead of rotting:
 *
 *   R2a/AC1 — every entity has a valid 0162 `requires` list, sorted, deduped,
 *             containing `local-fs`; no `hooks`/`subagents` (explicit allow-list).
 *   R2b/R2c/AC2 — declared ⊇ derived and declared ⊆ derived ∪ {local-fs}; the
 *             group snapshot matches the 2026-11-04 scan (AC2).
 *   AC3     — the pure check functions report undeclared use on mutated fixtures,
 *             including a command that inherits through a dispatched skill.
 *
 * Plugin standalone contract: only bun:* and node:* builtins plus relative imports here.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN_ROOT = join(import.meta.dir, '..');

const TRACKED_CLIS = ['spur', 'superskill', 'kk', 'gh'] as const;

/** Body token scan applies the 1291/0162 rule: `<name> [a-z]` at a word boundary. */
function cliInvocationRe(name: string): RegExp {
    return new RegExp(`(^|[\`( ])${name} [a-z]`, 'm');
}

const SKILL_DISPATCH_RE = /Skill\(skill="sp:([a-z0-9-]+)"/g;
const REQUIRES_TOKEN_RE = /^(hooks|subagents|local-fs|cli:[a-z0-9][a-z0-9._-]*)$/;
const HOOKS_OR_SUBAGENTS_ALLOW = new Set<string>();

interface Entity {
    /** Relative to the plugin root, e.g. `skills/wayfinder/SKILL.md`. */
    path: string;
    /** Frontmatter of the entity file. */
    frontmatter: string;
    /** Body after the frontmatter block. */
    body: string;
}

function parseEntity(filePath: string, raw: string): Entity {
    const lines = raw.split('\n');
    let end = -1;
    if (lines[0]?.trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i]?.trim() === '---') {
                end = i;
                break;
            }
        }
    }
    const rel = filePath.slice(PLUGIN_ROOT.length + 1);
    return {
        path: rel,
        frontmatter: end === -1 ? '' : lines.slice(0, end + 1).join('\n'),
        body: end === -1 || end + 1 > lines.length ? '' : lines.slice(end + 1).join('\n'),
    };
}

function listEntities(): Entity[] {
    const entities: Entity[] = [];
    const commands = readdirSync(join(PLUGIN_ROOT, 'commands')).filter((f) => f.endsWith('.md'));
    for (const f of commands) {
        entities.push(
            parseEntity(join(PLUGIN_ROOT, 'commands', f), readFileSync(join(PLUGIN_ROOT, 'commands', f), 'utf8')),
        );
    }
    const agents = readdirSync(join(PLUGIN_ROOT, 'agents')).filter((f) => f.endsWith('.md'));
    for (const f of agents) {
        entities.push(
            parseEntity(join(PLUGIN_ROOT, 'agents', f), readFileSync(join(PLUGIN_ROOT, 'agents', f), 'utf8')),
        );
    }
    for (const d of readdirSync(join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })) {
        const p = join(PLUGIN_ROOT, 'skills', d.name, 'SKILL.md');
        if (d.isDirectory() && existsSync(p)) {
            entities.push(parseEntity(p, readFileSync(p, 'utf8')));
        }
    }
    return entities;
}

const entities: Entity[] = listEntities();
const byPath: Map<string, Entity> = new Map(entities.map((e) => [e.path, e]));

/** AC1: parse `requires:` from the frontmatter via Bun.YAML. */
function declaredRequires(entity: Entity): string[] {
    let parsed = Bun.YAML.parse(entity.frontmatter) as unknown;
    if (Array.isArray(parsed)) parsed = parsed[0]; // YAML multi-document: Bun.YAML returns one entry per document
    const v = (parsed as Record<string, unknown> | null | undefined)?.requires;
    if (!Array.isArray(v)) {
        return [];
    }
    return v.map((t) => String(t));
}

/**
 * deriveRequires: direct tracked-CLI invocations ∪ closure over dispatched sp
 * skills ∪ local-fs. Memoized + cycle-safe (self-/mutually-dispatching skills
 * exist in the tree).
 */
function deriveRequires(
    target: string,
    scope: Map<string, Entity> = byPath,
    options: { memo?: Map<string, Set<string>>; inProgress?: Set<string> } = {},
): Set<string> {
    const memo = options.memo ?? memoized;
    const inProgress = options.inProgress ?? new Set<string>();
    const cached = memo.get(target);
    if (cached) return cached;
    if (inProgress.has(target)) return new Set();
    inProgress.add(target);
    const out = new Set<string>(['local-fs']);
    const entity = scope.get(target);
    if (entity) {
        for (const name of TRACKED_CLIS) {
            if (cliInvocationRe(name).test(entity.body)) out.add(`cli:${name}`);
        }
        for (const match of entity.body.matchAll(SKILL_DISPATCH_RE)) {
            const depPath = `skills/${match[1]}/SKILL.md`;
            if (scope.has(depPath)) {
                for (const token of deriveRequires(depPath, scope, { memo, inProgress })) out.add(token);
            }
        }
    }
    inProgress.delete(target);
    memo.set(target, out);
    return out;
}

const memoized: Map<string, Set<string>> = new Map();

/** checkRequires: violation messages per the frozen message shape. */
function checkRequires(list: Entity[]): string[] {
    const violations: string[] = [];
    // Fresh closure scope + memo per call: fixture entities may shadow/shed real paths.
    const scope: Map<string, Entity> = new Map(list.map((entity) => [entity.path, entity]));
    const memo: Map<string, Set<string>> = new Map();
    for (const entity of list) {
        const declared = declaredRequires(entity);
        const derived = deriveRequires(entity.path, scope, { memo });

        let sorted = true;
        for (let i = 1; i < declared.length; i++) {
            const prev = declared[i - 1];
            const current = declared[i];
            if (prev !== undefined && current !== undefined && prev > current) {
                sorted = false;
                break;
            }
        }
        if (!sorted) violations.push(`${entity.path}: unsorted`);
        for (const token of declared) {
            if (!REQUIRES_TOKEN_RE.test(token)) violations.push(`${entity.path}: invalid ${token}`);
        }
        const seen = new Set<string>();
        for (const token of declared) {
            if (seen.has(token)) {
                violations.push(`${entity.path}: extra ${token}`); // duplicate occurrence
                continue;
            }
            seen.add(token);
            if (!REQUIRES_TOKEN_RE.test(token)) continue; // invalid reported above
            if (token === 'hooks' || token === 'subagents') {
                if (!HOOKS_OR_SUBAGENTS_ALLOW.has(entity.path)) violations.push(`${entity.path}: extra ${token}`);
            } else if (token !== 'local-fs' && !derived.has(token)) {
                violations.push(`${entity.path}: extra ${token}`); // stale: not derived
            }
        }
        for (const token of derived) {
            if (!declared.includes(token)) violations.push(`${entity.path}: missing ${token}`);
        }
    }
    return violations;
}

describe('runtime-requires (task 1291 / feature I14 R1, R2)', () => {
    test('88 sp entities are collected (41 skills, 43 commands, 4 agents)', () => {
        expect(entities.length).toBe(88);
        expect(byPath.size).toBe(88);
    });

    test('R2a/AC1: every entity declares a valid, sorted, deduped requires list containing local-fs', () => {
        const bad: string[] = [];
        for (const entity of entities) {
            const declared = declaredRequires(entity);
            if (declared.length === 0) {
                bad.push(`${entity.path}: missing requires`);
                continue;
            }
            for (const token of declared) {
                if (!REQUIRES_TOKEN_RE.test(token)) bad.push(`${entity.path}: invalid ${token}`);
            }
            const sorted = [...declared].sort();
            if (declared.join(',') !== sorted.join(',')) bad.push(`${entity.path}: unsorted`);
            if (new Set(declared).size !== declared.length) bad.push(`${entity.path}: duplicated`);
            if (!declared.includes('local-fs')) bad.push(`${entity.path}: missing local-fs`);
            for (const token of declared) {
                if ((token === 'hooks' || token === 'subagents') && !HOOKS_OR_SUBAGENTS_ALLOW.has(entity.path)) {
                    bad.push(`${entity.path}: declares ${token} without allow-list entry`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    test('R2b/R2c/AC2: declared equals the derived closure and the group snapshot matches 2026-11-04', () => {
        expect(checkRequires(entities)).toEqual([]);

        const groups: Record<string, number> = {};
        for (const entity of entities) {
            const key = [...deriveRequires(entity.path)].sort().join(',');
            groups[key] = (groups[key] ?? 0) + 1;
        }
        expect(groups).toEqual({
            'cli:spur,local-fs': 70,
            'cli:gh,local-fs': 2,
            'cli:gh,cli:spur,local-fs': 2,
            'local-fs': 14,
        });
    });

    test('AC3: undeclared use fails the pure check — direct spur use and inherited use through a dispatch', () => {
        // Fixture base: a real [local-fs]-only skill, copied into memory.
        const localOnly = entities.find((entity) => {
            const derived = deriveRequires(entity.path);
            return derived.size === 1 && derived.has('local-fs') && entity.path.startsWith('skills/');
        });
        expect(localOnly).toBeDefined();
        const fixtureBase = localOnly as Entity;
        const skillPath = 'skills/ac3-fixture-skill/SKILL.md';
        const skill: Entity = {
            path: skillPath,
            frontmatter: fixtureBase.frontmatter,
            body: `${fixtureBase.body}\nspur task list --json\n`,
        };
        const command: Entity = {
            path: 'commands/ac3-fixture-command.md',
            frontmatter: '---\ndescription: fixture\nrequires: [local-fs]\n---',
            body: 'Skill(skill="sp:ac3-fixture-skill")',
        };

        const violations = checkRequires([skill, command]);
        expect(violations.some((v) => v === `${skillPath}: missing cli:spur`)).toBe(true);
        expect(violations.some((v) => v === `${command.path}: missing cli:spur`)).toBe(true);

        // The unmutated copies pass.
        const clean: Entity = { ...skill, body: fixtureBase.body };
        const commandClean: Entity = {
            ...command,
            frontmatter: '---\ndescription: fixture\nrequires: [cli:spur, local-fs]\n---',
        };
        const violationsClean = checkRequires([clean, commandClean]);
        expect(violationsClean.includes(`${skillPath}: missing cli:spur`)).toBe(false);
        expect(violationsClean.includes(`${commandClean.path}: missing cli:spur`)).toBe(false);
    });
});
