/**
 * corpus-check — sweep the whole task and feature corpus and fail on any
 * structural error that is not in the accepted baseline.
 *
 * WHY this exists: `spur task check <wbs>` runs once, at a transition, against
 * the rules that existed that day. Nothing re-validated afterwards, so two
 * classes of defect accumulated invisibly:
 *
 *   1. **Bypasses.** A task that slipped its gate was never looked at again.
 *   2. **Ratchet drift.** Check rules tighten over time; a task closed legally
 *      under yesterday's rules silently becomes non-compliant under today's.
 *      (Task 0368 closed 2026-07-28; the rule that now flags it landed
 *      2026-08-01.)
 *
 * The baseline (`config/corpus-baseline.json`) is deliberately two-sided: a new
 * error fails the gate, AND a baseline entry that no longer reproduces fails it
 * too. Without the second half the file would rot into a permanent suppression
 * list — the exact invisible-debt pattern this command exists to end.
 */
import { join } from 'node:path';

/** One accepted-error record from `config/corpus-baseline.json`. */
interface BaselineEntry {
    kind: 'task' | 'feature';
    id: string;
    code: string;
    reason: string;
    since: string;
}

interface Baseline {
    note?: string;
    entries: BaselineEntry[];
}

/** A single error observed in the corpus sweep. */
interface CorpusError {
    kind: 'task' | 'feature';
    id: string;
    code: string;
    message: string;
}

/** `<kind>:<id>:<code>` — the identity a baseline entry and an observed error share. */
function key(e: { kind: string; id: string; code: string }): string {
    return `${e.kind}:${e.id}:${e.code}`;
}

/**
 * Run one `spur <noun> check --json` sweep and collect its errors.
 *
 * The CLI exits non-zero when findings exist, so the exit code is expected and
 * ignored; stdout is the signal. A sweep that produces unparseable output is a
 * hard failure — silently treating it as "no errors" would disable the gate.
 */
async function sweep(noun: 'task' | 'feature', cwd: string): Promise<CorpusError[]> {
    const proc = Bun.spawn(['bun', 'run', join('apps', 'cli', 'src', 'index.ts'), noun, 'check', '--json'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const start = stdout.indexOf('[');
    if (start === -1) {
        throw new Error(
            `corpus-check: \`spur ${noun} check --json\` produced no JSON array. ` +
                `Output was:\n${stdout.slice(0, 400)}`,
        );
    }
    let rows: { wbs?: string; id?: string; findings?: { code: string; severity: string; message: string }[] }[];
    try {
        rows = JSON.parse(stdout.slice(start));
    } catch (err) {
        throw new Error(`corpus-check: could not parse \`spur ${noun} check --json\` output: ${String(err)}`);
    }

    const errors: CorpusError[] = [];
    for (const row of rows) {
        const id = row.wbs ?? row.id;
        if (id === undefined) continue;
        for (const f of row.findings ?? []) {
            if (f.severity !== 'error') continue;
            errors.push({ kind: noun, id, code: f.code, message: f.message });
        }
    }
    return errors;
}

/**
 * Detect two corpus files claiming the same WBS / feature id.
 *
 * WHY this is separate from the `check` sweep: `spur task check` validates one document at a
 * time, so a duplicate id is invisible to it — and `spur task show <wbs>` resolves to whichever
 * file it finds first, silently shadowing the other. Found live on 2026-08-07: two different
 * tasks both numbered 0468, one CLI-allocated and one hand-written straight to disk. The
 * hand-written file bypassed `spur task create`, so the race-safe allocator never saw it, and
 * every per-file gate passed while one ticket was unreachable.
 */
async function duplicateIds(cwd: string): Promise<CorpusError[]> {
    const { readdirSync } = await import('node:fs');
    const scan = (dir: string, kind: 'task' | 'feature'): { id: string; file: string; kind: typeof kind }[] => {
        let names: string[];
        try {
            names = readdirSync(join(cwd, dir));
        } catch {
            return [];
        }
        const pattern = kind === 'task' ? /^(\d{4})_/ : /^([A-Z][0-9]*)_/;
        return names
            .map((n) => ({ m: n.match(pattern), n }))
            .filter((x): x is { m: RegExpMatchArray; n: string } => x.m !== null)
            .map((x) => ({ id: x.m[1] as string, file: `${dir}/${x.n}`, kind }));
    };

    const all = [
        ...scan('docs/tasks', 'task'),
        ...scan('docs/tasks2', 'task'),
        ...scan('docs/tasks3', 'task'),
        ...scan('docs/features', 'feature'),
    ];

    const byId = new Map<string, string[]>();
    for (const e of all) {
        const k = `${e.kind}:${e.id}`;
        byId.set(k, [...(byId.get(k) ?? []), e.file]);
    }

    const errors: CorpusError[] = [];
    for (const [k, files] of byId) {
        if (files.length < 2) continue;
        const [kind, id] = k.split(':') as ['task' | 'feature', string];
        errors.push({
            kind,
            id,
            code: 'corpus.duplicate-id',
            message: `${files.length} files claim ${kind} ${id}: ${files.join(' | ')} — one shadows the other in every lookup; renumber the later one via \`spur ${kind} create\``,
        });
    }
    return errors;
}

/** Sweep the corpus and diff it against the baseline. Returns the process exit code. */
export async function corpusCheck(cwd: string = process.cwd()): Promise<number> {
    const baselineFile = join(cwd, 'config', 'corpus-baseline.json');
    // A missing baseline degrades to "no exemptions" rather than crashing. The file is a gate
    // INPUT and belongs in git; but a tarball export, a sparse checkout, or a forgotten `git add`
    // must produce a legible strictest-mode run, not an opaque module/JSON error.
    let baseline: Baseline = { entries: [] };
    if (await Bun.file(baselineFile).exists()) {
        baseline = await Bun.file(baselineFile).json();
    } else {
        console.warn(
            `corpus-check: no baseline at ${baselineFile} — running with zero exemptions. ` +
                'If this is a git checkout, the file is missing from version control.',
        );
    }
    const accepted = new Map(baseline.entries.map((e) => [key(e), e]));

    const observed = [...(await sweep('task', cwd)), ...(await sweep('feature', cwd)), ...(await duplicateIds(cwd))];
    const observedKeys = new Set(observed.map(key));

    const unexpected = observed.filter((e) => !accepted.has(key(e)));
    const stale = baseline.entries.filter((e) => !observedKeys.has(key(e)));

    console.log(
        `corpus-check: swept tasks + features — ${observed.length} error(s) observed, ` +
            `${accepted.size} baselined, ${unexpected.length} new, ${stale.length} stale.`,
    );

    for (const e of unexpected) {
        console.error(`  NEW    ${e.kind} ${e.id}: ${e.code} — ${e.message}`);
    }
    for (const e of stale) {
        console.error(`  STALE  ${e.kind} ${e.id}: ${e.code} — fixed; remove this entry from ${baselineFile}`);
    }

    if (unexpected.length > 0 || stale.length > 0) {
        console.error(
            '\ncorpus-check FAILED.\n' +
                '  NEW   → fix the finding, or add it to config/corpus-baseline.json with a reason and a date.\n' +
                '  STALE → the finding is gone; delete its baseline entry so the list stays honest.',
        );
        return 1;
    }
    console.log('corpus-check OK — no corpus errors outside the accepted baseline.');
    return 0;
}
