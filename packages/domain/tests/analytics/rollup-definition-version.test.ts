import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter, type DbBatchOp } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import {
    type HistoryBoardRollupSeed,
    refreshHistoryBoardRollupsIncremental,
    replaceHistoryBoardRollups,
} from '../../src/analytics/history-board-rollup';
import { ROLLUP_DEFINITION_VERSION } from '../../src/analytics/rollup-watermark';
import { applyCliMigrations } from '../../src/migrations';

/**
 * Digest of the rollup derivation, pinned per definition version (0741 R6).
 *
 * `ROLLUP_DEFINITION_VERSION` exists so that a change in how a mart is derived forces a
 * rebuild instead of an extend-from-watermark. Nothing enforced the bump: the version is a
 * hand-maintained constant, so a derivation edit shipped without touching it left every
 * existing database extending v_old rows with v_new semantics. This digest closes that —
 * change the derivation and this test fails until the version is bumped and re-pinned.
 *
 * To update after a deliberate derivation change: bump `ROLLUP_DEFINITION_VERSION`, run this
 * test, and add the reported digest under the new key. Keep old entries; they document which
 * derivation each shipped version denotes. Re-pinning an existing key instead of bumping is
 * legitimate only while that version is unreleased — once a database has materialized rows under
 * a version, that version's digest is frozen.
 */
const PINNED_DERIVATION_DIGEST: Record<string, string> = {
    v2: '21a1ee94980403313e5795dab6140c7883574aa51b4695524f0f3893022da9c1',
};

const EMPTY_SEED: HistoryBoardRollupSeed = {
    historyVersion: 'v2:digest-fixture',
    messageRows: [],
    toolRows: [],
    loopRows: [],
    sourceRows: [],
    tokenSteps: [],
    durationSteps: [],
    cacheWasteSteps: [],
};

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    await applyCliMigrations(adapter);
    return adapter;
}

/** Enough rows that every bucket-level derivation in the incremental path is emitted. */
async function seedCorpus(db: DbAdapter): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, role,
             record_type, disposition, provenance, ts, model, input_tokens, cache_read_tokens, cache_write_tokens,
             output_tokens, duration_ms, imported_at)
         VALUES ('m1','claude','a.jsonl',1,'s1',1,'assistant','message','conversation','agent',
             '2026-06-01T10:00:00Z','claude-opus-5', 10, 5, 2, 20, 900, '2026-06-01T11:00:00Z')`,
    );
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line, session_id,
             seq, tool_name, effective_tool_name, status, imported_at)
         VALUES ('t1','m1','claude','a.jsonl',2,'s1',1,'Bash','Bash','success','2026-06-01T11:00:00Z')`,
    );
    await db.run(
        `INSERT INTO history_skill_call (record_hash, message_hash, source, source_file, source_line, session_id,
             seq, skill_name, invocation_kind, started_at, imported_at)
         VALUES ('k1','m1','claude','a.jsonl',3,'s1',1,'sp:spur-dev','model','2026-06-01T10:00:00Z',
             '2026-06-01T11:00:00Z')`,
    );
    // A NULL-ts row so the sentinel-bucket branch of the message filter participates too.
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, role,
             record_type, disposition, provenance, ts, model, input_tokens, output_tokens, imported_at)
         VALUES ('m0','claude','a.jsonl',9,'s1',9,'assistant','message','conversation','agent',
             NULL,'claude-opus-5',3,4,'2026-06-01T11:00:00Z')`,
    );
    // A non-empty alias map so the alias seam participates in the derivation digest (0739 R7).
    await db.run(
        "INSERT INTO history_tool_alias_map (source, effective_tool_name, alias) VALUES ('claude','Bash','shell')",
    );
}

/**
 * Record every statement a refresh issues, with its interpolated constants already resolved —
 * so a change inside a shared SQL fragment (`ALIASED_TOOL_NAME_SQL`, `MESSAGE_DEDUP`, a bucket
 * expression) moves the digest exactly like an edit to the insert itself.
 */
function recordingAdapter(db: DbAdapter, sink: string[]): DbAdapter {
    return new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') {
                return value;
            }
            return (...args: unknown[]) => {
                if (prop === 'batch') {
                    for (const op of args[0] as DbBatchOp[]) {
                        sink.push(op.sql);
                    }
                } else if ((prop === 'run' || prop === 'exec') && typeof args[0] === 'string') {
                    sink.push(args[0]);
                }
                return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
        },
    }) as DbAdapter;
}

/**
 * Whitespace and placeholder-run normalization keeps the digest a function of the derivation
 * alone — not of reformatting, and not of how many rows the fixture happens to bind.
 */
function normalize(sql: string): string {
    return sql
        .replace(/\s+/g, ' ')
        .replace(/\?(\s*,\s*\?)+/g, '?')
        .trim();
}

async function derivationDigest(): Promise<string> {
    const db = await setup();
    await seedCorpus(db);
    const sink: string[] = [];
    const recorder = recordingAdapter(db, sink);

    await replaceHistoryBoardRollups(recorder, EMPTY_SEED);
    // Import a second bucket so the incremental path emits its bucket-level derivations too.
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, role,
             record_type, disposition, provenance, ts, model, input_tokens, output_tokens, imported_at)
         VALUES ('m2','codex','b.jsonl',1,'s2',1,'assistant','message','conversation','agent',
             '2026-06-02T10:00:00Z','gpt-5.6',7,9,'2026-06-02T11:00:00Z')`,
    );
    await refreshHistoryBoardRollupsIncremental(recorder);
    db.close();

    const statements = [...new Set(sink.map(normalize))].sort();
    const hasher = new Bun.CryptoHasher('sha256');
    for (const statement of statements) {
        hasher.update(`${statement}\n`);
    }
    return hasher.digest('hex');
}

describe('rollup definition version (0741 R6)', () => {
    test('a derivation change without a version bump fails', async () => {
        const digest = await derivationDigest();
        const pinned = PINNED_DERIVATION_DIGEST[ROLLUP_DEFINITION_VERSION];

        expect(
            pinned,
            `ROLLUP_DEFINITION_VERSION is "${ROLLUP_DEFINITION_VERSION}" with no pinned digest. ` +
                `Add "${ROLLUP_DEFINITION_VERSION}": '${digest}' to PINNED_DERIVATION_DIGEST.`,
        ).toBeDefined();
        expect(
            digest,
            `The rollup derivation changed under definition version "${ROLLUP_DEFINITION_VERSION}". ` +
                'Existing databases would extend their materialized rows under the old derivation. ' +
                'Bump ROLLUP_DEFINITION_VERSION and pin the new digest.',
        ).toBe(pinned ?? '<unpinned>');
    });

    test('the digest tracks the derivation, not the corpus', async () => {
        // Two runs over independently built fixtures agree: the digest is a property of the SQL.
        expect(await derivationDigest()).toBe(await derivationDigest());
    });
});
