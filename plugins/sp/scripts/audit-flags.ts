/**
 * One-off Phase-0 audit: extract argument-hint, headings, and body flag mentions
 * from every dev-*.md command. Prints a JSON ledger to stdout.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const COMMANDS_DIR = join(ROOT, 'plugins', 'sp', 'commands');

interface CmdAudit {
    name: string;
    description: string;
    argumentHint: string;
    hintHasMarkdown: boolean;
    hintFlags: string[];
    hintPositionals: string[];
    headings: string[];
    hasAdHocTable: boolean;
    bodyFlags: string[];
    glossaryRefs: number;
}

function extractYamlField(fm: string, key: string): string {
    const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
    const m = fm.match(re);
    if (!m) return '';
    let value = m[1].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    // Handle folded scalars (>-)
    if (value === '>-' || value === '|') {
        const lines = fm.split('\n');
        const idx = lines.findIndex((l) => re.test(l));
        const collected: string[] = [];
        for (let i = idx + 1; i < lines.length; i++) {
            if (lines[i].startsWith('  ')) collected.push(lines[i].trim());
            else break;
        }
        value = collected.join(' ');
    }
    return value;
}

function extractFlags(text: string): string[] {
    return [...new Set([...text.matchAll(/(--[a-z][a-z-]*)/g)].map((m) => m[1]))].sort();
}

function extractPositionals(hint: string): string[] {
    // <wbs>, <testee>, "<blocker description>", [<wbs>]
    const pos: string[] = [];
    for (const m of hint.matchAll(/<([^>]+)>/g)) pos.push(`<${m[1]}>`);
    for (const m of hint.matchAll(/"([^"]+)"/g)) pos.push(`"${m[1]}"`);
    return [...new Set(pos)].sort();
}

const files = readdirSync(COMMANDS_DIR)
    .filter((f) => f.startsWith('dev-') && f.endsWith('.md'))
    .sort();

const ledger: CmdAudit[] = [];

for (const file of files) {
    const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
    const fm = fmMatch ? fmMatch[1] : '';

    const description = extractYamlField(fm, 'description');
    const argumentHint = extractYamlField(fm, 'argument-hint');

    // Strip markdown links from hint for flag extraction
    const hintClean = argumentHint.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const hintFlags = extractFlags(hintClean);
    const hintPositionals = extractPositionals(hintClean);

    // Headings
    const headings: string[] = [];
    let inFence = false;
    for (const line of body.split('\n')) {
        if (line.startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        if (line.startsWith('#')) headings.push(line.replace(/^#+\s*/, '').trim());
    }

    // Ad hoc table detection (tables NOT in Usage code blocks)
    const hasAdHocTable = /\| .*Flag.*\|.*\|/.test(body) || /\| .*Default.*\|/.test(body);

    // Body flags (excluding fenced code + frontmatter)
    const bodyText = body;
    const bodyFlags = extractFlags(bodyText);

    // Glossary refs
    const glossaryRefs = (body.match(/flag-glossary\.md/g) ?? []).length;

    ledger.push({
        name: file.replace(/\.md$/, ''),
        description,
        argumentHint,
        hintHasMarkdown: argumentHint.includes(']('),
        hintFlags,
        hintPositionals,
        headings,
        hasAdHocTable,
        bodyFlags,
        glossaryRefs,
    });
}

// Summary stats
const allHintFlags = new Map<string, string[]>();
for (const cmd of ledger) {
    for (const f of cmd.hintFlags) {
        if (!allHintFlags.has(f)) allHintFlags.set(f, []);
        allHintFlags.get(f)?.push(cmd.name);
    }
}

console.log(
    JSON.stringify(
        {
            totalCommands: ledger.length,
            commandsWithMarkdownInHint: ledger.filter((c) => c.hintHasMarkdown).length,
            totalHintDeclarations: ledger.reduce((s, c) => s + c.hintFlags.length, 0),
            uniqueHintFlags: allHintFlags.size,
            sharedFlags: [...allHintFlags.entries()]
                .filter(([, cmds]) => cmds.length >= 2)
                .sort((a, b) => b[1].length - a[1].length),
            singleFlags: [...allHintFlags.entries()]
                .filter(([, cmds]) => cmds.length === 1)
                .map(([f]) => f)
                .sort(),
            ledger,
        },
        null,
        2,
    ),
);
