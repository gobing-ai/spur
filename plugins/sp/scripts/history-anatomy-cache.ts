/**
 * history-anatomy-cache — deterministic cache helper for the daily/ad-hoc history-anatomy
 * report (feature I8, HA-S1 0659 / ADR-079).
 *
 * ADR-079 makes cache validity a *derived* fact, not a stored claim: a cached report is reusable
 * only for its model-authored half, and only when a freshly derived semantic digest of the analyze
 * artifact plus the contract/skill/workflow logic digests all match what the cache recorded.
 *
 * This script performs deterministic file, hash, and schema work only — no finding, remediation,
 * severity, or ranking logic (that is judgment, owned by the sp:history-anatomy skill). Jobs:
 *
 *   1. semanticArtifactDigest  — normalized SHA-256 over the analyze artifact
 *   2. parseProvenance        — read cache frontmatter; null on absent/malformed, never throws
 *   3. decideCache            — the full invalidation matrix
 *   4. checkReportStructure   — the structure gate over a candidate report
 *   5. publishAtomically      — same-directory tmp + rename; target untouched on failure
 *
 * Mirrors the feature-sync-bounded.ts pattern (ADR-065 / 0659): pure exported functions for every
 * decision, a thin CLI entry, `node:` imports only, `process.argv.slice(2)`, local types — no
 * `packages/` imports and no `Bun.*` globals, so the committed `.mjs` twin runs under bare `node`.
 */

import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

// ── Local types (match the 0658/0660 frozen vocabulary; no package import) ───────────────

export interface CacheIdentity {
    contractVersion: string;
    mode: 'daily';
    date: string; // YYYY-MM-DD, local calendar day
    timezone: string; // IANA zone id
    bounds: { since: string; until: string }; // normalized, inclusive, RFC3339
    sources: string[];
}

export interface CacheProvenance {
    identity: CacheIdentity;
    windowState: 'provisional' | 'closed';
    generatedAt: string;
    validatedAt: string;
    artifactDigest: string;
    baselineArtifactDigest: string | null;
    contractDigest: string;
    skillDigest: string;
    workflowDigest: string;
    coverage: Array<{ source: string; status: string; lastImportedAt: string | null }>;
}

export type CacheDisposition = 'hit' | 'miss' | 'forced-recompute';

export interface CacheDecision {
    disposition: CacheDisposition;
    reasons: string[];
}

// Frozen vocabulary from 0658's references/report-contract.md, kept local (not imported from
// `packages/`, not re-read from the skill) so this deterministic script is self-contained.
const ELEVEN_SECTIONS = [
    'Scope and provenance',
    'Executive summary',
    'Baseline comparison',
    'Findings',
    'Recurrence ledger',
    'Telemetry gaps',
    'Remediation options',
    'Performance analysis',
    'Workflow and process improvements',
    'Positive patterns',
    'Evidence ledger',
];

const FINDING_FIELDS = [
    'key',
    'category',
    'impact',
    'trend',
    'observation',
    'inference',
    'confidence',
    'contradictions',
    'evidenceAnchor',
];

// ── 1. Semantic artifact digest ────────────────────────────────────────────────────────────

/** JSON-compatible value — the domain type for canonicalized artifact material and YAML scalars. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** Recursively canonicalize so equivalent evidence digests identically (sorted keys, undefined→null). */
function canonicalize(value: unknown, key: string): JsonValue {
    // Exclude only volatile generation fields — never derive validity from them.
    if (key === 'generatedAt' || key === 'validatedAt' || key === 'baselineArtifactDigest') return null;
    if (Array.isArray(value)) {
        const raw = (value as unknown[]).map((v) => JSON.stringify(canonicalize(v, '')));
        // Rankings keep order; plain lists sort.
        const isRanked =
            key === 'byTool' || key === 'bySession' || key === 'topStepsByTokens' || key === 'topStepsByDuration';
        return isRanked ? raw : [...raw].sort();
    }
    if (value !== null && typeof value === 'object') {
        const out: { [k: string]: JsonValue } = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            out[k] = canonicalize((value as Record<string, unknown>)[k], k);
        }
        return out;
    }
    return value as JsonValue;
}

