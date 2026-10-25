/**
 * Fixture-replay child for the Codex App Server driver (task 1278). Speaks the captured JSONL
 * dialect across a real process boundary. Native thread and turn ids are replayed verbatim.
 *
 * `argv[2]` selects the scenario. The segment after an interrupt response is held until the
 * parent sends `turn/interrupt`, except `interrupted`, which emits the native completion at once.
 */
import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

type Row = Record<string, unknown> & { id?: string | number; method?: string; result?: unknown; params?: unknown };

const scenario = process.argv[2] ?? 'plain';
const fixtureName =
    scenario === 'failed'
        ? 'failed-turn.jsonl'
        : scenario === 'interrupted' || scenario === 'cancel'
          ? 'interrupted-turn.jsonl'
          : 'success-two-turns.jsonl';
const immediate = scenario === 'interrupted';
const rows: Row[] = readFileSync(join(import.meta.dir, fixtureName), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Row);

const emit = (row: Row): void => {
    writeSync(1, `${JSON.stringify(row)}\n`);
};

const turnStatus = (row: Row): string | undefined =>
    (
        (row.result as { turn?: { status?: string } } | undefined)?.turn ??
        (row.params as { turn?: { status?: string } } | undefined)?.turn
    )?.status;

/** A turn-start response carries a `result.turn`; the thread response (id 2) shares a result shape. */
const isTurnStart = (row: Row): boolean => row.method === undefined && turnStatus(row) === 'inProgress' && row.id !== 2;
/** The interrupt response is the only id-carrying row with an empty result. */
const isInterruptResponse = (row: Row): boolean =>
    row.method === undefined && row.result !== undefined && Object.keys(row.result as object).length === 0;

const firstTurn = rows.findIndex(isTurnStart);
const bootstrap = rows.slice(0, firstTurn);
const segments: Row[][] = [];
for (const row of rows.slice(firstTurn)) {
    if (isTurnStart(row)) segments.push([row]);
    else segments.at(-1)?.push(row);
}

let turnIndex = 0;
let pending: Row[] = [];

const artifactOf = (frame: Row): string | undefined => {
    const input = (frame.params as { input?: { text?: string }[] } | undefined)?.input;
    const text = input?.[0]?.text ?? '';
    return /^REPLAY_ARTIFACT (.+)$/m.exec(text)?.[1];
};

const serve = (frame: Row): void => {
    if (frame.method === 'turn/start') {
        const segment = segments[turnIndex] ?? [];
        turnIndex += 1;
        const artifact = artifactOf(frame);
        if (artifact !== undefined && !(scenario === 'missing-artifact' && turnIndex === 2)) {
            writeFileSync(artifact, turnIndex === 1 ? 'alpha' : 'beta');
        }
        if (scenario === 'exit-after-accept') {
            const acceptance = segment[0];
            if (acceptance !== undefined) emit({ ...acceptance, id: frame.id });
            process.exit(0);
        }
        const splitAt = immediate ? -1 : Math.max(segment.findIndex(isInterruptResponse), -1);
        const head = splitAt === -1 ? segment : segment.slice(0, splitAt);
        pending = splitAt === -1 ? [] : segment.slice(splitAt);
        head.forEach((row, index) => {
            emit(index === 0 ? { ...row, id: frame.id } : row);
        });
        return;
    }
    if (frame.method === 'turn/interrupt') {
        for (const row of pending) emit(isInterruptResponse(row) ? { ...row, id: frame.id } : row);
        pending = [];
        return;
    }
    for (const row of bootstrap) {
        if (row.method !== undefined) emit(row);
        else if (frame.method === 'initialize' && row.id === 1) emit({ ...row, id: frame.id });
        else if ((frame.method === 'thread/start' || frame.method === 'thread/resume') && row.id === 2) {
            emit({ ...row, id: frame.id });
        }
    }
};

createInterface({ input: process.stdin }).on('line', (line) => {
    if (line.trim() === '') return;
    try {
        serve(JSON.parse(line) as Row);
    } catch {
        // Malformed parent frame: nothing to serve.
    }
});
