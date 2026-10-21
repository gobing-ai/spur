/**
 * ADR-144 — a changelog claim bullet's `confidence` level is derived from its anchors and cross-checked.
 *
 * ADR-141 revived the HIGH|MEDIUM|LOW label for the two answer artifacts only, on the terms the
 * ADR-138 amendment set: the gate recomputes the level from the answer's own rows, so the label
 * cannot be asserted past the gate. This is the second derived lane, with the changelog anchors as
 * the rows. The label measures anchor composition — a re-runnable `path:line`, an external URL or a
 * whole-file citation, or a pointer that no longer resolves — which the anchor comment itself does
 * not record and no other artifact did. Everywhere else ADR-138's invariant stands.
 *
 * Runs in `bun run test-repo-wide` (the repo-wide, feature-scoped pass): it reads the whole corpus
 * file, not one changed subset.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Repo root: repo-wide-tests → repo. */
const REPO_ROOT = join(import.meta.dir, '..');
const CHANGELOG = join(REPO_ROOT, 'CHANGELOG.md');

const LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
type Level = (typeof LEVELS)[number];

interface AnchorComment {
    /** 1-based line of the `<!-- src: … -->` comment. */
    line: number;
    /** The release heading this comment sits under. */
    section: string;
    /** The citation anchors, in file order. */
    anchors: string[];
    /** The level the comment states, verbatim; `null` when it states none. */
    stated: string | null;
}

/** One anchor reduced to what the derivation reads. */
interface ResolvedAnchor {
    /** The anchor names a location inside this tree (external URLs never are). */
    inTree: boolean;
    /** The anchor points at one line, not at a file or an external page. */
    linePrecise: boolean;
    /** The anchor's target exists: the file is there and the cited line is within it. */
    resolves: boolean;
}

const SRC_COMMENT = /<!--\s*src:\s*(.*?)\s*-->/;
const RELEASE_HEADING = /^##\s+\[([^\]]+)\]/;
const STATED_LEVEL = /·\s*confidence:\s*([A-Za-z]+)/;
const EXTERNAL_URL = /^https?:\/\//;
const PATH_WITH_LINE = /^(.+?):(\d+)$/;

const lineCounts = new Map<string, number | null>();

/** Line count of a repo-relative file; `null` when it is not a readable file. */
function lineCount(relativePath: string): number | null {
    const cached = lineCounts.get(relativePath);
    if (cached !== undefined) return cached;
    const absolutePath = join(REPO_ROOT, relativePath);
    const count = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8').split('\n').length : null;
    lineCounts.set(relativePath, count);
    return count;
}

function resolveAnchor(anchor: string): ResolvedAnchor {
    if (EXTERNAL_URL.test(anchor)) return { inTree: false, linePrecise: false, resolves: true };

    const withLine = PATH_WITH_LINE.exec(anchor);
    if (withLine === null) {
        return { inTree: true, linePrecise: false, resolves: lineCount(anchor) !== null };
    }

    const [, path = '', rawLine = '0'] = withLine;
    const cited = Number(rawLine);
    const count = lineCount(path);
    // A `:1` anchor locates nothing a reader could not get from the bare path, so it buys whole-file
    // evidence, never a line claim. Without this a writer appends `:1` to any path and reaches HIGH.
    return { inTree: true, linePrecise: cited > 1, resolves: count !== null && cited <= count };
}

/** The level these anchors support. Derived, never read back from the comment. */
function deriveLevel(anchors: string[]): Level {
    if (anchors.length === 0) return 'LOW';
    const resolved = anchors.map(resolveAnchor);
    if (resolved.every((anchor) => anchor.inTree && anchor.linePrecise && anchor.resolves)) return 'HIGH';
    if (resolved.every((anchor) => anchor.resolves)) return 'MEDIUM';
    return 'LOW';
}

function readAnchorComments(): AnchorComment[] {
    const comments: AnchorComment[] = [];
    let section = '(before any release heading)';
    const lines = readFileSync(CHANGELOG, 'utf8').split('\n');

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? '';
        const heading = RELEASE_HEADING.exec(line);
        if (heading !== null) {
            section = heading[1] ?? section;
            continue;
        }

        const comment = SRC_COMMENT.exec(line);
        if (comment === null) continue;
        const body = comment[1] ?? '';
        const stated = STATED_LEVEL.exec(body);
        const anchors = body
            .replace(/·.*$/, '')
            .split(',')
            .map((anchor) => anchor.trim())
            .filter((anchor) => anchor.length > 0);
        comments.push({ line: index + 1, section, anchors, stated: stated?.[1] ?? null });
    }

    return comments;
}

const comments = readAnchorComments();
/** The topmost `## [x.y.z]` block — the release still being written. */
const newestSection = comments[0]?.section;
const inNewestSection = comments.filter((comment) => comment.section === newestSection);

describe('changelog claim confidence (ADR-144)', () => {
    test('the file is readable as a corpus of anchored claims', () => {
        expect(comments.length).toBeGreaterThan(0);
        expect(inNewestSection.length).toBeGreaterThan(0);
    });

    test('every stated level is one of the three tokens', () => {
        const unknown = comments
            .filter((comment) => comment.stated !== null)
            .filter((comment) => !(LEVELS as readonly string[]).includes(comment.stated?.toUpperCase() ?? ''))
            .map((comment) => `L${comment.line} states "${comment.stated}"`);
        expect(unknown).toEqual([]);
    });

    test('every stated level matches what its anchors support', () => {
        const mismatches = comments
            .filter((comment) => comment.stated !== null)
            .filter((comment) => comment.stated?.toUpperCase() !== deriveLevel(comment.anchors))
            .map(
                (comment) =>
                    `L${comment.line} states ${comment.stated} but its anchors support ${deriveLevel(comment.anchors)}` +
                    ` — ${comment.anchors.join(', ')}`,
            );
        expect(mismatches).toEqual([]);
    });

    test('every anchor in the newest release section states a level', () => {
        // Legacy sections keep their recorded text: retro-levelling ~100 historical anchors is
        // make-work, the same reason the settled claims rule excludes the task archives.
        const missing = inNewestSection
            .filter((comment) => comment.stated === null)
            .map((comment) => `L${comment.line} (${comment.section}) states no level`);
        expect(missing).toEqual([]);
    });
});
