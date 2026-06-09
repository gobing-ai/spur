import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────

interface VerbSurface {
    name: string;
    hasJson: boolean;
}

interface NounSurface {
    name: string;
    verbs: VerbSurface[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Collect all matches of a global regex as plain arrays. */
function matchAll(re: RegExp, text: string): RegExpExecArray[] {
    const results: RegExpExecArray[] = [];
    let m = re.exec(text);
    while (m !== null) {
        results.push(m);
        m = re.exec(text);
    }
    return results;
}

/** Extract capture group 1, which is guaranteed present by the regex. */
function cap(m: RegExpExecArray): string {
    return m[1] ?? '';
}

// ── Parse doc surface ────────────────────────────────────────────────────

// Doc-heading contract this parser depends on: §1.1 nouns are `#### \`spur <noun> …\``
// headings; multi-verb headings join verbs with `·`; §1.2 lists nouns in table rows as
// `| \`spur <noun> …\` |`. If 04_DESIGN.md is reformatted away from these conventions,
// the parser yields zero nouns and the parity tests below fail loudly rather than silently passing.
async function parseDocSurface(docPath: string): Promise<NounSurface[]> {
    const text = await readFile(docPath, 'utf-8');

    // Collect all #### `spur <noun> …` headings.
    const headingPattern = /^####\s+`spur\s+(\w+)\b/gm;
    const headings = matchAll(headingPattern, text).map((m) => ({ noun: cap(m), start: m.index }));

    // Group by noun.
    const nounMap = new Map<string, number[]>();
    for (const h of headings) {
        const list = nounMap.get(h.noun);
        if (list) {
            list.push(h.start);
        } else {
            nounMap.set(h.noun, [h.start]);
        }
    }

    // §1.2 table rows.
    const tableNounPattern = /\|\s*`spur\s+(\w+)\b([^`]*?)`\s*\|/g;
    for (const m of matchAll(tableNounPattern, text)) {
        if (!nounMap.has(cap(m))) {
            nounMap.set(cap(m), []);
        }
    }

    // Extract verbs for each noun.
    const result: NounSurface[] = [];
    for (const [noun, starts] of nounMap) {
        const verbs = new Map<string, VerbSurface>();

        for (const start of starts) {
            const section = extractHeadingSection(text, start);
            for (const v of parseVerbsFromHeading(section, noun)) {
                if (!verbs.has(v.name)) {
                    verbs.set(v.name, v);
                }
            }
        }

        // §1.2 table: find noun's row.
        const rowRe = new RegExp(`\\|\\s*\`spur\\s+${noun}\\b([^\`]*?)\`\\s*\\|`, 'g');
        for (const m of matchAll(rowRe, text)) {
            const flagsText = cap(m);
            const hasJson = /\[--json\]/.test(flagsText);
            if (!verbs.has('(table)')) {
                verbs.set('(table)', { name: '(table)', hasJson });
            }
        }

        if (verbs.size > 0) {
            result.push({ name: noun, verbs: [...verbs.values()] });
        }
    }

    return result;
}

function extractHeadingSection(text: string, startIdx: number): string {
    const nextH4 = text.indexOf('\n#### ', startIdx + 1);
    const nextH2 = text.indexOf('\n## ', startIdx + 1);
    const candidates = [nextH4, nextH2].filter((i) => i > 0);
    const end = candidates.length > 0 ? Math.min(...candidates) : text.length;
    return text.slice(startIdx, end);
}