/**
 * SHA-256 over the canonicalized artifact. `population` (0657) is included — a change in true
 * selection count is a change in evidence.
 */
export function semanticArtifactDigest(artifactJson: unknown): string {
    const material = JSON.stringify(canonicalize(artifactJson, 'root'));
    return createHash('sha256').update(material).digest('hex');
}

// ── 2. Provenance parsing ───────────────────────────────────────────────────────────────────

function parseScalar(raw: string): JsonValue {
    const t = raw.trim();
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replaceAll('\\"', '"');
    if (t === 'null') return null;
    return t;
}

/** Minimal YAML block parser for the deterministic cache frontmatter (nested blocks + list items). */
function parseBlock(text: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (/^\s*$/.test(line) || /^\s*#/.test(line) || /^-\s+/.test(line.trim())) continue;
        const indent = line.search(/\S/);
        const eq = line.indexOf(':');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const val = parseScalar(line.slice(eq + 1).trim());
        let consumed = 0;
        // Peek ahead: list item(s) under this key → capture as an array.
        const next = lines[i + 1];
        if ((val === '' || val === undefined) && /^\s*-\s+/.test(next ?? '')) {
            const items: Record<string, unknown>[] = [];
            let j = i + 1;
            while (j < lines.length && /^\s*-\s+/.test(lines[j] ?? '')) {
                const entry: Record<string, unknown> = {};
                for (const part of (lines[j] ?? '').trim().replace(/^-\s+/, '').split(',')) {
                    const e = part.indexOf(':');
                    if (e === -1) continue;
                    entry[part.slice(0, e).trim()] = parseScalar(part.slice(e + 1).trim());
                }
                items.push(entry);
                j++;
            }
            obj[key] = items;
            consumed = j - i - 1;
        } else if (val === '' || val === undefined) {
            // Nested block: capture indented lines into a recursive parse.
            const block: string[] = [];
            let j = i + 1;
            while (j < lines.length) {
                const nl = lines[j] ?? '';
                if (nl.trim() === '') {
                    block.push('');
                    j++;
                    continue;
                }
                const nind = nl.search(/\S/);
                if (nind <= indent) break;
                block.push(nl);
                j++;
            }
            obj[key] = parseBlock(block.join('\n'));
            consumed = j - i - 1;
        } else {
            obj[key] = val;
        }
        i += consumed;
    }
    return obj;
}

/**
 * Parse the YAML frontmatter of a published report into CacheProvenance. Returns `null` on
 * absent, truncated, or unparsable frontmatter — never throws.
 */
export function parseProvenance(reportMarkdown: string): CacheProvenance | null {
    const match = reportMarkdown.match(/^---\n([\s\S]*?)\n---/);
    if (match === null) return null;
    try {
        const obj = parseBlock(match[1] ?? '');
        const identity = obj.identity as Partial<CacheIdentity> | undefined;
        const coverage = obj.coverage as Array<Record<string, unknown>> | undefined;
        if (identity === undefined || !Array.isArray(coverage)) return null;
        const bounds = identity.bounds as { since?: string; until?: string } | undefined;
        if (bounds === undefined || typeof bounds.since !== 'string' || typeof bounds.until !== 'string') {
            return null;
        }
        return {
            identity: {
                contractVersion: String(identity.contractVersion ?? ''),
                mode: 'daily',
                date: String(identity.date ?? ''),
                timezone: String(identity.timezone ?? ''),
                bounds: { since: bounds.since, until: bounds.until },
                sources: Array.isArray(identity.sources) ? identity.sources.map((s) => String(s)) : [],
            },
            windowState: obj.windowState === 'closed' ? 'closed' : 'provisional',
            generatedAt: String(obj.generatedAt ?? ''),
            validatedAt: String(obj.validatedAt ?? ''),
            artifactDigest: String(obj.artifactDigest ?? ''),
            baselineArtifactDigest: obj.baselineArtifactDigest == null ? null : String(obj.baselineArtifactDigest),
            contractDigest: String(obj.contractDigest ?? ''),
            skillDigest: String(obj.skillDigest ?? ''),
            workflowDigest: String(obj.workflowDigest ?? ''),
            coverage: coverage.map((c) => ({
                source: String(c.source ?? ''),
                status: String(c.status ?? ''),
                lastImportedAt: c.lastImportedAt == null ? null : String(c.lastImportedAt),
            })),
        };
    } catch {
        return null;
    }
}

