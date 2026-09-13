import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type SpurConfig, spurConfigSchema } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter, ProjectClaimDao } from '@gobing-ai/spur-domain';
import { type AgentSpec, loadAgentSpecs, saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import {
    type AgentRoleDefinition,
    FleetService,
    type FleetServiceContext,
    normalizeProjectPath,
    ProjectRegistry,
    TeamService,
    type TeamServiceContext,
} from '../../src/index';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ROLES = new Map<string, AgentRoleDefinition>([
    ['coder', { tier: 'standard', stages: ['implement'] }],
    ['reviewer', { tier: 'capable-1', stages: ['verify'] }],
]);

/** Executors covering every fsWrite attestation state the R4 matrix needs. */
const EXECUTORS_YAML = `agent:
  executors:
    - name: writer
      agent: claude
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: available
            provenance: native-known
    - name: enforced-writer
      agent: claude
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: enforced
            provenance: native-known
    - name: readonly
      agent: claude
      tier: capable-1
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: unavailable
            provenance: native-known
    - name: noaxis
      agent: codex
`;

function parseConfig(yaml: string): SpurConfig {
    return spurConfigSchema.parse(yamlParse(yaml));
}

/** A temp project dir with an isolated registry so the machine registry is never touched. */
async function makeProject(): Promise<{ project: string; slug: string; cleanup: () => Promise<void> }> {
    // mkdtemp's random suffix is mixed-case; agent ids are lowercase-only, so
    // the project itself is a fixed lowercase dir inside the temp parent.
    const base = await mkdtemp(join(tmpdir(), 'spur-fleet-'));
    const project = join(base, 'proj');
    await mkdir(join(project, '.spur'), { recursive: true });
    return {
        project,
        slug: basename(project),
        cleanup: async () => {
            await rm(base, { recursive: true, force: true });
        },
    };
}

function makeService(spurConfig: SpurConfig | null, project: string): FleetService {
    const ctx: FleetServiceContext = {
        spurConfig,
        roles: ROLES,
        fs: createNodeFileSystem(project),
        registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
    };
    return new FleetService(ctx);
}

/** Write `.spur/fleet.json` under the project. */
async function writeFleet(project: string, body: unknown): Promise<void> {
    await writeFile(join(project, '.spur', 'fleet.json'), JSON.stringify(body, null, 2));
}

async function seedSpec(configDir: string, id: string, tags: string[], type = 'claude'): Promise<void> {
    const spec: AgentSpec = { id, name: id, type, workspace: '/tmp', purpose: 'seeded', tags, config: {} };
    await saveAgentSpec(spec, configDir);
}

// ---------------------------------------------------------------------------
// load / resolve (R1, R3, R4, R7)
// ---------------------------------------------------------------------------

describe('FleetService load (0835 R1/R7)', () => {
    test('returns null when no declaration exists (R7)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            expect(await svc.load(project)).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('parses a valid declaration and rejects an invalid one naming the file', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(null, project);
            await writeFleet(project, { version: 1, members: [{ executor: 'writer' }] });
            const decl = await svc.load(project);
            expect(decl?.version).toBe(1);
            expect(decl?.members).toHaveLength(1);

            await writeFleet(project, { version: 2, members: [] });
            await expect(svc.load(project)).rejects.toThrow(/Invalid fleet declaration/);
            await writeFile(join(project, '.spur', 'fleet.json'), '{ not json at all');
            await expect(svc.load(project)).rejects.toThrow(/not valid JSON/);
        } finally {
            await cleanup();
        }
    });

    test('rejects a member declaring neither role nor executor', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(null, project);
            await writeFleet(project, { version: 1, members: [{ purpose: 'ghost' }] });
            await expect(svc.load(project)).rejects.toThrow(/must declare a role or an executor/);
        } finally {
            await cleanup();
        }
    });
});

