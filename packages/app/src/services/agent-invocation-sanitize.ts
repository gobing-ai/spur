import type { CoordinationArtifactRef } from '@gobing-ai/spur-domain';

const TRACE_SAFE_SLASH_COMMAND = /^(?:\/skill:(?:sp|rd3)-|\/(?:sp|rd3)[:-]|\$(?:sp|rd3)-)[A-Za-z0-9._-]+(?:\s|$)/;

const TRACE_SAFE_SLASH_TOKEN =
    /^(?:\d{4}|--(?:auto|next|force|bdd)|--(?:mode|fix|focus)|implement|test|review|verify|all|none|blockers-first|quick|requirements|background|constraints|acceptance)$/;

const SENSITIVE_FLAG = /^--?(?:api[-_]?key|authorization|credential|password|secret|token)$/i;

const SENSITIVE_INLINE_FLAG = /^(--?(?:api[-_]?key|authorization|credential|password|secret|token)=).+$/i;

/**
 * Preserve the diagnostic identity of a slash command without persisting its
 * free-form argument payload. Ordinary prompts are fully redacted because no
 * generic secret detector can prove arbitrary prose safe.
 */
export function traceSafePrompt(prompt: string): string {
    const trimmed = prompt.trim();
    if (!TRACE_SAFE_SLASH_COMMAND.test(trimmed)) {
        return `[redacted prompt: ${prompt.length} chars]`;
    }
    const [command = '', ...tokens] = trimmed.split(/\s+/);
    const safeTokens = tokens.map((token) => (TRACE_SAFE_SLASH_TOKEN.test(token) ? token : '[redacted]'));
    return [command, ...safeTokens].join(' ');
}

/** Parse a coordination_runs `artifact_refs_json` column defensively. */
export function parseArtifactRefs(json: string): CoordinationArtifactRef[] {
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? (parsed as CoordinationArtifactRef[]) : [];
    } catch {
        return [];
    }
}

/** Redact prompt-bearing and secret-bearing argv entries before trace persistence. */
export function sanitizeInvocationArgv(
    argv: string[],
    rawInput: string | undefined,
    traceInput: string | undefined,
): string[] {
    let redactNext = false;
    return argv.map((arg) => {
        if (redactNext) {
            redactNext = false;
            return '[redacted]';
        }
        if (SENSITIVE_FLAG.test(arg)) {
            redactNext = true;
            return arg;
        }
        if (rawInput !== undefined && traceInput !== undefined && arg.includes(rawInput)) {
            return traceInput;
        }
        return arg
            .replace(SENSITIVE_INLINE_FLAG, '$1[redacted]')
            .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_]{12,}\b/g, '[redacted]');
    });
}
