import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type SpurConfig, spurConfigSchema } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter, ProjectClaimDao, recordMemberSession } from '@gobing-ai/spur-domain';
import { type AgentSpec, loadAgentSpecs, saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import {
    AgentCoordinationService,
    type AgentRoleDefinition,
    FleetService,
    type FleetServiceContext,
    normalizeProjectPath,
    ProjectRegistry,
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

/**
 * Per-project `agent.fleet` fixture sections. Since 0858 the fleet rides the
 * project's merged config, so a fixture writes the SECTION and the service reads
 * it through `reloadAgentConfig` — the same launch-boundary seam production uses.
 * The retired `.spur/fleet.json` file is no longer a carrier, and a section
 * written before or after service construction is visible either way.
 */
const fleetSections = new Map<string, Record<string, unknown>>();

/** The project's effective config: the base config plus its fixture fleet section. */
function configFor(spurConfig: SpurConfig | null, project: string): SpurConfig | null {
    const section = fleetSections.get(project);
    if (section === undefined) return spurConfig;
    return spurConfigSchema.parse({
        ...(spurConfig ?? {}),
        agent: { ...(spurConfig?.agent ?? {}), fleet: section },
    });
}

function makeService(spurConfig: SpurConfig | null, project: string): FleetService {
    const ctx: FleetServiceContext = {
        spurConfig: configFor(spurConfig, project),
        reloadAgentConfig: async () => configFor(spurConfig, project),
        roles: ROLES,
        fs: createNodeFileSystem(project),
        registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
    };
    return new FleetService(ctx);
}

/**
 * Declare the project's `agent.fleet` section (0858 carrier). Fixtures describe a
 * RUNNING fleet (`enabled: true`) unless the body sets `enabled` itself: before
 * 0858 a declaration always ran, and the disabled/default-false state has its own
 * tests below.
 */
async function writeFleet(project: string, body: Record<string, unknown>): Promise<void> {
    fleetSections.set(project, { enabled: true, ...body });
}

async function seedSpec(configDir: string, id: string, tags: string[], type = 'claude'): Promise<void> {
    const spec: AgentSpec = { id, name: id, type, workspace: '/tmp', purpose: 'seeded', tags, config: {} };
    await saveAgentSpec(spec, configDir);
}

// ---------------------------------------------------------------------------
// load / resolve (R1, R3, R4, R7)
// ---------------------------------------------------------------------------

describe('FleetService load (0835 R1/R7, 0858 R3)', () => {
    test('returns null when no declaration exists (R7)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            expect(await svc.load(project)).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('0858 R3: reads the section from the project config, with its schema defaults', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(null, project);
            // Written as a raw section: the schema's defaults are what fill in the rest.
            fleetSections.set(project, { members: [{ executor: 'writer' }] });
            const decl = await svc.load(project);
            // Defaults come from the schema, not from the service: declaring a roster
            // must not start processes by accident (0858 R1).
            expect(decl?.enabled).toBe(false);
            expect(decl?.strategy).toBe('rest');
            expect(decl?.members).toHaveLength(1);

            // A later config read is observed through the launch-boundary seam.
            await writeFleet(project, { members: [{ executor: 'readonly' }], orchestrator: 'readonly' });
            const updated = await svc.load(project);
            expect(updated?.orchestrator).toBe('readonly');
            expect(updated?.enabled).toBe(true);
        } finally {
            await cleanup();
        }
    });

    test('0858 R8: an invalid section fails the config read, naming the issue', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(null, project);
            // The section is raw here: the config read is what validates it, so the
            // service can never silently serve a half-valid fleet.
            fleetSections.set(project, { members: [{ purpose: 'ghost' }] });
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
                members: [
                    { id: 'lead', role: 'coder', executor: 'writer' },
                    { role: 'reviewer', executor: 'readonly' },
                ],
            });
            const before = await svc.resolve(project);
            expect(before.members[0]?.instanceId).toBe(`${slug}-lead`);

            // Executor replaced + roster reordered.
            await writeFleet(project, {
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
            expect(fleet.enabled).toBe(false);
            expect(fleet.missing).toEqual(['no-declaration']);
        } finally {
            await cleanup();
        }
    });

    // 0858 R3/R5: the off switch is a NAMED state, not an empty roster. The declared
    // roster still resolves so the Board can explain why nothing runs.
    test('0858 R3: a disabled fleet still resolves its roster and names fleet-disabled', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            await writeFleet(project, { enabled: false, members: [{ role: 'coder', executor: 'writer' }] });
            const fleet = await svc.resolve(project);
            expect(fleet.enabled).toBe(false);
            expect(fleet.missing).toEqual(['fleet-disabled']);
            // Members are still resolved — a disabled fleet is not an empty one.
            expect(fleet.members).toEqual([
                {
                    instanceId: `${slug}-writer`,
                    role: 'coder',
                    executor: 'writer',
                    enabled: true,
                    writeCapable: true,
                    capabilityState: 'available',
                },
            ]);
        } finally {
            await cleanup();
        }
    });

    test('0858 R3: an enabled fleet resolves without a missing entry', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            await writeFleet(project, { enabled: true, members: [{ executor: 'writer' }] });
            const fleet = await svc.resolve(project);
            expect(fleet.enabled).toBe(true);
            expect(fleet.missing).toEqual([]);
        } finally {
            await cleanup();
        }
    });

    // 0857 R5: the resolved model the pane renders. Own fixture (pinned profiles and a
    // role ladder whose only capable-1 rung is `rollout`) so the shared EXECUTORS_YAML
    // ladder winners other tests assert are untouched.
    test('R5: carries the resolved executor profile model, omits it when the profile declares none', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const svc = makeService(
                parseConfig(`agent:
  executors:
    - name: writer
      agent: claude
      tier: cheap
      model: claude-sonnet-4
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: available
            provenance: native-known
    - name: modelless
      agent: codex
      tier: cheap
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: available
            provenance: native-known
    - name: rollout
      agent: claude
      tier: capable-1
      model: claude-opus-4
`),
                project,
            );
            await writeFleet(project, {
                members: [
                    { executor: 'writer' },
                    { executor: 'modelless' },
                    { role: 'reviewer' },
                    { executor: 'writer', enabled: false },
                ],
            });
            const fleet = await svc.resolve(project);
            // Pinned executor profile's model rides the member.
            expect(fleet.members[0]).toMatchObject({
                instanceId: `${slug}-writer`,
                executor: 'writer',
                model: 'claude-sonnet-4',
            });
            // Omitted, never '' — a profile declaring no model has nothing to render.
            expect(fleet.members[1]?.executor).toBe('modelless');
            expect(fleet.members[1]?.model).toBeUndefined();
            // Role-only members carry the tier-ladder winner's model (`rollout` is the
            // only profile at or above the reviewer role's capable-1 rung here).
            expect(fleet.members[2]).toMatchObject({ executor: 'rollout', model: 'claude-opus-4' });
            // A disabled member is never resolved against executors: no model, and
            // its declared executor name rides through unresolved.
            expect(fleet.members[3]?.model).toBeUndefined();
            expect(fleet.members[3]).toMatchObject({
                enabled: false,
                executor: 'writer',
                writeCapable: false,
                capabilityState: 'unknown',
            });
        } finally {
            await cleanup();
        }
    });

    test('R7: a fully disabled roster resolves with missing naming the fix, ids still derived', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            await writeFleet(project, {
                members: [
                    { role: 'coder', enabled: false },
                    { executor: 'readonly', enabled: false },
                ],
            });
            const fleet = await svc.resolve(project);
            expect(fleet.missing).toEqual(['no-enabled-members']); // Disabled members keep their id (index preservation) but resolve no executor.
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

describe('FleetService session join (0897)', () => {
    test('members carry their ledger session; members without rows omit the field', async () => {
        const { project, slug, cleanup } = await makeProject();
        try {
            const adapter = await createMigratedDb({ url: ':memory:' });
            await recordMemberSession(adapter, `${slug}-lead`, { mode: 'resume', id: 'sess-42' });
            const ctx: FleetServiceContext = {
                spurConfig: configFor(parseConfig(EXECUTORS_YAML), project),
                reloadAgentConfig: async () => configFor(parseConfig(EXECUTORS_YAML), project),
                roles: ROLES,
                fs: createNodeFileSystem(project),
                registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
                openDb: async () => adapter,
            };
            const svc = new FleetService(ctx);
            await writeFleet(project, {
                members: [
                    { id: 'lead', role: 'coder', executor: 'writer', purpose: 'orchestrator' },
                    { role: 'reviewer', executor: 'readonly' },
                ],
            });
            const fleet = await svc.resolve(project);
            const lead = fleet.members.find((m) => m.instanceId.endsWith('-lead'));
            const reviewer = fleet.members.find((m) => m.instanceId.endsWith('-readonly'));
            expect(lead?.session).toEqual({ mode: 'resume', id: 'sess-42' });
            expect(reviewer?.session).toBeUndefined();
        } finally {
            await cleanup();
        }
    });

    test('a failing ledger read degrades to no session (never blocks the snapshot)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const ctx: FleetServiceContext = {
                spurConfig: configFor(parseConfig(EXECUTORS_YAML), project),
                reloadAgentConfig: async () => configFor(parseConfig(EXECUTORS_YAML), project),
                roles: ROLES,
                fs: createNodeFileSystem(project),
                registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
                openDb: async () => {
                    throw new Error('db gone');
                },
            };
            const svc = new FleetService(ctx);
            await writeFleet(project, { members: [{ id: 'lead', role: 'coder', executor: 'writer' }] });
            const fleet = await svc.resolve(project);
            expect(fleet.members).toHaveLength(1);
            expect(fleet.members[0]?.session).toBeUndefined();
        } finally {
            await cleanup();
        }
    });
});

