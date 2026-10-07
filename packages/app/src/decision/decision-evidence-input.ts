import { redactAndBound } from '../observability/agent-execution';
import { DECIDE_EVIDENCE_MAX_CHARS } from '../workflow/decide';

/**
 * Shared evidence reader (task 1094 R3): every declared evidence file is read, then
 * redacted and bounded with the SAME policy the workflow inline decide uses, so
 * CLI-gathered reliability samples measure the same input the workflow sends. Paths
 * arrive final (the caller resolves against its cwd/workdir). An unreadable file
 * throws — evidence is a declared caller fact, and the caller decides how to fail:
 * the CLI exits before any backend call, the workflow action rejects before
 * `decision.start` and degrades to the mapped fallback row (1094 R4 step 3).
 */
export async function readDecisionEvidence(
    paths: readonly string[],
    readFile: (path: string) => Promise<string>,
): Promise<string[]> {
    return await Promise.all(
        paths.map(async (path) => {
            let text: string;
            try {
                text = await readFile(path);
            } catch {
                throw new Error(`evidence file "${path}" is unreadable`);
            }
            return redactAndBound(text, [], DECIDE_EVIDENCE_MAX_CHARS);
        }),
    );
}