// ── 3. Invalidation matrix ──────────────────────────────────────────────────────────────────

/**
 * Decide cache reuse. Returns `hit` only when every invalidation-matrix row passes; each failing
 * row appends a human-readable reason. `forced-recompute` (from `--recompute`) is a disposition.
 */
export function decideCache(
    cached: CacheProvenance | null,
    current: CacheProvenance,
    opts: { recompute: boolean; dayClosed: boolean },
): CacheDecision {
    if (opts.recompute) return { disposition: 'forced-recompute', reasons: ['recompute'] };
    if (cached === null) return { disposition: 'miss', reasons: ['no-cache'] };

    const reasons: string[] = [];
    const id = cached.identity;
    const cur = current.identity;

    // Identity tuple equality.
    if (id.contractVersion !== cur.contractVersion) reasons.push('identity:contractVersion');
    if (id.mode !== cur.mode) reasons.push('identity:mode');
    if (id.date !== cur.date) reasons.push('identity:date');
    if (id.timezone !== cur.timezone) reasons.push('identity:timezone');
    if (id.bounds.since !== cur.bounds.since || id.bounds.until !== cur.bounds.until) reasons.push('identity:bounds');
    if ([...id.sources].sort().join('\0') !== [...cur.sources].sort().join('\0')) reasons.push('identity:sources');

    // Semantic artifact digest.
    if (cached.artifactDigest !== current.artifactDigest) reasons.push('data-changed');

    // Logic digests.
    if (cached.contractDigest !== current.contractDigest) reasons.push('logic-changed:contract');
    if (cached.skillDigest !== current.skillDigest) reasons.push('logic-changed:skill');
    if (cached.workflowDigest !== current.workflowDigest) reasons.push('logic-changed:workflow');

    // Coverage cannot degrade: the cache must not claim broader coverage than the current
    // analyze covers. If the cached report covered a source the current analyze no longer does,
    // the cache is stale.
    const currentSources = new Set(current.coverage.map((c) => c.source));
    if (cached.coverage.some((c) => !currentSources.has(c.source))) reasons.push('coverage-degraded');

    // Window-state transition: a provisional cache read once the day has closed is invalid.
    if (cached.windowState === 'provisional' && opts.dayClosed) reasons.push('window-closed');

    return { disposition: reasons.length === 0 ? 'hit' : 'miss', reasons };
}

// ── 4. Structure gate ─────────────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check a candidate report against the frozen report contract — the eleven sections in order,
 * the nine per-finding fields, no placeholders/TODOs/empty bodies, and evidence-ledger anchors.
 */
