import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { FleetDeclarationSchema, type SpurConfig, spurConfigSchema } from '@gobing-ai/spur-config';
import { CoordinationRunDao, createMigratedDb, type DbAdapter, InboxMessageDao } from '@gobing-ai/spur-domain';
import { type AgentSpec, saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import { createNodeFileSystem, type FileSystem, walkDir } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import { type LegacyArtifact, LegacyMigrationService, ProjectRegistry } from '../../src/index';

// 0846 — migration inventory + dry-run preview: read-only classification of the four
// legacy populations, named conflicts, and a plan that preserves every live spec id.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeProject(): Promise<{ base: string; project: string; cleanup: () => Promise<void> }> {
    const base = await mkdtemp(join(tmpdir(), 'spur-legacy-mig-'));
    const project = join(base, 'proj');
    await mkdir(join(project, '.spur', 'agents'), { recursive: true });
    await mkdir(join(project, 'config', 'workflows'), { recursive: true });
    await mkdir(join(project, 'docs'), { recursive: true });
    return { base, project, cleanup: () => rm(base, { recursive: true, force: true }) };
}

function parseConfigWithTeams(teamsBlock: string): SpurConfig {
    return spurConfigSchema.parse(yamlParse(`agent:\n  team:\n${teamsBlock}`));
}

async function seedSpec(project: string, id: string, tags: string[], workspace?: string): Promise<void> {
    const spec: AgentSpec = {
        id,
        name: id,
        type: 'claude',
        workspace: workspace ?? project,
        purpose: 'seeded for legacy-migration test',
        tags,
        config: {},
    };
    await saveAgentSpec(spec, join(project, '.spur', 'agents'));
}

async function registeredRegistry(project: string, extraPaths: string[] = []): Promise<ProjectRegistry> {
    const registry = new ProjectRegistry(join(project, '.spur', 'registry.json'));
    await registry.upsert({ name: 'proj', path: project });
    for (const [index, path] of extraPaths.entries()) {
        await registry.upsert({ name: `extra-${index}`, path });
    }
    return registry;
}

function makeService(input: {
    project: string;
    config: SpurConfig | null;
    db: DbAdapter;
    registry?: ProjectRegistry;
    fs?: FileSystem;
}): LegacyMigrationService {
    return new LegacyMigrationService({
        spurConfig: input.config,
        fs: input.fs ?? createNodeFileSystem(input.project),
        getDb: async () => input.db,
        ...(input.registry !== undefined ? { registry: input.registry } : {}),
    });
}

function findArtifact(inventory: { artifacts: LegacyArtifact[] }, id: string): LegacyArtifact {
    const artifact = inventory.artifacts.find((a) => a.id === id && a.kind !== 'legacy-flag-usage');
    if (artifact === undefined) throw new Error(`no artifact ${id} in ${JSON.stringify(inventory.artifacts)}`);
    return artifact;
}

/** Every file under root, relative path → content. */
async function snapshotTree(root: string): Promise<[string, string][]> {
    const files = await walkDir(root);
    const out: [string, string][] = [];
    for (const file of files.sort()) {
        out.push([relative(root, file), await readFile(file, 'utf8')]);
    }
    return out;
}

