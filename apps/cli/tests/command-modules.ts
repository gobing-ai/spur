import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** One CLI noun's command source, as the source-scanning surface tests see it. */
export interface CommandModule {
    /** Logical module name `<noun>.ts`, stable whether the noun is one file or a folder. */
    file: string;
    noun: string;
    /** Module text; for a per-noun folder, every file concatenated (index.ts first, shared.ts last). */
    src: string;
}

function folderOrder(name: string): number {
    if (name === 'index.ts') return 0;
    if (name === 'shared.ts') return 2;
    return 1;
}

/**
 * Read every command module under `commandsDir`. A noun is either `commands/<noun>.ts` or a
 * per-verb folder `commands/<noun>/{index.ts, <verb>.ts..., shared.ts}` (the `spur <noun> <verb>`
 * layout). Folder nouns are concatenated so surface scans keep treating a noun as one module.
 */
export function readCommandModules(commandsDir: string, exclude: readonly string[] = []): CommandModule[] {
    const modules: CommandModule[] = [];
    for (const entry of readdirSync(commandsDir).sort()) {
        const path = join(commandsDir, entry);
        if (statSync(path).isDirectory()) {
            const parts = readdirSync(path)
                .filter((f) => f.endsWith('.ts'))
                .sort((a, b) => folderOrder(a) - folderOrder(b) || a.localeCompare(b));
            if (!parts.includes('index.ts')) continue;
            const src = parts.map((f) => readFileSync(join(path, f), 'utf8')).join('\n');
            modules.push({ file: `${entry}.ts`, noun: entry, src });
            continue;
        }
        if (!entry.endsWith('.ts') || exclude.includes(entry)) continue;
        modules.push({ file: entry, noun: entry.replace(/\.ts$/, ''), src: readFileSync(path, 'utf8') });
    }
    return modules;
}
