/**
 * Verify-answer lint — deterministic pre-verdict answer checks (0726 R3, task 1003 R1).
 *
 * Ported from the deleted plugin script `plugins/sp/scripts/verify-answer-lint.ts`:
 * `spur task verdict` now owns the lint (task 1003 R2) and calls this pure function
 * before `deriveVerdict`. The verifier owns the answer file
 * (`.spur/run/<wbs>-verify-answer.txt`): it creates it with `Verdict: PARTIAL`, appends
 * one complete requirement/AC row at a time, and only replaces the first verdict line once
 * every row is certified. Because the file is append-progress instead of a single captured
 * blob, malformed rows can reach the verdict step — this lint rejects each invalid class
 * with a row-level finding:
 *
 *   - missing, duplicate, or unknown requirement IDs (vs the task's Requirements)
 *   - AC IDs that do not exactly match the task's AC checklist label or a linked
 *     feature scenario title
 *   - status / evidence-type values the verdict parser would drop
 *   - empty evidence
 *
 * Compound evidence types (`test + command`) stay valid — normalization mirrors
 * `packages/app/src/services/task-verdict.ts` exactly, so anything this lint accepts
 * is also accepted by `spur task verdict --from-answer` (and vice versa).
 */

// ─── Public surface ──────────────────────────────────────────────────────────

/** Bounded diagnostics: lint collection stops at this many findings (0726 R3). */
export const ANSWER_LINT_MAX_FINDINGS = 10;

/** One lint rejection, row-addressed. `line` is 1-based; `0` = no answer row (task-side gap). */
export interface AnswerLintFinding {
    line: number;
    rule: string;
    message: string;
}

/**
 * Lint a verify answer against the task's declared requirement/AC identities.
 * `featureContent` is the linked feature's markdown (optional; its `Scenario:` titles
 * back the documented `AC-N` positional alias). Findings are capped at
 * {@link ANSWER_LINT_MAX_FINDINGS}.
 */
export function lintVerifyAnswer(
    answerText: string,
    taskContent: string,
    featureContent?: string | null,
): AnswerLintFinding[] {
    const findings: AnswerLintFinding[] = [];
    const add = (line: number, rule: string, message: string): void => {
        if (findings.length < ANSWER_LINT_MAX_FINDINGS) findings.push({ line, rule, message });
    };

    const tables = parseAnswer(answerText);
    if (tables.verdict === null) {
        add(0, 'verdict-missing', 'no `Verdict:` line (expected exactly one `Verdict: PASS|PARTIAL|FAIL` line)');
    } else if (!/^(PASS|PARTIAL|FAIL)$/i.test(tables.verdict.value)) {
        add(
            tables.verdict.line,
            'verdict-value',
            `invalid Verdict value "${tables.verdict.value}" (PASS | PARTIAL | FAIL)`,
        );
    }

    const reqIds = extractRequirementIds(taskContent);
    const acIndex = buildAcIdentityIndex(taskContent, featureContent ?? null);

    // Requirement rows: completeness, no unknowns, no duplicates, valid status, non-empty evidence.
    const seenReq = new Set<string>();
    for (const row of tables.reqs) {
        if (!reqIds.includes(row.id))
            add(
                row.line,
                'req-unknown',
                `unknown requirement ID "${row.id}" (task declares: ${reqIds.join(', ') || 'none'})`,
            );
        else if (seenReq.has(row.id)) add(row.line, 'req-duplicate', `duplicate requirement row "${row.id}"`);
        seenReq.add(row.id);
        if (normalizeReqStatus(row.status) === null)
            add(row.line, 'req-status', `"${row.id}" invalid status "${row.status}" (MET | PARTIAL | UNMET)`);
        if (!row.evidence.trim()) add(row.line, 'req-evidence', `"${row.id}" has empty evidence`);
    }
    for (const id of reqIds) {
        if (!seenReq.has(id)) add(0, 'req-missing', `missing requirement row for "${id}"`);
    }

    // AC rows: identity must resolve to ONE canonical task AC identity — a
    // checklist label/token or a scenario title in any ac-style-guide form
    // (exact/bare title, `Scenario:` prefix, bracket tags, declared AC-N
    // alias; 0804 R4). Alias-equivalent spellings of the same identity are
    // duplicates even when the raw strings differ. Status and evidence type
    // must normalize; evidence non-empty. AC completeness is the verifier's
    // authoring contract, not a lint rejection class (0726 R3).
    const seenAc = new Map<string, string>(); // canonical key → first raw row id
    for (const row of tables.acs) {
        const resolution = resolveAcIdentity(row.id, acIndex);
        const canonicalKey = resolution.ok ? normalizeAcTitle(resolution.canonical) : null;
        if (!resolution.ok) {
            if (resolution.error !== '') add(row.line, 'ac-ordinal', resolution.error);
            else
                add(
                    row.line,
                    'ac-identity',
                    `AC ID "${row.id.slice(0, 60)}" matches no task AC checklist label or scenario title ` +
                        "(accepted forms: exact title, bare title, a criterion bullet's bold head or full bold span, " +
                        '`Scenario:` prefix, bracket tags, declared AC-N alias)',
                );
        } else if (canonicalKey !== null && seenAc.has(canonicalKey)) {
            const first = seenAc.get(canonicalKey) ?? '';
            add(
                row.line,
                'ac-duplicate',
                `duplicate AC row "${row.id.slice(0, 60)}" — alias-equivalent to "${first.slice(0, 60)}"`,
            );
        }
        if (canonicalKey !== null && !seenAc.has(canonicalKey)) seenAc.set(canonicalKey, row.id);
        if (normalizeAcStatus(row.status) === null)
            add(row.line, 'ac-status', `invalid AC status "${row.status}" (MET | PARTIAL | UNMET | N/A)`);
        if (normalizeEvidenceType(row.evidenceType) === null)
            add(
                row.line,
                'ac-evidence-type',
                `invalid evidence type "${row.evidenceType}" (test | command | static-ref | manual-review | llm-judge | n/a, or a + compound)`,
            );
        if (!row.evidence.trim()) add(row.line, 'ac-evidence', `AC "${row.id.slice(0, 40)}" has empty evidence`);
    }

    return findings;
}

