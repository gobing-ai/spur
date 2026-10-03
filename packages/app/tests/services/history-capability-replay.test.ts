import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type ArtifactSelector,
    createMigratedDb,
    type DbAdapter,
    historyBoardSkillBreakdownFromRollup,
} from '@gobing-ai/spur-domain';
import type { CapabilityOrigin } from '@gobing-ai/ts-llm-jsonl-importer';
import { refreshHistoryRollups } from '../../src/services/history-analysis-service';
import {
    HistoryService,
    type HistoryServiceContext,
    UnsafeHistoryImporterError,
} from '../../src/services/history-service';

// ---------------------------------------------------------------------------
// E93 task 1030 — safe historical capability replay and stable Histories results
// (design history-capability-detection §8.4; AC1 "Historical reprocessing upgrades
// safely and remains repeatable").
//
// Composition seams are the frozen ones: HistoryServiceContext.getDb/historyHome/cwd
// and HistoryService.import({root, mode, dryRun}) over a migrated temp-FILE database.
// Nothing ambient is read (empty historyHome/cwd, explicit roots), no checkpoint or
// ledger row is ever deleted by hand, and `history reset` is never invoked: the only
// upgrade mechanisms exercised are importer full mode (checkpoint short-circuit
// bypass + source-scoped reconciliation) and the rollup definition bump (v6 → v7).
// The 8/3 oracle is the design §8.3 freeze: byCapability totals 8 for the claude
// population and the legacy confirmed-load arrays total 3, with the correlated
// duplicate pair collapsed only by shared invocation identity.
// ---------------------------------------------------------------------------

/** sha256 of a UTF-8 string — fixture stand-in for an observed artifact digest. */
function sha256Text(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Empty directory so ambient session discovery finds nothing (hermetic, 0624 R5). */
function emptyRoot(label: string): string {
    return mkdtempSync(join(tmpdir(), `spur-replay-${label}-`));
}

const ALL: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    models: null,
    tools: null,
    skills: null,
    sessionId: null,
    runId: null,
    taskWbs: null,
};
const CLAUDE_ONLY: ArtifactSelector = { ...ALL, sources: ['claude'] };

/** The installed importer provenance the CLI would resolve (binary provenance, R1). */
const INSTALLED_IMPORTER_VERSION: string = (
    JSON.parse(
        readFileSync(
            join(import.meta.dir, '../../../../node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json'),
            'utf8',
        ),
    ) as {
        version: string;
    }
).version;

// --- fixture population (design §8.3 oracle shape, real claude/pi JSONL) ------

const SESSION = 's-replay';

/** The complete claude per-source population. One file, one session, 15 lines. */
function claudeLines(): string[] {
    const assistantSkill = (id: string, skill: string, ts: string): string =>
        JSON.stringify({
            type: 'assistant',
            sessionId: SESSION,
            ts,
            message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] },
        });
    const result = (id: string, ts: string, isError = false): string =>
        JSON.stringify({
            type: 'user',
            sessionId: SESSION,
            timestamp: ts,
            message: {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: id, ...(isError ? { is_error: true } : {}), content: 'done' },
                ],
            },
        });
    return [
        // 1: command request envelope (request/unknown — never paired).
        JSON.stringify({
            type: 'user',
            sessionId: SESSION,
            timestamp: '2026-05-30T00:00:30.000Z',
            message: {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: '<command-name>/sp-dev-run</command-name>\n<command-args>1030</command-args>',
                    },
                ],
            },
        }),
        // 2: second command request.
        JSON.stringify({
            type: 'user',
            sessionId: SESSION,
            timestamp: '2026-05-30T00:00:40.000Z',
            message: {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: '<command-name>/sp-dev-review</command-name>\n<command-args>1030</command-args>',
                    },
                ],
            },
        }),
        // 3: correlated duplicate pair — two representations of ONE invocation share
        // the same source call id, so the importer derives one shared invocation_id.
        assistantSkill('tu-l1', 'sp:dev-verify', '2026-05-30T00:01:00.000Z'),
        // 4+5: the duplicate representations.
        assistantSkill('tu-l2', 'sp:dev-review', '2026-05-30T00:02:00.000Z'),
        assistantSkill('tu-l2', 'sp:dev-review', '2026-05-30T00:02:01.000Z'),
        // 6: ordinary origin-classified load.
        assistantSkill('tu-l3', 'sp:dev-plan', '2026-05-30T00:02:30.000Z'),
        // 7-9: results — l1 ok, l2 ok (updates BOTH duplicate rows), l3 ok.
        result('tu-l1', '2026-05-30T00:01:05.000Z'),
        result('tu-l2', '2026-05-30T00:02:05.000Z'),
        result('tu-l3', '2026-05-30T00:02:35.000Z'),
        // 10: native delegation (capability kind subagent from source identity).
        JSON.stringify({
            type: 'assistant',
            sessionId: SESSION,
            ts: '2026-05-30T00:03:00.000Z',
            message: {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'tu-del', name: 'Task', input: { subagent_type: 'coder', prompt: 'go' } },
                ],
            },
        }),
        // 11: dispatch accepted → delegation ok.
        result('tu-del', '2026-05-30T00:03:05.000Z'),
        // 12: failed load.
        assistantSkill('tu-fail', 'sp:dev-fail', '2026-05-30T00:03:30.000Z'),
        // 13: error result → load error.
        result('tu-fail', '2026-05-30T00:03:35.000Z', true),
        // 14: unconfirmed load (no result yet) → unknown.
        assistantSkill('tu-unc', 'sp:dev-unc', '2026-05-30T00:04:00.000Z'),
        // 15: conflicting supplied origins + no timestamp — unbucketed coverage whose
        // capability facts stay honestly unresolved (design §8.4 unknown coverage).
        JSON.stringify({
            type: 'assistant',
            sessionId: SESSION,
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tu-nullts', name: 'Skill', input: { skill: 'sp:dev-conflict' } }],
            },
        }),
    ];
}