describe('FleetService resolve (0835 R1/R3/R4/R7)', () => {
    test('R1: every member resolves with a stable instance id, role, executor, and capability state', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            await writeFleet(project, {
                version: 1,
                members: [
                    { id: 'lead', role: 'coder', executor: 'writer', purpose: 'orchestrator' },
                    { role: 'reviewer', executor: 'readonly' },
                ],
            });
            const fleet = await svc.resolve(project);
            expect(fleet.missing).toEqual([]);
            expect(fleet.members).toEqual([
                {
                    instanceId: `${slug}-lead`,
                    role: 'coder',
                    executor: 'writer',
                    enabled: true,
                    writeCapable: true,
                    capabilityState: 'available',
                },
                {
                    instanceId: `${slug}-readonly`,
                    role: 'reviewer',
                    executor: 'readonly',
                    enabled: true,
                    writeCapable: false,
                    capabilityState: 'unavailable',
                },
            ]);
        } finally {
            await cleanup();
        }
    });

    test('R3: an explicitly id-ed member keeps its instance id across executor replacement AND roster reorder', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            await writeFleet(project, {
                version: 1,
                members: [
                    { id: 'lead', role: 'coder', executor: 'writer' },
                    { role: 'reviewer', executor: 'readonly' },
                ],
            });
            const before = await svc.resolve(project);
            expect(before.members[0]?.instanceId).toBe(`${slug}-lead`);

            // Executor replaced + roster reordered.
            await writeFleet(project, {
                version: 1,
                members: [
                    { role: 'reviewer', executor: 'readonly' },
                    { id: 'lead', role: 'coder', executor: 'enforced-writer' },
                ],
            });
            const after = await svc.resolve(project);
            expect(after.members[1]?.instanceId).toBe(`${slug}-lead`);
            expect(after.members[1]?.executor).toBe('enforced-writer');
        } finally {
            await cleanup();
        }
    });

    test('R3: derived ids come from the shared memberLocalId allocator (byte-identical with team derivation)', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            // Two role-only coders: the allocator derives coder-1 / coder-2 over
            // the role-only peers, exactly as the config-load derivation would.
            await writeFleet(project, {
                version: 1,
                members: [{ role: 'coder' }, { role: 'coder' }, { role: 'reviewer' }],
            });
            const fleet = await svc.resolve(project);
            expect(fleet.members.map((m) => m.instanceId)).toEqual([
                `${slug}-coder-1`,
                `${slug}-coder-2`,
                `${slug}-reviewer-1`,
            ]);
        } finally {
            await cleanup();
        }
    });

    test('R4: write capability follows the fsWrite attestation, never the role name', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            await writeFleet(project, {
                version: 1,
                members: [
                    // reviewer role but WRITE-capable: role is not evidence.
                    { role: 'reviewer', executor: 'writer' },
                    // coder role but NOT write-capable: role grants nothing.
                    { role: 'coder', executor: 'noaxis' },
                    { role: 'coder', executor: 'enforced-writer' },
                ],
            });
            const fleet = await svc.resolve(project);
            expect(fleet.members[0]).toMatchObject({
                role: 'reviewer',
                writeCapable: true,
                capabilityState: 'available',
            });
            // Absent axis resolves to unknown — missing data never grants (R4).
            expect(fleet.members[1]).toMatchObject({ role: 'coder', writeCapable: false, capabilityState: 'unknown' });
            expect(fleet.members[2]).toMatchObject({ writeCapable: true, capabilityState: 'enforced' });
        } finally {
            await cleanup();
        }
    });

    test('R7: no declaration resolves cleanly to an empty fleet that says so', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const fleet = await svc.resolve(project);
            expect(fleet.members).toEqual([]);
            expect(fleet.missing).toEqual(['no-declaration']);
        } finally {
            await cleanup();
        }
    });

    test('R7: a fully disabled roster resolves with missing naming the fix, ids still derived', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            await writeFleet(project, {
                version: 1,
                members: [
                    { role: 'coder', enabled: false },
                    { executor: 'readonly', enabled: false },
                ],
            });
            const fleet = await svc.resolve(project);
            expect(fleet.missing).toEqual(['no-enabled-members']);
            // Disabled members keep their id (index preservation) but resolve no executor.
            expect(fleet.members[0]).toMatchObject({
                instanceId: `${slug}-coder-1`,
                enabled: false,
                executor: '',
                capabilityState: 'unknown',
            });
            expect(fleet.members[1]).toMatchObject({ instanceId: `${slug}-readonly`, enabled: false });
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// materialize (R2, R3, R6)
// ---------------------------------------------------------------------------

describe('FleetService materialize (0835 R2/R3/R6)', () => {
    test('writes one generated spec per enabled member; disabled members are not materialized', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, {
                version: 1,
                members: [
                    { id: 'lead', role: 'coder', executor: 'writer' },
                    { role: 'reviewer', executor: 'readonly', enabled: false },
                ],
            });
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const result = await svc.materialize(project);
            expect(result.written).toBe(true);
            expect(result.upserted).toEqual([`${slug}-lead`]);
            const specs = await loadAgentSpecs(join(project, '.spur', 'agents'));
            const byId = new Map(specs.map((s) => [s.id, s]));
            expect(byId.has(`${slug}-lead`)).toBe(true);
            expect(byId.has(`${slug}-reviewer-1`)).toBe(false);
            const lead = byId.get(`${slug}-lead`);
            expect(lead?.tags).toContain('spur:generated');
            expect(lead?.executor).toBe('writer');
            expect(lead?.type).toBe('claude');
            expect(lead?.workspace).toBe(normalizeProjectPath(project));
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });

    test('R6: cwd/storage-root mismatch is a loud error naming both paths', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await writeFleet(project, { version: 1, members: [{ executor: 'writer' }] });
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            // Test process stays in the repo — NOT the project.
            await expect(svc.materialize(project)).rejects.toThrow(/Ground-truth mismatch/);
            await expect(svc.materialize(project)).rejects.toThrow(
                new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
            );
        } finally {
            await cleanup();
        }
    });

    test('R2: hand-authored specs with a desired id are never touched', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, { version: 1, members: [{ executor: 'writer', purpose: 'authored' }] });
            const configDir = join(project, '.spur', 'agents');
            await mkdir(configDir, { recursive: true });
            await seedSpec(configDir, `${slug}-writer`, [], 'handwritten-kind');
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const result = await svc.materialize(project);
            // The id is desired, but the hand-authored spec is skipped, not overwritten.
            expect(result.upserted).toEqual([]);
            const specs = await loadAgentSpecs(configDir);
            expect(specs).toHaveLength(1);
            expect(specs[0]?.type).toBe('handwritten-kind');
            expect(specs[0]?.tags ?? []).not.toContain('spur:generated');
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });

    test('disabling a previously materialized member prunes its generated spec (desired-state projection)', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, { version: 1, members: [{ executor: 'writer' }, { executor: 'readonly' }] });
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const first = await svc.materialize(project);
            expect(first.upserted.sort()).toEqual([`${slug}-readonly`, `${slug}-writer`].sort());

            await writeFleet(project, {
                version: 1,
                members: [{ executor: 'writer' }, { executor: 'readonly', enabled: false }],
            });
            const second = await svc.materialize(project);
            expect(second.upserted).toEqual([`${slug}-writer`]);
            expect(second.orphaned).toEqual([`${slug}-readonly`]);
            const specs = await loadAgentSpecs(join(project, '.spur', 'agents'));
            expect(specs.map((s) => s.id)).toEqual([`${slug}-writer`]);
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });

    test('check=true returns the diff and writes nothing; missing declaration fails loudly', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, { version: 1, members: [{ executor: 'writer' }] });
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const result = await svc.materialize(project, { check: true });
            expect(result.written).toBe(false);
            expect(result.upserted).toEqual([`${slug}-writer`]);
            expect(await loadAgentSpecs(join(project, '.spur', 'agents'))).toEqual([]);

            await rm(join(project, '.spur', 'fleet.json'));
            await expect(svc.materialize(project)).rejects.toThrow(/No fleet declaration/);
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });

    test('a fleet spec pruned by materialization never takes a hand-authored spec with it (R2 teardown contract)', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, { version: 1, members: [{ executor: 'writer' }] });
            const configDir = join(project, '.spur', 'agents');
            await mkdir(configDir, { recursive: true });
            // A hand-authored spec id that will NOT be desired (different member).
            await seedSpec(configDir, `${slug}-reviewer-1`, [`team:${slug}`], 'claude');
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const result = await svc.materialize(project);
            expect(result.orphaned).toEqual([]);
            const specs = await loadAgentSpecs(configDir);
            expect(specs.map((s) => s.id).sort()).toEqual([`${slug}-reviewer-1`, `${slug}-writer`].sort());
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });

    test('a disabled member with an unresolvable executor does not block materialization (review P3)', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, {
                version: 1,
                members: [
                    { id: 'lead', executor: 'writer' },
                    // Pins an executor that does not exist — but the member is
                    // disabled, so no executor resolution may happen for it.
                    { id: 'ghost', executor: 'nonexistent', enabled: false },
                ],
            });
            const configDir = join(project, '.spur', 'agents');
            await mkdir(configDir, { recursive: true });
            // Stale generated spec from when ghost was enabled — desired-state
            // projection must retire it without ever resolving its executor.
            await seedSpec(configDir, `${slug}-ghost`, [`fleet:${slug}`, 'spur:generated', 'fleet:generated']);
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const result = await svc.materialize(project);
            expect(result.upserted).toEqual([`${slug}-lead`]);
            expect(result.orphaned).toEqual([`${slug}-ghost`]);
            const specs = await loadAgentSpecs(configDir);
            expect(specs.map((s) => s.id)).toEqual([`${slug}-lead`]);
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });

    test('fleet and team materialization are namespace-disjoint when a registry name equals a config team id (review P2)', async () => {
        const { project, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        let db: DbAdapter | undefined;
        try {
            // Registry display name == a config team id: the collision case.
            const slug = 'shared';
            await new ProjectRegistry(join(project, '.spur', 'registry.json')).upsert({
                name: slug,
                path: project,
            });
            await writeFleet(project, { version: 1, members: [{ id: 'lead', executor: 'writer' }] });

            const teamYaml = `${EXECUTORS_YAML}  team:\n    shared:\n      name: shared\n      work_dir: ${project}\n      members:\n        - id: dev\n          executor: writer\n`;
            const spurConfig = parseConfig(teamYaml);
            db = await createMigratedDb({ url: ':memory:' });
            const teamCtx: TeamServiceContext = {
                cwd: project,
                env: {},
                getDb: async () => db as DbAdapter,
                fs: createNodeFileSystem(project),
                roles: ROLES,
                spurConfig,
            };
            const teamSvc = new TeamService(teamCtx);
            process.chdir(project);
            const fleetSvc = makeService(spurConfig, project);

            // Both materializations run over the SAME spec dir.
            const team1 = await teamSvc.materializeTeam(slug);
            expect(team1.upserted).toEqual([`${slug}-dev`]);
            const fleet1 = await fleetSvc.materialize(project);
            expect(fleet1.upserted).toEqual([`${slug}-lead`]);

            // Re-running either side must not delete the other's specs.
            const team2 = await teamSvc.materializeTeam(slug);
            expect(team2.orphaned).toEqual([]);
            const fleet2 = await fleetSvc.materialize(project);
            expect(fleet2.orphaned).toEqual([]);
            const specs = await loadAgentSpecs(join(project, '.spur', 'agents'));
            expect(specs.map((s) => s.id).sort()).toEqual([`${slug}-dev`, `${slug}-lead`].sort());
        } finally {
            process.chdir(prevCwd);
            db?.close();
            await cleanup();
        }
    });
});