// ─── Answer parsing — mirrors packages/app/src/services/task-verdict.ts ──────

interface ReqRow {
    id: string;
    status: string;
    evidence: string;
    line: number;
}
interface AcRow {
    id: string;
    status: string;
    evidenceType: string;
    evidence: string;
    line: number;
}

function splitTableCells(line: string): string[] {
    return line
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, '|').trim())
        .filter(Boolean);
}

function normalizeReqStatus(raw: string): string | null {
    if (/\bMET\b/.test(raw)) return 'MET';
    if (/\bPARTIAL\b/.test(raw)) return 'PARTIAL';
    if (/\bUNMET\b/.test(raw)) return 'UNMET';
    return null;
}

function normalizeAcStatus(raw: string): string | null {
    if (/\bMET\b/.test(raw)) return 'MET';
    if (/\bPARTIAL\b/.test(raw)) return 'PARTIAL';
    if (/\bUNMET\b/.test(raw)) return 'UNMET';
    if (/\bN\/A\b/.test(raw) || /\bNA\b/.test(raw)) return 'N/A';
    return null;
}

function normalizeEvidenceTypeToken(normalized: string): string | null {
    if (normalized === 'test') return 'test';
    if (normalized === 'command') return 'command';
    if (
        normalized === 'static-ref' ||
        normalized === 'static' ||
        normalized === 'doc' ||
        normalized === 'docs' ||
        normalized === 'documentation'
    ) {
        return 'static-ref';
    }
    if (normalized === 'manual-review' || normalized === 'manual') return 'manual-review';
    if (normalized === 'llm-judge' || normalized === 'judge') return 'llm-judge';
    if (normalized === 'n/a' || normalized === 'na') return 'n/a';
    return null;
}

const EVIDENCE_TYPE_PRECEDENCE = ['test', 'command', 'static-ref', 'manual-review', 'llm-judge', 'n/a'] as const;