/** The other-source sentinel: one pi wrapper load in its own root. */
const PI_LINES: string[] = [
    JSON.stringify({
        type: 'message',
        timestamp: '2026-05-30T01:00:00.000Z',
        message: {
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: '<skill name="sp-dev-sentinel" location="/sentinel/sp-dev-sentinel/SKILL.md">\nsentinel body',
                },
            ],
        },
    }),
];

/** Operator-declared origins (fixture stand-in for the 1028 supplied snapshot). */
function capabilityOrigins(): CapabilityOrigin[] {
    const origin = (
        skillName: string,
        kind: CapabilityOrigin['capabilityKind'],
        identity: string,
        digestSeed: string,
    ): CapabilityOrigin => ({
        source: 'claude',
        skillName,
        artifactDigest: sha256Text(digestSeed),
        capabilityKind: kind,
        originIdentity: identity,
    });
    return [
        origin('sp:dev-verify', 'skill', 'fixture:skills/sp-dev-verify', 'artifact:sp-dev-verify@0.5.12'),
        origin('sp:dev-review', 'command', 'fixture:commands/sp-dev-review', 'artifact:sp-dev-review@0.5.12'),
        origin('sp:dev-plan', 'skill', 'fixture:skills/sp-dev-plan', 'artifact:sp-dev-plan@0.5.12'),
        // Deliberate conflict pair: two origins agree on nothing observable, so any
        // sp:dev-conflict row must keep null capability facts + a bounded finding.
        origin('sp:dev-conflict', 'skill', 'fixture:conflict/a', 'artifact:conflict-a'),
        origin('sp:dev-conflict', 'subagent', 'fixture:conflict/b', 'artifact:conflict-b'),
    ];
}

// --- dump helpers -------------------------------------------------------------

interface SkillRow {
    record_hash: string;
    source: string;
    source_file: string;
    source_line: number;
    session_id: string;
    skill_name: string;
    invocation_kind: string;
    evidence_kind: string | null;
    status: string | null;
    capability_kind: string | null;
    invocation_id: string | null;
    origin_identity: string | null;
    started_at: string | null;
    completed_at: string | null;
    call_id: string | null;
    imported_at: string;
}

async function skillRows(db: DbAdapter, source?: string): Promise<SkillRow[]> {
    return db.queryAll<SkillRow>(
        `SELECT record_hash, source, source_file, source_line, session_id, skill_name,
                invocation_kind, evidence_kind, status, capability_kind, invocation_id,
                origin_identity, started_at, completed_at, call_id, imported_at
         FROM history_skill_call ${source !== undefined ? 'WHERE source = ?' : ''}
         ORDER BY source, record_hash`,
        ...(source !== undefined ? [source] : []),
    );
}

async function ledgerRows(db: DbAdapter): Promise<Array<Record<string, unknown>>> {
    return db.queryAll('SELECT * FROM history_import_ledger ORDER BY record_hash');
}

async function messageRows(db: DbAdapter): Promise<Array<Record<string, unknown>>> {
    return db.queryAll('SELECT * FROM history_message ORDER BY record_hash');
}

async function checkpointRows(db: DbAdapter): Promise<Array<Record<string, unknown>>> {
    return db.queryAll(
        'SELECT source, source_file, last_imported_line, source_size, source_mtime_ms FROM history_import_checkpoint ORDER BY source, source_file',
    );
}

async function skill5mRows(db: DbAdapter, source?: string): Promise<Array<Record<string, unknown>>> {
    return db.queryAll(
        `SELECT bucket_start, source, skill_name, invocation_kind, capability_kind, evidence_kind, status, calls FROM history_board_skill_5m ${source !== undefined ? `WHERE source = '${source}'` : ''} ORDER BY bucket_start, source, skill_name, invocation_kind, capability_kind, evidence_kind, status`,
    );
}

