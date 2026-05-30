/** Parsed command line shape used by the lightweight CLI dispatcher. */
export interface ParsedArgs {
    command: string[];
    flags: Record<string, string | boolean>;
    positionals: string[];
}

/** Parse argv into command path, flags, and positional values. */
export function parseArgs(argv: string[]): ParsedArgs {
    const command: string[] = [];
    const positionals: string[] = [];
    const flags: Record<string, string | boolean> = {};
    let parsingFlags = true;

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === undefined) continue;
        if (token === '--') {
            parsingFlags = false;
            continue;
        }

        if (parsingFlags && token.startsWith('--')) {
            const name = token.slice(2);
            const next = argv[index + 1];
            if (next !== undefined && !next.startsWith('-')) {
                flags[name] = next;
                index += 1;
            } else {
                flags[name] = true;
            }
            continue;
        }

        if (command.length < 2 && positionals.length === 0) {
            command.push(token);
        } else {
            positionals.push(token);
        }
    }

    return { command, flags, positionals };
}

/** Read a string flag or return a default value. */
export function stringFlag(flags: Record<string, string | boolean>, name: string, fallback: string): string {
    const value = flags[name];
    return typeof value === 'string' ? value : fallback;
}

/** Read a boolean flag from parsed args. */
export function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
    return flags[name] === true;
}