export function checkReportStructure(reportMarkdown: string): { ok: boolean; problems: string[] } {
    const problems: string[] = [];

    if (/TODO|PLACEHOLDER|FIXME|^\|\s*\|/im.test(reportMarkdown)) problems.push('placeholder-or-todo-present');

    let lastIdx = -1;
    for (const section of ELEVEN_SECTIONS) {
        const re = new RegExp(`^#{2,3}\\s+${escapeRe(section)}\\s*$`, 'm');
        const m = reportMarkdown.match(re);
        if (m === null || (m.index ?? -1) <= lastIdx) {
            problems.push(`section-missing-or-out-of-order:${section}`);
        } else if (m.index !== undefined) {
            lastIdx = m.index;
        }
    }

    const findingRows = reportMarkdown.match(
        /^\|\s*(reliability|repetition|workflow|performance|coverage|telemetry|positive):[^|]+/gm,
    );
    for (const row of findingRows ?? []) {
        for (const field of FINDING_FIELDS) {
            if (!row.toLowerCase().includes(field)) problems.push(`finding-missing-field:${field}`);
        }
    }

    const ledgerIdx = reportMarkdown.search(/^#{2,3}\s+Evidence\s+ledger/im);
    if (ledgerIdx !== -1) {
        const ledgerSection = reportMarkdown.slice(ledgerIdx);
        const claimRows = ledgerSection.match(/^[|>]\s+.+$/gm) ?? [];
        for (const row of claimRows) {
            const hasAnchor = /`[^`]+:\d+`|`[^`]+\.(md|ts|json)`|[a-z][a-z0-9_-]*\/[a-z][a-z0-9_./-]*:[0-9]+/i.test(
                row,
            );
            if (!hasAnchor) problems.push('evidence-claim-without-anchor');
            break;
        }
    }

    return { ok: problems.length === 0, problems };
}

// ── 5. Atomic publication ──────────────────────────────────────────────────────────────────────

/**
 * Publish a candidate atomically: write `<target>.tmp` in the same directory, fsync, then rename
 * onto the target. Same-directory rename is the atomicity guarantee; the target is left
 * byte-identical on any failure.
 */
export function publishAtomically(candidatePath: string, targetPath: string): void {
    const tmpPath = `${targetPath}.tmp`;
    try {
        writeFileSync(tmpPath, readFileSync(candidatePath));
        const fd = openSync(tmpPath, 'r');
        try {
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        renameSync(tmpPath, targetPath);
    } catch (err) {
        try {
            rmSync(tmpPath, { force: true });
        } catch {
            // best-effort cleanup
        }
        throw err;
    }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────────────────────

export interface CacheCliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Run the CLI with captured stdout/stderr (data, not process side-effects) so unit tests invoke
 * it in-process without leaking into the test runner's own output (feature-sync-bounded pattern).
 */
export function runCacheCli(argv: string[]): CacheCliResult {
    const [cmd, a, b] = argv;
    switch (cmd) {
        case 'digest': {
            if (a === undefined) {
                return { exitCode: 1, stdout: '', stderr: 'usage: <script> digest <artifact.json>\n' };
            }
            let artifact: unknown;
            try {
                artifact = JSON.parse(readFileSync(a, 'utf8'));
            } catch {
                return { exitCode: 1, stdout: '', stderr: `could not parse artifact at ${a}\n` };
            }
            const digest = semanticArtifactDigest(artifact);
            return { exitCode: 0, stdout: `${digest}\n`, stderr: '' };
        }
        case 'check': {
            if (a === undefined) {
                return { exitCode: 1, stdout: '', stderr: 'usage: <script> check <report.md>\n' };
            }
            const result = checkReportStructure(readFileSync(a, 'utf8'));
            const stdout = `${result.ok ? 'PASS' : 'FAIL'}\n${result.problems.map((p) => `- ${p}\n`).join('')}`;
            return { exitCode: result.ok ? 0 : 1, stdout, stderr: '' };
        }
        case 'publish': {
            if (a === undefined || b === undefined) {
                return { exitCode: 1, stdout: '', stderr: 'usage: <script> publish <candidate.md> <target.md>\n' };
            }
            publishAtomically(a, b);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
        default:
            return { exitCode: 1, stdout: '', stderr: 'valid commands: digest, check, publish\n' };
    }
}

if (import.meta.main) {
    const { exitCode, stdout, stderr } = runCacheCli(process.argv.slice(2));
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    process.exitCode = exitCode;
}
