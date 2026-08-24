/**
 * roles.test — Layer-1 role→tier table invariants (task 0535).
 *
 * `plugins/sp/references/roles.md` is the Layer-1 executor-selection contract: four roles, one per
 * tier, command→role closure over the live `plugins/sp/commands/` directory, stage-floor agreement
 * with the canonical stage registry, and the layer boundary (no executor/model/vendor names).
 *
 * Same real-tree discipline as `stage-registry-parity.test.ts`: the canonical registry is read as
 * TEXT rather than imported, because the plugin installs into foreign repos and cannot resolve
 * `@gobing-ai/spur-domain`. `yaml` resolves from the monorepo root for the shipped file check.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { REGISTERED_STAGES, STAGE_FLOOR_TIER } from '../scripts/stage-registry-adapter';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const ROLES_FILE = join(REPO_ROOT, 'plugins', 'sp', 'references', 'roles.md');
const COMMANDS_DIR = join(REPO_ROOT, 'plugins', 'sp', 'commands');
const DOMAIN_SCHEMA = join(REPO_ROOT, 'packages', 'domain', 'src', 'stage-registry', 'schema.ts');
const CONFIG_FILE = join(REPO_ROOT, '.spur', 'config.yaml');
const SKILL_FILES = ['spur-dev', 'spur-cli', 'code-verification'].map((name) =>
    join(REPO_ROOT, 'plugins', 'sp', 'skills', name, 'SKILL.md'),
);

/** Live tier vocabulary (packages/config/src/index.ts) — the only values a role may declare. */
const LIVE_TIERS = ['cheap', 'standard', 'capable-1', 'capable-2', 'capable-3'] as const;
const TIER_RANK: Record<string, number> = { cheap: 1, standard: 2, 'capable-1': 3, 'capable-2': 4, 'capable-3': 5 };

/** Known vendor strings (models/vendors the layer boundary forbids). */
const VENDOR_STRINGS = [
    'anthropic',
    'openai',
    'google',
    'deepseek',
    'minimax',
    'gemini',
    'claude',
    'gpt',
    'glm',
    'grok',
    'codex',
    'zai',
    'volc',
    'nvidia',
    'ollama',
    'opus',
    'luna',
    'k3',
    'sol',
    'agy',
    'omp',
];

const rolesSource = readFileSync(ROLES_FILE, 'utf8');

/** Extract the fenced YAML block from the markdown reference file. */
function yamlBlock(source: string): string {
    const m = source.match(/```yaml\n([\s\S]*?)\n```/);
    expect(m, 'roles.md must carry a fenced ```yaml block').toBeTruthy();
    return m?.[1] ?? '';
}

interface RoleRow {
    id: string;
    tier: string;
    commands: string[];
    stages: string[];
}

function parseRoles(): RoleRow[] {
    const doc = YAML.parse(yamlBlock(rolesSource)) as { version: number; roles: RoleRow[] };
    expect(doc.version, 'roles.md YAML must declare version: 1').toBe(1);
    return doc.roles;
}

/** Stage id → min_tier from REGISTERED_CANONICAL_STAGES, read as text from the domain schema. */
function stageMinTiers(): Map<string, string> {
    const source = readFileSync(DOMAIN_SCHEMA, 'utf8');
    const body = source.match(/REGISTERED_CANONICAL_STAGES[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1];
    expect(body, 'REGISTERED_CANONICAL_STAGES array body must exist in the domain schema').toBeTruthy();
    const map = new Map<string, string>();
    for (const m of (body ?? '').matchAll(/id: '([a-z0-9-]+)'[\s\S]*?min_tier: '([^']+)'/g)) {
        const stageId = m[1];
        const minTier = m[2];
        if (stageId !== undefined && minTier !== undefined) map.set(stageId, minTier);
    }
    return map;
}

/** Active executor names from `.spur/config.yaml` (uncommented `- name:` rows). */
function executorNames(): string[] {
    if (!existsSync(CONFIG_FILE)) return [];
    return readFileSync(CONFIG_FILE, 'utf8')
        .split('\n')
        .map((line) => line.match(/^\s*- name: (.+)$/)?.[1])
        .filter((name): name is string => name !== undefined)
        .map((name) => name.trim());
}

/**
 * Word-boundary match: `resolve` must not false-positive on vendor `sol`, and `omp` must not match
 * inside `prompt`. Hyphenated names (e.g. `codex-sol`) match as whole tokens.
 */
function containsWord(text: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(text);
}

