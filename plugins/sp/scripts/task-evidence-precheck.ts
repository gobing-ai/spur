#!/usr/bin/env bun
/**
 * task-evidence-precheck — deterministic evidence-channel precheck (R2, task 0726).
 *
 * Parses the task content for an exact `evidence-channel:` declaration and proves the
 * declared live-data channel exists in the local spur database before implementation
 * begins. Currently exactly one channel is allowlisted:
 *
 *   evidence-channel: history_tool_call.args_raw[pi]
 *
 * …satisfied only when the fixed query
 *
 *   SELECT COUNT(*) FROM history_tool_call WHERE args_raw IS NOT NULL AND source = 'pi'
 *
 * returns a positive count on `<cwd>/.spur/spur.db` — i.e. a live non-dry-run pi import
 * has already preserved tool-call `args_raw` (0722 R1). Unknown declarations, a missing
 * database, a missing table, and a zero count all fail closed.
 *
 * A task without any `evidence-channel:` declaration passes without opening SQLite —
 * the check only gates tasks that declare a live-data evidence channel.
 *
 * Always exits 0 (soft action). Both precheck→implement guards in task-pipeline.yaml
 * read the status file; a missing or failing checker writes FAIL, so readiness fails
 * closed.
 *
 * Ships with the plugin to arbitrary projects; node-builtin + bun:sqlite only —
 * no workspace imports.
 *
 * Usage:
 *   bun plugins/sp/scripts/task-evidence-precheck.ts <wbs> [--spur-bin <path>]
 *
 * Env: SPUR_BIN
 */

import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exact task-content declaration that activates the live-evidence gate (0726 R2). */
const DECLARATION_PREFIX = 'evidence-channel:';

/** The only allowlisted live-data channel (0726 R2). */
const EVIDENCE_CHANNEL = 'history_tool_call.args_raw[pi]';

/** Declaration text as it must appear in the task body. */
const DECLARATION = `${DECLARATION_PREFIX} ${EVIDENCE_CHANNEL}`;

/** The only live-data query this precheck is allowed to run — fixed, never task-authored. */
const EVIDENCE_QUERY = "SELECT COUNT(*) AS n FROM history_tool_call WHERE args_raw IS NOT NULL AND source = 'pi'";

// ─── CLI (same spur-bin chain as task-size-precheck.ts) ─────────────────────

function usage(): never {
    console.error('Usage: bun plugins/sp/scripts/task-evidence-precheck.ts <wbs> [--spur-bin <path>]');
    process.exit(1);
}

function defaultSpurBin(): string {
    if (process.env.SPUR_BIN) return process.env.SPUR_BIN;
    const local = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url));
    if (existsSync(local)) return `bun ${local}`;
    return 'spur';
}

function parseArgs(argv: string[]): { wbs: string; spurBin: string } {
    let spurBin = defaultSpurBin();
    let wbs = '';
    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--spur-bin') {
            spurBin = argv[i + 1] ?? defaultSpurBin();
            i += 2;
        } else if (!arg.startsWith('--')) {
            wbs = arg;
            i++;
        } else {
            i++;
        }
    }
    if (!wbs) usage();
    return { wbs, spurBin };
}

/**
 * Split a multi-token `spurBin` (`<runtime> <mainModule>`) the same way
 * `runSpurJson` does in feature-sync-bounded.ts — execFileSync's first arg is
 * one executable path, not a shell command line.
 */
function runSpur(spurBin: string, args: string[]): string {
    const [file = 'spur', ...lead] = spurBin.split(/\s+/).filter(Boolean);
    return execFileSync(file, [...lead, ...args], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

function writeStatus(wbs: string, status: 'PASS' | 'FAIL'): void {
    const statusDir = join(process.cwd(), '.spur', 'run');
    if (!existsSync(statusDir)) mkdirSync(statusDir, { recursive: true });
    writeFileSync(join(statusDir, `${wbs}-precheck-evidence.status`), `${status}\n`);
}

function fail(wbs: string, reasons: string[]): void {
    writeStatus(wbs, 'FAIL');
    console.error(`task-evidence-precheck: FAIL`);
    for (const r of reasons) {
        console.error(`  ${r}`);
    }
    process.exit(0);
}

function main(): void {
    const { wbs, spurBin } = parseArgs(process.argv.slice(2));

    let taskContent: string;
    try {
        const result = runSpur(spurBin, ['task', 'show', wbs, '--json']);
        const task = JSON.parse(result);
        taskContent = task.content ?? task.body ?? '';
    } catch {
        fail(wbs, [`could not fetch task ${wbs} via ${spurBin} — evidence channel unverifiable`]);
    }

    // Collect every declaration token. A repeated exact declaration still gates the
    // single fixed query; any non-allowlisted token is an unknown declaration.
    const declarations: string[] = [];
    for (const match of taskContent.matchAll(/evidence-channel:\s*(\S+)/g)) {
        declarations.push(match[1] ?? '');
    }
    const unknown = declarations.filter((d) => d !== EVIDENCE_CHANNEL);
    if (unknown.length > 0) {
        fail(wbs, [
            `unknown evidence-channel declaration(s): ${unknown.join(', ')}`,
            `allowlisted declaration: ${DECLARATION}`,
        ]);
    }
    if (declarations.length === 0) {
        writeStatus(wbs, 'PASS');
        console.error(`task-evidence-precheck: PASS — no evidence-channel declaration; live-data gate not active`);
        process.exit(0);
    }

    const dbPath = join(process.cwd(), '.spur', 'spur.db');
    if (!existsSync(dbPath)) {
        fail(wbs, [`local spur database not found at ${dbPath} — run a real history import first`]);
    }

    let count: number;
    try {
        const db = new Database(dbPath, { readonly: true });
        try {
            const row = db.query(EVIDENCE_QUERY).get() as { n: number } | undefined;
            count = row?.n ?? 0;
        } finally {
            db.close();
        }
    } catch (e) {
        fail(wbs, [
            `evidence query failed on ${dbPath}: ${e instanceof Error ? e.message : String(e)}`,
            'history_tool_call table missing or unreadable — run a real history import first',
        ]);
    }

    if (!(count > 0)) {
        fail(wbs, [
            `0 live pi rows with args_raw (query: ${EVIDENCE_QUERY})`,
            'run a non-dry-run pi history import with a safe importer before implementing',
        ]);
    }

    writeStatus(wbs, 'PASS');
    console.error(
        `task-evidence-precheck: PASS — ${count} live pi history_tool_call row(s) with args_raw (declaration: ${DECLARATION})`,
    );
    process.exit(0);
}

main();
