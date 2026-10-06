/**
 * History-anatomy cache core — deterministic cache helper for the daily/ad-hoc history-anatomy
 * report (feature I8, HA-S1 0659 / ADR-079; task 1005 R2).
 *
 * ADR-079 makes cache validity a *derived* fact, not a stored claim: a cached report is reusable
 * only for its model-authored half, and only when a freshly derived semantic digest of the analyze
 * artifact plus the contract/skill/workflow/helper logic digests all match what the cache
 * recorded. This module performs deterministic file, hash, and schema work only — no finding,
 * remediation, severity, or ranking logic (that is judgment, owned by the sp:history-anatomy
 * skill): provenance parsing, the invalidation matrix, the report structure gate, atomic publish,
 * path resolution, and the porcelain fingerprint helpers.
 *
 * Moved from `plugins/sp/scripts/history-anatomy-cache.ts` (task 1005 R2, ADR-130 lib rule): every
 * exported function except argv parsing/dispatch, plus the frozen REPORT_SECTIONS /
 * FINDING_FIELDS contract consts (pinned by plugins/sp/tests/skill-structure.test.ts against this
 * module now). The plugin script keeps the CLI glue and reaches this module through the generated
 * standalone bundle `plugins/sp/lib/history-anatomy.generated.mjs` — node-builtin only (the
 * artifact-digest dependency imports packages/domain directly), so the committed `.mjs` twin runs
 * under bare `node`. Regenerate with `bun run build:plugin-lib`; do not hand-edit generated files.
 */
import { createHash } from 'node:crypto';
import {
    closeSync,
    existsSync,
    fsyncSync,
    openSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
// Leaf import, not the @gobing-ai/spur-domain barrel: this module is bundled standalone for
// plugins/sp (task 1005), and the barrel would drag the whole domain graph into the generated lib.
import { semanticArtifactDigest } from '@gobing-ai/spur-domain/artifact-digest';
/** The frozen cache identity vocabulary (0658/0660): what the cached report was generated from. */
export interface CacheIdentity {
    contractVersion: string;
    mode: 'daily' | 'ad-hoc';
    date: string; // YYYY-MM-DD, local calendar day
    timezone: string; // IANA zone id
    bounds: { since: string; until: string }; // normalized, inclusive, RFC3339
    sources: string[];
}

/** Full provenance for a history-anatomy report: identity, digests, coverage, and disposition. */
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
    /** Digest of the executing helper twin itself (0771): a changed deterministic half invalidates. */
    helperDigest: string;
    coverage: Array<{ source: string; status: string; lastImportedAt: string | null }>;
    // 0660 R7 audit fields. Recorded in the published frontmatter for provenance; deliberately
    // NOT part of the invalidation matrix — a changed run id or executor is not stale evidence.
    runId?: string;
    currentArtifactPath?: string;
    baselineArtifactPath?: string | null;
    spurVersion?: string;
    schemaVersion?: number;
    executor?: string;
    model?: string;
    cacheDisposition?: CacheDisposition;
}

/** How the cache verdict resolved for this run. */
export type CacheDisposition = 'hit' | 'miss' | 'forced-recompute';

/** The reuse verdict plus the invalidation-matrix rows that fired (empty reasons = hit). */
export interface CacheDecision {
    disposition: CacheDisposition;
    reasons: string[];
}

// Frozen vocabulary from 0658's references/report-contract.md, kept local (not imported from
// `packages/`, not re-read from the skill) so this deterministic script is self-contained.
/** Required report body sections in order; the structure gate checks these verbatim. */
export const REPORT_SECTIONS = [
    'Scope and provenance',
    'Executive summary',
    'Baseline comparison',
    'Findings',
    'Recurrence ledger',
    'Telemetry gaps',
    'Remediation options',
    'Performance analysis',
    'Workflow and process improvements',
    // 0680 R5: standing report-only advisory slot (repeated tool-and-argument
    // signatures propose no automatic interruption).
    'Report-only advisories',
    'Positive patterns',
    'Evidence ledger',
];

