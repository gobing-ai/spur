export function stringFlag(flags: Record<string, string | boolean>, name: string, fallback: string): string {
    const value = flags[name];
    return typeof value === 'string' ? value : fallback;
}

export function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
    return flags[name] === true;
}

/** ADR-091 tri-state `--json-envelope` read: explicit true/false wins, undefined defers to SPUR_JSON_ENVELOPE. */
export function jsonEnvelopeFlag(flags: Record<string, string | boolean>): boolean | undefined {
    const value = flags.jsonEnvelope;
    return typeof value === 'boolean' ? value : undefined;
}

export function numberFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
    const value = flags[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') return undefined;
    const n = Number(value);
    if (Number.isNaN(n)) return undefined;
    return n;
}

/** Parse the comma-separated `--tags` flag into trimmed, non-empty tags, or undefined when absent. */
export function parseTagsFlag(flags: Record<string, string | boolean>): string[] | undefined {
    const raw = stringFlag(flags, 'tags', '');
    if (raw === '') return undefined;
    const tags = raw
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    return tags.length > 0 ? tags : undefined;
}
