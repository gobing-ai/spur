/** Captured Pi RPC replay; fault injection is explicitly separate from captured record shapes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const scenario = process.argv[2];
const lines = readFileSync(join(import.meta.dir, 'success-two-turns.jsonl'), 'utf8')
    .trim()
    .split('\n');
const groups: string[][] = [];
const prelude: string[] = [];
for (const line of lines) {
    const record = JSON.parse(line) as { type: string; command?: string };
    if (record.type === 'response' && record.command === 'prompt') groups.push([]);
    const group = groups.at(-1);
    if (group === undefined) prelude.push(line);
    else group.push(line);
}
setTimeout(() => process.stdout.write(`${prelude.join('\n')}\n`), 10);
let served = 0;
const input = createInterface({ input: process.stdin });
async function replay(line: string): Promise<void> {
    const command = JSON.parse(line) as { type: string; id: string; message: string };
    if (command.type !== 'prompt' || !command.id || typeof command.message !== 'string') {
        throw new Error('Expected a correlated Pi prompt command');
    }
    const group = groups[served++];
    if (group === undefined) throw new Error('More turns than the recorded Pi capture');
    for (const captured of group) {
        const record = JSON.parse(captured) as { type: string; command?: string; id?: string };
        if (record.type === 'response' && record.command === 'prompt') record.id = command.id;
        if (record.type === 'response' && scenario === 'rejected') {
            process.stdout.write(`${JSON.stringify({ ...record, success: false, error: 'injected rejection' })}\n`);
            return;
        }
        // agent_end alone is deliberately replayed before exit: it is NOT agent_settled.
        if (record.type === 'agent_settled' && scenario === 'accepted-exit') process.exit(0);
        if (record.type === 'agent_settled') {
            const artifact = /^REPLAY_ARTIFACT (.+)$/m.exec(command.message)?.[1];
            if (artifact !== undefined && !(scenario === 'missing-artifact' && served === 2)) {
                writeFileSync(artifact, served === 1 ? 'alpha' : 'beta');
            }
        }
        const output = `${JSON.stringify(record)}\n`;
        if (scenario === 'fragmented') {
            // Replay captured extension noise between records, then split each record across writes.
            process.stdout.write(`${prelude[0]}\n`);
            const split = Math.floor(output.length / 2);
            process.stdout.write(output.slice(0, split));
            await Bun.sleep(2);
            process.stdout.write(output.slice(split));
        } else process.stdout.write(output);
        if (scenario === 'malformed' && record.type === 'response') {
            process.stdout.write('malformed JSON {\n');
            return;
        }
    }
}
// Finish post-terminal noise before reading the next command, even when writes are fragmented.
let pending = Promise.resolve();
input.on('line', (line) => {
    pending = pending.then(() => replay(line));
});
input.on('close', () => process.exit(0));
