/** Compile the standalone server through the shared native DB bundling facade. */
import { fileURLToPath } from 'node:url';
import { buildCompiledBinary } from './build-cli';

export async function buildServer(): Promise<void> {
    await buildCompiledBinary(
        fileURLToPath(new URL('../../apps/server/src/index.ts', import.meta.url)),
        fileURLToPath(new URL('../../dist/server/spur-server', import.meta.url)),
    );
}