describe('roles — R1: the Layer-1 table parses and has exactly the four roles', () => {
    const roles = parseRoles();

    test('version: 1 and exactly four rows', () => {
        expect(roles).toHaveLength(4);
    });

    test('rows are scribe, coder, reviewer, planner', () => {
        expect(roles.map((r) => r.id).sort()).toEqual(['coder', 'planner', 'reviewer', 'scribe']);
    });

    test('AGENT_ROLE_NAMES in packages/config matches the table (0537 R4 parity)', () => {
        const configSource = readFileSync(join(REPO_ROOT, 'packages', 'config', 'src', 'index.ts'), 'utf8');
        const m = configSource.match(/export const AGENT_ROLE_NAMES = \[([^\]]*)\]/);
        expect(m, 'AGENT_ROLE_NAMES literal must exist in packages/config/src/index.ts').toBeTruthy();
        const declared = (m?.[1] ?? '')
            .split(',')
            .map((s) => s.trim().replace(/^'|'$/g, ''))
            .filter((s) => s.length > 0)
            .sort();
        // The config-load collision guard (0537 R4) reads this literal; it must
        // not drift from the Layer-1 table.
        expect(declared).toEqual(roles.map((r) => r.id).sort());
    });

    test('every row declares id, tier, commands, stages', () => {
        for (const row of roles) {
            expect(typeof row.id, `role row missing id`).toBe('string');
            expect(typeof row.tier, `role ${row.id} missing tier`).toBe('string');
            expect(Array.isArray(row.commands), `role ${row.id} missing commands`).toBe(true);
            expect(Array.isArray(row.stages), `role ${row.id} missing stages`).toBe(true);
        }
    });
});

describe('roles — R2: four distinct tiers from the live vocabulary', () => {
    const roles = parseRoles();

    test('tiers are pairwise distinct', () => {
        const tiers = roles.map((r) => r.tier);
        expect(new Set(tiers).size).toBe(tiers.length);
    });

    test('each tier is drawn from the live vocabulary', () => {
        for (const row of roles) {
            expect(LIVE_TIERS, `role ${row.id} tier ${row.tier} not in vocabulary`).toContain(row.tier);
        }
    });
});

describe('roles — R3: command→role mapping is exhaustive and closed', () => {
    const roles = parseRoles();
    const dirCommands = readdirSync(COMMANDS_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -'.md'.length))
        .sort();
    const mapped = new Map<string, string>(); // command → role
    for (const row of roles) {
        for (const command of row.commands) {
            if (mapped.has(command)) {
                throw new Error(`command ${command} duplicated in roles ${mapped.get(command)} and ${row.id}`);
            }
            mapped.set(command, row.id);
        }
    }

    test('every command in the directory maps to exactly one role', () => {
        const unmapped = dirCommands.filter((c) => !mapped.has(c));
        const duplicated = dirCommands.filter((c) => [...mapped.keys()].filter((m) => m === c).length > 1);
        expect({ unmapped, duplicated }, 'unmapped or duplicated commands — see arrays').toEqual({
            unmapped: [],
            duplicated: [],
        });
    });

    test('every mapped command exists in the directory (no ghosts)', () => {
        const ghosts = [...mapped.keys()].filter((c) => !dirCommands.includes(c));
        expect(ghosts, 'mapped commands missing from the directory').toEqual([]);
    });
});

describe('roles — R4: role tiers agree with the stage registry', () => {
    const roles = parseRoles();
    const minTiers = stageMinTiers();

    test('every folded stage id exists in REGISTERED_CANONICAL_STAGES', () => {
        for (const row of roles) {
            for (const stage of row.stages) {
                expect(minTiers.has(stage), `role ${row.id} folds unknown stage ${stage}`).toBe(true);
            }
        }
    });

    test('no role tier is below the highest min_tier among its folded stages', () => {
        for (const row of roles) {
            const stageRanks = row.stages.map((s) => TIER_RANK[minTiers.get(s) ?? '']);
            const highest = Math.max(...stageRanks.filter((rank): rank is number => rank !== undefined));
            const conflicts = row.stages.filter((s) => {
                const roleRank = TIER_RANK[row.tier] ?? 0;
                const stageRank = TIER_RANK[minTiers.get(s) ?? ''] ?? 0;
                return roleRank < stageRank;
            });
            expect(conflicts, `role ${row.id} (tier ${row.tier}) below stage floor (highest fold ${highest})`).toEqual(
                [],
            );
        }
    });
});

