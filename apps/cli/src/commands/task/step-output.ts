import type { CommandOutput } from '../../output';

/**
 * Write newline-terminated text through the output seam byte-for-byte (script-absorption PR-5).
 *
 * The absorbed pipeline steps produce exact stdout/stderr text pinned by their golden output;
 * `CommandOutput.write`/`error` append one newline, so the trailing newline is dropped first and
 * empty text writes nothing.
 */
export function writeStepText(output: CommandOutput, stream: 'stdout' | 'stderr', text: string): void {
    if (text === '') return;
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    if (stream === 'stdout') output.write(body);
    else output.error(body);
}