describe('FleetService load error surfaces (0835 review)', () => {
    test('a non-ENOENT read failure (EACCES) is not masqueraded as no-declaration (review P3)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const eaccs: NodeJS.ErrnoException = new Error(
                `EACCES: permission denied, open '${join(project, '.spur', 'fleet.json')}'`,
            );
            eaccs.code = 'EACCES';
            const fs = {
                ...createNodeFileSystem(project),
                readFile: async () => {
                    throw eaccs;
                },
            } as unknown as FileSystem;
            const svc = new FleetService({
                spurConfig: null,
                roles: ROLES,
                fs,
                registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
            });
            await expect(svc.load(project)).rejects.toThrow(/EACCES/);
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// resolveOrchestrator (0836)
// ---------------------------------------------------------------------------

describe('FleetService resolveOrchestrator (0836)', () => {
    /** FleetService whose claim reads hit a dedicated in-memory migrated db (caller-owned handle). */
    async function makeOrchestratorService(project: string): Promise<{ svc: FleetService; db: DbAdapter }> {
        const db = await createMigratedDb({ url: ':memory:' });
        const svc = new FleetService({
            // Claim-state resolution reads role/purpose from the declaration only —
            // no executor config is consulted (the pointer is asserted, not resolved
            // through the tier ladder).
            spurConfig: null,
            roles: ROLES,
            fs: createNodeFileSystem(project),
            registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
            openDb: async () => db,
        });
        return { svc, db };
    }

    /** Declaration with one planner member carrying purpose 'orchestrator' (id planner-1), plus extras. */
    async function writeOrchestratorFleet(project: string, members: unknown[], orchestrator: unknown): Promise<void> {
        await writeFleet(project, { version: 1, members, orchestrator });
    }

    const PLANNER = { id: 'planner-1', role: 'planner', purpose: 'orchestrator' };

    test('no declaration resolves missing, naming what to do (R5)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('missing');
            expect(binding.reason).toBe('no-orchestrator-declared');
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('a declaration without a pointer is missing — an empty fleet resolves cleanly (R5)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeFleet(project, { version: 1, members: [] });

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('missing');
            expect(binding.reason).toBe('no-orchestrator-declared');
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('an unknown pointer is unresolvable — error, never inference', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(project, [PLANNER], 'planner-typo');

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('unresolvable');
            expect(binding.reason).toContain('unknown-member:planner-typo');
            expect(binding.reason).toContain('planner-1'); // names the ids that DO exist
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('a disabled member pointer is unresolvable', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(project, [{ ...PLANNER, enabled: false }], 'planner-1');

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('unresolvable');
            expect(binding.reason).toBe('member-disabled:planner-1');
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('a non-planner role pointer is unresolvable (no role-vocabulary change, R2)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(
                project,
                [{ id: 'coder-1', role: 'coder', purpose: 'orchestrator' }],
                'coder-1',
            );

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('unresolvable');
            expect(binding.reason).toContain('wrong-role:coder-1');
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('a planner without purpose orchestrator is unresolvable (binding carrier, R2)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(project, [{ id: 'planner-1', role: 'planner' }], 'planner-1');

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('unresolvable');
            expect(binding.reason).toContain('missing-purpose:planner-1');
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('a valid pointer with no live claim is bound-offline — distinct from missing (R4)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(project, [PLANNER], 'planner-1');

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('bound-offline');
            expect(binding.reason).toBe('no-live-claim');
            expect(binding.instanceId).toBe('proj-planner-1');
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('an EXPIRED claim still reads bound-offline, not online (R4)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(project, [PLANNER], 'planner-1');
            const dao = new ProjectClaimDao(db);
            await dao.claim(normalizeProjectPath(project), 'orchestrator', 'proj-planner-1', 0);

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('bound-offline');
            expect(binding.reason).toBe('no-live-claim');
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('a live claim reads bound-online with the claim (R1: exactly one orchestrator)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(project, [PLANNER], 'planner-1');
            const dao = new ProjectClaimDao(db);
            const claimed = await dao.claim(normalizeProjectPath(project), 'orchestrator', 'proj-planner-1', 30_000);
            expect(claimed).not.toBeNull();

            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('bound-online');
            expect(binding.instanceId).toBe('proj-planner-1');
            expect(binding.holderId).toBe('proj-planner-1');
            expect(binding.claim?.ownerEpoch).toBe(1);
            expect(binding.claim?.expiresAt).toBeGreaterThan(Date.now());
            db.close();
        } finally {
            await cleanup();
        }
    });

    test('a live claim for a replaced binding does not make the configured orchestrator online', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const { svc, db } = await makeOrchestratorService(project);
            await writeOrchestratorFleet(project, [PLANNER], 'planner-1');
            await new ProjectClaimDao(db).claim(normalizeProjectPath(project), 'orchestrator', 'proj-old', 30_000);
            const binding = await svc.resolveOrchestrator(project);
            expect(binding.state).toBe('bound-offline');
            expect(binding.instanceId).toBe('proj-planner-1');
            expect(binding.reason).toContain('claim-holder-mismatch');
            db.close();
        } finally {
            await cleanup();
        }
    });
});

describe('fleet registration and launch ground truth (G62)', () => {
    test('registration rejects a foreign filesystem root despite matching process cwd', async () => {
        const local = await makeProject();
        const foreign = await makeProject();
        const previous = process.cwd();
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            process.chdir(local.project);
            const team = new TeamService({
                cwd: local.project,
                fs: createNodeFileSystem(foreign.project),
                env: { SPUR_SPEC_ID: 'proj-lead' },
                getDb: async () => db,
            });
            await expect(
                team.createAgentSpec({ id: 'proj-lead', type: 'pi', tags: ['fleet:generated'] }),
            ).rejects.toThrow('Ground-truth mismatch');
        } finally {
            process.chdir(previous);
            await db.close();
            await local.cleanup();
            await foreign.cleanup();
        }
    });

    test('the backing database must belong to the actual project storage root', async () => {
        const local = await makeProject();
        const foreign = await makeProject();
        const previous = process.cwd();
        const db = await createMigratedDb({ url: join(foreign.project, '.spur', 'spur.db') });
        try {
            process.chdir(local.project);
            const service = new FleetService({ fs: createNodeFileSystem(local.project), openDb: async () => db });
            await expect(service.assertLaunchGroundTruth(local.project)).rejects.toThrow('database root');
        } finally {
            process.chdir(previous);
            await db.close();
            await local.cleanup();
            await foreign.cleanup();
        }
    });

    test('a symlink to the project is accepted, but a storage symlink to another project is rejected', async () => {
        const local = await makeProject();
        const foreign = await makeProject();
        const previous = process.cwd();
        const alias = `${local.project}-alias`;
        try {
            await symlink(local.project, alias);
            process.chdir(alias);
            await expect(
                new FleetService({ fs: createNodeFileSystem(alias) }).assertLaunchGroundTruth(alias),
            ).resolves.toBeUndefined();
            await rm(join(local.project, '.spur'), { recursive: true });
            await symlink(join(foreign.project, '.spur'), join(local.project, '.spur'));
            await expect(
                new FleetService({ fs: createNodeFileSystem(alias) }).assertLaunchGroundTruth(alias),
            ).rejects.toThrow('Ground-truth mismatch');
        } finally {
            process.chdir(previous);
            await local.cleanup();
            await foreign.cleanup();
        }
    });
});