function parseVerbsFromHeading(section: string, noun: string): VerbSurface[] {
    const verbs: VerbSurface[] = [];
    const headingLine = section.split('\n')[0] || '';
    const clean = headingLine.replace(/^####\s*`/, '').replace(/`$/, '');

    // Verbless: next token after noun is a flag bracket.
    const headingTokens: string[] = clean.match(/\S+/g) || [];
    const verbIdx = headingTokens.indexOf(noun);
    if (verbIdx >= 0 && headingTokens[verbIdx + 1]?.startsWith('[')) {
        const hasJson = /\[--json\]/.test(clean);
        verbs.push({ name: '(verbless)', hasJson });
        return verbs;
    }

    // Multi-verb heading: parts joined by `·`.
    const parts = clean.split(/\s*[·•]\s*/);
    for (const part of parts) {
        const re = new RegExp(`spur\\s+${noun}\\s+(\\w+)\\b(.*)`);
        const m = re.exec(part);
        if (!m) {
            continue;
        }
        const verbName = cap(m);
        if (verbName === noun) {
            continue;
        }
        const rest = m[2] || '';
        const hasJson = /\[--json\]/.test(rest);
        if (!verbs.some((v) => v.name === verbName)) {
            verbs.push({ name: verbName, hasJson });
        }
    }

    return verbs;
}

// ── Parse code surface ────────────────────────────────────────────────────

async function parseCodeSurface(cmdsDir: string): Promise<NounSurface[]> {
    const entries = (await readdir(cmdsDir)).filter((f) => f.endsWith('.ts') && f !== 'stubs.ts');
    const nouns: NounSurface[] = [];

    for (const file of entries) {
        const text = await readFile(join(cmdsDir, file), 'utf-8');
        const nounName = file.replace(/\.ts$/, '');

        // Multi-verb: assigns `program.command('X')` to a variable.
        const multiVerbMatch = text.match(
            /const\s+(\w+)\s*=\s*(?:program|plugin)\s*\.\s*command\s*\(\s*['"](\w+)['"]\s*\)/,
        );

        const verbs = new Map<string, VerbSurface>();

        if (multiVerbMatch) {
            const varName = multiVerbMatch[1] ?? '';
            const subRe = new RegExp(String.raw`(?:${varName})\s*\.\s*command\s*\(\s*['"](\w+)['"]\s*\)`, 'g');
            const blocks = matchAll(subRe, text).map((m) => ({
                name: cap(m),
                end: m.index + m[0].length,
            }));

            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];
                if (!block) {
                    continue;
                }
                const { name } = block;
                if (verbs.has(name)) {
                    continue;
                }
                const blockStart = block.end;
                const blockEnd = i + 1 < blocks.length ? (blocks[i + 1]?.end ?? text.length) : text.length;
                const hasJson = /\.option\s*\(\s*['"]--json['"]/.test(text.slice(blockStart, blockEnd));
                verbs.set(name, { name, hasJson });
            }
        } else {
            // Verbless: .command('noun').summary(…)… on program directly.
            const hasJson = /\.option\s*\(\s*['"]--json['"]/.test(text);
            verbs.set('(verbless)', { name: '(verbless)', hasJson });
        }

        if (verbs.size > 0) {
            nouns.push({ name: nounName, verbs: [...verbs.values()] });
        }
    }
    return nouns;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CLI surface consistency', () => {
    const cmdDir = join(import.meta.dir, '..', 'src', 'commands');
    const docPath = join(import.meta.dir, '..', '..', '..', 'docs', '04_DESIGN.md');

    test('every documented noun has a corresponding command file', async () => {
        const docNouns = await parseDocSurface(docPath);
        const codeNouns = await parseCodeSurface(cmdDir);
        const codeNames = new Set(codeNouns.map((n) => n.name));

        const missing = docNouns.filter((dn) => !codeNames.has(dn.name)).map((dn) => dn.name);
        expect(missing).toEqual([]);
    });

    test('every command file has a documented noun', async () => {
        const docNouns = await parseDocSurface(docPath);
        const codeNouns = await parseCodeSurface(cmdDir);
        const docNames = new Set(docNouns.map((n) => n.name));

        const undocumented = codeNouns.filter((cn) => !docNames.has(cn.name)).map((cn) => cn.name);
        expect(undocumented).toEqual([]);
    });

    test('every --json claim in code matches the doc', async () => {
        const docNouns = await parseDocSurface(docPath);
        const codeNouns = await parseCodeSurface(cmdDir);

        interface Mismatch {
            noun: string;
            verb: string;
            codeHasJson: boolean;
            docHasJson: boolean;
        }
        const mismatches: Mismatch[] = [];

        for (const cn of codeNouns) {
            const dn = docNouns.find((d) => d.name === cn.name);
            if (!dn) {
                continue;
            }

            for (const cv of cn.verbs) {
                const dv = dn.verbs.find((d) => d.name === cv.name);
                if (!dv) {
                    // Align verbless with table entries.
                    if (cv.name === '(verbless)') {
                        const tableVerb = dn.verbs.find((d) => d.name === '(table)');
                        if (tableVerb && cv.hasJson !== tableVerb.hasJson) {
                            mismatches.push({
                                noun: cn.name,
                                verb: '(verbless↔table)',
                                codeHasJson: cv.hasJson,
                                docHasJson: tableVerb.hasJson,
                            });
                        }
                    }
                    continue;
                }
                if (cv.hasJson !== dv.hasJson) {
                    mismatches.push({
                        noun: cn.name,
                        verb: cv.name,
                        codeHasJson: cv.hasJson,
                        docHasJson: dv.hasJson,
                    });
                }
            }
        }

        expect(mismatches).toEqual([]);
    });
});