function normalizeEvidenceType(raw: string): string | null {
    const normalized = raw.toLowerCase().trim();
    const single = normalizeEvidenceTypeToken(normalized);
    if (single !== null) return single;
    const parts = normalized.split(/[+,/]/).filter((p) => p.trim());
    const tokens = parts.map((part) => normalizeEvidenceTypeToken(part.trim())).filter((t) => t !== null);
    if (tokens.length < 2 || tokens.length !== parts.length) return null;
    return EVIDENCE_TYPE_PRECEDENCE.find((candidate) => tokens.includes(candidate)) ?? null;
}

interface AnswerTables {
    verdict: { value: string; line: number } | null;
    reqs: ReqRow[];
    acs: AcRow[];
}

function parseAnswer(text: string): AnswerTables {
    const out: AnswerTables = { verdict: null, reqs: [], acs: [] };
    const lines = text.split('\n');
    let reqTable = false;
    let acTable = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i]?.trim() ?? '';
        const lineNo = i + 1;

        // A markdown heading closes whichever table is open (mirrors the verdict parser).
        if ((reqTable || acTable) && /^#{1,6}\s/.test(trimmed)) {
            reqTable = false;
            acTable = false;
            continue;
        }
        if (!trimmed.startsWith('|')) continue;
        const cells = splitTableCells(trimmed);
        if (/^[-:]+$/.test(cells[0] ?? '')) continue;

        const h0 = (cells[0] ?? '').toLowerCase();
        const h1 = (cells[1] ?? '').toLowerCase();

        // Requirement header: `| Req | Status | Evidence |` (id-like first cell + status column).
        if (!reqTable && !acTable && cells.length >= 2) {
            const idLike = h0.includes('req') || h0 === 'requirement' || h0 === 'r#' || h0 === 'r' || /^r\d+$/.test(h0);
            if (idLike && (h1.includes('status') || h1 === 'verdict')) {
                reqTable = true;
                continue;
            }
            if (
                (h0 === 'ac' || h0.includes('acceptance')) &&
                h1.includes('status') &&
                (cells[2] ?? '').toLowerCase().includes('evidence')
            ) {
                acTable = true;
                continue;
            }
        }

        if (reqTable && cells.length >= 2) {
            // An AC header following the requirement table closes it (mirrors the parser).
            if ((h0 === 'ac' || h0.includes('acceptance')) && h1.includes('status')) {
                reqTable = false;
                acTable = true;
                continue;
            }
            out.reqs.push({
                id: cells[0] ?? '',
                status: (cells[1] ?? '').toUpperCase(),
                evidence: cells[2] ?? '',
                line: lineNo,
            });
            continue;
        }
        if (acTable && cells.length >= 3) {
            out.acs.push({
                id: cells[0] ?? '',
                status: cells[1] ?? '',
                evidenceType: cells[2] ?? '',
                evidence: cells[3] ?? '',
                line: lineNo,
            });
        }
    }

    const verdictMatches = [...text.matchAll(/^\s*Verdict:\s*(\S+)\s*$/gim)];
    if (verdictMatches.length === 1) {
        out.verdict = {
            value: verdictMatches[0]?.[1] ?? '',
            line: text.slice(0, verdictMatches[0]?.index ?? 0).split('\n').length,
        };
    }
    return out;
}

// ─── Task-side identity extraction ───────────────────────────────────────────

function sectionBetween(text: string, heading: string): string {
    const marker = new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'im');
    const match = marker.exec(text);
    if (!match || match.index === undefined) return '';
    const rest = text.slice(match.index);
    const lineEnd = rest.indexOf('\n');
    const afterHeading = lineEnd === -1 ? '' : rest.slice(lineEnd + 1);
    const next = afterHeading.search(/^#{1,6}\s/m);
    return next === -1 ? afterHeading : afterHeading.slice(0, next);
}

