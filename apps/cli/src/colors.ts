/**
 * Minimal ANSI colorizer for human CLI output.
 *
 * Color is opt-in per call site: build a {@link Colorize} via {@link makeColorize}
 * with a single `enabled` decision (honor `NO_COLOR`, only colorize a TTY), then
 * use the returned helpers. When disabled, every helper is the identity function,
 * so callers never branch on color themselves and tests stay plain-text.
 */

const CODES = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
} as const;

type ColorName = Exclude<keyof typeof CODES, 'reset'>;

/** Per-color wrap functions plus the active flag. */
export type Colorize = Record<ColorName, (text: string) => string> & { enabled: boolean };

/** Build a colorizer; when `enabled` is false all helpers return their input unchanged. */
export function makeColorize(enabled: boolean): Colorize {
    const wrap = (name: ColorName) => (text: string) => (enabled ? `${CODES[name]}${text}${CODES.reset}` : text);
    return {
        enabled,
        dim: wrap('dim'),
        red: wrap('red'),
        green: wrap('green'),
        yellow: wrap('yellow'),
        cyan: wrap('cyan'),
    };
}

/**
 * Decide whether to emit color for a given stream.
 *
 * Follows the `NO_COLOR` convention and only colorizes an interactive TTY, so piped
 * or redirected output (and test sinks) stay plain. `FORCE_COLOR` overrides both.
 */
export function shouldColor(env: Record<string, string | undefined>, stream: { isTTY?: boolean }): boolean {
    if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== '') return true;
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
    return stream.isTTY === true;
}
