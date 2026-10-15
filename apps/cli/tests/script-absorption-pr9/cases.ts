/**
 * Golden parity cases for script-absorption PR-9: `scripts/commands/real-run-cost.ts` and
 * `scripts/commands/pipeline-budgets.ts` → `spur workflow cost [--budget <file>]`.
 * `legacy` is the retired `bun scripts/spur-dev.ts …` argv; `cli` is the new `spur` argv.
 * Both run against the same seeded DB (`fixtures/script-absorption-pr9/seed.sql`), the same
 * workflow definitions and the same budget file.
 */
export interface Pr9Case {
    name: string;
    legacy: string[];
    cli: string[];
}

const BUDGET = ['--budget', 'config/pipeline-budgets.json'];

export const PR9_CASES: Pr9Case[] = [
    { name: 'cost text', legacy: ['real-run-cost'], cli: ['workflow', 'cost'] },
    { name: 'cost json', legacy: ['real-run-cost', '--json'], cli: ['workflow', 'cost', '--json'] },
    { name: 'cost by-state', legacy: ['real-run-cost', '--by-state'], cli: ['workflow', 'cost', '--by-state'] },
    {
        name: 'cost include-bookkeeping',
        legacy: ['real-run-cost', '--include-bookkeeping'],
        cli: ['workflow', 'cost', '--include-bookkeeping'],
    },
    {
        name: 'cost workflow filters',
        legacy: ['real-run-cost', '--workflow', 'pr-review', '--workflow', 'wrapup-pipeline'],
        cli: ['workflow', 'cost', '--workflow', 'pr-review', '--workflow', 'wrapup-pipeline'],
    },
    {
        name: 'cost since',
        legacy: ['real-run-cost', '--since', '2025-08-21'],
        cli: ['workflow', 'cost', '--since', '2025-08-21'],
    },
    {
        name: 'cost since by-state',
        legacy: ['real-run-cost', '--since', '2025-08-21', '--by-state'],
        cli: ['workflow', 'cost', '--since', '2025-08-21', '--by-state'],
    },
    { name: 'budget from db', legacy: ['check-pipeline-budgets'], cli: ['workflow', 'cost', ...BUDGET] },
    {
        name: 'budget workflow filter',
        legacy: ['check-pipeline-budgets', '--workflow', 'pr-review'],
        cli: ['workflow', 'cost', ...BUDGET, '--workflow', 'pr-review'],
    },
    {
        name: 'budget measured-file over',
        legacy: ['check-pipeline-budgets', '--measured-file', 'measured-over.json'],
        cli: ['workflow', 'cost', ...BUDGET, '--measured-file', 'measured-over.json'],
    },
];

/** Documented rename delta: the budget verdict line names the new verb. */
export function rewriteLegacy(text: string): string {
    return text.replaceAll('check-pipeline-budgets: ', 'workflow cost --budget: ');
}