function extractRequirementIds(taskContent: string): string[] {
    const section = sectionBetween(taskContent, 'Requirements');
    const ids = new Set<string>();
    // Corpus forms: bold-wrapped (`**R1. Title.**`, bare `**R1**`); right after a list
    // marker with optional checkbox (`- [ ] R1.` — the dominant corpus form, `- R1. Title.`,
    // `- R1:`) or a bare checkbox with the marker omitted (`[x] R1.`); line-start (`R1:`).
    // The marker and the checkbox are never both optional — that would match bare prose
    // (`R1 is …`) and fabricate declarations. Sub-IDs (`R1.1`) match in every form.
    for (const m of section.matchAll(/\*\*(R\d+(?:\.\d+)*)\b/g)) ids.add(m[1] ?? '');
    for (const m of section.matchAll(/^(?:[-*]\s+(?:\[[ xX]\]\s+)?|\[[ xX]\]\s+)(R\d+(?:\.\d+)*)/gm))
        ids.add(m[1] ?? '');
    for (const m of section.matchAll(/^(R\d+(?:\.\d+)*)\s*[.:]/gm)) ids.add(m[1] ?? '');
    return [...ids];
}

// ─── Canonical AC identity resolution (task 0804 R4) ─────────────────────────

/**
 * Strip the tolerated AC-id wrappers (bracket tags, `Scenario:` prefix) until
 * fixpoint — the shared first step of `normalizeAcTitle` and the `AC-N` alias
 * path in `resolveAcIdentity`.
 */
function stripAcWrappers(title: string): string {
    let out = title.trim();
    let prev: string;
    do {
        prev = out;
        out = out
            .replace(/^\[[^\]]*\]\s*/, '')
            .replace(/\s*\[[^\]]*\]\s*$/, '')
            .replace(/^Scenario:\s*/i, '')
            .trim();
    } while (out !== prev);
    return out;
}

/**
 * Normalize an AC identity to its canonical key, mirroring the documented
 * matching behavior of feature-check `rowMatchesScenario` + ac-style-guide
 * "Four accepted id forms" (exact/bare title, `Scenario:` prefix, bracket
 * tags, `AC-N` ordinal) plus the task-side bold-trajectory paragraph
 * (0817 R3), without importing that private matcher or adopting
 * its permissive trailing-Gherkin fallback (0804 R4). Comparison is
 * case/quote/whitespace-insensitive. A paraphrase normalizes differently
 * and still fails.
 */
function normalizeAcTitle(title: string): string {
    return (
        stripAcWrappers(title)
            .replace(/^R\d+\s*[:\-—]?\s*/, '')
            .toLowerCase()
            // Exact pre-refactor removal set (0809 R5): ASCII apostrophe + the four curly
            // quotes. Escaped form keeps U+0027 visible next to lookalike curly glyphs;
            // U+02BC stays a meaningful character, never removable punctuation.
            .replace(/[\u0027\u2018\u2019\u201c\u201d]/g, '')
            .replace(/\s+/g, ' ')
            // A declared bold head keeps its sentence-final period (`- **AC1: … form.**`) while an
            // answer row normally cites it without one. Both the declared spelling and the queried
            // row normalize through here, so dropping it is symmetric — it can only merge titles
            // that already differ by nothing but trailing periods.
            .replace(/\s*\.+$/, '')
            .trim()
    );
}

/**
 * Declared AC identities keyed by canonical normalized title, plus the two
 * AC-N ordinal sources (task scenario list and linked-feature scenario list).
 * A checklist-declared spelling always wins over the positional alias.
 */
interface AcIdentityIndex {
    /** normalized canonical title → a declared spelling (label, token, title, or bold trajectory). */
    readonly byTitle: Map<string, string>;
    /** AC-N → task scenario title at that 1-based ordinal. */
    readonly taskScenarios: string[];
    /** AC-N → feature scenario title at that 1-based ordinal. */
    readonly featureScenarios: string[];
}

