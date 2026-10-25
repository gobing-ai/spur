/** Replay the recorded Claude turns across real stdin/stdout; never invoke a model. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const lines = readFileSync(join(import.meta.dir, 'success-two-turns.jsonl'), 'utf8')
    .trim()
    .split('\n');
const firstInit = lines.findIndex((line) => {
    const record = JSON.parse(line) as { type: string; subtype?: string };
    return record.type === 'system' && record.subtype === 'init';
});
if (firstInit < 0) throw new Error('Claude replay fixture has no init boundary');
const prelude = lines.slice(0, firstInit);
const groups: string[][] = [];
for (const line of lines.slice(firstInit)) {
    const record = JSON.parse(line) as { type: string; subtype?: string };
    if (record.type === 'system' && record.subtype === 'init') groups.push([]);
    groups.at(-1)?.push(line);
}

// Yield once before emitting the handshake: Bun may buffer synchronous startup writes to a pipe.
setTimeout(() => {
    for (const line of prelude) process.stdout.write(`${line}\n`);
}, 10);

let served = 0;
const queue: string[] = [];
const pump = setInterval(() => {
    const line = queue.shift();
    if (line !== undefined) process.stdout.write(`${line}\n`);
}, 10);
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
    const record = JSON.parse(line) as { type: string; message?: { role: string; content: unknown[] } };
    if (record.type !== 'user' || record.message?.role !== 'user' || !Array.isArray(record.message.content)) {
        throw new Error('Expected the registered Claude driver to encode a user message');
    }
    const group = groups[served++];
    if (group === undefined) throw new Error('Claude replay received more turns than the capture contains');
    queue.push(...group);
});
input.on('close', () => {
    clearInterval(pump);
    process.exit(0);
});