/** Ranked finding fields that carry per-key mention counts into the report. */
export const FINDING_FIELDS = [
    'key',
    'category',
    'impact',
    'trend',
    'observation',
    'inference',
    'confidence',
    'contradictions',
    'evidenceAnchor',
    // 0680 R1-R3: triage fields — the gate fails a finding missing any of them.
    'severity',
    'reproCommand',
    'ownerSurface',
];

// ── 1. Semantic artifact digest ────────────────────────────────────────────────────────────

/** JSON-compatible value — the domain type for canonicalized artifact material and YAML scalars. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export { semanticArtifactDigest };

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

/** A source list entry is either a bare scalar or a `- source: <name>` row. */
function readSourceName(s: unknown): string {
    if (s !== null && typeof s === 'object') return String((s as { source?: unknown }).source ?? '');
    return String(s);
}

const DISPOSITIONS: CacheDisposition[] = ['hit', 'miss', 'forced-recompute'];

/** Absent stays absent — an empty string would render as a real value in the republished block. */
function optionalString(v: unknown): string | undefined {
    return v == null || v === '' ? undefined : String(v);
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
                mode: identity.mode === 'ad-hoc' ? 'ad-hoc' : 'daily',
                date: String(identity.date ?? ''),
                timezone: String(identity.timezone ?? ''),
                bounds: { since: bounds.since, until: bounds.until },
                // Rendered as `- source: <name>` list items (the coverage-row style parseBlock
                // understands); tolerate a bare scalar list too.
                sources: Array.isArray(identity.sources) ? (identity.sources as unknown[]).map(readSourceName) : [],
            },
            windowState: obj.windowState === 'closed' ? 'closed' : 'provisional',
            generatedAt: String(obj.generatedAt ?? ''),
            validatedAt: String(obj.validatedAt ?? ''),
            artifactDigest: String(obj.artifactDigest ?? ''),
            baselineArtifactDigest: obj.baselineArtifactDigest == null ? null : String(obj.baselineArtifactDigest),
            contractDigest: String(obj.contractDigest ?? ''),
            skillDigest: String(obj.skillDigest ?? ''),
            workflowDigest: String(obj.workflowDigest ?? ''),
            helperDigest: String(obj.helperDigest ?? ''),
            coverage: coverage.map((c) => ({
                source: String(c.source ?? ''),
                status: String(c.status ?? ''),
                lastImportedAt: c.lastImportedAt == null ? null : String(c.lastImportedAt),
            })),
            // 0660 R7 audit fields must round-trip: the cache-hit path rebuilds the frontmatter
            // from this object, so anything not read back here would be silently dropped on
            // republish and the published report would stop carrying the full block.
            runId: optionalString(obj.runId),
            currentArtifactPath: optionalString(obj.currentArtifactPath),
            baselineArtifactPath: obj.baselineArtifactPath == null ? null : String(obj.baselineArtifactPath),
            spurVersion: optionalString(obj.spurVersion),
            schemaVersion: obj.schemaVersion == null ? undefined : Number(obj.schemaVersion),
            executor: optionalString(obj.executor),
            model: optionalString(obj.model),
            cacheDisposition: DISPOSITIONS.includes(obj.cacheDisposition as CacheDisposition)
                ? (obj.cacheDisposition as CacheDisposition)
                : undefined,
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
    if (cached.helperDigest !== current.helperDigest) reasons.push('logic-changed:helper');

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

/** Closed finding categories (0686/I9). Kept next to FINDING_FIELDS — the gate parses them. */
const FINDING_CATEGORIES = [
    'reliability',
    'repetition',
    'workflow',
    'performance',
    'coverage',
    'telemetry',
    'positive',
] as const;

/**
 * Closed per-finding confidence vocabulary (report contract): high/medium/low, never one blanket
 * report-level score. Compared case-insensitively so HIGH/MEDIUM/LOW pass.
 */
const FINDING_CONFIDENCES = ['high', 'medium', 'low'] as const;

/**
 * Check a candidate report against the frozen report contract — the twelve sections in order,
 * the nine per-finding fields, no placeholders/TODOs/empty bodies, and evidence-ledger anchors.
 */