function buildAcIdentityIndex(taskContent: string, featureContent: string | null): AcIdentityIndex {
    const byTitle = new Map<string, string>();
    // Not named `declare`: Bun's TS transpiler treats a call to an identifier
    // named `declare` as an ambient-declaration modifier and drops it.
    const declareIdentity = (spelling: string): void => {
        const key = normalizeAcTitle(spelling);
        if (key !== '' && !byTitle.has(key)) byTitle.set(key, spelling);
    };
    const section = sectionBetween(taskContent, 'Acceptance Criteria');
    for (const m of section.matchAll(/^[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*(?::|$)/gm)) {
        const label = (m[1] ?? '').trim();
        if (!label) continue;
        declareIdentity(label);
        const leading = label.split(/\s+/)[0] ?? '';
        if (leading && leading !== label) declareIdentity(leading);
    }
    // Bold head of a single-line criterion bullet (task 0862 R4): the bold span and its
    // head before the first ` — ` / `:` are declared ids, so `- **AC2 — Title.** Given …`
    // answers to both `AC2` and the full bold title.
    for (const m of section.matchAll(/^[-*]\s+(?:\[[ xX]\]\s+)?\*\*(.+?)\*\*/gm)) {
        const inner = (m[1] ?? '').trim();
        if (!inner) continue;
        declareIdentity(inner);
        const head = inner.split(/\s+[—–]\s+|:/)[0]?.trim() ?? '';
        if (head && head !== inner) declareIdentity(head);
    }
    // Bold-trajectory form (task 0817 R3): answers may cite an AC by a bare
    // `**AC id**` paragraph (house style for long/complex ids). Only whole-line
    // bold spans count — the line-anchored lazy regex rejects lines with two
    // spans, keeping interpolated bold text out of the index. The head (text
    // before the first colon) is declared like a checklist label, mirroring
    // the `(?::|$)` label extraction above.
    for (const m of section.matchAll(/^\*\*(.+?)\*\*\s*$/gm)) {
        const inner = (m[1] ?? '').trim();
        if (!inner) continue;
        declareIdentity(inner);
        const head = inner.split(':')[0]?.trim() ?? '';
        if (head && head !== inner) declareIdentity(head);
    }
    const scenarioTitles = (content: string): string[] =>
        [...content.matchAll(/^[ \t]*Scenario:\s*(.+)\s*$/gm)].map((m) => (m[1] ?? '').trim()).filter((t) => t !== '');
    const taskScenarios = scenarioTitles(sectionBetween(taskContent, 'Acceptance Criteria'));
    const featureScenarios = featureContent !== null ? scenarioTitles(featureContent) : [];
    for (const title of [...taskScenarios, ...featureScenarios]) declareIdentity(title);
    return { byTitle, taskScenarios, featureScenarios };
}

/** Resolution outcome for one AC row id. */
type AcIdentityResolution = { ok: true; canonical: string } | { ok: false; error: string };

/**
 * Resolve an answer-file AC row id to one canonical task identity (0804 R4):
 * exact/declared title forms first, then the documented `AC-N` positional
 * alias — accepted only against a real scenario ordinal, and refused with an
 * actionable diagnostic when task and feature ordinals disagree. Undeclared
 * `ACn` tokens, paraphrases and invented ordinals never resolve.
 *
 * Declared forms recognized in the index include the bold-trajectory
 * `**AC id**` paragraph (task 0817 R3); the AC-N failure hint names it.
 */
function resolveAcIdentity(rowId: string, index: AcIdentityIndex): AcIdentityResolution {
    const canonical = index.byTitle.get(normalizeAcTitle(rowId));
    if (canonical !== undefined) return { ok: true, canonical };
    // Strip the tolerated wrappers, then try the documented `AC-N` alias.
    const stripped = stripAcWrappers(rowId);
    const ordinal = /^AC-(\d+)$/i.exec(stripped);
    if (ordinal !== null) {
        const n = Number(ordinal[1]);
        const taskTitle = index.taskScenarios[n - 1];
        const featureTitle = index.featureScenarios[n - 1];
        const candidates = [...new Set([taskTitle, featureTitle].filter((t): t is string => t !== undefined))];
        if (candidates.length === 0) {
            return {
                ok: false,
                error:
                    `AC id "${rowId}" uses the AC-${n} positional alias but no scenario exists at that ordinal ` +
                    '(task scenario list and linked-feature scenario list) — cite the exact scenario title, checklist label, or a bare `**AC id**` paragraph',
            };
        }
        if (candidates.length > 1) {
            return {
                ok: false,
                error:
                    `AC id "${rowId}" is ambiguous: task AC #${n} ("${taskTitle}") and feature scenario #${n} ` +
                    `("${featureTitle}") are different scenarios with different ordering — cite the exact title`,
            };
        }
        const resolved = index.byTitle.get(normalizeAcTitle(candidates[0] ?? ''));
        if (resolved !== undefined) return { ok: true, canonical: resolved };
    }
    return { ok: false, error: '' };
}
