import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REFERENCES = join(import.meta.dir, '..', '..', 'skills', 'spur-dev', 'references');

/**
 * Task 1128 split the driver runbooks into sibling on-demand files (a bootstrap-budget split, not a
 * rewrite). The prose contracts that pin their text read the LOGICAL runbook, so moving a section
 * into its on-demand sibling cannot silently drop a pin. The second logical runbook (the inline
 * driver) is gone with the driver (task 1242).
 *
 * Parts are listed in their original document order, so ordering assertions
 * (`indexOf(a) < indexOf(b)`) keep meaning.
 */
const PARTS = {
    'execution-batch': [
        'execution-batch.md',
        'execution-batch-report.md',
        'execution-worktree-setup.md',
        'execution-worktree-landing.md',
        'execution-parallel-isolation.md',
        'execution-batch-continuation.md',
    ],
} as const satisfies Record<string, readonly string[]>;

export type RunbookName = keyof typeof PARTS;

/** The full text of a logical runbook, its 1128 parts joined in document order. */
export function readRunbook(name: RunbookName): string {
    return PARTS[name].map((file) => readFileSync(join(REFERENCES, file), 'utf8')).join('\n');
}

/** Absolute path to one reference file — for anchors, section slices and single-file pins. */
export function referencePath(file: string): string {
    return join(REFERENCES, file);
}