async function watermarkRows(db: DbAdapter): Promise<Array<Record<string, unknown>>> {
    return db.queryAll(
        'SELECT table_name, imported_at_watermark, definition_version FROM history_board_rollup_watermark ORDER BY table_name',
    );
}

// --- shared harness (one replay scenario, phased tests below) ------------------

const harness: {
    claudeRoot: string;
    claudeFile: string;
    piRoot: string;
    workDir: string;
    originalDbPath: string;
    replayDbPath: string;
    originalDbBytes: Buffer;
    fixtureBytesBeforeAppend: Buffer;
    ctx: HistoryServiceContext;
    db: DbAdapter;
    fileAppendix: string;
} = {
    claudeRoot: '',
    claudeFile: '',
    piRoot: '',
    workDir: '',
    originalDbPath: '',
    replayDbPath: '',
    originalDbBytes: Buffer.alloc(0),
    fixtureBytesBeforeAppend: Buffer.alloc(0),
    ctx: undefined as unknown as HistoryServiceContext,
    db: undefined as unknown as DbAdapter,
    fileAppendix: '',
};

beforeAll(async () => {
    // Fixture roots: the COMPLETE claude population and the pi sentinel, never ambient.
    const claudeRoot = emptyRoot('claude');
    const claudeFile = join(claudeRoot, 'session-a.jsonl');
    writeFileSync(claudeFile, `${claudeLines().join('\n')}\n`);
    const piRoot = emptyRoot('pi');
    writeFileSync(join(piRoot, 'session-sentinel.jsonl'), `${PI_LINES.join('\n')}\n`);
    harness.claudeRoot = claudeRoot;
    harness.claudeFile = claudeFile;
    harness.piRoot = piRoot;

    // Old-schema fixture database: current schema (spur migrate already adopted, 0050
    // applied) with PRE-UPGRADE data — null-capability skill rows carrying extraction
    // hashes the current mapper no longer reproduces, a checkpoint claiming the current
    // fixture bytes were already imported, a pre-1029 '' rollup sentinel, and v6 rollup
    // watermarks. Composed in a temp FILE db, backed up, and replayed only on the copy.
    const workDir = emptyRoot('db');
    harness.workDir = workDir;
    const originalDbPath = join(workDir, 'original.db');
    const seeded = await createMigratedDb({ url: originalDbPath });

    // (a) pi sentinel rows through the REAL import path (never hand-written).
    const seedCtx: HistoryServiceContext = {
        getDb: () => Promise.resolve(seeded),
        importerVersion: INSTALLED_IMPORTER_VERSION,
        historyHome: emptyRoot('home'),
        cwd: emptyRoot('cwd'),
    };
    const piImport = await new HistoryService(seedCtx).import('pi', { root: piRoot });
    expect(piImport.importedRecords).toBeGreaterThan(0);

    // (b) legacy claude skill evidence + ledger: extraction hashes from the old mapper
    // (invocation_id/capability columns NULL) that current extraction cannot reproduce.
    const sourceFile = realpathSync(claudeFile); // importer persists the resolved realpath
    for (const [hash, line, name] of [
        ['legacy-sc-1', 3, 'sp:dev-verify'],
        ['legacy-sc-2', 6, 'sp:dev-plan'],
        ['legacy-sc-3', 10, 'coder'],
    ] as const) {
        await seeded.run(
            `INSERT INTO history_skill_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, skill_name, invocation_kind, imported_at)
             VALUES (?, 'legacy-msg', 'claude', ?, ?, ?, ?, ?, 'model', '2026-09-01T00:00:00.000Z')`,
            hash,
            sourceFile,
            line,
            SESSION,
            line,
            name,
        );
        await seeded.run(
            `INSERT INTO history_import_ledger (record_hash, source, source_file, source_line, split_index, target_table, imported_at)
             VALUES (?, 'claude', ?, ?, 0, 'history_skill_call', '2026-09-01T00:00:00.000Z')`,
            hash,
            sourceFile,
            line,
        );
    }

    // (c) checkpoint bait: the fixture file claims fully imported at its CURRENT bytes,
    // so a later incremental import must short-circuit and only full mode reprocesses.
    const stat = statSync(claudeFile);
    await seeded.run(
        `INSERT INTO history_import_checkpoint (source, source_file, last_imported_line, updated_at, source_size, source_mtime_ms)
         VALUES ('claude', ?, 15, '2026-09-01T00:00:00.000Z', ?, ?)`,
        sourceFile,
        stat.size,
        stat.mtimeMs,
    );

    // (d) pre-1029 derived state: '' sentinel rollup row + stale v6 watermarks.
    await seeded.run(
        `INSERT INTO history_board_skill_5m (bucket_start, source, skill_name, invocation_kind, capability_kind, evidence_kind, status, calls)
         VALUES ('2026-06-01T09:58:00Z', 'claude', 'legacy-board-row', 'user', '', '', '', 3)`,
    );
    for (const table of ['history_board_message_5m', 'history_board_skill_5m']) {
        await seeded.run(
            `INSERT INTO history_board_rollup_watermark (table_name, imported_at_watermark, definition_version, updated_at)
             VALUES (?, '2026-06-01T09:58:00Z', 'v6', '2026-06-01T10:00:00Z')`,
            table,
        );
    }
    await seeded.run('PRAGMA wal_checkpoint');
    seeded.close();

    // (e) consistent backup + explicit isolated target; the original is never reopened.
    harness.originalDbPath = originalDbPath;
    harness.originalDbBytes = readFileSync(originalDbPath);
    harness.replayDbPath = join(workDir, 'replay.db');
    copyFileSync(originalDbPath, harness.replayDbPath);

    // (f) replay ctx: injected getDb/historyHome/cwd (design §8.4 — never ambient user
    // history) and importer provenance resolved from the installed package.
    const replay = await createMigratedDb({ url: harness.replayDbPath });
    harness.db = replay;
    harness.ctx = {
        getDb: () => Promise.resolve(replay),
        importerVersion: INSTALLED_IMPORTER_VERSION,
        capabilityOrigins: capabilityOrigins(),
        historyHome: emptyRoot('home'),
        cwd: emptyRoot('cwd'),
    };
    harness.fixtureBytesBeforeAppend = readFileSync(claudeFile);
});

