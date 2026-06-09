import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandOutput } from '../src/output';

/** Captured command output for CLI tests. */
export interface CapturedOutput extends CommandOutput {
    messages: string[];
    errors: string[];
}

/** Create a temporary project directory with a package manifest. */
export async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-'));
    await Bun.write(join(dir, 'package.json'), `${JSON.stringify({ name: 'fixture', type: 'module' }, null, 2)}\n`);
    return dir;
}

/** Create an output sink that stores writes for assertions. */
export function createCapturedOutput(): CapturedOutput {
    return {
        messages: [],
        errors: [],
        write(message: string): void {
            this.messages.push(message);
        },
        error(message: string): void {
            this.errors.push(message);
        },
    };
}
