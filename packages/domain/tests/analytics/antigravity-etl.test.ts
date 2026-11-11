import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    AGY_USAGE_UNAVAILABLE_DISPOSITION,
    type AntigravityUsageRecord,
    collapsePollDuplicates,
    enrichAntigravityToolArgs,
    enrichAntigravityUsage,
    POLL_DUPLICATE_DISPOSITION,
    repairEmptyArgDigests,
} from '../../src/analytics/antigravity-etl';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import { bySession, loops } from '../../src/analytics/forensic-query';
import { applyCliMigrations } from '../../src/migrations';

/**
 * Task 1324 (feature D, R2/R3) — antigravity capture fidelity. Fixture DBs carry an
 * agy-shaped import result: assistant steps with zero usage/model capture and tool rows
 * whose args are absent or empty-digested, plus the 3,455-near-identical-poll-message
 * shape condensed to a few rows. The ETL must populate model/usage/args with an explicit
 * unavailable disposition (never empty strings) and collapse verbatim consecutive
 * assistant duplicates out of the loop and latency denominators.
 */

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

/** Insert one agy message row the way the external importer's mapper writes it: NULL usage. */
async function insertAgyMessage(
    db: DbAdapter,
    recordHash: string,
    sessionId: string,
    seq: number,
    text: string | null,
    role = 'assistant',
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line,
                                      session_id, seq, role, record_type, disposition, ts, content_text,
                                      provenance, imported_at)
         VALUES (?, 'agy', 'brain/sess.jsonl', ?, ?, ?, ?, 'PLANNER_RESPONSE', 'keep',
                 '2026-11-10T10:00:00.000Z', ?, 'ambient', '2026-11-10T10:05:00.000Z')`,
        recordHash,
        seq,
        sessionId,
        seq,
        role,
        text,
    );
}

async function insertAgyToolCall(
    db: DbAdapter,
    recordHash: string,
    messageHash: string,
    sessionId: string,
    seq: number,
    toolName: string,
    argsDigest: string | null,
): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                                        session_id, seq, tool_name, call_id, args_digest, args_raw,
                                        status, imported_at)
         VALUES (?, ?, 'agy', 'brain/sess.jsonl', ?, ?, ?, ?, NULL, ?, NULL,
                 'ok', '2026-11-10T10:05:00.000Z')`,
        recordHash,
        messageHash,
        seq,
        sessionId,
        seq,
        toolName,
        argsDigest,
    );
}