// --------------------------------------------------------------------------- //
// Phase 1 — provenance gate (R1): invalid importer provenance fails before writes.
// --------------------------------------------------------------------------- //
describe('history capability replay (1030)', () => {
    test('phase 1: full replay with invalid importer provenance is rejected before any write', async () => {
        let dbOpens = 0;
        const guarded = new HistoryService({
            getDb: () => {
                dbOpens += 1;
                return Promise.resolve(harness.db);
            },
            importerVersion: '0.4.48',
        });
        let caught: unknown;
        try {
            await guarded.import('pi', { mode: 'full', root: harness.piRoot });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(UnsafeHistoryImporterError);
        const err = caught as UnsafeHistoryImporterError;
        expect(err.code).toBe('unsafe-history-importer');
        expect(err.installedVersion).toBe('0.4.48');
        // The rejected write path never reached the database: zero reads, zero writes.
        expect(dbOpens).toBe(0);

        // Dry-run preview of the same run is allowed (guard exempts dryRun) and still
        // mutates nothing: every dump is equal before/after the preview.
        const before = {
            skills: await skillRows(harness.db),
            ledger: await ledgerRows(harness.db),
            checkpoints: await checkpointRows(harness.db),
            messages: await messageRows(harness.db),
            skill5m: await skill5mRows(harness.db),
            watermarks: await watermarkRows(harness.db),
        };
        const preview = await guarded.import('pi', { mode: 'full', root: harness.piRoot, dryRun: true });
        expect(preview.mode).toBe('full');
        expect(dbOpens).toBe(1); // only the preview's read connection
        const after = {
            skills: await skillRows(harness.db),
            ledger: await ledgerRows(harness.db),
            checkpoints: await checkpointRows(harness.db),
            messages: await messageRows(harness.db),
            skill5m: await skill5mRows(harness.db),
            watermarks: await watermarkRows(harness.db),
        };
        expect(after).toEqual(before);
    });

    // ----------------------------------------------------------------------- //
    // Phase 2 — dry-run full replay (R1): previews the upgrade, mutates nothing.
    // ----------------------------------------------------------------------- //
    test('phase 2: dry-run full replay reports the stale set and mutates nothing', async () => {
        const before = {
            skills: await skillRows(harness.db),
            ledger: await ledgerRows(harness.db),
            checkpoints: await checkpointRows(harness.db),
            messages: await messageRows(harness.db),
            skill5m: await skill5mRows(harness.db),
            watermarks: await watermarkRows(harness.db),
        };
        expect(before.skills.filter((r) => r.source === 'claude')).toHaveLength(3); // legacy rows only
        expect(before.skill5m).toHaveLength(1); // '' sentinel only

        const svc = new HistoryService(harness.ctx);
        const result = await svc.import('claude', { root: harness.claudeRoot, mode: 'full', dryRun: true });

        // Reconciliation preview: the three legacy extraction hashes are stale under the
        // current mapper; dry-run reports the exact set a write would retire.
        expect(result.reconciliation).toMatchObject({ staleTargetRows: 3, staleLedgerRows: 3, staleCheckpointRows: 0 });
        expect(result.skippedUnchangedFiles).toBe(0); // full mode never short-circuits

        const after = {
            skills: await skillRows(harness.db),
            ledger: await ledgerRows(harness.db),
            checkpoints: await checkpointRows(harness.db),
            messages: await messageRows(harness.db),
            skill5m: await skill5mRows(harness.db),
            watermarks: await watermarkRows(harness.db),
        };
        expect(after).toEqual(before);
        // Raw fixture bytes untouched.
        expect(readFileSync(harness.claudeFile).equals(harness.fixtureBytesBeforeAppend)).toBe(true);
    });

    // ----------------------------------------------------------------------- //
    // Phase 3 — the upgrade replay (R2): full mode bypasses the incremental
    // short-circuit, retires stale extraction, and the v7 rollup rebuild adopts the
    // classification grain with the frozen 8/3 oracle.
    // ----------------------------------------------------------------------- //
    test('phase 3: incremental short-circuits the unchanged file; full replay upgrades evidence and the 8/3 oracle holds', async () => {
        const svc = new HistoryService(harness.ctx);

        // Incremental ALONE would skip: the checkpoint identity (size, mtime) matches.
        const skipped = await svc.import('claude', { root: harness.claudeRoot, mode: 'incremental' });
        expect(skipped.skippedUnchangedFiles).toBe(1);
        expect(skipped.processedLines).toBe(0);
        expect(skipped.importedRecords).toBe(0);

        // Full replay reprocesses the unchanged file under the new extraction semantics.
        const replay = await svc.import('claude', { root: harness.claudeRoot, mode: 'full' });
        expect(replay.mode).toBe('full');
        expect(replay.reconciliation).toMatchObject({ staleTargetRows: 3, staleLedgerRows: 3, staleCheckpointRows: 0 });
        expect(replay.importedRecords).toBeGreaterThan(0);

        // The stale hashes are gone; the same events now carry new-semantics rows.
        const claude = await skillRows(harness.db, 'claude');
        expect(claude.map((r) => r.record_hash)).not.toContain('legacy-sc-1');
        expect(claude).toHaveLength(10); // 2 requests + 4 loads + 1 dup-pair member + delegation + conflict/null-ts
        const byCall = new Map(claude.map((r) => [r.call_id, r]));
        const l1 = byCall.get('tu-l1');
        expect(l1).toMatchObject({
            skill_name: 'sp:dev-verify',
            capability_kind: 'skill',
            evidence_kind: 'load',
            status: 'ok',
            origin_identity: expect.stringContaining('fixture:skills/sp-dev-verify'),
        });
        const l2 = claude.filter((r) => r.call_id === 'tu-l2');
        expect(l2).toHaveLength(2); // both representations persist…
        expect(new Set(l2.map((r) => r.invocation_id)).size).toBe(1); // …sharing ONE invocation identity
        expect(l2[0]).toMatchObject({ capability_kind: 'command', status: 'ok' });
        expect(byCall.get('tu-del')).toMatchObject({
            skill_name: 'coder',
            capability_kind: 'subagent',
            evidence_kind: 'delegation',
            status: 'ok',
        });
        expect(byCall.get('tu-fail')).toMatchObject({ capability_kind: null, evidence_kind: 'load', status: 'error' });
        const unc = byCall.get('tu-unc');
        expect(unc).toMatchObject({ capability_kind: null, status: 'unknown' });
        // Unbucketed coverage: conflicting origins keep null capability facts; missing
        // timestamp keeps started_at NULL; the bounded finding is reported, not fatal.
        const nullTs = byCall.get('tu-nullts');
        expect(nullTs).toMatchObject({ capability_kind: null, started_at: null, status: 'unknown' });

        // Other-source sentinel untouched by the source-scoped reconciliation.
        const pi = await skillRows(harness.db, 'pi');
        expect(pi).toHaveLength(1);
        expect(pi[0]).toMatchObject({ skill_name: 'sp:dev-sentinel', evidence_kind: 'load', status: 'ok' });

        // Derived-version adoption: refreshHistoryRollups sees the v6 watermarks and
        // full-rebuilds once to v7; the '' sentinel row is retired with the rebuild.
        const refresh = await refreshHistoryRollups(harness.db);
        expect(refresh.status).toBe('refreshed');
        const watermarks = await watermarkRows(harness.db);
        expect(watermarks.length).toBeGreaterThan(0);
        for (const wm of watermarks) expect(wm.definition_version).toBe('v7');
        const skill5m = await skill5mRows(harness.db);
        expect(skill5m.some((r) => r.skill_name === 'legacy-board-row')).toBe(false);

        // THE 8/3 ORACLE (design §8.3, claude population): byCapability totals 8 rows
        // summing to 8; the legacy confirmed-load arrays total 3.
        const claudeBreakdown = await historyBoardSkillBreakdownFromRollup(harness.db, CLAUDE_ONLY, '5m');
        expect(claudeBreakdown.byCapability).toHaveLength(8);
        expect(claudeBreakdown.byCapability.reduce((acc, r) => acc + r.calls, 0)).toBe(8);
        expect(claudeBreakdown.bySkill.reduce((acc, r) => acc + r.calls, 0)).toBe(3);
        expect(claudeBreakdown.bySource).toEqual([{ source: 'claude', calls: 3 }]);
        expect(claudeBreakdown.byInvocationKind).toEqual([{ invocationKind: 'model', calls: 3 }]);
        const classes = claudeBreakdown.byCapability.map(
            (r) => `${r.skillName}/${r.capabilityKind}/${r.invocationKind}/${r.evidenceKind}/${r.status}`,
        );
        expect(classes).toContain('sp:dev-run/command/user/request/unknown');
        expect(classes).toContain('sp:dev-review/command/user/request/unknown');
        expect(classes).toContain('sp:dev-review/command/model/load/ok');
        expect(classes).toContain('coder/subagent/model/delegation/ok');
        expect(classes).toContain('sp:dev-fail/null/model/load/error');
        expect(classes).toContain('sp:dev-unc/null/model/load/unknown');
        expect(classes.filter((c) => c.endsWith('/model/load/ok'))).toHaveLength(3); // verify, review, plan

        // The pi sentinel is visible in the full-corpus read (9 rows / 9 calls / 4 loads).
        const allBreakdown = await historyBoardSkillBreakdownFromRollup(harness.db, ALL, '5m');
        expect(allBreakdown.byCapability).toHaveLength(9);
        expect(allBreakdown.byCapability.reduce((acc, r) => acc + r.calls, 0)).toBe(9);
        expect(allBreakdown.bySkill.reduce((acc, r) => acc + r.calls, 0)).toBe(4);
        expect(allBreakdown.byCapability.some((r) => r.skillName === 'sp:dev-sentinel')).toBe(true);

        // Filtered window: partitioned selector equals the same reference subset.
        const window = await historyBoardSkillBreakdownFromRollup(
            harness.db,
            { ...CLAUDE_ONLY, since: '2026-05-30T00:02:59Z' },
            '5m',
        );
        expect(window.byCapability).toHaveLength(3); // delegation + error + unknown only
        expect(window.byCapability.reduce((acc, r) => acc + r.calls, 0)).toBe(3);
        expect(window.bySkill).toEqual([]); // no confirmed loads after 00:03

        // The original database copy was never touched by any of this.
        expect(readFileSync(harness.originalDbPath).equals(harness.originalDbBytes)).toBe(true);
    });

    // ----------------------------------------------------------------------- //
    // Phase 4 — repeatability (R3): a second full replay is a no-op with stable
    // identities, counts, statuses, provenance and derived rows.
    // ----------------------------------------------------------------------- //
    test('phase 4: second full replay preserves identities, counts and materialized rows', async () => {
        const before = {
            skills: await skillRows(harness.db),
            ledger: await ledgerRows(harness.db),
            messages: await messageRows(harness.db),
            skill5m: await skill5mRows(harness.db),
        };
        const beforeFreshness = await refreshHistoryRollups(harness.db);
        expect(beforeFreshness.status).toBe('unchanged');

        const svc = new HistoryService(harness.ctx);
        const replay = await svc.import('claude', { root: harness.claudeRoot, mode: 'full' });
        expect(replay.reconciliation).toMatchObject({ staleTargetRows: 0, staleLedgerRows: 0, staleCheckpointRows: 0 });
        expect(replay.skippedDuplicates).toBeGreaterThan(0); // extraction is stable: nothing re-inserted

        expect(await skillRows(harness.db)).toEqual(before.skills);
        expect(await ledgerRows(harness.db)).toEqual(before.ledger);
        expect(await messageRows(harness.db)).toEqual(before.messages);
        // The oracle still holds after the repeat replay.
        const claudeBreakdown = await historyBoardSkillBreakdownFromRollup(harness.db, CLAUDE_ONLY, '5m');
        expect(claudeBreakdown.byCapability).toHaveLength(8);
        expect(claudeBreakdown.byCapability.reduce((acc, r) => acc + r.calls, 0)).toBe(8);
        expect(claudeBreakdown.bySkill.reduce((acc, r) => acc + r.calls, 0)).toBe(3);
    });

    // ----------------------------------------------------------------------- //
    // Phase 5 — cross-run late arrival: a producer outcome lands during a LATER
    // incremental import (after the event's bucket was already materialized) and
    // must flip the ORIGINAL bucket; a distinct same-name repeat call stays separate
    // (both predecessor contracts: 1028 source pairing + 1029 bucket repair).
    // ----------------------------------------------------------------------- //
    test('phase 5: late result updates the original bucket; distinct same-name repeat stays separate', async () => {
        const svc = new HistoryService(harness.ctx);
        const claudeBefore = await skillRows(harness.db, 'claude');
        const uncBefore = claudeBefore.find((r) => r.call_id === 'tu-unc');
        expect(uncBefore).toMatchObject({ status: 'unknown' });
        const l1Invocation = claudeBefore.find((r) => r.call_id === 'tu-l1')?.invocation_id;

        // Append: the tu-unc outcome (40 minutes after its own bucket) and a NEW
        // same-name invocation with its own result.
        const appendix = [
            JSON.stringify({
                type: 'user',
                sessionId: SESSION,
                timestamp: '2026-05-30T00:44:05.000Z',
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'tu-unc', content: 'loaded late' }],
                },
            }),
            JSON.stringify({
                type: 'assistant',
                sessionId: SESSION,
                ts: '2026-05-30T00:45:00.000Z',
                message: {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 'tu-again', name: 'Skill', input: { skill: 'sp:dev-verify' } }],
                },
            }),
            JSON.stringify({
                type: 'user',
                sessionId: SESSION,
                timestamp: '2026-05-30T00:45:05.000Z',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-again', content: 'ok' }] },
            }),
        ];
        harness.fileAppendix = `${appendix.join('\n')}\n`;
        writeFileSync(
            harness.claudeFile,
            Buffer.concat([harness.fixtureBytesBeforeAppend, Buffer.from(harness.fileAppendix, 'utf8')]),
        );

        const incremental = await svc.import('claude', { root: harness.claudeRoot, mode: 'incremental' });
        expect(incremental.skippedUnchangedFiles).toBe(0); // the append invalidates identity
        expect(incremental.processedLines).toBe(3); // resume reads ONLY the appended lines

        // 1028 contract: same event upgraded IN PLACE — stable record identity, new outcome.
        const claude = await skillRows(harness.db, 'claude');
        const uncAfter = claude.find((r) => r.call_id === 'tu-unc');
        expect(uncAfter?.record_hash).toBe(uncBefore?.record_hash);
        expect(uncAfter?.invocation_id).toBe(uncBefore?.invocation_id);
        expect(uncAfter?.status).toBe('ok');
        expect(uncAfter?.completed_at ?? '').toContain('2026-05-30T00:44:05');
        // Distinct same-name invocation: own identity, not a collapse of tu-l1.
        const again = claude.find((r) => r.call_id === 'tu-again');
        expect(again).toBeDefined();
        expect(again?.invocation_id).not.toBeNull();
        expect(again?.invocation_id).not.toBe(l1Invocation);
        expect(again).toMatchObject({ skill_name: 'sp:dev-verify', capability_kind: 'skill', status: 'ok' });

        // 1029 contract: the ORIGINAL bucket (00:04) materializes the new outcome; the
        // result's own bucket (00:44) carries no skill evidence.
        await refreshHistoryRollups(harness.db);
        const buckets = await harness.db.queryAll<Record<string, unknown>>(
            `SELECT bucket_start, capability_kind, evidence_kind, status, calls
             FROM history_board_skill_5m WHERE source='claude' AND skill_name='sp:dev-unc'`,
        );
        expect(buckets).toHaveLength(1);
        expect(buckets[0]).toMatchObject({
            bucket_start: '2026-05-30T00:04:00Z',
            evidence_kind: 'load',
            status: 'ok',
            calls: 1,
        });
        const lateResultBuckets = await harness.db.queryAll<Record<string, unknown>>(
            "SELECT COUNT(*) AS n FROM history_board_skill_5m WHERE source='claude' AND bucket_start='2026-05-30T00:44:00Z'",
        );
        expect(lateResultBuckets[0]?.n).toBe(0);

        // Counts: the class gains the repeat call (calls 2 in ONE row), totals 8 rows / 9 calls.
        const claudeBreakdown = await historyBoardSkillBreakdownFromRollup(harness.db, CLAUDE_ONLY, '5m');
        expect(claudeBreakdown.byCapability).toHaveLength(8);
        expect(claudeBreakdown.byCapability.reduce((acc, r) => acc + r.calls, 0)).toBe(9);
        const verifyClass = claudeBreakdown.byCapability.find((r) => r.skillName === 'sp:dev-verify');
        expect(verifyClass).toMatchObject({ capabilityKind: 'skill', evidenceKind: 'load', status: 'ok', calls: 2 });
        expect(claudeBreakdown.bySkill).toEqual([
            { skillName: 'sp:dev-verify', calls: 2 },
            { skillName: 'sp:dev-plan', calls: 1 },
            { skillName: 'sp:dev-review', calls: 1 },
            { skillName: 'sp:dev-unc', calls: 1 },
        ]);
    });

    // ----------------------------------------------------------------------- //
    // Phase 6 — unchanged-file skip + materialized-vs-SQL reference (R3).
    // ----------------------------------------------------------------------- //
    test('phase 6: unchanged incremental re-import skips everything and materialized rows equal the direct SQL reference', async () => {
        const svc = new HistoryService(harness.ctx);
        const before = {
            skills: await skillRows(harness.db),
            ledger: await ledgerRows(harness.db),
            checkpoints: await checkpointRows(harness.db),
            messages: await messageRows(harness.db),
            skill5m: await skill5mRows(harness.db),
        };

        // After phase 5's late-arrival run the checkpoint identity is NULL again (the
        // per-line upsert's fail-open shape, 0678), so this run line-count-resumes the
        // unchanged file instead of identity-skipping it — and still changes nothing.
        const again = await svc.import('claude', { root: harness.claudeRoot, mode: 'incremental' });
        expect(again.processedLines).toBe(0);
        expect(again.importedRecords).toBe(0);
        expect(await skillRows(harness.db)).toEqual(before.skills);
        expect(await ledgerRows(harness.db)).toEqual(before.ledger);
        expect(await messageRows(harness.db)).toEqual(before.messages);
        expect(await skill5mRows(harness.db)).toEqual(before.skill5m);
        expect(await checkpointRows(harness.db)).toEqual(before.checkpoints);

        // Direct SQL reference: the domain rep-selection rule (SKILL_ROLLUP_REP_SQL)
        // evaluated over the source table must reproduce every materialized claude row.
        const reference = await harness.db.queryAll<Record<string, string | number>>(`
            WITH scoped AS (
                SELECT record_hash, source, skill_name, session_id, invocation_kind, started_at, status,
                       COALESCE(NULLIF(invocation_id, ''), 'h:' || record_hash) AS invocation_key,
                       COALESCE(capability_kind, '') AS capability_kind,
                       COALESCE(evidence_kind, '') AS evidence_kind
                FROM history_skill_call
                WHERE started_at IS NOT NULL AND source = 'claude'
            ),
            repped AS (
                SELECT scoped.*,
                       ROW_NUMBER() OVER (
                           PARTITION BY scoped.source, scoped.session_id, scoped.invocation_key,
                                        scoped.invocation_kind, scoped.capability_kind, scoped.evidence_kind
                           ORDER BY scoped.started_at ASC, scoped.record_hash ASC
                       ) AS rep_rank,
                       CASE
                           WHEN SUM(scoped.status = 'ok') OVER (
                                    PARTITION BY scoped.source, scoped.session_id, scoped.invocation_key,
                                                 scoped.invocation_kind, scoped.capability_kind, scoped.evidence_kind
                                ) > 0 THEN 'ok'
                           WHEN SUM(scoped.status = 'error') OVER (
                                    PARTITION BY scoped.source, scoped.session_id, scoped.invocation_key,
                                                 scoped.invocation_kind, scoped.capability_kind, scoped.evidence_kind
                                ) > 0 THEN 'error'
                           ELSE 'unknown'
                       END AS class_status
                FROM scoped
            )
            SELECT strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', started_at) / 60 * 60 AS INTEGER), 'unixepoch') AS bucket_start,
                   source, skill_name, invocation_kind, capability_kind, evidence_kind, class_status AS status,
                   COUNT(*) AS calls
            FROM repped
            WHERE rep_rank = 1
            GROUP BY bucket_start, source, skill_name, invocation_kind, capability_kind, evidence_kind, status
       `);
        const byClass = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
            ['bucket_start', 'source', 'skill_name', 'invocation_kind', 'capability_kind', 'evidence_kind', 'status']
                .map((key) => String(a[key]).localeCompare(String(b[key])))
                .find((cmp) => cmp !== 0) ?? 0;
        expect([...(await skill5mRows(harness.db, 'claude'))].sort(byClass)).toEqual([...reference].sort(byClass));

        // The null-timestamp conflicting-origin row is source-visible but unbucketed.
        const nullTs = (await skillRows(harness.db, 'claude')).filter((r) => r.call_id === 'tu-nullts');
        expect(nullTs).toHaveLength(1);
        expect(nullTs[0]?.started_at).toBeNull();
        expect(reference.some((r) => r.skill_name === 'sp:dev-conflict')).toBe(false);

        // Everything preserved: pi sentinel, original fixture bytes (append-only prefix),
        // and the original database file byte-for-byte.
        const pi = await skillRows(harness.db, 'pi');
        expect(pi).toHaveLength(1);
        expect(
            readFileSync(harness.claudeFile)
                .subarray(0, harness.fixtureBytesBeforeAppend.length)
                .equals(harness.fixtureBytesBeforeAppend),
        ).toBe(true);
        expect(readFileSync(harness.originalDbPath).equals(harness.originalDbBytes)).toBe(true);
    });

    afterAll(() => {
        rmSync(harness.claudeRoot, { recursive: true, force: true });
        rmSync(harness.piRoot, { recursive: true, force: true });
        harness.db?.close();
        rmSync(harness.workDir, { recursive: true, force: true });
    });
});