describe('FleetService materialize (0835 R2/R3/R6)', () => {
    test('writes one generated spec per enabled member; disabled members are not materialized', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, {
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
            await writeFleet(project, { members: [{ executor: 'writer' }] });
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
            await writeFleet(project, { members: [{ executor: 'writer', purpose: 'authored' }] });
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
            await writeFleet(project, { members: [{ executor: 'writer' }, { executor: 'readonly' }] });
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const first = await svc.materialize(project);
            expect(first.upserted.sort()).toEqual([`${slug}-readonly`, `${slug}-writer`].sort());

            await writeFleet(project, {
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
            await writeFleet(project, { members: [{ executor: 'writer' }] });
            process.chdir(project);
            const svc = makeService(parseConfig(EXECUTORS_YAML), project);
            const result = await svc.materialize(project, { check: true });
            expect(result.written).toBe(false);
            expect(result.upserted).toEqual([`${slug}-writer`]);
            expect(await loadAgentSpecs(join(project, '.spur', 'agents'))).toEqual([]);

            fleetSections.delete(project);
            await expect(svc.materialize(project)).rejects.toThrow(/No agent\.fleet declaration/);
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });

    test('a fleet spec pruned by materialization never takes a hand-authored spec with it (R2 teardown contract)', async () => {
        const { project, slug, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            await writeFleet(project, { members: [{ executor: 'writer' }] });
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

    test('0857: re-materializing the same fleet is idempotent and never orphans its own specs', async () => {
        const { project, cleanup } = await makeProject();
        const prevCwd = process.cwd();
        try {
            // Registry display name == the fleet slug: the derived instance id is what
            // must stay stable across passes, never a second group's namespace.
            const slug = 'shared';
            await new ProjectRegistry(join(project, '.spur', 'registry.json')).upsert({
                name: slug,
                path: project,
            });
            await writeFleet(project, { members: [{ id: 'lead', executor: 'writer' }] });
            process.chdir(project);
            const fleetSvc = makeService(parseConfig(EXECUTORS_YAML), project);

            const fleet1 = await fleetSvc.materialize(project);
            expect(fleet1.upserted).toEqual([`${slug}-lead`]);

            // A second pass over the same declaration must not retire what it wrote.
            const fleet2 = await fleetSvc.materialize(project);
            expect(fleet2.orphaned).toEqual([]);
            const specs = await loadAgentSpecs(join(project, '.spur', 'agents'));
            expect(specs.map((s) => s.id).sort()).toEqual([`${slug}-lead`]);
        } finally {
            process.chdir(prevCwd);
            await cleanup();
        }
    });
});

describe('FleetService load error surfaces (0835 review, 0858 R3)', () => {
    test('a config-read failure is not masqueraded as no-declaration (review P3)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const svc = new FleetService({
                spurConfig: null,
                reloadAgentConfig: async () => {
                    throw new Error('EACCES: permission denied, open the project config');
                },
                roles: ROLES,
                fs: createNodeFileSystem(project),
                registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
            });
            // 0858: the declaration rides the config, so a failed config read must fail
            // the load — never degrade to an empty fleet that silently skips autostart.
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
            // 0858: the declaration lives in the project config, read through this seam.
            reloadAgentConfig: async () => configFor(null, project),
            roles: ROLES,
            fs: createNodeFileSystem(project),
            registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
            openDb: async () => db,
        });
        return { svc, db };
    }

    /** Declaration with one planner member carrying purpose 'orchestrator' (id planner-1), plus extras. */
    async function writeOrchestratorFleet(project: string, members: unknown[], orchestrator: unknown): Promise<void> {
        await writeFleet(project, { members, orchestrator });
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
            await writeFleet(project, { members: [] });

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
            const team = new AgentCoordinationService({
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