describe('antigravity ETL (task 1324 R2/R3)', () => {
    test('enrichAntigravityUsage fills model/usage/cost and marks the remainder explicitly unavailable', async () => {
        const db = await setup();
        // Three agy assistant steps, two with vendor usage facts, one the vendor never attributed.
        await insertAgyMessage(db, 'agy_m1', 'sessA', 1, 'plan step one');
        await insertAgyMessage(db, 'agy_m2', 'sessA', 2, 'plan step two');
        await insertAgyMessage(db, 'agy_m3', 'sessA', 3, 'awaiting completion');
        const usage: AntigravityUsageRecord[] = [
            { sessionId: 'sessA', model: 'claude-sonnet-4-5', inputTokens: 1000, outputTokens: 200 },
            { sessionId: 'sessA', model: 'claude-sonnet-4-5', inputTokens: 1500, outputTokens: 300 },
        ];
        const result = await enrichAntigravityUsage(db, usage);
        expect(result.messagesEnriched).toBe(2);
        expect(result.messagesUnavailable).toBe(1);

        const enriched = await db.queryFirst<{
            model: string;
            input_tokens: number;
            cost_usd: number | null;
            disposition: string;
        }>('SELECT model, input_tokens, cost_usd, disposition FROM history_message WHERE record_hash = ?', 'agy_m1');
        expect(enriched?.model).toBe('claude-sonnet-4-5');
        expect(enriched?.input_tokens).toBe(1000);
        // Cost derivable from the shared pricing table — never 0-fabricated, never ''.
        expect(enriched?.cost_usd).toBeGreaterThan(0);
        expect(enriched?.disposition).toBe('keep');

        const unavailable = await db.queryFirst<{
            model: string | null;
            input_tokens: number | null;
            disposition: string;
        }>('SELECT model, input_tokens, disposition FROM history_message WHERE record_hash = ?', 'agy_m3');
        expect(unavailable?.model).toBeNull(); // explicit NULL — never an empty string
        expect(unavailable?.input_tokens).toBeNull();
        expect(unavailable?.disposition).toBe(AGY_USAGE_UNAVAILABLE_DISPOSITION);

        // Idempotent: a second pass changes nothing.
        const again = await enrichAntigravityUsage(db, usage);
        expect(again.messagesEnriched).toBe(0);
        expect(again.messagesUnavailable).toBe(0);
        db.close();
    });

    test('enrichAntigravityToolArgs back-fills args_raw/digest and repairEmptyArgDigests nulls empty digests', async () => {
        const db = await setup();
        await insertAgyMessage(db, 'agy_t1', 'sessT', 1, 'step');
        await insertAgyToolCall(db, 'agy_tc1', 'agy_t1', 'sessT', 1, 'run_command', null);
        await insertAgyToolCall(db, 'agy_tc2', 'agy_t1', 'sessT', 2, 'grep_search', ''); // empty-digest false-fire root cause

        const backfilled = await enrichAntigravityToolArgs(db, [
            { sessionId: 'sessT', seq: 1, toolName: 'run_command', args: { command: 'bun test' } },
        ]);
        expect(backfilled).toBe(1);
        const row = await db.queryFirst<{ args_raw: string; args_digest: string }>(
            'SELECT args_raw, args_digest FROM history_tool_call WHERE record_hash = ?',
            'agy_tc1',
        );
        expect(row?.args_raw).toBe('{"command":"bun test"}');
        expect(row?.args_digest?.length).toBe(64);

        expect(await repairEmptyArgDigests(db)).toBe(1);
        const repaired = await db.queryFirst<{ args_digest: string | null }>(
            'SELECT args_digest FROM history_tool_call WHERE record_hash = ?',
            'agy_tc2',
        );
        expect(repaired?.args_digest).toBeNull(); // explicit unavailable, loop query excludes NULL
        db.close();
    });

    test('collapsePollDuplicates collapses verbatim consecutive assistant messages and aggregators exclude them', async () => {
        const db = await setup();
        // Poll loop: 4 verbatim repeats; a distinct later message must survive.
        for (let i = 1; i <= 4; i++) await insertAgyMessage(db, `poll_${i}`, 'sessP', i, 'awaiting completion');
        await insertAgyMessage(db, 'poll_5', 'sessP', 5, 'final answer');
        // Tool calls riding two of the poll duplicates would have loop-fired on repeated digests.
        await insertAgyToolCall(db, 'poll_tc1', 'poll_2', 'sessP', 2, 'view_file', 'digest-x');
        await insertAgyToolCall(db, 'poll_tc2', 'poll_3', 'sessP', 3, 'view_file', 'digest-x');
        await insertAgyToolCall(db, 'poll_tc3', 'poll_4', 'sessP', 4, 'view_file', 'digest-x');

        const collapse = await collapsePollDuplicates(db);
        expect(collapse.sessions).toBe(1);
        expect(collapse.duplicatesMarked).toBe(3); // first of the run stays

        const kept = await db.queryAll<{ record_hash: string; disposition: string }>(
            "SELECT record_hash, disposition FROM history_message WHERE session_id = 'sessP' ORDER BY seq",
        );
        expect(kept.map((r) => r.disposition)).toEqual([
            'keep',
            POLL_DUPLICATE_DISPOSITION,
            POLL_DUPLICATE_DISPOSITION,
            POLL_DUPLICATE_DISPOSITION,
            'keep',
        ]);

        // Idempotent second pass.
        expect(await collapsePollDuplicates(db)).toEqual({ sessions: 0, duplicatesMarked: 0 });

        // Loop findings exclude calls whose parent message was collapsed (would be repeats=3).
        const findings = await loops(db, emptySelector());
        expect(findings).toEqual([]);

        // Latency denominator (bySession last-message + assistant-duration sums) excludes duplicates.
        const sessions = await bySession(db, emptySelector(), 10);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.assistantDurationUnmeasured).toBe(2); // only the two kept rows
        expect(sessions[0]?.messages).toBe(5); // token/message census unchanged — collapse is disposition-only
        db.close();
    });
});

/** Selector with no predicate — every fixture row is in scope. */
function emptySelector(): ArtifactSelector {
    return {
        since: null,
        until: null,
        sources: null,
        sessionId: null,
        runId: null,
        taskWbs: null,
    };
}