describe('roles — R5: the layer boundary holds and the file is discoverable', () => {
    const rolesSource = readFileSync(ROLES_FILE, 'utf8');

    test('the file names no executor from agent.executors', () => {
        const names = executorNames();
        const hits = names.filter((name) => containsWord(rolesSource, name));
        expect({ hits }, 'roles.md must not name an executor').toEqual({ hits: [] });
    });

    test('the file names no known vendor string', () => {
        const hits = VENDOR_STRINGS.filter((vendor) => containsWord(rolesSource, vendor));
        expect({ hits }, 'roles.md must not name a model/vendor').toEqual({ hits: [] });
    });

    test('sp:spur-dev, sp:spur-cli, sp:code-verification reference the file', () => {
        for (const skillFile of SKILL_FILES) {
            const md = readFileSync(skillFile, 'utf8');
            expect(md, `${skillFile} must reference plugins/sp/references/roles.md`).toContain(
                'plugins/sp/references/roles.md',
            );
        }
    });
});

describe('roles — R6: every command declares role: from the table (0538 R1)', () => {
    const roles = parseRoles();
    const roleByCommand = new Map<string, string>();
    for (const row of roles) {
        for (const command of row.commands) roleByCommand.set(command, row.id);
    }

    test('every command file declares role: matching its roles.md row, naming the file', () => {
        const offenders: string[] = [];
        for (const file of readdirSync(COMMANDS_DIR)
            .filter((f) => f.endsWith('.md'))
            .sort()) {
            const name = file.slice(0, -'.md'.length);
            const source = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            const fm = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
            const declared = fm.match(/^role:\s*([a-z-]+)\s*$/m)?.[1] ?? '(none)';
            const expected = roleByCommand.get(name);
            if (expected === undefined) {
                offenders.push(`${file}: has role: '${declared}' but roles.md maps no role for it`);
            } else if (declared !== expected) {
                offenders.push(`${file}: declares role: '${declared}', roles.md says '${expected}'`);
            }
        }
        expect(offenders, 'command role: missing or mismatching roles.md — see array').toEqual([]);
    });
});

describe('roles — R7: no tier literal survives in plugin prose (0538 R4)', () => {
    test('capable-N tier values appear only in roles.md and the tests', () => {
        const offenders: string[] = [];
        const scan = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    scan(full);
                } else if (entry.name.endsWith('.md') && full !== ROLES_FILE) {
                    const text = readFileSync(full, 'utf8');
                    if (/capable-[123]\b/.test(text)) offenders.push(full);
                }
            }
        };
        scan(join(REPO_ROOT, 'plugins', 'sp'));
        expect(offenders, 'tier literal outside roles.md — re-express via a role pointer to roles.md').toEqual([]);
    });
});

describe('roles — R8: stage-registry-adapter floors read from Layer 1 (0538 R4)', () => {
    test('every folded stage min_tier equals the roles.md stage→role→tier mapping', () => {
        const mismatches = REGISTERED_STAGES.filter((s) => STAGE_FLOOR_TIER.has(s.id))
            .filter((s) => s.model_policy.min_tier !== STAGE_FLOOR_TIER.get(s.id))
            .map(
                (s) => `${s.id}: adapter floor '${s.model_policy.min_tier}', roles.md '${STAGE_FLOOR_TIER.get(s.id)}'`,
            );
        expect(mismatches, 'adapter floor drifted from roles.md — fix the adapter, not this test').toEqual([]);
    });

    test('unfolded adapter stages keep a standard floor (no accidental capable gate)', () => {
        const unfolded = REGISTERED_STAGES.filter((s) => !STAGE_FLOOR_TIER.has(s.id)).filter(
            (s) => s.id !== 'changelog' && s.model_policy.min_tier !== 'standard',
        );
        expect(unfolded.map((s) => s.id)).toEqual([]);
    });
});