/** Fs port that forwards every read but turns any write verb into a hard failure (R3). */
function denyWrites(inner: FileSystem): FileSystem {
    const WRITE_VERBS = new Set([
        'writeFile',
        'appendFile',
        'ensureDir',
        'deleteFile',
        'rename',
        'copy',
        'copyFile',
        'createWriteStream',
    ]);
    return new Proxy(inner, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && WRITE_VERBS.has(prop)) {
                return () => {
                    throw new Error(`zero-write guard: LegacyMigrationService called ${prop}`);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

/** Fs port that records every write verb (verb + raw args), then forwards it. */
function recordingWrites(inner: FileSystem): { fs: FileSystem; writes: Array<{ verb: string; args: unknown[] }> } {
    const WRITE_VERBS = new Set(['writeFile', 'appendFile', 'ensureDir', 'deleteFile', 'rename', 'copy', 'copyFile']);
    const writes: Array<{ verb: string; args: unknown[] }> = [];
    const fs = new Proxy(inner, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && WRITE_VERBS.has(prop)) {
                return (...args: unknown[]) => {
                    writes.push({ verb: prop, args });
                    const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
                    return fn(...args);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
    return { fs, writes };
}

// ---------------------------------------------------------------------------
// 0847 — apply (G64 cutover) + rollback
// ---------------------------------------------------------------------------

/** Single-team fixture roster: one executor member + two role-only coders. */
function singleTeamConfig(project: string, membersBlock: string): SpurConfig {
    return parseConfigWithTeams(
        `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n${membersBlock}`,
    );
}

const THREE_MEMBERS = '        - executor: claude\n        - role: coder\n        - role: coder\n';

async function makeConvertedFixture(): Promise<{
    project: string;
    db: DbAdapter;
    svc: LegacyMigrationService;
    cleanup: () => Promise<void>;
}> {
    const { project, cleanup } = await makeProject();
    await seedSpec(project, 'web-claude', ['team:web', 'spur:generated']);
    await seedSpec(project, 'web-coder-1', ['team:web', 'spur:generated']);
    await seedSpec(project, 'web-coder-2', ['team:web', 'spur:generated']);
    const db = await createMigratedDb({ url: ':memory:' });
    const svc = makeService({
        project,
        config: singleTeamConfig(project, THREE_MEMBERS),
        db,
        registry: await registeredRegistry(project),
    });
    return { project, db, svc, cleanup };
}

describe('LegacyMigrationService.apply + rollback (0847)', () => {
    test('converted declaration carries explicit ids; preservedIds match the on-disk specs verbatim (R1/R3)', async () => {
        const { project, svc, cleanup } = await makeConvertedFixture();
        try {
            const before = await snapshotTree(project);
            const result = await svc.apply(project);

            expect(result.outcome).toBe('converted');
            expect(result.backupPath).toBeNull();
            expect(result.fleetPath).toBe(join(project, '.spur', 'fleet.json'));
            // Every on-disk spec id survives verbatim, in roster order.
            expect(result.preservedIds).toEqual(['web-claude', 'web-coder-1', 'web-coder-2']);

            const written = FleetDeclarationSchema.parse(JSON.parse(await readFile(result.fleetPath, 'utf8')));
            expect(written.members.map((m) => m.id)).toEqual(['claude', 'coder-1', 'coder-2']); // <role>-<n> frozen
            expect(written.members.map((m) => m.enabled)).toEqual([true, true, true]);

            // Exactly one new file appeared: .spur/fleet.json — nothing else moved.
            const after = await snapshotTree(project);
            expect(after.filter(([p]) => !before.some(([q]) => q === p)).map(([p]) => p)).toEqual(['.spur/fleet.json']);

            // Idempotence (R4): a re-run over an equal declaration is a no-op.
            const beforeSecond = await snapshotTree(project);
            const second = await svc.apply(project);
            expect(second.outcome).toBe('unchanged');
            expect(second.backupPath).toBeNull();
            expect(second.preservedIds).toEqual(result.preservedIds);
            expect(await snapshotTree(project)).toEqual(beforeSecond);
        } finally {
            await cleanup();
        }
    });

    test('reordering the roster cannot reallocate member ids (R3)', async () => {
        const { project, db, svc, cleanup } = await makeConvertedFixture();
        try {
            const first = await svc.apply(project);
            expect(first.outcome).toBe('converted');

            // Same roster, members array reordered: explicit ids pin the identity.
            const reordered = makeService({
                project,
                config: singleTeamConfig(
                    project,
                    '        - role: coder\n        - role: coder\n        - executor: claude\n',
                ),
                db,
                registry: await registeredRegistry(project),
            });
            const second = await reordered.apply(project);
            expect(second.outcome).toBe('converted'); // member order in the file legitimately changed
            expect(second.preservedIds).toEqual(['web-coder-1', 'web-coder-2', 'web-claude']);
            expect(second.backupPath).not.toBeNull(); // the order-A content was backed up first
            const reparsed = FleetDeclarationSchema.parse(JSON.parse(await readFile(second.fleetPath, 'utf8')));
            expect(reparsed.members.map((m) => m.id)).toEqual(['coder-1', 'coder-2', 'claude']);
        } finally {
            await cleanup();
        }
    });

    test('blocked plan ⇒ nothing written and nothing backed up (R7)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'web-coder', ['team:web', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n` +
                    `    web2:\n      name: Web Two\n      work_dir: ${project}\n      members:\n        - role: scribe\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({
                project,
                config,
                db,
                registry: await registeredRegistry(project),
                fs: denyWrites(createNodeFileSystem(project)),
            });
            const before = await snapshotTree(project);

            const result = await svc.apply(project);

            expect(result.outcome).toBe('blocked');
            expect(result.conflicts.map((c) => c.kind)).toEqual(['two-teams-one-project']);
            expect(result.preservedIds).toEqual([]);
            expect(await snapshotTree(project)).toEqual(before); // no fleet.json, no .bak, no anything
        } finally {
            await cleanup();
        }
    });

    test('addressed id without a spec file ⇒ blocked with addressed-id-without-spec (R2)', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'web-coder-1', ['team:web', 'spur:generated']);
            const db = await createMigratedDb({ url: ':memory:' });
            await new InboxMessageDao(db).enqueue('operator', 'web-coder-2', 'ping'); // addressed, but no spec file
            const svc = makeService({
                project,
                config: singleTeamConfig(project, '        - role: coder\n        - role: coder\n'),
                db,
                registry: await registeredRegistry(project),
            });
            const before = await snapshotTree(project);

            const result = await svc.apply(project);

            expect(result.outcome).toBe('blocked');
            expect(result.conflicts.map((c) => c.kind)).toEqual(['addressed-id-without-spec']);
            expect(result.conflicts[0]?.sources).toEqual([join(project, '.spur', 'agents', 'web-coder-2.yaml')]);
            expect(await snapshotTree(project)).toEqual(before); // refusal precedes any side effect
        } finally {
            await cleanup();
        }
    });

    test('key order and indentation in an existing declaration do not force a rewrite (R4)', async () => {
        const { project, svc, cleanup } = await makeConvertedFixture();
        try {
            await svc.apply(project); // canonical content (4-space indent, version key first)
            // Same declaration, different key order and formatting — none of it is semantic.
            const fleetPath = join(project, '.spur', 'fleet.json');
            const canonical = JSON.parse(await readFile(fleetPath, 'utf8')) as {
                members: Array<Record<string, unknown>>;
            };
            const reorderedKeys = JSON.stringify({ members: canonical.members, version: 1 });
            await writeFile(fleetPath, `${reorderedKeys}\n`);

            const result = await svc.apply(project);

            expect(result.outcome).toBe('unchanged');
        } finally {
            await cleanup();
        }
    });

    test('prior file is backed up to .bak and rollback restores it byte-for-byte (R5)', async () => {
        const { project, svc, cleanup } = await makeConvertedFixture();
        try {
            const fleetPath = join(project, '.spur', 'fleet.json');
            const prior = '{"version":1,"members":[]}';
            await writeFile(fleetPath, prior);

            const result = await svc.apply(project);

            expect(result.outcome).toBe('converted');
            expect(result.backupPath).toBe(`${fleetPath}.bak`);
            expect(await readFile(`${fleetPath}.bak`, 'utf8')).toBe(prior);
            expect(await readFile(fleetPath, 'utf8')).not.toBe(prior);

            const rolled = await svc.rollback(project);
            expect(rolled.outcome).toBe('restored');
            expect(await readFile(fleetPath, 'utf8')).toBe(prior);
        } finally {
            await cleanup();
        }
    });

    test('rollback removes a file this instance created and reports nothing-to-roll-back otherwise (R5)', async () => {
        const { project, svc, cleanup } = await makeConvertedFixture();
        try {
            const fleetPath = join(project, '.spur', 'fleet.json');
            expect(await svc.apply(project)).toMatchObject({ outcome: 'converted' });

            expect((await svc.rollback(project)).outcome).toBe('removed');
            expect(existsSync(fleetPath)).toBe(false);

            // A file no instance of this service wrote, with no .bak: refuse to guess.
            await writeFile(fleetPath, '{"version":1,"members":[]}');
            const other = makeService({
                project,
                config: singleTeamConfig(project, THREE_MEMBERS),
                db: await createMigratedDb({ url: ':memory:' }),
                registry: await registeredRegistry(project),
            });
            expect((await other.rollback(project)).outcome).toBe('nothing-to-roll-back');
            expect(existsSync(fleetPath)).toBe(true);
        } finally {
            await cleanup();
        }
    });

    test('no collateral writes: only fleet.json (+ .bak) is touched (R5)', async () => {
        const { project, cleanup } = await makeConvertedFixture();
        try {
            const fleetPath = join(project, '.spur', 'fleet.json');
            await writeFile(fleetPath, '{"version":1,"members":[]}'); // force the backup path too
            const { fs, writes } = recordingWrites(createNodeFileSystem(project));
            const writing = makeService({
                project,
                config: singleTeamConfig(project, THREE_MEMBERS),
                db: await createMigratedDb({ url: ':memory:' }),
                registry: await registeredRegistry(project),
                fs,
            });

            const result = await writing.apply(project);
            expect(result.outcome).toBe('converted');
            expect(writes.length).toBeGreaterThan(0);

            for (const { verb, args } of writes) {
                if (verb === 'writeFile') {
                    // atomicWriteAsync: one temp file inside .spur, renamed onto fleet.json.
                    const tempPath = args[0] as string;
                    expect(tempPath.startsWith(join(project, '.spur'))).toBe(true);
                    expect(basename(tempPath).startsWith('.spur.fleet.')).toBe(true);
                    expect(basename(tempPath).endsWith('.tmp')).toBe(true);
                } else if (verb === 'copy') {
                    expect(args[0]).toBe(fleetPath);
                    expect(args[1]).toBe(`${fleetPath}.bak`);
                } else {
                    throw new Error(`unexpected write verb during apply: ${verb} ${JSON.stringify(args)}`);
                }
            }
            // Nothing under .spur/agents/, nothing named config.yaml, nothing at the registry.
            for (const { args } of writes) {
                for (const arg of args) {
                    if (typeof arg !== 'string') continue;
                    expect(arg.includes(join('.spur', 'agents'))).toBe(false);
                    expect(arg.endsWith('config.yaml')).toBe(false);
                    expect(arg.endsWith('registry.json')).toBe(false);
                }
            }
        } finally {
            await cleanup();
        }
    });

    test('the module ships no alias construct and no transition-shim entry (R6)', async () => {
        const source = readFileSync(
            join(import.meta.dir, '..', '..', 'src', 'services', 'legacy-migration.ts'),
            'utf8',
        );
        const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        expect(stripped).not.toMatch(/alias/i);

        const shims = JSON.parse(
            readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'config', 'transition-shims.json'), 'utf8'),
        ) as { entries: Array<{ file: string }> };
        expect(shims.entries.filter((e) => e.file.includes('legacy-migration'))).toEqual([]);
    });
});

describe('LegacyMigrationService.inventory (0846)', () => {
    test('classifies team block, generated, manual (untagged + tag-without-generated), and orphan specs', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'web-coder', ['team:web', 'spur:generated']);
            await seedSpec(project, 'manual-reporter', []);
            await seedSpec(project, 'legacy-tagged', ['team:web']); // team tag but never generated
            await seedSpec(project, 'ghost-1', ['team:ghost', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({
                project,
                config,
                db,
                registry: await registeredRegistry(project),
            });

            const inventory = await svc.inventory(project);

            const team = findArtifact(inventory, 'web');
            expect(team.kind).toBe('team-config');
            expect(team.disposition).toBe('convert');
            expect(team.source).toBe('agent.team.web');

            const generated = findArtifact(inventory, 'web-coder');
            expect(generated.kind).toBe('generated-spec');
            expect(generated.disposition).toBe('convert');
            expect(generated.targetId).toBe('web-coder');

            const untagged = findArtifact(inventory, 'manual-reporter');
            expect(untagged.kind).toBe('manual-spec');
            expect(untagged.disposition).toBe('preserve');
            expect(untagged.targetId).toBe('manual-reporter');

            const taggedOnly = findArtifact(inventory, 'legacy-tagged');
            expect(taggedOnly.kind).toBe('manual-spec');
            expect(taggedOnly.disposition).toBe('preserve');

            const orphan = findArtifact(inventory, 'ghost-1');
            expect(orphan.kind).toBe('orphan-spec');
            expect(orphan.disposition).toBe('retire');
            expect(orphan.targetId).toBeNull();

            expect(inventory.counts).toEqual({ convert: 2, preserve: 2, relink: 0, retire: 1 });
            expect(inventory.addressedSpecIds).toEqual([]);
            expect(inventory.conflicts.map((c) => c.kind)).toEqual(['orphan-spec-no-config']);
            expect(inventory.conflicts[0]?.sources).toEqual([join(project, '.spur', 'agents', 'ghost-1.yaml')]);
        } finally {
            await cleanup();
        }
    });

    test('orphan with an inbox row relinks; the same spec with no rows retires; coordination rows also address', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'ghost-1', ['team:ghost', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            await new InboxMessageDao(db).enqueue('operator', 'ghost-1', 'for ghost-1');
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const inventory = await svc.inventory(project);
            expect(findArtifact(inventory, 'ghost-1').disposition).toBe('relink');
            expect(findArtifact(inventory, 'ghost-1').targetId).toBe('ghost-1');
            expect(findArtifact(inventory, 'ghost-1').addressed).toBe(true);
            expect(inventory.addressedSpecIds).toEqual(['ghost-1']);
        } finally {
            await cleanup();
        }

        // Same spec id, no rows anywhere → retire.
        const second = await makeProject();
        try {
            await seedSpec(second.project, 'ghost-1', ['team:ghost', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${second.project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({
                project: second.project,
                config,
                db,
                registry: await registeredRegistry(second.project),
            });
            const inventory = await svc.inventory(second.project);
            expect(findArtifact(inventory, 'ghost-1').disposition).toBe('retire');
            expect(findArtifact(inventory, 'ghost-1').addressed).toBe(false);
        } finally {
            await cleanup();
        }

        // coordination_runs.spec_id addresses too — the union, not the inbox alone.
        const third = await makeProject();
        try {
            await seedSpec(third.project, 'run-ghost', ['team:ghost', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${third.project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            await new CoordinationRunDao(db).insertStart({
                specId: 'run-ghost',
                agentKind: 'claude-code',
                processId: null,
                runId: 'run-1',
                generation: 1,
                startedAt: '2026-09-10T00:00:00.000Z',
            });
            const svc = makeService({
                project: third.project,
                config,
                db,
                registry: await registeredRegistry(third.project),
            });
            expect(findArtifact(await svc.inventory(third.project), 'run-ghost').disposition).toBe('relink');
        } finally {
            await cleanup();
        }
    });

    test('a generated spec whose workspace disagrees with the team work_dir is a named conflict, still converting', async () => {
        const { base, project, cleanup } = await makeProject();
        try {
            const otherWs = join(base, 'other-ws');
            await mkdir(otherWs, { recursive: true });
            await seedSpec(project, 'web-coder', ['team:web', 'spur:generated'], otherWs);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const inventory = await svc.inventory(project);
            const generated = findArtifact(inventory, 'web-coder');
            expect(generated.disposition).toBe('convert');
            expect(generated.conflicts.map((c) => c.kind)).toEqual(['spec-workspace-disagreement']);
            expect(inventory.conflicts[0]?.sources).toEqual([join(project, '.spur', 'agents', 'web-coder.yaml')]);
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// R4 — conflicts and warnings
// ---------------------------------------------------------------------------

describe('LegacyMigrationService conflicts (0846 R4)', () => {
    test('two teams resolving to one project dedupe into ONE conflict naming both config keys, no merge proposed', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const config = parseConfigWithTeams(
                `    alpha:\n      name: Alpha\n      work_dir: ${project}\n      members:\n        - role: coder\n` +
                    `    beta:\n      name: Beta\n      work_dir: ${project}\n      members:\n        - role: reviewer\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const inventory = await svc.inventory(project);
            const twoTeams = inventory.conflicts.filter((c) => c.kind === 'two-teams-one-project');
            expect(twoTeams).toHaveLength(1);
            expect(inventory.conflicts).toHaveLength(1);
            expect(twoTeams[0]?.sources).toEqual(['agent.team.alpha', 'agent.team.beta']);
            expect(twoTeams[0]?.message).toContain('no merge is proposed');
            // No resolution is proposed anywhere in the output — the operator decides.
            expect(JSON.stringify(inventory)).not.toMatch(/"pick|"winner|merge by/);

            // Both team artifacts carry the same conflict instance (deduped by identity).
            expect(findArtifact(inventory, 'alpha').conflicts[0]).toBe(twoTeams[0]);
            expect(findArtifact(inventory, 'beta').conflicts[0]).toBe(twoTeams[0]);
        } finally {
            await cleanup();
        }
    });

    test('work_dir that resolves outside every registered project is work-dir-mismatch; a registered one is not', async () => {
        const { base, project, cleanup } = await makeProject();
        try {
            const registeredOther = join(base, 'other');
            await mkdir(registeredOther, { recursive: true });
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${join(base, 'unregistered')}\n      members:\n        - role: coder\n` +
                    `    gamma:\n      name: Gamma\n      work_dir: ${registeredOther}\n      members:\n        - role: scribe\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({
                project,
                config,
                db,
                registry: await registeredRegistry(project, [registeredOther]),
            });

            const inventory = await svc.inventory(project);
            const mismatches = inventory.conflicts.filter((c) => c.kind === 'work-dir-mismatch');
            expect(mismatches).toHaveLength(1);
            expect(mismatches[0]?.sources).toEqual(['agent.team.web']);
            expect(findArtifact(inventory, 'gamma').conflicts).toEqual([]);
        } finally {
            await cleanup();
        }
    });

    test('derived-id-collision: a roster member re-derives an id an on-disk spec holds under a different team tag', async () => {
        const { project, cleanup } = await makeProject();
        try {
            // Generated once under an older team id ("legacy"); team web now re-derives it.
            // memberLocalId derives `coder-1` for a role-only member → composed id `web-coder-1`.
            await seedSpec(project, 'web-coder-1', ['team:legacy', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const inventory = await svc.inventory(project);
            const collisions = inventory.conflicts.filter((c) => c.kind === 'derived-id-collision');
            expect(collisions).toHaveLength(1);
            const collision = collisions[0];
            if (collision === undefined) throw new Error('unreachable: length asserted above');
            expect(collision.sources).toEqual(
                ['agent.team.web.members[0]', join(project, '.spur', 'agents', 'web-coder-1.yaml')].sort(),
            );
            expect(collision.message).toContain('web-coder-1');
            // The collision is attached to both the team block and the holding spec.
            expect(findArtifact(inventory, 'web').conflicts).toContain(collision);
            expect(findArtifact(inventory, 'web-coder-1').conflicts).toContain(collision);
        } finally {
            await cleanup();
        }
    });

    test('unmapped member overrides warn with their fields but never block; mapped-only rosters stay silent', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n` +
                    '        - executor: claude\n          command: [echo, hi]\n          model: opus\n',
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const inventory = await svc.inventory(project);
            expect(inventory.conflicts).toEqual([]);
            expect(inventory.warnings).toHaveLength(1);
            expect(inventory.warnings[0]?.kind).toBe('unmapped-member-override');
            expect(inventory.warnings[0]?.source).toBe('agent.team.web.members[1]');
            expect([...(inventory.warnings[0]?.fields ?? [])].sort()).toEqual(['command', 'model']);
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// R2 — preview plan
// ---------------------------------------------------------------------------

describe('LegacyMigrationService.preview (0846 R2)', () => {
    test('emits one write-fleet step per roster member with the composed id preserved verbatim', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'web-coder-1', ['team:web', 'spur:generated']);
            await seedSpec(project, 'web-claude', ['team:web', 'spur:generated']);
            await seedSpec(project, 'manual-reporter', []);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n` +
                    '        - executor: claude\n',
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const plan = await svc.preview(project);
            expect(plan.blocked).toBe(false);
            expect(plan.inventory.conflicts).toEqual([]);

            // memberLocalId: role-only member derives `coder-1` (0543 R3); executor member `claude`.
            const fleetSteps = plan.steps.filter((s) => s.action === 'write-fleet');
            expect(fleetSteps.map((s) => s.target)).toEqual(['coder-1', 'claude']);
            expect(fleetSteps.map((s) => s.from)).toEqual(['agent.team.web.members[0]', 'agent.team.web.members[1]']);
            // Character-for-character the source spec id this member's identity must keep.
            expect(fleetSteps.map((s) => s.preservesId)).toEqual(['web-coder-1', 'web-claude']);

            const preserveSteps = plan.steps.filter((s) => s.action === 'preserve-spec');
            expect(preserveSteps.map((s) => s.target).sort()).toEqual(['manual-reporter', 'web-claude', 'web-coder-1']);
            for (const step of preserveSteps) expect(step.preservesId).toBe(step.target);
        } finally {
            await cleanup();
        }
    });

    test('addressed orphan projects relink-spec with its id preserved; unaddressed projects retire-spec', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'ghost-1', ['team:ghost', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            await new InboxMessageDao(db).enqueue('operator', 'ghost-1', 'for ghost-1');
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const plan = await svc.preview(project);
            const relink = plan.steps.find((s) => s.action === 'relink-spec');
            expect(relink?.target).toBe('ghost-1');
            expect(relink?.preservesId).toBe('ghost-1');
        } finally {
            await cleanup();
        }

        const second = await makeProject();
        try {
            await seedSpec(second.project, 'ghost-1', ['team:ghost', 'spur:generated']);
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${second.project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({
                project: second.project,
                config,
                db,
                registry: await registeredRegistry(second.project),
            });
            const plan = await svc.preview(second.project);
            const retire = plan.steps.find((s) => s.action === 'retire-spec');
            expect(retire?.target).toBe('ghost-1');
            expect(retire?.preservesId).toBeNull();
            // Orphans are named conflicts, so the plan blocks until the operator acts.
            expect(plan.blocked).toBe(true);
        } finally {
            await cleanup();
        }
    });

    test('a conflicting project blocks the plan and every touching step carries the conflict', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const config = parseConfigWithTeams(
                `    alpha:\n      name: Alpha\n      work_dir: ${project}\n      members:\n        - role: coder\n` +
                    `    beta:\n      name: Beta\n      work_dir: ${project}\n      members:\n        - role: reviewer\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const plan = await svc.preview(project);
            expect(plan.blocked).toBe(true);
            const fleetSteps = plan.steps.filter((s) => s.action === 'write-fleet');
            expect(fleetSteps.length).toBe(2);
            for (const step of fleetSteps) {
                expect(step.conflicts.map((c) => c.kind)).toContain('two-teams-one-project');
            }
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// R3 — zero-write guarantee + legacy flag scan
// ---------------------------------------------------------------------------

describe('LegacyMigrationService zero-write + scan (0846 R3)', () => {
    test('inventory + preview perform no writes: any write-verb call on the fs port fails the test', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'web-coder', ['team:web', 'spur:generated']);
            await writeFile(join(project, 'docs', 'legacy.md'), '# notes\nspur agent run --agent web-coder\n');
            await writeFile(
                join(project, 'config', 'workflows', 'daily.yaml'),
                'steps:\n  - run: x --agent=web-coder\n',
            );
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            await new InboxMessageDao(db).enqueue('operator', 'web-coder', 'ping');
            // Registry first: its upsert writes registry.json, and the snapshot must see
            // the tree AFTER every fixture write so the only delta left to catch is the service's.
            const registry = await registeredRegistry(project);

            const before = await snapshotTree(project);
            const svc = makeService({
                project,
                config,
                db,
                registry,
                fs: denyWrites(createNodeFileSystem(project)),
            });
            const plan = await svc.preview(project);
            expect(plan.blocked).toBe(false);
            expect(await snapshotTree(project)).toEqual(before);
        } finally {
            await cleanup();
        }
    });

    test('the service source never references team-materialization or registry-lock writers', async () => {
        const source = await readFile(join(import.meta.dir, '../../src/services/legacy-migration.ts'), 'utf8');
        // Comments are prose ABOUT the guarantee; only executable code may not reference the writers.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
        expect(code).not.toMatch(/materializeTeam|teardownTeam|withLock/);
    });

    test('legacy --agent scan reports on-disk spec id usages in docs and workflows, not role selectors', async () => {
        const { project, cleanup } = await makeProject();
        try {
            await seedSpec(project, 'web-coder', ['team:web', 'spur:generated']);
            await seedSpec(project, 'ghost-1', ['team:ghost', 'spur:generated']);
            await writeFile(
                join(project, 'docs', 'legacy.md'),
                '# notes\nspur agent run --agent ghost-1 --purpose x\n',
            );
            // `agent:` (a selector) must not match; only `--agent <spec-id>` counts.
            await writeFile(
                join(project, 'config', 'workflows', 'daily.yaml'),
                'workflow:\n  steps:\n    - agent: coder\n    - run: claude --agent=web-coder\n',
            );
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n`,
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const inventory = await svc.inventory(project);
            const flags = inventory.artifacts.filter((a) => a.kind === 'legacy-flag-usage');
            // Segment-built expected id: the joined literal is banned in app source (sp-runtime-path).
            const workflowsPrefix = `${['config', 'workflows'].join('/')}/daily.yaml:4`;
            expect(flags.map((a) => a.id)).toEqual([workflowsPrefix, 'docs/legacy.md:2']);
            for (const flag of flags) {
                expect(flag.disposition).toBe('retire');
                expect(flag.targetId).toBeNull();
                expect(flag.addressed).toBe(false);
                expect(flag.source.startsWith(project)).toBe(true);
            }
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 0848 — cutover halt guard (agent.team.<id> block removal)
// ---------------------------------------------------------------------------

import {
    assertConfigBlockRemovalSafe,
    ConfigBlockRemovalBlockedError,
    type LegacyWarning,
    type MigrationInventory,
} from '../../src/index';

/** An empty inventory except for the given warnings (the guard reads only `warnings`). */
function inventoryWith(warnings: LegacyWarning[]): MigrationInventory {
    return {
        projectPath: '/proj',
        artifacts: [],
        addressedSpecIds: [],
        conflicts: [],
        warnings,
        counts: { convert: 0, preserve: 0, relink: 0, retire: 0 },
    };
}

describe('assertConfigBlockRemovalSafe (0848 plan step 12)', () => {
    test('throws ConfigBlockRemovalBlockedError naming the source and unmapped keys', () => {
        const warning: LegacyWarning = {
            kind: 'unmapped-member-override',
            message: 'member has unmapped overrides',
            source: 'agent.team.web.members[1]',
            fields: ['model', 'workspace'],
        };
        try {
            assertConfigBlockRemovalSafe(inventoryWith([warning]));
            throw new Error('expected assertConfigBlockRemovalSafe to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigBlockRemovalBlockedError);
            const blocked = err as ConfigBlockRemovalBlockedError;
            expect(blocked.blockers).toEqual([warning]);
            expect(blocked.message).toContain('agent.team.web.members[1]');
            expect(blocked.message).toContain('model, workspace');
        }
    });

    test('passes a clean inventory through untouched', () => {
        expect(() => assertConfigBlockRemovalSafe(inventoryWith([]))).not.toThrow();
    });

    test('halts on a REAL inventory whose roster carries unmapped member overrides', async () => {
        const { project, cleanup } = await makeProject();
        try {
            const config = parseConfigWithTeams(
                `    web:\n      name: Web\n      work_dir: ${project}\n      members:\n        - role: coder\n` +
                    '        - executor: claude\n          command: [echo, hi]\n          model: opus\n',
            );
            const db = await createMigratedDb({ url: ':memory:' });
            const svc = makeService({ project, config, db, registry: await registeredRegistry(project) });

            const inventory = await svc.inventory(project);
            expect(() => assertConfigBlockRemovalSafe(inventory)).toThrow(ConfigBlockRemovalBlockedError);
        } finally {
            await cleanup();
        }
    });
});