export function checkReportStructure(reportMarkdown: string): { ok: boolean; problems: string[] } {
    const problems: string[] = [];

    if (/TODO|PLACEHOLDER|FIXME|^\|\s*\|/im.test(reportMarkdown)) problems.push('placeholder-or-todo-present');

    let lastIdx = -1;
    for (const section of REPORT_SECTIONS) {
        const re = new RegExp(`^#{2,3}\\s+${escapeRe(section)}\\s*$`, 'm');
        const m = reportMarkdown.match(re);
        if (m === null || (m.index ?? -1) <= lastIdx) {
            problems.push(`section-missing-or-out-of-order:${section}`);
        } else if (m.index !== undefined) {
            lastIdx = m.index;
        }
    }

    // 0680 R1-R3: findings are authored as bullet blocks under `## Findings` (one `### <title>`
    // block per finding, key-value bullets). Scan each block that carries a stable key and fail
    // it missing any triage field — including the three new ones. Without this scan a bullet
    // finding never matches the legacy pipe-row regex and the triage gate was vacuous.
    // 0686/I9: category parsing is scoped to that same body — an explicit category outside the
    // closed vocabulary (FINDING_CATEGORIES) or a stable key whose first segment does so fails
    // rather than passing vacuously.
    const findingsIdx = reportMarkdown.search(/^##\s+Findings\s*$/im);
    if (findingsIdx !== -1) {
        const tail = reportMarkdown.slice(findingsIdx);
        const nextSection = tail.slice(1).search(/^##\s+/im);
        const findingsBody = nextSection === -1 ? tail : tail.slice(0, nextSection + 1);

        const catAlt = FINDING_CATEGORIES.join('|');
        const knownRows = findingsBody.match(new RegExp(`^\\|\\s*(?:${catAlt}):[^|]+`, 'gm')) ?? [];
        const invalidRows = findingsBody.match(/^\|\s*([^|:\s][^|:]*):[^|]+/gm) ?? [];
        for (const row of [...new Set([...knownRows, ...invalidRows])]) {
            // 0686/I9: a pipe row outside the closed first-segment set fails by name instead of
            // being skipped silently by the legacy regex.
            const seg = row.match(/^\|\s*([^:|]+):/)?.[1];
            if (seg !== undefined && !(FINDING_CATEGORIES as readonly string[]).includes(seg.trim())) {
                problems.push(`finding-invalid-key-category:${seg.trim()}`);
            }
            // Case-insensitive on BOTH sides — camelCase triage fields otherwise never match a
            // lowercased row.
            const rowLower = row.toLowerCase();
            for (const field of FINDING_FIELDS) {
                if (!rowLower.includes(field.toLowerCase())) problems.push(`finding-missing-field:${field}`);
            }
        }

        const blocks = findingsBody.split(/^###\s+/m).slice(1);
        for (const block of blocks) {
            if (!block.includes('`key`') && !/\|\s*key\s*:/.test(block)) continue;
            for (const field of FINDING_FIELDS) {
                if (!block.includes(field)) problems.push(`finding-missing-field:${field}`);
            }
            // Severity vocabulary is closed (0680 R1): P1/P2/P3 only (symbolic placeholders allowed).
            if (!/(^|[\s`])P[123]([\s`.]|$)/.test(block) && !block.includes('symbolic-severity')) {
                problems.push('finding-invalid-severity');
            }
            // Confidence vocabulary is closed too: a per-finding high/medium/low. An explicit
            // level outside it fails by name rather than passing as free text.
            const confValue = block.match(/`confidence`\s*[:=]\s*`?([^`\n]*?)`?\s*(?:\n|$)/)?.[1]?.trim();
            if (
                confValue !== undefined &&
                confValue !== '' &&
                !(FINDING_CONFIDENCES as readonly string[]).includes(confValue.toLowerCase())
            ) {
                problems.push(`finding-invalid-confidence:${confValue}`);
            }
            // 0686/I9 closed-category enforcement on bullet findings.
            const catValue = block.match(/`category`\s*[:=]\s*`?([^`\n]+?)`?\s*(?:\n|$)/)?.[1];
            if (catValue && !(FINDING_CATEGORIES as readonly string[]).includes(catValue.trim())) {
                problems.push(`finding-invalid-category:${catValue.trim()}`);
            }
            const keyValue = block.match(/`key`\s*[:=]\s*`?([^`\n]+?)`?\s*(?:\n|$)/)?.[1] ?? '';
            const firstSegment = keyValue.split(':')[0]?.trim() ?? '';
            if (keyValue !== '' && !(FINDING_CATEGORIES as readonly string[]).includes(firstSegment)) {
                problems.push(`finding-invalid-key-category:${firstSegment}`);
            }
        }
    }

    const ledgerIdx = reportMarkdown.search(/^#{2,3}\s+Evidence\s+ledger/im);
    if (ledgerIdx !== -1) {
        const ledgerSection = reportMarkdown.slice(ledgerIdx);
        // A table's header + separator are structure, not claims — scanning from the first row
        // would fail every well-formed ledger on its own header. Start after the separator when
        // there is one; a blockquote ledger has no separator and every `>` line is a claim.
        const sep = ledgerSection.match(/^\|[\s:|-]+\|[ \t]*$/m);
        const body = sep?.index === undefined ? ledgerSection : ledgerSection.slice(sep.index + sep[0].length);
        const claimRows = body.match(/^[|>]\s+\S.*$/gm) ?? [];
        for (const row of claimRows) {
            const hasAnchor = /`[^`]+:\d+`|`[^`]+\.(md|ts|json)`|[a-z][a-z0-9_-]*\/[a-z][a-z0-9_./-]*:[0-9]+/i.test(
                row,
            );
            // Every claim is checked; one problem entry is enough to fail the gate.
            if (!hasAnchor) {
                problems.push('evidence-claim-without-anchor');
                break;
            }
        }
    }

    return { ok: problems.length === 0, problems };
}

// ── 4b. Provenance construction (0660 R7) ─────────────────────────────────────────────────────

/** Literal for anything the evidence plane cannot supply — never a fabricated value. */
const NOT_AVAILABLE = 'not available';

/**
 * SHA-256 over a file, or over a directory's `.md` / `.yaml` files (names sorted, name and body
 * both folded in so a rename is a change). Missing paths digest to `not available` rather than
 * throwing — a logic digest we cannot derive must read as unknown, not as a match.
 */
export function logicDigest(path: string | undefined): string {
    if (path === undefined || path === '' || !existsSync(path)) return NOT_AVAILABLE;
    try {
        const h = createHash('sha256');
        if (statSync(path).isDirectory()) {
            const walk = (dir: string): string[] =>
                readdirSync(dir, { withFileTypes: true })
                    .flatMap((e) =>
                        e.isDirectory()
                            ? walk(join(dir, e.name))
                            : /\.(md|ya?ml)$/.test(e.name)
                              ? [join(dir, e.name)]
                              : [],
                    )
                    .sort();
            for (const f of walk(path)) {
                h.update(f.slice(path.length));
                h.update(readFileSync(f));
            }
        } else {
            h.update(readFileSync(path));
        }
        return h.digest('hex');
    } catch {
        return NOT_AVAILABLE;
    }
}

/**
 * The visible "imported snapshot as of" instant: the **earliest** per-source `lastImportedAt`.
 * Taking the minimum is what makes the banner honest — the report never claims a source was
 * imported later than that source's own recorded timestamp (0660 R3 / feature scenario R8).
 */
export function importedSnapshotAsOf(coverage: CacheProvenance['coverage']): string {
    const stamps = coverage.map((c) => c.lastImportedAt).filter((v): v is string => typeof v === 'string' && v !== '');
    if (stamps.length === 0 || stamps.length !== coverage.length) return NOT_AVAILABLE;
    return [...stamps].sort()[0] ?? NOT_AVAILABLE;
}

/** Local calendar day (YYYY-MM-DD) in the given IANA zone — the DST-safe way to name "today". */
function localDay(tz: string, at: Date = new Date()): string {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(at);
    } catch {
        return at.toISOString().slice(0, 10);
    }
}

/** Wall-clock offset of `tz` at instant `at`, ms east of UTC (0674 R2). */
function tzOffsetMs(tz: string, at: Date): number {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
            .formatToParts(at)
            .filter((p) => p.type !== 'literal')
            .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        parts.hour === '24' ? 0 : Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
    );
    // Millisecond-truncate the comparison instant — Intl parts carry second precision, and an
    // untruncated .999 epoch would leak into the offset (0674).
    const atSec = Math.floor(at.getTime() / 1000) * 1000;
    return asUtc - atSec;
}

/** First instant of local calendar day `ymd` (two-pass so the offset guess survives DST edges). */
function zonedDayStart(tz: string, ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    const utcMidnight = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
    const guess = new Date(utcMidnight - tzOffsetMs(tz, new Date(utcMidnight)));
    return new Date(utcMidnight - tzOffsetMs(tz, guess));
}

/** Instant rendered in `tz` wall clock with explicit offset: YYYY-MM-DDTHH:mm:ss.sss±HH:MM. */
function formatZonedIso(tz: string, at: Date): string {
    const off = tzOffsetMs(tz, at);
    const abs = Math.abs(off);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const offStr = `${off < 0 ? '-' : '+'}${pad(Math.floor(abs / 3_600_000))}:${pad(Math.floor((abs % 3_600_000) / 60_000))}`;
    // Shifting by the offset then formatting as UTC yields the zone's own wall clock.
    return `${new Date(at.getTime() + off).toISOString().slice(0, 23)}${offStr}`;
}

/** Inclusive bounds of one local calendar day; a DST day is 23/24/25h and both ends carry the real offset. */
function dayBounds(tz: string, ymd: string): { since: string; until: string } {
    const start = zonedDayStart(tz, ymd);
    // start + 30h always lands inside the NEXT calendar day regardless of 23/24/25h lengths.
    const nextYmd = localDay(tz, new Date(start.getTime() + 30 * 3_600_000));
    return {
        since: formatZonedIso(tz, start),
        until: formatZonedIso(tz, new Date(zonedDayStart(tz, nextYmd).getTime() - 1)),
    };
}

/**
 * Resolve the run's fixed paths once (0660 R4/R15): the skill directory beside the helper, the
 * effective local date, and the publication target. Emitted as an env file so every downstream
 * stage stays a single helper invocation instead of repeating path arithmetic (ADR-069 R1).
 */
export function resolvePaths(opts: {
    helper: string;
    reportDir: string;
    date?: string;
    output?: string;
    now?: Date;
    /** IANA zone override (test hook); defaults to the process zone. */
    tz?: string;
    mode?: string;
    since?: string;
    until?: string;
}): string {
    // Layouts: monorepo `<root>/scripts/<file>` → skill `<root>/skills/history-anatomy`;
    // superskill-installed `<root>/scripts/<plugin>/<file>` → skill `<root>/skills/<plugin>-history-anatomy`.
    // (0660 dogfood 2026-08-26: the single-segment strip left HA_SKILL bogus on installed layouts,
    // silently degrading probe contract/skill digests to "not available".)
    const m = opts.helper.match(/\/scripts\/(?:([^/]+)\/)?[^/]+$/);
    const pluginRoot = m ? opts.helper.slice(0, m.index) : opts.helper;
    const skill = `${pluginRoot}/skills/${m?.[1] ? `${m[1]}-history-anatomy` : 'history-anatomy'}`;
    const tz = opts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const date = opts.date !== undefined && opts.date !== '' ? opts.date : localDay(tz, opts.now ?? new Date());
    const target =
        opts.output !== undefined && opts.output !== '' ? opts.output : `${opts.reportDir}/${date}-history-anatomy.md`;
    // 0674 R1/R2: daily bounds are derived here — date arithmetic in a named zone is exactly
    // the "exceeds the shell composition threshold" case (ADR-069 R1), and DST makes a local
    // day 23/24/25h. Ad-hoc (0674 R3): operator bounds pass through untouched, no baseline pair.
    const adHoc = opts.mode === 'ad-hoc' && !!opts.since && !!opts.until;
    let env = `HA_HELPER=${opts.helper}\nHA_SKILL=${skill}\nHA_TARGET=${target}\nHA_DATE=${date}\n`;
    if (adHoc) {
        return `${env}HA_SINCE=${opts.since}\nHA_UNTIL=${opts.until}\n`;
    }
    const current = dayBounds(tz, date);
    const baseline = dayBounds(tz, localDay(tz, new Date(zonedDayStart(tz, date).getTime() - 12 * 3_600_000)));
    env += `HA_SINCE=${current.since}\nHA_UNTIL=${current.until}\n`;
    env += `HA_BASELINE_SINCE=${baseline.since}\nHA_BASELINE_UNTIL=${baseline.until}\n`;
    return env;
}

/**
 * Per-mode argument grammar for the `paths` command (0920): the deterministic owner of the
 * mode/window validation the resolve-scope model hop used to perform. An empty string means
 * "not provided" — the workflow passes every declared var, empty by default.
 */
export type SelectorValidation =
    | {
          ok: true;
          mode: 'daily' | 'ad-hoc';
          date: string | null;
          focus: string | null;
          since: string | null;
          until: string | null;
      }
    | { ok: false; errors: string[] };

/** Real calendar day (rejects e.g. 2026-02-30); tz-independent UTC round-trip. */
function isRealDate(ymd: string): boolean {
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Per-mode argument grammar for the `paths` command (0920): every failure names its attributable flag. */
export function validateSelector(opts: {
    mode?: string;
    date?: string;
    since?: string;
    until?: string;
    focus?: string;
    recompute?: string;
    output?: string;
}): SelectorValidation {
    const errors: string[] = [];
    const has = (v?: string): v is string => v !== undefined && v !== '';
    const val = (v?: string) => (has(v) ? v : null);
    const mode = has(opts.mode) ? opts.mode : 'daily';
    if (mode !== 'daily' && mode !== 'ad-hoc') {
        return { ok: false, errors: [`--mode must be "daily" or "ad-hoc", got "${opts.mode}"`] };
    }
    const recompute = opts.recompute ?? '';
    if (recompute !== '' && recompute !== 'true' && recompute !== 'false') {
        errors.push(`--recompute must be "true" or "false", got "${recompute}"`);
    }
    if (mode === 'daily') {
        for (const [flag, v] of [
            ['--focus', opts.focus],
            ['--since', opts.since],
            ['--until', opts.until],
            ['--output', opts.output],
        ] as const) {
            if (has(v)) errors.push(`daily mode rejects ${flag}`);
        }
        if (has(opts.date) && !isRealDate(opts.date)) {
            errors.push(`--date must be a real YYYY-MM-DD calendar day, got "${opts.date}"`);
        }
    } else {
        if (has(opts.date)) errors.push('ad-hoc mode rejects --date');
        if (recompute === 'true') errors.push('ad-hoc mode rejects --recompute');
        if (!has(opts.focus)) errors.push('ad-hoc mode requires a non-empty --focus');
        const sinceOk = has(opts.since);
        const untilOk = has(opts.until);
        if (!sinceOk) errors.push('ad-hoc mode requires --since (inclusive ISO instant)');
        if (!untilOk) errors.push('ad-hoc mode requires --until (inclusive ISO instant)');
        if (sinceOk && untilOk) {
            const since = new Date(opts.since ?? '');
            const until = new Date(opts.until ?? '');
            if (Number.isNaN(since.getTime()))
                errors.push(`--since must be a parseable ISO instant, got "${opts.since}"`);
            if (Number.isNaN(until.getTime()))
                errors.push(`--until must be a parseable ISO instant, got "${opts.until}"`);
            if (!Number.isNaN(since.getTime()) && !Number.isNaN(until.getTime()) && since.getTime() > until.getTime()) {
                errors.push(`--since must not be after --until ("${opts.since}" > "${opts.until}")`);
            }
        }
    }
    if (errors.length) return { ok: false, errors };
    return {
        ok: true,
        mode,
        date: val(opts.date),
        focus: val(opts.focus),
        since: val(opts.since),
        until: val(opts.until),
    };
}

/** Everything `buildProvenance`/`probe` need: the fresh artifact, cached target, identity, and logic paths. */
export interface ProbeOptions {
    artifact: string;
    target: string;
    baseline?: string;
    mode: 'daily' | 'ad-hoc';
    date?: string;
    recompute: boolean;
    executor?: string;
    model?: string;
    skillDir?: string;
    contractFile?: string;
    workflowFile?: string;
    helperFile?: string;
    contractVersion?: string;
    runId?: string;
    spurVersion?: string;
    now?: Date;
}

/**
 * Build the provenance describing the run that just produced `artifact`. Everything here is
 * derived from the fresh analyze artifact and the on-disk logic files — never from the cached
 * report, which is the thing being judged.
 */
export function buildProvenance(opts: ProbeOptions): CacheProvenance {
    let raw: {
        selector?: { since?: string | null; until?: string | null };
        coverage?: Array<{ source?: unknown; status?: unknown; lastImportedAt?: unknown }>;
        schemaVersion?: unknown;
    };
    try {
        raw = JSON.parse(readFileSync(opts.artifact, 'utf8'));
    } catch (err) {
        throw new Error(`could not parse fresh analyze artifact at ${opts.artifact}: ${(err as Error).message}`);
    }
    const coverage = (raw.coverage ?? []).map((c) => ({
        source: String(c.source ?? ''),
        status: String(c.status ?? ''),
        lastImportedAt: c.lastImportedAt == null ? null : String(c.lastImportedAt),
    }));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const now = opts.now ?? new Date();
    const date = opts.date !== undefined && opts.date !== '' ? opts.date : localDay(tz, now);
    // Ad-hoc windows are explicit and never cached, so they are closed by construction; a daily
    // window is provisional until its local calendar day has ended.
    const windowState: 'provisional' | 'closed' =
        opts.mode === 'ad-hoc' || date < localDay(tz, now) ? 'closed' : 'provisional';
    const nowIso = now.toISOString();
    return {
        identity: {
            contractVersion: opts.contractVersion ?? '1',
            mode: opts.mode,
            date,
            timezone: tz,
            bounds: { since: String(raw.selector?.since ?? ''), until: String(raw.selector?.until ?? '') },
            sources: coverage.map((c) => c.source).sort(),
        },
        windowState,
        generatedAt: nowIso,
        validatedAt: nowIso,
        artifactDigest: semanticArtifactDigest(raw),
        baselineArtifactDigest: ((): string | null => {
            if (!(opts.baseline !== undefined && existsSync(opts.baseline))) return null;
            try {
                return semanticArtifactDigest(JSON.parse(readFileSync(opts.baseline, 'utf8')));
            } catch (err) {
                throw new Error(`could not parse baseline artifact at ${opts.baseline}: ${(err as Error).message}`);
            }
        })(),
        contractDigest: logicDigest(opts.contractFile),
        skillDigest: logicDigest(opts.skillDir),
        workflowDigest: logicDigest(opts.workflowFile),
        helperDigest: logicDigest(opts.helperFile),
        coverage,
        runId: opts.runId,
        currentArtifactPath: opts.artifact,
        baselineArtifactPath: opts.baseline ?? null,
        spurVersion: opts.spurVersion ?? NOT_AVAILABLE,
        schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : undefined,
        executor: opts.executor ?? NOT_AVAILABLE,
        model: opts.model ?? NOT_AVAILABLE,
    };
}

/** Read the cached report at `target` and decide reuse against a freshly built provenance. */
export function probe(opts: ProbeOptions): { decision: CacheDecision; current: CacheProvenance } {
    const current = buildProvenance(opts);
    const cachedText = existsSync(opts.target) ? readFileSync(opts.target, 'utf8') : null;
    const cached = cachedText === null ? null : parseProvenance(cachedText);
    // Ad-hoc never reuses a cache (0658 modes.md); force the regeneration path.
    const decision =
        opts.mode === 'ad-hoc'
            ? { disposition: 'miss' as const, reasons: ['ad-hoc-never-cached'] }
            : decideCache(cached, current, {
                  recompute: opts.recompute,
                  dayClosed: current.windowState === 'closed',
              });
    current.cacheDisposition = decision.disposition;
    return { decision, current };
}

const YAML_KEYS: Array<keyof CacheProvenance> = [
    'windowState',
    'generatedAt',
    'validatedAt',
    'artifactDigest',
    'baselineArtifactDigest',
    'contractDigest',
    'skillDigest',
    'workflowDigest',
    'helperDigest',
    'runId',
    'currentArtifactPath',
    'baselineArtifactPath',
    'spurVersion',
    'schemaVersion',
    'executor',
    'model',
    'cacheDisposition',
];

function yamlScalar(v: unknown): string {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return `"${String(v).replaceAll('"', '\\"')}"`;
}

/** Render the full R7 provenance block as report frontmatter (parseable back by parseProvenance). */
export function renderProvenanceFrontmatter(p: CacheProvenance): string {
    const lines = [
        '---',
        'identity:',
        `  contractVersion: ${yamlScalar(p.identity.contractVersion)}`,
        `  mode: ${p.identity.mode}`,
        `  date: ${yamlScalar(p.identity.date)}`,
        `  timezone: ${p.identity.timezone}`,
        '  bounds:',
        `    since: ${p.identity.bounds.since}`,
        `    until: ${p.identity.bounds.until}`,
        '  sources:',
    ];
    for (const s of p.identity.sources) lines.push(`    - source: ${s}`);
    for (const k of YAML_KEYS) {
        if (p[k] === undefined) continue;
        lines.push(`${k}: ${yamlScalar(p[k])}`);
    }
    lines.push('coverage:');
    for (const c of p.coverage) {
        lines.push(`  - source: ${c.source}, status: ${c.status}, lastImportedAt: ${c.lastImportedAt ?? 'null'}`);
    }
    lines.push('---');
    return lines.join('\n');
}

/** The one-line freshness banner rendered under the frontmatter. */
export function bannerLine(p: CacheProvenance): string {
    return `> imported snapshot as of ${importedSnapshotAsOf(p.coverage)} · window ${p.windowState} · cache ${p.cacheDisposition ?? NOT_AVAILABLE}`;
}

/** Strip any existing frontmatter + banner so stamping is idempotent. */
function stripHeader(md: string): string {
    const body = md.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\n+/, '');
    return body.replace(/^> imported snapshot as of [^\n]*\n+/, '');
}

/** Attach the provenance frontmatter and freshness banner to a candidate report. */
export function stampReport(candidateMarkdown: string, p: CacheProvenance): string {
    return `${renderProvenanceFrontmatter(p)}\n\n${bannerLine(p)}\n\n${stripHeader(candidateMarkdown).replace(/^\n+/, '')}`;
}

/**
 * Cache-hit path: keep the published model half verbatim, refresh only `validatedAt`, the
 * disposition, and the banner. The recorded digests and generation time are NOT touched — they
 * describe the evidence the model half was authored from.
 */
export function refreshReport(publishedMarkdown: string, validatedAt: string, disposition: CacheDisposition): string {
    const cached = parseProvenance(publishedMarkdown);
    if (cached === null) return publishedMarkdown;
    const refreshed: CacheProvenance = { ...cached, validatedAt, cacheDisposition: disposition };
    return stampReport(publishedMarkdown, refreshed);
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
/** Result envelope of one cache-CLI verb invocation (exit code, stdout, stderr). */
export interface CacheCliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Parse a `git status --porcelain` text into its path set. */
export function porcelainPaths(text: string): Set<string> {
    return new Set(
        text
            .split('\n')
            .map((line) => line.replace(/^\S+\s+/, '').trim())
            .filter((line) => line.length > 0),
    );
}

/** Paths present now but absent from the baseline and not declared outputs (0676 R3). */
export function diffPorcelain(before: string, now: string, expects: Set<string>): string[] {
    const beforePaths = porcelainPaths(before);
    return [...porcelainPaths(now)].filter((p) => !beforePaths.has(p) && !expects.has(p)).sort();
}