describe('roles — R9: roles.md projects config.global.yaml with fallback parity (0647)', () => {
    // The plugin tree cannot resolve @gobing-ai/spur-config (it installs into
    // foreign repos — same discipline as stage-registry-parity.test.ts), so the
    // SSOT constant is read as text and its Map literal parsed, exactly like the
    // AGENT_ROLE_NAMES parity test in R1 above.
    const configSource = readFileSync(join(REPO_ROOT, 'packages', 'config', 'src', 'index.ts'), 'utf8');

    function defaultRoles(): Map<string, { tier: string; stages: string[] }> {
        const table = new Map<string, { tier: string; stages: string[] }>();
        const re = /\[\s*'(\w+)'\s*,\s*\{\s*tier:\s*'([\w-]+)'\s*,\s*stages:\s*\[([^\]]*)\]\s*\}\s*\]/g;
        for (const m of configSource.matchAll(re)) {
            const id = m[1];
            const tier = m[2];
            const stages = (m[3] ?? '')
                .split(',')
                .map((s) => s.trim().replace(/^'|'$/g, ''))
                .filter((s) => s.length > 0);
            expect(id && tier, 'DEFAULT_AGENT_ROLES literal must carry id and tier').toBeTruthy();
            table.set(id as string, { tier: tier as string, stages });
        }
        expect(table.size, 'DEFAULT_AGENT_ROLES literal must parse to exactly four rows').toBe(4);
        return table;
    }

    test('every role id/tier/stages in roles.md equals DEFAULT_AGENT_ROLES', () => {
        const defaults = defaultRoles();
        const roles = parseRoles();
        expect(roles, 'roles.md must carry exactly the four default roles').toHaveLength(defaults.size);
        for (const row of roles) {
            const def = defaults.get(row.id);
            expect(def, `role ${row.id} missing from DEFAULT_AGENT_ROLES`).toBeDefined();
            expect(row.tier, `role ${row.id} tier drifted from DEFAULT_AGENT_ROLES`).toBe(def?.tier);
            expect(row.stages, `role ${row.id} stages drifted from DEFAULT_AGENT_ROLES`).toEqual(def?.stages);
        }
    });

    // ADR-078 (task 0647) inverted the SSOT: `config/config.global.yaml` is now
    // authoritative and `DEFAULT_AGENT_ROLES` is the no-filesystem fallback. The
    // gate becomes three-way — pointed only at the demoted constant it would stop
    // guarding the real source. Byte-identity between the shipped table and the
    // fallback is the requirement: a fallback that differed would turn a missing
    // config file into a silent behavior change (the failure ADR-061 prevented).
    test('a config.global.yaml tier drifting from the fallback fails (gate is real)', () => {
        // Negative twin of the test above — the roles.md leg already has one, and a
        // parity assertion nobody has watched fail is not yet a gate. Same parse, run
        // over a mutated copy: flipping one shipped tier must surface as a mismatch.
        const globalConfigPath = join(REPO_ROOT, 'config', 'config.global.yaml');
        const mutated = readFileSync(globalConfigPath, 'utf8').replace('tier: cheap', 'tier: standard');
        const table = (YAML.parse(mutated) as { agent: { roles: Record<string, { tier: string; stages: string[] }> } })
            .agent.roles;
        const defaults = defaultRoles();
        const drifted = Object.entries(table).filter(([id, row]) => row.tier !== defaults.get(id)?.tier);
        expect(
            drifted.map(([id]) => id),
            'mutating one shipped tier must be detectable',
        ).toEqual(['scribe']);
    });

    test('the shipped config.global.yaml role table equals DEFAULT_AGENT_ROLES (ADR-078)', () => {
        const globalConfigPath = join(REPO_ROOT, 'config', 'config.global.yaml');
        const shipped = YAML.parse(readFileSync(globalConfigPath, 'utf8')) as {
            agent?: { roles?: Record<string, { tier: string; stages: string[] }> };
        };
        const table = shipped.agent?.roles;
        expect(table, 'config.global.yaml must ship an agent.roles table (ADR-078 SSOT)').toBeDefined();

        const defaults = defaultRoles();
        expect(Object.keys(table ?? {}).sort(), 'shipped role ids must match the fallback constant').toEqual(
            [...defaults.keys()].sort(),
        );
        for (const [id, row] of Object.entries(table ?? {})) {
            const def = defaults.get(id);
            expect(row.tier, `role ${id} tier drifted between config.global.yaml and the fallback`).toBe(def?.tier);
            expect(row.stages, `role ${id} stages drifted between config.global.yaml and the fallback`).toEqual(
                def?.stages,
            );
        }
    });

    test('a hand-edit to roles.md tiers without a constant change fails (gate is real)', () => {
        // Same parser, run over a mutated copy of roles.md: flipping one tier
        // must produce a mismatch — proves the assertion above has teeth.
        const mutated = yamlBlock(rolesSource).replace('tier: cheap', 'tier: standard');
        const rows = (YAML.parse(mutated) as { roles: RoleRow[] }).roles;
        const defaults = defaultRoles();
        const drifted = rows.some((r) => r.tier !== defaults.get(r.id)?.tier);
        expect(drifted, 'mutated fixture must drift — parity assertion is vacuous otherwise').toBe(true);
    });

    test('roles.md carries the projection banner naming the shipped SSOT and fallback', () => {
        expect(rolesSource).toContain('config/config.global.yaml');
        expect(rolesSource).toContain('ADR-078');
        expect(rolesSource).toContain('DEFAULT_AGENT_ROLES');
        expect(rolesSource).toContain('packages/config/src/index.ts');
        expect(rolesSource).toContain('generated view');
    });
});
